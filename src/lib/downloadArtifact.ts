import { convertFileSrc } from "@tauri-apps/api/core";
import { save } from "@tauri-apps/plugin-dialog";
import { revealItemInDir } from "@tauri-apps/plugin-opener";
import {
  fsDownload,
  fsDownloadForPreview,
  fsDownloadToDownloads,
  fsDownloadToPath,
  type DownloadedFile,
} from "./tauri";
import type { ConnectionConfig } from "../types";

function base64ToUint8Array(b64: string): Uint8Array {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

/** Fetch a remote workspace file and write it into this Mac's Downloads folder. */
export async function downloadGatewayArtifact(
  config: ConnectionConfig,
  path: string,
): Promise<{ filename: string; byteLength: number; localPath: string }> {
  const saved = await fsDownloadToDownloads(config, path);
  try {
    await revealItemInDir(saved.localPath);
  } catch {
    // Reveal is best-effort; the file is already on disk.
  }
  return {
    filename: saved.filename,
    byteLength: saved.byteLength,
    localPath: saved.localPath,
  };
}

/**
 * Save As: system dialog, then write gateway bytes to the chosen path.
 * Returns null if the user cancels.
 */
export async function saveGatewayArtifactAs(
  config: ConnectionConfig,
  path: string,
): Promise<{ filename: string; byteLength: number; localPath: string } | null> {
  const filename =
    path.split(/[/\\]/).pop()?.replace(/[^\w.\-]+/g, "_") || "download";
  const lower = filename.toLowerCase();
  const ext = lower.includes(".") ? lower.slice(lower.lastIndexOf(".") + 1) : "";
  const named: Record<string, string> = {
    pdf: "PDF",
    zip: "ZIP archive",
    rar: "RAR archive",
    "7z": "7z archive",
    xls: "Excel",
    xlsx: "Excel",
    xlsm: "Excel",
    csv: "CSV",
    doc: "Word",
    docx: "Word",
  };
  const filters = ext
    ? [
        { name: named[ext] || ext.toUpperCase(), extensions: [ext] },
        { name: "All files", extensions: ["*"] },
      ]
    : [{ name: "All files", extensions: ["*"] }];

  const dest = await save({
    defaultPath: filename,
    filters,
  });
  if (!dest) return null;

  const saved = await fsDownloadToPath(config, path, dest);
  return {
    filename: saved.filename,
    byteLength: saved.byteLength,
    localPath: saved.localPath,
  };
}

/** Fetch bytes for in-app preview (blob URL) — fine for HTML, not PDFs in WKWebView. */
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
 * Download to a temp file and return an asset:// URL WKWebView can render
 * (needed for PDF preview).
 */
export async function fetchGatewayArtifactPreviewUrl(
  config: ConnectionConfig,
  path: string,
): Promise<{ url: string; filename: string; localPath: string }> {
  const saved = await fsDownloadForPreview(config, path);
  return {
    url: convertFileSrc(saved.localPath),
    filename: saved.filename,
    localPath: saved.localPath,
  };
}
