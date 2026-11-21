/**
 * Service worker — site-scoped Side Panel.
 * Global panel is disabled; only tabs that pass opspilot_frappe ping get a panel.
 */

import {
  detectTabOpspilot,
  getCachedDetect,
  invalidateDetect,
  isRestrictedTabUrl,
  siteKeyFromUrl,
} from "./native/siteDetect";

function enablePanelBehavior() {
  void chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true });
}

/** Disable the manifest default panel so only tab-scoped enable can show it. */
async function disableGlobalPanel() {
  try {
    await chrome.sidePanel.setOptions({
      enabled: false,
      path: "sidepanel.html",
    });
  } catch {
    // ignore
  }
}

async function setTabPanel(tabId: number, enabled: boolean) {
  try {
    await chrome.sidePanel.setOptions({
      tabId,
      path: "sidepanel.html",
      enabled,
    });
  } catch {
    // Tab may have closed mid-flight.
  }
}

async function closePanelForTab(tabId: number) {
  const api = chrome.sidePanel as typeof chrome.sidePanel & {
    close?: (options: { tabId?: number; windowId?: number }) => Promise<void>;
  };
  if (typeof api.close !== "function") return;
  try {
    await api.close({ tabId });
  } catch {
    try {
      const tab = await chrome.tabs.get(tabId);
      if (tab.windowId != null) await api.close!({ windowId: tab.windowId });
    } catch {
      // Older Chromium / already closed.
    }
  }
}

async function refreshActionBadge(tabId: number, enabled: boolean) {
  try {
    if (enabled) {
      await chrome.action.setTitle({ tabId, title: "OpsPilot" });
      await chrome.action.setBadgeText({ tabId, text: "" });
    } else {
      await chrome.action.setTitle({
        tabId,
        title: "OpsPilot — not available on this site",
      });
      await chrome.action.setBadgeText({ tabId, text: "" });
    }
  } catch {
    // ignore
  }
}

/**
 * OpsPilot tab → empty popup so openPanelOnActionClick opens the side panel.
 * Other tabs → explain-why popup instead of an empty click.
 */
async function setActionPopup(tabId: number, enabled: boolean) {
  try {
    await chrome.action.setPopup({
      tabId,
      popup: enabled ? "" : "unavailable-popup.html",
    });
  } catch {
    // ignore
  }
}

async function applyEnabled(tabId: number, enabled: boolean) {
  await setTabPanel(tabId, enabled);
  await setActionPopup(tabId, enabled);
  await refreshActionBadge(tabId, enabled);
  if (!enabled) await closePanelForTab(tabId);
}

async function syncTab(tabId: number, url: string | undefined, force = false) {
  if (!url || isRestrictedTabUrl(url)) {
    await applyEnabled(tabId, false);
    return;
  }

  const siteKey = siteKeyFromUrl(url);
  if (!siteKey) {
    await applyEnabled(tabId, false);
    return;
  }

  // Fast path: cached negative / unknown → hide immediately (stops flash).
  if (!force) {
    const cached = await getCachedDetect(siteKey);
    if (cached && !cached.ok) {
      await applyEnabled(tabId, false);
      return;
    }
    if (!cached) {
      // Optimistic hide while ping runs — do not leave a prior site's panel up.
      await applyEnabled(tabId, false);
    } else if (cached.ok) {
      await applyEnabled(tabId, true);
    }
  }

  const result = await detectTabOpspilot(tabId, url, { force });
  const enabled = Boolean(result?.ok);
  await applyEnabled(tabId, enabled);
}

async function syncExistingTabs() {
  try {
    const tabs = await chrome.tabs.query({});
    for (const tab of tabs) {
      if (tab.id == null) continue;
      void syncTab(tab.id, tab.url);
    }
  } catch {
    // ignore
  }
}

async function boot() {
  enablePanelBehavior();
  await disableGlobalPanel();
  void syncExistingTabs();
}

chrome.runtime.onInstalled.addListener(() => {
  void boot();
});

chrome.runtime.onStartup.addListener(() => {
  void boot();
});

void boot();

chrome.tabs.onUpdated.addListener((tabId, info, tab) => {
  if (info.status === "complete" || info.url) {
    void syncTab(tabId, tab.url ?? info.url);
  }
});

chrome.tabs.onActivated.addListener(async ({ tabId }) => {
  try {
    const tab = await chrome.tabs.get(tabId);
    // Hide first on activate — prevents previous OpsPilot panel from lingering.
    const key = tab.url ? siteKeyFromUrl(tab.url) : null;
    const cached = key ? await getCachedDetect(key) : null;
    if (!cached?.ok) {
      await applyEnabled(tabId, false);
    }
    void syncTab(tabId, tab.url);
  } catch {
    // ignore
  }
});

chrome.tabs.onRemoved.addListener((tabId) => {
  void setTabPanel(tabId, false);
});

/** Side panel / content can force a re-detect after install. */
chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (!message || typeof message !== "object") return;
  const type = (message as { type?: string }).type;
  if (type === "opspilot.redetect") {
    const tabId = (message as { tabId?: number }).tabId;
    void (async () => {
      try {
        const tab =
          tabId != null
            ? await chrome.tabs.get(tabId)
            : (
                await chrome.tabs.query({
                  active: true,
                  lastFocusedWindow: true,
                })
              )[0];
        if (!tab?.id || !tab.url) {
          sendResponse({ ok: false });
          return;
        }
        const key = siteKeyFromUrl(tab.url);
        if (key) await invalidateDetect(key);
        await syncTab(tab.id, tab.url, true);
        sendResponse({ ok: true, siteKey: key });
      } catch (error) {
        sendResponse({
          ok: false,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    })();
    return true;
  }
});
