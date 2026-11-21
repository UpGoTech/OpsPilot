/**
 * Client-side Hermes steering for OpsPilot.
 * Prefixed on the wire for the first turn of a session (not shown in the bubble).
 */
export const OPSPILOT_FILE_POLICY = [
  "[OpsPilot client policy — follow for this session]",
  "OpsPilot is a Chromium side panel. It previews and downloads workspace files via the Hermes /api/fs gateway.",
  "When the user asks to show, open, or share a PDF/HTML/file: write it under the workspace (e.g. /opt/data/…) and always include the absolute path in your reply — OpsPilot only shows Preview/Download when it sees that path.",
  "For HTML: also emit a ::preview directive on its own line using the real absolute path you wrote (never a placeholder name). If you refer to a file you already wrote, repeat that same absolute path every time — do not describe it without the path.",
  "For interactive HTML dashboards: prefer ONE self-contained .html file with data/CSS/JS inlined (or next to it as relative siblings like ./data.json — same folder). OpsPilot preview cannot call ERPNext APIs from that tab.",
  "Do NOT run cloudflared, ngrok, local HTTP servers, or any public tunnel / temporary public host to share files.",
  "Do NOT open trycloudflare.com or similar public URLs for file access — OpsPilot shows Preview/Download cards for workspace paths.",
].join(" ");

const seeded = new Set<string>();

export function markPolicySeeded(sessionId: string) {
  if (sessionId) seeded.add(sessionId);
}

export function needsPolicySeed(sessionId: string): boolean {
  return Boolean(sessionId) && !seeded.has(sessionId);
}

/** Prepend policy for the gateway wire only; caller keeps the user bubble clean. */
export function withPolicyPreamble(
  sessionId: string,
  userText: string,
): string {
  if (!needsPolicySeed(sessionId)) return userText;
  seeded.add(sessionId);
  return `${OPSPILOT_FILE_POLICY}\n\n${userText}`;
}

export function resetPolicySeeds() {
  seeded.clear();
}

export const TUNNEL_HOST_RE =
  /(?:^|https?:\/\/)(?:[a-z0-9-]+\.)?(?:trycloudflare\.com|ngrok(?:-free)?\.(?:app|io)|loca\.lt|serveo\.net)\b/i;

export function stripTunnelUrls(source: string): {
  text: string;
  hadTunnel: boolean;
} {
  if (!source) return { text: source, hadTunnel: false };
  let hadTunnel = false;
  let text = source.replace(
    /https?:\/\/[^\s)\]>"']*(?:trycloudflare\.com|ngrok(?:-free)?\.(?:app|io)|loca\.lt|serveo\.net)[^\s)\]>"']*/gi,
    () => {
      hadTunnel = true;
      return "";
    },
  );
  text = text.replace(
    /(?:^|\n)\s*(?:Live and openable|Public(?:\s+preview)?(?:\s+URL)?|Tunnel|Opened at)\s*[:：]?\s*/gi,
    (m) => {
      hadTunnel = true;
      return m.startsWith("\n") ? "\n" : "";
    },
  );
  return {
    text: text.replace(/\n{3,}/g, "\n\n").trim(),
    hadTunnel,
  };
}
