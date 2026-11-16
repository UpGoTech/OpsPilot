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
import {
  extractPreviewDirectives,
  extOfPath,
  filenameOfPath,
  type PreviewDirective,
} from "../lib/previewDirectives";
import { scrubServerPaths } from "../lib/scrubServerPaths";
import { useGatewayStore } from "../stores/gateway";
import { useLayoutStore } from "../stores/layout";
import FileArtifactCard from "./FileArtifactCard.vue";
import InlineHtmlPreview from "./InlineHtmlPreview.vue";
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

const DEFAULT_ATTACH = "/opt/data/attachments";

/** Resolve relative ::preview paths before scrubbing strips absolute ones. */
function resolvePreviewPath(file: string): string {
  const trimmed = file.trim();
  if (!trimmed) return trimmed;
  const fromHref = gatewayPathFromHref(trimmed);
  if (fromHref) return fromHref;
  if (trimmed.startsWith("/")) return trimmed;
  return `${DEFAULT_ATTACH}/${trimmed.replace(/^\.\//, "")}`;
}

const previewParsed = computed(() => extractPreviewDirectives(props.source || ""));

const previews = computed(() =>
  previewParsed.value.directives
    .map((d: PreviewDirective) => {
      const path = resolvePreviewPath(d.file);
      if (!path) return null;
      return {
        path,
        filename: filenameOfPath(path),
        ext: extOfPath(path),
      };
    })
    .filter((p): p is { path: string; filename: string; ext: string } => !!p),
);

/** Source with ::preview directives removed (paths still intact for other extractors). */
const withoutPreview = computed(() => previewParsed.value.remainder);

const extractedHtml = computed(() => extractHtmlDocument(withoutPreview.value));
const pdfs = computed(() => extractPdfArtifacts(withoutPreview.value));
const files = computed(() =>
  extractFileArtifacts(withoutPreview.value, props.artifactSources),
);

/** Paths already shown via ::preview — don't duplicate as file cards. */
const previewPaths = computed(
  () => new Set(previews.value.map((p) => p.path)),
);

const filteredPdfs = computed(() =>
  pdfs.value.filter((p) => !previewPaths.value.has(p.path)),
);
const filteredFiles = computed(() =>
  files.value.filter((f) => !previewPaths.value.has(f.path)),
);

const displaySource = computed(() => {
  let raw = withoutPreview.value || "";
  const htmlDoc = extractedHtml.value;
  if (htmlDoc) raw = htmlDoc.remainder;
  // Scrub AFTER ::preview extract so we don't empty file="…".
  raw = scrubServerPaths(raw, "remove");
  raw = stripPdfPathNoise(raw, pdfs.value);
  raw = stripFilePathNoise(raw, files.value);
  // Common agent footers that only make sense next to a live Desktop iframe.
  raw = raw.replace(
    /(?:^|\n)\s*File at\s*\([^)]*\)\.?\s*/gi,
    "\n",
  );
  raw = raw.replace(
    /Inline preview above renders the same file in-chat\.?/gi,
    "",
  );
  return raw.replace(/\n{3,}/g, "\n\n").trim();
});

const html = computed(() => {
  const raw = displaySource.value || "";
  if (
    !raw.trim() &&
    (extractedHtml.value ||
      filteredPdfs.value.length ||
      filteredFiles.value.length ||
      previews.value.length)
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
  layout.openHtmlDocument(doc.html, doc.title, { force: true });
}

async function downloadExtractedHtml() {
  const doc = extractedHtml.value;
  if (!doc) return;
  const filename =
    (doc.title || "preview").replace(/[^\w.\-]+/g, "_") + ".html";
  const blob = new Blob([doc.html], { type: "text/html;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  try {
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    a.rel = "noopener";
    document.body.appendChild(a);
    a.click();
    a.remove();
  } finally {
    URL.revokeObjectURL(url);
  }
}

function extOfHref(path: string): string {
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

  const ext = extOfHref(path);
  if (ext === "pdf" || DOWNLOADABLE_EXT.has(ext) || ext === "html" || ext === "htm")
    return;

  if (!gateway.isConfigured) {
    linkStatus.value = "Connect to download this file.";
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
    <!-- Prose first (Desktop places ::preview after the description). -->
    <div
      v-if="html"
      class="markdown-body text-[14px] leading-[1.55] text-[#1a1a1a] [&_a]:cursor-pointer [&_a]:text-[#1a1a1a] [&_a]:underline [&_a]:underline-offset-2 [&_code]:rounded-[4px] [&_code]:bg-[#e8e8e8] [&_code]:px-1 [&_code]:py-px [&_code]:font-mono [&_code]:text-[0.88em] [&_h1]:mb-2 [&_h1]:mt-3 [&_h1]:text-[16px] [&_h1]:font-semibold [&_h2]:mb-2 [&_h2]:mt-3 [&_h2]:text-[15px] [&_h2]:font-semibold [&_h3]:mb-1.5 [&_h3]:mt-2.5 [&_h3]:text-[14px] [&_h3]:font-semibold [&_li]:my-1.5 [&_li]:pl-0.5 [&_ol]:my-2 [&_ol]:list-decimal [&_ol]:pl-[1.25rem] [&_p]:my-2 [&_p:first-child]:mt-0 [&_p:last-child]:mb-0 [&_pre]:my-2.5 [&_pre]:overflow-x-auto [&_pre]:rounded-[10px] [&_pre]:border [&_pre]:border-[#e4e4e4] [&_pre]:bg-white [&_pre]:p-3 [&_pre]:text-[12.5px] [&_pre_code]:bg-transparent [&_pre_code]:p-0 [&_ul]:my-2 [&_ul]:list-disc [&_ul]:pl-[1.25rem] [&_strong]:font-semibold [&_blockquote]:border-l-2 [&_blockquote]:border-[#d4d4d4] [&_blockquote]:pl-3 [&_blockquote]:text-[#6b6b6b]"
      v-html="html"
      @click="onClick"
    />

    <!-- Desktop ::preview{file="…"} — inline HTML when readable, else file card -->
    <template v-for="p in previews" :key="`preview-${p.path}`">
      <InlineHtmlPreview
        v-if="p.ext === 'html' || p.ext === 'htm'"
        :path="p.path"
      />
      <PdfArtifactCard
        v-else-if="p.ext === 'pdf'"
        :artifact="{ path: p.path, filename: p.filename }"
      />
      <FileArtifactCard
        v-else
        :artifact="p"
      />
    </template>

    <!-- Fenced / raw HTML document → Desktop-style Download + Open preview -->
    <div
      v-if="extractedHtml"
      class="my-2 flex items-center gap-2 rounded-[10px] border border-[#e4e4e4] bg-white px-3 py-2"
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
        {{ extractedHtml.title }}
      </div>
      <button
        type="button"
        class="inline-flex shrink-0 items-center gap-1 rounded-md border border-[#e4e4e4] bg-white px-2.5 py-1 text-[12px] text-[#1e1e1e] hover:bg-[#f5f5f5]"
        @click="downloadExtractedHtml"
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
        Download
      </button>
      <button
        type="button"
        class="shrink-0 rounded-md border border-[#e4e4e4] bg-white px-2.5 py-1 text-[12px] text-[#1e1e1e] hover:bg-[#f5f5f5]"
        @click="openExtractedHtml"
      >
        Open preview
      </button>
    </div>

    <PdfArtifactCard
      v-for="pdf in filteredPdfs"
      :key="pdf.path"
      :artifact="pdf"
    />

    <FileArtifactCard
      v-for="file in filteredFiles"
      :key="file.path"
      :artifact="file"
    />

    <div v-if="linkStatus" class="mt-1 px-1 text-[11px] text-[#6b6b6b]">
      {{ linkStatus }}
    </div>
  </div>
</template>
