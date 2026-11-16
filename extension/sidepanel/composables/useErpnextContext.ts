import { computed, onMounted, onUnmounted, ref, watch } from "vue";
import { useErpnextStore } from "../../../src/stores/erpnext";
import {
  findSiteTabId,
  tabGetLoggedUser,
  tabGetOpspilotSettings,
  tabPingOpspilot,
} from "../../native/tabRpc";
import { hostnameOf, readBrowserSid } from "../../native/browserSession";

export interface ActivePage {
  title: string;
  url: string;
  host: string;
}

/**
 * Layered readiness of the focused OpsPilot site tab.
 * - wrong_tab: focused tab is not the configured site
 * - not_logged_in: correct site, but Desk session is Guest / missing
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

function isRestrictedUrl(url: string): boolean {
  return (
    url.startsWith("chrome://") ||
    url.startsWith("chrome-extension://") ||
    url.startsWith("edge://") ||
    url.startsWith("brave://") ||
    url.startsWith("about:")
  );
}

/** Compare hostnames only — ignore port (bench :8000 vs configured URL). */
export function matchesErpnextSite(tabUrl: string, siteUrl: string): boolean {
  if (!tabUrl || isRestrictedUrl(tabUrl)) return false;
  const tabHost = hostnameOf(tabUrl);
  const siteHost = hostnameOf(siteUrl);
  if (!tabHost || !siteHost) return false;
  return tabHost === siteHost;
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
  const siteHost = hostnameOf(siteUrl) ?? "";

  if (!siteUrl.trim()) {
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
      detail: siteHost,
    };
    checking.value = false;
    return;
  }

  try {
    // Prefer the focused matching tab; fall back to any tab on that host.
    let tabId: number | null = null;
    const focused = await chrome.tabs.query({
      active: true,
      lastFocusedWindow: true,
    });
    const focusedTab = focused[0];
    if (focusedTab?.id && focusedTab.url && matchesErpnextSite(focusedTab.url, siteUrl)) {
      tabId = focusedTab.id;
    } else {
      const found = await findSiteTabId(siteUrl);
      tabId = found?.tabId ?? null;
    }

    if (tabId == null) {
      siteGate.value = {
        status: "wrong_tab",
        username: "",
        detail: siteHost,
      };
      checking.value = false;
      return;
    }

    // Same-origin probe inside Desk — extension fetch cannot send sid Cookie.
    const username = await tabGetLoggedUser(tabId);
    if (seq !== probeSeq) return;
    if (!username) {
      // Cookie presence is a secondary hint for debugging; gate on tab RPC.
      void readBrowserSid(siteUrl, tabUrl);
      siteGate.value = {
        status: "not_logged_in",
        username: "",
        detail: siteHost,
      };
      checking.value = false;
      return;
    }

    const appOk = await tabPingOpspilot(tabId);
    if (seq !== probeSeq) return;
    if (!appOk) {
      siteGate.value = {
        status: "opspilot_unavailable",
        username,
        detail: siteHost,
      };
      checking.value = false;
      return;
    }

    const settings = await tabGetOpspilotSettings(tabId);
    if (seq !== probeSeq) return;
    if (settings === "unauthorized") {
      siteGate.value = {
        status: "not_logged_in",
        username: "",
        detail: siteHost,
      };
      checking.value = false;
      return;
    }
    if (settings === "missing") {
      siteGate.value = {
        status: "user_not_enabled",
        username,
        detail: siteHost,
      };
      checking.value = false;
      return;
    }

    siteGate.value = { status: "ok", username, detail: siteHost };
  } catch {
    if (seq !== probeSeq) return;
    siteGate.value = {
      status: "not_logged_in",
      username: "",
      detail: siteHost,
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
  const siteHost = hostnameOf(erpnext.siteUrl);
  if (!siteHost) return;
  const cookieHost = changeInfo.cookie.domain.replace(/^\./, "").toLowerCase();
  if (
    changeInfo.cookie.name === "sid" &&
    (cookieHost === siteHost ||
      siteHost.endsWith(`.${cookieHost}`) ||
      cookieHost.endsWith(`.${siteHost}`) ||
      cookieHost.endsWith(siteHost))
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

  const siteHost = computed(() => hostnameOf(erpnext.siteUrl) ?? "");

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
