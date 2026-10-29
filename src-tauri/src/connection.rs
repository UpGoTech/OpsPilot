use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::fs;
use std::path::PathBuf;
use thiserror::Error;
use url::Url;

#[derive(Debug, Clone, Default, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum AuthMode {
    #[default]
    Auto,
    Token,
    Password,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ConnectionConfig {
    /// Optional label for this single remote connection (Desktop "Name").
    #[serde(default)]
    pub name: String,
    pub url: String,
    /// Legacy static session token (Desktop token mode).
    #[serde(default)]
    pub token: String,
    /// Chosen auth mode: token = "Session token", password = "Sign in".
    #[serde(default)]
    pub auth_mode: AuthMode,
    /// Username for basic/password gateways (persisted for convenience).
    #[serde(default)]
    pub username: String,
    /// Password is only sent for login; never required once cookies exist.
    /// Not written to disk when empty; if present in a save payload we keep it
    /// only for that login call (frontend should clear after sign-in).
    #[serde(default, skip_serializing_if = "String::is_empty")]
    pub password: String,
    /// Session cookies after password/OAuth login (`hermes_session_at`, …).
    #[serde(default)]
    pub cookies: HashMap<String, String>,
    /// Extra headers for access proxies (Cloudflare Access, etc.).
    /// Hermes-managed names are ignored when applied.
    #[serde(default)]
    pub extra_headers: HashMap<String, String>,
}

#[derive(Debug, Error)]
pub enum ConnectionError {
    #[error("{0}")]
    Message(String),
    #[error(transparent)]
    Io(#[from] std::io::Error),
    #[error(transparent)]
    Json(#[from] serde_json::Error),
    #[error(transparent)]
    Url(#[from] url::ParseError),
}

impl ConnectionConfig {
    pub fn uses_cookies(&self) -> bool {
        matches!(self.auth_mode, AuthMode::Password)
            || (!self.cookies.is_empty() && self.token.trim().is_empty())
    }

    pub fn cookie_header(&self) -> Option<String> {
        if self.cookies.is_empty() {
            return None;
        }
        let header = self
            .cookies
            .iter()
            .map(|(k, v)| format!("{k}={v}"))
            .collect::<Vec<_>>()
            .join("; ");
        Some(header)
    }

    pub fn http_base(&self) -> Result<String, ConnectionError> {
        normalize_gateway_url(&self.url)
    }

    fn ws_base_parts(&self) -> Result<(String, String, String, String), ConnectionError> {
        let base = self.http_base()?;
        let parsed = Url::parse(&base)
            .map_err(|_| ConnectionError::Message(format!("Invalid gateway URL: {base}")))?;

        let ws_scheme = match parsed.scheme() {
            "https" => "wss",
            "http" => "ws",
            other => {
                return Err(ConnectionError::Message(format!(
                    "Unsupported URL scheme: {other}"
                )))
            }
        };

        let host = parsed
            .host_str()
            .ok_or_else(|| ConnectionError::Message("Gateway URL is missing a host".into()))?
            .to_string();

        let port = match parsed.port() {
            Some(p) => format!(":{p}"),
            None => String::new(),
        };

        let mut prefix = parsed.path().trim_end_matches('/').to_string();
        if prefix == "/" {
            prefix.clear();
        }

        Ok((ws_scheme.to_string(), host, port, prefix))
    }

    /// Token-mode WS URL (Desktop legacy).
    pub fn ws_url_with_token(&self) -> Result<String, ConnectionError> {
        if self.token.trim().is_empty() {
            return Err(ConnectionError::Message("Session token is required".into()));
        }
        let (ws_scheme, host, port, prefix) = self.ws_base_parts()?;
        Ok(format!(
            "{ws_scheme}://{host}{port}{prefix}/api/ws?token={}",
            urlencoding_encode(self.token.trim())
        ))
    }

    /// Cookie-mode WS URL with a freshly minted ticket.
    pub fn ws_url_with_ticket(&self, ticket: &str) -> Result<String, ConnectionError> {
        let (ws_scheme, host, port, prefix) = self.ws_base_parts()?;
        Ok(format!(
            "{ws_scheme}://{host}{port}{prefix}/api/ws?ticket={}",
            urlencoding_encode(ticket)
        ))
    }

    /// Merge Set-Cookie values into the jar (name=value only).
    pub fn merge_set_cookies(&mut self, set_cookie_headers: &[String]) {
        for header in set_cookie_headers {
            if let Some((name, value)) = parse_set_cookie(header) {
                self.cookies.insert(name, value);
            }
        }
    }

    pub fn insert_cookie(&mut self, name: impl Into<String>, value: impl Into<String>) {
        self.cookies.insert(name.into(), value.into());
    }

    /// Hermes may name the access cookie `hermes_session_at`, `__Host-hermes_session_at`,
    /// `__Secure-hermes_session_at`, or `hermes_session_at_<gateway>`.
    pub fn has_session_access_cookie(&self) -> bool {
        self.cookies.keys().any(|name| is_session_access_cookie(name))
    }

    /// Headers safe to attach to gateway HTTP/WS (drops Hermes-managed names).
    pub fn filtered_extra_headers(&self) -> Vec<(String, String)> {
        self.extra_headers
            .iter()
            .filter(|(name, value)| !value.trim().is_empty() && !is_managed_header(name))
            .map(|(name, value)| (name.clone(), value.clone()))
            .collect()
    }
}

const MANAGED_HEADERS: &[&str] = &[
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
];

pub fn is_managed_header(name: &str) -> bool {
    MANAGED_HEADERS.contains(&name.trim().to_ascii_lowercase().as_str())
}

pub fn is_session_access_cookie(name: &str) -> bool {
    let bare = name
        .strip_prefix("__Host-")
        .or_else(|| name.strip_prefix("__Secure-"))
        .unwrap_or(name);
    bare == "hermes_session_at" || bare.starts_with("hermes_session_at_")
}

fn parse_set_cookie(header: &str) -> Option<(String, String)> {
    let first = header.split(';').next()?.trim();
    let (name, value) = first.split_once('=')?;
    let name = name.trim();
    if name.is_empty() {
        return None;
    }
    Some((name.to_string(), value.trim().to_string()))
}

/// Normalize a pasted gateway URL to the Desktop-style base.
/// Strips `/login`, query strings, and fragments so
/// `https://host/login?next=%2F` becomes `https://host`.
pub fn normalize_gateway_url(raw: &str) -> Result<String, ConnectionError> {
    let trimmed = raw.trim();
    if trimmed.is_empty() {
        return Err(ConnectionError::Message("Gateway URL is required".into()));
    }

    let mut parsed = Url::parse(trimmed)
        .map_err(|_| ConnectionError::Message(format!("Invalid gateway URL: {trimmed}")))?;

    let scheme = match parsed.scheme() {
        "http" | "https" => parsed.scheme().to_string(),
        "ws" => "http".to_string(),
        "wss" => "https".to_string(),
        other => {
            return Err(ConnectionError::Message(format!(
                "Unsupported URL scheme: {other}"
            )))
        }
    };

    parsed.set_scheme(&scheme).map_err(|_| {
        ConnectionError::Message(format!("Could not normalize URL scheme for {trimmed}"))
    })?;
    parsed.set_query(None);
    parsed.set_fragment(None);

    let mut segments: Vec<String> = parsed
        .path_segments()
        .map(|s| s.filter(|p| !p.is_empty()).map(|p| p.to_string()).collect())
        .unwrap_or_default();

    // Drop SPA auth routes that users often paste from the browser bar.
    const AUTH_SEGMENTS: &[&str] = &["login", "logout", "auth", "callback", "signin", "sign-in"];
    while segments
        .last()
        .map(|s| AUTH_SEGMENTS.contains(&s.to_lowercase().as_str()))
        .unwrap_or(false)
    {
        segments.pop();
    }

    let host = parsed
        .host_str()
        .ok_or_else(|| ConnectionError::Message("Gateway URL is missing a host".into()))?;
    let port = match parsed.port() {
        Some(p) => format!(":{p}"),
        None => String::new(),
    };
    let path = if segments.is_empty() {
        String::new()
    } else {
        format!("/{}", segments.join("/"))
    };

    Ok(format!("{}://{}{}{}", scheme, host, port, path))
}

pub fn urlencoding_encode(value: &str) -> String {
    let mut out = String::with_capacity(value.len());
    for b in value.bytes() {
        match b {
            b'A'..=b'Z' | b'a'..=b'z' | b'0'..=b'9' | b'-' | b'_' | b'.' | b'~' => {
                out.push(b as char)
            }
            _ => out.push_str(&format!("%{b:02X}")),
        }
    }
    out
}

pub fn config_path(app: &tauri::AppHandle) -> Result<PathBuf, ConnectionError> {
    use tauri::Manager;
    let dir = app
        .path()
        .app_config_dir()
        .map_err(|e| ConnectionError::Message(format!("{e}")))?;
    fs::create_dir_all(&dir)?;
    Ok(dir.join("connection.json"))
}

pub fn load_connection(app: &tauri::AppHandle) -> Result<ConnectionConfig, ConnectionError> {
    let path = config_path(app)?;
    if !path.exists() {
        return Ok(ConnectionConfig::default());
    }
    let raw = fs::read_to_string(path)?;
    let mut config: ConnectionConfig = serde_json::from_str(&raw)?;
    // Never keep a password on disk across loads.
    config.password.clear();
    Ok(config)
}

pub fn save_connection(
    app: &tauri::AppHandle,
    config: &ConnectionConfig,
) -> Result<(), ConnectionError> {
    let path = config_path(app)?;
    // Strip password before persisting.
    let mut to_store = config.clone();
    to_store.password.clear();
    let raw = serde_json::to_string_pretty(&to_store)?;
    fs::write(path, raw)?;
    Ok(())
}
