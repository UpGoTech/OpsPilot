<script setup lang="ts">
import { computed, watch } from "vue";
import { Dropdown } from "frappe-ui";
import Composer from "../Composer.vue";
import SessionList from "../SessionList.vue";
import Transcript from "../Transcript.vue";
import IconButton from "./IconButton.vue";
import ResizeHandle from "./ResizeHandle.vue";
import { fsDefaultCwd } from "../../lib/tauri";
import {
  downloadTextFile,
  transcriptToMarkdown,
} from "../../lib/exportTranscript";
import { useChatStore } from "../../stores/chat";
import { useGatewayStore } from "../../stores/gateway";
import { useLayoutStore } from "../../stores/layout";
import { useSessionsStore } from "../../stores/sessions";
import { useTabsStore } from "../../stores/tabs";

const layout = useLayoutStore();
const gateway = useGatewayStore();
const sessions = useSessionsStore();
const chat = useChatStore();
const tabs = useTabsStore();

const activeTitle = computed(() => {
  const id = sessions.activeId;
  if (!id) return "New chat";
  return (
    sessions.sessions.find((s) => s.id === id)?.title ||
    tabs.tabs.find((t) => t.id === id)?.title ||
    "Chat"
  );
});

const menuOptions = computed(() => [
  {
    group: "agent",
    hideLabel: true,
    options: [
      {
        label: "Export transcript (.md)",
        icon: "lucide-download",
        onClick: exportTranscript,
      },
      {
        label: "New chat",
        icon: "lucide-plus",
        onClick: () => {
          void createNew();
        },
      },
      {
        label: layout.agentHistoryOpen ? "Hide history" : "Show history",
        icon: "lucide-history",
        onClick: () => onToggleHistory(),
      },
    ],
  },
]);

watch(
  () => layout.agentHistoryOpen,
  (open) => {
    if (open && gateway.isConnected) {
      void sessions.refresh();
    }
  },
);

function exportTranscript() {
  const md = transcriptToMarkdown(
    activeTitle.value,
    chat.transcriptMessages,
  );
  const safe = activeTitle.value
    .replace(/[^\w\-]+/g, "_")
    .replace(/_+/g, "_")
    .slice(0, 48);
  downloadTextFile(`${safe || "transcript"}.md`, md);
}

async function createNew() {
  layout.closeAgentHistory();
  layout.agentOpen = true;
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
}

async function onSelectTab(id: string) {
  layout.closeAgentHistory();
  await tabs.activateTab(id);
}

function onHistoryPicked() {
  layout.closeAgentHistory();
}

function onToggleHistory() {
  if (layout.agentHistoryOpen) {
    layout.closeAgentHistory();
    return;
  }
  layout.openAgentHistory();
}
</script>

<template>
  <!-- Collapsed rail -->
  <aside
    v-if="!layout.agentOpen"
    class="flex h-full w-11 shrink-0 flex-col items-center gap-1 border-l border-[#e5e5e5] bg-[#f7f7f7] py-2"
  >
    <IconButton title="Show agent" @click="layout.agentOpen = true">
      <svg
        xmlns="http://www.w3.org/2000/svg"
        width="16"
        height="16"
        viewBox="0 0 24 24"
        fill="currentColor"
      >
        <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
      </svg>
    </IconButton>
    <IconButton
      title="New chat"
      :disabled="!gateway.isConnected"
      @click="createNew"
    >
      <svg
        xmlns="http://www.w3.org/2000/svg"
        width="16"
        height="16"
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
    </IconButton>
    <IconButton title="History" @click="onToggleHistory">
      <svg
        xmlns="http://www.w3.org/2000/svg"
        width="16"
        height="16"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        stroke-width="2"
        stroke-linecap="round"
        stroke-linejoin="round"
      >
        <path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8" />
        <path d="M3 3v5h5" />
        <path d="M12 7v5l4 2" />
      </svg>
    </IconButton>
  </aside>

  <!-- Expanded agent -->
  <aside
    v-else
    class="relative flex h-full min-h-0 shrink-0"
    :style="{ width: `${layout.agentWidth}px` }"
  >
    <ResizeHandle
      edge="left"
      :width="layout.agentWidth"
      @resize="layout.setAgentWidth"
    />
    <div
      class="agent-panel relative flex min-w-0 flex-1 flex-col overflow-hidden border-l border-[#e5e5e5] bg-[#f7f7f7]"
    >
      <!-- Tabs + controls -->
      <header
        class="flex h-9 shrink-0 items-center gap-0 border-b border-[#e5e5e5] bg-[#f7f7f7] pl-1 pr-0.5"
      >
        <div
          class="flex min-w-0 flex-1 items-stretch overflow-x-auto [scrollbar-width:none] [-ms-overflow-style:none] [&::-webkit-scrollbar]:hidden"
        >
          <div
            v-for="tab in tabs.tabs"
            :key="tab.id"
            class="group flex max-w-[168px] shrink-0 items-center"
            :class="
              tab.active
                ? 'border-b-2 border-[#1e1e1e] text-[#1e1e1e]'
                : 'border-b-2 border-transparent text-[#6b6b6b] hover:text-[#3c3c3c]'
            "
          >
            <button
              type="button"
              class="flex min-w-0 flex-1 items-center gap-1.5 px-2 py-1.5 text-left text-[12px]"
              @click="onSelectTab(tab.id)"
            >
              <svg
                class="h-3.5 w-3.5 shrink-0 opacity-70"
                xmlns="http://www.w3.org/2000/svg"
                viewBox="0 0 24 24"
                fill="currentColor"
              >
                <path
                  d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"
                />
              </svg>
              <span class="truncate" :title="tab.title">{{ tab.title }}</span>
            </button>
            <button
              type="button"
              class="mr-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded text-[#9a9a9a] hover:bg-[#e8e8e8] hover:text-[#3c3c3c]"
              title="Close"
              @click.stop="tabs.closeTab(tab.id)"
            >
              <svg
                xmlns="http://www.w3.org/2000/svg"
                width="11"
                height="11"
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
            </button>
          </div>
          <div
            v-if="!tabs.tabs.length"
            class="flex items-center px-2.5 text-[12px] text-[#9a9a9a]"
          >
            {{ activeTitle }}
          </div>
        </div>

        <div class="flex shrink-0 items-center pr-0.5">
          <IconButton
            title="New chat"
            :disabled="!gateway.isConnected"
            @click="createNew"
          >
            <svg
              xmlns="http://www.w3.org/2000/svg"
              width="15"
              height="15"
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
          </IconButton>
          <IconButton
            title="History"
            :active="layout.agentHistoryOpen"
            @click="onToggleHistory"
          >
            <svg
              xmlns="http://www.w3.org/2000/svg"
              width="15"
              height="15"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              stroke-width="2"
              stroke-linecap="round"
              stroke-linejoin="round"
            >
              <path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8" />
              <path d="M3 3v5h5" />
              <path d="M12 7v5l4 2" />
            </svg>
          </IconButton>
          <Dropdown :options="menuOptions" align="end" side="bottom">
            <template #trigger>
              <button
                type="button"
                class="inline-flex h-7 w-7 items-center justify-center rounded-md text-[#6b6b6b] hover:bg-[#ebebeb] hover:text-[#3c3c3c]"
                title="More"
              >
                <svg
                  xmlns="http://www.w3.org/2000/svg"
                  width="15"
                  height="15"
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
              </button>
            </template>
          </Dropdown>
          <IconButton title="Hide agent" @click="layout.toggleAgent()">
            <svg
              xmlns="http://www.w3.org/2000/svg"
              width="15"
              height="15"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              stroke-width="2"
              stroke-linecap="round"
              stroke-linejoin="round"
            >
              <rect width="18" height="18" x="3" y="3" rx="2" />
              <path d="M15 3v18" />
            </svg>
          </IconButton>
        </div>
      </header>

      <div
        v-if="layout.agentHistoryOpen"
        class="flex min-h-0 flex-1 flex-col bg-[#f7f7f7]"
      >
        <SessionList compact @select="onHistoryPicked" />
      </div>

      <template v-else>
        <Transcript />
        <Composer />
      </template>
    </div>
  </aside>
</template>
