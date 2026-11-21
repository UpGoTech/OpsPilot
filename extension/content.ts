/**
 * Injected on OpsPilot site pages. Handles same-origin Frappe API calls so the
 * side panel can use the Desk session cookies (extension fetch cannot).
 */

type FetchMsg = {
  type: "opspilot.tabFetch";
  path: string;
};

type PingMsg = { type: "opspilot.ping" };

declare global {
  interface Window {
    __opspilotContentAgent?: boolean;
  }
}

// Avoid duplicate listeners when scripting.executeScript re-injects this file.
if (window.__opspilotContentAgent) {
  // already installed
} else {
  window.__opspilotContentAgent = true;

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  const msg = message as FetchMsg | PingMsg | null;
  if (!msg || typeof msg !== "object") return;

  if (msg.type === "opspilot.ping") {
    sendResponse({ ok: true });
    return;
  }

  if (msg.type !== "opspilot.tabFetch" || typeof msg.path !== "string") return;

  void (async () => {
    try {
      const response = await fetch(msg.path, {
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
      sendResponse({
        ok: response.ok,
        status: response.status,
        body,
        text,
      });
    } catch (error) {
      sendResponse({
        ok: false,
        status: 0,
        body: null,
        text: error instanceof Error ? error.message : String(error),
      });
    }
  })();

  // Keep the message channel open for the async response.
  return true;
});

} // end agent install guard
