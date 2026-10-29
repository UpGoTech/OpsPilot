<script setup lang="ts">
import { computed, ref } from "vue";
import { Dropdown } from "frappe-ui";
import { fsDefaultCwd } from "../lib/tauri";
import {
  buildSessionSections,
  formatRelativeTime,
} from "../lib/sessionGroups";
import { useSessionsStore } from "../stores/sessions";
import { useChatStore } from "../stores/chat";
import { useGatewayStore } from "../stores/gateway";
import { useTabsStore } from "../stores/tabs";
import type { SessionSummary } from "../types";

const props = withDefaults(
  defineProps<{
    compact?: boolean;
  }>(),
  { compact: false },
);

const emit = defineEmits<{
  select: [session: SessionSummary];
}>();

const sessions = useSessionsStore();
const chat = useChatStore();
const gateway = useGatewayStore();
const tabs = useTabsStore();
const query = ref("");
const creating = ref(false);
const menuOpenId = ref<string | null>(null);
const actionError = ref<string | null>(null);

const sections = computed(() =>
  buildSessionSections(
    sessions.sessions,
    new Set(sessions.pinnedIds),
    query.value,
  ),
);

const totalVisible = computed(() =>
  sections.value.reduce((n, s) => n + s.sessions.length, 0),
);

function menuOptions(session: SessionSummary) {
  const pinned = sessions.isPinned(session.id) || Boolean(session.pinned);
  return [
    {
      group: "session",
      hideLabel: true,
      options: [
        {
          label: pinned ? "Unpin" : "Pin",
          icon: "lucide-pin",
          onClick: () => {
            void sessions.togglePin(session.id);
          },
        },
        {
          label: "Delete",
          icon: "lucide-trash-2",
          theme: "red" as const,
          onClick: () => {
            void confirmDelete(session);
          },
        },
      ],
    },
  ];
}

async function confirmDelete(session: SessionSummary) {
  const title = session.title || "Untitled";
  const ok = window.confirm(
    `Delete “${title}”? This permanently removes the session from the gateway.`,
  );
  if (!ok) return;
  actionError.value = null;
  try {
    const wasActive = sessions.activeId === session.id;
    await sessions.removeSession(session.id);
    if (wasActive) {
      const remaining = tabs.openIds.filter((id) => id !== session.id);
      tabs.openIds = remaining;
      const fallback = remaining[0] ?? null;
      if (fallback) await tabs.activateTab(fallback);
      else chat.reset();
    } else {
      tabs.closeTab(session.id);
    }
  } catch (err) {
    actionError.value =
      err instanceof Error ? err.message : `Delete failed: ${String(err)}`;
  }
}

async function createSession() {
  creating.value = true;
  try {
    let cwd: string | undefined;
    try {
      const raw = await fsDefaultCwd(gateway.connection);
      if (typeof raw === "string") cwd = raw;
      else if (raw && typeof raw === "object") {
        const path =
          (raw as Record<string, unknown>).cwd ??
          (raw as Record<string, unknown>).path;
        if (typeof path === "string") cwd = path;
      }
    } catch {
      // optional
    }
    await tabs.newTabSession(cwd);
  } catch (err) {
    sessions.error = err instanceof Error ? err.message : String(err);
  } finally {
    creating.value = false;
  }
}

async function selectSession(session: SessionSummary) {
  await tabs.activateTab(session.id);
  emit("select", session);
}
</script>

<template>
  <aside
    class="flex h-full min-h-0 w-full flex-1 flex-col overflow-hidden bg-[#f7f7f7]"
    :class="props.compact ? '' : 'w-72 shrink-0 border-r border-[#e5e5e5]'"
  >
    <div v-if="!props.compact" class="flex items-center gap-2 px-3 py-3">
      <div class="text-[13px] font-medium text-[#1e1e1e]">Sessions</div>
      <div class="flex-1" />
      <button
        type="button"
        class="rounded-md bg-[#3c3c3c] px-2.5 py-1 text-[12px] text-white disabled:opacity-40"
        :disabled="sessions.loading || creating || !gateway.isConnected"
        @click="createSession"
      >
        New
      </button>
    </div>

    <!-- Cursor-style search -->
    <div class="px-2.5 pb-1 pt-2">
      <div
        class="flex items-center gap-2 rounded-md border border-transparent bg-[#efefef] px-2.5 py-1.5 focus-within:border-[#d0d0d0] focus-within:bg-white"
      >
        <svg
          class="h-3.5 w-3.5 shrink-0 text-[#9a9a9a]"
          xmlns="http://www.w3.org/2000/svg"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          stroke-width="2"
          stroke-linecap="round"
          stroke-linejoin="round"
        >
          <circle cx="11" cy="11" r="8" />
          <path d="m21 21-4.3-4.3" />
        </svg>
        <input
          v-model="query"
          type="search"
          placeholder="Search chats…"
          class="min-w-0 flex-1 bg-transparent text-[12px] text-[#1e1e1e] outline-none placeholder:text-[#9a9a9a]"
        />
      </div>
    </div>

    <div class="min-h-0 flex-1 overflow-y-auto px-1.5 pb-3 pt-1">
      <div
        v-if="!gateway.isConnected"
        class="px-2.5 py-3 text-[12px] text-[#9a9a9a]"
      >
        Connect to a gateway to load history.
      </div>
      <div
        v-else-if="sessions.loading"
        class="px-2.5 py-3 text-[12px] text-[#9a9a9a]"
      >
        Loading…
      </div>
      <div
        v-else-if="sessions.error"
        class="px-2.5 py-3 text-[12px] text-[#c43c3c]"
      >
        {{ sessions.error }}
      </div>
      <div
        v-else-if="!totalVisible && query.trim()"
        class="px-2.5 py-3 text-[12px] text-[#9a9a9a]"
      >
        No chats match “{{ query.trim() }}”.
      </div>
      <div
        v-else-if="!sessions.sessions.length"
        class="px-2.5 py-3 text-[12px] text-[#9a9a9a]"
      >
        No chats yet.
      </div>
      <div v-if="actionError" class="mb-2 px-2.5 text-[11px] text-[#c43c3c]">
        {{ actionError }}
      </div>

      <section v-for="section in sections" :key="section.id" class="mb-2">
        <div
          class="flex items-center gap-1.5 px-2 pb-1 pt-2 text-[10px] font-semibold uppercase tracking-wide text-[#9a9a9a]"
        >
          <span>{{ section.label }}</span>
        </div>
        <div
          v-if="!section.sessions.length && section.hint"
          class="px-2 py-1 text-[11px] text-[#9a9a9a]"
        >
          {{ section.hint }}
        </div>
        <div
          v-for="session in section.sessions"
          :key="`${section.id}:${session.id}`"
          class="group mb-px flex w-full items-center gap-0.5 rounded-md px-1.5 py-1.5 transition-colors"
          :class="
            sessions.activeId === session.id
              ? 'bg-[#e8e8e8] text-[#1e1e1e]'
              : 'text-[#3c3c3c] hover:bg-[#efefef]'
          "
        >
          <button
            type="button"
            class="min-w-0 flex-1 px-1 text-left"
            @click="selectSession(session)"
          >
            <div class="flex items-center gap-2">
              <span
                class="inline-block h-1.5 w-1.5 shrink-0 rounded-full"
                :class="
                  sessions.activeId === session.id
                    ? 'bg-[#1e1e1e]'
                    : 'bg-[#c0c0c0]'
                "
              />
              <div class="min-w-0 flex-1 truncate text-[12.5px] leading-snug">
                {{ session.title || "Untitled" }}
              </div>
              <div
                class="shrink-0 text-[10px] tabular-nums text-[#9a9a9a]"
              >
                {{ formatRelativeTime(session) }}
              </div>
            </div>
          </button>

          <Dropdown
            :open="menuOpenId === `${section.id}:${session.id}`"
            :options="menuOptions(session)"
            align="end"
            side="bottom"
            @update:open="
              (open: boolean) => {
                menuOpenId = open ? `${section.id}:${session.id}` : null;
              }
            "
          >
            <template #trigger>
              <button
                type="button"
                class="flex h-6 w-6 shrink-0 items-center justify-center rounded text-[#9a9a9a] opacity-0 hover:bg-[#e0e0e0] hover:text-[#3c3c3c] group-hover:opacity-100 focus:opacity-100"
                :class="
                  menuOpenId === `${section.id}:${session.id}`
                    ? 'opacity-100'
                    : ''
                "
                aria-label="Session options"
                @click.stop
                @pointerdown.stop
              >
                <span class="text-sm leading-none">⋮</span>
              </button>
            </template>
          </Dropdown>
        </div>
      </section>
    </div>
  </aside>
</template>
