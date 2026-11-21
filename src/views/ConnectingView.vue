<script setup lang="ts">
import { computed } from "vue";
import { Button } from "frappe-ui";

const props = defineProps<{
  /** 0–100 visual progress. */
  progress: number;
  /** Short status under the title. */
  status: string;
  /** Optional detail line. */
  detail?: string;
}>();

const emit = defineEmits<{
  cancel: [];
}>();

const clamped = computed(() => Math.min(100, Math.max(0, Math.round(props.progress))));
</script>

<template>
  <div
    class="flex min-h-0 flex-1 flex-col items-center justify-center bg-gradient-to-b from-surface-gray-1 to-white px-6"
  >
    <div class="flex w-full max-w-sm flex-col items-center text-center">
      <!-- Animated mark -->
      <div class="relative mb-6 flex h-16 w-16 items-center justify-center">
        <div
          class="absolute inset-0 rounded-2xl bg-surface-gray-3/80 animate-pulse"
        />
        <div
          class="absolute inset-[-6px] rounded-[1.15rem] border border-outline-gray-2 opacity-60 animate-[spin_3.2s_linear_infinite]"
          style="
            border-top-color: transparent;
            border-left-color: transparent;
          "
        />
        <svg
          class="relative h-8 w-8 text-ink-gray-8"
          xmlns="http://www.w3.org/2000/svg"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          stroke-width="1.75"
          stroke-linecap="round"
          stroke-linejoin="round"
          aria-hidden="true"
        >
          <path d="M12 3v3" />
          <path d="M12 18v3" />
          <path d="M3 12h3" />
          <path d="M18 12h3" />
          <circle cx="12" cy="12" r="4" />
          <path d="m15.5 8.5 1.5-1.5" />
          <path d="m7 17 1.5-1.5" />
          <path d="m7 7 1.5 1.5" />
          <path d="m15.5 15.5 1.5 1.5" />
        </svg>
      </div>

      <div class="text-base font-semibold tracking-tight text-ink-gray-9">
        Connecting…
      </div>
      <p class="mt-1.5 text-sm text-ink-gray-7">
        {{ props.status }}
      </p>
      <p
        v-if="props.detail"
        class="mt-1 max-w-[22rem] text-xs leading-relaxed text-ink-gray-5"
      >
        {{ props.detail }}
      </p>

      <!-- Progress bar -->
      <div
        class="mt-6 h-1.5 w-full overflow-hidden rounded-full bg-surface-gray-3"
        role="progressbar"
        :aria-valuenow="clamped"
        aria-valuemin="0"
        aria-valuemax="100"
      >
        <div
          class="h-full rounded-full bg-ink-gray-8 transition-[width] duration-500 ease-out"
          :style="{ width: `${clamped}%` }"
        />
      </div>
      <div class="mt-2 self-end text-[11px] tabular-nums text-ink-gray-5">
        {{ clamped }}%
      </div>

      <Button
        class="mt-8"
        label="Cancel"
        variant="subtle"
        @click="emit('cancel')"
      />
    </div>
  </div>
</template>
