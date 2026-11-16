import { computed, onMounted, onUnmounted, ref, watch } from "vue";
import { useErpnextStore } from "../../../src/stores/erpnext";

export interface ActivePage {
  title: string;
  url: string;
  host: string;
}

/**
 * Layered readiness of the focused OpsPilot site tab.
 * - wrong_tab: focused tab is not the configured site
 * - not_logged_in: correct site, but no browser session (Guest / no sid)
 * - opspilot_unavailable: logged in, but OpsPilot app missing on site
 * - user_not_enabled: app present, but this user has no OpsPilot Settings
 * - ok: site + login + app + user settings all good
 */
export type SiteGateStatus =
  | "checking"
  | "no_site"
  | "wrong_tab"
  | "not_logged_in"
  | "opspilot_unavailable"
  | "user_not_enabled"
  | "ok";

export interface SiteGate {
  status: SiteGateStatus;
  username: string;
  detail: string;
}

function hostOf(raw: string): string | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;
  try {
    const withScheme = trimmed.includes("://") ? trimmed : `https://${trimmed}`;
    return new URL(withScheme).host.toLowerCase();
  } catch {
    return null;
  }
}

function isRestrictedUrl(url: string): boolean {
  return (
    url.startsWith("chrome://") ||
    url.startsWith("chrome-extension://") ||
    url.startsWith("edge://") ||
    url.startsWith("brave://") ||
    url.startsWith("about:")
  );
}

export function matchesErpnextSite(tabUrl: string, siteUrl: string): boolean {
  if (!tabUrl || isRestrictedUrl(tabUrl)) return false;
  const tabHost = hostOf(tabUrl);
  const siteHost = hostOf(siteUrl);
  if (!tabHost || !siteHost) return false;
  return tabHost === siteHost;
}

function normalizeBase(siteUrl: string): string {
  const trimmed = siteUrl.trim();
  if (!trimmed) return "";
  try {
    const withScheme = trimmed.includes("://") ? trimmed : `https://${trimmed}`;
    const u = new URL(withScheme);
    return `${u.protocol}//${u.host}`.replace(/\/$/, "");
  } catch {
    return trimmed.replace(/\/$/, "");
  }
}

async function readBrowserSid(siteUrl: string): Promise<string | null> {
  const base = normalizeBase(siteUrl);
  if (!base || !chrome.cookies?.get) return null;
  try {
    const cookie = await chrome.cookies.get({ url: base, name: "sid" });
    const value = cookie?.value?.trim() ?? "";
    if (!value || value === "Guest") return null;
    return value;
  } catch {
    return null;
  }
}

async function fetchJson(
  url: string,
  sid: string | null,
): Promise<{ status: number; body: unknown; text: string }> {
  const headers: Record<string, string> = { Accept: "application/json" };
  if (sid) headers.Cookie = `sid=${sid}`;
  const response = await fetch(url, {
    method: "GET",
    headers,
    credentials: "omit",
  });
  const text = await response.text();
  let body: unknown = null;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    body = null;
  }
  return { status: response.status, body, text };
}

function messageOf(body: unknown): unknown {
  if (!body || typeof body !== "object") return null;
  return (body as Record<string, unknown>).message;
}

async function probeLoggedUser(
  base: string,
  sid: string,
): Promise<string | null> {
  const { status, body } = await fetchJson(
    `${base}/api/method/frappe.auth.get_logged_user`,
    sid,
  );
  if (status === 401 || status === 403) return null;
  if (status < 200 || status >= 300) return null;
  const message = messageOf(body);
  if (typeof message === "string" && message && message !== "Guest") {
    return message;
  }
  return null;
}

async function probeOpspilotApp(base: string, sid: string | null): Promise<boolean> {
  const { status, body, text } = await fetchJson(
    `${base}/api/method/opspilot_frappe.api.ping`,
    sid,
  );
  if (status >= 200 && status < 300) {
    const message = messageOf(body);
    if (message && typeof message === "object") {
      return Boolean((message as Record<string, unknown>).ok);
    }
    return true;
  }
  const blob = `${text}${JSON.stringify(body ?? "")}`.toLowerCase();
  if (
    status === 404 ||
    blob.includes("not installed") ||
    blob.includes("failed to get method") ||
    blob.includes("opspilot_frappe")
  ) {
    return false;
  }
  // Auth-only failure still means the method exists.
  if (status === 401 || status === 403) return true;
  return false;
}

async function probeUserSettings(
  base: string,
  sid: string,
): Promise<"ok" | "missing" | "unauthorized"> {
  const { status, body } = await fetchJson(
    `${base}/api/method/opspilot_frappe.api.get_my_opspilot_settings`,
    sid,
  );
  if (status === 401 || status === 403) return "unauthorized";
  if (status < 200 || status >= 300) return "missing";
  const message = messageOf(body);
  if (message == null || message === false || message === "") return "missing";
  if (typeof message === "object") {
    const gateway =
      (message as Record<string, unknown>).gateway_url ??
      (message as Record<string, unknown>).gatewayUrl;
    if (!String(gateway ?? "").trim()) return "missing";
  }
  return "ok";
}

const page = ref<ActivePage | null>(null);
const checking = ref(true);
const siteGate = ref<SiteGate>({
  status: "checking",
  username: "",
  detail: "",
});
let subscriberCount = 0;
let siteUrlWatchStop: (() => void) | null = null;
let probeSeq = 0;

async function refreshPage() {
  try {
    const tabs = await chrome.tabs.query({
      active: true,
      lastFocusedWindow: true,
    });
    const tab = tabs[0];
    if (!tab?.url || isRestrictedUrl(tab.url)) {
      page.value = null;
      return;
    }
    let host = tab.url;
    try {
      const parsed = new URL(tab.url);
      host = parsed.host + parsed.pathname.replace(/\/$/, "");
    } catch {
      // keep raw
    }
    page.value = {
      title: tab.title?.trim() || "This page",
      url: tab.url,
      host,
    };
  } catch {
    page.value = null;
  }
}

async function refreshGate(siteUrl: string) {
  const seq = ++probeSeq;
  checking.value = true;
  const base = normalizeBase(siteUrl);

  if (!base) {
    siteGate.value = { status: "no_site", username: "", detail: "" };
    checking.value = false;
    return;
  }

  await refreshPage();
  if (seq !== probeSeq) return;

  const tabUrl = page.value?.url ?? "";
  if (!matchesErpnextSite(tabUrl, siteUrl)) {
    siteGate.value = {
      status: "wrong_tab",
      username: "",
      detail: hostOf(siteUrl) ?? base,
    };
    checking.value = false;
    return;
  }

  try {
    const sid = await readBrowserSid(base);
    if (seq !== probeSeq) return;
    if (!sid) {
      siteGate.value = {
        status: "not_logged_in",
        username: "",
        detail: hostOf(siteUrl) ?? base,
      };
      checking.value = false;
      return;
    }

    const username = (await probeLoggedUser(base, sid)) ?? "";
    if (seq !== probeSeq) return;
    if (!username) {
      siteGate.value = {
        status: "not_logged_in",
        username: "",
        detail: hostOf(siteUrl) ?? base,
      };
      checking.value = false;
      return;
    }

    const appOk = await probeOpspilotApp(base, sid);
    if (seq !== probeSeq) return;
    if (!appOk) {
      siteGate.value = {
        status: "opspilot_unavailable",
        username,
        detail: hostOf(siteUrl) ?? base,
      };
      checking.value = false;
      return;
    }

    const settings = await probeUserSettings(base, sid);
    if (seq !== probeSeq) return;
    if (settings === "unauthorized") {
      siteGate.value = {
        status: "not_logged_in",
        username: "",
        detail: hostOf(siteUrl) ?? base,
      };
      checking.value = false;
      return;
    }
    if (settings === "missing") {
      siteGate.value = {
        status: "user_not_enabled",
        username,
        detail: hostOf(siteUrl) ?? base,
      };
      checking.value = false;
      return;
    }

    siteGate.value = { status: "ok", username, detail: hostOf(siteUrl) ?? base };
  } catch {
    if (seq !== probeSeq) return;
    siteGate.value = {
      status: "wrong_tab",
      username: "",
      detail: hostOf(siteUrl) ?? base,
    };
  } finally {
    if (seq === probeSeq) checking.value = false;
  }
}

function onActivated() {
  const erpnext = useErpnextStore();
  void refreshGate(erpnext.siteUrl);
}

function onUpdated(
  _tabId: number,
  changeInfo: chrome.tabs.TabChangeInfo,
  tab: chrome.tabs.Tab,
) {
  if (changeInfo.status === "complete" || changeInfo.url) {
    if (tab.active) onActivated();
  }
}

function onFocusChanged() {
  onActivated();
}

function onCookieChanged(changeInfo: chrome.cookies.CookieChangeInfo) {
  const erpnext = useErpnextStore();
  const siteHost = hostOf(erpnext.siteUrl);
  if (!siteHost) return;
  const cookieHost = changeInfo.cookie.domain.replace(/^\./, "").toLowerCase();
  if (
    changeInfo.cookie.name === "sid" &&
    (cookieHost === siteHost || siteHost.endsWith(`.${cookieHost}`) || cookieHost.endsWith(siteHost))
  ) {
    void refreshGate(erpnext.siteUrl);
  }
}

function startListening() {
  if (subscriberCount === 0) {
    const erpnext = useErpnextStore();
    void refreshGate(erpnext.siteUrl);
    chrome.tabs.onActivated.addListener(onActivated);
    chrome.tabs.onUpdated.addListener(onUpdated);
    chrome.windows.onFocusChanged.addListener(onFocusChanged);
    if (chrome.cookies?.onChanged) {
      chrome.cookies.onChanged.addListener(onCookieChanged);
    }
    siteUrlWatchStop = watch(
      () => erpnext.siteUrl,
      (url) => {
        void refreshGate(url);
      },
    );
  }
  subscriberCount += 1;
}

function stopListening() {
  subscriberCount = Math.max(0, subscriberCount - 1);
  if (subscriberCount === 0) {
    chrome.tabs.onActivated.removeListener(onActivated);
    chrome.tabs.onUpdated.removeListener(onUpdated);
    chrome.windows.onFocusChanged.removeListener(onFocusChanged);
    if (chrome.cookies?.onChanged) {
      chrome.cookies.onChanged.removeListener(onCookieChanged);
    }
    siteUrlWatchStop?.();
    siteUrlWatchStop = null;
  }
}

export function useErpnextContext() {
  const erpnext = useErpnextStore();

  const siteHost = computed(() => hostOf(erpnext.siteUrl) ?? "");

  const isErpnextActive = computed(() => siteGate.value.status === "ok");

  onMounted(() => {
    startListening();
  });

  onUnmounted(() => {
    stopListening();
  });

  return {
    page,
    checking,
    siteHost,
    siteGate,
    isErpnextActive,
    refresh: () => refreshGate(erpnext.siteUrl),
  };
}
