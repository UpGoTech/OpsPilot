function closePopup() {
  window.close();
}

function hostnameOf(url) {
  try {
    return new URL(url).hostname;
  } catch {
    return "";
  }
}

async function hydrate() {
  const reason = document.getElementById("reason");
  const hostEl = document.getElementById("host");
  const headline = document.getElementById("headline");

  let url = "";
  try {
    const tabs = await chrome.tabs.query({
      active: true,
      lastFocusedWindow: true,
    });
    url = tabs[0]?.url ?? "";
  } catch {
    // ignore
  }

  const host = hostnameOf(url);
  if (
    !url ||
    url.startsWith("chrome://") ||
    url.startsWith("chrome-extension://") ||
    url.startsWith("edge://") ||
    url.startsWith("brave://") ||
    url.startsWith("about:")
  ) {
    headline.textContent = "OpsPilot can’t run on this page";
    reason.textContent =
      "Browser system pages aren’t Desk sites. Open your OpsPilot ERPNext site in a normal tab, then click OpsPilot again.";
    if (hostEl) hostEl.hidden = true;
    return;
  }

  if (host && hostEl) {
    hostEl.hidden = false;
    hostEl.textContent = host;
  }

  headline.textContent = "OpsPilot isn’t available here";
  reason.textContent =
    "This site doesn’t look like a Frappe Desk with the OpsPilot app (opspilot_frappe) installed, so the side panel stays closed.";
}

document.getElementById("close")?.addEventListener("click", closePopup);
document.getElementById("dismiss")?.addEventListener("click", closePopup);

void hydrate();
