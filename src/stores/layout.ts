import { defineStore } from "pinia";
import { ref, watch } from "vue";
import { useCenterTabsStore } from "./centerTabs";

const AGENT_WIDTH_KEY = "opspilot.agentWidth";
const AGENT_OPEN_KEY = "opspilot.agentOpen";

function readBool(key: string, fallback: boolean): boolean {
  try {
    const raw = localStorage.getItem(key);
    if (raw == null) return fallback;
    return raw === "1" || raw === "true";
  } catch {
    return fallback;
  }
}

function readNumber(key: string, fallback: number): number {
  try {
    const n = Number(localStorage.getItem(key));
    return Number.isFinite(n) ? n : fallback;
  } catch {
    return fallback;
  }
}

export const useLayoutStore = defineStore("layout-v2", () => {
  /** Right agent chat panel. */
  const agentOpen = ref(readBool(AGENT_OPEN_KEY, true));
  /** History list inside the agent panel (clock control). */
  const agentHistoryOpen = ref(false);
  const agentWidth = ref(
    Math.min(720, Math.max(320, readNumber(AGENT_WIDTH_KEY, 420))),
  );
  const settingsOpen = ref(false);

  watch(agentOpen, (v) => localStorage.setItem(AGENT_OPEN_KEY, v ? "1" : "0"));
  watch(agentWidth, (v) => localStorage.setItem(AGENT_WIDTH_KEY, String(v)));

  watch(settingsOpen, (open) => {
    if (open) {
      void useCenterTabsStore().hideBrowsersForOverlay();
    }
  });

  function toggleAgent() {
    agentOpen.value = !agentOpen.value;
    if (!agentOpen.value) agentHistoryOpen.value = false;
  }

  function toggleAgentHistory() {
    if (agentHistoryOpen.value) {
      agentHistoryOpen.value = false;
    } else {
      openAgentHistory();
    }
  }

  function openAgentHistory() {
    agentOpen.value = true;
    agentHistoryOpen.value = true;
  }

  function closeAgentHistory() {
    agentHistoryOpen.value = false;
  }

  function setAgentWidth(px: number) {
    agentWidth.value = Math.min(720, Math.max(320, Math.round(px)));
  }

  function openSettings() {
    settingsOpen.value = true;
  }

  function closeSettings() {
    settingsOpen.value = false;
  }

  /** @deprecated use centerTabs — kept for artifact callers */
  function navigateBrowser() {
    const center = useCenterTabsStore();
    const tab = center.openOrFocusBrowser();
    if (tab.kind === "browser" && tab.draft.trim()) {
      void center.navigateActiveBrowser();
    }
  }

  function openBlobInBrowser(blob: Blob, title = "Preview") {
    useCenterTabsStore().openBlobInBrowser(blob, title);
  }

  function openHtmlDocument(
    html: string,
    title = "HTML preview",
    opts?: { force?: boolean },
  ) {
    useCenterTabsStore().openHtmlDocument(html, title, opts);
  }

  function openPdfPreview(url: string, filename: string) {
    useCenterTabsStore().openPdfPreview(url, filename);
  }

  return {
    agentOpen,
    agentHistoryOpen,
    agentWidth,
    settingsOpen,
    toggleAgent,
    toggleAgentHistory,
    openAgentHistory,
    closeAgentHistory,
    setAgentWidth,
    openSettings,
    closeSettings,
    navigateBrowser,
    openHtmlDocument,
    openBlobInBrowser,
    openPdfPreview,
  };
});
