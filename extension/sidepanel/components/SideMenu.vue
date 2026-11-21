<script setup lang="ts">
import { onMounted, ref } from "vue";

const emit = defineEmits<{
  close: [];
  history: [];
  settings: [];
  newChat: [];
  export: [];
  logout: [];
}>();

const TEMP_KEY = "opspilot.side.temporaryChat";
const temporaryChat = ref(false);

onMounted(() => {
  try {
    temporaryChat.value = localStorage.getItem(TEMP_KEY) === "1";
  } catch {
    temporaryChat.value = false;
  }
});

function toggleTemporary() {
  temporaryChat.value = !temporaryChat.value;
  try {
    localStorage.setItem(TEMP_KEY, temporaryChat.value ? "1" : "0");
  } catch {
    // ignore
  }
}
</script>

<template>
  <div
    id="opspilot-side-menu"
    class="side-menu absolute right-0 top-[calc(100%+6px)] z-50 w-[248px] overflow-hidden py-2"
    role="menu"
  >
    <button
      type="button"
      class="side-menu-row"
      role="menuitem"
      @click.stop="toggleTemporary"
    >
      <span class="side-menu-icon" aria-hidden="true">
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
          <circle cx="12" cy="12" r="9" stroke-dasharray="3 3" />
        </svg>
      </span>
      <span class="flex-1 text-left">Temporary chat</span>
      <span
        class="side-toggle"
        :class="temporaryChat ? 'is-on' : ''"
        aria-hidden="true"
      >
        <span class="side-toggle-knob" />
      </span>
    </button>

    <button
      type="button"
      class="side-menu-row"
      role="menuitem"
      @click="emit('history')"
    >
      <span class="side-menu-icon" aria-hidden="true">
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
          <path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8" />
          <path d="M3 3v5h5" />
          <path d="M12 7v5l4 2" />
        </svg>
      </span>
      <span class="flex-1 text-left">Conversation history</span>
    </button>

    <button
      type="button"
      class="side-menu-row"
      role="menuitem"
      @click="emit('newChat')"
    >
      <span class="side-menu-icon" aria-hidden="true">
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
          <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
          <path d="M12 7v6" />
          <path d="M9 10h6" />
        </svg>
      </span>
      <span class="flex-1 text-left">New chat</span>
    </button>

    <button
      type="button"
      class="side-menu-row"
      role="menuitem"
      @click="emit('export')"
    >
      <span class="side-menu-icon" aria-hidden="true">
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
          <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
          <polyline points="7 10 12 15 17 10" />
          <line x1="12" x2="12" y1="15" y2="3" />
        </svg>
      </span>
      <span class="flex-1 text-left">Export transcript</span>
    </button>

    <div class="side-menu-sep" />

    <button
      type="button"
      class="side-menu-row"
      role="menuitem"
      @click="emit('settings')"
    >
      <span class="side-menu-icon" aria-hidden="true">
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
          <path
            d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z"
          />
          <circle cx="12" cy="12" r="3" />
        </svg>
      </span>
      <span class="flex-1 text-left">Advanced settings</span>
    </button>

    <button
      type="button"
      class="side-menu-row"
      role="menuitem"
      @click="emit('logout')"
    >
      <span class="side-menu-icon" aria-hidden="true">
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
          <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
          <polyline points="16 17 21 12 16 7" />
          <line x1="21" x2="9" y1="12" y2="12" />
        </svg>
      </span>
      <span class="flex-1 text-left">Sign out</span>
    </button>
  </div>
</template>
