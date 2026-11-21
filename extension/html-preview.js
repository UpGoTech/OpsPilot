/**
 * Bridge: read HTML from chrome.storage.session and post into the sandbox
 * iframe (where inline scripts are allowed under MV3).
 */
(function () {
  const params = new URLSearchParams(location.search);
  const id = params.get("id") || "";
  const key = `opspilot.htmlPreview.${id}`;
  const frame = document.getElementById("frame");
  let pushed = false;

  function showError(message) {
    document.body.innerHTML = "";
    const el = document.createElement("div");
    el.className = "err";
    el.textContent = message;
    document.body.appendChild(el);
  }

  async function pushHtml() {
    if (pushed || !frame?.contentWindow) return;
    if (!id) {
      showError("Missing preview id.");
      return;
    }
    let html;
    try {
      const got = await chrome.storage.session.get(key);
      html = got[key];
    } catch (err) {
      showError(
        err instanceof Error ? err.message : "Could not read preview payload.",
      );
      return;
    }
    if (typeof html !== "string" || !html) {
      showError("Preview expired or missing. Open it again from OpsPilot.");
      return;
    }
    pushed = true;
    frame.contentWindow.postMessage(
      { type: "opspilot-html-preview", html },
      "*",
    );
    try {
      await chrome.storage.session.remove(key);
    } catch {
      // ignore
    }
  }

  frame?.addEventListener("load", () => {
    void pushHtml();
  });
  window.addEventListener("message", (event) => {
    if (event.data?.type === "opspilot-html-preview-ready") {
      void pushHtml();
    }
  });
})();
