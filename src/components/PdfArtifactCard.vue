<script setup lang="ts">
import { ref } from "vue";
import {
  fetchGatewayArtifactPreviewUrl,
  saveGatewayArtifactAs,
} from "../lib/downloadArtifact";
import { useGatewayStore } from "../stores/gateway";
import { useLayoutStore } from "../stores/layout";
import type { PdfArtifact } from "../lib/extractPdf";

const props = defineProps<{
  artifact: PdfArtifact;
}>();

const gateway = useGatewayStore();
const layout = useLayoutStore();
const busy = ref<"download" | "preview" | null>(null);
const status = ref<string | null>(null);

async function onDownload() {
  if (!gateway.isConfigured || busy.value) return;
  busy.value = "download";
  status.value = null;
  try {
    const saved = await saveGatewayArtifactAs(
      gateway.connection,
      props.artifact.path,
    );
    if (!saved) {
      status.value = null;
      return;
    }
    status.value = `Saved · ${saved.filename}`;
  } catch (err) {
    status.value =
      err instanceof Error ? err.message : `Download failed: ${String(err)}`;
  } finally {
    busy.value = null;
  }
}

async function onPreview() {
  if (!gateway.isConfigured || busy.value) return;
  busy.value = "preview";
  status.value = null;
  try {
    const { url, filename } = await fetchGatewayArtifactPreviewUrl(
      gateway.connection,
      props.artifact.path,
    );
    layout.openPdfPreview(url, filename);
    status.value = "Opened in new tab";
  } catch (err) {
    status.value =
      err instanceof Error ? err.message : `Preview failed: ${String(err)}`;
  } finally {
    busy.value = null;
  }
}
</script>

<template>
  <div class="my-2">
    <div
      class="flex items-center gap-2 rounded-[10px] border border-[#e4e4e4] bg-white px-3 py-2"
    >
      <span
        class="grid h-6 w-6 shrink-0 place-items-center rounded-md bg-[#f0f0f0] text-[#8a8a8a]"
        aria-hidden="true"
      >
        <svg
          xmlns="http://www.w3.org/2000/svg"
          width="14"
          height="14"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          stroke-width="2"
          stroke-linecap="round"
          stroke-linejoin="round"
        >
          <rect width="20" height="14" x="2" y="3" rx="2" />
          <line x1="8" x2="16" y1="21" y2="21" />
          <line x1="12" x2="12" y1="17" y2="21" />
        </svg>
      </span>
      <div class="min-w-0 flex-1 truncate text-[13px] text-[#3c3c3c]">
        {{ artifact.filename }}
      </div>
      <button
        type="button"
        class="inline-flex shrink-0 items-center gap-1 rounded-md border border-[#e4e4e4] bg-white px-2.5 py-1 text-[12px] text-[#1e1e1e] hover:bg-[#f5f5f5] disabled:opacity-50"
        :disabled="!!busy || !gateway.isConfigured"
        @click="onDownload"
      >
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
          aria-hidden="true"
        >
          <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
          <polyline points="7 10 12 15 17 10" />
          <line x1="12" x2="12" y1="15" y2="3" />
        </svg>
        {{ busy === "download" ? "Saving…" : "Download" }}
      </button>
      <button
        type="button"
        class="shrink-0 rounded-md border border-[#e4e4e4] bg-white px-2.5 py-1 text-[12px] text-[#1e1e1e] hover:bg-[#f5f5f5] disabled:opacity-50"
        :disabled="!!busy || !gateway.isConfigured"
        @click="onPreview"
      >
        {{ busy === "preview" ? "Opening…" : "Open preview" }}
      </button>
    </div>
    <div v-if="status" class="mt-1 px-1 text-[11px] text-[#6b6b6b]">
      {{ status }}
    </div>
  </div>
</template>
