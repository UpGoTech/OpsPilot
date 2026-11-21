import type { AuthMode, AuthProbe, ConnectionConfig } from "../../src/types";
import {
  absorbHermesCookiesFromBrowser,
  collectSetCookies,
  filteredExtraHeaders,
  hasSessionAccessCookie,
  httpBase,
  mergeSetCookies,
  usesCookies,
  wsUrlWithTicket,
  wsUrlWithToken,
} from "./connection";
import { ensureGatewayTab } from "./gatewayTab";

function applyAuthHeaders(
  headers: Record<string, string>,
  config: ConnectionConfig,
): Record<string, string> {
  const out: Record<string, string> = {
    Accept: "application/json",
    ...headers,
  };
  const cookie = (() => {
    const cookies = config.cookies ?? {};
    const keys = Object.keys(cookies);
    if (!keys.length) return null;
    return keys.map((k) => `${k}=${cookies[k]}`).join("; ");
  })();
  if (cookie) out.Cookie = cookie;
  if (config.token?.trim()) {
    out["X-Hermes-Session-Token"] = config.token.trim();
  }
  for (const [name, value] of filteredExtraHeaders(config)) {
    out[name] = value;
  }
  return out;
}

async function meOk(config: ConnectionConfig): Promise<boolean> {
  const cookie = Object.keys(config.cookies ?? {}).length > 0;
  if (!cookie && !config.token?.trim()) return false;
  const base = httpBase(config);
  await absorbHermesCookiesFromBrowser(config, base);
  const resp = await fetch(`${base}/api/auth/me`, {
    method: "GET",
    headers: applyAuthHeaders({}, config),
    // Match login / ws-ticket — Cookie header is forbidden; jar must attach.
    credentials: "include",
  });
  return resp.ok;
}

export async function probeAuth(config: ConnectionConfig): Promise<AuthProbe> {
  const base = httpBase(config);
  const statusResp = await fetch(`${base}/api/status`, {
    method: "GET",
    headers: { Accept: "application/json" },
    credentials: "omit",
  });
  const statusCode = statusResp.status;
  const statusText = await statusResp.text();
  if (statusCode < 200 || statusCode >= 300) {
    throw new Error(
      `Gateway status probe failed (HTTP ${statusCode}). Use the gateway base URL, not /login.`,
    );
  }
  let status: unknown;
  try {
    status = JSON.parse(statusText);
  } catch {
    throw new Error(
      `Gateway did not return JSON from /api/status. Use the base URL instead of /login. Normalized tried: ${base}`,
    );
  }

  const statusObj = status as Record<string, unknown>;
  const authRequired = Boolean(statusObj.auth_required);

  const providers: AuthProbe["providers"] = [];
  if (authRequired) {
    try {
      const providersResp = await fetch(`${base}/api/auth/providers`, {
        method: "GET",
        headers: { Accept: "application/json" },
        credentials: "omit",
      });
      if (providersResp.ok) {
        const body = (await providersResp.json()) as {
          providers?: Array<Record<string, unknown>>;
        };
        for (const item of body.providers ?? []) {
          providers.push({
            name: String(item.name ?? ""),
            displayName: String(item.display_name ?? "Sign in"),
            supportsPassword: Boolean(item.supports_password),
          });
        }
      }
    } catch {
      // providers optional
    }
  }

  const passwordGateway =
    authRequired &&
    providers.length > 0 &&
    providers.every((p) => p.supportsPassword);

  const authMode: AuthMode =
    passwordGateway || authRequired ? "password" : "token";

  const signedIn =
    authMode === "password"
      ? hasSessionAccessCookie(config) || (await meOk(config))
      : Boolean(config.token?.trim());

  return {
    authRequired,
    authMode,
    providers,
    signedIn,
    status,
    normalizedUrl: base,
  };
}

/**
 * Password login for the extension.
 * Browsers strip Set-Cookie from fetch responses, so we:
 * 1) POST with credentials:"include" (host_permissions → treated as same-site)
 * 2) Read hermes_session_* from chrome.cookies
 * 3) If still empty, run the same POST inside a gateway-origin tab
 */
export async function passwordLogin(
  config: ConnectionConfig,
): Promise<ConnectionConfig> {
  const username = config.username?.trim() ?? "";
  const password = config.password ?? "";
  if (!username || !password) {
    throw new Error("Username and password are required");
  }

  const next: ConnectionConfig = {
    ...config,
    cookies: { ...(config.cookies ?? {}) },
    extraHeaders: { ...(config.extraHeaders ?? {}) },
  };

  const base = httpBase(next);
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    Accept: "application/json",
  };
  for (const [name, value] of filteredExtraHeaders(next)) {
    headers[name] = value;
  }

  const body = JSON.stringify({
    provider: "basic",
    username,
    password,
    next: "/",
  });

  // Prefer extension fetch with credentials so the jar accepts Hermes cookies.
  const resp = await fetch(`${base}/auth/password-login`, {
    method: "POST",
    headers,
    body,
    credentials: "include",
    redirect: "manual",
  });

  const status = resp.status;
  mergeSetCookies(next, collectSetCookies(resp));
  await absorbHermesCookiesFromBrowser(next, base);
  const text = await resp.text();

  if (status < 200 || status >= 400) {
    let detail: unknown = text;
    try {
      const parsed = JSON.parse(text) as Record<string, unknown>;
      detail = parsed.detail ?? parsed.error ?? parsed.message ?? text;
    } catch {
      // keep text
    }
    throw new Error(`Sign-in failed (HTTP ${status}): ${detail}`);
  }

  next.authMode = "password";
  next.password = "";
  next.token = "";

  if (!hasSessionAccessCookie(next)) {
    // Same-origin login inside a gateway tab — Set-Cookie always lands in the jar.
    await passwordLoginViaGatewayTab(base, username, password, headers);
    await absorbHermesCookiesFromBrowser(next, base);
  }

  if (!hasSessionAccessCookie(next)) {
    const names = Object.keys(next.cookies ?? {});
    throw new Error(
      `Sign-in succeeded but no hermes_session_at cookie was returned (got cookies: [${names.join(", ")}]). On HTTPS Hermes uses __Host-hermes_session_at.`,
    );
  }

  return next;
}

async function passwordLoginViaGatewayTab(
  base: string,
  username: string,
  password: string,
  headers: Record<string, string>,
): Promise<void> {
  const tab = await ensureGatewayTab(base);
  try {
    const injection = await chrome.scripting.executeScript({
      target: { tabId: tab.tabId },
      world: "ISOLATED",
      args: [base, username, password, headers],
      func: async (
        gatewayBase: string,
        user: string,
        pass: string,
        hdrs: Record<string, string>,
      ) => {
        try {
          const response = await fetch(`${gatewayBase}/auth/password-login`, {
            method: "POST",
            headers: hdrs,
            body: JSON.stringify({
              provider: "basic",
              username: user,
              password: pass,
              next: "/",
            }),
            credentials: "include",
            redirect: "manual",
          });
          return { ok: response.ok || (response.status >= 200 && response.status < 400), status: response.status };
        } catch (error) {
          return {
            ok: false,
            status: 0,
            error: error instanceof Error ? error.message : String(error),
          };
        }
      },
    });
    const result = injection?.[0]?.result as
      | { ok?: boolean; status?: number; error?: string }
      | undefined;
    if (result?.error) {
      throw new Error(`Gateway tab sign-in failed: ${result.error}`);
    }
    if (result && result.ok === false && (result.status ?? 0) >= 400) {
      throw new Error(`Gateway tab sign-in failed (HTTP ${result.status})`);
    }
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

export async function mintWsTicket(config: ConnectionConfig): Promise<string> {
  const cookie = Object.keys(config.cookies ?? {}).length > 0;
  if (!cookie) {
    throw new Error("Not signed in — sign in with username and password first");
  }
  const base = httpBase(config);
  const resp = await fetch(`${base}/api/auth/ws-ticket`, {
    method: "POST",
    headers: applyAuthHeaders({}, config),
    // Prefer Cookie header we absorbed; also allow jar cookies.
    credentials: "include",
  });
  const status = resp.status;
  const text = await resp.text();
  if (status === 401 || status === 403) {
    throw new Error("Session expired — sign in again");
  }
  if (status < 200 || status >= 300) {
    throw new Error(`WS ticket mint failed (HTTP ${status}): ${text}`);
  }
  let body: Record<string, unknown>;
  try {
    body = JSON.parse(text) as Record<string, unknown>;
  } catch {
    throw new Error(`Invalid ws-ticket response: ${text}`);
  }
  const ticket = body.ticket;
  if (typeof ticket !== "string" || !ticket) {
    throw new Error("ws-ticket response missing ticket");
  }
  return ticket;
}

export async function resolveWsUrl(config: ConnectionConfig): Promise<string> {
  if (
    usesCookies(config) ||
    Boolean(config.cookies?.hermes_session_at)
  ) {
    const ticket = await mintWsTicket(config);
    return wsUrlWithTicket(config, ticket);
  }
  return wsUrlWithToken(config);
}
