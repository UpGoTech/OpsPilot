<script setup lang="ts">
import { computed, ref } from "vue";
import SessionList from "../../../src/components/SessionList.vue";
import Transcript from "../../../src/components/Transcript.vue";
import {
  downloadTextFile,
  transcriptToMarkdown,
} from "../../../src/lib/exportTranscript";
import { useChatStore } from "../../../src/stores/chat";
import { useErpnextStore } from "../../../src/stores/erpnext";
import { useGatewayStore } from "../../../src/stores/gateway";
import { useLayoutStore } from "../../../src/stores/layout";
import { useSessionsStore } from "../../../src/stores/sessions";
import { useTabsStore } from "../../../src/stores/tabs";
import { useErpnextContext } from "../composables/useErpnextContext";
import SideComposer from "./SideComposer.vue";
import SideHeader from "./SideHeader.vue";
import SidePageContext from "./SidePageContext.vue";
import SideSuggestions from "./SideSuggestions.vue";

const emit = defineEmits<{
  logout: [];
  settings: [];
}>();

const chat = useChatStore();
const erpnext = useErpnextStore();
const gateway = useGatewayStore();
const layout = useLayoutStore();
const sessions = useSessionsStore();
const tabs = useTabsStore();
const { page, isErpnextActive, siteHost } = useErpnextContext();

const composer = ref<InstanceType<typeof SideComposer> | null>(null);
const seed = ref("");

/** Chat interactions require the focused tab to be the configured ERPNext site. */
const chatDisabled = computed(() => !isErpnextActive.value);

const showEmpty = computed(
  () =>
    !chat.loadingHistory &&
    chat.turns.length === 0 &&
    !layout.agentHistoryOpen,
);

const composerPlaceholder = computed(() => {
  if (chatDisabled.value) return "Switch to your ERPNext tab to chat";
  return showEmpty.value
    ? "How can I help you today?"
    : "Ask a question about the content of this page";
});

async function createNew() {
  if (chatDisabled.value) return;
  layout.closeAgentHistory();
  await sessions.create();
}

async function onHistoryPicked() {
  layout.closeAgentHistory();
}

function onSuggestion(prompt: string) {
  if (chatDisabled.value) return;
  seed.value = prompt;
  composer.value?.setDraft(prompt);
}

async function exportTranscript() {
  const title =
    sessions.sessions.find((s) => s.id === sessions.activeId)?.title ||
    tabs.tabs.find((t) => t.id === sessions.activeId)?.title ||
    "chat";
  const md = transcriptToMarkdown(chat.turns, title);
  downloadTextFile(`${title.replace(/[^\w.\-]+/g, "_") || "chat"}.md`, md);
}

async function focusErpnextTab() {
  const host = siteHost.value;
  if (!host) {
    emit("settings");
    return;
  }
  try {
    const all = await chrome.tabs.query({});
    const hit = all.find((t) => {
      try {
        return t.url && new URL(t.url).host.toLowerCase() === host;
      } catch {
        return false;
      }
    });
    if (hit?.id != null) {
      await chrome.tabs.update(hit.id, { active: true });
      if (hit.windowId != null) {
        await chrome.windows.update(hit.windowId, { focused: true });
      }
      return;
    }
  } catch {
    // fall through
  }
  // No open ERPNext tab — open the configured site.
  const url = erpnext.siteUrl.trim();
  if (url) await chrome.tabs.create({ url });
}
</script>

<template>
  <div
    class="side-chat flex h-full min-h-0 flex-col bg-white"
    :class="chatDisabled ? 'is-erpnext-inactive' : ''"
  >
    <SideHeader
      @logout="emit('logout')"
      @settings="emit('settings')"
      @history="layout.openAgentHistory()"
      @new-chat="createNew"
      @export="exportTranscript"
    />

    <div
      v-if="chatDisabled"
      class="side-disabled-banner flex items-start gap-2 border-b border-[#e6ebe0] bg-[#f3f6ef] px-4 py-2.5"
    >
      <div class="min-w-0 flex-1">
        <div class="text-[12.5px] font-medium text-[#1a1a1a]">
          OpsPilot is paused
        </div>
        <p class="mt-0.5 text-[12px] leading-snug text-[#5c5c5c]">
          Switch to your ERPNext tab
          <span v-if="siteHost" class="font-medium text-[#3a3a3a]"
            >({{ siteHost }})</span
          >
          to chat. Settings and history stay available.
        </p>
      </div>
      <button
        type="button"
        class="shrink-0 rounded-full bg-[#1a1a1a] px-2.5 py-1 text-[11px] font-medium text-white"
        @click="focusErpnextTab"
      >
        Open ERPNext
      </button>
    </div>

    <div
      v-else-if="gateway.lastError && !gateway.isConnected"
      class="flex items-center justify-between gap-2 border-b border-[#ececec] bg-[#fff5f5] px-4 py-2 text-[12px] text-[#b42318]"
    >
      <span class="truncate">{{ gateway.lastError }}</span>
      <button
        type="button"
        class="shrink-0 text-[12px] font-medium underline"
        @click="emit('settings')"
      >
        Settings
      </button>
    </div>

    <div
      v-if="layout.agentHistoryOpen"
      class="flex min-h-0 flex-1 flex-col bg-white"
    >
      <div
        class="flex h-10 shrink-0 items-center justify-between border-b border-[#ececec] px-4"
      >
        <div class="text-[13px] font-medium text-[#1a1a1a]">
          Conversation history
        </div>
        <button
          type="button"
          class="side-icon-btn"
          title="Back"
          @click="layout.closeAgentHistory()"
        >
          <svg
            xmlns="http://www.w3.org/2000/svg"
            width="16"
            height="16"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            stroke-width="1.75"
            stroke-linecap="round"
            stroke-linejoin="round"
          >
            <path d="M18 6 6 18" />
            <path d="m6 6 12 12" />
          </svg>
        </button>
      </div>
      <SessionList compact @select="onHistoryPicked" />
    </div>

    <template v-else>
      <div
        class="side-chat-body min-h-0 flex-1 overflow-y-auto px-3 pt-2"
        :class="chatDisabled ? 'opacity-50' : ''"
      >
        <SideSuggestions
          v-if="showEmpty"
          :disabled="chatDisabled"
          @pick="onSuggestion"
        />
        <Transcript v-else />
      </div>

      <div class="shrink-0 bg-white pt-1">
        <SidePageContext :page="page" :active="isErpnextActive" />
        <SideComposer
          ref="composer"
          :placeholder="composerPlaceholder"
          :seed="seed"
          :disabled="chatDisabled"
        />
      </div>
    </template>
  </div>
</template>
