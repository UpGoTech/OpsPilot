import { defineStore } from "pinia";
import { computed, ref, watch } from "vue";
import { useChatStore } from "./chat";
import { useSessionsStore } from "./sessions";

const TABS_KEY = "opspilot.openSessionTabs";
const ACTIVE_TAB_KEY = "opspilot.activeSessionTab";

function tabsStorageKey(siteKey?: string | null): string {
  const key = siteKey?.trim().toLowerCase();
  return key ? `${TABS_KEY}.${key}` : TABS_KEY;
}

function activeTabStorageKey(siteKey?: string | null): string {
  const key = siteKey?.trim().toLowerCase();
  return key ? `${ACTIVE_TAB_KEY}.${key}` : ACTIVE_TAB_KEY;
}

function loadTabs(siteKey?: string | null): string[] {
  try {
    const raw = localStorage.getItem(tabsStorageKey(siteKey));
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.map(String) : [];
  } catch {
    return [];
  }
}

function loadActiveTabId(siteKey?: string | null): string | null {
  try {
    return localStorage.getItem(activeTabStorageKey(siteKey));
  } catch {
    return null;
  }
}

function saveActiveTabId(id: string | null, siteKey?: string | null) {
  try {
    const key = activeTabStorageKey(siteKey);
    if (id) localStorage.setItem(key, id);
    else localStorage.removeItem(key);
  } catch {
    // ignore
  }
}

export const useTabsStore = defineStore("tabs", () => {
  let boundSiteKey: string | null = null;
  const openIds = ref<string[]>(loadTabs());
  const restored = ref(false);

  function bindSite(siteKey: string | null) {
    boundSiteKey = siteKey?.trim().toLowerCase() || null;
    openIds.value = loadTabs(boundSiteKey);
    restored.value = false;
  }

  watch(openIds, (ids) => {
    try {
      localStorage.setItem(tabsStorageKey(boundSiteKey), JSON.stringify(ids));
    } catch {
      // ignore
    }
  });

  const sessions = useSessionsStore();

  const tabs = computed(() =>
    openIds.value.map((id) => {
      const row = sessions.sessions.find((s) => s.id === id);
      return {
        id,
        title: row?.title || (id === sessions.activeId ? "Chat" : "Session"),
        active: sessions.activeId === id,
      };
    }),
  );

  function openTab(sessionId: string) {
    if (!openIds.value.includes(sessionId)) {
      openIds.value = [...openIds.value, sessionId];
    }
  }

  /** Remove a dead/deleted id from open tabs without activating a fallback. */
  function pruneClosedSession(sessionId: string) {
    if (!openIds.value.includes(sessionId)) {
      if (loadActiveTabId(boundSiteKey) === sessionId) {
        saveActiveTabId(null, boundSiteKey);
      }
      return;
    }
    openIds.value = openIds.value.filter((id) => id !== sessionId);
    if (loadActiveTabId(boundSiteKey) === sessionId) {
      saveActiveTabId(sessions.activeId, boundSiteKey);
    }
  }

  function closeTab(sessionId: string) {
    const idx = openIds.value.indexOf(sessionId);
    if (idx < 0) return;
    const next = openIds.value.filter((id) => id !== sessionId);
    openIds.value = next;
    if (sessions.activeId === sessionId) {
      const fallback = next[Math.max(0, idx - 1)] ?? next[0] ?? null;
      if (fallback) {
        void activateTab(fallback);
      } else {
        saveActiveTabId(null, boundSiteKey);
        useChatStore().reset();
      }
    }
  }

  async function activateTab(sessionId: string) {
    openTab(sessionId);
    saveActiveTabId(sessionId, boundSiteKey);
    await useChatStore().openSession(sessionId);
  }

  async function newTabSession(cwd?: string) {
    const session = await sessions.create(cwd);
    openTab(session.id);
    saveActiveTabId(session.id, boundSiteKey);
    // create() already resumes; openSession loads empty history + clears prompts.
    await useChatStore().openSession(session.id);
    return session;
  }

  /**
   * After sessions.refresh(): always prune tabs that vanished on the gateway.
   * Auto-activate only on first restore, or when there is no healthy active id.
   */
  async function restoreAfterSessionsLoad() {
    const known = new Set(sessions.sessions.map((s) => s.id));
    const kept = openIds.value.filter((id) => known.has(id));
    openIds.value = kept;

    const saved = loadActiveTabId(boundSiteKey);
    if (saved && !known.has(saved)) {
      saveActiveTabId(null, boundSiteKey);
    }

    if (!kept.length) {
      saveActiveTabId(null, boundSiteKey);
      restored.value = true;
      return;
    }

    const activeHealthy =
      sessions.activeId && known.has(sessions.activeId)
        ? sessions.activeId
        : null;

    // Reconnect with a still-valid active session — sync tab chrome only.
    if (restored.value && activeHealthy) {
      openTab(activeHealthy);
      saveActiveTabId(activeHealthy, boundSiteKey);
      return;
    }

    const pick =
      activeHealthy ||
      (saved && kept.includes(saved) ? saved : null) ||
      kept[kept.length - 1];

    restored.value = true;

    try {
      await activateTab(pick);
    } catch (err) {
      console.error("restore chat tab failed", err);
      // Drop a dead id and try another.
      openIds.value = openIds.value.filter((id) => id !== pick);
      const fallback = openIds.value[openIds.value.length - 1];
      if (fallback) {
        try {
          await activateTab(fallback);
        } catch {
          saveActiveTabId(null, boundSiteKey);
        }
      } else {
        saveActiveTabId(null, boundSiteKey);
      }
    }
  }

  // Keep tab list in sync when active session changes elsewhere.
  watch(
    () => sessions.activeId,
    (id) => {
      if (id) {
        openTab(id);
        saveActiveTabId(id, boundSiteKey);
      }
    },
  );

  // External delete / dropSessionLocally — prune ghost open tabs.
  watch(
    () => sessions.sessions.map((s) => s.id).join("\0"),
    () => {
      const known = new Set(sessions.sessions.map((s) => s.id));
      const next = openIds.value.filter((id) => known.has(id));
      if (next.length !== openIds.value.length) {
        openIds.value = next;
      }
      const saved = loadActiveTabId(boundSiteKey);
      if (saved && !known.has(saved)) {
        saveActiveTabId(sessions.activeId, boundSiteKey);
      }
    },
  );

  if (typeof window !== "undefined") {
    const flush = () => {
      try {
        localStorage.setItem(
          tabsStorageKey(boundSiteKey),
          JSON.stringify(openIds.value),
        );
        if (sessions.activeId) {
          saveActiveTabId(sessions.activeId, boundSiteKey);
        }
      } catch {
        // ignore
      }
    };
    window.addEventListener("pagehide", flush);
    window.addEventListener("beforeunload", flush);
  }

  return {
    openIds,
    tabs,
    bindSite,
    openTab,
    closeTab,
    pruneClosedSession,
    activateTab,
    newTabSession,
    restoreAfterSessionsLoad,
  };
});
