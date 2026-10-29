<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, ref, watch } from "vue";
import {
  ATTACH_ACCEPT,
  attachRejectReason,
  classifyAttachment,
  fileToBase64,
  mimeForAttachment,
} from "../lib/attachments";
import { useChatStore } from "../stores/chat";
import { useGatewayStore } from "../stores/gateway";
import type { PromptAttachment } from "../types";

const chat = useChatStore();
const gateway = useGatewayStore();
const draft = ref("");
const area = ref<HTMLTextAreaElement | null>(null);
const fileInput = ref<HTMLInputElement | null>(null);
const pending = ref<PromptAttachment[]>([]);
const attachError = ref<string | null>(null);

const canSend = computed(
  () =>
    gateway.isConnected &&
    !chat.sending &&
    (!!draft.value.trim() || pending.value.length > 0),
);

watch(draft, () => {
  void nextTick(() => {
    const el = area.value;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(Math.max(el.scrollHeight, 24), 140)}px`;
  });
});

onBeforeUnmount(() => {
  for (const item of pending.value) {
    if (item.previewUrl) URL.revokeObjectURL(item.previewUrl);
  }
});

async function addFile(file: File) {
  attachError.value = null;
  const reason = attachRejectReason(file);
  if (reason) {
    attachError.value = reason;
    return;
  }
  const kind = classifyAttachment(file);
  if (!kind) return;

  try {
    const contentBase64 = await fileToBase64(file);
    const mime = mimeForAttachment(file);
    const previewUrl =
      kind === "image" ? URL.createObjectURL(file) : undefined;
    pending.value = [
      ...pending.value,
      {
        id: crypto.randomUUID(),
        kind,
        name: file.name,
        mime,
        contentBase64,
        previewUrl,
        byteLength: file.size,
      },
    ];
  } catch (err) {
    attachError.value =
      err instanceof Error ? err.message : "Could not read the file.";
  }
}

function removePending(id: string) {
  const hit = pending.value.find((p) => p.id === id);
  if (hit?.previewUrl) URL.revokeObjectURL(hit.previewUrl);
  pending.value = pending.value.filter((p) => p.id !== id);
}

async function submit() {
  if (!canSend.value) return;
  const text = draft.value;
  const attachments = [...pending.value];
  draft.value = "";
  pending.value = [];
  attachError.value = null;
  try {
    await chat.send(text, attachments);
  } catch {
    pending.value = attachments;
  }
  void nextTick(() => area.value?.focus());
}

function onKeydown(event: KeyboardEvent) {
  if (event.key === "Enter" && !event.shiftKey) {
    event.preventDefault();
    void submit();
  }
}

function onAttachClick() {
  fileInput.value?.click();
}

async function onFilePicked(event: Event) {
  const input = event.target as HTMLInputElement;
  const files = input.files ? Array.from(input.files) : [];
  input.value = "";
  for (const file of files) {
    await addFile(file);
  }
  void nextTick(() => area.value?.focus());
}

function extLabel(name: string): string {
  const dot = name.lastIndexOf(".");
  return (dot >= 0 ? name.slice(dot + 1) : "file").toUpperCase();
}
</script>

<template>
  <div class="agent-composer shrink-0 bg-[#f7f7f7] px-3 pb-3 pt-2">
    <div
      class="rounded-[16px] border border-[#e4e4e4] bg-[#fbfbfb] px-3 pb-2 pt-2.5 shadow-[0_0_0_1px_rgba(0,0,0,0.02)]"
    >
      <div v-if="pending.length" class="mb-2 flex flex-wrap gap-2">
        <div
          v-for="item in pending"
          :key="item.id"
          class="group relative overflow-hidden rounded-lg border border-[#e0e0e0] bg-[#efefef]"
          :class="item.kind === 'image' ? 'h-14 w-14' : 'max-w-[160px] px-2 py-1.5'"
        >
          <img
            v-if="item.kind === 'image' && item.previewUrl"
            :src="item.previewUrl"
            :alt="item.name"
            class="h-full w-full object-cover"
          />
          <div v-else class="pr-4">
            <div class="text-[10px] font-medium uppercase text-[#8a8a8a]">
              {{ extLabel(item.name) }}
            </div>
            <div class="truncate text-[11px] text-[#3c3c3c]" :title="item.name">
              {{ item.name }}
            </div>
          </div>
          <button
            type="button"
            class="absolute right-0.5 top-0.5 flex h-4 w-4 items-center justify-center rounded-full bg-black/60 text-[10px] text-white opacity-0 group-hover:opacity-100"
            title="Remove"
            @click="removePending(item.id)"
          >
            ×
          </button>
        </div>
      </div>

      <textarea
        ref="area"
        v-model="draft"
        rows="1"
        spellcheck="false"
        autocomplete="off"
        autocorrect="off"
        autocapitalize="off"
        class="block max-h-[140px] min-h-[24px] w-full resize-none border-0 bg-transparent text-[13px] leading-[1.45] text-[#1e1e1e] shadow-none outline-none ring-0 placeholder:text-[#9b9b9b] focus:border-0 focus:outline-none focus:ring-0 disabled:opacity-50"
        placeholder="Plan, Build, / for skills, @ for context"
        :disabled="!gateway.isConnected"
        @keydown="onKeydown"
      />

      <div v-if="attachError" class="mt-1 text-[11px] text-[#c43c3c]">
        {{ attachError }}
      </div>

      <div class="mt-2 flex items-center justify-end gap-1">
        <input
          ref="fileInput"
          type="file"
          :accept="ATTACH_ACCEPT"
          class="hidden"
          multiple
          @change="onFilePicked"
        />
        <button
          type="button"
          class="inline-flex h-7 w-7 items-center justify-center rounded-md text-[#6b6b6b] hover:bg-[#efefef] hover:text-[#3c3c3c] disabled:opacity-40"
          title="Attach file"
          :disabled="!gateway.isConnected || chat.sending"
          @click="onAttachClick"
        >
          <svg
            xmlns="http://www.w3.org/2000/svg"
            width="15"
            height="15"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            stroke-width="2"
            stroke-linecap="round"
            stroke-linejoin="round"
            aria-hidden="true"
          >
            <path
              d="m21.44 11.05-9.19 9.19a6 6 0 0 1-8.49-8.49l8.57-8.57A4 4 0 1 1 18 8.84l-8.59 8.57a2 2 0 0 1-2.83-2.83l8.49-8.48"
            />
          </svg>
        </button>

        <button
          v-if="chat.sending"
          type="button"
          class="inline-flex h-6 w-6 items-center justify-center rounded-full bg-[#1e1e1e] text-white hover:bg-black"
          title="Stop"
          @click="chat.interrupt()"
        >
          <svg
            xmlns="http://www.w3.org/2000/svg"
            width="10"
            height="10"
            viewBox="0 0 24 24"
            fill="currentColor"
            aria-hidden="true"
          >
            <rect x="6" y="6" width="12" height="12" rx="1" />
          </svg>
        </button>
        <button
          v-else
          type="button"
          class="inline-flex h-6 w-6 items-center justify-center rounded-full transition-colors"
          :class="
            canSend
              ? 'bg-[#1e1e1e] text-white hover:bg-black'
              : 'bg-[#e8e8e8] text-[#b0b0b0]'
          "
          title="Send"
          :disabled="!canSend"
          @click="submit"
        >
          <svg
            xmlns="http://www.w3.org/2000/svg"
            width="13"
            height="13"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            stroke-width="2.5"
            stroke-linecap="round"
            stroke-linejoin="round"
            aria-hidden="true"
          >
            <path d="m5 12 7-7 7 7" />
            <path d="M12 19V5" />
          </svg>
        </button>
      </div>
    </div>
  </div>
</template>
