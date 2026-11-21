import { isPlaceholderArtifactPath } from "./artifactPlaceholders";
import { gatewayPathFromHref } from "./gatewayPaths";
import { scrubServerPaths } from "./scrubServerPaths";

/**
 * Downloadable / previewable workspace artifacts (PDF has its own extractor).
 * Include html/htm so path-only replies still get Preview / Download cards.
 */
export const DOWNLOADABLE_EXT = new Set([
  "html",
  "htm",
  "zip",
  "rar",
  "7z",
  "xls",
  "xlsx",
  "xlsm",
  "csv",
  "doc",
  "docx",
  "ppt",
  "pptx",
  "txt",
  "md",
  "rtf",
]);

/** Default dirs when the agent names a bare `Foo.html` in tool logs. */
const DEFAULT_ATTACH_DIRS = ["/opt/data", "/opt/data/attachments"];

export interface FileArtifact {
  path: string;
  filename: string;
  ext: string;
}

function filenameOf(path: string): string {
  return path.split(/[/\\]/).pop() || "download";
}

function extOf(path: string): string {
  const name = filenameOf(path);
  const dot = name.lastIndexOf(".");
  return dot >= 0 ? name.slice(dot + 1).toLowerCase() : "";
}

function isGlobbish(path: string): boolean {
  return /[*?[\]{}]|^\*\./.test(path) || filenameOf(path).startsWith("*.");
}

function pushUnique(out: FileArtifact[], path: string) {
  const cleaned = path.replace(/[.,;:]+$/, "");
  if (isGlobbish(cleaned)) return;
  if (isPlaceholderArtifactPath(cleaned)) return;
  const ext = extOf(cleaned);
  if (!DOWNLOADABLE_EXT.has(ext)) return;
  if (out.some((p) => p.path === cleaned)) return;
  out.push({ path: cleaned, filename: filenameOf(cleaned), ext });
}

const EXT_ALT = [...DOWNLOADABLE_EXT].join("|");

function collectAbsolutePaths(raw: string, out: FileArtifact[]) {
  const mdLink = /\[([^\]]*)\]\(([^)]+)\)/g;
  let m: RegExpExecArray | null;
  while ((m = mdLink.exec(raw))) {
    const href = m[2].trim();
    const resolved =
      gatewayPathFromHref(href) || (href.startsWith("/") ? href : null);
    if (resolved) pushUnique(out, resolved);
  }

  const filePathLine =
    /(?:File\s*path|Saved\s*(?:to|as)|Path|Created(?:\s+and\s+verified)?(?:\s+the)?|zip|archive|output)\s*[:：]?\s*`?([^\s`]+)`?/gi;
  while ((m = filePathLine.exec(raw))) {
    const candidate = m[1].replace(/[.,;]+$/, "");
    const resolved =
      gatewayPathFromHref(candidate) ||
      (candidate.startsWith("/") ? candidate : null);
    if (resolved) pushUnique(out, resolved);
  }

  const prefixed = new RegExp(
    `(?:sandbox:|file:\\/\\/|MEDIA:)(\\/?[^\\s)\\]>"']+\\.(?:${EXT_ALT}))`,
    "gi",
  );
  while ((m = prefixed.exec(raw))) {
    const resolved = gatewayPathFromHref(m[0]);
    if (resolved) pushUnique(out, resolved);
  }

  // Quoted / assigned: path="/opt/data/Foo.html"
  const assigned = new RegExp(
    `(?:^|[\\s=:(])["'\`](\\/(?:opt|home|tmp|var|Users|data)\\/[^"'\`\\s]+\\.(?:${EXT_ALT}))["'\`]`,
    "gim",
  );
  while ((m = assigned.exec(raw))) {
    pushUnique(out, m[1]);
  }

  const bareAbs = new RegExp(
    `(?:^|[\\s(])(\\/(?:opt|home|tmp|var|Users|data)\\/[^\\s)\\]>"']+\\.(?:${EXT_ALT}))`,
    "gm",
  );
  while ((m = bareAbs.exec(raw))) {
    pushUnique(out, m[1]);
  }
}

/**
 * Bare filenames the agent named without a full path
 * (e.g. `zip: all_attachments.zip` in tool stdout).
 */
function collectBareFilenames(raw: string): string[] {
  const names: string[] = [];
  const pushName = (name: string) => {
    if (!name || isGlobbish(name)) return;
    if (!names.some((n) => n.toLowerCase() === name.toLowerCase())) {
      names.push(name);
    }
  };

  const labeled = new RegExp(
    `(?:^|[\\s"'])(?:zip|archive|output|wrote|writing|saved(?:\\s+as)?|created|file)\\s*[:＝=]\\s*[\`"']?([\\w.\\-]+\\.(?:${EXT_ALT}))[\`"']?`,
    "gim",
  );
  let m: RegExpExecArray | null;
  while ((m = labeled.exec(raw))) {
    pushName(m[1]);
  }

  // Standalone filename on its own line (all_attachments.zip) — not globs (*.html).
  const lone = new RegExp(
    `(?:^|\\n)[ \\t]*[\`"']?([A-Za-z0-9_][\\w.\\-]*\\.(?:${EXT_ALT}))[\`"']?[ \\t]*(?=\\n|$)`,
    "gim",
  );
  while ((m = lone.exec(raw))) {
    pushName(m[1]);
  }

  // Any downloadable filename token in prose (FabriXcel_Projects_Interactive.html).
  const any = new RegExp(
    `\\b([A-Za-z0-9_][\\w.\\-]*\\.(?:${EXT_ALT}))\\b`,
    "gi",
  );
  while ((m = any.exec(raw))) {
    pushName(m[1]);
  }

  return names;
}

/** User/assistant text that is clearly about an HTML workspace file. */
export function refersToHtmlArtifact(...texts: string[]): boolean {
  const raw = texts.filter(Boolean).join("\n");
  if (!raw.trim()) return false;
  if (/\.html?\b/i.test(raw)) return true;
  if (/\b::preview\b/i.test(raw)) return true;
  if (
    /\b(?:interactive|self-contained|dashboard|preview)\b/i.test(raw) &&
    /\b(?:html|htm|file|page|report)\b/i.test(raw)
  ) {
    return true;
  }
  if (
    /\b(?:show|open|download|last(?:\s+generated)?)\b/i.test(raw) &&
    /\b(?:html|htm)\b/i.test(raw)
  ) {
    return true;
  }
  return false;
}

/** Most recent HTML/HTM path found by scanning texts newest-last. */
export function lastHtmlPathFromTexts(texts: string[]): string | null {
  let last: string | null = null;
  for (const text of texts) {
    if (!text?.trim()) continue;
    for (const file of extractFileArtifacts(text)) {
      if (file.ext === "html" || file.ext === "htm") last = file.path;
    }
  }
  return last;
}

function attachDirsFrom(artifacts: FileArtifact[]): string[] {
  const dirs = new Set<string>(DEFAULT_ATTACH_DIRS);
  for (const a of artifacts) {
    const slash = a.path.lastIndexOf("/");
    if (slash > 0) dirs.add(a.path.slice(0, slash));
  }
  return [...dirs];
}

/**
 * Collect downloadable gateway paths from assistant prose and optional
 * tool logs (activity detail/output). Resolves bare names into the
 * attachments folder when the agent omits the full /opt/… path.
 */
export function extractFileArtifacts(
  source: string,
  extraSources: string[] = [],
): FileArtifact[] {
  const chunks = [source || "", ...extraSources.filter(Boolean)];
  const raw = chunks.join("\n");
  const out: FileArtifact[] = [];

  collectAbsolutePaths(raw, out);

  const dirs = attachDirsFrom(out);
  const bareNames = collectBareFilenames(raw);
  for (const name of bareNames) {
    // Prefer an absolute path already found for this name.
    if (out.some((a) => a.filename === name)) continue;
    // Resolve into known attachment dirs (usually /opt/data/attachments).
    for (const dir of dirs) {
      pushUnique(out, `${dir.replace(/\/$/, "")}/${name}`);
    }
  }

  // Prefer the "bundle" zip when both a nest zip and all_attachments.zip exist —
  // still show all; user can pick. Deduped by path already.

  return out;
}

/** Hide gateway paths in chat prose — download card keeps the filename. */
export function stripFilePathNoise(
  source: string,
  _files: FileArtifact[],
): string {
  return scrubServerPaths(source, "remove");
}

export function labelForExt(ext: string): string {
  const map: Record<string, string> = {
    html: "HTML",
    htm: "HTML",
    zip: "ZIP",
    rar: "RAR",
    "7z": "7Z",
    xls: "XLS",
    xlsx: "XLSX",
    xlsm: "XLSM",
    csv: "CSV",
    doc: "DOC",
    docx: "DOCX",
    ppt: "PPT",
    pptx: "PPTX",
    txt: "TXT",
    md: "MD",
    rtf: "RTF",
  };
  return map[ext] || ext.toUpperCase() || "FILE";
}
