<script setup lang="ts">
import { onMounted, onUnmounted, ref } from "vue";
import SideMenu from "./SideMenu.vue";

const emit = defineEmits<{
  logout: [];
  settings: [];
  history: [];
  newChat: [];
  export: [];
}>();

const menuOpen = ref(false);
const menuBtn = ref<HTMLElement | null>(null);

function toggleMenu() {
  menuOpen.value = !menuOpen.value;
}

function closeMenu() {
  menuOpen.value = false;
}

function onDocClick(event: MouseEvent) {
  const target = event.target as Node | null;
  if (!target) return;
  if (menuBtn.value?.contains(target)) return;
  const menu = document.getElementById("opspilot-side-menu");
  if (menu?.contains(target)) return;
  menuOpen.value = false;
}

async function openExpanded() {
  // Best-effort: open side panel content in a tab for a wider view.
  const url = chrome.runtime.getURL("sidepanel.html");
  await chrome.tabs.create({ url });
}

function closePanel() {
  window.close();
}

onMounted(() => {
  document.addEventListener("mousedown", onDocClick);
});
onUnmounted(() => {
  document.removeEventListener("mousedown", onDocClick);
});
</script>

<template>
  <header class="side-header relative z-40 flex h-12 shrink-0 items-center px-4">
    <div class="side-brand text-[15px] font-semibold tracking-[-0.01em]">
      OpsPilot
    </div>

    <div class="ml-auto flex items-center gap-0.5">
      <button
        type="button"
        class="side-icon-btn"
        title="Open in tab"
        @click="openExpanded"
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
          <polyline points="15 3 21 3 21 9" />
          <polyline points="9 21 3 21 3 15" />
          <line x1="21" x2="14" y1="3" y2="10" />
          <line x1="3" x2="10" y1="21" y2="14" />
        </svg>
      </button>

      <div class="relative">
        <button
          ref="menuBtn"
          type="button"
          class="side-icon-btn"
          :class="menuOpen ? 'is-active' : ''"
          title="Menu"
          @click="toggleMenu"
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
            <circle cx="12" cy="5" r="1" />
            <circle cx="12" cy="12" r="1" />
            <circle cx="12" cy="19" r="1" />
          </svg>
        </button>

        <SideMenu
          v-if="menuOpen"
          @close="closeMenu"
          @history="
            closeMenu();
            emit('history');
          "
          @settings="
            closeMenu();
            emit('settings');
          "
          @new-chat="
            closeMenu();
            emit('newChat');
          "
          @export="
            closeMenu();
            emit('export');
          "
          @logout="
            closeMenu();
            emit('logout');
          "
        />
      </div>

      <button
        type="button"
        class="side-icon-btn"
        title="Close"
        @click="closePanel"
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
  </header>
</template>
