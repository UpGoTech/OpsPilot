export interface ExtractedHtmlDoc {
  /** Full HTML document to render in the browser pane. */
  html: string;
  /** Suggested title from <title> or fence. */
  title: string;
  /** Markdown/source with the HTML block replaced by a short placeholder. */
  remainder: string;
}

const FENCE_RE =
  /```(?:html|HTML)\s*\n([\s\S]*?)```/g;
const RAW_DOC_RE =
  /<!DOCTYPE\s+html[\s\S]*?<\/html\s*>/i;
const RAW_HTML_RE = /<html[\s\S]*?<\/html\s*>/i;

function titleFromHtml(html: string): string {
  const m = html.match(/<title[^>]*>([^<]*)<\/title>/i);
  const t = m?.[1]?.trim();
  return t || "HTML preview";
}

function wrapFragment(fragment: string): string {
  const trimmed = fragment.trim();
  if (/^<!DOCTYPE/i.test(trimmed) || /^<html[\s>]/i.test(trimmed)) {
    return trimmed;
  }
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Preview</title>
  <style>
    body { font-family: system-ui, sans-serif; margin: 24px; color: #1a1a1a; }
    table { border-collapse: collapse; width: 100%; }
    th, td { border: 1px solid #ddd; padding: 8px 10px; text-align: left; }
    th { background: #f5f5f5; }
  </style>
</head>
<body>
${trimmed}
</body>
</html>`;
}

/**
 * Pull a standalone HTML document out of an assistant message so chat can
 * stay clean and the center browser can render it.
 */
export function extractHtmlDocument(source: string): ExtractedHtmlDoc | null {
  const raw = source || "";
  if (!raw.trim()) return null;

  FENCE_RE.lastIndex = 0;
  const fence = FENCE_RE.exec(raw);
  if (fence?.[1]?.trim()) {
    const inner = fence[1].trim();
    // Prefer full docs / tables / substantial markup — not tiny snippets.
    const looksSubstantial =
      /<!DOCTYPE|<html[\s>]|<table[\s>]|<body[\s>]/i.test(inner) ||
      inner.length > 400;
    if (looksSubstantial) {
      const html = wrapFragment(inner);
      const remainder = raw
        .replace(fence[0], "")
        .replace(/\n{3,}/g, "\n\n")
        .trim();
      return { html, title: titleFromHtml(html), remainder };
    }
  }

  const rawMatch = raw.match(RAW_DOC_RE) || raw.match(RAW_HTML_RE);
  if (rawMatch?.[0]) {
    const html = wrapFragment(rawMatch[0]);
    const remainder = raw
      .replace(rawMatch[0], "")
      .replace(/\n{3,}/g, "\n\n")
      .trim();
    return { html, title: titleFromHtml(html), remainder };
  }

  // Unfenced document that starts mid-message (agent often dumps HTML after a lead-in).
  const doctypeAt = raw.search(/<!DOCTYPE\s+html/i);
  if (doctypeAt >= 0) {
    const slice = raw.slice(doctypeAt).trim();
    if (slice.length > 200) {
      const html = wrapFragment(slice);
      const remainder = raw.slice(0, doctypeAt).replace(/\n{3,}/g, "\n\n").trim();
      return { html, title: titleFromHtml(html), remainder };
    }
  }

  return null;
}
