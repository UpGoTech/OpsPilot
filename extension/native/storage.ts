/**
 * Thin wrappers around chrome.storage for Chromium (Chrome / Brave / Edge).
 * `storage.session` is preferred for ERPNext sid; falls back to process memory
 * when a Chromium build lacks session storage.
 */

const memorySession = new Map<string, unknown>();

function hasSessionStorage(): boolean {
  return typeof chrome !== "undefined" && Boolean(chrome.storage?.session);
}

export async function localGet<T extends Record<string, unknown>>(
  keys: string | string[] | null,
): Promise<T> {
  return chrome.storage.local.get(keys) as Promise<T>;
}

export async function localSet(items: Record<string, unknown>): Promise<void> {
  await chrome.storage.local.set(items);
}

export async function localRemove(keys: string | string[]): Promise<void> {
  await chrome.storage.local.remove(keys);
}

export async function sessionGet<T extends Record<string, unknown>>(
  keys: string | string[],
): Promise<T> {
  if (!hasSessionStorage()) {
    const list = Array.isArray(keys) ? keys : [keys];
    const out: Record<string, unknown> = {};
    for (const key of list) {
      if (memorySession.has(key)) out[key] = memorySession.get(key);
    }
    return out as T;
  }
  return chrome.storage.session.get(keys) as Promise<T>;
}

export async function sessionSet(items: Record<string, unknown>): Promise<void> {
  if (!hasSessionStorage()) {
    for (const [key, value] of Object.entries(items)) {
      memorySession.set(key, value);
    }
    return;
  }
  await chrome.storage.session.set(items);
}

export async function sessionRemove(keys: string | string[]): Promise<void> {
  if (!hasSessionStorage()) {
    const list = Array.isArray(keys) ? keys : [keys];
    for (const key of list) memorySession.delete(key);
    return;
  }
  await chrome.storage.session.remove(keys);
}
