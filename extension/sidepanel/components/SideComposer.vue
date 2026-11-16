<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, ref, watch } from "vue";
import {
  ATTACH_ACCEPT,
  attachRejectReason,
  classifyAttachment,
  fileToBase64,
  mimeForAttachment,
} from "../../../src/lib/attachments";
import { useChatStore } from "../../../src/stores/chat";
import { useGatewayStore } from "../../../src/stores/gateway";
import type { PromptAttachment } from "../../../src/types";

const props = withDefaults(
  defineProps<{
    placeholder?: string;
    seed?: string;
    /** When true (non-ERPNext tab), block send / attach. */
    disabled?: boolean;
  }>(),
  {
    placeholder: "How can I help you today?",
    seed: "",
    disabled: false,
  },
);

const chat = useChatStore();
const gateway = useGatewayStore();
const draft = ref(props.seed);
const area = ref<HTMLTextAreaElement | null>(null);
const fileInput = ref<HTMLInputElement | null>(null);
const pending = ref<PromptAttachment[]>([]);
const attachError = ref<string | null>(null);

const inputEnabled = computed(
  () => gateway.isConnected && !props.disabled,
);

const canSend = computed(
  () =>
    inputEnabled.value &&
    !chat.sending &&
    (!!draft.value.trim() || pending.value.length > 0),
);

watch(
  () => props.seed,
  (value) => {
    if (value) {
      draft.value = value;
      void nextTick(() => area.value?.focus());
    }
  },
);

watch(draft, () => {
  void nextTick(() => {
    const el = area.value;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(Math.max(el.scrollHeight, 24), 120)}px`;
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
    pending.value = [
      ...pending.value,
      {
        id: crypto.randomUUID(),
        kind,
        name: file.name,
        mime: mimeForAttachment(file),
        contentBase64,
        previewUrl: kind === "image" ? URL.createObjectURL(file) : undefined,
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

function clearDraft() {
  draft.value = "";
  for (const item of pending.value) {
    if (item.previewUrl) URL.revokeObjectURL(item.previewUrl);
  }
  pending.value = [];
  attachError.value = null;
}

defineExpose({
  setDraft(text: string) {
    draft.value = text;
    void nextTick(() => area.value?.focus());
  },
});
</script>

<template>
  <div
    class="side-composer shrink-0 px-3 pb-3 pt-1"
    :class="disabled ? 'is-disabled' : ''"
  >
    <div class="side-composer-card">
      <div v-if="pending.length" class="mb-2 flex flex-wrap gap-2 px-1">
        <div
          v-for="item in pending"
          :key="item.id"
          class="group relative overflow-hidden rounded-xl border border-[#e8e8e8] bg-[#f3f3f3]"
          :class="item.kind === 'image' ? 'h-12 w-12' : 'max-w-[140px] px-2 py-1.5'"
        >
          <img
            v-if="item.kind === 'image' && item.previewUrl"
            :src="item.previewUrl"
            :alt="item.name"
            class="h-full w-full object-cover"
          />
          <div v-else class="truncate pr-4 text-[11px] text-[#3c3c3c]">
            {{ item.name }}
          </div>
          <button
            type="button"
            class="absolute right-0.5 top-0.5 flex h-4 w-4 items-center justify-center rounded-full bg-black/55 text-[10px] text-white opacity-0 group-hover:opacity-100"
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
        class="side-composer-input"
        :placeholder="
          disabled
            ? 'Switch to your ERPNext tab to chat'
            : placeholder
        "
        :disabled="!inputEnabled"
        @keydown="onKeydown"
      />

      <div v-if="attachError" class="mt-1 px-1 text-[11px] text-[#c43c3c]">
        {{ attachError }}
      </div>

      <div class="mt-2 flex items-center justify-between gap-2">
        <div class="flex items-center gap-0.5">
          <input
            ref="fileInput"
            type="file"
            :accept="ATTACH_ACCEPT"
            class="hidden"
            multiple
            @change="
              async (e) => {
                const input = e.target as HTMLInputElement;
                const files = input.files ? Array.from(input.files) : [];
                input.value = '';
                for (const file of files) await addFile(file);
              }
            "
          />
          <button
            type="button"
            class="side-icon-btn"
            title="Clear"
            :disabled="disabled || (!draft && !pending.length)"
            @click="clearDraft"
          >
            <svg
              xmlns="http://www.w3.org/2000/svg"
              width="15"
              height="15"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              stroke-width="1.75"
              stroke-linecap="round"
              stroke-linejoin="round"
            >
              <rect x="3" y="3" width="18" height="18" rx="2" />
              <path d="m9 9 6 6" />
              <path d="m15 9-6 6" />
            </svg>
          </button>
          <button
            type="button"
            class="side-icon-btn"
            title="Attach"
            :disabled="!inputEnabled || chat.sending"
            @click="fileInput?.click()"
          >
            <svg
              xmlns="http://www.w3.org/2000/svg"
              width="15"
              height="15"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              stroke-width="1.75"
              stroke-linecap="round"
              stroke-linejoin="round"
            >
              <path
                d="m21.44 11.05-9.19 9.19a6 6 0 0 1-8.49-8.49l8.57-8.57A4 4 0 1 1 18 8.84l-8.59 8.57a2 2 0 0 1-2.83-2.83l8.49-8.48"
              />
            </svg>
          </button>
        </div>

        <div class="flex items-center gap-2">
          <button type="button" class="side-model-chip" title="Model">
            Automatic
            <svg
              xmlns="http://www.w3.org/2000/svg"
              width="12"
              height="12"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              stroke-width="2"
              stroke-linecap="round"
              stroke-linejoin="round"
            >
              <path d="m6 9 6 6 6-6" />
            </svg>
          </button>

          <button
            v-if="chat.sending"
            type="button"
            class="side-send is-active"
            title="Stop"
            @click="chat.interrupt()"
          >
            <svg
              xmlns="http://www.w3.org/2000/svg"
              width="11"
              height="11"
              viewBox="0 0 24 24"
              fill="currentColor"
            >
              <rect x="6" y="6" width="12" height="12" rx="1" />
            </svg>
          </button>
          <button
            v-else
            type="button"
            class="side-send"
            :class="canSend ? 'is-active' : ''"
            title="Send"
            :disabled="!canSend"
            @click="submit"
          >
            <svg
              xmlns="http://www.w3.org/2000/svg"
              width="14"
              height="14"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              stroke-width="2.25"
              stroke-linecap="round"
              stroke-linejoin="round"
            >
              <path d="m5 12 7-7 7 7" />
              <path d="M12 19V5" />
            </svg>
          </button>
        </div>
      </div>
    </div>
  </div>
</template>
