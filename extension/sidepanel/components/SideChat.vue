<script setup lang="ts">
import { computed, ref } from "vue";
import SessionList from "../../../src/components/SessionList.vue";
import Transcript from "../../../src/components/Transcript.vue";
import {
  downloadTextFile,
  transcriptToMarkdown,
} from "../../../src/lib/exportTranscript";
import { useChatStore } from "../../../src/stores/chat";
import { useGatewayStore } from "../../../src/stores/gateway";
import { useLayoutStore } from "../../../src/stores/layout";
import { useSessionsStore } from "../../../src/stores/sessions";
import { useTabsStore } from "../../../src/stores/tabs";
import { useErpnextContext } from "../composables/useErpnextContext";
import { useHermesSiteLinks } from "../composables/useHermesSiteLinks";
import SideComposer from "./SideComposer.vue";
import SideHeader from "./SideHeader.vue";
import SideSuggestions from "./SideSuggestions.vue";

const emit = defineEmits<{
  logout: [];
  settings: [];
}>();

const chat = useChatStore();
const gateway = useGatewayStore();
const layout = useLayoutStore();
const sessions = useSessionsStore();
const tabs = useTabsStore();
const { isErpnextActive } = useErpnextContext();
useHermesSiteLinks();

const composer = ref<InstanceType<typeof SideComposer> | null>(null);
const seed = ref("");

/** Defense in depth — App overlay is primary; keep inputs locked if overlay misses. */
const chatDisabled = computed(() => !isErpnextActive.value);

const showEmpty = computed(
  () =>
    !chat.loadingHistory &&
    chat.turns.length === 0 &&
    !layout.agentHistoryOpen,
);

const composerPlaceholder = computed(() =>
  showEmpty.value ? "How can I help you today?" : "Message OpsPilot…",
);

async function createNew() {
  if (chatDisabled.value) return;
  layout.closeAgentHistory();
  try {
    await tabs.newTabSession();
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    chat.error = message;
    sessions.error = message;
  }
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
  const md = transcriptToMarkdown(title, chat.messages);
  downloadTextFile(`${title.replace(/[^\w.\-]+/g, "_") || "chat"}.md`, md);
}
</script>

<template>
  <div class="side-chat flex h-full min-h-0 flex-col bg-white">
    <SideHeader
      @logout="emit('logout')"
      @settings="emit('settings')"
      @history="layout.openAgentHistory()"
      @new-chat="createNew"
      @export="exportTranscript"
      @refresh="chat.reprocessTranscript()"
    />

    <div
      v-if="gateway.lastError && !gateway.isConnected"
      class="flex items-center justify-between gap-2 border-b border-[#ececec] bg-[#fff5f5] px-4 py-2 text-[12px] text-[#b42318]"
    >
      <span class="truncate">{{ gateway.lastError }}</span>
      <button
        type="button"
        class="shrink-0 text-[12px] font-medium underline"
        @click="gateway.connect().catch(() => undefined)"
      >
        Reconnect
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
      <div class="side-chat-body min-h-0 flex-1 overflow-y-auto px-3 pt-2">
        <div
          v-if="showEmpty && chat.error"
          class="mb-2 rounded-md border border-[#fecdca] bg-[#fef3f2] px-3 py-2 text-[12px] text-[#b42318]"
        >
          {{ chat.error }}
        </div>
        <SideSuggestions
          v-if="showEmpty"
          :disabled="chatDisabled"
          @pick="onSuggestion"
        />
        <Transcript v-else />
      </div>

      <div class="shrink-0 bg-white pt-1">
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
