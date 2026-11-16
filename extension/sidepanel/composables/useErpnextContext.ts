import { computed, onMounted, onUnmounted, ref, watch } from "vue";
import { useErpnextStore } from "../../../src/stores/erpnext";

export interface ActivePage {
  title: string;
  url: string;
  host: string;
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

/** True when the active tab belongs to the configured ERPNext site (same host). */
export function matchesErpnextSite(tabUrl: string, siteUrl: string): boolean {
  if (!tabUrl || isRestrictedUrl(tabUrl)) return false;
  const tabHost = hostOf(tabUrl);
  const siteHost = hostOf(siteUrl);
  if (!tabHost || !siteHost) return false;
  return tabHost === siteHost;
}

/**
 * Watches the focused window's active tab and compares it to the configured
 * ERPNext site URL. OpsPilot chat is "active" only while that host matches.
 */
export function useErpnextContext() {
  const erpnext = useErpnextStore();
  const page = ref<ActivePage | null>(null);
  const checking = ref(true);

  const siteHost = computed(() => hostOf(erpnext.siteUrl) ?? "");

  const isErpnextActive = computed(() => {
    if (!erpnext.siteUrl.trim()) return false;
    if (!page.value?.url) return false;
    return matchesErpnextSite(page.value.url, erpnext.siteUrl);
  });

  async function refresh() {
    checking.value = true;
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
    } finally {
      checking.value = false;
    }
  }

  function onActivated() {
    void refresh();
  }

  function onUpdated(
    _tabId: number,
    changeInfo: chrome.tabs.TabChangeInfo,
    tab: chrome.tabs.Tab,
  ) {
    if (changeInfo.status === "complete" || changeInfo.url) {
      if (tab.active) void refresh();
    }
  }

  function onFocusChanged() {
    void refresh();
  }

  onMounted(() => {
    void refresh();
    chrome.tabs.onActivated.addListener(onActivated);
    chrome.tabs.onUpdated.addListener(onUpdated);
    chrome.windows.onFocusChanged.addListener(onFocusChanged);
  });

  onUnmounted(() => {
    chrome.tabs.onActivated.removeListener(onActivated);
    chrome.tabs.onUpdated.removeListener(onUpdated);
    chrome.windows.onFocusChanged.removeListener(onFocusChanged);
  });

  watch(
    () => erpnext.siteUrl,
    () => {
      void refresh();
    },
  );

  return {
    page,
    checking,
    siteHost,
    isErpnextActive,
    refresh,
  };
}
