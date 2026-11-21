<script setup lang="ts">
import { computed, ref } from "vue";
import type { VaultSaveLoginRequest } from "../types";

const props = defineProps<{
  request: VaultSaveLoginRequest;
  busy?: boolean;
}>();

const emit = defineEmits<{
  submit: [value: string];
  cancel: [];
}>();

const identifier = ref("");
const password = ref("");
const submitting = ref(false);

const canSave = computed(
  () => Boolean(identifier.value.trim()) && Boolean(password.value),
);

function onSubmit() {
  if (props.busy || submitting.value || !canSave.value) return;
  submitting.value = true;
  emit(
    "submit",
    JSON.stringify({
      identifier: identifier.value.trim(),
      password: password.value,
    }),
  );
  identifier.value = "";
  password.value = "";
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
      Save login for {{ request.site }}
    </div>
    <p class="mt-1.5 text-[13px] leading-snug text-[#1a1a1a]">
      Store credentials for {{ request.origin || request.site }}?
    </p>
    <input
      v-model="identifier"
      type="text"
      autocomplete="username"
      class="mt-3 w-full rounded-md border border-[#e4e4e4] bg-white px-2.5 py-1.5 text-[13px] outline-none focus:border-[#cfcfcf]"
      placeholder="Username or email"
      :disabled="busy || submitting"
    />
    <input
      v-model="password"
      type="password"
      autocomplete="current-password"
      class="mt-2 w-full rounded-md border border-[#e4e4e4] bg-white px-2.5 py-1.5 text-[13px] outline-none focus:border-[#cfcfcf]"
      placeholder="Password"
      :disabled="busy || submitting"
    />
    <div class="mt-3 flex flex-wrap gap-1.5">
      <button
        type="button"
        class="rounded-md border border-[#f0d0d0] bg-[#fff7f7] px-2.5 py-1 text-[12px] font-medium text-[#b42318] hover:bg-[#ffecec] disabled:opacity-50"
        :disabled="busy || submitting"
        @click="onCancel"
      >
        Don't save
      </button>
      <button
        type="submit"
        class="rounded-md border border-[#e4e4e4] bg-[#1a1a1a] px-2.5 py-1 text-[12px] font-medium text-white hover:bg-[#333] disabled:opacity-50"
        :disabled="busy || submitting || !canSave"
      >
        Save
      </button>
    </div>
  </form>
</template>
