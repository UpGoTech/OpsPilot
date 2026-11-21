/** Open / reuse a Hermes gateway-origin tab for same-origin credentialed fetches. */

export async function ensureGatewayTab(
  base: string,
): Promise<{ tabId: number; created: boolean }> {
  let host = "";
  try {
    host = new URL(base).hostname.toLowerCase();
  } catch {
    throw new Error(`Invalid gateway URL: ${base}`);
  }

  const tabs = await chrome.tabs.query({});
  const existing = tabs.find((t) => {
    if (!t.id || !t.url) return false;
    try {
      return new URL(t.url).hostname.toLowerCase() === host;
    } catch {
      return false;
    }
  });
  if (existing?.id != null) {
    return { tabId: existing.id, created: false };
  }

  const created = await chrome.tabs.create({ url: base, active: false });
  if (created.id == null) {
    throw new Error("Could not open a tab on the Hermes gateway");
  }

  await waitForTabComplete(created.id);
  return { tabId: created.id, created: true };
}

export async function waitForTabComplete(tabId: number): Promise<void> {
  try {
    const tab = await chrome.tabs.get(tabId);
    if (tab.status === "complete") return;
  } catch {
    return;
  }
  await new Promise<void>((resolve) => {
    const timer = setTimeout(() => {
      chrome.tabs.onUpdated.removeListener(onUpdated);
      resolve();
    }, 8_000);
    function onUpdated(
      updatedId: number,
      changeInfo: chrome.tabs.TabChangeInfo,
    ) {
      if (updatedId === tabId && changeInfo.status === "complete") {
        clearTimeout(timer);
        chrome.tabs.onUpdated.removeListener(onUpdated);
        resolve();
      }
    }
    chrome.tabs.onUpdated.addListener(onUpdated);
  });
}

/**
 * Same-origin fetch inside a gateway tab — jar cookies apply where the side
 * panel cannot set the Cookie header.
 */
export async function fetchBytesViaGatewayTab(
  base: string,
  pathAndQuery: string,
): Promise<{ status: number; base64: string; contentType: string }> {
  const tab = await ensureGatewayTab(base);
  try {
    const [injection] = await chrome.scripting.executeScript({
      target: { tabId: tab.tabId },
      world: "ISOLATED",
      args: [pathAndQuery],
      func: async (path: string) => {
        const resp = await fetch(path, {
          method: "GET",
          credentials: "include",
          headers: { Accept: "*/*" },
        });
        const buf = await resp.arrayBuffer();
        const bytes = new Uint8Array(buf);
        let binary = "";
        const chunk = 0x8000;
        for (let i = 0; i < bytes.length; i += chunk) {
          binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
        }
        return {
          status: resp.status,
          base64: btoa(binary),
          contentType: resp.headers.get("content-type") || "",
        };
      },
    });
    const result = injection?.result as
      | { status: number; base64: string; contentType: string }
      | undefined;
    if (!result) {
      throw new Error("Gateway tab fetch returned no result");
    }
    return result;
  } finally {
    if (tab.created) {
      try {
        await chrome.tabs.remove(tab.tabId);
      } catch {
        // ignore
      }
    }
  }
}

/** JSON GET via gateway tab (credentials include). */
export async function fetchJsonViaGatewayTab(
  base: string,
  pathAndQuery: string,
): Promise<{ status: number; body: unknown }> {
  const tab = await ensureGatewayTab(base);
  try {
    const [injection] = await chrome.scripting.executeScript({
      target: { tabId: tab.tabId },
      world: "ISOLATED",
      args: [pathAndQuery],
      func: async (path: string) => {
        const resp = await fetch(path, {
          method: "GET",
          credentials: "include",
          headers: { Accept: "application/json" },
        });
        const text = await resp.text();
        let body: unknown = null;
        if (text.trim()) {
          try {
            body = JSON.parse(text);
          } catch {
            body = text;
          }
        }
        return { status: resp.status, body };
      },
    });
    const result = injection?.result as
      | { status: number; body: unknown }
      | undefined;
    if (!result) {
      throw new Error("Gateway tab JSON fetch returned no result");
    }
    return result;
  } finally {
    if (tab.created) {
      try {
        await chrome.tabs.remove(tab.tabId);
      } catch {
        // ignore
      }
    }
  }
}
