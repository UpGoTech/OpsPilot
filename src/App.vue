<script setup lang="ts">
import { onMounted } from "vue";
import { Button, DesktopShell, FrappeUIProvider } from "frappe-ui";
import AgentPanel from "./components/shell/AgentPanel.vue";
import AppTopBar from "./components/shell/AppTopBar.vue";
import CenterWorkspace from "./components/shell/CenterWorkspace.vue";
import WorkspaceSidebar from "./components/shell/WorkspaceSidebar.vue";
import SettingsView from "./views/SettingsView.vue";
import { useCenterTabsStore } from "./stores/centerTabs";
import { useChatStore } from "./stores/chat";
import { useGatewayStore } from "./stores/gateway";
import { useLayoutStore } from "./stores/layout";
import { useSessionsStore } from "./stores/sessions";
import { useTabsStore } from "./stores/tabs";

const gateway = useGatewayStore();
const chat = useChatStore();
const sessions = useSessionsStore();
const layout = useLayoutStore();
const centerTabs = useCenterTabsStore();
const sessionTabs = useTabsStore();

onMounted(async () => {
  centerTabs.hydrate();
  await gateway.load();
  chat.ensureListener();
  if (gateway.isConfigured) {
    try {
      await gateway.connect();
      for (let i = 0; i < 40 && !gateway.isConnected; i++) {
        await new Promise((r) => setTimeout(r, 100));
      }
      if (gateway.isConnected) {
        await sessions.refresh();
        await sessionTabs.restoreAfterSessionsLoad();
        await centerTabs.restoreActiveContent();
      }
    } catch {
      // Settings surface shows the error
    }
  }
});
</script>

<template>
  <FrappeUIProvider>
    <DesktopShell :scroll="false" class="h-full bg-white">
      <div class="relative flex h-full min-h-0 flex-col bg-white">
        <AppTopBar />

        <div
          v-if="gateway.lastError && !gateway.isConnected && !layout.settingsOpen"
          class="flex items-center justify-between gap-3 border-b border-outline-gray-2 bg-surface-red-1 px-4 py-2 text-sm text-ink-red-4"
        >
          <span class="truncate">{{ gateway.lastError }}</span>
          <Button
            label="Open settings"
            variant="subtle"
            size="sm"
            @click="layout.openSettings()"
          />
        </div>

        <!-- Main workspace -->
        <div v-show="!layout.settingsOpen" class="flex min-h-0 min-w-0 flex-1 overflow-hidden">
          <WorkspaceSidebar v-if="layout.sidebarOpen" />
          <CenterWorkspace />
          <AgentPanel />
        </div>

        <!-- Settings: full opaque page under top bar (no bleed-through) -->
        <div
          v-if="layout.settingsOpen"
          class="flex min-h-0 flex-1 flex-col bg-white"
        >
          <div
            class="flex h-10 shrink-0 items-center justify-between border-b border-outline-gray-2 px-4"
          >
            <div class="text-sm font-medium text-ink-gray-8">Settings</div>
            <button
              type="button"
              class="inline-flex h-7 w-7 items-center justify-center rounded-md text-ink-gray-6 hover:bg-surface-gray-2"
              title="Close settings"
              @click="layout.closeSettings()"
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
                <path d="M18 6 6 18" />
                <path d="m6 6 12 12" />
              </svg>
            </button>
          </div>
          <div class="min-h-0 flex-1 overflow-auto bg-white">
            <SettingsView embedded />
          </div>
        </div>
      </div>
    </DesktopShell>
  </FrappeUIProvider>
</template>
