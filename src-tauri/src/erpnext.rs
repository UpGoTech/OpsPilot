//! ERPNext site URL on disk + in-memory session (`sid` never persisted).

use parking_lot::Mutex;
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::collections::HashMap;
use std::error::Error as StdError;
use std::fs;
use std::net::SocketAddr;
use std::path::PathBuf;
use std::sync::Arc;
use thiserror::Error;
use url::Url;

#[derive(Debug, Error)]
pub enum ErpnextError {
    #[error("{0}")]
    Message(String),
    #[error(transparent)]
    Io(#[from] std::io::Error),
    #[error(transparent)]
    Json(#[from] serde_json::Error),
    #[error(transparent)]
    Http(#[from] reqwest::Error),
    #[error(transparent)]
    Url(#[from] url::ParseError),
}

/// Persisted locally — site URL + last username (never password / sid).
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ErpnextConfig {
    #[serde(default)]
    pub site_url: String,
    /// Last ERPNext username typed on the login screen (convenience only).
    #[serde(default)]
    pub last_username: String,
}

/// Process-lifetime session. Never written to disk.
#[derive(Debug, Clone, Default)]
pub struct ErpnextSession {
    pub sid: String,
    pub user: String,
    pub full_name: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ErpnextSessionInfo {
    pub logged_in: bool,
    pub user: String,
    pub full_name: String,
    pub site_url: String,
}

/// Payload from `opspilot_frappe.api.get_my_opspilot_settings`.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct OpsPilotSettingsPayload {
    pub gateway_url: String,
    #[serde(default)]
    pub auth_mode: String,
    #[serde(default)]
    pub gateway_username: String,
    #[serde(default)]
    pub gateway_password: String,
    #[serde(default)]
    pub session_token: String,
    #[serde(default)]
    pub extra_headers: HashMap<String, String>,
}

#[derive(Clone, Default)]
pub struct ErpnextState {
    inner: Arc<Mutex<ErpnextSession>>,
}

impl ErpnextState {
    pub fn get(&self) -> ErpnextSession {
        self.inner.lock().clone()
    }

    pub fn set(&self, session: ErpnextSession) {
        *self.inner.lock() = session;
    }

    pub fn clear(&self) {
        *self.inner.lock() = ErpnextSession::default();
    }

    pub fn sid(&self) -> Option<String> {
        let sid = self.inner.lock().sid.clone();
        if sid.is_empty() {
            None
        } else {
            Some(sid)
        }
    }
}

/// macOS getaddrinfo often fails for `sitename.localhost` (curl still works).
/// Map those names to 127.0.0.1 so the HTTP Host header stays the site name.
#[derive(Debug, Default, Clone)]
struct LocalFriendlyResolver;

impl reqwest::dns::Resolve for LocalFriendlyResolver {
    fn resolve(&self, name: reqwest::dns::Name) -> reqwest::dns::Resolving {
        Box::pin(async move {
            let host = name.as_str();
            if is_localhost_name(host) {
                let addrs: Vec<SocketAddr> = vec![
                    SocketAddr::from(([127, 0, 0, 1], 0)),
                    SocketAddr::from(([0, 0, 0, 0, 0, 0, 0, 1], 0)),
                ];
                return Ok(Box::new(addrs.into_iter()) as Box<dyn Iterator<Item = SocketAddr> + Send>);
            }
            // Cap DNS so bad hostnames cannot hang the UI for minutes.
            let lookup = tokio::time::timeout(
                std::time::Duration::from_secs(3),
                tokio::net::lookup_host((host, 0)),
            )
            .await
            .map_err(|_| {
                Box::new(std::io::Error::new(
                    std::io::ErrorKind::TimedOut,
                    "DNS lookup timed out",
                )) as Box<dyn StdError + Send + Sync>
            })?
            .map_err(|e| Box::new(e) as Box<dyn StdError + Send + Sync>)?;
            let addrs: Vec<SocketAddr> = lookup.collect();
            Ok(Box::new(addrs.into_iter()) as Box<dyn Iterator<Item = SocketAddr> + Send>)
        })
    }
}

fn client_with_timeout(secs: u64) -> Result<reqwest::Client, ErpnextError> {
    reqwest::Client::builder()
        .connect_timeout(std::time::Duration::from_secs(secs.min(5).max(2)))
        .timeout(std::time::Duration::from_secs(secs))
        .redirect(reqwest::redirect::Policy::none())
        .cookie_store(false)
        .dns_resolver(Arc::new(LocalFriendlyResolver))
        .build()
        .map_err(|e| ErpnextError::Message(e.to_string()))
}

fn client() -> Result<reqwest::Client, ErpnextError> {
    // Keep ERPNext calls snappy — never sit on DNS/connect for minutes.
    client_with_timeout(8)
}

fn probe_client() -> Result<reqwest::Client, ErpnextError> {
    client_with_timeout(4)
}

fn http_error(_err: reqwest::Error, _url: &str) -> ErpnextError {
    ErpnextError::Message("Could not reach ERPNext".into())
}

async fn with_request_deadline<T, E>(
    fut: impl std::future::Future<Output = Result<T, E>>,
    secs: u64,
) -> Result<T, ErpnextError>
where
    E: Into<ErpnextError>,
{
    match tokio::time::timeout(std::time::Duration::from_secs(secs), fut).await {
        Ok(Ok(v)) => Ok(v),
        Ok(Err(e)) => Err(e.into()),
        Err(_) => Err(ErpnextError::Message("Could not reach ERPNext".into())),
    }
}

fn is_localhost_name(host: &str) -> bool {
    let h = host.trim_end_matches('.').to_ascii_lowercase();
    h == "localhost" || h.ends_with(".localhost")
}

fn site_api_url(site_url: &str, path: &str) -> Result<(String, String), ErpnextError> {
    let site_url = normalize_site_url(site_url)?;
    let path = if path.starts_with('/') {
        path.to_string()
    } else {
        format!("/{path}")
    };
    Ok((format!("{site_url}{path}"), site_url))
}

pub fn normalize_site_url(raw: &str) -> Result<String, ErpnextError> {
    let trimmed = raw.trim();
    if trimmed.is_empty() {
        return Err(ErpnextError::Message("ERPNext site URL is required".into()));
    }
    let with_scheme = if trimmed.contains("://") {
        trimmed.to_string()
    } else {
        // Local bench sites are almost always HTTP; production defaults to HTTPS.
        let host_only = trimmed.split('/').next().unwrap_or(trimmed);
        let host = host_only.split(':').next().unwrap_or(host_only);
        if is_localhost_name(host) {
            format!("http://{trimmed}")
        } else {
            format!("https://{trimmed}")
        }
    };
    let mut parsed = Url::parse(&with_scheme)
        .map_err(|_| ErpnextError::Message(format!("Invalid ERPNext URL: {trimmed}")))?;
    match parsed.scheme() {
        "http" | "https" => {}
        other => {
            return Err(ErpnextError::Message(format!(
                "Unsupported URL scheme: {other}"
            )))
        }
    }
    parsed.set_path("");
    parsed.set_query(None);
    parsed.set_fragment(None);
    let mut out = parsed.to_string();
    if out.ends_with('/') {
        out.pop();
    }
    Ok(out)
}

pub fn config_path(app: &tauri::AppHandle) -> Result<PathBuf, ErpnextError> {
    use tauri::Manager;
    let dir = app
        .path()
        .app_config_dir()
        .map_err(|e| ErpnextError::Message(format!("{e}")))?;
    fs::create_dir_all(&dir)?;
    Ok(dir.join("erpnext.json"))
}

pub fn load_config(app: &tauri::AppHandle) -> Result<ErpnextConfig, ErpnextError> {
    let path = config_path(app)?;
    if !path.exists() {
        return Ok(ErpnextConfig::default());
    }
    let raw = fs::read_to_string(path)?;
    let mut config: ErpnextConfig = serde_json::from_str(&raw)?;
    if !config.site_url.is_empty() {
        config.site_url = normalize_site_url(&config.site_url).unwrap_or(config.site_url);
    }
    Ok(config)
}

pub fn save_config(app: &tauri::AppHandle, config: &ErpnextConfig) -> Result<(), ErpnextError> {
    let path = config_path(app)?;
    let mut to_store = config.clone();
    if !to_store.site_url.trim().is_empty() {
        to_store.site_url = normalize_site_url(&to_store.site_url)?;
    }
    let raw = serde_json::to_string_pretty(&to_store)?;
    fs::write(path, raw)?;
    Ok(())
}

fn urlencoding_encode(value: &str) -> String {
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

fn extract_sid_from_set_cookie(headers: &reqwest::header::HeaderMap) -> Option<String> {
    for value in headers.get_all(reqwest::header::SET_COOKIE) {
        let Ok(s) = value.to_str() else { continue };
        for part in s.split(';') {
            let part = part.trim();
            if let Some(rest) = part.strip_prefix("sid=") {
                if !rest.is_empty() && rest != "Guest" {
                    return Some(rest.to_string());
                }
            }
        }
    }
    None
}

fn looks_like_html(text: &str) -> bool {
    let t = text.trim_start().to_ascii_lowercase();
    t.starts_with("<!doctype") || t.starts_with("<html") || t.contains("<center><h1>")
}

/// Turn proxy/HTML failure bodies into a short human message (never dump raw HTML).
fn http_status_message(status: u16, text: &str, body: &Value, action: &str) -> String {
    if let Some(msg) = frappe_message(body) {
        return msg;
    }
    match status {
        502 | 503 | 504 => {
            format!("{action} failed: the site is temporarily unavailable (HTTP {status})")
        }
        401 | 403 if action == "Login" => "Invalid login credentials.".into(),
        _ if looks_like_html(text) || text.trim().is_empty() => {
            format!("{action} failed (HTTP {status})")
        }
        _ => {
            let snippet: String = text.chars().take(160).collect();
            if looks_like_html(&snippet) {
                format!("{action} failed (HTTP {status})")
            } else {
                format!("{action} failed (HTTP {status}): {snippet}")
            }
        }
    }
}

fn frappe_message(body: &Value) -> Option<String> {
    body.get("message")
        .and_then(|m| {
            if m.is_string() {
                m.as_str().map(|s| s.to_string())
            } else if let Some(obj) = m.as_object() {
                obj.get("message")
                    .and_then(|v| v.as_str())
                    .map(|s| s.to_string())
            } else {
                None
            }
        })
        .or_else(|| {
            body.get("_server_messages")
                .and_then(|v| v.as_str())
                .and_then(|raw| serde_json::from_str::<Value>(raw).ok())
                .and_then(|arr| arr.as_array().cloned())
                .and_then(|arr| arr.first().cloned())
                .and_then(|item| {
                    if let Some(s) = item.as_str() {
                        serde_json::from_str::<Value>(s)
                            .ok()
                            .and_then(|o| {
                                o.get("message")
                                    .and_then(|m| m.as_str())
                                    .map(|s| s.to_string())
                            })
                            .or_else(|| Some(item.as_str().unwrap_or("").to_string()))
                    } else {
                        item.get("message")
                            .and_then(|m| m.as_str())
                            .map(|s| s.to_string())
                    }
                })
        })
        .or_else(|| {
            body.get("exc_type")
                .and_then(|v| v.as_str())
                .map(|s| s.to_string())
        })
}

pub async fn login(
    site_url: &str,
    usr: &str,
    pwd: &str,
    state: &ErpnextState,
) -> Result<ErpnextSessionInfo, ErpnextError> {
    let usr = usr.trim();
    if usr.is_empty() {
        return Err(ErpnextError::Message("Username is required".into()));
    }
    if pwd.is_empty() {
        return Err(ErpnextError::Message("Password is required".into()));
    }

    let (url, base) = site_api_url(site_url, "/api/method/login")?;
    // Classic Frappe login accepts form-encoded usr/pwd (also works with JSON on newer sites).
    let response = with_request_deadline(
        client()?.post(&url)
            .header("Accept", "application/json")
            .header("Content-Type", "application/x-www-form-urlencoded")
            .body(format!(
                "usr={}&pwd={}",
                urlencoding_encode(usr),
                urlencoding_encode(pwd)
            ))
            .send(),
        8,
    )
    .await
    .map_err(|e| match e {
        ErpnextError::Http(err) => http_error(err, &base),
        other => other,
    })?;

    let status = response.status().as_u16();
    let headers = response.headers().clone();
    let text = response.text().await.unwrap_or_default();
    let body: Value = serde_json::from_str(&text).unwrap_or(Value::Null);

    if !(200..300).contains(&status) {
        let msg = http_status_message(status, &text, &body, "Login");
        state.clear();
        return Err(ErpnextError::Message(msg));
    }

    let sid = extract_sid_from_set_cookie(&headers).ok_or_else(|| {
        state.clear();
        ErpnextError::Message(
            "Login succeeded but no session cookie was returned. Check the site URL and CORS/proxy settings.".into(),
        )
    })?;

    let full_name = body
        .get("full_name")
        .and_then(|v| v.as_str())
        .or_else(|| {
            body.get("message")
                .and_then(|m| m.as_object())
                .and_then(|o| o.get("full_name"))
                .and_then(|v| v.as_str())
        })
        .unwrap_or("")
        .to_string();

    let user = usr.to_string();

    state.set(ErpnextSession {
        sid: sid.clone(),
        user: user.clone(),
        full_name: full_name.clone(),
    });

    Ok(ErpnextSessionInfo {
        logged_in: true,
        user,
        full_name,
        site_url: base,
    })
}

pub async fn logout(site_url: &str, state: &ErpnextState) -> Result<(), ErpnextError> {
    let sid = state.sid();
    state.clear();
    let Some(sid) = sid else {
        return Ok(());
    };
    let Ok((url, _)) = site_api_url(site_url, "/api/method/logout") else {
        return Ok(());
    };
    let _ = client()?
        .get(&url)
        .header("Accept", "application/json")
        .header("Cookie", format!("sid={sid}"))
        .send()
        .await;
    Ok(())
}

pub fn session_info(site_url: &str, state: &ErpnextState) -> ErpnextSessionInfo {
    let session = state.get();
    let logged_in = !session.sid.is_empty();
    ErpnextSessionInfo {
        logged_in,
        user: session.user,
        full_name: session.full_name,
        site_url: site_url.to_string(),
    }
}

fn looks_like_app_missing(status: u16, text: &str, body: &Value) -> bool {
    if status == 404 {
        return true;
    }
    let blob = format!("{text}{body}");
    let lower = blob.to_ascii_lowercase();
    if lower.contains("failed to get method") || lower.contains("attributeerror") {
        return true;
    }
    if lower.contains("opspilot_frappe")
        && (lower.contains("not installed")
            || lower.contains("not found")
            || lower.contains("no module")
            || lower.contains("does not exist")
            || status == 417
            || status == 500)
    {
        return true;
    }
    false
}

fn site_unsupported_message(site_url: &str) -> String {
    format!("This site does not support OpsPilot ({site_url}). Install the OpsPilot app on this site.")
}

/// Fast probe — works without login. Frappe returns 417 + "not installed" when the app is missing.
pub async fn probe_opspilot_support(site_url: &str) -> Result<bool, ErpnextError> {
    let (url, base) = site_api_url(site_url, "/api/method/opspilot_frappe.api.ping")?;
    let response = with_request_deadline(
        probe_client()?
            .get(&url)
            .header("Accept", "application/json")
            .send(),
        5,
    )
    .await
    .map_err(|e| match e {
        ErpnextError::Http(err) => http_error(err, &base),
        other => other,
    })?;

    let status = response.status().as_u16();
    let text = response.text().await.unwrap_or_default();
    let body: Value = serde_json::from_str(&text).unwrap_or(Value::Null);

    if (200..300).contains(&status) {
        let message = body.get("message").cloned().unwrap_or(Value::Null);
        if message.get("ok").and_then(|v| v.as_bool()).unwrap_or(false) {
            return Ok(true);
        }
        // Unexpected 200 payload — treat as supported so settings fetch can decide.
        return Ok(true);
    }

    if looks_like_app_missing(status, &text, &body)
        || text.to_ascii_lowercase().contains("not installed")
    {
        return Ok(false);
    }

    // Auth required on some stacks — not the same as missing app.
    if status == 401 || status == 403 {
        return Ok(true);
    }

    Err(ErpnextError::Message(http_status_message(
        status, &text, &body, "OpsPilot check",
    )))
}

pub async fn ensure_opspilot_installed(site_url: &str) -> Result<(), ErpnextError> {
    let base = normalize_site_url(site_url)?;
    match probe_opspilot_support(&base).await? {
        true => Ok(()),
        false => Err(ErpnextError::Message(site_unsupported_message(&base))),
    }
}

pub async fn fetch_opspilot_settings(
    site_url: &str,
    state: &ErpnextState,
) -> Result<Option<OpsPilotSettingsPayload>, ErpnextError> {
    ensure_opspilot_installed(site_url).await?;

    let sid = state.sid().ok_or_else(|| {
        ErpnextError::Message("Not logged into ERPNext. Sign in again.".into())
    })?;

    let (url, base) = site_api_url(
        site_url,
        "/api/method/opspilot_frappe.api.get_my_opspilot_settings",
    )?;
    let response = with_request_deadline(
        client()?
            .get(&url)
            .header("Accept", "application/json")
            .header("Cookie", format!("sid={sid}"))
            .send(),
        8,
    )
    .await
    .map_err(|e| match e {
        ErpnextError::Http(err) => http_error(err, &base),
        other => other,
    })?;

    let status = response.status().as_u16();
    let text = response.text().await.unwrap_or_default();
    let body: Value = serde_json::from_str(&text).unwrap_or(Value::Null);

    if status == 401 || status == 403 {
        state.clear();
        return Err(ErpnextError::Message(
            "ERPNext session expired. Please sign in again.".into(),
        ));
    }

    if !(200..300).contains(&status) {
        if looks_like_app_missing(status, &text, &body) {
            return Err(ErpnextError::Message(site_unsupported_message(&base)));
        }
        return Err(ErpnextError::Message(http_status_message(
            status, &text, &body, "Loading AI settings",
        )));
    }

    // Frappe wraps whitelist return values under "message".
    let message = body.get("message").cloned().unwrap_or(Value::Null);
    if message.is_null() {
        return Ok(None);
    }

    // Accept both camelCase (after our serde) and snake_case from Python.
    let payload = parse_settings_message(&message)?;
    Ok(Some(payload))
}

fn parse_settings_message(message: &Value) -> Result<OpsPilotSettingsPayload, ErpnextError> {
    // Prefer snake_case keys from the Python API.
    if let Some(obj) = message.as_object() {
        if obj.contains_key("gateway_url") || obj.contains_key("gatewayUrl") {
            let gateway_url = obj
                .get("gateway_url")
                .or_else(|| obj.get("gatewayUrl"))
                .and_then(|v| v.as_str())
                .unwrap_or("")
                .to_string();
            let auth_mode = obj
                .get("auth_mode")
                .or_else(|| obj.get("authMode"))
                .and_then(|v| v.as_str())
                .unwrap_or("password")
                .to_string();
            let gateway_username = obj
                .get("gateway_username")
                .or_else(|| obj.get("gatewayUsername"))
                .and_then(|v| v.as_str())
                .unwrap_or("")
                .to_string();
            let gateway_password = obj
                .get("gateway_password")
                .or_else(|| obj.get("gatewayPassword"))
                .and_then(|v| v.as_str())
                .unwrap_or("")
                .to_string();
            let session_token = obj
                .get("session_token")
                .or_else(|| obj.get("sessionToken"))
                .and_then(|v| v.as_str())
                .unwrap_or("")
                .to_string();
            let mut extra_headers = HashMap::new();
            if let Some(headers) = obj
                .get("extra_headers")
                .or_else(|| obj.get("extraHeaders"))
            {
                if let Some(map) = headers.as_object() {
                    for (k, v) in map {
                        if let Some(s) = v.as_str() {
                            extra_headers.insert(k.clone(), s.to_string());
                        } else {
                            extra_headers.insert(k.clone(), v.to_string());
                        }
                    }
                }
            }
            return Ok(OpsPilotSettingsPayload {
                gateway_url,
                auth_mode,
                gateway_username,
                gateway_password,
                session_token,
                extra_headers,
            });
        }
    }
    serde_json::from_value(message.clone()).map_err(|e| {
        ErpnextError::Message(format!("Could not parse OpsPilot Settings: {e}"))
    })
}
