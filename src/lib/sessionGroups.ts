import type { SessionSummary } from "../types";

/** Sources Desktop keeps out of the human session picker. */
const HIDDEN = new Set([
  "oneshot",
  "kanban",
  "tool",
  "batch",
  "webhook",
  "homeassistant",
]);

/** Local / GUI chats — Desktop "Sessions" recents. */
const LOCAL = new Set([
  "cli",
  "tui",
  "gui",
  "desktop",
  "acp",
  "webui",
  "dashboard",
  "",
]);

const MESSAGING: Record<string, string> = {
  whatsapp: "WhatsApp",
  telegram: "Telegram",
  discord: "Discord",
  slack: "Slack",
  signal: "Signal",
  matrix: "Matrix",
  mattermost: "Mattermost",
  email: "Email",
  sms: "SMS",
  dingtalk: "DingTalk",
  feishu: "Feishu",
  wecom: "WeCom",
  weixin: "Weixin",
  bluebubbles: "iMessage",
  qqbot: "QQ",
  qq: "QQ",
};

export type SessionSectionId =
  | "pinned"
  | "sessions"
  | "api"
  | "cron"
  | `msg:${string}`;

export interface SessionSection {
  id: SessionSectionId;
  label: string;
  hint?: string;
  sessions: SessionSummary[];
}

export function normalizeSource(source: string | undefined | null): string {
  return (source || "").trim().toLowerCase();
}

export function isHiddenSource(source: string | undefined | null): boolean {
  return HIDDEN.has(normalizeSource(source));
}

export function isLocalSource(source: string | undefined | null): boolean {
  const s = normalizeSource(source);
  return LOCAL.has(s) || s === "gui" || s.startsWith("gui");
}

export function isMessagingSource(source: string | undefined | null): boolean {
  return normalizeSource(source) in MESSAGING;
}

export function messagingLabel(source: string | undefined | null): string {
  const s = normalizeSource(source);
  return MESSAGING[s] || s.toUpperCase() || "Messaging";
}

export function sessionRecency(session: SessionSummary): number {
  const raw =
    session.updated_at ??
    session.created_at ??
    session.started_at ??
    (session as Record<string, unknown>).last_active;
  if (typeof raw === "number" && Number.isFinite(raw)) {
    return raw > 1e12 ? raw : raw * 1000;
  }
  if (typeof raw === "string" && raw.trim()) {
    const asNum = Number(raw);
    if (Number.isFinite(asNum) && asNum > 0) {
      return asNum > 1e12 ? asNum : asNum * 1000;
    }
    const parsed = Date.parse(raw);
    if (!Number.isNaN(parsed)) return parsed;
  }
  return 0;
}

export function formatRelativeTime(session: SessionSummary): string {
  const ts = sessionRecency(session);
  if (!ts) return "";
  const delta = Date.now() - ts;
  if (delta < 0) {
    const ahead = -delta;
    if (ahead < 86_400_000) return "soon";
    return `in ${Math.round(ahead / 86_400_000)}d`;
  }
  const mins = Math.floor(delta / 60_000);
  if (mins < 1) return "now";
  if (mins < 60) return `${mins}m`;
  const hours = Math.floor(mins / 60);
  if (hours < 48) return `${hours}h`;
  const days = Math.floor(hours / 24);
  if (days < 14) return `${days}d`;
  return `${Math.floor(days / 7)}w`;
}

export function sessionMatchesQuery(
  session: SessionSummary,
  query: string,
): boolean {
  const q = query.trim().toLowerCase();
  if (!q) return true;
  const hay = [
    session.title,
    session.preview,
    session.id,
    session.source,
    session.liveId,
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
  return hay.includes(q);
}

function sortByRecency(rows: SessionSummary[]): SessionSummary[] {
  return [...rows].sort((a, b) => sessionRecency(b) - sessionRecency(a));
}

/**
 * Build Desktop-like sidebar sections: Pinned, Sessions, per-gateway, API, Cron.
 */
export function buildSessionSections(
  all: SessionSummary[],
  pinnedIds: Set<string>,
  query: string,
): SessionSection[] {
  const visible = all.filter(
    (s) => !isHiddenSource(s.source) && sessionMatchesQuery(s, query),
  );

  const pinned = sortByRecency(
    visible.filter(
      (s) => pinnedIds.has(s.id) || Boolean((s as { pinned?: boolean }).pinned),
    ),
  );

  const pinnedSet = new Set(pinned.map((s) => s.id));
  const rest = visible.filter((s) => !pinnedSet.has(s.id));

  const local: SessionSummary[] = [];
  const api: SessionSummary[] = [];
  const cron: SessionSummary[] = [];
  const byMessaging = new Map<string, SessionSummary[]>();

  for (const s of rest) {
    const src = normalizeSource(s.source);
    if (src === "cron") {
      cron.push(s);
    } else if (src === "api-server" || src === "api" || src === "api_server") {
      api.push(s);
    } else if (isMessagingSource(src)) {
      const list = byMessaging.get(src) ?? [];
      list.push(s);
      byMessaging.set(src, list);
    } else {
      local.push(s);
    }
  }

  const sections: SessionSection[] = [
    {
      id: "pinned",
      label: "Pinned",
      hint: pinned.length ? undefined : "Shift-click a chat to pin",
      sessions: pinned,
    },
    {
      id: "sessions",
      label: "Sessions",
      sessions: sortByRecency(local),
    },
  ];

  const messagingOrder = Object.keys(MESSAGING);
  for (const src of messagingOrder) {
    const rows = byMessaging.get(src);
    if (!rows?.length) continue;
    sections.push({
      id: `msg:${src}`,
      label: messagingLabel(src),
      sessions: sortByRecency(rows),
    });
  }
  // Any unexpected messaging source
  for (const [src, rows] of byMessaging) {
    if (messagingOrder.includes(src) || !rows.length) continue;
    sections.push({
      id: `msg:${src}`,
      label: messagingLabel(src),
      sessions: sortByRecency(rows),
    });
  }

  if (api.length) {
    sections.push({ id: "api", label: "API", sessions: sortByRecency(api) });
  }
  if (cron.length) {
    sections.push({
      id: "cron",
      label: "Cron jobs",
      sessions: sortByRecency(cron),
    });
  }

  // While searching, drop empty sections except show a flat feel — keep
  // sections that have hits; pinned hint only when empty and no query.
  return sections.filter((sec) => {
    if (sec.sessions.length) return true;
    if (sec.id === "pinned" && !query.trim()) return true;
    if (sec.id === "sessions" && !query.trim()) return true;
    return false;
  });
}
