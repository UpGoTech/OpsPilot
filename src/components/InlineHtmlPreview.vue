<script setup lang="ts">
import { computed, onMounted, ref, watch } from "vue";
import { fsReadText } from "../lib/tauri";
import { useGatewayStore } from "../stores/gateway";
import FileArtifactCard from "./FileArtifactCard.vue";

const props = defineProps<{
  path: string;
  /** Optional starting iframe height. */
  height?: number;
}>();

const gateway = useGatewayStore();
const html = ref<string | null>(null);
const error = ref(false);
const loading = ref(true);
/** Inline frame open by default once content is ready. */
const open = ref(true);

const filename = computed(
  () => props.path.split(/[/\\]/).pop() || "preview.html",
);

const frameHeight = computed(() =>
  Math.min(1200, Math.max(160, props.height ?? 320)),
);

const artifact = computed(() => ({
  path: props.path,
  filename: filename.value,
  ext: "html" as const,
}));

async function load() {
  loading.value = true;
  error.value = false;
  html.value = null;
  if (!gateway.isConfigured) {
    error.value = true;
    loading.value = false;
    return;
  }
  try {
    const raw = await fsReadText(gateway.connection, props.path);
    const text =
      typeof raw === "string"
        ? raw
        : typeof (raw as { content?: string })?.content === "string"
          ? (raw as { content: string }).content
          : typeof (raw as { text?: string })?.text === "string"
            ? (raw as { text: string }).text
            : null;
    if (
      !text ||
      (!/<html[\s>]/i.test(text) &&
        !/<!DOCTYPE/i.test(text) &&
        !text.includes("<"))
    ) {
      error.value = true;
    } else {
      html.value = text;
      open.value = true;
    }
  } catch {
    error.value = true;
  } finally {
    loading.value = false;
  }
}

onMounted(load);
watch(
  () => [props.path, gateway.connection.url] as const,
  () => load(),
);
</script>

<template>
  <div class="my-2 flex flex-col gap-2">
    <FileArtifactCard :artifact="artifact" class="!my-0" />

    <div
      v-if="!error && (loading || html)"
      class="overflow-hidden rounded-[10px] border border-[#e4e4e4] bg-white"
    >
      <button
        type="button"
        class="flex w-full items-center gap-1.5 px-3 py-1.5 text-left text-[12px] text-[#8a8a8a] hover:bg-[#fafafa] hover:text-[#3c3c3c]"
        :aria-expanded="open"
        @click="open = !open"
      >
        <svg
          class="h-3 w-3 shrink-0 transition-transform"
          :class="open ? 'rotate-180' : ''"
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
        <span class="min-w-0 flex-1 truncate">
          {{ open ? "Hide inline preview" : "Show inline preview" }}
        </span>
        <span v-if="loading" class="shrink-0">Loading…</span>
      </button>

      <div v-if="open" class="border-t border-[#efefef]">
        <iframe
          v-if="html"
          class="w-full border-0 bg-white"
          :style="{ height: `${frameHeight}px` }"
          sandbox="allow-scripts"
          :srcdoc="html"
          title="HTML preview"
        />
        <div
          v-else-if="loading"
          class="flex h-24 items-center justify-center text-[12px] text-[#8a8a8a]"
        >
          Loading preview…
        </div>
      </div>
    </div>
  </div>
</template>
