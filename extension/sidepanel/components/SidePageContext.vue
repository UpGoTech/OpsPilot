<script setup lang="ts">
import { onMounted, onUnmounted, ref } from "vue";

const page = ref<{ title: string; url: string; host: string } | null>(null);
const dismissed = ref(false);

async function refresh() {
  try {
    const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
    const tab = tabs[0];
    if (!tab?.url || tab.url.startsWith("chrome://") || tab.url.startsWith("chrome-extension://")) {
      page.value = null;
      return;
    }
    const url = tab.url;
    let host = url;
    try {
      host = new URL(url).host + new URL(url).pathname.replace(/\/$/, "");
    } catch {
      // keep raw
    }
    page.value = {
      title: tab.title?.trim() || "This page",
      url,
      host,
    };
  } catch {
    page.value = null;
  }
}

function onActivated() {
  void refresh();
}

onMounted(() => {
  void refresh();
  chrome.tabs.onActivated.addListener(onActivated);
  chrome.tabs.onUpdated.addListener(refresh);
});

onUnmounted(() => {
  chrome.tabs.onActivated.removeListener(onActivated);
  chrome.tabs.onUpdated.removeListener(refresh);
});
</script>

<template>
  <div
    v-if="page && !dismissed"
    class="side-page-context mx-1 mb-2"
  >
    <div class="flex items-start gap-2.5">
      <div class="side-page-favicon" aria-hidden="true">
        {{ page.title.slice(0, 1).toUpperCase() }}
      </div>
      <div class="min-w-0 flex-1">
        <div class="truncate text-[13px] font-medium text-[#1a1a1a]">
          {{ page.title }}
        </div>
        <div class="mt-0.5 flex items-center gap-1 truncate text-[11px] text-[#8a8a8a]">
          <span class="truncate">{{ page.host }}</span>
          <svg
            xmlns="http://www.w3.org/2000/svg"
            width="12"
            height="12"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            stroke-width="1.75"
            stroke-linecap="round"
            stroke-linejoin="round"
            class="shrink-0 opacity-70"
          >
            <circle cx="12" cy="12" r="10" />
            <path d="M12 16v-4" />
            <path d="M12 8h.01" />
          </svg>
        </div>
      </div>
      <button
        type="button"
        class="side-icon-btn !h-7 !w-7"
        title="Dismiss page context"
        @click="dismissed = true"
      >
        <svg
          xmlns="http://www.w3.org/2000/svg"
          width="14"
          height="14"
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
  </div>
</template>
