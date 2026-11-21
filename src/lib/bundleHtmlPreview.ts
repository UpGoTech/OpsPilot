import type { ConnectionConfig } from "../types";
import { fsDownload, fsReadText } from "./native";

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
  for (const key of ["content", "text", "data", "body"]) {
    const v = obj[key];
    if (typeof v === "string" && v.trim()) return v;
  }
  return null;
}

export function dirnameOfPath(path: string): string {
  const norm = path.replace(/\\/g, "/");
  const i = norm.lastIndexOf("/");
  return i <= 0 ? "/" : norm.slice(0, i);
}

/** Resolve a relative URL against a workspace directory (POSIX-ish). */
export function resolveAgainstDir(dir: string, ref: string): string | null {
  const trimmed = ref.trim();
  if (!trimmed) return null;
  if (/^(?:https?:|data:|blob:|javascript:|mailto:|#)/i.test(trimmed)) {
    return null;
  }
  // Absolute workspace path
  if (trimmed.startsWith("/")) return trimmed.replace(/\/+/g, "/");

  const base = dir.replace(/\/+$/, "") || "";
  const parts = [...base.split("/").filter(Boolean)];
  for (const seg of trimmed.replace(/^\.\//, "").split("/")) {
    if (!seg || seg === ".") continue;
    if (seg === "..") {
      parts.pop();
      continue;
    }
    parts.push(seg);
  }
  return `/${parts.join("/")}`;
}

function isRelativeAssetRef(ref: string): boolean {
  const t = ref.trim();
  if (!t) return false;
  if (/^(?:https?:|data:|blob:|javascript:|mailto:|#)/i.test(t)) return false;
  return true;
}

async function readWorkspaceText(
  config: ConnectionConfig,
  path: string,
): Promise<string | null> {
  try {
    const file = await fsDownload(config, path);
    const text = decodeBase64Utf8(file.base64);
    if (text.trim()) return text;
  } catch {
    // fall through
  }
  try {
    const raw = await fsReadText(config, path);
    return coerceText(raw);
  } catch {
    return null;
  }
}

function mimeForPath(path: string): string {
  const lower = path.toLowerCase();
  if (lower.endsWith(".json")) return "application/json";
  if (lower.endsWith(".css")) return "text/css";
  if (lower.endsWith(".js") || lower.endsWith(".mjs")) {
    return "application/javascript";
  }
  if (lower.endsWith(".csv")) return "text/csv";
  if (lower.endsWith(".svg")) return "image/svg+xml";
  if (lower.endsWith(".html") || lower.endsWith(".htm")) return "text/html";
  return "text/plain";
}

/** Collect relative refs from link/script/img and stringy fetch('…') calls. */
export function collectRelativeAssetRefs(html: string): string[] {
  const found = new Set<string>();
  const add = (raw: string | undefined) => {
    if (!raw || !isRelativeAssetRef(raw)) return;
    found.add(raw.trim());
  };

  for (const m of html.matchAll(
    /<link\b[^>]*\bhref\s*=\s*(["'])([^"']+)\1[^>]*>/gi,
  )) {
    add(m[2]);
  }
  for (const m of html.matchAll(
    /<script\b[^>]*\bsrc\s*=\s*(["'])([^"']+)\1[^>]*>/gi,
  )) {
    add(m[2]);
  }
  for (const m of html.matchAll(
    /<(?:img|source|video|audio)\b[^>]*\bsrc\s*=\s*(["'])([^"']+)\1[^>]*>/gi,
  )) {
    add(m[2]);
  }
  // fetch("…") / fetch('…') — common Hermes pattern for sibling JSON
  for (const m of html.matchAll(
    /\bfetch\s*\(\s*(["'])([^"']+)\1/gi,
  )) {
    add(m[2]);
  }
  for (const m of html.matchAll(
    /\b(?:open|load)\s*\(\s*(["'])(?:GET|POST)?["']?\s*,?\s*(["'])([^"']+)\2/gi,
  )) {
    add(m[3]);
  }

  return [...found];
}

function escapeScriptClose(text: string): string {
  return text.replace(/<\/script/gi, "<\\/script");
}

/**
 * Rewrite HTML so relative CSS/JS are inlined and relative fetch()/img
 * targets are served from an injected asset map. Needed because OpsPilot
 * opens preview as a blob: URL (no workspace directory for relative loads).
 */
export async function bundleWorkspaceHtmlForPreview(
  config: ConnectionConfig,
  htmlPath: string,
  html: string,
): Promise<string> {
  const dir = dirnameOfPath(htmlPath);
  const refs = collectRelativeAssetRefs(html);
  if (refs.length === 0) return html;

  const assetMap: Record<string, { mime: string; text: string }> = {};

  await Promise.all(
    refs.map(async (ref) => {
      const resolved = resolveAgainstDir(dir, ref);
      if (!resolved) return;
      const text = await readWorkspaceText(config, resolved);
      if (text == null) return;
      assetMap[ref] = { mime: mimeForPath(resolved), text };
      // Also key by basename and resolved path for looser lookups
      const base = resolved.split("/").pop();
      if (base) assetMap[base] = assetMap[ref];
      assetMap[resolved] = assetMap[ref];
    }),
  );

  let next = html;

  // Inline stylesheets
  next = next.replace(
    /<link\b([^>]*)\bhref\s*=\s*(["'])([^"']+)\2([^>]*)>/gi,
    (full, pre: string, _q: string, href: string, post: string) => {
      const entry = assetMap[href.trim()];
      const isCss =
        /\bstylesheet\b/i.test(pre + post) ||
        /\.css(?:$|\?)/i.test(href) ||
        (entry && entry.mime === "text/css");
      if (!entry || !isCss) return full;
      return `<style data-opspilot-inlined="${href}">\n${escapeScriptClose(entry.text)}\n</style>`;
    },
  );

  // Inline external scripts (keep type=module as module)
  next = next.replace(
    /<script\b([^>]*)\bsrc\s*=\s*(["'])([^"']+)\2([^>]*)>\s*<\/script>/gi,
    (full, pre: string, _q: string, src: string, post: string) => {
      const entry = assetMap[src.trim()];
      if (!entry) return full;
      const attrs = `${pre}${post}`.replace(/\bsrc\s*=\s*(["'])[^"']*\1/i, "");
      return `<script${attrs} data-opspilot-inlined="${src}">\n${escapeScriptClose(entry.text)}\n</script>`;
    },
  );

  // Inline small text/svg images as data URLs when we have text
  next = next.replace(
    /<(img|source)\b([^>]*)\bsrc\s*=\s*(["'])([^"']+)\3([^>]*)>/gi,
    (full, tag: string, pre: string, q: string, src: string, post: string) => {
      const entry = assetMap[src.trim()];
      if (!entry) return full;
      if (!/\.svg(?:$|\?)/i.test(src) && entry.mime !== "image/svg+xml") {
        return full;
      }
      const data = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(entry.text)}`;
      return `<${tag}${pre}src=${q}${data}${q}${post}>`;
    },
  );

  if (Object.keys(assetMap).length === 0) return next;

  const payload: Record<string, { mime: string; body: string }> = {};
  for (const [key, val] of Object.entries(assetMap)) {
    payload[key] = { mime: val.mime, body: val.text };
  }

  const shim = `<script data-opspilot-asset-shim>
(function () {
  var assets = ${JSON.stringify(payload)};
  function lookup(url) {
    if (!url) return null;
    var u = String(url).split("?")[0].split("#")[0];
    if (assets[u]) return assets[u];
    try {
      var path = u.replace(/^\\.\\//, "");
      if (assets[path]) return assets[path];
      var base = path.split("/").pop();
      if (base && assets[base]) return assets[base];
    } catch (_e) {}
    return null;
  }
  var _fetch = window.fetch;
  window.fetch = function (input, init) {
    var url = typeof input === "string" ? input : (input && input.url);
    var hit = lookup(url);
    if (hit) {
      return Promise.resolve(new Response(hit.body, {
        status: 200,
        headers: { "Content-Type": hit.mime + ";charset=utf-8" }
      }));
    }
    return _fetch.apply(this, arguments);
  };
  var XO = window.XMLHttpRequest;
  if (XO) {
    var open = XO.prototype.open;
    var send = XO.prototype.send;
    XO.prototype.open = function (method, url) {
      this.__opspilotUrl = url;
      return open.apply(this, arguments);
    };
    XO.prototype.send = function (body) {
      var hit = lookup(this.__opspilotUrl);
      if (hit) {
        var self = this;
        Object.defineProperty(self, "readyState", { get: function () { return 4; } });
        Object.defineProperty(self, "status", { get: function () { return 200; } });
        Object.defineProperty(self, "responseText", { get: function () { return hit.body; } });
        Object.defineProperty(self, "response", { get: function () { return hit.body; } });
        setTimeout(function () {
          if (typeof self.onreadystatechange === "function") self.onreadystatechange();
          if (typeof self.onload === "function") self.onload();
        }, 0);
        return;
      }
      return send.apply(this, arguments);
    };
  }
})();
</script>`;

  if (/<head\b[^>]*>/i.test(next)) {
    next = next.replace(/<head\b[^>]*>/i, (m) => `${m}\n${shim}`);
  } else if (/<html\b[^>]*>/i.test(next)) {
    next = next.replace(/<html\b[^>]*>/i, (m) => `${m}\n<head>${shim}</head>`);
  } else {
    next = `${shim}\n${next}`;
  }

  return next;
}
