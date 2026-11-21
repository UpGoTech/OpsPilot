import { bundleWorkspaceHtmlForPreview } from "./bundleHtmlPreview";
import { fsDownload, fsReadText } from "./native";
import type { ConnectionConfig } from "../types";

function decodeBase64Utf8(b64: string): string {
  const binary = atob(b64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return new TextDecoder("utf-8", { fatal: false }).decode(bytes);
}

function coerceText(raw: unknown): string | null {
  if (typeof raw === "string" && raw.trim()) return raw;
  if (!raw || typeof raw !== "object") return null;
  const obj = raw as Record<string, unknown>;
  for (const key of ["content", "text", "data", "body", "html"]) {
    const v = obj[key];
    if (typeof v === "string" && v.trim()) return v;
  }
  return null;
}

function looksLikeHtml(text: string): boolean {
  const t = text.trim();
  return (
    /<!DOCTYPE\s+html/i.test(t) ||
    /<html[\s>]/i.test(t) ||
    /<(?:head|body|div|main|section|table|canvas|svg)\b/i.test(t)
  );
}

/**
 * Load workspace HTML for preview. Prefer /api/fs/download (auth-hardened)
 * then fall back to read-text. Relative sibling assets are inlined so a
 * blob: preview tab can still show data (JSON/JS/CSS next to the HTML).
 */
export async function fetchGatewayHtmlText(
  config: ConnectionConfig,
  path: string,
): Promise<string> {
  let text: string | null = null;

  try {
    const file = await fsDownload(config, path);
    text = decodeBase64Utf8(file.base64);
    if (!text.trim()) text = null;
  } catch {
    // fall through
  }

  if (!text) {
    const raw = await fsReadText(config, path);
    text = coerceText(raw);
  }

  if (!text) {
    throw new Error("Gateway returned empty HTML for this path");
  }
  if (!looksLikeHtml(text) && !text.includes("<")) {
    throw new Error("File does not look like HTML");
  }

  try {
    return await bundleWorkspaceHtmlForPreview(config, path, text);
  } catch {
    // Preview the shell even if sibling fetch fails.
    return text;
  }
}
