<script setup lang="ts">
import { computed, nextTick, onMounted, onUnmounted, ref, watch } from "vue";
import { openUrl, revealItemInDir } from "@tauri-apps/plugin-opener";
import { useCenterTabsStore, type CenterTab } from "../../stores/centerTabs";
import { useFilesStore } from "../../stores/files";
import { useLayoutStore } from "../../stores/layout";
import {
  boundsForBrowserOverlay,
  browserBack,
  browserCreate,
  browserForward,
  browserHide,
  browserHideAll,
  browserNavigate,
  browserReload,
  browserSetBounds,
  browserShow,
  isBrowserLabelCreated,
  listenBrowserDownloadFinished,
  listenBrowserDownloadStarted,
  listenBrowserNavigated,
} from "../../lib/browserWebview";
import IconButton from "./IconButton.vue";

const center = useCenterTabsStore();
const files = useFilesStore();
const layout = useLayoutStore();

const hostRef = ref<HTMLElement | null>(null);
const chromeRef = ref<HTMLElement | null>(null);
const tabStripRef = ref<HTMLElement | null>(null);
const draftInput = ref("");
const downloadToast = ref<{
  text: string;
  path: string | null;
  tone: "info" | "ok" | "err";
} | null>(null);
let downloadToastTimer: ReturnType<typeof setTimeout> | null = null;

function showDownloadToast(
  text: string,
  tone: "info" | "ok" | "err",
  path: string | null = null,
) {
  downloadToast.value = { text, tone, path };
  if (downloadToastTimer) clearTimeout(downloadToastTimer);
  downloadToastTimer = setTimeout(() => {
    downloadToast.value = null;
    scheduleSync();
  }, 6000);
  // Status bar changes center height — keep the native webview aligned.
  nextTick(() => scheduleSync());
}

async function revealDownload() {
  const path = downloadToast.value?.path;
  if (!path) return;
  try {
    await revealItemInDir(path);
  } catch (err) {
    console.error("reveal download failed", err);
  }
}

const active = computed(() => center.activeTab);
const isBrowser = computed(() => active.value?.kind === "browser");
const isPdf = computed(() => active.value?.kind === "pdf");
const isHtml = computed(() => active.value?.kind === "html");
const isFile = computed(() => active.value?.kind === "file");

/** New browser tab — Vue start page until a real URL is entered. */
const isBrowserStartPage = computed(() => {
  const t = active.value;
  if (!t || t.kind !== "browser") return false;
  return !center.browserLoadUrl(t);
});

/** Last URL we asked the native webview to load (avoid reload on every resize). */
const ensuredBrowserUrl = new Map<string, string>();

const urlInputRef = ref<HTMLInputElement | null>(null);

watch(
  () => {
    const t = active.value;
    return t?.kind === "browser" ? t.draft : "";
  },
  (d) => {
    draftInput.value = d;
  },
  { immediate: true },
);

function fileIcon(name: string) {
  const lower = name.toLowerCase();
  if (lower.endsWith(".html") || lower.endsWith(".htm")) return "html";
  if (lower.endsWith(".json") || lower.endsWith(".jsonc")) return "json";
  if (/\.(js|mjs|cjs|ts|tsx|jsx)$/.test(lower)) return "js";
  if (/\.(css|scss|less)$/.test(lower)) return "css";
  return "file";
}

function tabIcon(tab: CenterTab) {
  if (tab.kind === "browser") return "globe";
  if (tab.kind === "html") return "html";
  if (tab.kind === "pdf") return "pdf";
  return fileIcon(tab.title);
}

async function hideAllBrowserOverlays() {
  try {
    await browserHideAll();
  } catch {
    // ignore when not in tauri / no webviews yet
  }
}

function waitTwoFrames() {
  return new Promise<void>((resolve) => {
    requestAnimationFrame(() => {
      requestAnimationFrame(() => resolve());
    });
  });
}

async function syncBrowserOverlay() {
  if (layout.settingsOpen) {
    await hideAllBrowserOverlays();
    return;
  }

  const tab = center.activeTab;

  // Always hide inactive browser webviews first.
  for (const t of center.tabs) {
    if (t.kind !== "browser") continue;
    if (!isBrowserLabelCreated(t.webviewLabel)) continue;
    const isActive = tab?.kind === "browser" && t.id === tab.id;
    if (isActive) continue;
    try {
      await browserHide(t.webviewLabel);
    } catch {
      // ignore
    }
  }

  // Start page / no host / no chrome — keep overlay hidden (never anchor to tab strip alone).
  if (
    !tab ||
    tab.kind !== "browser" ||
    isBrowserStartPage.value ||
    !hostRef.value ||
    !chromeRef.value
  ) {
    if (tab?.kind === "browser" && isBrowserLabelCreated(tab.webviewLabel)) {
      try {
        await browserHide(tab.webviewLabel);
      } catch {
        // ignore
      }
    } else if (!tab || tab.kind !== "browser") {
      await hideAllBrowserOverlays();
    }
    return;
  }

  await nextTick();
  await waitTwoFrames();

  const host = hostRef.value;
  const chrome = chromeRef.value;
  if (!host || !chrome || center.activeTab?.id !== tab.id) {
    if (isBrowserLabelCreated(tab.webviewLabel)) {
      try {
        await browserHide(tab.webviewLabel);
      } catch {
        // ignore
      }
    }
    return;
  }

  const bounds = boundsForBrowserOverlay(host, chrome);
  if (!bounds) {
    if (isBrowserLabelCreated(tab.webviewLabel)) {
      try {
        await browserHide(tab.webviewLabel);
      } catch {
        // ignore
      }
    }
    return;
  }

  const loadUrl = center.browserLoadUrl(tab);

  try {
    if (!isBrowserLabelCreated(tab.webviewLabel)) {
      await browserCreate(tab.webviewLabel, bounds, loadUrl ?? undefined);
    }
    // Always push chrome-anchored bounds (create alone can leave a stale y).
    await browserSetBounds(tab.webviewLabel, bounds);
    // After restart the webview is new — navigate once to the persisted site.
    if (loadUrl && ensuredBrowserUrl.get(tab.webviewLabel) !== loadUrl) {
      await browserNavigate(tab.webviewLabel, loadUrl);
      ensuredBrowserUrl.set(tab.webviewLabel, loadUrl);
      center.applyBrowserNavigated(tab.webviewLabel, loadUrl);
      await browserSetBounds(tab.webviewLabel, bounds);
    }
    await browserShow(tab.webviewLabel);
  } catch (err) {
    console.error("browser overlay sync failed", err);
  }
}

let resizeObserver: ResizeObserver | null = null;
let unlistenNav: (() => void) | null = null;
let unlistenDlStart: (() => void) | null = null;
let unlistenDlFin: (() => void) | null = null;
let syncTimer: ReturnType<typeof setTimeout> | null = null;
let syncRaf: number | null = null;

function scheduleSync() {
  if (syncTimer) clearTimeout(syncTimer);
  if (syncRaf != null) cancelAnimationFrame(syncRaf);
  // rAF for fast resize tracking; short timeout coalesces bursts.
  syncRaf = requestAnimationFrame(() => {
    syncRaf = null;
    syncTimer = setTimeout(() => {
      void syncBrowserOverlay();
    }, 16);
  });
}

onMounted(async () => {
  resizeObserver = new ResizeObserver(() => scheduleSync());
  if (hostRef.value) resizeObserver.observe(hostRef.value);
  if (chromeRef.value) resizeObserver.observe(chromeRef.value);
  if (tabStripRef.value) resizeObserver.observe(tabStripRef.value);
  window.addEventListener("resize", scheduleSync);

  try {
    unlistenNav = await listenBrowserNavigated((payload) => {
      center.applyBrowserNavigated(payload.label, payload.url);
      if (payload.url && payload.url !== "about:blank") {
        ensuredBrowserUrl.set(payload.label, payload.url);
      }
    });
    unlistenDlStart = await listenBrowserDownloadStarted((payload) => {
      showDownloadToast(`Saving ${payload.fileName}…`, "info", payload.path);
    });
    unlistenDlFin = await listenBrowserDownloadFinished((payload) => {
      if (payload.success) {
        const name = payload.fileName || "file";
        showDownloadToast(
          `Saved ${name} to Downloads`,
          "ok",
          payload.path,
        );
      } else {
        showDownloadToast("Download failed", "err", null);
      }
    });
  } catch {
    // not in tauri
  }

  scheduleSync();
});

onUnmounted(() => {
  resizeObserver?.disconnect();
  window.removeEventListener("resize", scheduleSync);
  unlistenNav?.();
  unlistenDlStart?.();
  unlistenDlFin?.();
  if (syncTimer) clearTimeout(syncTimer);
  if (syncRaf != null) cancelAnimationFrame(syncRaf);
  if (downloadToastTimer) clearTimeout(downloadToastTimer);
  void browserHideAll();
});

watch(
  () => [
    center.activeId,
    layout.settingsOpen,
    layout.sidebarOpen,
    layout.agentOpen,
    layout.agentWidth,
    isBrowser.value,
    isBrowserStartPage.value,
  ],
  async () => {
    await nextTick();
    if (resizeObserver) {
      resizeObserver.disconnect();
      if (hostRef.value) resizeObserver.observe(hostRef.value);
      if (chromeRef.value) resizeObserver.observe(chromeRef.value);
      if (tabStripRef.value) resizeObserver.observe(tabStripRef.value);
    }
    scheduleSync();
  },
);

watch(hostRef, (el, _prev, onCleanup) => {
  if (!el || !resizeObserver) return;
  resizeObserver.observe(el);
  scheduleSync();
  onCleanup(() => resizeObserver?.unobserve(el));
});

watch(chromeRef, (el, _prev, onCleanup) => {
  if (!el || !resizeObserver) return;
  resizeObserver.observe(el);
  scheduleSync();
  onCleanup(() => resizeObserver?.unobserve(el));
});

function onActivate(id: string) {
  center.activate(id);
  const tab = center.tabs.find((t) => t.id === id);
  if (tab?.kind === "file") {
    void files.openFile(tab.path);
  }
}

async function onClose(e: Event, id: string) {
  e.stopPropagation();
  await center.closeTab(id);
  scheduleSync();
}

function onNewBrowser() {
  center.openBrowserTab();
  scheduleSync();
  nextTick(() => urlInputRef.value?.focus());
}

watch(isBrowserStartPage, (start) => {
  if (start) nextTick(() => urlInputRef.value?.focus());
});

async function onNavigate() {
  const tab = center.activeTab;
  if (!tab || tab.kind !== "browser") return;
  center.updateBrowserDraft(tab.id, draftInput.value);
  await center.navigateActiveBrowser();
  scheduleSync();
}

async function onBack() {
  const tab = center.activeTab;
  if (!tab || tab.kind !== "browser") return;
  await browserBack(tab.webviewLabel);
}

async function onForward() {
  const tab = center.activeTab;
  if (!tab || tab.kind !== "browser") return;
  await browserForward(tab.webviewLabel);
}

async function onReload() {
  const tab = center.activeTab;
  if (!tab || tab.kind !== "browser") return;
  await browserReload(tab.webviewLabel);
}

async function onOpenExternal() {
  const tab = center.activeTab;
  if (!tab || tab.kind !== "browser") return;
  const url = tab.url;
  if (!url || url === "about:blank" || url.startsWith("blob:")) return;
  try {
    await openUrl(url);
  } catch (err) {
    console.error("open external failed", err);
  }
}

const filePreview = computed(() => {
  if (!isFile.value || !active.value || active.value.kind !== "file") return "";
  return files.selectedPath === active.value.path ? files.preview : "";
});
</script>

<template>
  <section
    class="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden bg-white"
  >
    <!-- Tab strip -->
    <header
      ref="tabStripRef"
      class="relative z-20 flex h-9 shrink-0 flex-nowrap items-stretch overflow-hidden border-b border-[#e8e8e8] bg-[#f3f3f3]"
    >
      <div
        class="flex min-w-0 flex-1 flex-nowrap items-stretch overflow-x-auto overflow-y-hidden overscroll-x-contain [scrollbar-width:none] [-ms-overflow-style:none] [&::-webkit-scrollbar]:hidden"
      >
        <button
          v-for="tab in center.tabs"
          :key="tab.id"
          type="button"
          class="group relative flex h-full min-w-[4.5rem] max-w-[9rem] shrink-0 items-center gap-1 overflow-hidden whitespace-nowrap border-r border-[#e8e8e8] px-2 text-[12px] transition-colors"
          :class="
            tab.id === center.activeId
              ? 'bg-white text-[#1e1e1e]'
              : 'bg-transparent text-[#6b6b6b] hover:bg-[#ebebeb]'
          "
          @click="onActivate(tab.id)"
          @click.middle="onClose($event, tab.id)"
        >
          <span
            class="inline-flex h-3.5 w-3.5 shrink-0 items-center justify-center text-[10px] opacity-70"
            aria-hidden="true"
          >
            <template v-if="tabIcon(tab) === 'globe'">
              <svg
                xmlns="http://www.w3.org/2000/svg"
                width="12"
                height="12"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                stroke-width="2"
                stroke-linecap="round"
                stroke-linejoin="round"
              >
                <circle cx="12" cy="12" r="10" />
                <path d="M12 2a14.5 14.5 0 0 0 0 20 14.5 14.5 0 0 0 0-20" />
                <path d="M2 12h20" />
              </svg>
            </template>
            <template v-else-if="tabIcon(tab) === 'html'">&lt;&gt;</template>
            <template v-else-if="tabIcon(tab) === 'json'">{}</template>
            <template v-else-if="tabIcon(tab) === 'js'">JS</template>
            <template v-else-if="tabIcon(tab) === 'pdf'">PDF</template>
            <template v-else>•</template>
          </span>
          <span class="min-w-0 truncate">{{ tab.title }}</span>
          <span
            class="ml-0.5 inline-flex h-4 w-4 shrink-0 items-center justify-center rounded opacity-0 hover:bg-[#e0e0e0] group-hover:opacity-100"
            :class="tab.id === center.activeId ? 'opacity-100' : ''"
            title="Close"
            @click="onClose($event, tab.id)"
          >
            <svg
              xmlns="http://www.w3.org/2000/svg"
              width="10"
              height="10"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              stroke-width="2.5"
              stroke-linecap="round"
              stroke-linejoin="round"
            >
              <path d="M18 6 6 18" />
              <path d="m6 6 12 12" />
            </svg>
          </span>
        </button>

        <button
          type="button"
          class="inline-flex h-full w-8 shrink-0 items-center justify-center text-[#6b6b6b] hover:bg-[#ebebeb] hover:text-[#1e1e1e]"
          title="New browser tab"
          @click="onNewBrowser"
        >
          <svg
            xmlns="http://www.w3.org/2000/svg"
            width="14"
            height="14"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            stroke-width="2"
            stroke-linecap="round"
            stroke-linejoin="round"
          >
            <path d="M5 12h14" />
            <path d="M12 5v14" />
          </svg>
        </button>
      </div>

      <div class="flex shrink-0 items-center gap-0.5 px-1">
        <IconButton title="More actions">
          <svg
            xmlns="http://www.w3.org/2000/svg"
            width="14"
            height="14"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            stroke-width="2"
            stroke-linecap="round"
            stroke-linejoin="round"
          >
            <circle cx="12" cy="12" r="1" />
            <circle cx="19" cy="12" r="1" />
            <circle cx="5" cy="12" r="1" />
          </svg>
        </IconButton>
      </div>
    </header>

    <!-- Browser chrome -->
    <div
      v-if="isBrowser"
      ref="chromeRef"
      class="relative z-20 flex h-10 min-w-0 shrink-0 flex-nowrap items-center gap-0.5 overflow-hidden border-b border-[#e8e8e8] bg-white px-1"
    >
      <IconButton title="Back" @click="onBack">
        <svg
          xmlns="http://www.w3.org/2000/svg"
          width="14"
          height="14"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          stroke-width="2"
          stroke-linecap="round"
          stroke-linejoin="round"
        >
          <path d="m15 18-6-6 6-6" />
        </svg>
      </IconButton>
      <IconButton title="Forward" @click="onForward">
        <svg
          xmlns="http://www.w3.org/2000/svg"
          width="14"
          height="14"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          stroke-width="2"
          stroke-linecap="round"
          stroke-linejoin="round"
        >
          <path d="m9 18 6-6-6-6" />
        </svg>
      </IconButton>
      <IconButton title="Reload" @click="onReload">
        <svg
          xmlns="http://www.w3.org/2000/svg"
          width="14"
          height="14"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          stroke-width="2"
          stroke-linecap="round"
          stroke-linejoin="round"
        >
          <path d="M3 12a9 9 0 0 1 9-9 9.75 9.75 0 0 1 6.74 2.74L21 8" />
          <path d="M21 3v5h-5" />
          <path d="M21 12a9 9 0 0 1-9 9 9.75 9.75 0 0 1-6.74-2.74L3 16" />
          <path d="M8 16H3v5" />
        </svg>
      </IconButton>

      <input
        ref="urlInputRef"
        v-model="draftInput"
        type="text"
        class="min-w-0 w-0 flex-1 truncate rounded-md border border-transparent bg-[#f3f3f3] px-2.5 py-1.5 text-[12px] text-[#1e1e1e] outline-none placeholder:text-[#9a9a9a] focus:border-[#d0d0d0] focus:bg-white"
        placeholder="Enter URL or search..."
        spellcheck="false"
        @keydown.enter.prevent="onNavigate"
        @blur="
          active?.kind === 'browser' &&
            center.updateBrowserDraft(active.id, draftInput)
        "
      />

      <IconButton title="Open in system browser" @click="onOpenExternal">
        <svg
          xmlns="http://www.w3.org/2000/svg"
          width="14"
          height="14"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          stroke-width="2"
          stroke-linecap="round"
          stroke-linejoin="round"
        >
          <path d="M15 3h6v6" />
          <path d="M10 14 21 3" />
          <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" />
        </svg>
      </IconButton>
    </div>

    <!-- Download status sits above the native webview so it stays clickable -->
    <div
      v-if="downloadToast"
      class="flex h-8 shrink-0 items-center gap-2 border-b px-3 text-[12px]"
      :class="
        downloadToast.tone === 'err'
          ? 'border-red-200 bg-red-50 text-red-800'
          : downloadToast.tone === 'ok'
            ? 'border-emerald-200 bg-emerald-50 text-emerald-900'
            : 'border-[#e8e8e8] bg-[#f7f7f7] text-[#3c3c3c]'
      "
    >
      <span class="min-w-0 flex-1 truncate">{{ downloadToast.text }}</span>
      <button
        v-if="downloadToast.path && downloadToast.tone === 'ok'"
        type="button"
        class="shrink-0 rounded px-1.5 py-0.5 text-[11px] font-medium hover:bg-black/5"
        @click="revealDownload"
      >
        Show in Finder
      </button>
      <button
        type="button"
        class="shrink-0 rounded px-1 text-[11px] opacity-60 hover:opacity-100"
        title="Dismiss"
        @click="
          downloadToast = null;
          scheduleSync();
        "
      >
        ×
      </button>
    </div>

    <!-- Body -->
    <div class="relative flex min-h-0 flex-1 flex-col">
      <!-- File preview -->
      <div
        v-if="isFile"
        class="min-h-0 flex-1 overflow-auto px-5 py-4"
      >
        <div v-if="files.previewLoading" class="text-sm text-[#8a8a8a]">
          Reading file…
        </div>
        <div
          v-else-if="files.error && active?.kind === 'file'"
          class="text-sm text-red-600"
        >
          {{ files.error }}
        </div>
        <pre
          v-else
          class="whitespace-pre-wrap break-words font-mono text-xs leading-5 text-[#3c3c3c]"
        >{{ filePreview }}</pre>
      </div>

      <!-- HTML artifact -->
      <iframe
        v-else-if="isHtml && active?.kind === 'html'"
        class="min-h-0 w-full flex-1 border-0 bg-white"
        :src="active.blobUrl"
        :title="active.title"
        referrerpolicy="no-referrer"
        sandbox="allow-scripts allow-same-origin allow-forms allow-popups"
      />

      <!-- PDF artifact -->
      <embed
        v-else-if="isPdf && active?.kind === 'pdf'"
        class="min-h-0 w-full flex-1 border-0 bg-white"
        :src="active.url"
        type="application/pdf"
      />

      <!-- New browser tab start page -->
      <div
        v-else-if="isBrowserStartPage"
        class="flex min-h-0 flex-1 flex-col items-center justify-center bg-white px-6 text-center"
      >
        <div
          class="mb-4 flex h-14 w-14 items-center justify-center rounded-full text-[#b0b0b0]"
          aria-hidden="true"
        >
          <svg
            xmlns="http://www.w3.org/2000/svg"
            width="48"
            height="48"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            stroke-width="1.25"
            stroke-linecap="round"
            stroke-linejoin="round"
          >
            <circle cx="12" cy="12" r="10" />
            <path d="M12 2a14.5 14.5 0 0 0 0 20 14.5 14.5 0 0 0 0-20" />
            <path d="M2 12h20" />
          </svg>
        </div>
        <div class="text-[18px] font-semibold tracking-tight text-[#1e1e1e]">
          Browser
        </div>
        <p class="mt-2 max-w-[360px] text-[13px] leading-relaxed text-[#8a8a8a]">
          Enter a URL above, or instruct the Agent to navigate and use the
          browser
        </p>
      </div>

      <!-- Browser host: in-flow box (not absolute) so overlay bounds match chrome -->
      <div
        v-else-if="isBrowser"
        ref="hostRef"
        class="min-h-0 w-full flex-1 bg-white"
      />

      <!-- Empty workspace -->
      <div
        v-else
        class="flex min-h-0 flex-1 flex-col items-center justify-center gap-2 px-6 text-center text-sm text-[#8a8a8a]"
      >
        <p>Open a workspace file, or press + for a browser tab.</p>
      </div>
    </div>
  </section>
</template>
