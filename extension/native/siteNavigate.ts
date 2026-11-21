import { findSiteTabId } from "./tabRpc";
import { hostnameOf, originOf } from "./browserSession";

async function siteOrigin(siteUrl: string): Promise<string | null> {
  const tab = await findSiteTabId(siteUrl);
  if (tab?.tabUrl) {
    const fromTab = originOf(tab.tabUrl);
    if (fromTab) return fromTab;
  }
  return originOf(siteUrl);
}

/** Resolve a Hermes-guided href against the configured OpsPilot site. */
export async function resolveOpspilotHref(
  siteUrl: string,
  href: string,
): Promise<string | null> {
  const raw = (href || "").trim();
  if (!raw || raw.startsWith("#") || raw.startsWith("mailto:")) return null;

  const siteHost = hostnameOf(siteUrl);
  if (!siteHost) return null;
  const origin = await siteOrigin(siteUrl);
  if (!origin) return null;

  try {
    if (/^https?:\/\//i.test(raw)) {
      const u = new URL(raw);
      if (u.hostname.toLowerCase() !== siteHost) return null;
      return u.toString();
    }
    // Desk-relative paths Hermes often returns: /app/project, app/project
    if (
      raw.startsWith("/") ||
      raw.startsWith("app/") ||
      raw.startsWith("desk")
    ) {
      const path = raw.startsWith("/") ? raw : `/${raw}`;
      return new URL(path, origin).toString();
    }
  } catch {
    return null;
  }
  return null;
}

/**
 * Pull OpsPilot-site URLs from assistant markdown / prose.
 * Prefers explicit markdown links, then bare http(s), then /app/… paths.
 */
export async function extractOpspilotHrefs(
  siteUrl: string,
  text: string,
): Promise<string[]> {
  if (!text.trim()) return [];
  const found: string[] = [];
  const seen = new Set<string>();

  const push = async (href: string) => {
    const resolved = await resolveOpspilotHref(siteUrl, href);
    if (!resolved || seen.has(resolved)) return;
    seen.add(resolved);
    found.push(resolved);
  };

  for (const m of text.matchAll(/\[([^\]]*)\]\(([^)\s]+)\)/g)) {
    await push(m[2] ?? "");
  }
  for (const m of text.matchAll(/https?:\/\/[^\s<>"'`)\]]+/gi)) {
    await push((m[0] ?? "").replace(/[.,;:!?)]+$/, ""));
  }
  for (const m of text.matchAll(/(?:^|\s)(\/app\/[^\s<>"'`)\]]+)/g)) {
    await push(m[1] ?? "");
  }

  return found;
}

/** Navigate the existing Desk tab (or open one) to a Hermes-guided OpsPilot URL. */
export async function navigateOpspilotTab(
  siteUrl: string,
  targetUrl: string,
): Promise<boolean> {
  const resolved = await resolveOpspilotHref(siteUrl, targetUrl);
  if (!resolved) return false;

  const existing = await findSiteTabId(siteUrl);
  if (existing) {
    await chrome.tabs.update(existing.tabId, { url: resolved, active: true });
    try {
      const tab = await chrome.tabs.get(existing.tabId);
      if (tab.windowId != null) {
        await chrome.windows.update(tab.windowId, { focused: true });
      }
    } catch {
      // ignore focus failures
    }
    return true;
  }

  await chrome.tabs.create({ url: resolved, active: true });
  return true;
}
