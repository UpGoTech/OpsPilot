/**
 * Stable site identity for multi-site OpsPilot profiles.
 * Hostname only — ignore port so bench :8000 matches a configured bare host.
 */

export function siteKeyFromUrl(raw: string): string | null {
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

export function isRestrictedTabUrl(url: string): boolean {
  return (
    url.startsWith("chrome://") ||
    url.startsWith("chrome-extension://") ||
    url.startsWith("edge://") ||
    url.startsWith("brave://") ||
    url.startsWith("about:") ||
    url.startsWith("devtools://")
  );
}

/** Prefer live tab URL (port-accurate) when building a site base for API/cookies. */
export function siteUrlFromTabUrl(tabUrl: string): string | null {
  try {
    if (!tabUrl || isRestrictedTabUrl(tabUrl)) return null;
    const u = new URL(tabUrl);
    if (u.protocol !== "http:" && u.protocol !== "https:") return null;
    return `${u.protocol}//${u.host}`;
  } catch {
    return null;
  }
}
