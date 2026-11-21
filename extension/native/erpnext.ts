import type {
  ErpnextConfig,
  ErpnextSessionInfo,
  OpsPilotSettingsPayload,
} from "../../src/types";
import {
  getActiveTabUrl,
  hostnameOf,
  originOf,
  readBrowserSid,
} from "./browserSession";
import { setActiveConnectionSiteKey } from "./connection";
import { setActiveSiteKey } from "./gateway";
import { siteKeyFromUrl, siteUrlFromTabUrl } from "./siteKey";
import { localGet, localSet, sessionGet, sessionRemove, sessionSet } from "./storage";
import {
  findSiteTabId,
  tabFetchJson,
  tabGetLoggedUser,
  tabGetOpspilotSettings,
  tabPingOpspilot,
} from "./tabRpc";

const CONFIG_KEY = "opspilot.erpnext";
const SESSION_KEY = "opspilot.erpnext.session";
const SESSIONS_KEY = "opspilot.erpnext.sessions";

interface SessionRecord {
  sid: string;
  user: string;
  fullName: string;
  siteUrl: string;
}

/** Focused OpsPilot site — sessions and settings resolve against this. */
let activeErpnextSiteKey: string | null = null;

export function getActiveErpnextSiteKey(): string | null {
  return activeErpnextSiteKey;
}

export function setActiveErpnextSiteKey(siteKey: string | null): void {
  activeErpnextSiteKey = siteKey?.trim()
    ? siteKey.trim().toLowerCase()
    : null;
  setActiveSiteKey(activeErpnextSiteKey);
  setActiveConnectionSiteKey(activeErpnextSiteKey);
}

export async function activateSite(siteUrl: string): Promise<string> {
  const key = siteKeyFromUrl(siteUrl);
  if (!key) throw new Error("Invalid OpsPilot site URL");
  setActiveErpnextSiteKey(key);
  const config = await loadConfig();
  if (config.siteUrl.trim() !== normalizeSiteUrl(siteUrl)) {
    await saveConfig({
      siteUrl,
      lastUsername: config.lastUsername,
    });
  } else if (!config.siteUrl.trim()) {
    await saveConfig({ siteUrl, lastUsername: config.lastUsername });
  }
  return key;
}

function isLocalhostName(host: string): boolean {
  const h = host.replace(/\.$/, "").toLowerCase();
  return h === "localhost" || h.endsWith(".localhost");
}

export function normalizeSiteUrl(raw: string): string {
  const trimmed = raw.trim();
  if (!trimmed) throw new Error("OpsPilot site URL is required");

  let withScheme = trimmed;
  if (!trimmed.includes("://")) {
    const hostOnly = trimmed.split("/")[0] ?? trimmed;
    const host = hostOnly.split(":")[0] ?? hostOnly;
    withScheme = isLocalhostName(host) ? `http://${trimmed}` : `https://${trimmed}`;
  }

  let parsed: URL;
  try {
    parsed = new URL(withScheme);
  } catch {
    throw new Error(`Invalid OpsPilot site URL: ${trimmed}`);
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new Error(`Unsupported URL scheme: ${parsed.protocol}`);
  }
  parsed.hash = "";
  parsed.search = "";
  let path = parsed.pathname.replace(/\/$/, "");
  if (path === "/") path = "";
  return `${parsed.protocol}//${parsed.host}${path}`;
}

function siteApiUrl(siteUrl: string, path: string): { url: string; base: string } {
  const base = normalizeSiteUrl(siteUrl);
  const p = path.startsWith("/") ? path : `/${path}`;
  return { url: `${base}${p}`, base };
}

function looksLikeHtml(text: string): boolean {
  const t = text.trimStart().toLowerCase();
  return t.startsWith("<!doctype") || t.startsWith("<html") || t.includes("<center><h1>");
}

function frappeMessage(body: unknown): string | null {
  if (!body || typeof body !== "object") return null;
  const msg = (body as Record<string, unknown>).message;
  if (typeof msg === "string" && msg.trim()) return msg;
  if (msg && typeof msg === "object") {
    const exc = (msg as Record<string, unknown>).exc;
    if (typeof exc === "string" && exc.trim()) return exc;
  }
  return null;
}

function httpStatusMessage(
  status: number,
  text: string,
  body: unknown,
  action: string,
): string {
  const fromFrappe = frappeMessage(body);
  if (fromFrappe) return fromFrappe;
  if (status === 502 || status === 503 || status === 504) {
    return `${action} failed: the site is temporarily unavailable (HTTP ${status})`;
  }
  if ((status === 401 || status === 403) && action === "Login") {
    return "Invalid login credentials.";
  }
  if (looksLikeHtml(text) || !text.trim()) {
    return `${action} failed (HTTP ${status})`;
  }
  const snippet = text.slice(0, 160);
  return looksLikeHtml(snippet)
    ? `${action} failed (HTTP ${status})`
    : `${action} failed (HTTP ${status}): ${snippet}`;
}

function looksLikeAppMissing(status: number, text: string, body: unknown): boolean {
  if (status === 404) return true;
  const blob = `${text}${JSON.stringify(body ?? null)}`.toLowerCase();
  if (blob.includes("failed to get method") || blob.includes("attributeerror")) {
    return true;
  }
  if (
    blob.includes("opspilot_frappe") &&
    (blob.includes("not installed") ||
      blob.includes("not found") ||
      blob.includes("no module") ||
      blob.includes("does not exist") ||
      status === 417 ||
      status === 500)
  ) {
    return true;
  }
  return false;
}

function siteUnsupportedMessage(siteUrl: string): string {
  return `This site does not support OpsPilot (${siteUrl}). Install the OpsPilot app on this site.`;
}

function extractSid(setCookies: string[]): string | null {
  for (const header of setCookies) {
    const first = header.split(";")[0]?.trim() ?? "";
    const eq = first.indexOf("=");
    if (eq <= 0) continue;
    const name = first.slice(0, eq).trim();
    const value = first.slice(eq + 1).trim();
    if (name === "sid" && value && value !== "Guest") return value;
  }
  return null;
}

function collectSetCookies(response: Response): string[] {
  const headers = response.headers as Headers & { getSetCookie?: () => string[] };
  if (typeof headers.getSetCookie === "function") return headers.getSetCookie();
  const single = response.headers.get("set-cookie");
  return single ? [single] : [];
}

async function withDeadline<T>(promise: Promise<T>, secs: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<T>((_, reject) => {
        timer = setTimeout(
          () => reject(new Error("Could not reach OpsPilot site")),
          secs * 1000,
        );
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

async function readSessionMap(): Promise<Record<string, SessionRecord>> {
  const stored = await sessionGet<
    Record<string, Record<string, SessionRecord> | SessionRecord | undefined>
  >([SESSIONS_KEY, SESSION_KEY]);
  const map =
    (stored[SESSIONS_KEY] as Record<string, SessionRecord> | undefined) ?? {};
  const legacy = stored[SESSION_KEY] as SessionRecord | undefined;
  if (legacy?.sid && legacy.siteUrl) {
    const key = siteKeyFromUrl(legacy.siteUrl);
    if (key && !map[key]) {
      map[key] = legacy;
      await sessionSet({ [SESSIONS_KEY]: map });
    }
  }
  return map;
}

async function readSession(siteKey?: string | null): Promise<SessionRecord | null> {
  const key = (siteKey ?? activeErpnextSiteKey ?? "").trim().toLowerCase();
  if (!key) {
    // Fall back to legacy single session when no active site yet.
    const stored = await sessionGet<Record<string, SessionRecord | undefined>>(
      SESSION_KEY,
    );
    return stored[SESSION_KEY] ?? null;
  }
  const map = await readSessionMap();
  return map[key] ?? null;
}

async function writeSession(
  session: SessionRecord | null,
  siteKey?: string | null,
): Promise<void> {
  const key =
    (siteKey ??
      activeErpnextSiteKey ??
      (session?.siteUrl ? siteKeyFromUrl(session.siteUrl) : null) ??
      "").trim().toLowerCase();

  if (!session || !session.sid) {
    if (!key) {
      await sessionRemove(SESSION_KEY);
      return;
    }
    const map = await readSessionMap();
    delete map[key];
    await sessionSet({ [SESSIONS_KEY]: map });
    // Keep legacy mirror in sync for the active site.
    if (key === activeErpnextSiteKey) await sessionRemove(SESSION_KEY);
    return;
  }

  if (key) {
    const map = await readSessionMap();
    map[key] = session;
    await sessionSet({
      [SESSIONS_KEY]: map,
      [SESSION_KEY]: session,
    });
    return;
  }

  await sessionSet({ [SESSION_KEY]: session });
}

export async function loadConfig(): Promise<ErpnextConfig> {
  const stored = await localGet<Record<string, ErpnextConfig | undefined>>(CONFIG_KEY);
  const raw = stored[CONFIG_KEY];
  return {
    siteUrl: raw?.siteUrl ?? "",
    lastUsername: raw?.lastUsername ?? "",
  };
}

export async function saveConfig(config: ErpnextConfig): Promise<ErpnextConfig> {
  const previous = await loadConfig();
  const cleaned: ErpnextConfig = {
    siteUrl: config.siteUrl.trim()
      ? normalizeSiteUrl(config.siteUrl)
      : "",
    lastUsername: (config.lastUsername ?? "").trim(),
  };
  await localSet({ [CONFIG_KEY]: cleaned });
  if (previous.siteUrl.trim() !== cleaned.siteUrl.trim()) {
    await writeSession(null);
  }
  return cleaned;
}

export async function sessionInfo(): Promise<ErpnextSessionInfo> {
  const config = await loadConfig();
  const session = await readSession();
  const siteUrl = session?.siteUrl || config.siteUrl;
  if (!session?.sid) {
    return {
      loggedIn: false,
      user: "",
      fullName: "",
      siteUrl,
    };
  }
  return {
    loggedIn: true,
    user: session.user,
    fullName: session.fullName,
    siteUrl,
  };
}

export async function login(usr: string, pwd: string): Promise<ErpnextSessionInfo> {
  const config = await loadConfig();
  if (!config.siteUrl.trim()) {
    throw new Error("Save an OpsPilot site URL in Settings first.");
  }
  const user = usr.trim();
  if (!user) throw new Error("Username is required");
  if (!pwd) throw new Error("Password is required");

  const { url, base } = siteApiUrl(config.siteUrl, "/api/method/login");
  const body = new URLSearchParams({ usr: user, pwd });
  const response = await withDeadline(
    fetch(url, {
      method: "POST",
      headers: {
        Accept: "application/json",
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: body.toString(),
      credentials: "omit",
      redirect: "manual",
    }),
    8,
  );

  const status = response.status;
  const text = await response.text();
  let json: unknown = null;
  try {
    json = JSON.parse(text);
  } catch {
    json = null;
  }

  if (status < 200 || status >= 300) {
    await writeSession(null);
    throw new Error(httpStatusMessage(status, text, json, "Login"));
  }

  const sid = extractSid(collectSetCookies(response));
  if (!sid) {
    // Some Frappe stacks set sid only via cookie jar; try message.full_name path with Set-Cookie missing.
    throw new Error("Login succeeded but no session cookie was returned.");
  }

  const message =
    json && typeof json === "object"
      ? ((json as Record<string, unknown>).message as Record<string, unknown> | string | undefined)
      : undefined;
  const fullName =
    message && typeof message === "object" && typeof message.full_name === "string"
      ? message.full_name
      : user;

  await writeSession({
    sid,
    user,
    fullName,
    siteUrl: base,
  });

  return {
    loggedIn: true,
    user,
    fullName,
    siteUrl: base,
  };
}

export async function logout(): Promise<void> {
  // Extension session only — do not log the user out of Desk in the browser tab.
  await writeSession(null);
}

async function resolveSiteTab(
  preferredSiteUrl?: string,
): Promise<{ tabId: number; tabUrl: string; siteUrl: string }> {
  const config = await loadConfig();
  const focusedTabs = await chrome.tabs.query({
    active: true,
    lastFocusedWindow: true,
  });
  const focused = focusedTabs[0];
  const focusedUrl = focused?.url ?? (await getActiveTabUrl());
  const focusedSite = focusedUrl ? siteUrlFromTabUrl(focusedUrl) : null;

  let siteUrl: string | null = null;
  if (preferredSiteUrl?.trim()) {
    siteUrl = normalizeSiteUrl(preferredSiteUrl);
  } else if (focusedSite) {
    siteUrl = focusedSite;
  } else if (config.siteUrl.trim()) {
    siteUrl = normalizeSiteUrl(config.siteUrl);
  }

  if (!siteUrl) {
    throw new Error("Open an OpsPilot Desk tab first.");
  }

  await activateSite(siteUrl);

  let tab = await findSiteTabId(siteUrl);
  if (
    !tab &&
    focused?.id &&
    focusedUrl &&
    hostnameOf(focusedUrl) === hostnameOf(siteUrl)
  ) {
    tab = { tabId: focused.id, tabUrl: focusedUrl };
  }

  if (!tab?.tabId) {
    throw new Error("Open your OpsPilot Desk tab first.");
  }

  return { tabId: tab.tabId, tabUrl: tab.tabUrl, siteUrl };
}

/**
 * Adopt the Desk tab session. Identity is read via same-origin fetch inside
 * the tab (extension fetch cannot send the site Cookie header). `sid` is still
 * cached from chrome.cookies when available for later native calls.
 */
export async function adoptBrowserSession(
  preferredSiteUrl?: string,
): Promise<ErpnextSessionInfo> {
  const { tabId, tabUrl, siteUrl } = await resolveSiteTab(preferredSiteUrl);

  const user = await tabGetLoggedUser(tabId);
  if (!user) {
    throw new Error("Not signed in on your OpsPilot site. Sign in on the Desk tab first.");
  }

  let fullName = user;
  try {
    const profile = await tabFetchJson(
      tabId,
      `/api/resource/User/${encodeURIComponent(user)}?fields=${encodeURIComponent('["full_name"]')}`,
    );
    if (profile.ok && profile.body && typeof profile.body === "object") {
      const data = (profile.body as { data?: { full_name?: string } }).data;
      if (data?.full_name?.trim()) fullName = data.full_name.trim();
    }
  } catch {
    // keep username
  }

  const cookie = await readBrowserSid(siteUrl, tabUrl);
  const origin =
    cookie?.origin ?? originOf(tabUrl) ?? siteUrlFromTabUrl(tabUrl) ?? siteUrl;
  const sid = cookie?.sid ?? `tab:${user}`;
  const key = siteKeyFromUrl(origin) ?? siteKeyFromUrl(siteUrl);
  if (key) setActiveErpnextSiteKey(key);

  await writeSession(
    {
      sid,
      user,
      fullName,
      siteUrl: origin,
    },
    key,
  );

  // Remember last successful site for cold start hints.
  const config = await loadConfig();
  await saveConfig({
    siteUrl: origin,
    lastUsername: user || config.lastUsername,
  });

  return {
    loggedIn: true,
    user,
    fullName,
    siteUrl: origin,
  };
}

export async function probeSupport(): Promise<boolean> {
  const { tabId } = await resolveSiteTab();
  return tabPingOpspilot(tabId);
}

function parseSettingsMessage(message: unknown): OpsPilotSettingsPayload {
  if (!message || typeof message !== "object") {
    throw new Error("Could not parse OpsPilot Settings");
  }
  const obj = message as Record<string, unknown>;
  const gatewayUrl = String(obj.gateway_url ?? obj.gatewayUrl ?? "");
  const authMode = String(obj.auth_mode ?? obj.authMode ?? "password");
  const gatewayUsername = String(
    obj.gateway_username ?? obj.gatewayUsername ?? "",
  );
  const gatewayPassword = String(
    obj.gateway_password ?? obj.gatewayPassword ?? "",
  );
  const sessionToken = String(obj.session_token ?? obj.sessionToken ?? "");
  const extraRaw = (obj.extra_headers ?? obj.extraHeaders ?? {}) as Record<
    string,
    unknown
  >;
  const extraHeaders: Record<string, string> = {};
  if (extraRaw && typeof extraRaw === "object") {
    for (const [k, v] of Object.entries(extraRaw)) {
      extraHeaders[k] = typeof v === "string" ? v : String(v);
    }
  }
  return {
    gatewayUrl,
    authMode,
    gatewayUsername,
    gatewayPassword,
    sessionToken,
    extraHeaders,
  };
}

export async function fetchOpspilotSettings(): Promise<OpsPilotSettingsPayload | null> {
  const { tabId, siteUrl } = await resolveSiteTab();

  const appOk = await tabPingOpspilot(tabId);
  if (!appOk) {
    throw new Error(siteUnsupportedMessage(normalizeSiteUrl(siteUrl)));
  }

  const result = await tabGetOpspilotSettings(tabId);
  if (result === "unauthorized") {
    await writeSession(null);
    throw new Error("OpsPilot site session expired. Sign in on the Desk tab again.");
  }
  if (result === "missing") {
    return null;
  }
  return parseSettingsMessage(result.settings);
}
