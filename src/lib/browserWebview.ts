import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";

export interface BrowserBounds {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface BrowserNavigated {
  label: string;
  url: string;
}

export interface BrowserDownloadStarted {
  label: string;
  url: string;
  path: string;
  fileName: string;
}

export interface BrowserDownloadFinished {
  label: string;
  url: string;
  path: string | null;
  fileName: string | null;
  success: boolean;
}

const created = new Set<string>();

export async function browserCreate(
  label: string,
  bounds: BrowserBounds,
  url?: string,
) {
  if (created.has(label)) return;
  await invoke("browser_create", {
    label,
    url: url ?? null,
    x: bounds.x,
    y: bounds.y,
    width: Math.max(1, bounds.width),
    height: Math.max(1, bounds.height),
  });
  created.add(label);
}

export async function browserSetBounds(label: string, bounds: BrowserBounds) {
  if (!created.has(label)) return;
  await invoke("browser_set_bounds", {
    label,
    x: bounds.x,
    y: bounds.y,
    width: Math.max(1, bounds.width),
    height: Math.max(1, bounds.height),
  });
}

export async function browserShow(label: string) {
  if (!created.has(label)) return;
  await invoke("browser_show", { label });
}

export async function browserHide(label: string) {
  if (!created.has(label)) return;
  await invoke("browser_hide", { label });
}

export async function browserHideAll() {
  await invoke("browser_hide_all");
}

export async function browserNavigate(label: string, url: string) {
  return invoke<string>("browser_navigate", { label, url });
}

export async function browserReload(label: string) {
  if (!created.has(label)) return;
  await invoke("browser_reload", { label });
}

export async function browserBack(label: string) {
  if (!created.has(label)) return;
  await invoke("browser_back", { label });
}

export async function browserForward(label: string) {
  if (!created.has(label)) return;
  await invoke("browser_forward", { label });
}

export async function browserClose(label: string) {
  created.delete(label);
  await invoke("browser_close", { label });
}

export function listenBrowserNavigated(
  handler: (payload: BrowserNavigated) => void,
): Promise<UnlistenFn> {
  return listen<BrowserNavigated>("browser-navigated", (event) => {
    handler(event.payload);
  });
}

export function listenBrowserDownloadStarted(
  handler: (payload: BrowserDownloadStarted) => void,
): Promise<UnlistenFn> {
  return listen<{
    label: string;
    url: string;
    path: string;
    file_name: string;
  }>("browser-download-started", (event) => {
    handler({
      label: event.payload.label,
      url: event.payload.url,
      path: event.payload.path,
      fileName: event.payload.file_name,
    });
  });
}

export function listenBrowserDownloadFinished(
  handler: (payload: BrowserDownloadFinished) => void,
): Promise<UnlistenFn> {
  return listen<{
    label: string;
    url: string;
    path: string | null;
    file_name: string | null;
    success: boolean;
  }>("browser-download-finished", (event) => {
    handler({
      label: event.payload.label,
      url: event.payload.url,
      path: event.payload.path,
      fileName: event.payload.file_name,
      success: event.payload.success,
    });
  });
}

/** Minimum overlay size — below this, hide the native webview instead of painting stale bounds. */
export const MIN_BROWSER_BOUNDS = { width: 48, height: 48 };

/**
 * Bounds for the native browser overlay.
 * `chromeEl` bottom is the authoritative top edge so the overlay never covers
 * back/forward/URL controls (getBoundingClientRect alone can race layout).
 */
export function boundsForBrowserOverlay(
  hostEl: HTMLElement,
  chromeEl: HTMLElement,
): BrowserBounds | null {
  const host = hostEl.getBoundingClientRect();
  const chrome = chromeEl.getBoundingClientRect();
  if (chrome.height < 1) return null;

  const x = Math.max(0, Math.round(host.left));
  // Always start at the URL chrome bottom — never the tab strip or a stale host top.
  const y = Math.max(0, Math.round(chrome.bottom));
  const width = Math.round(host.width);
  const height = Math.round(host.bottom - chrome.bottom);

  if (width < MIN_BROWSER_BOUNDS.width || height < MIN_BROWSER_BOUNDS.height) {
    return null;
  }
  return { x, y, width, height };
}

/** @deprecated prefer boundsForBrowserOverlay */
export async function boundsFromElement(
  el: HTMLElement,
  opts?: { minY?: number },
): Promise<BrowserBounds | null> {
  const rect = el.getBoundingClientRect();
  let x = Math.max(0, Math.round(rect.left));
  let y = Math.max(0, Math.round(rect.top));
  let width = Math.round(rect.width);
  let height = Math.round(rect.height);

  if (typeof opts?.minY === "number" && Number.isFinite(opts.minY)) {
    const floor = Math.max(0, Math.round(opts.minY));
    if (y < floor) {
      height -= floor - y;
      y = floor;
    }
  }

  if (width < MIN_BROWSER_BOUNDS.width || height < MIN_BROWSER_BOUNDS.height) {
    return null;
  }
  return { x, y, width, height };
}

export function isBrowserLabelCreated(label: string) {
  return created.has(label);
}
