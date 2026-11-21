<script setup lang="ts">
import {
  computed,
  nextTick,
  onBeforeUnmount,
  onMounted,
  ref,
  watch,
} from "vue";
import { fetchGatewayHtmlText } from "../lib/fetchGatewayHtml";
import {
  htmlPreviewSandboxUrl,
  postHtmlToPreviewFrame,
} from "../lib/htmlPreview";
import { useGatewayStore } from "../stores/gateway";
import { useLayoutStore } from "../stores/layout";
import FileArtifactCard from "./FileArtifactCard.vue";

const props = defineProps<{
  path: string;
  /** Optional starting iframe height. */
  height?: number;
}>();

const gateway = useGatewayStore();
const layout = useLayoutStore();
const html = ref<string | null>(null);
const error = ref<string | null>(null);
const loading = ref(false);
/** Collapsed by default — Refresh remounts must not reopen every preview. */
const open = ref(false);
const frameRef = ref<HTMLIFrameElement | null>(null);
const sandboxSrc = htmlPreviewSandboxUrl();
let loadGen = 0;
let frameReady = false;

const filename = computed(
  () => props.path.split(/[/\\]/).pop() || "preview.html",
);

const frameHeight = computed(() =>
  Math.min(1200, Math.max(220, props.height ?? 420)),
);

const artifact = computed(() => ({
  path: props.path,
  filename: filename.value,
  ext: "html" as const,
}));

function paintFrame() {
  if (!html.value || !frameReady) return;
  postHtmlToPreviewFrame(frameRef.value, html.value);
}

function onFrameMessage(event: MessageEvent) {
  if (event.source !== frameRef.value?.contentWindow) return;
  if (event.data?.type !== "opspilot-html-preview-ready") return;
  frameReady = true;
  paintFrame();
}

async function load() {
  if (!gateway.isConfigured) {
    error.value = "Connect to the gateway to preview this file.";
    return;
  }
  if (!sandboxSrc) {
    error.value = "HTML preview requires the OpsPilot extension.";
    return;
  }
  const gen = ++loadGen;
  loading.value = true;
  error.value = null;
  try {
    const text = await fetchGatewayHtmlText(gateway.connection, props.path);
    if (gen !== loadGen) return;
    html.value = text;
    await nextTick();
    paintFrame();
  } catch (err) {
    if (gen !== loadGen) return;
    html.value = null;
    error.value =
      err instanceof Error ? err.message : `Could not load ${filename.value}`;
  } finally {
    if (gen === loadGen) loading.value = false;
  }
}

async function ensureLoaded(): Promise<string | null> {
  if (html.value) return html.value;
  await load();
  return html.value;
}

async function toggleInline() {
  if (error.value && !html.value) {
    open.value = true;
    await load();
    return;
  }
  open.value = !open.value;
  if (open.value && !html.value && !loading.value) {
    await load();
  } else if (open.value && html.value) {
    await nextTick();
    paintFrame();
  }
}

async function openInTab() {
  const text = await ensureLoaded();
  if (!text) return;
  layout.openHtmlDocument(text, filename.value, { force: true });
}

function onFrameLoad() {
  // Sandbox also posts ready; load is a fallback if message was missed.
  frameReady = true;
  paintFrame();
}

watch(
  () => [props.path, gateway.connection.url] as const,
  () => {
    loadGen += 1;
    html.value = null;
    error.value = null;
    loading.value = false;
    frameReady = false;
    open.value = false;
  },
);

onMounted(() => {
  window.addEventListener("message", onFrameMessage);
});
onBeforeUnmount(() => {
  window.removeEventListener("message", onFrameMessage);
});
</script>

<template>
  <div class="my-2 flex flex-col gap-2">
    <FileArtifactCard :artifact="artifact" class="!my-0" />

    <div class="overflow-hidden rounded-[10px] border border-[#e4e4e4] bg-white">
      <div
        class="flex w-full items-center gap-1.5 px-3 py-1.5 text-[12px] text-[#8a8a8a]"
      >
        <button
          type="button"
          class="flex min-w-0 flex-1 items-center gap-1.5 text-left hover:text-[#3c3c3c]"
          :aria-expanded="open"
          @click="toggleInline"
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
            {{
              loading
                ? "Loading preview…"
                : open
                  ? "Hide inline preview"
                  : "Show inline preview"
            }}
          </span>
        </button>
        <button
          type="button"
          class="shrink-0 rounded-md border border-[#e4e4e4] px-2 py-0.5 text-[11px] font-medium text-[#1e1e1e] hover:bg-[#f5f5f5] disabled:opacity-50"
          :disabled="loading || !gateway.isConfigured"
          @click="openInTab"
        >
          Open in tab
        </button>
      </div>

      <div v-if="open" class="border-t border-[#efefef]">
        <iframe
          v-if="sandboxSrc && (html || loading)"
          ref="frameRef"
          class="w-full border-0 bg-white"
          :style="{ height: `${frameHeight}px` }"
          :src="sandboxSrc"
          title="HTML preview"
          @load="onFrameLoad"
        />
        <div
          v-if="loading && !html"
          class="flex h-24 items-center justify-center text-[12px] text-[#8a8a8a]"
        >
          Loading preview…
        </div>
        <div
          v-else-if="error"
          class="flex flex-col gap-2 px-3 py-3 text-[12px] text-[#b42318]"
        >
          <span>{{ error }}</span>
          <button
            type="button"
            class="self-start rounded-md border border-[#e4e4e4] px-2.5 py-1 text-[12px] font-medium text-[#1e1e1e] hover:bg-[#f5f5f5]"
            @click="load"
          >
            Retry
          </button>
        </div>
      </div>
    </div>
  </div>
</template>
