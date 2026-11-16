/**
 * Run same-origin Frappe API calls inside the Desk tab.
 * Extension-page `fetch` cannot attach the site's `sid` Cookie header (forbidden),
 * so Guest is returned unless we execute in the page context.
 */

export async function findSiteTabId(
  siteUrl: string,
): Promise<{ tabId: number; tabUrl: string } | null> {
  let siteHost = "";
  try {
    const raw = siteUrl.includes("://") ? siteUrl : `http://${siteUrl}`;
    siteHost = new URL(raw).hostname.toLowerCase();
  } catch {
    return null;
  }

  const tabs = await chrome.tabs.query({});
  const hit = tabs.find((t) => {
    if (!t.id || !t.url) return false;
    try {
      return new URL(t.url).hostname.toLowerCase() === siteHost;
    } catch {
      return false;
    }
  });
  if (!hit?.id || !hit.url) return null;
  return { tabId: hit.id, tabUrl: hit.url };
}

export async function tabFetchJson(
  tabId: number,
  pathAndQuery: string,
): Promise<{ ok: boolean; status: number; body: unknown; text: string }> {
  const [{ result }] = await chrome.scripting.executeScript({
    target: { tabId },
    world: "MAIN",
    args: [pathAndQuery],
    func: async (path: string) => {
      try {
        const response = await fetch(path, {
          method: "GET",
          credentials: "same-origin",
          headers: { Accept: "application/json" },
        });
        const text = await response.text();
        let body: unknown = null;
        try {
          body = text ? JSON.parse(text) : null;
        } catch {
          body = text;
        }
        return {
          ok: response.ok,
          status: response.status,
          body,
          text,
        };
      } catch (error) {
        return {
          ok: false,
          status: 0,
          body: null,
          text: error instanceof Error ? error.message : String(error),
        };
      }
    },
  });

  if (!result) {
    return { ok: false, status: 0, body: null, text: "No response from Desk tab" };
  }
  return result as {
    ok: boolean;
    status: number;
    body: unknown;
    text: string;
  };
}

function messageOf(body: unknown): unknown {
  if (!body || typeof body !== "object") return null;
  return (body as Record<string, unknown>).message;
}

export async function tabGetLoggedUser(tabId: number): Promise<string | null> {
  const { ok, status, body } = await tabFetchJson(
    tabId,
    "/api/method/frappe.auth.get_logged_user",
  );
  if (!ok || status < 200 || status >= 300) return null;
  const message = messageOf(body);
  if (typeof message === "string" && message && message !== "Guest") {
    return message;
  }
  return null;
}

export async function tabPingOpspilot(tabId: number): Promise<boolean> {
  const { ok, status, body, text } = await tabFetchJson(
    tabId,
    "/api/method/opspilot_frappe.api.ping",
  );
  if (ok && status >= 200 && status < 300) {
    const message = messageOf(body);
    if (message && typeof message === "object") {
      return Boolean((message as Record<string, unknown>).ok);
    }
    return true;
  }
  const blob = `${text}${JSON.stringify(body ?? "")}`.toLowerCase();
  if (
    status === 404 ||
    blob.includes("not installed") ||
    blob.includes("failed to get method") ||
    blob.includes("opspilot_frappe")
  ) {
    return false;
  }
  if (status === 401 || status === 403) return true;
  return false;
}

export async function tabGetOpspilotSettings(
  tabId: number,
): Promise<"ok" | "missing" | "unauthorized" | { settings: Record<string, unknown> }> {
  const { ok, status, body } = await tabFetchJson(
    tabId,
    "/api/method/opspilot_frappe.api.get_my_opspilot_settings",
  );
  if (status === 401 || status === 403) return "unauthorized";
  if (!ok || status < 200 || status >= 300) return "missing";
  const message = messageOf(body);
  if (message == null || message === false || message === "") return "missing";
  if (typeof message === "object") {
    const gateway =
      (message as Record<string, unknown>).gateway_url ??
      (message as Record<string, unknown>).gatewayUrl;
    if (!String(gateway ?? "").trim()) return "missing";
    return { settings: message as Record<string, unknown> };
  }
  return "missing";
}
