<script setup lang="ts">
import { ref } from "vue";
import type { SecretPromptRequest } from "../types";

const props = defineProps<{
  request: SecretPromptRequest;
  busy?: boolean;
}>();

const emit = defineEmits<{
  submit: [value: string];
  cancel: [];
}>();

const value = ref("");
const submitting = ref(false);

function onSubmit() {
  if (props.busy || submitting.value) return;
  submitting.value = true;
  emit("submit", value.value);
  value.value = "";
}

function onCancel() {
  if (props.busy || submitting.value) return;
  emit("cancel");
}
</script>

<template>
  <form
    class="my-2 rounded-[12px] border border-[#e4e4e4] bg-white px-3.5 py-3 shadow-[0_1px_2px_rgba(0,0,0,0.04)]"
    @submit.prevent="onSubmit"
  >
    <div class="text-[11px] font-medium uppercase tracking-[0.04em] text-[#8a8a8a]">
      {{ request.title }}
    </div>
    <p class="mt-1.5 text-[13px] leading-snug text-[#1a1a1a]">
      {{ request.description }}
    </p>
    <pre
      v-if="request.command"
      class="mt-2 max-h-28 overflow-auto whitespace-pre-wrap break-all rounded-md bg-[#f5f5f5] px-2.5 py-2 font-mono text-[11.5px] leading-snug text-[#3c3c3c]"
    >{{ request.command }}</pre>
    <input
      v-model="value"
      class="mt-3 w-full rounded-md border border-[#e4e4e4] bg-white px-2.5 py-1.5 text-[13px] outline-none focus:border-[#cfcfcf]"
      :type="request.kind === 'vault_code' ? 'text' : 'password'"
      :placeholder="request.hint || 'Enter value…'"
      :disabled="busy || submitting"
      autocomplete="off"
    />
    <div class="mt-3 flex flex-wrap gap-1.5">
      <button
        type="button"
        class="rounded-md border border-[#f0d0d0] bg-[#fff7f7] px-2.5 py-1 text-[12px] font-medium text-[#b42318] hover:bg-[#ffecec] disabled:opacity-50"
        :disabled="busy || submitting"
        @click="onCancel"
      >
        Cancel
      </button>
      <button
        type="submit"
        class="rounded-md border border-[#e4e4e4] bg-[#1a1a1a] px-2.5 py-1 text-[12px] font-medium text-white hover:bg-[#333] disabled:opacity-50"
        :disabled="busy || submitting || (request.kind === 'secret' && !value)"
      >
        Send
      </button>
    </div>
  </form>
</template>
