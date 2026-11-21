import { defineStore } from "pinia";
import { computed, ref } from "vue";
import { listen, type UnlistenFn } from "@opspilot/native-events";
import {
  gatewayConnect,
  gatewayDisconnect,
  gatewayFail,
  gatewayRespond,
  gatewayRpc,
  getActiveSiteKey,
  getConnection,
  passwordLogin,
  probeAuth,
  saveConnection,
  testConnection,
} from "../lib/native";
import type {
  AuthMode,
  AuthProbe,
  ConnectionConfig,
  GatewayEvent,
  GatewayServerRequest,
  GatewayState,
  GatewayStateEvent,
} from "../types";

function emptyConnection(): ConnectionConfig {
  return {
    name: "",
    url: "",
    token: "",
    authMode: "password",
    username: "",
    password: "",
    cookies: {},
    extraHeaders: {},
  };
}

export const useGatewayStore = defineStore("gateway", () => {
  const connection = ref<ConnectionConfig>(emptyConnection());
  const authProbe = ref<AuthProbe | null>(null);
  const state = ref<GatewayState>("idle");
  const detail = ref<string | null>(null);
  const lastError = ref<string | null>(null);
  const ready = ref(false);
  /** Hostname key for the site the side panel is presenting. */
  const activeSiteKey = ref<string | null>(null);
  /** Allowed `session.create` param names from `runtime.describe`, if known. */
  const sessionCreateParams = ref<Set<string> | null>(null);
  let unlistenState: UnlistenFn | null = null;
  let unlistenEvent: UnlistenFn | null = null;
  let unlistenServerRequest: UnlistenFn | null = null;
  const eventHandlers = new Set<(event: GatewayEvent) => void>();
  const serverRequestHandlers = new Set<(req: GatewayServerRequest) => void>();
  let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  let reconnectAttempt = 0;
  let reconnectEnabled = false;

  function eventMatchesActiveSite(siteKey?: string | null): boolean {
    if (!activeSiteKey.value) return !siteKey;
    if (!siteKey) return true;
    return siteKey.toLowerCase() === activeSiteKey.value.toLowerCase();
  }

  function parseSessionCreateParams(describe: unknown): Set<string> | null {
    if (!describe || typeof describe !== "object") return null;
    const root = describe as Record<string, unknown>;
    const contract =
      (root.session_create as Record<string, unknown> | undefined) ??
      ((root.capabilities as Record<string, unknown> | undefined)
        ?.session_create as Record<string, unknown> | undefined) ??
      root;
    const raw =
      contract.parameters ??
      contract.params ??
      (root.session_create as Record<string, unknown> | undefined)?.parameters;
    if (Array.isArray(raw)) {
      return new Set(raw.map(String));
    }
    if (raw && typeof raw === "object") {
      return new Set(Object.keys(raw as Record<string, unknown>));
    }
    return null;
  }

  async function refreshRuntimeContract() {
    try {
      const describe = await gatewayRpc("runtime.describe", {});
      sessionCreateParams.value = parseSessionCreateParams(describe);
    } catch {
      sessionCreateParams.value = null;
    }
  }

  async function sessionCreateAllowedParams(): Promise<Set<string> | null> {
    if (!sessionCreateParams.value) {
      await refreshRuntimeContract();
    }
    return sessionCreateParams.value;
  }

  const isConnected = computed(() => state.value === "open");
  const isSignedIn = computed(() => {
    const cookies = connection.value.cookies ?? {};
    const hasSessionCookie = Object.keys(cookies).some((name) => {
      const bare = name.replace(/^__(?:Host|Secure)-/, "");
      return (
        bare === "hermes_session_at" ||
        bare.startsWith("hermes_session_at_") ||
        bare === "hermes_session_rt" ||
        bare.startsWith("hermes_session_rt_")
      );
    });
    return Boolean(hasSessionCookie || connection.value.token?.trim());
  });
  const isConfigured = computed(() => Boolean(connection.value.url.trim() && isSignedIn.value));

  function onEvent(handler: (event: GatewayEvent) => void) {
    eventHandlers.add(handler);
    return () => eventHandlers.delete(handler);
  }

  function onServerRequest(handler: (req: GatewayServerRequest) => void) {
    serverRequestHandlers.add(handler);
    return () => serverRequestHandlers.delete(handler);
  }

  async function respondServerRequest(id: string, result: unknown) {
    await gatewayRespond(id, result);
  }

  async function failServerRequest(id: string, code = -32601, message = "Method not found") {
    await gatewayFail(id, code, message);
  }

  function clearReconnectTimer() {
    if (reconnectTimer) {
      clearTimeout(reconnectTimer);
      reconnectTimer = null;
    }
  }

  function scheduleReconnect() {
    if (!reconnectEnabled || !isConfigured.value) return;
    clearReconnectTimer();
    const delay = Math.min(30_000, 1_000 * 2 ** Math.min(reconnectAttempt, 4));
    reconnectAttempt += 1;
    lastError.value = `Reconnecting in ${Math.round(delay / 1000)}s…`;
    reconnectTimer = setTimeout(() => {
      void connect(connection.value).catch(() => {
        scheduleReconnect();
      });
    }, delay);
  }

  async function initListeners() {
    if (!unlistenState) {
      unlistenState = await listen<GatewayStateEvent>("gateway-state", (event) => {
        if (!eventMatchesActiveSite(event.payload.siteKey)) return;
        state.value = event.payload.state;
        detail.value = event.payload.detail ?? null;
        if (event.payload.state !== "open") {
          ready.value = false;
          sessionCreateParams.value = null;
        }
        if (event.payload.state === "open" || event.payload.state === "connecting") {
          // Drop stale disconnect copy once we're recovering / healthy.
          lastError.value = null;
          if (event.payload.state === "open") {
            reconnectAttempt = 0;
            clearReconnectTimer();
          }
        } else if (
          event.payload.state === "error" ||
          event.payload.state === "closed"
        ) {
          lastError.value = event.payload.detail ?? "Disconnected";
          if (reconnectEnabled) scheduleReconnect();
        }
      });
    }
    if (!unlistenEvent) {
      unlistenEvent = await listen<GatewayEvent>("gateway-event", (event) => {
        if (!eventMatchesActiveSite(event.payload.siteKey)) return;
        if (event.payload.type === "gateway.ready") {
          ready.value = true;
          // Desktop advertises that this client answers server→client requests.
          void gatewayRpc("client.capabilities", {
            server_requests: true,
          })
            .catch(() => undefined)
            .then(() => refreshRuntimeContract());
        }
        for (const handler of eventHandlers) {
          handler(event.payload);
        }
      });
    }
    if (!unlistenServerRequest) {
      unlistenServerRequest = await listen<GatewayServerRequest>(
        "gateway-server-request",
        (event) => {
          if (!eventMatchesActiveSite(event.payload.siteKey)) return;
          for (const handler of serverRequestHandlers) {
            handler(event.payload);
          }
        },
      );
    }
  }

  async function setActiveSite(siteKey: string | null) {
    activeSiteKey.value = siteKey?.trim()
      ? siteKey.trim().toLowerCase()
      : null;
    // Soft UI reset — native sockets for other sites stay alive.
    state.value = "idle";
    detail.value = null;
    ready.value = false;
    lastError.value = null;
    sessionCreateParams.value = null;
    connection.value = emptyConnection();
    if (activeSiteKey.value) {
      connection.value = {
        ...emptyConnection(),
        ...(await getConnection(activeSiteKey.value)),
      };
    }
  }

  async function load() {
    await initListeners();
    const key = activeSiteKey.value ?? (await getActiveSiteKey());
    if (key) activeSiteKey.value = key;
    connection.value = {
      ...emptyConnection(),
      ...(await getConnection(activeSiteKey.value ?? undefined)),
    };
  }

  async function save(next: ConnectionConfig) {
    connection.value = await saveConnection(
      {
        ...emptyConnection(),
        ...next,
        password: "",
      },
      activeSiteKey.value ?? undefined,
    );
  }

  async function probe(next?: ConnectionConfig, preserveAuthMode = true) {
    const config = next ?? connection.value;
    const previousMode = config.authMode;
    authProbe.value = await probeAuth(config);
    const suggested = authProbe.value.authMode;
    const authMode: AuthMode =
      preserveAuthMode && (previousMode === "token" || previousMode === "password")
        ? previousMode
        : suggested;

    connection.value = {
      ...connection.value,
      ...config,
      url: authProbe.value.normalizedUrl || config.url,
      authMode,
    };
    return authProbe.value;
  }

  async function signIn(next: ConnectionConfig) {
    const signed = await passwordLogin(next);
    connection.value = {
      ...emptyConnection(),
      ...signed,
      password: "",
      authMode: "password",
    };
    return signed;
  }

  async function test(next?: ConnectionConfig) {
    return testConnection(next ?? connection.value);
  }

  async function connect(next?: ConnectionConfig) {
    await initListeners();
    clearReconnectTimer();
    lastError.value = null;
    ready.value = false;
    const config = next ?? connection.value;
    connection.value = config;
    reconnectEnabled = true;
    try {
      await gatewayConnect(config, activeSiteKey.value ?? undefined);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      lastError.value = message;
      state.value = "error";
      detail.value = message;
      if (reconnectEnabled) scheduleReconnect();
      throw error;
    }
  }

  async function disconnect() {
    reconnectEnabled = false;
    clearReconnectTimer();
    await gatewayDisconnect(activeSiteKey.value ?? undefined);
    ready.value = false;
    sessionCreateParams.value = null;
  }

  async function rpc<T = unknown>(method: string, params?: unknown) {
    return gatewayRpc<T>(method, params);
  }

  return {
    connection,
    authProbe,
    state,
    detail,
    lastError,
    ready,
    activeSiteKey,
    sessionCreateParams,
    isConnected,
    isSignedIn,
    isConfigured,
    onEvent,
    onServerRequest,
    respondServerRequest,
    failServerRequest,
    setActiveSite,
    load,
    save,
    probe,
    signIn,
    test,
    connect,
    disconnect,
    rpc,
    sessionCreateAllowedParams,
  };
});
