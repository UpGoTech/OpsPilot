<script setup lang="ts">
import { computed, reactive, ref } from "vue";
import type { ClarifyRequest } from "../types";

const props = defineProps<{
  request: ClarifyRequest;
  busy?: boolean;
}>();

const emit = defineEmits<{
  submit: [answers: Record<string, string | null>];
  skip: [];
}>();

const drafts = reactive<Record<string, string>>({});
const picked = reactive<Record<string, string[]>>({});
const submitting = ref(false);

for (const q of props.request.questions) {
  drafts[q.qid] = "";
  picked[q.qid] = [];
}

function toggle(qid: string, choice: string, multi: boolean) {
  const cur = picked[qid] ?? [];
  if (multi) {
    picked[qid] = cur.includes(choice)
      ? cur.filter((c) => c !== choice)
      : [...cur, choice];
  } else {
    picked[qid] = [choice];
    drafts[qid] = "";
  }
}

function answerFor(qid: string, multi: boolean): string | null {
  const choices = picked[qid] ?? [];
  const draft = (drafts[qid] ?? "").trim();
  if (multi) {
    const combined = [...choices, ...(draft ? [draft] : [])];
    return combined.length ? JSON.stringify(combined) : null;
  }
  if (choices.length) return choices[0];
  return draft || null;
}

const canSubmit = computed(() =>
  props.request.questions.some((q) => answerFor(q.qid, q.multiSelect) !== null),
);

function onSubmit() {
  if (props.busy || submitting.value || !canSubmit.value) return;
  submitting.value = true;
  const answers: Record<string, string | null> = {};
  for (const q of props.request.questions) {
    answers[q.qid] = answerFor(q.qid, q.multiSelect);
  }
  emit("submit", answers);
}

function onSkip() {
  if (props.busy || submitting.value) return;
  emit("skip");
}
</script>

<template>
  <form
    class="my-2 rounded-[12px] border border-[#e4e4e4] bg-white px-3.5 py-3 shadow-[0_1px_2px_rgba(0,0,0,0.04)]"
    @submit.prevent="onSubmit"
  >
    <div class="text-[11px] font-medium uppercase tracking-[0.04em] text-[#8a8a8a]">
      {{ request.setupKind ? "Choose" : "Clarification needed" }}
    </div>
    <div class="mt-3 grid gap-3">
      <div v-for="q in request.questions" :key="q.qid" class="grid gap-2">
        <p class="text-[13px] leading-snug text-[#1a1a1a]">{{ q.question }}</p>
        <div v-if="q.choices?.length" class="flex flex-wrap gap-1.5">
          <button
            v-for="choice in q.choices"
            :key="choice"
            type="button"
            class="rounded-md border px-2.5 py-1 text-[12px] font-medium"
            :class="
              (picked[q.qid] || []).includes(choice)
                ? 'border-[#1a1a1a] bg-[#1a1a1a] text-white'
                : 'border-[#e4e4e4] bg-white text-[#1e1e1e] hover:bg-[#f5f5f5]'
            "
            :disabled="busy || submitting"
            @click="toggle(q.qid, choice, q.multiSelect)"
          >
            {{ choice }}
          </button>
        </div>
        <input
          v-model="drafts[q.qid]"
          type="text"
          class="w-full rounded-md border border-[#e4e4e4] bg-white px-2.5 py-1.5 text-[13px] outline-none focus:border-[#cfcfcf]"
          :placeholder="q.choices?.length ? 'Or type your own…' : 'Your answer…'"
          :disabled="busy || submitting"
        />
      </div>
    </div>
    <div class="mt-3 flex flex-wrap gap-1.5">
      <button
        type="button"
        class="rounded-md border border-[#f0d0d0] bg-[#fff7f7] px-2.5 py-1 text-[12px] font-medium text-[#b42318] hover:bg-[#ffecec] disabled:opacity-50"
        :disabled="busy || submitting"
        @click="onSkip"
      >
        Skip
      </button>
      <button
        type="submit"
        class="rounded-md border border-[#e4e4e4] bg-[#1a1a1a] px-2.5 py-1 text-[12px] font-medium text-white hover:bg-[#333] disabled:opacity-50"
        :disabled="busy || submitting || !canSubmit"
      >
        Send
      </button>
    </div>
  </form>
</template>
