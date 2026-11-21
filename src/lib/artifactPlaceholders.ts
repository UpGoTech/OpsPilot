/**
 * Reject policy/example paths Hermes sometimes echoes literally
 * (e.g. ::preview{file="/opt/data/YourFile.html"}).
 */
const PLACEHOLDER_NAMES = new Set([
  "yourfile.html",
  "yourfile.htm",
  "yourfile.pdf",
  "example.html",
  "example.htm",
  "example.pdf",
  "foo.html",
  "foo.htm",
  "foo.pdf",
  "bar.html",
  "file.html",
  "file.pdf",
  "document.html",
  "document.pdf",
  "preview.html",
  "sample.html",
  "sample.pdf",
  "test.html",
  "test.pdf",
]);

export function filenameOfArtifactPath(path: string): string {
  return path.split(/[/\\]/).pop() || path;
}

export function isPlaceholderArtifactPath(path: string): boolean {
  const cleaned = path.trim().replace(/[.,;:]+$/, "");
  if (!cleaned) return true;
  if (/[<>{}]|^\*|\/\.\.\//.test(cleaned)) return true;
  if (/\b(?:your[-_]?file|example|placeholder|replaceme)\b/i.test(cleaned)) {
    return true;
  }
  const name = filenameOfArtifactPath(cleaned).toLowerCase();
  return PLACEHOLDER_NAMES.has(name);
}
