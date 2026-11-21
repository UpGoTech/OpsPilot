import { isPlaceholderArtifactPath } from "./artifactPlaceholders";
import { gatewayPathFromHref } from "./gatewayPaths";
import { scrubServerPaths } from "./scrubServerPaths";

export interface PdfArtifact {
  path: string;
  filename: string;
}

/** Default dirs when the agent names a bare `Foo.pdf` in tool logs. */
const DEFAULT_PDF_DIRS = ["/opt/data", "/opt/data/attachments"];

function filenameOf(path: string): string {
  return path.split(/[/\\]/).pop() || "document.pdf";
}

function pushUnique(out: PdfArtifact[], path: string) {
  const cleaned = path.replace(/[.,;:]+$/, "");
  if (!cleaned.toLowerCase().endsWith(".pdf")) return;
  if (/[*?[\]{}]/.test(cleaned) || filenameOf(cleaned).startsWith("*.")) return;
  if (isPlaceholderArtifactPath(cleaned)) return;
  if (out.some((p) => p.path === cleaned)) return;
  out.push({ path: cleaned, filename: filenameOf(cleaned) });
}

function collectFromText(raw: string, out: PdfArtifact[]) {
  // Markdown links: [label](sandbox:/opt/…pdf) or bare path hrefs
  const mdLink = /\[([^\]]*)\]\(([^)]+)\)/g;
  let m: RegExpExecArray | null;
  while ((m = mdLink.exec(raw))) {
    const href = m[2].trim();
    const resolved =
      gatewayPathFromHref(href) || (href.startsWith("/") ? href : null);
    if (resolved) pushUnique(out, resolved);
  }

  // Explicit "File path: /opt/…" / Saved to / Created …
  const filePathLine =
    /(?:File\s*path|Saved\s*(?:to|as)|Path|Created(?:\s+and\s+verified)?(?:\s+the)?|output|wrote|writing)\s*[:：]?\s*`?([^\s`]+)`?/gi;
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

  // Quoted / assigned paths: p="/opt/data/Foo.pdf" or path = '/opt/…pdf'
  const assigned =
    /(?:^|[\s=:(])["'`](\/(?:opt|home|tmp|var|Users|data)\/[^"'`\s]+\.pdf)["'`]/gim;
  while ((m = assigned.exec(raw))) {
    pushUnique(out, m[1]);
  }

  // Bare absolute paths ending in .pdf
  const bare =
    /(?:^|[\s(])(\/(?:opt|home|tmp|var|Users|data)\/[^\s)\]>"']+\.pdf)/gm;
  while ((m = bare.exec(raw))) {
    pushUnique(out, m[1]);
  }
}

function collectBareFilenames(raw: string): string[] {
  const names: string[] = [];
  const labeled =
    /(?:^|[\s"'])(?:pdf|file|output|wrote|writing|saved(?:\s+as)?|created|path)\s*[:＝=]\s*[`"']?([\w.\-]+\.pdf)[`"']?/gim;
  let m: RegExpExecArray | null;
  while ((m = labeled.exec(raw))) {
    names.push(m[1]);
  }
  const lone =
    /(?:^|\n)[ \t]*[`"']?([\w.\-]+\.pdf)[`"']?[ \t]*(?=\n|$)/gim;
  while ((m = lone.exec(raw))) {
    names.push(m[1]);
  }
  return names;
}

/**
 * Collect PDF gateway paths from assistant prose and optional tool logs
 * (activity detail/output). Desktop often only names the path in a shell
 * command; OpsPilot must still surface Preview / Download cards.
 */
export function extractPdfArtifacts(
  source: string,
  extraSources: string[] = [],
): PdfArtifact[] {
  const chunks = [source || "", ...extraSources.filter(Boolean)];
  const raw = chunks.join("\n");
  const out: PdfArtifact[] = [];

  collectFromText(raw, out);

  const dirs = new Set<string>(DEFAULT_PDF_DIRS);
  for (const a of out) {
    const slash = a.path.lastIndexOf("/");
    if (slash > 0) dirs.add(a.path.slice(0, slash));
  }

  for (const name of collectBareFilenames(raw)) {
    if (out.some((a) => a.filename === name)) continue;
    for (const dir of dirs) {
      pushUnique(out, `${dir.replace(/\/$/, "")}/${name}`);
    }
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
