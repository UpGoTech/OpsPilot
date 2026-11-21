/**
 * Parse Desktop-style `::preview{file="…"}` directives from assistant text.
 * Attributes may include file / height (height ignored for remote card fallback).
 */

import { isPlaceholderArtifactPath } from "./artifactPlaceholders";

export interface PreviewDirective {
  file: string;
  raw: string;
  index: number;
}

const PREVIEW_RE =
  /::preview\s*\{([^}]*)\}/gi;

function attr(block: string, name: string): string | null {
  const re = new RegExp(`${name}\\s*=\\s*["']([^"']+)["']`, "i");
  const m = block.match(re);
  return m?.[1]?.trim() || null;
}

export function extractPreviewDirectives(source: string): {
  directives: PreviewDirective[];
  remainder: string;
} {
  const directives: PreviewDirective[] = [];
  let remainder = source || "";
  let match: RegExpExecArray | null;
  const re = new RegExp(PREVIEW_RE.source, "gi");
  while ((match = re.exec(source || "")) !== null) {
    const file = attr(match[1] || "", "file");
    if (!file || isPlaceholderArtifactPath(file)) {
      // Still strip placeholder directives from visible prose.
      remainder = remainder.replace(match[0], "");
      continue;
    }
    directives.push({
      file,
      raw: match[0],
      index: match.index,
    });
  }
  for (const d of directives) {
    remainder = remainder.replace(d.raw, "");
  }
  remainder = remainder.replace(/\n{3,}/g, "\n\n").trim();
  return { directives, remainder };
}

export function filenameOfPath(path: string): string {
  return path.split(/[/\\]/).pop() || path;
}

export function extOfPath(path: string): string {
  const name = filenameOfPath(path);
  const dot = name.lastIndexOf(".");
  return dot >= 0 ? name.slice(dot + 1).toLowerCase() : "";
}
