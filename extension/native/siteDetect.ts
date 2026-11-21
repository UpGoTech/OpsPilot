/**
 * Detect whether a tab's origin serves opspilot_frappe.
 * Used by the service worker to enable/disable the side panel per tab.
 *
 * Helpers are duplicated (not imported from siteKey) so the MV3 service
 * worker stays a single file with no shared Rollup chunks.
 */

function siteKeyFromUrl(raw: string): string | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;
  try {
    const withScheme = trimmed.includes("://") ? trimmed : `https://${trimmed}`;
    const host = new URL(withScheme).hostname.toLowerCase();
    return host || null;
  } catch {
    return null;
  }
}

function isRestrictedTabUrl(url: string): boolean {
  return (
    url.startsWith("chrome://") ||
    url.startsWith("chrome-extension://") ||
    url.startsWith("edge://") ||
    url.startsWith("brave://") ||
    url.startsWith("about:") ||
    url.startsWith("devtools://")
  );
}

export { siteKeyFromUrl, isRestrictedTabUrl };

export type SiteDetectResult = {
  siteKey: string;
  ok: boolean;
  checkedAt: number;
};

const CACHE_KEY = "opspilot.siteDetect";
const POSITIVE_TTL_MS = 30 * 60_000;
const NEGATIVE_TTL_MS = 2 * 60_000;

type CacheMap = Record<string, SiteDetectResult>;

async function readCache(): Promise<CacheMap> {
  try {
    const area = chrome.storage?.session ?? chrome.storage.local;
    const stored = await area.get(CACHE_KEY);
    const raw = stored[CACHE_KEY];
    if (raw && typeof raw === "object") return raw as CacheMap;
  } catch {
    // ignore
  }
  return {};
}

async function writeCache(map: CacheMap): Promise<void> {
  try {
    const area = chrome.storage?.session ?? chrome.storage.local;
    await area.set({ [CACHE_KEY]: map });
  } catch {
    // ignore
  }
}

export async function getCachedDetect(
  siteKey: string,
): Promise<SiteDetectResult | null> {
  const map = await readCache();
  const hit = map[siteKey];
  if (!hit) return null;
  const ttl = hit.ok ? POSITIVE_TTL_MS : NEGATIVE_TTL_MS;
  if (Date.now() - hit.checkedAt > ttl) return null;
  return hit;
}

export async function putCachedDetect(result: SiteDetectResult): Promise<void> {
  const map = await readCache();
  map[result.siteKey] = result;
  await writeCache(map);
}

export async function invalidateDetect(siteKey: string): Promise<void> {
  const map = await readCache();
  delete map[siteKey];
  await writeCache(map);
}

/**
 * Same-origin ping inside the tab.
 * Strict: only JSON that looks like Frappe + opspilot_frappe counts.
 * Random 401/403/HTML must NOT enable the panel (false positives).
 */
export async function pingOpspilotInTab(tabId: number): Promise<boolean> {
  try {
    const injection = await chrome.scripting.executeScript({
      target: { tabId },
      world: "ISOLATED",
      func: async () => {
        try {
          const response = await fetch("/api/method/opspilot_frappe.api.ping", {
            method: "GET",
            credentials: "include",
            headers: { Accept: "application/json" },
          });
          const text = await response.text();
          const trimmed = text.trimStart();
          if (
            trimmed.startsWith("<!DOCTYPE") ||
            trimmed.startsWith("<html") ||
            trimmed.startsWith("<!doctype")
          ) {
            return false;
          }
          let body: unknown = null;
          try {
            body = text ? JSON.parse(text) : null;
          } catch {
            return false;
          }
          if (!body || typeof body !== "object") return false;

          const message = (body as { message?: unknown }).message;
          // Canonical success: { message: { ok: true } }
          if (message && typeof message === "object") {
            return (message as { ok?: boolean }).ok === true;
          }
          // Some stacks return message: "ok" / true
          if (message === true || message === "ok") return true;

          // Auth wall on a real Frappe method still proves the app is installed.
          if (response.status === 401 || response.status === 403) {
            const exc =
              typeof (body as { exc?: unknown }).exc === "string"
                ? String((body as { exc: string }).exc)
                : "";
            const blob = `${JSON.stringify(body)}${exc}`.toLowerCase();
            return (
              blob.includes("frappe") ||
              blob.includes("opspilot") ||
              "exception" in (body as object)
            );
          }

          return false;
        } catch {
          return false;
        }
      },
    });
    return Boolean(injection?.[0]?.result);
  } catch {
    return false;
  }
}

export async function detectTabOpspilot(
  tabId: number,
  url: string,
  opts?: { force?: boolean },
): Promise<SiteDetectResult | null> {
  if (!url || isRestrictedTabUrl(url)) return null;
  const siteKey = siteKeyFromUrl(url);
  if (!siteKey) return null;

  if (!opts?.force) {
    const cached = await getCachedDetect(siteKey);
    if (cached) return cached;
  }

  const ok = await pingOpspilotInTab(tabId);
  const result: SiteDetectResult = {
    siteKey,
    ok,
    checkedAt: Date.now(),
  };
  await putCachedDetect(result);
  return result;
}
