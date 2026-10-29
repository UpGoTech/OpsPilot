import { gatewayPathFromHref } from "./gatewayPaths";
import { scrubServerPaths } from "./scrubServerPaths";

export interface PdfArtifact {
  path: string;
  filename: string;
}

function filenameOf(path: string): string {
  return path.split(/[/\\]/).pop() || "document.pdf";
}

function pushUnique(out: PdfArtifact[], path: string) {
  if (!path.toLowerCase().endsWith(".pdf")) return;
  if (out.some((p) => p.path === path)) return;
  out.push({ path, filename: filenameOf(path) });
}

/**
 * Collect PDF gateway paths mentioned in an assistant message
 * (markdown links, sandbox:/file://, "File path:" lines, bare /opt/…pdf).
 */
export function extractPdfArtifacts(source: string): PdfArtifact[] {
  const raw = source || "";
  const out: PdfArtifact[] = [];

  // Markdown links: [label](sandbox:/opt/…pdf) or bare path hrefs
  const mdLink = /\[([^\]]*)\]\(([^)]+)\)/g;
  let m: RegExpExecArray | null;
  while ((m = mdLink.exec(raw))) {
    const href = m[2].trim();
    const resolved = gatewayPathFromHref(href) || (href.startsWith("/") ? href : null);
    if (resolved) pushUnique(out, resolved);
  }

  // Explicit "File path: /opt/…"
  const filePathLine =
    /(?:File\s*path|Saved\s*(?:to|as)|Path)\s*[:：]\s*`?([^\s`]+)`?/gi;
  while ((m = filePathLine.exec(raw))) {
    const candidate = m[1].replace(/[.,;]+$/, "");
    const resolved =
      gatewayPathFromHref(candidate) ||
      (candidate.startsWith("/") ? candidate : null);
    if (resolved) pushUnique(out, resolved);
  }

  // sandbox:/ / file:// / MEDIA: with .pdf
  const prefixed =
    /(?:sandbox:|file:\/\/|MEDIA:)(\/?[^\s)\]>"']+\.pdf)/gi;
  while ((m = prefixed.exec(raw))) {
    const resolved = gatewayPathFromHref(m[0]);
    if (resolved) pushUnique(out, resolved);
  }

  // Bare absolute paths ending in .pdf
  const bare = /(?:^|[\s(])(\/(?:opt|home|tmp|var|Users)\/[^\s)\]>"']+\.pdf)/g;
  while ((m = bare.exec(raw))) {
    pushUnique(out, m[1]);
  }

  return out;
}

/** Hide gateway PDF paths once we show the action card — no /opt/… as chat text. */
export function stripPdfPathNoise(source: string, _pdfs: PdfArtifact[]): string {
  let next = scrubServerPaths(source, "remove");
  next = next.replace(/\bDownload the PDF\b/gi, "");
  next = next.replace(/Saved to \/Users\/[^\n]+ \(\d+ bytes\)/g, "");
  next = next.replace(/\bReveal in Finder\b/gi, "");
  next = next.replace(/\bShow on gateway\b/gi, "");
  return next.replace(/\n{3,}/g, "\n\n").trim();
}
