import { defineStore } from "pinia";
import { computed, ref } from "vue";
import {
  erpnextActivateSite,
  erpnextAdoptBrowserSession,
  erpnextFetchOpspilotSettings,
  erpnextLogin,
  erpnextLogout,
  erpnextProbeSupport,
  getErpnextConfig,
  getErpnextSession,
  saveErpnextConfig,
} from "../lib/native";
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

/** Classifies boot errors for the gate UI. */
export type AccessErrorKind =
  | "none"
  | "unsupported_site"
  | "not_permitted"
  | "other";

const UNSUPPORTED_RE = /does not support OpsPilot/i;
const NOT_PERMITTED_RE = /not permitted to use AI/i;

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
  const lastUsername = ref("");
  const loggedIn = ref(false);
  const user = ref("");
  const fullName = ref("");
  const bootPhase = ref<BootPhase>("loading");
  const lastError = ref<string | null>(null);
  const accessError = ref<AccessErrorKind>("none");
  /** Shown on the connecting gate. */
  const connectStatus = ref("Starting…");
  const connectDetail = ref("");
  const connectProgress = ref(0);

  const hasSiteUrl = computed(() => Boolean(siteUrl.value.trim()));
  const displayName = computed(
    () => fullName.value.trim() || user.value.trim() || "",
  );

  function classifyAccessError(message: string): AccessErrorKind {
    if (UNSUPPORTED_RE.test(message)) return "unsupported_site";
    if (NOT_PERMITTED_RE.test(message)) return "not_permitted";
    return "other";
  }

  function clearAccessError() {
    lastError.value = null;
    accessError.value = "none";
  }

  async function load() {
    clearAccessError();
    const config = await getErpnextConfig();
    siteUrl.value = config.siteUrl ?? "";
    lastUsername.value = config.lastUsername ?? "";
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

  async function rememberUsername(usr: string) {
    const next = usr.trim();
    lastUsername.value = next;
    await saveErpnextConfig({
      siteUrl: siteUrl.value.trim(),
      lastUsername: next,
    });
  }

  async function saveSiteUrl(url: string) {
    clearAccessError();
    const previous = siteUrl.value.trim();
    const saved = await saveErpnextConfig({
      siteUrl: url.trim(),
      lastUsername: lastUsername.value.trim(),
    });
    siteUrl.value = saved.siteUrl ?? "";
    lastUsername.value = saved.lastUsername ?? lastUsername.value;
    const next = siteUrl.value.trim();
    const siteChanged = previous !== next;
    if (siteChanged || !next) {
      loggedIn.value = false;
      user.value = "";
      fullName.value = "";
      bootPhase.value = next ? "needs_login" : "needs_url";
    } else if (bootPhase.value === "needs_url") {
      // Left the URL gate without changing the site.
      bootPhase.value = loggedIn.value ? "connecting" : "needs_login";
    }
    return saved;
  }

  /** Fast check (no login). Sets error phase when the site lacks opspilot_frappe. */
  async function probeSupport(): Promise<boolean> {
    if (!siteUrl.value.trim()) {
      return false;
    }
    try {
      const ok = await erpnextProbeSupport();
      if (!ok) {
        bootPhase.value = "error";
        accessError.value = "unsupported_site";
        lastError.value = `This site does not support OpsPilot (${siteUrl.value}). Install the OpsPilot app on this site.`;
        return false;
      }
      return true;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (UNSUPPORTED_RE.test(message) || /not installed/i.test(message)) {
        bootPhase.value = "error";
        accessError.value = "unsupported_site";
        lastError.value = message;
        return false;
      }
      // Network blip — don't block login; connect path will re-check.
      return true;
    }
  }

  async function login(usr: string, pwd: string) {
    clearAccessError();
    // Persist username even if password fails — saves retyping next launch.
    try {
      await rememberUsername(usr);
    } catch {
      // Non-fatal.
    }
    // Step 1: authenticate only. Stay on the login screen until this returns.
    // Connecting gate is opened by App after success (avoids "Starting… 0%" stall).
    const session = await erpnextLogin(usr, pwd);
    loggedIn.value = session.loggedIn;
    user.value = session.user ?? "";
    fullName.value = session.fullName ?? "";
    if (session.siteUrl) {
      siteUrl.value = session.siteUrl;
    }
    return session;
  }

  /** Bind Pinia to a Desk site (hostname) without logging in yet. */
  async function activateSite(url: string) {
    const key = await erpnextActivateSite(url);
    siteUrl.value = url.trim();
    return key;
  }

  /** Side panel: use the Desk browser session instead of a password form. */
  async function adoptBrowserSession(preferredSiteUrl?: string) {
    clearAccessError();
    const session = await erpnextAdoptBrowserSession(preferredSiteUrl);
    loggedIn.value = session.loggedIn;
    user.value = session.user ?? "";
    fullName.value = session.fullName ?? "";
    if (session.siteUrl) {
      siteUrl.value = session.siteUrl;
    }
    if (session.user) {
      try {
        await rememberUsername(session.user);
      } catch {
        // Non-fatal.
      }
    }
    return session;
  }

  /** Soft reset UI when switching to another OpsPilot site. */
  function resetForSiteSwitch(nextSiteUrl: string) {
    siteUrl.value = nextSiteUrl.trim();
    loggedIn.value = false;
    user.value = "";
    fullName.value = "";
    clearAccessError();
    bootPhase.value = nextSiteUrl.trim() ? "needs_login" : "needs_url";
    connectProgress.value = 0;
    connectStatus.value = "";
    connectDetail.value = "";
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
    clearAccessError();
    bootPhase.value = siteUrl.value.trim() ? "needs_login" : "needs_url";
  }

  /**
   * Post-login steps only:
   * 2) site has opspilot_frappe
   * 3) this user has OpsPilot Settings (AI permitted)
   */
  async function fetchSettings(): Promise<ConnectionConfig | null> {
    clearAccessError();
    try {
      // Step 2 — OpsPilot app installed?
      setConnectProgress(
        20,
        "Checking OpsPilot…",
        "Confirming this site has the OpsPilot app.",
      );
      const supported = await probeSupport();
      if (!supported) {
        return null;
      }

      // Step 3 — user has AI settings?
      setConnectProgress(
        40,
        "Checking AI access…",
        "Loading your OpsPilot Settings.",
      );
      const settings = await erpnextFetchOpspilotSettings();
      if (!settings || !settings.gatewayUrl?.trim()) {
        bootPhase.value = "error";
        accessError.value = "not_permitted";
        lastError.value = "This user is not permitted to use AI.";
        return null;
      }
      return settingsToConnection(settings);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      lastError.value = message;
      accessError.value = classifyAccessError(message);
      if (/session expired|Not logged|Not signed in|sign in again|Desk tab/i.test(message)) {
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
    clearAccessError();
    connectProgress.value = 100;
    connectStatus.value = "Ready";
    connectDetail.value = "";
  }

  function markConnecting(status = "Checking this site…", detail = "") {
    bootPhase.value = "connecting";
    connectStatus.value = status;
    connectDetail.value = detail;
    connectProgress.value = Math.max(connectProgress.value, 8);
  }

  function setConnectProgress(
    progress: number,
    status: string,
    detail = "",
  ) {
    connectProgress.value = Math.min(100, Math.max(0, progress));
    connectStatus.value = status;
    connectDetail.value = detail;
  }

  function markError(message: string) {
    bootPhase.value = "error";
    lastError.value = message;
    accessError.value = classifyAccessError(message);
    connectProgress.value = 0;
    connectStatus.value = "";
    connectDetail.value = "";
  }

  function openUrlSettings() {
    bootPhase.value = "needs_url";
  }

  function markNeedsLogin() {
    bootPhase.value = "needs_login";
    connectProgress.value = 0;
    connectStatus.value = "";
    connectDetail.value = "";
  }

  return {
    siteUrl,
    lastUsername,
    loggedIn,
    user,
    fullName,
    bootPhase,
    lastError,
    accessError,
    connectStatus,
    connectDetail,
    connectProgress,
    hasSiteUrl,
    displayName,
    load,
    saveSiteUrl,
    rememberUsername,
    login,
    activateSite,
    adoptBrowserSession,
    resetForSiteSwitch,
    logout,
    probeSupport,
    fetchSettings,
    markReady,
    markConnecting,
    setConnectProgress,
    markError,
    markNeedsLogin,
    openUrlSettings,
  };
});

export type { ErpnextConfig };
