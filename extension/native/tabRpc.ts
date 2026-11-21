/**
 * Same-origin Frappe API via the Desk tab.
 * Prefer one-shot executeScript (reliable); fall back to content-script messaging.
 */

export type TabFetchResult = {
  ok: boolean;
  status: number;
  body: unknown;
  text: string;
};

function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = window.setTimeout(() => {
      reject(new Error(`${label} timed out`));
    }, ms);
    promise.then(
      (value) => {
        window.clearTimeout(timer);
        resolve(value);
      },
      (error) => {
        window.clearTimeout(timer);
        reject(error);
      },
    );
  });
}

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
  const matches = tabs.filter((t) => {
    if (!t.id || !t.url) return false;
    try {
      return new URL(t.url).hostname.toLowerCase() === siteHost;
    } catch {
      return false;
    }
  });
  const hit = matches.find((t) => t.active) ?? matches[0];
  if (!hit?.id || !hit.url) return null;
  return { tabId: hit.id, tabUrl: hit.url };
}

async function fetchViaExecuteScript(
  tabId: number,
  pathAndQuery: string,
): Promise<TabFetchResult> {
  const injection = await withTimeout(
    chrome.scripting.executeScript({
      target: { tabId },
      world: "ISOLATED",
      args: [pathAndQuery],
      func: async (path: string) => {
        try {
          const response = await fetch(path, {
            method: "GET",
            credentials: "include",
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
    }),
    8_000,
    "executeScript fetch",
  );

  const result = injection?.[0]?.result;
  if (!result) {
    return {
      ok: false,
      status: 0,
      body: null,
      text: "No response from Desk tab",
    };
  }
  return result as TabFetchResult;
}

async function ensureContentAgent(tabId: number): Promise<boolean> {
  try {
    const ping = await withTimeout(
      chrome.tabs.sendMessage(tabId, { type: "opspilot.ping" }),
      1_200,
      "content ping",
    );
    if (ping && typeof ping === "object" && (ping as { ok?: boolean }).ok) {
      return true;
    }
  } catch {
    // inject below
  }

  try {
    await chrome.scripting.executeScript({
      target: { tabId },
      files: ["content.js"],
    });
    const ping = await withTimeout(
      chrome.tabs.sendMessage(tabId, { type: "opspilot.ping" }),
      1_500,
      "content ping after inject",
    );
    return Boolean(
      ping && typeof ping === "object" && (ping as { ok?: boolean }).ok,
    );
  } catch {
    return false;
  }
}

async function fetchViaContentScript(
  tabId: number,
  pathAndQuery: string,
): Promise<TabFetchResult | null> {
  const ready = await ensureContentAgent(tabId);
  if (!ready) return null;
  try {
    const result = await withTimeout(
      chrome.tabs.sendMessage(tabId, {
        type: "opspilot.tabFetch",
        path: pathAndQuery,
      }),
      8_000,
      "tab fetch",
    );
    if (!result || typeof result !== "object") return null;
    return result as TabFetchResult;
  } catch {
    return null;
  }
}

export async function tabFetchJson(
  tabId: number,
  pathAndQuery: string,
): Promise<TabFetchResult> {
  // executeScript first — fewer moving parts than content-script messaging.
  try {
    const viaScript = await fetchViaExecuteScript(tabId, pathAndQuery);
    if (viaScript.status !== 0 || viaScript.text !== "No response from Desk tab") {
      return viaScript;
    }
  } catch {
    // fall through to content script
  }

  const viaContent = await fetchViaContentScript(tabId, pathAndQuery);
  if (viaContent) return viaContent;

  return {
    ok: false,
    status: 0,
    body: null,
    text: "Desk tab RPC failed (executeScript + content script)",
  };
}

function messageOf(body: unknown): unknown {
  if (!body || typeof body !== "object") return null;
  return (body as Record<string, unknown>).message;
}

export async function tabGetLoggedUser(tabId: number): Promise<string | null> {
  const { ok, status, body, text } = await tabFetchJson(
    tabId,
    "/api/method/frappe.auth.get_logged_user",
  );
  if (!ok || status < 200 || status >= 300) {
    if (status === 0 && text) {
      throw new Error(text);
    }
    return null;
  }
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
  if (status === 0 && text) {
    throw new Error(text);
  }
  return false;
}

export async function tabGetOpspilotSettings(
  tabId: number,
): Promise<"missing" | "unauthorized" | { settings: Record<string, unknown> }> {
  const { ok, status, body, text } = await tabFetchJson(
    tabId,
    "/api/method/opspilot_frappe.api.get_my_opspilot_settings",
  );
  if (status === 401 || status === 403) return "unauthorized";
  if (status === 0 && text) {
    throw new Error(text);
  }
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
