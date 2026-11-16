import type { ConnectionConfig, GatewayEvent, GatewayState } from "../../src/types";
import { emit } from "../shims/tauri-event";
import { resolveWsUrl } from "./auth";
import { filteredExtraHeaders } from "./connection";

type Pending = {
  resolve: (value: unknown) => void;
  reject: (reason: Error) => void;
};

let socket: WebSocket | null = null;
let requestId = 1;
const pending = new Map<string, Pending>();
let buffer = "";

function emitState(state: GatewayState, detail?: string | null) {
  emit("gateway-state", { state, detail: detail ?? null });
}

function rejectAll(message: string) {
  for (const [, p] of pending) {
    p.reject(new Error(message));
  }
  pending.clear();
}

function handleFrame(line: string) {
  let frame: Record<string, unknown>;
  try {
    frame = JSON.parse(line) as Record<string, unknown>;
  } catch {
    return;
  }

  if (frame.id != null) {
    const key = String(frame.id);
    const waiter = pending.get(key);
    if (!waiter) return;
    pending.delete(key);
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
      emitState("open");
    }
    const event: GatewayEvent = {
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
      type: frame.method,
      session_id: (params.session_id as string | null | undefined) ?? null,
      payload: params,
    } satisfies GatewayEvent);
  }
}

function onMessage(event: MessageEvent) {
  buffer += typeof event.data === "string" ? event.data : "";
  while (true) {
    const idx = buffer.indexOf("\n");
    if (idx < 0) break;
    const line = buffer.slice(0, idx).trim();
    buffer = buffer.slice(idx + 1);
    if (line) handleFrame(line);
  }
  const trimmed = buffer.trim();
  if (trimmed.startsWith("{") && trimmed.endsWith("}")) {
    handleFrame(trimmed);
    buffer = "";
  }
}

export async function gatewayConnect(config: ConnectionConfig): Promise<void> {
  await gatewayDisconnect();
  emitState("connecting");

  const wsUrl = await resolveWsUrl(config);
  await new Promise<void>((resolve, reject) => {
    let settled = false;
    const ws = new WebSocket(wsUrl);
    socket = ws;
    buffer = "";

    // Extra headers cannot be set on browser WebSocket; ticket/token is in the URL.
    // Proxied gateways that require custom headers beyond ticket/token need desktop.
    void filteredExtraHeaders(config);

    ws.onopen = () => {
      // Stay connecting until gateway.ready (Desktop behavior).
      settled = true;
      resolve();
    };
    ws.onerror = () => {
      if (!settled) {
        settled = true;
        reject(new Error("WebSocket connect failed"));
      }
    };
    ws.onmessage = onMessage;
    ws.onclose = () => {
      if (socket === ws) socket = null;
      rejectAll("gateway connection closed");
      emitState("closed", "Connection closed");
    };
  });
}

export async function gatewayDisconnect(): Promise<void> {
  const ws = socket;
  socket = null;
  rejectAll("gateway disconnected");
  if (ws) {
    try {
      ws.close();
    } catch {
      // ignore
    }
  }
  emitState("idle");
}

export async function gatewayRpc(
  method: string,
  params: unknown = null,
): Promise<unknown> {
  const ws = socket;
  if (!ws || ws.readyState !== WebSocket.OPEN) {
    throw new Error("gateway not connected");
  }
  const id = `r${requestId++}`;
  const frame = {
    jsonrpc: "2.0",
    id,
    method,
    params: params ?? null,
  };
  const payload = `${JSON.stringify(frame)}\n`;

  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      pending.delete(id);
      reject(new Error("gateway request timed out"));
    }, 120_000);
    pending.set(id, {
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
      ws.send(payload);
    } catch (error) {
      pending.delete(id);
      clearTimeout(timer);
      reject(
        error instanceof Error
          ? error
          : new Error(`WebSocket send failed: ${String(error)}`),
      );
    }
  });
}
