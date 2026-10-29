import { defineStore } from "pinia";
import { ref } from "vue";
import { useGatewayStore } from "./gateway";
import type { SessionSummary } from "../types";

function pickString(...values: unknown[]): string {
  for (const value of values) {
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return "";
}

function asSessions(raw: unknown): SessionSummary[] {
  if (Array.isArray(raw)) {
    return raw.map(normalizeSession).filter(Boolean) as SessionSummary[];
  }
  if (raw && typeof raw === "object") {
    const obj = raw as Record<string, unknown>;
    const list = obj.sessions ?? obj.items ?? obj.data;
    if (Array.isArray(list)) {
      return list.map(normalizeSession).filter(Boolean) as SessionSummary[];
    }
  }
  return [];
}

/**
 * Sidebar identity must be the durable stored id. Live/runtime ids go stale
 * after gateway restart and then resume/history return 4001.
 */
function normalizeSession(item: unknown): SessionSummary | null {
  if (!item || typeof item !== "object") return null;
  const row = item as Record<string, unknown>;
  const stored = pickString(
    row.stored_session_id,
    row.storedSessionId,
    row.session_key,
    row.sessionKey,
    row.id,
    row.session_id,
    row.sessionId,
  );
  if (!stored) return null;
  const live = pickString(row.session_id, row.sessionId, row.id);
  const pinned =
    row.pinned === true ||
    row.pinned === 1 ||
    row.pinned === "true" ||
    row.is_pinned === true;
  return {
    ...row,
    id: stored,
    liveId: live && live !== stored ? live : undefined,
    title: pickString(row.title, row.name) || "Untitled",
    updated_at: pickString(row.updated_at, row.updatedAt) || undefined,
    created_at: pickString(row.created_at, row.createdAt) || undefined,
    started_at: row.started_at as number | string | undefined,
    preview: typeof row.preview === "string" ? row.preview : undefined,
    source: typeof row.source === "string" ? row.source : undefined,
    pinned,
  };
}

function isSessionNotFound(err: unknown): boolean {
  const message = err instanceof Error ? err.message : String(err);
  return /session not found|not in memory|no longer live|code 4001|code 4007/i.test(
    message,
  );
}

const PINNED_KEY = "opspilot.pinnedSessions";

function loadPinnedIds(): string[] {
  try {
    const raw = localStorage.getItem(PINNED_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.map(String) : [];
  } catch {
    return [];
  }
}

function savePinnedIds(ids: string[]) {
  try {
    localStorage.setItem(PINNED_KEY, JSON.stringify(ids));
  } catch {
    // ignore quota
  }
}

export const useSessionsStore = defineStore("sessions", () => {
  const sessions = ref<SessionSummary[]>([]);
  /** Durable id highlighted in the sidebar. */
  const activeId = ref<string | null>(null);
  /** Live runtime id for prompt/history/interrupt after resume. */
  const liveId = ref<string | null>(null);
  /** Local + adopted pin set (Desktop sidebar pins). */
  const pinnedIds = ref<string[]>(loadPinnedIds());
  const loading = ref(false);
  const error = ref<string | null>(null);

  function syncPinsFromBackend(rows: SessionSummary[]) {
    const next = new Set(pinnedIds.value);
    for (const row of rows) {
      if (row.pinned) next.add(row.id);
    }
    pinnedIds.value = [...next];
    savePinnedIds(pinnedIds.value);
  }

  async function refresh() {
    const gateway = useGatewayStore();
    if (!gateway.isConnected) {
      error.value = "Gateway not connected";
      return;
    }
    loading.value = true;
    error.value = null;
    try {
      // Prefer stored history (all sources: gui, messaging, cron, api…).
      let result: unknown;
      try {
        result = await gateway.rpc("session.list", {
          limit: 500,
          scope: "stored",
        });
      } catch {
        result = await gateway.rpc("session.list", { limit: 500 });
      }
      sessions.value = asSessions(result);
      syncPinsFromBackend(sessions.value);
    } catch (err) {
      error.value = err instanceof Error ? err.message : String(err);
    } finally {
      loading.value = false;
    }
  }

  async function togglePin(sessionId: string) {
    const isPinned = pinnedIds.value.includes(sessionId);
    const next = isPinned
      ? pinnedIds.value.filter((id) => id !== sessionId)
      : [sessionId, ...pinnedIds.value.filter((id) => id !== sessionId)];
    pinnedIds.value = next;
    savePinnedIds(next);

    // Best-effort durable pin on the gateway (Desktop syncs the same flag).
    const gateway = useGatewayStore();
    if (!gateway.isConnected) return;
    try {
      if (isPinned) {
        try {
          await gateway.rpc("session.unpin", { session_id: sessionId });
        } catch {
          await gateway.rpc("session.update", {
            session_id: sessionId,
            pinned: false,
          });
        }
      } else {
        try {
          await gateway.rpc("session.pin", { session_id: sessionId });
        } catch {
          await gateway.rpc("session.update", {
            session_id: sessionId,
            pinned: true,
          });
        }
      }
    } catch {
      // Local pin still applies if the daemon has no pin RPC yet.
    }
  }

  function isPinned(sessionId: string) {
    return pinnedIds.value.includes(sessionId);
  }

  async function removeSession(sessionId: string) {
    const gateway = useGatewayStore();
    if (!gateway.isConnected) {
      throw new Error("Gateway not connected");
    }
    try {
      await gateway.rpc("session.delete", { session_id: sessionId });
    } catch (err) {
      // Some builds use remove / archive as soft-delete.
      try {
        await gateway.rpc("session.remove", { session_id: sessionId });
      } catch {
        try {
          await gateway.rpc("session.archive", {
            session_id: sessionId,
            archived: true,
          });
        } catch {
          throw err;
        }
      }
    }
    sessions.value = sessions.value.filter((s) => s.id !== sessionId);
    pinnedIds.value = pinnedIds.value.filter((id) => id !== sessionId);
    savePinnedIds(pinnedIds.value);
    if (activeId.value === sessionId) {
      activeId.value = null;
      liveId.value = null;
    }
  }

  function bindActive(stored: string, live?: string | null) {
    activeId.value = stored;
    liveId.value = live || stored;
    sessions.value = sessions.value.map((s) =>
      s.id === stored
        ? { ...s, liveId: live && live !== stored ? live : s.liveId }
        : s,
    );
  }

  /**
   * Attach to a durable session. Returns resume snapshot (may include messages).
   */
  async function resume(storedSessionId: string): Promise<Record<string, unknown>> {
    const gateway = useGatewayStore();
    if (!gateway.isConnected) {
      throw new Error("Gateway not connected");
    }

    let result: Record<string, unknown>;
    try {
      result = await gateway.rpc<Record<string, unknown>>("session.resume", {
        session_id: storedSessionId,
      });
    } catch (err) {
      // Older / live-only paths.
      try {
        result = await gateway.rpc<Record<string, unknown>>("session.activate", {
          session_id: storedSessionId,
        });
      } catch {
        throw err;
      }
    }

    const resumedLive = pickString(
      result.session_id,
      result.stored_session_id,
      (result.info as Record<string, unknown> | undefined)?.session_id,
      storedSessionId,
    );
    bindActive(storedSessionId, resumedLive || storedSessionId);
    return result;
  }

  async function create(cwd?: string) {
    const gateway = useGatewayStore();
    if (!gateway.isConnected) {
      throw new Error("Gateway not connected");
    }

    const allowed = await gateway.sessionCreateAllowedParams();
    const params: Record<string, unknown> = {};
    if (!allowed || allowed.has("source")) params.source = "gui";
    if (cwd && (!allowed || allowed.has("cwd"))) params.cwd = cwd;
    if (allowed?.has("request_id")) {
      params.request_id = crypto.randomUUID();
    }

    let result: Record<string, unknown>;
    try {
      result = await gateway.rpc<Record<string, unknown>>("session.create", params);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      const isExtra =
        /Extra inputs are not permitted|invalid_params|invalid params/i.test(
          message,
        );
      if (!isExtra) throw err;

      const stripped = { ...params };
      let changed = false;
      for (const key of Object.keys(stripped)) {
        if (
          message.includes(`${key}:`) ||
          message.includes(`"${key}"`) ||
          message.includes(`'${key}'`)
        ) {
          delete stripped[key];
          changed = true;
        }
      }
      result = await gateway.rpc<Record<string, unknown>>(
        "session.create",
        changed ? stripped : {},
      );
    }

    const session =
      normalizeSession(result) ??
      normalizeSession({
        id: result?.stored_session_id ?? result?.session_id ?? result?.id,
        stored_session_id: result?.stored_session_id,
        session_id: result?.session_id,
        title: (result?.title as string) || "New chat",
        source: "gui",
      });
    if (!session?.id) {
      throw new Error(
        `session.create returned no session id: ${JSON.stringify(result)}`,
      );
    }
    sessions.value = [
      session,
      ...sessions.value.filter((s) => s.id !== session.id),
    ];

    // Create already attaches on many backends; still resume so we own a live id.
    try {
      await resume(session.id);
    } catch {
      bindActive(session.id, session.liveId ?? session.id);
    }
    return sessions.value.find((s) => s.id === session.id) ?? session;
  }

  /** Prefer live runtime id for in-flight RPCs; fall back to stored. */
  function rpcSessionId(): string | null {
    return liveId.value || activeId.value;
  }

  /**
   * Run a session-scoped RPC; on 4001 resume the stored id once and retry.
   */
  async function withLiveSession<T>(
    run: (sessionId: string) => Promise<T>,
  ): Promise<T> {
    const stored = activeId.value;
    const first = rpcSessionId();
    if (!first) throw new Error("No active session");
    try {
      return await run(first);
    } catch (err) {
      if (!stored || !isSessionNotFound(err)) throw err;
      const snapshot = await resume(stored);
      const next =
        pickString(snapshot.session_id, snapshot.stored_session_id) || stored;
      bindActive(stored, next);
      return await run(next);
    }
  }

  function upsertTitle(sessionId: string, title: string) {
    sessions.value = sessions.value.map((s) =>
      s.id === sessionId ? { ...s, title } : s,
    );
  }

  function clearActive() {
    activeId.value = null;
    liveId.value = null;
  }

  return {
    sessions,
    activeId,
    liveId,
    pinnedIds,
    loading,
    error,
    refresh,
    create,
    resume,
    rpcSessionId,
    withLiveSession,
    bindActive,
    clearActive,
    upsertTitle,
    togglePin,
    isPinned,
    removeSession,
    isSessionNotFound,
  };
});
