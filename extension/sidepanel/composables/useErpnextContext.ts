import { computed, onMounted, onUnmounted, ref } from "vue";
import { useErpnextStore } from "../../../src/stores/erpnext";
import { hostnameOf } from "../../native/browserSession";
import {
  isRestrictedTabUrl,
  siteKeyFromUrl,
  siteUrlFromTabUrl,
} from "../../native/siteKey";
import {
  tabGetLoggedUser,
  tabGetOpspilotSettings,
  tabPingOpspilot,
} from "../../native/tabRpc";

/**
 * Layered readiness of the focused OpsPilot Desk tab.
 * Multi-site: site comes from the focused tab (panel only opens on ping-ok sites).
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

export interface FocusedSite {
  tabId: number;
  tabUrl: string;
  siteKey: string;
  siteUrl: string;
}

async function getFocusedSite(): Promise<FocusedSite | null> {
  try {
    const tabs = await chrome.tabs.query({
      active: true,
      lastFocusedWindow: true,
    });
    const tab = tabs[0];
    if (!tab?.id || !tab.url || isRestrictedTabUrl(tab.url)) return null;
    const siteKey = siteKeyFromUrl(tab.url);
    const siteUrl = siteUrlFromTabUrl(tab.url);
    if (!siteKey || !siteUrl) return null;
    return { tabId: tab.id, tabUrl: tab.url, siteKey, siteUrl };
  } catch {
    return null;
  }
}

const checking = ref(true);
const focusedSite = ref<FocusedSite | null>(null);
const siteGate = ref<SiteGate>({
  status: "checking",
  username: "",
  detail: "",
});
let subscriberCount = 0;
let probeSeq = 0;
let debounceTimer: number | null = null;
/** Last known good username per site key — soft ok flips. */
const lastOkBySite = new Map<string, string>();

function shouldSkipAutoProbe(): boolean {
  return useErpnextStore().bootPhase === "connecting";
}

async function refreshGate(opts?: { force?: boolean }) {
  const force = Boolean(opts?.force);
  if (!force && shouldSkipAutoProbe()) return;

  const seq = ++probeSeq;
  const phase = useErpnextStore().bootPhase;
  const soft = !force && phase === "ready";
  checking.value = true;

  const finish = (next: SiteGate, site: FocusedSite | null) => {
    if (seq !== probeSeq) return;
    focusedSite.value = site;
    if (next.status === "ok" && site && next.username) {
      lastOkBySite.set(site.siteKey, next.username);
    }
    siteGate.value = next;
    checking.value = false;
  };

  const watchdog = window.setTimeout(() => {
    if (seq !== probeSeq) return;
    if (checking.value) {
      finish(
        {
          status: "wrong_tab",
          username: "",
          detail: "Timed out probing this tab. Refresh Desk, then Retry.",
        },
        focusedSite.value,
      );
    }
  }, 12_000);

  try {
    const focused = await getFocusedSite();
    if (seq !== probeSeq) return;

    if (!focused) {
      finish(
        {
          status: "no_site",
          username: "",
          detail: "Open a Desk tab with the OpsPilot app installed.",
        },
        null,
      );
      return;
    }

    if (
      !soft &&
      (force ||
        siteGate.value.status === "checking" ||
        siteGate.value.status === "no_site" ||
        siteGate.value.status === "wrong_tab")
    ) {
      siteGate.value = {
        status: "checking",
        username: "",
        detail: focused.siteKey,
      };
    }

    // Soft return to an already-validated site.
    const cachedUser = lastOkBySite.get(focused.siteKey);
    if (soft && siteGate.value.status === "ok" && cachedUser) {
      finish(
        {
          status: "ok",
          username: cachedUser,
          detail: focused.siteKey,
        },
        focused,
      );
      return;
    }

    // Ping OpsPilot BEFORE login checks — random websites must not look like Desk Guest.
    let appOk = false;
    try {
      appOk = await tabPingOpspilot(focused.tabId);
    } catch {
      appOk = false;
    }
    if (seq !== probeSeq) return;
    if (!appOk) {
      // Ask the service worker to hide this tab's panel (global default can linger).
      try {
        void chrome.runtime.sendMessage({
          type: "opspilot.redetect",
          tabId: focused.tabId,
        });
      } catch {
        // ignore
      }
      finish(
        {
          status: "wrong_tab",
          username: "",
          detail: `${focused.siteKey} is not an OpsPilot site.`,
        },
        focused,
      );
      return;
    }

    let username: string | null = null;
    try {
      username = await tabGetLoggedUser(focused.tabId);
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      finish(
        {
          status: "not_logged_in",
          username: "",
          detail: `Could not read Desk session (${msg}). Refresh the Desk tab.`,
        },
        focused,
      );
      return;
    }
    if (seq !== probeSeq) return;
    if (!username) {
      finish(
        {
          status: "not_logged_in",
          username: "",
          detail: "Desk tab open but session is Guest. Sign in, then Retry.",
        },
        focused,
      );
      return;
    }

    let settings: Awaited<ReturnType<typeof tabGetOpspilotSettings>>;
    try {
      settings = await tabGetOpspilotSettings(focused.tabId);
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      finish(
        {
          status: "user_not_enabled",
          username,
          detail: `Could not load OpsPilot Settings (${msg}).`,
        },
        focused,
      );
      return;
    }
    if (seq !== probeSeq) return;
    if (settings === "unauthorized") {
      finish(
        {
          status: "not_logged_in",
          username: "",
          detail: "OpsPilot Settings returned unauthorized. Sign in on Desk again.",
        },
        focused,
      );
      return;
    }
    if (settings === "missing") {
      finish(
        {
          status: "user_not_enabled",
          username,
          detail: `No OpsPilot Settings row for ${username}.`,
        },
        focused,
      );
      return;
    }

    finish(
      {
        status: "ok",
        username,
        detail: focused.siteKey,
      },
      focused,
    );
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    finish(
      {
        status: "wrong_tab",
        username: "",
        detail: msg || "Could not probe this tab.",
      },
      focusedSite.value,
    );
  } finally {
    window.clearTimeout(watchdog);
    if (seq === probeSeq) checking.value = false;
  }
}

function scheduleProbe(force = false) {
  if (debounceTimer != null) {
    window.clearTimeout(debounceTimer);
  }
  debounceTimer = window.setTimeout(() => {
    debounceTimer = null;
    void refreshGate({ force });
  }, force ? 0 : 150);
}

function onActivated() {
  scheduleProbe(false);
}

function onUpdated(
  _tabId: number,
  changeInfo: { status?: string; url?: string },
  tab: chrome.tabs.Tab,
) {
  if (changeInfo.status === "complete" || changeInfo.url) {
    if (tab.active) scheduleProbe(false);
  }
}

function onFocusChanged() {
  scheduleProbe(false);
}

function onCookieChanged(changeInfo: chrome.cookies.CookieChangeInfo) {
  const site = focusedSite.value;
  if (!site) return;
  const cookieHost = changeInfo.cookie.domain.replace(/^\./, "").toLowerCase();
  const siteHost = site.siteKey;
  if (
    changeInfo.cookie.name === "sid" &&
    (cookieHost === siteHost ||
      siteHost.endsWith(`.${cookieHost}`) ||
      cookieHost.endsWith(`.${siteHost}`) ||
      cookieHost.endsWith(siteHost))
  ) {
    scheduleProbe(false);
  }
}

function startListening() {
  if (subscriberCount === 0) {
    void refreshGate({ force: true });
    chrome.tabs.onActivated.addListener(onActivated);
    chrome.tabs.onUpdated.addListener(onUpdated);
    chrome.windows.onFocusChanged.addListener(onFocusChanged);
    if (chrome.cookies?.onChanged) {
      chrome.cookies.onChanged.addListener(onCookieChanged);
    }
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
    if (debounceTimer != null) {
      window.clearTimeout(debounceTimer);
      debounceTimer = null;
    }
  }
}

export function useErpnextContext() {
  const erpnext = useErpnextStore();

  const siteHost = computed(
    () =>
      focusedSite.value?.siteKey ||
      hostnameOf(erpnext.siteUrl) ||
      "",
  );

  const activeSiteKey = computed(
    () => focusedSite.value?.siteKey ?? siteKeyFromUrl(erpnext.siteUrl),
  );

  const activeSiteUrl = computed(
    () => focusedSite.value?.siteUrl || erpnext.siteUrl.trim() || "",
  );

  const isErpnextActive = computed(() => siteGate.value.status === "ok");

  onMounted(() => {
    startListening();
  });

  onUnmounted(() => {
    stopListening();
  });

  return {
    checking,
    siteHost,
    siteGate,
    focusedSite,
    activeSiteKey,
    activeSiteUrl,
    isErpnextActive,
    refresh: () => refreshGate({ force: true }),
  };
}
