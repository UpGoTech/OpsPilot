import type { ConnectionConfig, GatewayEvent, GatewayState } from "../../src/types";
import { emit } from "../shims/native-events";
import { resolveWsUrl } from "./auth";
import { filteredExtraHeaders } from "./connection";

type Pending = {
  resolve: (value: unknown) => void;
  reject: (reason: Error) => void;
};

type SiteSocket = {
  siteKey: string;
  socket: WebSocket | null;
  pending: Map<string, Pending>;
  buffer: string;
  requestId: number;
  state: GatewayState;
  detail: string | null;
  config: ConnectionConfig | null;
};

/** Active site the side panel is presenting — RPCs route here. */
let activeSiteKey: string | null = null;
const sockets = new Map<string, SiteSocket>();

function ensureSite(siteKey: string): SiteSocket {
  let entry = sockets.get(siteKey);
  if (!entry) {
    entry = {
      siteKey,
      socket: null,
      pending: new Map(),
      buffer: "",
      requestId: 1,
      state: "idle",
      detail: null,
      config: null,
    };
    sockets.set(siteKey, entry);
  }
  return entry;
}

function emitState(siteKey: string, state: GatewayState, detail?: string | null) {
  const entry = ensureSite(siteKey);
  entry.state = state;
  entry.detail = detail ?? null;
  emit("gateway-state", { siteKey, state, detail: detail ?? null });
}

function rejectAll(entry: SiteSocket, message: string) {
  for (const [, p] of entry.pending) {
    p.reject(new Error(message));
  }
  entry.pending.clear();
}

function handleFrame(entry: SiteSocket, line: string) {
  let frame: Record<string, unknown>;
  try {
    frame = JSON.parse(line) as Record<string, unknown>;
  } catch {
    return;
  }

  const method = typeof frame.method === "string" ? frame.method : null;
  if (
    frame.id != null &&
    method &&
    method !== "event" &&
    !entry.pending.has(String(frame.id))
  ) {
    emit("gateway-server-request", {
      siteKey: entry.siteKey,
      id: String(frame.id),
      method,
      params: (frame.params as Record<string, unknown> | null) ?? null,
    });
    return;
  }

  if (frame.id != null) {
    const key = String(frame.id);
    const waiter = entry.pending.get(key);
    if (!waiter) return;
    entry.pending.delete(key);
    if (frame.error) {
      const err = frame.error as Record<string, unknown>;
      const message =
        typeof err.message === "string" ? err.message : "RPC error";
      const code = err.code != null ? String(err.code) : "";
      const data = err.data != null ? String(err.data) : "";
      let detail = message;
      if (code && data) detail = `${message} (code ${code}): ${data}`;
      else if (code) detail = `${message} (code ${code})`;
      else if (data) detail = `${message}: ${data}`;
      waiter.reject(new Error(detail));
    } else {
      waiter.resolve(frame.result ?? null);
    }
    return;
  }

  if (frame.method === "event") {
    const params = (frame.params ?? {}) as Record<string, unknown>;
    const eventType =
      typeof params.type === "string" ? params.type : "event";
    if (eventType === "gateway.ready") {
      emitState(entry.siteKey, "open");
    }
    const event: GatewayEvent & { siteKey: string } = {
      siteKey: entry.siteKey,
      type: eventType,
      session_id: (params.session_id as string | null | undefined) ?? null,
      payload: (params.payload as Record<string, unknown> | null) ?? null,
      seq: (params.seq as number | null | undefined) ?? null,
    };
    emit("gateway-event", event);
    return;
  }

  if (typeof frame.method === "string") {
    const params = (frame.params ?? {}) as Record<string, unknown>;
    emit("gateway-event", {
      siteKey: entry.siteKey,
      type: frame.method,
      session_id: (params.session_id as string | null | undefined) ?? null,
      payload: params,
    } satisfies GatewayEvent & { siteKey: string });
  }
}

function onMessage(entry: SiteSocket, event: MessageEvent) {
  entry.buffer += typeof event.data === "string" ? event.data : "";
  while (true) {
    const idx = entry.buffer.indexOf("\n");
    if (idx < 0) break;
    const line = entry.buffer.slice(0, idx).trim();
    entry.buffer = entry.buffer.slice(idx + 1);
    if (line) handleFrame(entry, line);
  }
  const trimmed = entry.buffer.trim();
  if (trimmed.startsWith("{") && trimmed.endsWith("}")) {
    handleFrame(entry, trimmed);
    entry.buffer = "";
  }
}

export function getActiveSiteKey(): string | null {
  return activeSiteKey;
}

export function setActiveSiteKey(siteKey: string | null): void {
  activeSiteKey = siteKey?.trim() ? siteKey.trim().toLowerCase() : null;
}

export function getSiteGatewayState(siteKey: string): {
  state: GatewayState;
  detail: string | null;
  connected: boolean;
} {
  const entry = sockets.get(siteKey);
  if (!entry) {
    return { state: "idle", detail: null, connected: false };
  }
  const connected =
    entry.state === "open" &&
    entry.socket != null &&
    entry.socket.readyState === WebSocket.OPEN;
  return { state: entry.state, detail: entry.detail, connected };
}

async function disconnectSite(siteKey: string, emitIdle = true): Promise<void> {
  const entry = sockets.get(siteKey);
  if (!entry) return;
  const ws = entry.socket;
  entry.socket = null;
  rejectAll(entry, "gateway disconnected");
  if (ws) {
    try {
      ws.close();
    } catch {
      // ignore
    }
  }
  if (emitIdle) emitState(siteKey, "idle");
}

export async function gatewayConnect(
  config: ConnectionConfig,
  siteKey?: string,
): Promise<void> {
  const key = (siteKey ?? activeSiteKey ?? "").trim().toLowerCase();
  if (!key) {
    throw new Error("No active OpsPilot site — open a Desk tab with OpsPilot.");
  }
  setActiveSiteKey(key);
  const entry = ensureSite(key);
  await disconnectSite(key, false);
  entry.config = config;
  emitState(key, "connecting");

  const wsUrl = await resolveWsUrl(config);
  await new Promise<void>((resolve, reject) => {
    let settled = false;
    const ws = new WebSocket(wsUrl);
    entry.socket = ws;
    entry.buffer = "";

    void filteredExtraHeaders(config);

    ws.onopen = () => {
      settled = true;
      resolve();
    };
    ws.onerror = () => {
      if (!settled) {
        settled = true;
        reject(new Error("WebSocket connect failed"));
      }
    };
    ws.onmessage = (event) => onMessage(entry, event);
    ws.onclose = () => {
      if (entry.socket === ws) entry.socket = null;
      rejectAll(entry, "gateway connection closed");
      emitState(key, "closed", "Connection closed");
    };
  });
}

/** Disconnect the active site only — other site sockets stay up. */
export async function gatewayDisconnect(siteKey?: string): Promise<void> {
  const key = (siteKey ?? activeSiteKey ?? "").trim().toLowerCase();
  if (!key) {
    emit("gateway-state", { siteKey: "", state: "idle" as GatewayState, detail: null });
    return;
  }
  await disconnectSite(key, true);
}

export async function gatewayDisconnectAll(): Promise<void> {
  const keys = [...sockets.keys()];
  for (const key of keys) {
    await disconnectSite(key, true);
  }
}

function requireActiveSocket(): SiteSocket {
  const key = activeSiteKey;
  if (!key) throw new Error("gateway not connected");
  const entry = sockets.get(key);
  if (!entry?.socket || entry.socket.readyState !== WebSocket.OPEN) {
    throw new Error("gateway not connected");
  }
  return entry;
}

export async function gatewayRpc(
  method: string,
  params: unknown = null,
): Promise<unknown> {
  const entry = requireActiveSocket();
  const id = `r${entry.requestId++}`;
  const frame = {
    jsonrpc: "2.0",
    id,
    method,
    params: params ?? null,
  };
  const payload = `${JSON.stringify(frame)}\n`;

  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      entry.pending.delete(id);
      reject(new Error("gateway request timed out"));
    }, 120_000);
    entry.pending.set(id, {
      resolve: (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      reject: (err) => {
        clearTimeout(timer);
        reject(err);
      },
    });
    try {
      entry.socket!.send(payload);
    } catch (error) {
      entry.pending.delete(id);
      clearTimeout(timer);
      reject(
        error instanceof Error
          ? error
          : new Error(`WebSocket send failed: ${String(error)}`),
      );
    }
  });
}

export async function gatewayRespond(
  id: string,
  result: unknown,
): Promise<void> {
  const entry = requireActiveSocket();
  const frame = {
    jsonrpc: "2.0",
    id,
    result: result ?? null,
  };
  entry.socket!.send(`${JSON.stringify(frame)}\n`);
}

export async function gatewayFail(
  id: string,
  code: number,
  message: string,
): Promise<void> {
  const entry = requireActiveSocket();
  const frame = {
    jsonrpc: "2.0",
    id,
    error: { code, message },
  };
  entry.socket!.send(`${JSON.stringify(frame)}\n`);
}
