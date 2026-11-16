<script setup lang="ts">
import { ref, watch } from "vue";
import type { ActivePage } from "../composables/useErpnextContext";

const props = defineProps<{
  page: ActivePage | null;
  active: boolean;
}>();

const dismissed = ref(false);

watch(
  () => props.page?.url,
  () => {
    dismissed.value = false;
  },
);
</script>

<template>
  <div
    v-if="page && active && !dismissed"
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
        <div
          class="mt-0.5 flex items-center gap-1 truncate text-[11px] text-[#8a8a8a]"
        >
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
