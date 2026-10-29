import { defineStore } from "pinia";
import { computed, ref, watch } from "vue";
import {
  browserClose,
  browserCreate,
  browserHideAll,
  browserNavigate,
  isBrowserLabelCreated,
} from "../lib/browserWebview";
import { useFilesStore } from "./files";

export type CenterTab =
  | { id: string; kind: "file"; path: string; title: string }
  | {
      id: string;
      kind: "html";
      title: string;
      blobUrl: string;
      /** Stable content fingerprint — used to avoid reopening closed previews. */
      fingerprint: string;
    }
  | { id: string; kind: "pdf"; title: string; url: string }
  | {
      id: string;
      kind: "browser";
      title: string;
      url: string;
      draft: string;
      webviewLabel: string;
    };

/** Tabs that survive restart (blob HTML/PDF cannot). */
type PersistedTab =
  | { id: string; kind: "file"; path: string; title: string }
  | {
      id: string;
      kind: "browser";
      title: string;
      url: string;
      draft: string;
      webviewLabel: string;
    };

type CenterTabsSnapshot = {
  tabs: PersistedTab[];
  activeId: string | null;
};

const DISMISSED_HTML_KEY = "opspilot.dismissedHtml";
const CENTER_TABS_KEY = "opspilot.centerTabs";

function htmlFingerprint(html: string, title: string) {
  return `${title}|${html.length}|${html.slice(0, 120)}|${html.slice(-80)}`;
}

function loadDismissedHtml(): Set<string> {
  try {
    const raw = localStorage.getItem(DISMISSED_HTML_KEY);
    if (!raw) return new Set();
    const parsed = JSON.parse(raw);
    const list = Array.isArray(parsed) ? parsed.map(String) : [];
    return new Set(list.slice(-80));
  } catch {
    return new Set();
  }
}

function saveDismissedHtml(set: Set<string>) {
  try {
    localStorage.setItem(
      DISMISSED_HTML_KEY,
      JSON.stringify([...set].slice(-80)),
    );
  } catch {
    // ignore
  }
}

function toPersisted(tabs: CenterTab[]): PersistedTab[] {
  const out: PersistedTab[] = [];
  for (const t of tabs) {
    if (t.kind === "file") {
      out.push({ id: t.id, kind: "file", path: t.path, title: t.title });
    } else if (t.kind === "browser") {
      out.push({
        id: t.id,
        kind: "browser",
        title: t.title,
        url: t.url.startsWith("blob:") ? "about:blank" : t.url,
        draft: t.draft.startsWith("blob:") ? "" : t.draft,
        webviewLabel: t.webviewLabel,
      });
    }
    // html / pdf (often blob:) — ephemeral, skip
  }
  return out;
}

function loadSnapshot(): CenterTabsSnapshot | null {
  try {
    const raw = localStorage.getItem(CENTER_TABS_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as CenterTabsSnapshot;
    if (!parsed || !Array.isArray(parsed.tabs)) return null;
    const tabs: PersistedTab[] = [];
    for (const row of parsed.tabs) {
      if (!row || typeof row !== "object") continue;
      if (row.kind === "file" && typeof row.path === "string") {
        tabs.push({
          id: String(row.id || nextId("file")),
          kind: "file",
          path: row.path,
          title: String(row.title || basename(row.path)),
        });
      } else if (row.kind === "browser") {
        const id = String(row.id || nextId("browser"));
        const url = String(row.url || "about:blank");
        const draft = String(row.draft ?? (url === "about:blank" ? "" : url));
        tabs.push({
          id,
          kind: "browser",
          title: String(row.title || titleFromUrl(url)),
          url: url.startsWith("blob:") ? "about:blank" : url,
          draft: draft.startsWith("blob:") ? "" : draft,
          webviewLabel: String(row.webviewLabel || id),
        });
      }
    }
    const activeId =
      typeof parsed.activeId === "string" &&
      tabs.some((t) => t.id === parsed.activeId)
        ? parsed.activeId
        : (tabs[0]?.id ?? null);
    return { tabs, activeId };
  } catch {
    return null;
  }
}

function saveSnapshot(tabs: CenterTab[], activeId: string | null) {
  try {
    const persisted = toPersisted(tabs);
    let active = activeId;
    if (active && !persisted.some((t) => t.id === active)) {
      active = persisted[persisted.length - 1]?.id ?? null;
    }
    const payload: CenterTabsSnapshot = { tabs: persisted, activeId: active };
    localStorage.setItem(CENTER_TABS_KEY, JSON.stringify(payload));
  } catch {
    // ignore
  }
}

let seq = 0;
function nextId(prefix: string) {
  seq += 1;
  return `${prefix}-${Date.now().toString(36)}-${seq}`;
}

function basename(path: string) {
  return path.split(/[/\\]/).filter(Boolean).pop() || path;
}

function titleFromUrl(url: string) {
  if (!url || url === "about:blank") return "Browser Tab";
  try {
    const u = new URL(url);
    return u.hostname || u.href;
  } catch {
    return url;
  }
}

function isRealBrowserUrl(url: string) {
  const u = (url || "").trim();
  return Boolean(u) && u !== "about:blank" && !u.startsWith("blob:");
}

/** Prefer an http(s) draft when url was wiped to about:blank by webview events. */
function normalizeBrowserFields(url: string, draft: string, title: string) {
  let nextUrl = url;
  let nextDraft = draft;
  if (!isRealBrowserUrl(nextUrl) && isRealBrowserUrl(nextDraft)) {
    let raw = nextDraft.trim();
    if (!/^https?:\/\//i.test(raw) && !/^about:/i.test(raw)) {
      raw = `https://${raw}`;
    }
    nextUrl = raw;
    nextDraft = raw;
  }
  if (!isRealBrowserUrl(nextUrl) && isRealBrowserUrl(title) && title.includes(".")) {
    // Last resort: title sometimes still holds the hostname from a prior visit.
    nextUrl = title.startsWith("http") ? title : `https://${title}`;
    if (!nextDraft.trim()) nextDraft = nextUrl;
  }
  return {
    url: nextUrl || "about:blank",
    draft: nextDraft,
    title: isRealBrowserUrl(nextUrl) ? titleFromUrl(nextUrl) : title || "Browser Tab",
  };
}

export const useCenterTabsStore = defineStore("centerTabs", () => {
  const tabs = ref<CenterTab[]>([]);
  const activeId = ref<string | null>(null);
  const dismissedHtml = ref<Set<string>>(loadDismissedHtml());
  const hydrated = ref(false);

  const activeTab = computed(
    () => tabs.value.find((t) => t.id === activeId.value) ?? null,
  );

  watch(
    [tabs, activeId],
    () => {
      if (!hydrated.value) return;
      saveSnapshot(tabs.value, activeId.value);
    },
    { deep: true },
  );

  function activate(id: string) {
    if (!tabs.value.some((t) => t.id === id)) return;
    activeId.value = id;
  }

  async function openFileTab(path: string) {
    const existing = tabs.value.find(
      (t) => t.kind === "file" && t.path === path,
    );
    if (existing) {
      activeId.value = existing.id;
    } else {
      const tab: CenterTab = {
        id: nextId("file"),
        kind: "file",
        path,
        title: basename(path),
      };
      tabs.value = [...tabs.value, tab];
      activeId.value = tab.id;
    }
    await useFilesStore().openFile(path);
  }

  function openHtmlDocument(
    html: string,
    title = "HTML preview",
    opts?: { force?: boolean },
  ) {
    const fingerprint = htmlFingerprint(html, title);
    const existing = tabs.value.find(
      (t) => t.kind === "html" && t.fingerprint === fingerprint,
    );
    if (existing) {
      if (opts?.force) activeId.value = existing.id;
      return;
    }
    if (!opts?.force && dismissedHtml.value.has(fingerprint)) {
      return;
    }
    if (opts?.force && dismissedHtml.value.has(fingerprint)) {
      const next = new Set(dismissedHtml.value);
      next.delete(fingerprint);
      dismissedHtml.value = next;
      saveDismissedHtml(next);
    }
    const blob = new Blob([html], { type: "text/html;charset=utf-8" });
    const blobUrl = URL.createObjectURL(blob);
    const tab: CenterTab = {
      id: nextId("html"),
      kind: "html",
      title,
      blobUrl,
      fingerprint,
    };
    tabs.value = [...tabs.value, tab];
    activeId.value = tab.id;
  }

  async function clearHtmlTabs() {
    const htmlTabs = tabs.value.filter((t) => t.kind === "html");
    for (const tab of htmlTabs) {
      await closeTab(tab.id);
    }
  }

  function openBlobInBrowser(blob: Blob, title = "Preview") {
    const blobUrl = URL.createObjectURL(blob);
    if (blob.type.includes("pdf")) {
      const tab: CenterTab = {
        id: nextId("pdf"),
        kind: "pdf",
        title,
        url: blobUrl,
      };
      tabs.value = [...tabs.value, tab];
      activeId.value = tab.id;
      return;
    }
    const tab: CenterTab = {
      id: nextId("html"),
      kind: "html",
      title,
      blobUrl,
      fingerprint: htmlFingerprint(`blob:${blob.size}:${blob.type}`, title),
    };
    tabs.value = [...tabs.value, tab];
    activeId.value = tab.id;
  }

  function openPdfPreview(url: string, filename: string) {
    const tab: CenterTab = {
      id: nextId("pdf"),
      kind: "pdf",
      title: filename,
      url,
    };
    tabs.value = [...tabs.value, tab];
    activeId.value = tab.id;
  }

  function openBrowserTab(initialUrl?: string) {
    const id = nextId("browser");
    const url = initialUrl?.trim() || "";
    const tab: CenterTab = {
      id,
      kind: "browser",
      title: url ? titleFromUrl(url) : "Browser Tab",
      url: url || "about:blank",
      draft: url,
      webviewLabel: id,
    };
    tabs.value = [...tabs.value, tab];
    activeId.value = tab.id;
    return tab;
  }

  function openOrFocusBrowser() {
    const browsers = tabs.value.filter((t) => t.kind === "browser");
    const last = browsers[browsers.length - 1];
    if (last) {
      activeId.value = last.id;
      return last;
    }
    return openBrowserTab();
  }

  function updateBrowserDraft(id: string, draft: string) {
    tabs.value = tabs.value.map((t) =>
      t.kind === "browser" && t.id === id ? { ...t, draft } : t,
    );
  }

  function applyBrowserNavigated(label: string, url: string) {
    if (url.startsWith("blob:") || url.startsWith("asset:")) return;
    tabs.value = tabs.value.map((t) => {
      if (t.kind !== "browser" || t.webviewLabel !== label) return t;
      // WKWebView often emits about:blank around create/show — never clobber a real URL.
      if (url === "about:blank") {
        return t;
      }
      return {
        ...t,
        url,
        draft: url,
        title: titleFromUrl(url),
      };
    });
    // Persist immediately so a restart mid-session keeps the site.
    if (hydrated.value) saveSnapshot(tabs.value, activeId.value);
  }

  async function navigateActiveBrowser() {
    const tab = activeTab.value;
    if (!tab || tab.kind !== "browser") return;
    let raw = tab.draft.trim();
    if (!raw) return;
    if (raw.startsWith("blob:") || raw.startsWith("asset:")) return;
    if (!/^https?:\/\//i.test(raw) && !/^about:/i.test(raw)) {
      raw = `https://${raw}`;
    }
    try {
      if (!isBrowserLabelCreated(tab.webviewLabel)) {
        await browserCreate(tab.webviewLabel, {
          x: 0,
          y: 0,
          width: 1,
          height: 1,
        });
      }
      const href = await browserNavigate(tab.webviewLabel, raw);
      applyBrowserNavigated(tab.webviewLabel, href);
    } catch (err) {
      console.error("browser navigate failed", err);
    }
  }

  async function closeTab(id: string) {
    const idx = tabs.value.findIndex((t) => t.id === id);
    if (idx < 0) return;
    const tab = tabs.value[idx];

    if (tab.kind === "html") {
      URL.revokeObjectURL(tab.blobUrl);
      const nextDismissed = new Set(dismissedHtml.value);
      nextDismissed.add(tab.fingerprint);
      dismissedHtml.value = nextDismissed;
      saveDismissedHtml(nextDismissed);
    } else if (tab.kind === "pdf" && tab.url.startsWith("blob:")) {
      URL.revokeObjectURL(tab.url);
    } else if (tab.kind === "browser") {
      try {
        await browserClose(tab.webviewLabel);
      } catch {
        // ignore
      }
    }

    const next = tabs.value.filter((t) => t.id !== id);
    tabs.value = next;

    if (next.length === 0) {
      // Always keep at least one browser tab in the center pane.
      openBrowserTab();
      return;
    }

    if (activeId.value === id) {
      const fallback = next[Math.max(0, idx - 1)] ?? next[0] ?? null;
      activeId.value = fallback?.id ?? null;
      if (fallback?.kind === "file") {
        void useFilesStore().openFile(fallback.path);
      }
    }
  }

  async function hideBrowsersForOverlay() {
    try {
      await browserHideAll();
    } catch {
      // ignore when not in tauri
    }
  }

  /** Restore persisted file/browser tabs, or open one empty browser tab. */
  function hydrate() {
    if (hydrated.value) return;
    const snap = loadSnapshot();
    if (snap && snap.tabs.length > 0) {
      tabs.value = snap.tabs.map((t) => {
        if (t.kind !== "browser") return { ...t };
        const norm = normalizeBrowserFields(t.url, t.draft, t.title);
        return { ...t, ...norm };
      });
      activeId.value =
        snap.activeId && snap.tabs.some((t) => t.id === snap.activeId)
          ? snap.activeId
          : snap.tabs[0].id;
    } else {
      openBrowserTab();
    }
    hydrated.value = true;
    saveSnapshot(tabs.value, activeId.value);

    if (typeof window !== "undefined") {
      const flush = () => saveSnapshot(tabs.value, activeId.value);
      window.addEventListener("pagehide", flush);
      window.addEventListener("beforeunload", flush);
    }
  }

  /** Reload active file preview after gateway is ready. */
  async function restoreActiveContent() {
    const tab = activeTab.value;
    if (tab?.kind === "file") {
      try {
        await useFilesStore().openFile(tab.path);
      } catch {
        // gateway may still be down
      }
    }
  }

  /** URL the native webview should load for a browser tab (empty = start page). */
  function browserLoadUrl(tab: CenterTab): string | null {
    if (tab.kind !== "browser") return null;
    const norm = normalizeBrowserFields(tab.url, tab.draft, tab.title);
    return isRealBrowserUrl(norm.url) ? norm.url : null;
  }

  return {
    tabs,
    activeId,
    activeTab,
    hydrated,
    activate,
    openFileTab,
    openHtmlDocument,
    openBlobInBrowser,
    openPdfPreview,
    openBrowserTab,
    openOrFocusBrowser,
    updateBrowserDraft,
    applyBrowserNavigated,
    navigateActiveBrowser,
    closeTab,
    clearHtmlTabs,
    hideBrowsersForOverlay,
    hydrate,
    restoreActiveContent,
    browserLoadUrl,
  };
});
