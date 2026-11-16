import type { AuthMode, ConnectionConfig } from "../../src/types";

const CONNECTION_KEY = "opspilot.connection";

const MANAGED_HEADERS = new Set([
  "authorization",
  "cookie",
  "host",
  "origin",
  "referer",
  "connection",
  "upgrade",
  "sec-websocket-key",
  "sec-websocket-version",
  "sec-websocket-extensions",
  "sec-websocket-protocol",
  "x-hermes-session-token",
]);

export function emptyConnection(): ConnectionConfig {
  return {
    name: "",
    url: "",
    token: "",
    authMode: "password",
    username: "",
    password: "",
    cookies: {},
    extraHeaders: {},
  };
}

export function usesCookies(config: ConnectionConfig): boolean {
  const mode = (config.authMode ?? "auto") as AuthMode;
  const cookies = config.cookies ?? {};
  return (
    mode === "password" ||
    (Object.keys(cookies).length > 0 && !config.token?.trim())
  );
}

export function cookieHeader(config: ConnectionConfig): string | null {
  const cookies = config.cookies ?? {};
  const keys = Object.keys(cookies);
  if (!keys.length) return null;
  return keys.map((k) => `${k}=${cookies[k]}`).join("; ");
}

export function isSessionAccessCookie(name: string): boolean {
  const bare = name.replace(/^__(?:Host|Secure)-/, "");
  return bare === "hermes_session_at" || bare.startsWith("hermes_session_at_");
}

export function hasSessionAccessCookie(config: ConnectionConfig): boolean {
  return Object.keys(config.cookies ?? {}).some(isSessionAccessCookie);
}

export function filteredExtraHeaders(
  config: ConnectionConfig,
): Array<[string, string]> {
  const headers = config.extraHeaders ?? {};
  return Object.entries(headers).filter(
    ([name, value]) =>
      Boolean(value?.trim()) && !MANAGED_HEADERS.has(name.trim().toLowerCase()),
  );
}

export function urlencodingEncode(value: string): string {
  return encodeURIComponent(value).replace(/%20/g, "+");
}

/** Match Rust `urlencoding_encode` (percent, not +). */
export function percentEncode(value: string): string {
  let out = "";
  for (const b of new TextEncoder().encode(value)) {
    if (
      (b >= 0x41 && b <= 0x5a) ||
      (b >= 0x61 && b <= 0x7a) ||
      (b >= 0x30 && b <= 0x39) ||
      b === 0x2d ||
      b === 0x5f ||
      b === 0x2e ||
      b === 0x7e
    ) {
      out += String.fromCharCode(b);
    } else {
      out += `%${b.toString(16).toUpperCase().padStart(2, "0")}`;
    }
  }
  return out;
}

export function normalizeGatewayUrl(raw: string): string {
  const trimmed = raw.trim();
  if (!trimmed) throw new Error("Gateway URL is required");

  let parsed: URL;
  try {
    parsed = new URL(trimmed);
  } catch {
    throw new Error(`Invalid gateway URL: ${trimmed}`);
  }

  let scheme = parsed.protocol.replace(":", "");
  if (scheme === "ws") scheme = "http";
  if (scheme === "wss") scheme = "https";
  if (scheme !== "http" && scheme !== "https") {
    throw new Error(`Unsupported URL scheme: ${scheme}`);
  }

  const AUTH_SEGMENTS = new Set([
    "login",
    "logout",
    "auth",
    "callback",
    "signin",
    "sign-in",
  ]);
  const segments = parsed.pathname
    .split("/")
    .filter(Boolean)
    .filter((s) => !AUTH_SEGMENTS.has(s.toLowerCase()));
  // Drop trailing auth segments iteratively (already filtered once above).
  while (
    segments.length &&
    AUTH_SEGMENTS.has(segments[segments.length - 1]!.toLowerCase())
  ) {
    segments.pop();
  }

  const path = segments.length ? `/${segments.join("/")}` : "";
  return `${scheme}://${parsed.host}${path}`;
}

export function httpBase(config: ConnectionConfig): string {
  return normalizeGatewayUrl(config.url);
}

function wsBaseParts(config: ConnectionConfig): {
  wsScheme: string;
  host: string;
  port: string;
  prefix: string;
} {
  const base = httpBase(config);
  const parsed = new URL(base);
  const wsScheme = parsed.protocol === "https:" ? "wss" : "ws";
  let prefix = parsed.pathname.replace(/\/$/, "");
  if (prefix === "/") prefix = "";
  return {
    wsScheme,
    host: parsed.hostname,
    port: parsed.port ? `:${parsed.port}` : "",
    prefix,
  };
}

export function wsUrlWithToken(config: ConnectionConfig): string {
  if (!config.token?.trim()) throw new Error("Session token is required");
  const { wsScheme, host, port, prefix } = wsBaseParts(config);
  return `${wsScheme}://${host}${port}${prefix}/api/ws?token=${percentEncode(config.token.trim())}`;
}

export function wsUrlWithTicket(config: ConnectionConfig, ticket: string): string {
  const { wsScheme, host, port, prefix } = wsBaseParts(config);
  return `${wsScheme}://${host}${port}${prefix}/api/ws?ticket=${percentEncode(ticket)}`;
}

export function parseSetCookie(header: string): [string, string] | null {
  const first = header.split(";")[0]?.trim();
  if (!first) return null;
  const eq = first.indexOf("=");
  if (eq <= 0) return null;
  const name = first.slice(0, eq).trim();
  const value = first.slice(eq + 1).trim();
  if (!name) return null;
  return [name, value];
}

export function mergeSetCookies(
  config: ConnectionConfig,
  setCookieHeaders: string[],
): void {
  if (!config.cookies) config.cookies = {};
  for (const header of setCookieHeaders) {
    const parsed = parseSetCookie(header);
    if (parsed) config.cookies[parsed[0]] = parsed[1];
  }
}

/** Collect Set-Cookie from a fetch Response (Chrome exposes getSetCookie when available). */
export function collectSetCookies(response: Response): string[] {
  const headers = response.headers as Headers & {
    getSetCookie?: () => string[];
  };
  if (typeof headers.getSetCookie === "function") {
    return headers.getSetCookie();
  }
  const single = response.headers.get("set-cookie");
  return single ? [single] : [];
}

export async function loadConnection(): Promise<ConnectionConfig> {
  const stored = await chrome.storage.local.get(CONNECTION_KEY);
  const raw = stored[CONNECTION_KEY] as ConnectionConfig | undefined;
  if (!raw) return emptyConnection();
  return {
    ...emptyConnection(),
    ...raw,
    password: "",
  };
}

export async function saveConnection(
  config: ConnectionConfig,
): Promise<ConnectionConfig> {
  const cleaned: ConnectionConfig = {
    ...emptyConnection(),
    ...config,
    password: "",
  };
  await chrome.storage.local.set({ [CONNECTION_KEY]: cleaned });
  return cleaned;
}
