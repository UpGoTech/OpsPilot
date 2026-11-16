<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref, watch } from "vue";
import { activitySpanMs, formatWorkedFor } from "../lib/formatDuration";
import { buildScaffold } from "../lib/scaffold";
import { scrubServerPaths } from "../lib/scrubServerPaths";
import type { AgentActivity, ScaffoldSegment } from "../types";

const props = defineProps<{
  steps: AgentActivity[];
  live: boolean;
}>();

/** Per-segment open state — live open, auto-collapse when that segment settles. */
const openMap = ref<Record<string, boolean>>({});
/** User clicked the disclosure; don't fight their choice. */
const userPinned = ref<Record<string, true>>({});
const nowTick = ref(Date.now());
let tickTimer: ReturnType<typeof setInterval> | null = null;

const segments = computed(() => buildScaffold(props.steps));

watch(
  () => segments.value.map((s) => `${s.id}:${s.live ? 1 : 0}`).join("|"),
  () => {
    for (const seg of segments.value) {
      if (userPinned.value[seg.id]) continue;
      // Only the in-flight segment stays open; finished Thoughts/tools collapse.
      openMap.value[seg.id] = Boolean(seg.live);
    }
  },
  { immediate: true },
);

onMounted(() => {
  tickTimer = setInterval(() => {
    nowTick.value = Date.now();
  }, 1000);
});

onUnmounted(() => {
  if (tickTimer) clearInterval(tickTimer);
});

function isOpen(id: string) {
  return openMap.value[id] !== false;
}

function toggle(id: string) {
  userPinned.value[id] = true;
  openMap.value[id] = !isOpen(id);
}

function workLabel(seg: Extract<ScaffoldSegment, { kind: "tools" }>): string {
  void nowTick.value;
  // Desktop primary copy is the tool-run summary ("Ran 1 command").
  const base =
    seg.summary ||
    (seg.live || props.live ? "Working…" : "Worked");
  const span =
    activitySpanMs(
      seg.steps.map((s) => ({
        ...s,
        endedAt:
          s.endedAt ??
          (seg.live || props.live ? nowTick.value : s.endedAt),
      })),
    ) ?? null;
  if (span == null) return base;
  return `${base} · ${formatWorkedFor(span)}`;
}

function thoughtLabel(
  seg: Extract<ScaffoldSegment, { kind: "thought" }>,
): string {
  void nowTick.value;
  if (seg.live) {
    const step = props.steps.find((s) => s.id === seg.id);
    if (step?.startedAt) {
      const sec = Math.max(1, Math.round((Date.now() - step.startedAt) / 1000));
      return `Thinking · ${sec}s`;
    }
    return "Thinking…";
  }
  // Desktop: "Thought for 12s" / "Thought briefly" / bare "Thought".
  if (seg.seconds && seg.seconds >= 1) return `Thought for ${seg.seconds}s`;
  if (seg.seconds != null) return "Thought briefly";
  return "Thought";
}

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
  <div v-if="segments.length" class="flex flex-col gap-2">
    <template v-for="seg in segments" :key="seg.id">
      <!-- Worked for / tools -->
      <div v-if="seg.kind === 'tools'" class="flex flex-col gap-1.5">
        <button
          type="button"
          class="inline-flex items-center gap-1 self-start text-[13px] text-[#8a8a8a] hover:text-[#3c3c3c]"
          @click="toggle(seg.id)"
        >
          <span>{{ workLabel(seg) }}</span>
          <svg
            class="h-3 w-3 shrink-0 transition-transform"
            :class="isOpen(seg.id) ? 'rotate-180' : ''"
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

        <div v-if="isOpen(seg.id)" class="flex flex-col gap-1.5">
          <div
            v-for="step in seg.steps"
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

      <!-- Thought for Ns -->
      <div v-else-if="seg.kind === 'thought'" class="flex flex-col gap-1">
        <button
          type="button"
          class="inline-flex items-center gap-1 self-start text-[13px] text-[#8a8a8a] hover:text-[#3c3c3c]"
          @click="toggle(seg.id)"
        >
          <span>{{ thoughtLabel(seg) }}</span>
          <svg
            class="h-3 w-3 shrink-0 transition-transform"
            :class="isOpen(seg.id) ? 'rotate-180' : ''"
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
          v-if="isOpen(seg.id) && seg.text"
          class="rounded-[10px] border border-[#e4e4e4] bg-white px-3 py-2"
        >
          <pre
            class="whitespace-pre-wrap break-words font-sans text-[13px] leading-[1.5] text-[#6b6b6b]"
          >{{ seg.text }}</pre>
        </div>
      </div>
    </template>
  </div>
</template>
