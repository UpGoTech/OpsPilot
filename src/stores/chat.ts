import { defineStore } from "pinia";
import { computed, ref, watch } from "vue";
import { activityLabel, summarizeDetail } from "../lib/activityLabels";
import { classifyAttachment, toDataUrl } from "../lib/attachments";
import { withPolicyPreamble } from "../lib/opspilotPolicy";
import { fsDefaultCwd } from "../lib/native";
import { useGatewayStore } from "./gateway";
import { useSessionsStore } from "./sessions";
import type {
  AgentActivity,
  ApprovalChoice,
  ApprovalRequest,
  ClarifyQuestion,
  ClarifyRequest,
  PromptAttachment,
  ChatMessage,
  ChatTurn,
  GatewayEvent,
  GatewayServerRequest,
  SecretPromptKind,
  SecretPromptRequest,
  VaultSaveLoginRequest,
} from "../types";

const DEFAULT_APPROVAL_CHOICES: ApprovalChoice[] = [
  "once",
  "session",
  "always",
  "deny",
];

/** Desktop window-owned bridges — OpsPilot has no pane; answer empty value. */
const SURFACE_REQUESTS = new Set([
  "preview.act",
  "preview.read",
  "terminal.read",
  "window.read",
  "tour",
]);

function asApprovalChoices(raw: unknown): ApprovalChoice[] {
  if (!Array.isArray(raw) || !raw.length) return [...DEFAULT_APPROVAL_CHOICES];
  const allowed = new Set(DEFAULT_APPROVAL_CHOICES);
  const out = raw
    .map(String)
    .filter((c): c is ApprovalChoice => allowed.has(c as ApprovalChoice));
  return out.length ? out : [...DEFAULT_APPROVAL_CHOICES];
}

function normalizeClarifyQuestions(raw: unknown): ClarifyQuestion[] {
  if (!Array.isArray(raw)) return [];
  const out: ClarifyQuestion[] = [];
  for (const entry of raw) {
    if (!entry || typeof entry !== "object") continue;
    const row = entry as Record<string, unknown>;
    const qid = typeof row.qid === "string" ? row.qid.trim() : "";
    const question =
      typeof row.question === "string" ? row.question.trim() : "";
    if (!qid || !question) continue;
    const choices = Array.isArray(row.choices)
      ? row.choices.map(String).map((c) => c.trim()).filter(Boolean)
      : [];
    out.push({
      qid,
      question,
      choices: choices.length ? choices : null,
      multiSelect: row.multi_select === true && choices.length > 0,
    });
  }
  return out;
}

/** Route by extension/mime — never trust a stale composer `kind` (HMR / older chips). */
function partitionAttachments(attachments: PromptAttachment[]) {
  const images: PromptAttachment[] = [];
  const files: PromptAttachment[] = [];
  for (const item of attachments) {
    const kind =
      classifyAttachment({ name: item.name, type: item.mime }) ?? item.kind;
    if (kind === "image") images.push(item);
    else files.push(item);
  }
  return { images, files };
}

function historyToMessages(raw: unknown): ChatMessage[] {
  const list = Array.isArray(raw)
    ? raw
    : raw && typeof raw === "object"
      ? ((raw as Record<string, unknown>).messages ??
        (raw as Record<string, unknown>).history ??
        (raw as Record<string, unknown>).items)
      : null;
  if (!Array.isArray(list)) return [];

  return list
    .map((item, index): ChatMessage | null => {
      if (!item || typeof item !== "object") return null;
      const row = item as Record<string, unknown>;
      const role = String(row.role ?? "assistant") as ChatMessage["role"];
      if (role === "tool") return null;
      const content =
        typeof row.content === "string"
          ? row.content
          : typeof row.text === "string"
            ? row.text
            : typeof row.message === "string"
              ? row.message
              : JSON.stringify(row.content ?? "");
      // Drop empty assistant placeholders (Desktop never paints these).
      if (role !== "user" && role !== "system" && !String(content).trim()) {
        return null;
      }
      return {
        id: String(row.id ?? row.message_id ?? `hist-${index}`),
        role: role === "user" || role === "system" ? role : "assistant",
        content: String(content),
      };
    })
    .filter(Boolean) as ChatMessage[];
}

/** Fold flat history into Desktop-style turn groups. */
function messagesToTurns(msgs: ChatMessage[]): ChatTurn[] {
  const turns: ChatTurn[] = [];
  let current: ChatTurn | null = null;

  const pushStandalone = (msg: ChatMessage) => {
    turns.push({
      id: `turn-${msg.id}`,
      user: null,
      activity: [],
      replies: [msg],
      running: false,
    });
  };

  for (const msg of msgs) {
    if (msg.role === "user") {
      current = {
        id: `turn-${msg.id}`,
        user: msg,
        activity: [],
        replies: [],
        running: false,
      };
      turns.push(current);
      continue;
    }
    if (!current) {
      pushStandalone(msg);
      current = turns[turns.length - 1];
      continue;
    }
    current.replies.push(msg);
  }
  return turns;
}

function eventPayload(event: GatewayEvent): Record<string, unknown> {
  const inner =
    event.payload && typeof event.payload === "object" ? event.payload : {};
  return {
    ...inner,
    session_id: event.session_id ?? inner.session_id,
  };
}

function toolId(payload: Record<string, unknown>): string {
  return String(
    payload.tool_call_id ??
      payload.call_id ??
      payload.id ??
      payload.request_id ??
      crypto.randomUUID(),
  );
}

function toolNameOf(payload: Record<string, unknown>): string {
  return String(payload.name ?? payload.tool ?? payload.tool_name ?? "tool");
}

export const useChatStore = defineStore("chat", () => {
  const turns = ref<ChatTurn[]>([]);
  const loadingHistory = ref(false);
  const sending = ref(false);
  const error = ref<string | null>(null);
  /** Tool approvals waiting for Once / Session / Always / Deny. */
  const pendingApprovals = ref<ApprovalRequest[]>([]);
  const pendingClarify = ref<ClarifyRequest[]>([]);
  const pendingSecrets = ref<SecretPromptRequest[]>([]);
  const pendingVaultSaves = ref<VaultSaveLoginRequest[]>([]);
  /** Live status.update text (compaction / fallback / goal). */
  const statusLine = ref<string | null>(null);
  /** Bumped to remount MarkdownBody (re-run artifact extractors). */
  const renderEpoch = ref(0);
  let streamingId: string | null = null;
  let activeTurnId: string | null = null;
  let unsub: (() => void) | null = null;
  let unsubServerRequest: (() => void) | null = null;
  let unwatchGatewayState: (() => void) | null = null;

  function markLiveWaiting() {
    const turn = activeTurn();
    if (turn) turn.running = true;
    sending.value = true;
  }

  function clearAllPrompts() {
    pendingApprovals.value = [];
    pendingClarify.value = [];
    pendingSecrets.value = [];
    pendingVaultSaves.value = [];
  }

  function dropPromptById(requestId: string) {
    pendingApprovals.value = pendingApprovals.value.filter(
      (a) => a.requestId !== requestId && a.serverRequestId !== requestId,
    );
    pendingClarify.value = pendingClarify.value.filter(
      (c) => c.serverRequestId !== requestId,
    );
    pendingSecrets.value = pendingSecrets.value.filter(
      (s) => s.serverRequestId !== requestId,
    );
    pendingVaultSaves.value = pendingVaultSaves.value.filter(
      (v) => v.serverRequestId !== requestId,
    );
  }

  const activity = computed(() => {
    const turn = turns.value.find((t) => t.id === activeTurnId);
    return turn?.activity ?? [];
  });

  const activeActivity = computed(() =>
    activity.value.filter((a) => a.status === "running"),
  );

  const latestActivity = computed(
    () =>
      activeActivity.value[activeActivity.value.length - 1] ??
      activity.value[activity.value.length - 1] ??
      null,
  );

  /** Flat view kept for any callers that still expect messages. */
  const messages = computed(() =>
    turns.value.flatMap((t) => [
      ...(t.user ? [t.user] : []),
      ...t.replies,
    ]),
  );

  const transcriptMessages = computed(() => messages.value);

  function ensureListener() {
    if (unsub) return;
    const gateway = useGatewayStore();
    unsub = gateway.onEvent(handleEvent);
    unsubServerRequest = gateway.onServerRequest(handleServerRequest);
    // WS drop mid-turn must unlock the composer; reconnect alone does not.
    if (!unwatchGatewayState) {
      unwatchGatewayState = watch(
        () => gateway.state,
        (next) => {
          if (next === "closed" || next === "error") {
            sending.value = false;
            statusLine.value = null;
            finishTurnActivity("done");
          }
        },
      );
    }
  }

  function handleServerRequest(req: GatewayServerRequest) {
    const gateway = useGatewayStore();
    const sessions = useSessionsStore();
    const params = (req.params ?? {}) as Record<string, unknown>;
    const sessionId = String(
      params.session_id ?? sessions.liveId ?? sessions.activeId ?? "",
    );

    // Desktop window-owned bridges — no pane here; empty value = unavailable.
    if (SURFACE_REQUESTS.has(req.method)) {
      void gateway
        .respondServerRequest(req.id, { value: "" })
        .catch(() => undefined);
      return;
    }

    if (req.method === "approval") {
      const requestId = String(params.request_id ?? req.id);
      const next: ApprovalRequest = {
        serverRequestId: req.id,
        requestId,
        sessionId,
        command: String(params.command ?? ""),
        description: String(
          params.description ??
            params.tool_name ??
            "This command needs approval",
        ),
        choices: asApprovalChoices(params.choices),
        toolName:
          typeof params.tool_name === "string" ? params.tool_name : undefined,
      };
      pendingApprovals.value = [
        ...pendingApprovals.value.filter(
          (a) =>
            a.serverRequestId !== next.serverRequestId &&
            a.requestId !== next.requestId,
        ),
        next,
      ];
      markLiveWaiting();
      void gateway
        .rpc("approval.received", {
          session_id: sessionId || undefined,
          request_id: requestId,
        })
        .catch(() => undefined);
      return;
    }

    if (req.method === "clarify" || req.method === "setup_choose") {
      let questions = normalizeClarifyQuestions(params.questions);
      let setupKind: string | undefined;
      if (req.method === "setup_choose") {
        setupKind =
          typeof params.kind === "string" ? params.kind : undefined;
        const question =
          typeof params.question === "string" ? params.question.trim() : "";
        if (question && !questions.length) {
          const options = Array.isArray(params.options)
            ? params.options
                .map((o) => {
                  if (o && typeof o === "object" && "label" in o) {
                    return String((o as { label: unknown }).label);
                  }
                  return String(o);
                })
                .filter(Boolean)
            : [];
          questions = [
            {
              qid: "setup_choose",
              question,
              choices: options.length ? options : null,
              multiSelect: params.multi_select === true && options.length > 0,
            },
          ];
        }
      }
      if (!questions.length) {
        void gateway.respondServerRequest(req.id, {}).catch(() => undefined);
        return;
      }
      const next: ClarifyRequest = {
        serverRequestId: req.id,
        sessionId,
        questions,
        setupKind,
      };
      pendingClarify.value = [
        ...pendingClarify.value.filter(
          (c) => c.serverRequestId !== next.serverRequestId,
        ),
        next,
      ];
      markLiveWaiting();
      return;
    }

    if (
      req.method === "sudo" ||
      req.method === "display.install.sudo" ||
      req.method === "secret" ||
      req.method === "vault.unlock_prompt" ||
      req.method === "vault.code"
    ) {
      let kind: SecretPromptKind = "secret";
      let title = "Secret needed";
      let description = String(params.prompt ?? params.description ?? "");
      let hint: string | undefined;
      let command: string | undefined;

      if (req.method === "sudo" || req.method === "display.install.sudo") {
        kind = "sudo";
        title = "Password needed";
        description =
          description ||
          (req.method === "display.install.sudo"
            ? "Enter your password to continue the install."
            : "Enter your password to run this command.");
        command = String(params.command ?? "") || undefined;
      } else if (req.method === "vault.unlock_prompt") {
        kind = "vault_unlock";
        const display =
          String(params.display_name ?? params.backend ?? "Password manager");
        title = `Unlock ${display}`;
        description = description || `Enter the master password for ${display}.`;
      } else if (req.method === "vault.code") {
        kind = "vault_code";
        const site = String(params.site ?? "site");
        title = `Code for ${site}`;
        description =
          description ||
          String(params.hint ?? "Enter the one-time code from the site.");
        hint = String(params.hint ?? "") || undefined;
      } else {
        const envVar = String(params.env_var ?? "");
        title = envVar || "Secret needed";
        description = description || `Paste a value for ${envVar || "this secret"}.`;
        hint = envVar || undefined;
      }

      const next: SecretPromptRequest = {
        serverRequestId: req.id,
        sessionId,
        kind,
        title,
        description,
        command,
        hint,
      };
      pendingSecrets.value = [
        ...pendingSecrets.value.filter(
          (s) => s.serverRequestId !== next.serverRequestId,
        ),
        next,
      ];
      markLiveWaiting();
      return;
    }

    if (req.method === "vault.save_login") {
      const origin = String(params.origin ?? "");
      const site = String(params.site ?? origin) || "site";
      const next: VaultSaveLoginRequest = {
        serverRequestId: req.id,
        sessionId,
        site,
        origin,
      };
      pendingVaultSaves.value = [
        ...pendingVaultSaves.value.filter(
          (v) => v.serverRequestId !== next.serverRequestId,
        ),
        next,
      ];
      markLiveWaiting();
      return;
    }

    // Never drop — unblocks the Python side instead of stalling the turn.
    void gateway
      .failServerRequest(req.id, -32601, `Method not found: ${req.method}`)
      .catch(() => undefined);
  }

  async function answerApproval(requestId: string, choice: ApprovalChoice) {
    const gateway = useGatewayStore();
    const hit =
      pendingApprovals.value.find(
        (a) => a.requestId === requestId || a.serverRequestId === requestId,
      ) ?? null;
    if (!hit) return;

    pendingApprovals.value = pendingApprovals.value.filter(
      (a) => a.serverRequestId !== hit.serverRequestId,
    );

    try {
      await gateway.respondServerRequest(hit.serverRequestId, { choice });
    } catch {
      // Fallback when the live response frame path fails.
      try {
        await gateway.rpc("approval.respond", {
          session_id: hit.sessionId || undefined,
          request_id: hit.requestId,
          choice,
        });
      } catch (err) {
        error.value =
          err instanceof Error ? err.message : "Could not send approval";
        // Put it back so the user can retry.
        pendingApprovals.value = [...pendingApprovals.value, hit];
      }
    }
  }

  function clearApproval(requestId: string) {
    dropPromptById(requestId);
  }

  async function answerClarify(
    serverRequestId: string,
    answers: Record<string, string | null>,
  ) {
    const gateway = useGatewayStore();
    const hit =
      pendingClarify.value.find((c) => c.serverRequestId === serverRequestId) ??
      null;
    if (!hit) return;

    pendingClarify.value = pendingClarify.value.filter(
      (c) => c.serverRequestId !== serverRequestId,
    );

    try {
      // Desktop: sequential clarify.lock per question; last lock resolves the SRQ.
      for (const question of hit.questions) {
        const answer = answers[question.qid] ?? null;
        await gateway.rpc("clarify.lock", {
          answer,
          question_id: question.qid,
          request_id: hit.serverRequestId,
        });
      }
    } catch {
      // Fallback: respond on the server request frame directly.
      try {
        await gateway.respondServerRequest(hit.serverRequestId, { answers });
      } catch (err) {
        error.value =
          err instanceof Error ? err.message : "Could not send answer";
        pendingClarify.value = [...pendingClarify.value, hit];
      }
    }
  }

  async function skipClarify(serverRequestId: string) {
    const gateway = useGatewayStore();
    const hit =
      pendingClarify.value.find((c) => c.serverRequestId === serverRequestId) ??
      null;
    if (!hit) return;
    pendingClarify.value = pendingClarify.value.filter(
      (c) => c.serverRequestId !== serverRequestId,
    );
    try {
      await gateway.respondServerRequest(hit.serverRequestId, {});
    } catch {
      // ignore
    }
  }

  async function answerSecret(serverRequestId: string, value: string) {
    const gateway = useGatewayStore();
    const hit =
      pendingSecrets.value.find((s) => s.serverRequestId === serverRequestId) ??
      null;
    if (!hit) return;
    pendingSecrets.value = pendingSecrets.value.filter(
      (s) => s.serverRequestId !== serverRequestId,
    );
    try {
      await gateway.respondServerRequest(hit.serverRequestId, { value });
    } catch (err) {
      error.value =
        err instanceof Error ? err.message : "Could not send value";
      pendingSecrets.value = [...pendingSecrets.value, hit];
    }
  }

  async function answerVaultSave(
    serverRequestId: string,
    value: string,
  ) {
    const gateway = useGatewayStore();
    const hit =
      pendingVaultSaves.value.find(
        (v) => v.serverRequestId === serverRequestId,
      ) ?? null;
    if (!hit) return;
    pendingVaultSaves.value = pendingVaultSaves.value.filter(
      (v) => v.serverRequestId !== serverRequestId,
    );
    try {
      await gateway.respondServerRequest(hit.serverRequestId, { value });
    } catch (err) {
      error.value =
        err instanceof Error ? err.message : "Could not save login";
      pendingVaultSaves.value = [...pendingVaultSaves.value, hit];
    }
  }

  function activeTurn(): ChatTurn | null {
    if (activeTurnId) {
      const hit = turns.value.find((t) => t.id === activeTurnId);
      if (hit) return hit;
    }
    return turns.value[turns.value.length - 1] ?? null;
  }

  function upsertActivity(next: AgentActivity) {
    const turn = activeTurn();
    if (!turn) return;
    const idx = turn.activity.findIndex((a) => a.id === next.id);
    if (idx >= 0) {
      turn.activity[idx] = { ...turn.activity[idx], ...next };
    } else {
      turn.activity = [...turn.activity.slice(-40), next];
    }
  }

  /** Close any open thinking block before tools / a new thought stretch. */
  function sealThinking() {
    const turn = activeTurn();
    if (!turn) return;
    const last = turn.activity[turn.activity.length - 1];
    if (last?.toolName === "thinking" && last.status === "running") {
      last.status = "done";
      last.endedAt = Date.now();
      last.label = "Thought";
    }
  }

  function extractOutput(payload: Record<string, unknown>): {
    output?: string;
    outputBytes?: number;
  } {
    const raw =
      payload.stdout ??
      payload.output ??
      payload.result ??
      payload.content ??
      payload.summary;
    let output: string | undefined;
    if (typeof raw === "string" && raw.trim()) {
      output = raw.length > 8000 ? `${raw.slice(0, 8000)}…` : raw;
    } else if (raw && typeof raw === "object") {
      try {
        output = JSON.stringify(raw, null, 2).slice(0, 8000);
      } catch {
        output = undefined;
      }
    }
    const explicit = payload.stdout_bytes ?? payload.output_bytes;
    const outputBytes =
      typeof explicit === "number"
        ? explicit
        : output
          ? new TextEncoder().encode(output).length
          : undefined;
    return { output, outputBytes };
  }

  function findActivity(
    payload: Record<string, unknown>,
  ): AgentActivity | undefined {
    const turn = activeTurn();
    if (!turn) return undefined;
    const id = String(
      payload.tool_call_id ?? payload.call_id ?? payload.id ?? "",
    );
    if (id) {
      const hit = turn.activity.find((a) => a.id === id);
      if (hit) return hit;
    }
    const name = toolNameOf(payload);
    return [...turn.activity]
      .reverse()
      .find((a) => a.status === "running" && a.toolName === name);
  }

  function ensureStreamingReply(id: string): ChatMessage {
    const turn = activeTurn();
    if (!turn) {
      const reply: ChatMessage = {
        id,
        role: "assistant",
        content: "",
        streaming: true,
      };
      turns.value.push({
        id: `turn-${id}`,
        user: null,
        activity: [],
        replies: [reply],
        running: true,
      });
      activeTurnId = `turn-${id}`;
      return reply;
    }
    let reply = turn.replies.find((m) => m.id === id);
    if (!reply) {
      // Prefer updating a single in-flight reply rather than stacking empties.
      reply = turn.replies.find((m) => m.streaming);
      if (reply) {
        reply.id = id;
      } else {
        reply = { id, role: "assistant", content: "", streaming: true };
        turn.replies.push(reply);
      }
    }
    reply.streaming = true;
    return reply;
  }

  function finishTurnActivity(status: AgentActivity["status"] = "done") {
    const turn = activeTurn();
    if (!turn) return;
    const now = Date.now();
    turn.activity = turn.activity.map((a) => ({
      ...a,
      status: a.status === "running" ? status : a.status,
      endedAt: a.endedAt ?? now,
    }));
    turn.running = false;
  }

  function handleEvent(event: GatewayEvent) {
    const sessions = useSessionsStore();
    const payload = eventPayload(event);
    const sessionId = String(payload.session_id ?? "");
    if (sessionId && sessions.activeId) {
      const matches =
        sessionId === sessions.activeId ||
        sessionId === sessions.liveId ||
        sessions.sessions.some(
          (s) =>
            s.id === sessions.activeId &&
            (s.id === sessionId || s.liveId === sessionId),
        );
      if (!matches) return;
    }

    switch (event.type) {
      case "message.start": {
        // Don't paint an empty Hermes bubble — wait for content.
        streamingId = String(
          payload.message_id ?? payload.id ?? crypto.randomUUID(),
        );
        const turn = activeTurn();
        if (turn) turn.running = true;
        break;
      }
      case "message.delta":
      case "message.interim": {
        const text = String(
          payload.text ?? payload.delta ?? payload.content ?? "",
        );
        if (!text) break;
        if (!streamingId) {
          streamingId = String(payload.message_id ?? crypto.randomUUID());
        }
        const reply = ensureStreamingReply(streamingId);
        reply.content += text;
        break;
      }
      case "thinking.delta":
      case "reasoning.delta": {
        const text = String(
          payload.text ?? payload.delta ?? payload.content ?? "",
        );
        if (!text) break;
        const turn = activeTurn();
        if (turn) turn.running = true;
        const last = turn?.activity[turn.activity.length - 1];
        if (last?.toolName === "thinking" && last.status === "running") {
          // Accumulate reasoning into the current Thought block.
          const joined = `${last.detail || ""}${text}`;
          last.detail = joined.length > 4000 ? `${joined.slice(-4000)}` : joined;
          last.label = "Thought";
        } else {
          // New Thought stretch after tools (Desktop interleaves Thought / tools).
          upsertActivity({
            id: `thought-${crypto.randomUUID()}`,
            toolName: "thinking",
            label: "Thought",
            detail: text.length > 4000 ? text.slice(-4000) : text,
            startedAt: Date.now(),
            status: "running",
          });
        }
        break;
      }
      case "message.complete": {
        const id = String(
          payload.message_id ?? payload.id ?? streamingId ?? "",
        );
        const text = payload.text ?? payload.content;
        const turn = activeTurn();
        let msg =
          (id && turn?.replies.find((m) => m.id === id)) ||
          turn?.replies.find((m) => m.streaming) ||
          null;
        if (typeof text === "string" && text.trim()) {
          if (!msg) {
            msg = ensureStreamingReply(id || crypto.randomUUID());
          }
          msg.content = text;
          msg.streaming = false;
        } else if (msg) {
          msg.streaming = false;
          // Drop empty complete frames so they never become HERMES spacers.
          if (!msg.content.trim()) {
            if (turn) {
              turn.replies = turn.replies.filter((m) => m.id !== msg!.id);
            }
          }
        }
        streamingId = null;
        sending.value = false;
        sealThinking();
        finishTurnActivity("done");
        break;
      }
      case "tool.start": {
        sealThinking();
        const name = toolNameOf(payload);
        upsertActivity({
          id: toolId(payload),
          toolName: name,
          label: activityLabel(name),
          detail: summarizeDetail(
            payload.summary ?? payload.input ?? payload.args ?? payload.path,
          ),
          startedAt: Date.now(),
          status: "running",
        });
        const turn = activeTurn();
        if (turn) turn.running = true;
        break;
      }
      case "tool.complete":
      case "tool.progress": {
        const existing = findActivity(payload);
        const name = toolNameOf(payload);
        const { output, outputBytes } = extractOutput(payload);
        const detail = summarizeDetail(
          payload.summary ??
            payload.input ??
            payload.args ??
            existing?.detail ??
            (typeof payload.command === "string" ? payload.command : undefined),
        );
        upsertActivity({
          id: existing?.id ?? toolId(payload),
          toolName: existing?.toolName ?? name,
          label: existing?.label ?? activityLabel(name),
          detail,
          output: output ?? existing?.output,
          outputBytes: outputBytes ?? existing?.outputBytes,
          startedAt: existing?.startedAt,
          endedAt: event.type === "tool.complete" ? Date.now() : undefined,
          status: event.type === "tool.complete" ? "done" : "running",
        });
        break;
      }
      case "error": {
        error.value = String(
          payload.message ?? payload.error ?? "Gateway error",
        );
        sending.value = false;
        streamingId = null;
        finishTurnActivity("error");
        break;
      }
      case "request.cancel": {
        const cancelId = String(payload.id ?? payload.request_id ?? "");
        if (cancelId) dropPromptById(cancelId);
        break;
      }
      case "approval.cancelled": {
        pendingApprovals.value = [];
        break;
      }
      case "status.update": {
        const kind = String(payload.kind ?? "");
        const text = String(payload.text ?? "").trim();
        if (kind === "compacting" || kind === "compressing") {
          statusLine.value = text || "Compressing conversation…";
        } else if (kind === "compacted" || kind === "ready") {
          statusLine.value = text || null;
          if (kind === "ready" && !text) statusLine.value = null;
        } else if (text) {
          statusLine.value = text;
        }
        break;
      }
      case "session.title": {
        const sessions = useSessionsStore();
        const storedId = String(
          payload.session_id ?? event.session_id ?? "",
        );
        const nextTitle = String(payload.title ?? "").trim();
        if (storedId && nextTitle) {
          sessions.upsertTitle(storedId, nextTitle);
        }
        break;
      }
      default:
        break;
    }
  }

  async function resolveDefaultCwd(): Promise<string | undefined> {
    const gateway = useGatewayStore();
    try {
      const raw = await fsDefaultCwd(gateway.connection);
      if (typeof raw === "string" && raw) return raw;
      if (raw && typeof raw === "object") {
        const obj = raw as Record<string, unknown>;
        const cwd = obj.cwd ?? obj.path;
        if (typeof cwd === "string" && cwd) return cwd;
      }
    } catch {
      // optional
    }
    return undefined;
  }

  async function openSession(storedSessionId: string) {
    ensureListener();
    const gateway = useGatewayStore();
    const sessions = useSessionsStore();
    loadingHistory.value = true;
    error.value = null;
    turns.value = [];
    streamingId = null;
    activeTurnId = null;
    sending.value = false;
    statusLine.value = null;
    clearAllPrompts();

    try {
      const snapshot = await sessions.resume(storedSessionId);
      const fromResume = historyToMessages(snapshot);
      if (fromResume.length > 0) {
        turns.value = messagesToTurns(fromResume);
      } else {
        try {
          const history = await sessions.withLiveSession((sessionId) =>
            gateway.rpc("session.history", { session_id: sessionId }),
          );
          turns.value = messagesToTurns(historyToMessages(history));
        } catch (histErr) {
          if (!sessions.isSessionNotFound(histErr)) {
            error.value =
              histErr instanceof Error ? histErr.message : String(histErr);
          }
        }
      }
    } catch (err) {
      error.value = err instanceof Error ? err.message : String(err);
      // Never bind a dead durable id — that leaves New/Send stuck on ghosts.
      if (sessions.isSessionNotFound(err)) {
        sessions.dropSessionLocally(storedSessionId);
      } else if (sessions.activeId === storedSessionId) {
        sessions.clearActive();
      }
      throw err;
    } finally {
      loadingHistory.value = false;
      renderEpoch.value += 1;
    }
  }

  /** Reload history + remount extractors (after client updates that affect cards). */
  async function reprocessTranscript() {
    const sessions = useSessionsStore();
    const id = sessions.activeId;
    if (!id) {
      renderEpoch.value += 1;
      return;
    }
    try {
      await openSession(id);
    } catch {
      // openSession sets chat.error / drops ghost ids; don't reject the Refresh click.
    }
  }

  /** Local /clear — wipe transcript like Hermes WebUI, keep the same session. */
  async function clearTranscriptLocally() {
    turns.value = [];
    sending.value = false;
    streamingId = null;
    activeTurnId = null;
    error.value = null;
    statusLine.value = null;
    clearAllPrompts();
  }

  async function send(
    text: string,
    attachments: PromptAttachment[] = [],
  ) {
    ensureListener();
    const gateway = useGatewayStore();
    const sessions = useSessionsStore();
    const trimmed = text.trim();
    const { images, files } = partitionAttachments(attachments);
    const hasAttachments = attachments.length > 0;

    // Desktop: attachment-only turns still need a short caption.
    let submitText = trimmed;
    if (!submitText && hasAttachments) {
      submitText =
        images.length && !files.length
          ? "What do you see in this image?"
          : "Please review the attached file(s).";
    }
    if (!submitText) return;
    if (!gateway.isConnected) {
      throw new Error("Gateway not connected");
    }

    // Local slash commands (Desktop parity) — don't echo into the transcript.
    if (/^\/clear(?:\s|$)/i.test(trimmed) && !hasAttachments) {
      await clearTranscriptLocally();
      if (!sessions.activeId) {
        const cwd = await resolveDefaultCwd();
        await sessions.create(cwd);
      }
      try {
        await sessions.withLiveSession(async (sessionId) => {
          await gateway.rpc("prompt.submit", {
            session_id: sessionId,
            text: "/clear",
          });
        });
      } catch {
        // Local clear already applied; gateway may still reject unknown slash.
      }
      return;
    }

    if (/^\/new(?:\s|$)/i.test(trimmed) && !hasAttachments) {
      const cwd = await resolveDefaultCwd();
      await sessions.create(cwd);
      await clearTranscriptLocally();
      return;
    }

    if (/^\/stop(?:\s|$)/i.test(trimmed) && !hasAttachments) {
      await interrupt();
      return;
    }

    if (!sessions.activeId) {
      const cwd = await resolveDefaultCwd();
      await sessions.create(cwd);
    }

    const user: ChatMessage = {
      id: crypto.randomUUID(),
      role: "user",
      content: trimmed || submitText,
      imagePreviews: images
        .map((img) => img.previewUrl)
        .filter((u): u is string => Boolean(u)),
      fileLabels: files.map((f) => f.name),
    };
    const turn: ChatTurn = {
      id: `turn-${user.id}`,
      user,
      activity: [],
      replies: [],
      running: true,
    };
    // Close any previous live turn.
    for (const t of turns.value) {
      if (t.running) {
        t.running = false;
        t.activity = t.activity.map((a) =>
          a.status === "running" ? { ...a, status: "done" as const } : a,
        );
      }
    }
    turns.value.push(turn);
    activeTurnId = turn.id;
    sending.value = true;
    error.value = null;
    streamingId = null;

    try {
      const submissionId = crypto.randomUUID();
      await sessions.withLiveSession(async (sessionId) => {
        // Images → vision queue (Desktop remote). Never send Office/PDF here.
        for (const img of images) {
          await gateway.rpc("image.attach_bytes", {
            session_id: sessionId,
            content_base64: img.contentBase64,
            filename: img.name,
          });
        }

        // Non-images → workspace @file: refs via file.attach.
        const fileRefs: string[] = [];
        for (const file of files) {
          const dataUrl = toDataUrl(file.mime, file.contentBase64);
          const result = (await gateway.rpc("file.attach", {
            session_id: sessionId,
            name: file.name,
            data_url: dataUrl,
          })) as { attached?: boolean; ref_text?: string; message?: string };
          if (!result?.attached || !result.ref_text) {
            throw new Error(
              result?.message || `Could not attach ${file.name}`,
            );
          }
          fileRefs.push(result.ref_text);
        }

        let finalText = submitText;
        if (fileRefs.length) {
          finalText = `${submitText}\n\n${fileRefs.join("\n")}`;
        }
        // Wire-only OpsPilot policy (no tunnels); user bubble stays clean.
        finalText = withPolicyPreamble(sessionId, finalText);

        try {
          await gateway.rpc("prompt.submit", {
            session_id: sessionId,
            text: finalText,
            submission_id: submissionId,
          });
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          if (/submission_id:.*Extra inputs are not permitted/i.test(message)) {
            await gateway.rpc("prompt.submit", {
              session_id: sessionId,
              text: finalText,
            });
          } else {
            throw err;
          }
        }
      });
    } catch (err) {
      sending.value = false;
      turn.running = false;
      error.value = err instanceof Error ? err.message : String(err);
      throw err;
    }
  }

  async function interrupt() {
    const gateway = useGatewayStore();
    const sessions = useSessionsStore();
    if (!sessions.activeId) return;
    try {
      await sessions.withLiveSession((sessionId) =>
        gateway.rpc("session.interrupt", { session_id: sessionId }),
      );
    } catch {
      // ignore
    }
    sending.value = false;
    streamingId = null;
    finishTurnActivity("done");
  }

  function reset() {
    const sessions = useSessionsStore();
    turns.value = [];
    sending.value = false;
    streamingId = null;
    activeTurnId = null;
    error.value = null;
    statusLine.value = null;
    clearAllPrompts();
    sessions.clearActive();
  }

  return {
    turns,
    messages,
    transcriptMessages,
    activity,
    activeActivity,
    latestActivity,
    loadingHistory,
    sending,
    error,
    statusLine,
    renderEpoch,
    pendingApprovals,
    pendingClarify,
    pendingSecrets,
    pendingVaultSaves,
    openSession,
    reprocessTranscript,
    send,
    interrupt,
    reset,
    ensureListener,
    answerApproval,
    clearApproval,
    answerClarify,
    skipClarify,
    answerSecret,
    answerVaultSave,
  };
});
