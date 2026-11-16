/**
 * Service worker for Chromium (Chrome / Brave / Edge).
 * Opens the side panel on action click and greys the toolbar title when the
 * focused tab is not the configured ERPNext site.
 */

const CONFIG_KEY = "opspilot.erpnext";

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

async function configuredSiteHost(): Promise<string | null> {
  const stored = await chrome.storage.local.get(CONFIG_KEY);
  const config = stored[CONFIG_KEY] as { siteUrl?: string } | undefined;
  return hostOf(config?.siteUrl ?? "");
}

async function refreshActionState() {
  const siteHost = await configuredSiteHost();
  if (!siteHost) {
    await chrome.action.setTitle({ title: "OpsPilot — set ERPNext site URL" });
    await chrome.action.setBadgeText({ text: "" });
    return;
  }

  try {
    const tabs = await chrome.tabs.query({
      active: true,
      lastFocusedWindow: true,
    });
    const tab = tabs[0];
    const url = tab?.url ?? "";
    let active = false;
    if (url && !isRestrictedUrl(url)) {
      const tabHost = hostOf(url);
      active = Boolean(tabHost && tabHost === siteHost);
    }

    if (active) {
      await chrome.action.setTitle({ title: "OpsPilot" });
      await chrome.action.setBadgeText({ text: "" });
    } else {
      await chrome.action.setTitle({
        title: "OpsPilot — paused (open your ERPNext tab)",
      });
      await chrome.action.setBadgeText({ text: "—" });
      await chrome.action.setBadgeBackgroundColor({ color: "#9aa39a" });
    }
  } catch {
    // ignore
  }
}

function enableSidePanel() {
  void chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true });
}

chrome.runtime.onInstalled.addListener(() => {
  enableSidePanel();
  void refreshActionState();
});

chrome.runtime.onStartup.addListener(() => {
  enableSidePanel();
  void refreshActionState();
});

enableSidePanel();
void refreshActionState();

chrome.tabs.onActivated.addListener(() => {
  void refreshActionState();
});

chrome.tabs.onUpdated.addListener((_id, info, tab) => {
  if (tab.active && (info.status === "complete" || info.url)) {
    void refreshActionState();
  }
});

chrome.windows.onFocusChanged.addListener(() => {
  void refreshActionState();
});

chrome.storage.onChanged.addListener((changes, area) => {
  if (area === "local" && changes[CONFIG_KEY]) {
    void refreshActionState();
  }
});
