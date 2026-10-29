/** Shared attach rules — mirrors Hermes Desktop remote (image.attach_bytes / file.attach). */

export const ATTACH_IMAGE_MAX_BYTES = 25 * 1024 * 1024;
/** Keep under typical gateway WS frame limits; Desktop allows larger but one-shot. */
export const ATTACH_FILE_MAX_BYTES = 80 * 1024 * 1024;

export type AttachmentKind = "image" | "file";

const IMAGE_EXT = new Set([
  "png",
  "jpg",
  "jpeg",
  "gif",
  "webp",
  "bmp",
]);

const FILE_EXT = new Set([
  "pdf",
  "xls",
  "xlsx",
  "xlsm",
  "csv",
  "doc",
  "docx",
  "txt",
  "md",
  "rtf",
  "html",
  "htm",
  "zip",
  "rar",
  "7z",
]);

const MIME_BY_EXT: Record<string, string> = {
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  gif: "image/gif",
  webp: "image/webp",
  bmp: "image/bmp",
  pdf: "application/pdf",
  xls: "application/vnd.ms-excel",
  xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  xlsm: "application/vnd.ms-excel.sheet.macroEnabled.12",
  csv: "text/csv",
  doc: "application/msword",
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  txt: "text/plain",
  md: "text/markdown",
  rtf: "application/rtf",
  html: "text/html",
  htm: "text/html",
  zip: "application/zip",
  rar: "application/vnd.rar",
  "7z": "application/x-7z-compressed",
};

export const ATTACH_ACCEPT =
  [
    "image/png",
    "image/jpeg",
    "image/gif",
    "image/webp",
    "image/bmp",
    ".png",
    ".jpg",
    ".jpeg",
    ".gif",
    ".webp",
    ".bmp",
    ".pdf",
    ".xls",
    ".xlsx",
    ".xlsm",
    ".csv",
    ".doc",
    ".docx",
    ".txt",
    ".md",
    ".rtf",
    ".html",
    ".htm",
    ".zip",
    ".rar",
    ".7z",
  ].join(",");

export function extensionOf(name: string): string {
  const base = name.split(/[/\\]/).pop() || name;
  const dot = base.lastIndexOf(".");
  return dot >= 0 ? base.slice(dot + 1).toLowerCase() : "";
}

export function classifyAttachment(file: {
  name: string;
  type?: string;
}): AttachmentKind | null {
  const ext = extensionOf(file.name);
  // Extension wins: never treat .xlsx/.pdf/etc as images even if MIME is weird.
  if (FILE_EXT.has(ext)) return "file";
  if (IMAGE_EXT.has(ext)) return "image";
  if (/^image\/(png|jpe?g|gif|webp|bmp)$/i.test(file.type || "")) return "image";
  return null;
}

export function mimeForAttachment(file: { name: string; type?: string }): string {
  if (file.type && file.type !== "application/octet-stream") return file.type;
  return MIME_BY_EXT[extensionOf(file.name)] || "application/octet-stream";
}

export function maxBytesForKind(kind: AttachmentKind): number {
  return kind === "image" ? ATTACH_IMAGE_MAX_BYTES : ATTACH_FILE_MAX_BYTES;
}

export function toDataUrl(mime: string, contentBase64: string): string {
  return `data:${mime};base64,${contentBase64}`;
}

export function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = String(reader.result || "");
      const comma = result.indexOf(",");
      resolve(comma >= 0 ? result.slice(comma + 1) : result);
    };
    reader.onerror = () => reject(reader.error ?? new Error("Read failed"));
    reader.readAsDataURL(file);
  });
}

export function attachRejectReason(file: File): string | null {
  const kind = classifyAttachment(file);
  if (!kind) {
    return "Supported: images, PDF, Excel, Word, HTML, ZIP, RAR.";
  }
  const max = maxBytesForKind(kind);
  if (file.size > max) {
    const mb = Math.floor(max / (1024 * 1024));
    return `${file.name} is too large (max ${mb} MB).`;
  }
  return null;
}
