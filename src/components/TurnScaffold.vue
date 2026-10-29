<script setup lang="ts">
import { computed, ref, watch } from "vue";
import { activitySpanMs, formatWorkedFor } from "../lib/formatDuration";
import { buildScaffold } from "../lib/scaffold";
import { scrubServerPaths } from "../lib/scrubServerPaths";
import type { AgentActivity } from "../types";

const props = defineProps<{
  steps: AgentActivity[];
  live: boolean;
}>();

/** Expanded by default so Worked / Thought stay visible after a turn finishes. */
const workOpen = ref(true);
const thoughtOpen = ref(true);

watch(
  () => props.live,
  (live) => {
    if (live) {
      workOpen.value = true;
      thoughtOpen.value = true;
    }
  },
  { immediate: true },
);

const segments = computed(() => buildScaffold(props.steps));

const thoughtSeg = computed(() =>
  segments.value.find((s) => s.kind === "thought"),
);

const toolSteps = computed(() =>
  props.steps.filter((s) => s.toolName !== "thinking"),
);

const workLabel = computed(() => {
  const span = activitySpanMs(props.steps);
  if (props.live) {
    if (span != null) return `Working · ${formatWorkedFor(span)}`;
    return "Working…";
  }
  if (span != null) return `Worked for ${formatWorkedFor(span)}`;
  if (toolSteps.value.length) return "Worked";
  return null;
});

const thoughtLabel = computed(() => {
  const seg = thoughtSeg.value;
  if (!seg || seg.kind !== "thought") return null;
  if (seg.live) return "Thinking…";
  if (seg.seconds) return `Thought ${seg.seconds}s`;
  return "Thought briefly";
});

const hasWorkLog = computed(() => toolSteps.value.length > 0);

/** Tool logs: show filename only, never wipe the row. */
function toolDetail(value?: string) {
  if (!value) return "";
  return scrubServerPaths(value, "filename") || value;
}

function toolOutput(value?: string) {
  if (!value) return "";
  return scrubServerPaths(value, "filename") || value;
}
</script>

<template>
  <div v-if="steps.length" class="flex flex-col gap-2">
    <!-- Plain "Worked for 41s" line — Cursor -->
    <div v-if="workLabel && hasWorkLog" class="flex flex-col gap-1.5">
      <button
        type="button"
        class="inline-flex items-center gap-1 self-start text-[13px] text-[#8a8a8a] hover:text-[#3c3c3c]"
        @click="workOpen = !workOpen"
      >
        <span>{{ workLabel }}</span>
        <svg
          class="h-3 w-3 shrink-0 transition-transform"
          :class="workOpen ? 'rotate-180' : ''"
          xmlns="http://www.w3.org/2000/svg"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          stroke-width="2"
          stroke-linecap="round"
          stroke-linejoin="round"
          aria-hidden="true"
        >
          <path d="m6 9 6 6 6-6" />
        </svg>
      </button>

      <div v-if="workOpen" class="flex flex-col gap-1.5">
        <div
          v-for="step in toolSteps"
          :key="step.id"
          class="overflow-hidden rounded-[10px] border border-[#e4e4e4] bg-white"
        >
          <div class="flex items-center gap-2 px-3 py-2">
            <span
              class="font-mono text-[11px] text-[#9a9a9a]"
              aria-hidden="true"
              >&gt;_</span
            >
            <div class="min-w-0 flex-1 truncate text-[13px] text-[#3c3c3c]">
              {{ step.label }}
              <span v-if="toolDetail(step.detail)" class="text-[#8a8a8a]">
                — {{ toolDetail(step.detail) }}
              </span>
            </div>
            <span
              v-if="step.status === 'running'"
              class="h-1.5 w-1.5 shrink-0 animate-pulse rounded-full bg-[#8a8a8a]"
            />
          </div>
          <pre
            v-if="toolOutput(step.output)"
            class="max-h-32 overflow-auto border-t border-[#efefef] bg-[#fafafa] px-3 py-2 font-mono text-[11px] leading-relaxed text-[#6b6b6b]"
          >{{ toolOutput(step.output) }}</pre>
        </div>
      </div>
    </div>

    <!-- Thought — muted text, expand for detail (Cursor: not a heavy chip) -->
    <div v-if="thoughtLabel" class="flex flex-col gap-1">
      <button
        type="button"
        class="inline-flex items-center gap-1 self-start text-[13px] text-[#8a8a8a] hover:text-[#3c3c3c]"
        @click="thoughtOpen = !thoughtOpen"
      >
        <span>{{ thoughtLabel }}</span>
        <svg
          class="h-3 w-3 shrink-0 transition-transform"
          :class="thoughtOpen ? 'rotate-180' : ''"
          xmlns="http://www.w3.org/2000/svg"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          stroke-width="2"
          stroke-linecap="round"
          stroke-linejoin="round"
          aria-hidden="true"
        >
          <path d="m6 9 6 6 6-6" />
        </svg>
      </button>
      <div
        v-if="
          thoughtOpen &&
          thoughtSeg &&
          thoughtSeg.kind === 'thought' &&
          thoughtSeg.text
        "
        class="rounded-[10px] border border-[#e4e4e4] bg-white px-3 py-2"
      >
        <pre
          class="whitespace-pre-wrap break-words font-sans text-[13px] leading-[1.5] text-[#6b6b6b]"
        >{{ thoughtSeg.text }}</pre>
      </div>
    </div>
  </div>
</template>
