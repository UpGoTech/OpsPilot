import { defineStore } from "pinia";
import { computed, ref } from "vue";
import { activityLabel, summarizeDetail } from "../lib/activityLabels";
import { classifyAttachment, toDataUrl } from "../lib/attachments";
import { fsDefaultCwd } from "../lib/tauri";
import { useGatewayStore } from "./gateway";
import { useSessionsStore } from "./sessions";
import type {
  AgentActivity,
  PromptAttachment,
  ChatMessage,
  ChatTurn,
  GatewayEvent,
} from "../types";

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
  let streamingId: string | null = null;
  let activeTurnId: string | null = null;
  let unsub: (() => void) | null = null;

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

    // HTML previews are tied to a live reply — don't carry/reopen them across history picks.
    try {
      const { useCenterTabsStore } = await import("./centerTabs");
      await useCenterTabsStore().clearHtmlTabs();
    } catch {
      // ignore
    }

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
      sessions.bindActive(storedSessionId, null);
    } finally {
      loadingHistory.value = false;
    }
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
    openSession,
    send,
    interrupt,
    reset,
    ensureListener,
  };
});
