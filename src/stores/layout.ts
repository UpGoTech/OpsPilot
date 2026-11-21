import { defineStore } from "pinia";
import { ref, watch } from "vue";
import { prepareHtmlPreviewTabUrl } from "../lib/htmlPreview";

const AGENT_WIDTH_KEY = "opspilot.agentWidth";
const AGENT_OPEN_KEY = "opspilot.agentOpen";

/** Chromium extension side panel — open artifacts in real browser tabs. */
function chromiumTabs(): {
  create: (props: { url: string; active?: boolean }) => Promise<unknown>;
} | null {
  try {
    const c = (
      globalThis as {
        chrome?: {
          runtime?: { id?: string };
          tabs?: {
            create: (p: {
              url: string;
              active?: boolean;
            }) => Promise<unknown>;
          };
        };
      }
    ).chrome;
    if (c?.runtime?.id && c.tabs?.create) return c.tabs;
  } catch {
    // not an extension
  }
  return null;
}

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

  function openBlobInBrowser(blob: Blob, _title = "Preview") {
    const tabs = chromiumTabs();
    if (!tabs) return;
    const url = URL.createObjectURL(blob);
    void tabs.create({ url, active: true });
  }

  function openHtmlDocument(
    html: string,
    _title = "HTML preview",
    opts?: { force?: boolean },
  ) {
    const tabs = chromiumTabs();
    if (!tabs) return;
    // Skip streaming auto-open — only user-driven Open preview (force).
    if (!opts?.force) return;
    // Do not use blob: tabs — extension CSP blocks inline <script>, so
    // interactive HTML (embedded DATA + render) shows an empty shell.
    void prepareHtmlPreviewTabUrl(html)
      .then((url) => tabs.create({ url, active: true }))
      .catch((err) => {
        console.error("HTML preview tab failed", err);
      });
  }

  function openPdfPreview(url: string, _filename: string) {
    const tabs = chromiumTabs();
    if (!tabs) return;
    void tabs.create({ url, active: true });
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
    openHtmlDocument,
    openBlobInBrowser,
    openPdfPreview,
  };
});
