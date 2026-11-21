import { onMounted, onUnmounted, watch } from "vue";
import { useChatStore } from "../../../src/stores/chat";
import { useErpnextStore } from "../../../src/stores/erpnext";
import {
  extractOpspilotHrefs,
  navigateOpspilotTab,
  resolveOpspilotHref,
} from "../../native/siteNavigate";

function wantsNewTab(event: MouseEvent): boolean {
  return Boolean(
    event.metaKey ||
      event.ctrlKey ||
      event.shiftKey ||
      event.altKey ||
      event.button === 1,
  );
}

/**
 * Desk / site links in the transcript:
 * - plain click → navigate the focused OpsPilot Desk tab
 * - ⌘/Ctrl/Shift/middle-click → open in a new browser tab
 */
export function useHermesSiteLinks() {
  const chat = useChatStore();
  const erpnext = useErpnextStore();
  let prevSending = chat.sending;

  async function openInDeskTab(url: string) {
    const site = erpnext.siteUrl.trim();
    if (!site) return;
    try {
      await navigateOpspilotTab(site, url);
    } catch {
      // Non-fatal
    }
  }

  async function openInNewTab(url: string) {
    await chrome.tabs.create({ url, active: true });
  }

  async function onAssistantFinished() {
    const site = erpnext.siteUrl.trim();
    if (!site) return;
    const turn = chat.turns[chat.turns.length - 1];
    if (!turn || turn.running) return;
    const text = turn.replies
      .filter((r) => r.role === "assistant")
      .map((r) => r.content || "")
      .join("\n");
    const hrefs = await extractOpspilotHrefs(site, text);
    const target = hrefs[hrefs.length - 1];
    if (target) await openInDeskTab(target);
  }

  function onTranscriptClick(event: MouseEvent) {
    const target = event.target as HTMLElement | null;
    const anchor = target?.closest?.("a") as HTMLAnchorElement | null;
    if (!anchor) return;

    const href = anchor.getAttribute("href") || "";
    if (!href || href.startsWith("#") || href.startsWith("mailto:")) return;

    const site = erpnext.siteUrl.trim();
    const looksLikeHttp = /^https?:\/\//i.test(href);
    const looksLikeDesk =
      href.startsWith("/app/") ||
      href.startsWith("app/") ||
      href.startsWith("/desk");

    if (!looksLikeHttp && !looksLikeDesk) return;

    event.preventDefault();
    event.stopPropagation();

    const newTab = wantsNewTab(event);
    void (async () => {
      const resolved = site
        ? await resolveOpspilotHref(site, href)
        : null;

      if (resolved) {
        if (newTab) await openInNewTab(resolved);
        else await openInDeskTab(resolved);
        return;
      }

      if (looksLikeHttp) {
        await openInNewTab(href);
      }
    })();
  }

  function onTranscriptAuxClick(event: MouseEvent) {
    // Middle-click
    if (event.button !== 1) return;
    onTranscriptClick(event);
  }

  const stopWatch = watch(
    () => chat.sending,
    (sending) => {
      if (prevSending && !sending) {
        void onAssistantFinished();
      }
      prevSending = sending;
    },
  );

  onMounted(() => {
    document.addEventListener("click", onTranscriptClick, true);
    document.addEventListener("auxclick", onTranscriptAuxClick, true);
  });

  onUnmounted(() => {
    stopWatch();
    document.removeEventListener("click", onTranscriptClick, true);
    document.removeEventListener("auxclick", onTranscriptAuxClick, true);
  });
}
