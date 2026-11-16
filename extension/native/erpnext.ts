import type {
  ErpnextConfig,
  ErpnextSessionInfo,
  OpsPilotSettingsPayload,
} from "../../src/types";
import { localGet, localSet, sessionGet, sessionRemove, sessionSet } from "./storage";

const CONFIG_KEY = "opspilot.erpnext";
const SESSION_KEY = "opspilot.erpnext.session";

interface SessionRecord {
  sid: string;
  user: string;
  fullName: string;
  siteUrl: string;
}

function isLocalhostName(host: string): boolean {
  const h = host.replace(/\.$/, "").toLowerCase();
  return h === "localhost" || h.endsWith(".localhost");
}

export function normalizeSiteUrl(raw: string): string {
  const trimmed = raw.trim();
  if (!trimmed) throw new Error("ERPNext site URL is required");

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
    throw new Error(`Invalid ERPNext URL: ${trimmed}`);
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
          () => reject(new Error("Could not reach ERPNext")),
          secs * 1000,
        );
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

async function readSession(): Promise<SessionRecord | null> {
  const stored = await sessionGet<Record<string, SessionRecord | undefined>>(SESSION_KEY);
  return stored[SESSION_KEY] ?? null;
}

async function writeSession(session: SessionRecord | null): Promise<void> {
  if (!session || !session.sid) {
    await sessionRemove(SESSION_KEY);
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
  if (!session?.sid) {
    return {
      loggedIn: false,
      user: "",
      fullName: "",
      siteUrl: config.siteUrl,
    };
  }
  return {
    loggedIn: true,
    user: session.user,
    fullName: session.fullName,
    siteUrl: session.siteUrl || config.siteUrl,
  };
}

export async function login(usr: string, pwd: string): Promise<ErpnextSessionInfo> {
  const config = await loadConfig();
  if (!config.siteUrl.trim()) {
    throw new Error("Save an ERPNext site URL in Settings first.");
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
  const config = await loadConfig();
  const session = await readSession();
  if (session?.sid && config.siteUrl.trim()) {
    try {
      const { url } = siteApiUrl(config.siteUrl, "/api/method/logout");
      await fetch(url, {
        method: "GET",
        headers: {
          Accept: "application/json",
          Cookie: `sid=${session.sid}`,
        },
        credentials: "omit",
      });
    } catch {
      // best-effort
    }
  }
  await writeSession(null);
}

export async function probeSupport(): Promise<boolean> {
  const config = await loadConfig();
  if (!config.siteUrl.trim()) {
    throw new Error("ERPNext site URL is not configured.");
  }
  const { url, base } = siteApiUrl(
    config.siteUrl,
    "/api/method/opspilot_frappe.api.ping",
  );
  const response = await withDeadline(
    fetch(url, {
      method: "GET",
      headers: { Accept: "application/json" },
      credentials: "omit",
    }),
    5,
  );
  const status = response.status;
  const text = await response.text();
  let body: unknown = null;
  try {
    body = JSON.parse(text);
  } catch {
    body = null;
  }

  if (status >= 200 && status < 300) return true;
  if (
    looksLikeAppMissing(status, text, body) ||
    text.toLowerCase().includes("not installed")
  ) {
    return false;
  }
  if (status === 401 || status === 403) return true;
  throw new Error(httpStatusMessage(status, text, body, "OpsPilot check"));
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
  const config = await loadConfig();
  if (!config.siteUrl.trim()) {
    throw new Error("ERPNext site URL is not configured.");
  }

  const supported = await probeSupport();
  if (!supported) {
    throw new Error(siteUnsupportedMessage(normalizeSiteUrl(config.siteUrl)));
  }

  const session = await readSession();
  if (!session?.sid) {
    throw new Error("Not logged into ERPNext. Sign in again.");
  }

  const { url, base } = siteApiUrl(
    config.siteUrl,
    "/api/method/opspilot_frappe.api.get_my_opspilot_settings",
  );
  const response = await withDeadline(
    fetch(url, {
      method: "GET",
      headers: {
        Accept: "application/json",
        Cookie: `sid=${session.sid}`,
      },
      credentials: "omit",
    }),
    8,
  );

  const status = response.status;
  const text = await response.text();
  let body: unknown = null;
  try {
    body = JSON.parse(text);
  } catch {
    body = null;
  }

  if (status === 401 || status === 403) {
    await writeSession(null);
    throw new Error("ERPNext session expired. Sign in again.");
  }

  if (status < 200 || status >= 300) {
    if (looksLikeAppMissing(status, text, body)) {
      throw new Error(siteUnsupportedMessage(base));
    }
    throw new Error(httpStatusMessage(status, text, body, "Loading AI settings"));
  }

  const message =
    body && typeof body === "object"
      ? (body as Record<string, unknown>).message
      : null;
  if (message == null) return null;
  if (message === false || message === "") return null;
  return parseSettingsMessage(message);
}
