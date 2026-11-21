/**
 * Robust Desk session helpers for Chromium (Chrome / Brave / Edge).
 * Bench sites often live on host:port (e.g. fxl.localhost:8000) while the
 * configured site URL omits the port — cookie lookups must use the tab URL.
 */

export function originOf(raw: string): string | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;
  try {
    const withScheme = trimmed.includes("://") ? trimmed : `https://${trimmed}`;
    const u = new URL(withScheme);
    return u.origin; // includes port when present
  } catch {
    return null;
  }
}

export function hostOf(raw: string): string | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;
  try {
    const withScheme = trimmed.includes("://") ? trimmed : `https://${trimmed}`;
    return new URL(withScheme).host.toLowerCase(); // hostname:port
  } catch {
    return null;
  }
}

export function hostnameOf(raw: string): string | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;
  try {
    const withScheme = trimmed.includes("://") ? trimmed : `https://${trimmed}`;
    return new URL(withScheme).hostname.toLowerCase();
  } catch {
    return null;
  }
}

function sidFromCookie(cookie: chrome.cookies.Cookie | null | undefined): string | null {
  const value = cookie?.value?.trim() ?? "";
  if (!value || value === "Guest") return null;
  return value;
}

/** Prefer the live tab origin (port-accurate), then configured site URL. */
export async function resolveSiteOrigin(
  siteUrl: string,
  tabUrl?: string | null,
): Promise<string | null> {
  if (tabUrl) {
    const tabOrigin = originOf(tabUrl);
    if (tabOrigin) return tabOrigin;
  }
  return originOf(siteUrl);
}

/**
 * Find a real Desk `sid` for this site.
 * Tries: tab URL → site URL → getAll by hostname / host.
 */
export async function readBrowserSid(
  siteUrl: string,
  tabUrl?: string | null,
): Promise<{ sid: string; origin: string } | null> {
  if (!chrome.cookies) return null;

  const origin = await resolveSiteOrigin(siteUrl, tabUrl);
  if (!origin) return null;

  const candidateUrls = Array.from(
    new Set(
      [tabUrl ? originOf(tabUrl) : null, originOf(siteUrl), origin].filter(
        (u): u is string => Boolean(u),
      ),
    ),
  );

  for (const url of candidateUrls) {
    try {
      const cookie = await chrome.cookies.get({ url, name: "sid" });
      const sid = sidFromCookie(cookie);
      if (sid) {
        return { sid, origin: originOf(url) ?? origin };
      }
    } catch {
      // try next
    }
  }

  // Domain-wide sweep — needed when path/port quirks hide the cookie from get().
  const names = Array.from(
    new Set(
      [hostnameOf(tabUrl ?? ""), hostnameOf(siteUrl), hostnameOf(origin)].filter(
        (h): h is string => Boolean(h),
      ),
    ),
  );

  for (const hostname of names) {
    try {
      const all = await chrome.cookies.getAll({ name: "sid" });
      const match = all.find((c) => {
        const domain = c.domain.replace(/^\./, "").toLowerCase();
        if (c.value === "Guest" || !c.value?.trim()) return false;
        return (
          domain === hostname ||
          hostname === domain ||
          hostname.endsWith(`.${domain}`) ||
          domain.endsWith(`.${hostname}`)
        );
      });
      const sid = sidFromCookie(match);
      if (sid && match) {
        // Rebuild an origin that matches the cookie's secure flag when possible.
        const scheme = match.secure ? "https" : "http";
        const host = match.domain.replace(/^\./, "");
        // Prefer tab origin if same hostname (keeps bench port).
        const tabOrigin = tabUrl ? originOf(tabUrl) : null;
        if (tabOrigin && hostnameOf(tabOrigin) === hostnameOf(`http://${host}`)) {
          return { sid, origin: tabOrigin };
        }
        return { sid, origin: `${scheme}://${host}` };
      }
    } catch {
      // try next hostname
    }
  }

  return null;
}

/** Active tab URL in the focused window (best cookie / port source). */
export async function getActiveTabUrl(): Promise<string | null> {
  try {
    const tabs = await chrome.tabs.query({
      active: true,
      lastFocusedWindow: true,
    });
    return tabs[0]?.url ?? null;
  } catch {
    return null;
  }
}
