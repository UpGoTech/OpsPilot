import { defineStore } from "pinia";
import { computed, ref } from "vue";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import {
  gatewayConnect,
  gatewayDisconnect,
  gatewayRpc,
  getConnection,
  passwordLogin,
  probeAuth,
  saveConnection,
  testConnection,
} from "../lib/tauri";
import type {
  AuthMode,
  AuthProbe,
  ConnectionConfig,
  GatewayEvent,
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
  /** Allowed `session.create` param names from `runtime.describe`, if known. */
  const sessionCreateParams = ref<Set<string> | null>(null);
  let unlistenState: UnlistenFn | null = null;
  let unlistenEvent: UnlistenFn | null = null;
  const eventHandlers = new Set<(event: GatewayEvent) => void>();

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

  async function initListeners() {
    if (!unlistenState) {
      unlistenState = await listen<GatewayStateEvent>("gateway-state", (event) => {
        state.value = event.payload.state;
        detail.value = event.payload.detail ?? null;
        if (event.payload.state !== "open") {
          ready.value = false;
          sessionCreateParams.value = null;
        }
        if (event.payload.state === "open" || event.payload.state === "connecting") {
          // Drop stale disconnect copy once we're recovering / healthy.
          lastError.value = null;
        } else if (
          event.payload.state === "error" ||
          event.payload.state === "closed"
        ) {
          lastError.value = event.payload.detail ?? "Disconnected";
        }
      });
    }
    if (!unlistenEvent) {
      unlistenEvent = await listen<GatewayEvent>("gateway-event", (event) => {
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
  }

  async function load() {
    await initListeners();
    connection.value = { ...emptyConnection(), ...(await getConnection()) };
  }

  async function save(next: ConnectionConfig) {
    connection.value = await saveConnection({
      ...emptyConnection(),
      ...next,
      password: "",
    });
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
    lastError.value = null;
    ready.value = false;
    const config = next ?? connection.value;
    connection.value = config;
    try {
      await gatewayConnect(config);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      lastError.value = message;
      state.value = "error";
      detail.value = message;
      throw error;
    }
  }

  async function disconnect() {
    await gatewayDisconnect();
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
    sessionCreateParams,
    isConnected,
    isSignedIn,
    isConfigured,
    onEvent,
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
