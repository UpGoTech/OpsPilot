<script setup lang="ts">
import type { ApprovalChoice, ApprovalRequest } from "../types";

const props = defineProps<{
  request: ApprovalRequest;
  busy?: boolean;
}>();

const emit = defineEmits<{
  choose: [choice: ApprovalChoice];
}>();

const LABELS: Record<ApprovalChoice, string> = {
  once: "Once",
  session: "Session",
  always: "Always",
  deny: "Deny",
};

function onChoose(choice: ApprovalChoice) {
  if (props.busy) return;
  emit("choose", choice);
}
</script>

<template>
  <div
    class="my-2 rounded-[12px] border border-[#e4e4e4] bg-white px-3.5 py-3 shadow-[0_1px_2px_rgba(0,0,0,0.04)]"
    role="group"
    aria-label="Command approval"
  >
    <div class="text-[11px] font-medium uppercase tracking-[0.04em] text-[#8a8a8a]">
      Approval needed
    </div>
    <p class="mt-1.5 text-[13px] leading-snug text-[#1a1a1a]">
      {{ request.description || "This command needs your approval." }}
    </p>
    <pre
      v-if="request.command"
      class="mt-2 max-h-28 overflow-auto whitespace-pre-wrap break-all rounded-md bg-[#f5f5f5] px-2.5 py-2 font-mono text-[11.5px] leading-snug text-[#3c3c3c]"
    >{{ request.command }}</pre>
    <div class="mt-3 flex flex-wrap gap-1.5">
      <button
        v-for="choice in request.choices"
        :key="choice"
        type="button"
        class="rounded-md border px-2.5 py-1 text-[12px] font-medium disabled:opacity-50"
        :class="
          choice === 'deny'
            ? 'border-[#f0d0d0] bg-[#fff7f7] text-[#b42318] hover:bg-[#ffecec]'
            : 'border-[#e4e4e4] bg-white text-[#1e1e1e] hover:bg-[#f5f5f5]'
        "
        :disabled="busy"
        @click="onChoose(choice)"
      >
        {{ LABELS[choice] || choice }}
      </button>
    </div>
  </div>
</template>
