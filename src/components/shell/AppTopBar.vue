<script setup lang="ts">
import { useGatewayStore } from "../../stores/gateway";
import { useLayoutStore } from "../../stores/layout";

const layout = useLayoutStore();
const gateway = useGatewayStore();
</script>

<template>
  <header
    class="relative z-50 flex h-11 shrink-0 items-center border-b border-outline-gray-2 bg-surface-gray-1 px-2"
  >
    <div class="z-10 flex items-center">
      <button
        type="button"
        class="inline-flex h-8 w-8 items-center justify-center rounded-md text-ink-gray-6 transition-colors hover:bg-surface-gray-2 hover:text-ink-gray-8"
        :class="layout.sidebarOpen ? 'bg-surface-gray-3 text-ink-gray-9' : ''"
        :title="layout.sidebarOpen ? 'Hide workspace' : 'Show workspace'"
        @click="layout.toggleSidebar()"
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
          <rect width="18" height="18" x="3" y="3" rx="2" />
          <path d="M9 3v18" />
        </svg>
      </button>
    </div>

    <div
      class="pointer-events-none absolute inset-0 flex items-center justify-center"
    >
      <div class="text-sm font-medium tracking-tight text-ink-gray-8">
        OpsPilot
      </div>
    </div>

    <div class="z-10 ml-auto flex items-center gap-1">
      <div
        class="mr-1.5 hidden items-center rounded-full px-2 py-0.5 text-[10px] font-medium tracking-wide sm:inline-flex"
        :class="
          gateway.isConnected
            ? 'bg-[#e6f6eb] text-[#1f7a45]'
            : 'bg-[#fce8e8] text-[#c43c3c]'
        "
        :title="gateway.state"
      >
        {{ gateway.isConnected ? "Online" : "Offline" }}
      </div>

      <!-- Agent: filled when open, outline when collapsed (Cursor gray, no blue) -->
      <button
        type="button"
        class="inline-flex h-8 w-8 items-center justify-center rounded-md text-ink-gray-7 transition-colors hover:bg-surface-gray-2 hover:text-ink-gray-9"
        :title="layout.agentOpen ? 'Hide agent' : 'Show agent'"
        @click="layout.toggleAgent()"
      >
        <!-- Open: solid fill -->
        <svg
          v-if="layout.agentOpen"
          xmlns="http://www.w3.org/2000/svg"
          width="16"
          height="16"
          viewBox="0 0 24 24"
          fill="currentColor"
          aria-hidden="true"
        >
          <path
            d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"
          />
        </svg>
        <!-- Collapsed: outline -->
        <svg
          v-else
          xmlns="http://www.w3.org/2000/svg"
          width="16"
          height="16"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          stroke-width="2"
          stroke-linecap="round"
          stroke-linejoin="round"
          aria-hidden="true"
        >
          <path
            d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"
          />
        </svg>
      </button>

      <button
        type="button"
        class="inline-flex h-8 w-8 items-center justify-center rounded-md text-ink-gray-6 transition-colors hover:bg-surface-gray-2 hover:text-ink-gray-8"
        :class="layout.settingsOpen ? 'bg-surface-gray-3 text-ink-gray-9' : ''"
        title="Settings"
        @click="
          layout.settingsOpen ? layout.closeSettings() : layout.openSettings()
        "
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
          <path
            d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z"
          />
          <circle cx="12" cy="12" r="3" />
        </svg>
      </button>
    </div>
  </header>
</template>
