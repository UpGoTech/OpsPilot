import {
  fsDownload,
  fsDownloadForPreview,
  fsDownloadToDownloads,
  fsDownloadToPath,
  type DownloadedFile,
} from "./native";
import type { ConnectionConfig } from "../types";

function base64ToUint8Array(b64: string): Uint8Array {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

/** Fetch a remote workspace file into the browser Downloads folder. */
export async function downloadGatewayArtifact(
  config: ConnectionConfig,
  path: string,
): Promise<{ filename: string; byteLength: number; localPath: string }> {
  const saved = await fsDownloadToDownloads(config, path);
  return {
    filename: saved.filename,
    byteLength: saved.byteLength,
    localPath: saved.localPath,
  };
}

/**
 * Save As via Chromium downloads API (`saveAs: true`).
 * Returns null only if the underlying download layer cancels (rare).
 */
export async function saveGatewayArtifactAs(
  config: ConnectionConfig,
  path: string,
): Promise<{ filename: string; byteLength: number; localPath: string } | null> {
  const filename =
    path.split(/[/\\]/).pop()?.replace(/[^\w.\-]+/g, "_") || "download";
  const saved = await fsDownloadToPath(config, path, filename);
  return {
    filename: saved.filename,
    byteLength: saved.byteLength,
    localPath: saved.localPath,
  };
}

/** Fetch bytes for in-app / new-tab preview. */
export async function fetchGatewayArtifactBlob(
  config: ConnectionConfig,
  path: string,
): Promise<{ blob: Blob; filename: string; mime: string }> {
  const file: DownloadedFile = await fsDownload(config, path);
  const bytes = base64ToUint8Array(file.base64);
  const mime = file.mime || "application/octet-stream";
  const ab = bytes.buffer.slice(
    bytes.byteOffset,
    bytes.byteOffset + bytes.byteLength,
  ) as ArrayBuffer;
  return {
    blob: new Blob([ab], { type: mime }),
    filename: file.filename,
    mime,
  };
}

/**
 * Download for preview — extension returns a blob: URL already.
 */
export async function fetchGatewayArtifactPreviewUrl(
  config: ConnectionConfig,
  path: string,
): Promise<{ url: string; filename: string; localPath: string }> {
  const saved = await fsDownloadForPreview(config, path);
  return {
    url: saved.localPath,
    filename: saved.filename,
    localPath: saved.localPath,
  };
}
