import { defineStore } from "pinia";
import { computed, ref, watch } from "vue";
import { useChatStore } from "./chat";
import { useSessionsStore } from "./sessions";

const TABS_KEY = "opspilot.openSessionTabs";
const ACTIVE_TAB_KEY = "opspilot.activeSessionTab";

function loadTabs(): string[] {
  try {
    const raw = localStorage.getItem(TABS_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.map(String) : [];
  } catch {
    return [];
  }
}

function loadActiveTabId(): string | null {
  try {
    return localStorage.getItem(ACTIVE_TAB_KEY);
  } catch {
    return null;
  }
}

function saveActiveTabId(id: string | null) {
  try {
    if (id) localStorage.setItem(ACTIVE_TAB_KEY, id);
    else localStorage.removeItem(ACTIVE_TAB_KEY);
  } catch {
    // ignore
  }
}

export const useTabsStore = defineStore("tabs", () => {
  const openIds = ref<string[]>(loadTabs());
  const restored = ref(false);

  watch(openIds, (ids) => {
    try {
      localStorage.setItem(TABS_KEY, JSON.stringify(ids));
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
        saveActiveTabId(null);
        useChatStore().reset();
      }
    }
  }

  async function activateTab(sessionId: string) {
    openTab(sessionId);
    saveActiveTabId(sessionId);
    await useChatStore().openSession(sessionId);
  }

  async function newTabSession(cwd?: string) {
    const session = await sessions.create(cwd);
    openTab(session.id);
    saveActiveTabId(session.id);
    useChatStore().reset();
    await useChatStore().openSession(session.id);
    return session;
  }

  /**
   * After sessions.refresh(): keep persisted open tabs that still exist and
   * reopen the last active chat (same idea as center-pane restore).
   */
  async function restoreAfterSessionsLoad() {
    if (restored.value) return;
    restored.value = true;

    const known = new Set(sessions.sessions.map((s) => s.id));
    const kept = openIds.value.filter((id) => known.has(id));
    openIds.value = kept;

    if (!kept.length) {
      saveActiveTabId(null);
      return;
    }

    const saved = loadActiveTabId();
    const pick =
      (saved && kept.includes(saved) ? saved : null) ||
      (sessions.activeId && kept.includes(sessions.activeId)
        ? sessions.activeId
        : null) ||
      kept[kept.length - 1];

    try {
      await activateTab(pick);
    } catch (err) {
      console.error("restore chat tab failed", err);
      // Drop a dead id and try another.
      openIds.value = kept.filter((id) => id !== pick);
      const fallback = openIds.value[openIds.value.length - 1];
      if (fallback) {
        try {
          await activateTab(fallback);
        } catch {
          saveActiveTabId(null);
        }
      } else {
        saveActiveTabId(null);
      }
    }
  }

  // Keep tab list in sync when active session changes elsewhere.
  watch(
    () => sessions.activeId,
    (id) => {
      if (id) {
        openTab(id);
        saveActiveTabId(id);
      }
    },
  );

  if (typeof window !== "undefined") {
    const flush = () => {
      try {
        localStorage.setItem(TABS_KEY, JSON.stringify(openIds.value));
        if (sessions.activeId) saveActiveTabId(sessions.activeId);
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
    openTab,
    closeTab,
    activateTab,
    newTabSession,
    restoreAfterSessionsLoad,
  };
});
