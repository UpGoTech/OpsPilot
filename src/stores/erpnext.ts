import { defineStore } from "pinia";
import { computed, ref } from "vue";
import {
  erpnextFetchOpspilotSettings,
  erpnextLogin,
  erpnextLogout,
  getErpnextConfig,
  getErpnextSession,
  saveErpnextConfig,
} from "../lib/tauri";
import type {
  AuthMode,
  ConnectionConfig,
  ErpnextConfig,
  OpsPilotSettingsPayload,
} from "../types";

export type BootPhase =
  | "loading"
  | "needs_url"
  | "needs_login"
  | "connecting"
  | "ready"
  | "error";

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

export function settingsToConnection(
  settings: OpsPilotSettingsPayload,
): ConnectionConfig {
  const mode = settings.authMode?.trim().toLowerCase();
  const authMode: AuthMode = mode === "token" ? "token" : "password";
  return {
    ...emptyConnection(),
    url: settings.gatewayUrl ?? "",
    authMode,
    username: settings.gatewayUsername ?? "",
    password: settings.gatewayPassword ?? "",
    token: authMode === "token" ? settings.sessionToken ?? "" : "",
    extraHeaders: settings.extraHeaders ?? {},
  };
}

export const useErpnextStore = defineStore("erpnext", () => {
  const siteUrl = ref("");
  const loggedIn = ref(false);
  const user = ref("");
  const fullName = ref("");
  const bootPhase = ref<BootPhase>("loading");
  const lastError = ref<string | null>(null);
  const settingsMissing = ref(false);

  const hasSiteUrl = computed(() => Boolean(siteUrl.value.trim()));
  const displayName = computed(
    () => fullName.value.trim() || user.value.trim() || "",
  );

  async function load() {
    lastError.value = null;
    settingsMissing.value = false;
    const config = await getErpnextConfig();
    siteUrl.value = config.siteUrl ?? "";
    const session = await getErpnextSession();
    loggedIn.value = session.loggedIn;
    user.value = session.user ?? "";
    fullName.value = session.fullName ?? "";
    if (!siteUrl.value.trim()) {
      bootPhase.value = "needs_url";
    } else if (!loggedIn.value) {
      bootPhase.value = "needs_login";
    } else {
      bootPhase.value = "connecting";
    }
  }

  async function saveSiteUrl(url: string) {
    lastError.value = null;
    const previous = siteUrl.value.trim();
    const saved = await saveErpnextConfig({ siteUrl: url.trim() });
    siteUrl.value = saved.siteUrl ?? "";
    const next = siteUrl.value.trim();
    const siteChanged = previous !== next;
    if (siteChanged || !next) {
      loggedIn.value = false;
      user.value = "";
      fullName.value = "";
      settingsMissing.value = false;
      bootPhase.value = next ? "needs_login" : "needs_url";
    } else if (bootPhase.value === "needs_url") {
      // Left the URL gate without changing the site.
      bootPhase.value = loggedIn.value ? "connecting" : "needs_login";
    }
    return saved;
  }

  async function login(usr: string, pwd: string) {
    lastError.value = null;
    settingsMissing.value = false;
    const session = await erpnextLogin(usr, pwd);
    loggedIn.value = session.loggedIn;
    user.value = session.user ?? "";
    fullName.value = session.fullName ?? "";
    if (session.siteUrl) {
      siteUrl.value = session.siteUrl;
    }
    bootPhase.value = "connecting";
    return session;
  }

  async function logout() {
    try {
      await erpnextLogout();
    } catch {
      // Still clear local session state.
    }
    loggedIn.value = false;
    user.value = "";
    fullName.value = "";
    settingsMissing.value = false;
    lastError.value = null;
    bootPhase.value = siteUrl.value.trim() ? "needs_login" : "needs_url";
  }

  async function fetchSettings(): Promise<ConnectionConfig | null> {
    lastError.value = null;
    settingsMissing.value = false;
    try {
      const settings = await erpnextFetchOpspilotSettings();
      if (!settings || !settings.gatewayUrl?.trim()) {
        settingsMissing.value = true;
        bootPhase.value = "error";
        lastError.value =
          "No OpsPilot Settings found for your user in ERPNext. Ask an admin to create an OpsPilot Settings document for your account.";
        return null;
      }
      return settingsToConnection(settings);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      lastError.value = message;
      if (/session expired|Not logged|sign in again/i.test(message)) {
        loggedIn.value = false;
        bootPhase.value = "needs_login";
      } else {
        bootPhase.value = "error";
      }
      throw error;
    }
  }

  function markReady() {
    bootPhase.value = "ready";
    lastError.value = null;
  }

  function markConnecting() {
    bootPhase.value = "connecting";
  }

  function markError(message: string) {
    bootPhase.value = "error";
    lastError.value = message;
  }

  function openUrlSettings() {
    bootPhase.value = "needs_url";
  }

  function markNeedsLogin() {
    bootPhase.value = "needs_login";
  }

  return {
    siteUrl,
    loggedIn,
    user,
    fullName,
    bootPhase,
    lastError,
    settingsMissing,
    hasSiteUrl,
    displayName,
    load,
    saveSiteUrl,
    login,
    logout,
    fetchSettings,
    markReady,
    markConnecting,
    markError,
    markNeedsLogin,
    openUrlSettings,
  };
});

export type { ErpnextConfig };
