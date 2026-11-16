import type { ConnectionConfig } from "../../src/types";
import {
  cookieHeader,
  filteredExtraHeaders,
  httpBase,
  percentEncode,
} from "./connection";

export interface StatusProbe {
  ok: boolean;
  status: number;
  body: unknown;
}

export interface DownloadedFile {
  path: string;
  filename: string;
  mime: string;
  base64: string;
  byteLength: number;
}

export interface SavedLocalFile {
  remotePath: string;
  localPath: string;
  filename: string;
  byteLength: number;
}

function applyAuth(
  headers: Record<string, string>,
  config: ConnectionConfig,
): Record<string, string> {
  const out: Record<string, string> = {
    Accept: "application/json",
    ...headers,
  };
  const cookie = cookieHeader(config);
  const token = config.token?.trim() ?? "";
  if (!cookie && !token) {
    throw new Error("Not authenticated — sign in or provide a session token");
  }
  if (cookie) out.Cookie = cookie;
  if (token) out["X-Hermes-Session-Token"] = token;
  for (const [name, value] of filteredExtraHeaders(config)) {
    out[name] = value;
  }
  return out;
}

async function authorizedGet(
  config: ConnectionConfig,
  pathAndQuery: string,
): Promise<{ status: number; body: unknown }> {
  const base = httpBase(config);
  const response = await fetch(`${base}${pathAndQuery}`, {
    method: "GET",
    headers: applyAuth({}, config),
    credentials: "omit",
  });
  const status = response.status;
  const text = await response.text();
  let body: unknown = null;
  if (text.trim()) {
    try {
      body = JSON.parse(text);
    } catch {
      body = text;
    }
  }
  if (status < 200 || status >= 300) {
    const detail =
      body && typeof body === "object"
        ? ((body as Record<string, unknown>).detail ??
          (body as Record<string, unknown>).error ??
          (body as Record<string, unknown>).message ??
          body)
        : body;
    throw new Error(`HTTP ${status}: ${detail}`);
  }
  return { status, body };
}

export async function testConnection(
  config: ConnectionConfig,
): Promise<StatusProbe> {
  const base = httpBase(config);
  const response = await fetch(`${base}/api/status`, {
    method: "GET",
    headers: { Accept: "application/json" },
    credentials: "omit",
  });
  const status = response.status;
  const text = await response.text();
  if (status < 200 || status >= 300) {
    throw new Error(`Gateway not reachable (HTTP ${status})`);
  }
  let body: Record<string, unknown>;
  try {
    body = JSON.parse(text) as Record<string, unknown>;
  } catch {
    throw new Error(
      `Got HTTP ${status} but not a Hermes /api/status JSON body. Paste the gateway base URL. Tried: ${base}`,
    );
  }
  if (body.auth_required == null && body.overall == null) {
    throw new Error(
      `Unexpected /api/status payload. Use the gateway base URL, not /login. Tried: ${base}`,
    );
  }
  return { ok: true, status, body };
}

export async function defaultCwd(config: ConnectionConfig): Promise<unknown> {
  const { body } = await authorizedGet(config, "/api/fs/default-cwd");
  return body;
}

export async function listPath(
  config: ConnectionConfig,
  path: string,
): Promise<unknown> {
  const encoded = percentEncode(path);
  const { body } = await authorizedGet(config, `/api/fs/list?path=${encoded}`);
  return body;
}

export async function readText(
  config: ConnectionConfig,
  path: string,
): Promise<unknown> {
  const encoded = percentEncode(path);
  const { body } = await authorizedGet(
    config,
    `/api/fs/read-text?path=${encoded}`,
  );
  return body;
}

function filenameFromPath(path: string): string {
  return path.split(/[/\\]/).filter(Boolean).pop() || "download";
}

function guessMime(filename: string): string {
  const lower = filename.toLowerCase();
  if (lower.endsWith(".pdf")) return "application/pdf";
  if (lower.endsWith(".png")) return "image/png";
  if (lower.endsWith(".jpg") || lower.endsWith(".jpeg")) return "image/jpeg";
  if (lower.endsWith(".html") || lower.endsWith(".htm")) return "text/html";
  if (lower.endsWith(".json")) return "application/json";
  if (lower.endsWith(".csv")) return "text/csv";
  if (lower.endsWith(".txt") || lower.endsWith(".md")) return "text/plain";
  return "application/octet-stream";
}

function bytesToBase64(bytes: Uint8Array): string {
  let binary = "";
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(binary);
}

function splitDataUrl(dataUrl: string): { mime: string; b64: string } | null {
  const match = /^data:([^;,]+)?(?:;base64)?,(.+)$/i.exec(dataUrl);
  if (!match) return null;
  return { mime: match[1] || "", b64: match[2] || "" };
}

async function fetchRemoteBytes(
  config: ConnectionConfig,
  path: string,
): Promise<{ filename: string; mime: string; bytes: Uint8Array }> {
  const filename = filenameFromPath(path);
  let mime = guessMime(filename);
  const encoded = percentEncode(path);
  const base = httpBase(config);

  const downloadUrl = `${base}/api/fs/download?path=${encoded}`;
  const response = await fetch(downloadUrl, {
    method: "GET",
    headers: applyAuth({}, config),
    credentials: "omit",
  });
  if (response.ok) {
    const buf = new Uint8Array(await response.arrayBuffer());
    return { filename, mime, bytes: buf };
  }

  const status = response.status;
  const { body } = await authorizedGet(
    config,
    `/api/fs/read-data-url?path=${encoded}`,
  ).catch((err: Error) => {
    throw new Error(
      `Couldn't fetch ${filename} from the gateway (HTTP ${status}; fallback: ${err.message})`,
    );
  });

  const dataUrl =
    typeof body === "string"
      ? body
      : body && typeof body === "object"
        ? String(
            (body as Record<string, unknown>).dataUrl ??
              (body as Record<string, unknown>).data_url ??
              "",
          )
        : "";
  const parsed = splitDataUrl(dataUrl);
  if (!parsed) throw new Error("Gateway returned no data URL for this file");
  if (parsed.mime) mime = parsed.mime;
  const binary = atob(parsed.b64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return { filename, mime, bytes };
}

export async function downloadFile(
  config: ConnectionConfig,
  path: string,
): Promise<DownloadedFile> {
  const { filename, mime, bytes } = await fetchRemoteBytes(config, path);
  return {
    path,
    filename,
    mime,
    byteLength: bytes.byteLength,
    base64: bytesToBase64(bytes),
  };
}

/** Trigger a browser download (Chrome / Brave / Edge). */
export async function downloadToDownloads(
  config: ConnectionConfig,
  path: string,
): Promise<SavedLocalFile> {
  const file = await downloadFile(config, path);
  const binary = atob(file.base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  const blob = new Blob([bytes], { type: file.mime });
  const objectUrl = URL.createObjectURL(blob);

  if (chrome.downloads?.download) {
    const downloadId = await chrome.downloads.download({
      url: objectUrl,
      filename: file.filename,
      saveAs: false,
    });
    // Revoke after Chromium has had a chance to start the download.
    setTimeout(() => URL.revokeObjectURL(objectUrl), 60_000);
    return {
      remotePath: path,
      localPath: `downloads://${downloadId}`,
      filename: file.filename,
      byteLength: file.byteLength,
    };
  }

  const a = document.createElement("a");
  a.href = objectUrl;
  a.download = file.filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(objectUrl), 60_000);
  return {
    remotePath: path,
    localPath: file.filename,
    filename: file.filename,
    byteLength: file.byteLength,
  };
}

export async function downloadToPath(
  config: ConnectionConfig,
  path: string,
  _dest: string,
): Promise<SavedLocalFile> {
  // Chromium cannot write arbitrary paths; offer Save As via downloads API.
  const file = await downloadFile(config, path);
  const binary = atob(file.base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  const blob = new Blob([bytes], { type: file.mime });
  const objectUrl = URL.createObjectURL(blob);

  if (chrome.downloads?.download) {
    const downloadId = await chrome.downloads.download({
      url: objectUrl,
      filename: file.filename,
      saveAs: true,
    });
    setTimeout(() => URL.revokeObjectURL(objectUrl), 60_000);
    return {
      remotePath: path,
      localPath: `downloads://${downloadId}`,
      filename: file.filename,
      byteLength: file.byteLength,
    };
  }

  const a = document.createElement("a");
  a.href = objectUrl;
  a.download = file.filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(objectUrl), 60_000);
  return {
    remotePath: path,
    localPath: file.filename,
    filename: file.filename,
    byteLength: file.byteLength,
  };
}

/** Preview via blob URL (works in Chrome / Brave / Edge iframes). */
export async function downloadForPreview(
  config: ConnectionConfig,
  path: string,
): Promise<SavedLocalFile> {
  const file = await downloadFile(config, path);
  const binary = atob(file.base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  const blob = new Blob([bytes], { type: file.mime });
  const objectUrl = URL.createObjectURL(blob);
  return {
    remotePath: path,
    localPath: objectUrl,
    filename: file.filename,
    byteLength: file.byteLength,
  };
}
