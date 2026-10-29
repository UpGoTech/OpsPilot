<script setup lang="ts">
import { computed, ref, watch } from "vue";
import { marked } from "marked";
import { extractHtmlDocument } from "../lib/extractHtml";
import {
  DOWNLOADABLE_EXT,
  extractFileArtifacts,
  stripFilePathNoise,
} from "../lib/extractFileArtifacts";
import {
  extractPdfArtifacts,
  stripPdfPathNoise,
} from "../lib/extractPdf";
import { saveGatewayArtifactAs } from "../lib/downloadArtifact";
import { gatewayPathFromHref } from "../lib/gatewayPaths";
import { scrubServerPaths } from "../lib/scrubServerPaths";
import { useGatewayStore } from "../stores/gateway";
import { useLayoutStore } from "../stores/layout";
import FileArtifactCard from "./FileArtifactCard.vue";
import PdfArtifactCard from "./PdfArtifactCard.vue";

const props = withDefaults(
  defineProps<{
    source: string;
    /** Tool logs / extra text to mine for downloadable paths (not shown). */
    artifactSources?: string[];
    /**
     * Auto-open extracted HTML in the center pane.
     * Opt-in only — must stay false for history remounts / session switches.
     */
    autoOpenHtml?: boolean;
  }>(),
  { autoOpenHtml: false, artifactSources: () => [] },
);

const layout = useLayoutStore();
const gateway = useGatewayStore();
const openedKey = ref<string | null>(null);
const linkStatus = ref<string | null>(null);

marked.setOptions({
  gfm: true,
  breaks: true,
});

const extractedHtml = computed(() => extractHtmlDocument(props.source));
const pdfs = computed(() => extractPdfArtifacts(props.source));
const files = computed(() =>
  extractFileArtifacts(props.source, props.artifactSources),
);

const displaySource = computed(() => {
  let raw = props.source || "";
  const htmlDoc = extractedHtml.value;
  if (htmlDoc) raw = htmlDoc.remainder;
  // Always scrub /opt/… from bubble text; cards carry the download UI.
  raw = scrubServerPaths(raw, "remove");
  raw = stripPdfPathNoise(raw, pdfs.value);
  raw = stripFilePathNoise(raw, files.value);
  return raw;
});

const html = computed(() => {
  const raw = displaySource.value || "";
  if (
    !raw.trim() &&
    (extractedHtml.value || pdfs.value.length || files.value.length)
  ) {
    return "";
  }
  try {
    return marked.parse(raw, { async: false }) as string;
  } catch {
    return raw
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;");
  }
});

watch(
  () => [extractedHtml.value?.html, props.autoOpenHtml] as const,
  ([docHtml, auto]) => {
    // Only while explicitly live (streaming). Never on history mount.
    if (!auto || !docHtml) return;
    const key = `${docHtml.length}:${docHtml.slice(0, 80)}`;
    if (openedKey.value === key) return;
    openedKey.value = key;
    layout.openHtmlDocument(
      docHtml,
      extractedHtml.value?.title || "HTML preview",
    );
  },
);

function openExtractedHtml() {
  const doc = extractedHtml.value;
  if (!doc) return;
  // Manual open always wins over a prior dismiss.
  layout.openHtmlDocument(doc.html, doc.title, { force: true });
}

function extOfPath(path: string): string {
  const base = path.split(/[/\\]/).pop() || "";
  const dot = base.lastIndexOf(".");
  return dot >= 0 ? base.slice(dot + 1).toLowerCase() : "";
}

async function onClick(event: MouseEvent) {
  const target = event.target as HTMLElement | null;
  const anchor = target?.closest?.("a") as HTMLAnchorElement | null;
  if (!anchor) return;

  const href = anchor.getAttribute("href") || "";
  const path = gatewayPathFromHref(href);
  if (!path) return;

  event.preventDefault();
  event.stopPropagation();

  const ext = extOfPath(path);
  // PDF / downloadable types already have cards — click is a no-op (card owns Download).
  if (ext === "pdf" || DOWNLOADABLE_EXT.has(ext)) return;

  if (!gateway.isConfigured) {
    linkStatus.value = "Connect to the gateway to download this file.";
    return;
  }

  linkStatus.value = "Saving…";
  try {
    const saved = await saveGatewayArtifactAs(gateway.connection, path);
    linkStatus.value = saved ? `Saved to ${saved.localPath}` : null;
  } catch (err) {
    linkStatus.value =
      err instanceof Error ? err.message : `Download failed: ${String(err)}`;
  }
}
</script>

<template>
  <div>
    <div
      v-if="extractedHtml"
      class="mb-2 flex items-center gap-2 rounded-[10px] border border-[#e4e4e4] bg-white px-3 py-2"
    >
      <span class="text-[12px] text-[#8a8a8a]" aria-hidden="true">&lt;/&gt;</span>
      <div class="min-w-0 flex-1 truncate text-[13px] text-[#3c3c3c]">
        {{ extractedHtml.title }}
      </div>
      <button
        type="button"
        class="shrink-0 rounded-md bg-[#efefef] px-2.5 py-1 text-[12px] text-[#1e1e1e] hover:bg-[#e4e4e4]"
        @click="openExtractedHtml"
      >
        Open in browser
      </button>
    </div>

    <PdfArtifactCard
      v-for="pdf in pdfs"
      :key="pdf.path"
      :artifact="pdf"
    />

    <FileArtifactCard
      v-for="file in files"
      :key="file.path"
      :artifact="file"
    />

    <div
      v-if="html"
      class="markdown-body text-[14px] leading-[1.55] text-[#1a1a1a] [&_a]:cursor-pointer [&_a]:text-[#1a1a1a] [&_a]:underline [&_a]:underline-offset-2 [&_code]:rounded-[4px] [&_code]:bg-[#e8e8e8] [&_code]:px-1 [&_code]:py-px [&_code]:font-mono [&_code]:text-[0.88em] [&_h1]:mb-2 [&_h1]:mt-3 [&_h1]:text-[16px] [&_h1]:font-semibold [&_h2]:mb-2 [&_h2]:mt-3 [&_h2]:text-[15px] [&_h2]:font-semibold [&_h3]:mb-1.5 [&_h3]:mt-2.5 [&_h3]:text-[14px] [&_h3]:font-semibold [&_li]:my-1.5 [&_li]:pl-0.5 [&_ol]:my-2 [&_ol]:list-decimal [&_ol]:pl-[1.25rem] [&_p]:my-2 [&_p:first-child]:mt-0 [&_p:last-child]:mb-0 [&_pre]:my-2.5 [&_pre]:overflow-x-auto [&_pre]:rounded-[10px] [&_pre]:border [&_pre]:border-[#e4e4e4] [&_pre]:bg-white [&_pre]:p-3 [&_pre]:text-[12.5px] [&_pre_code]:bg-transparent [&_pre_code]:p-0 [&_ul]:my-2 [&_ul]:list-disc [&_ul]:pl-[1.25rem] [&_strong]:font-semibold [&_blockquote]:border-l-2 [&_blockquote]:border-[#d4d4d4] [&_blockquote]:pl-3 [&_blockquote]:text-[#6b6b6b]"
      v-html="html"
      @click="onClick"
    />

    <div v-if="linkStatus" class="mt-1 px-1 text-[11px] text-[#6b6b6b]">
      {{ linkStatus }}
    </div>
  </div>
</template>
