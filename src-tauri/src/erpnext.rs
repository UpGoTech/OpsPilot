//! ERPNext site URL on disk + in-memory session (`sid` never persisted).

use parking_lot::Mutex;
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::collections::HashMap;
use std::fs;
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

/// Persisted locally — site URL only.
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ErpnextConfig {
    #[serde(default)]
    pub site_url: String,
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

fn client() -> Result<reqwest::Client, ErpnextError> {
    reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(30))
        .redirect(reqwest::redirect::Policy::none())
        .cookie_store(false)
        .build()
        .map_err(|e| ErpnextError::Message(e.to_string()))
}

pub fn normalize_site_url(raw: &str) -> Result<String, ErpnextError> {
    let trimmed = raw.trim();
    if trimmed.is_empty() {
        return Err(ErpnextError::Message("ERPNext site URL is required".into()));
    }
    let with_scheme = if trimmed.contains("://") {
        trimmed.to_string()
    } else {
        format!("https://{trimmed}")
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
    let base = normalize_site_url(site_url)?;
    let usr = usr.trim();
    if usr.is_empty() {
        return Err(ErpnextError::Message("Username is required".into()));
    }
    if pwd.is_empty() {
        return Err(ErpnextError::Message("Password is required".into()));
    }

    let url = format!("{base}/api/method/login");
    // Classic Frappe login accepts form-encoded usr/pwd (also works with JSON on newer sites).
    let response = client()?
        .post(&url)
        .header("Accept", "application/json")
        .header("Content-Type", "application/x-www-form-urlencoded")
        .body(format!(
            "usr={}&pwd={}",
            urlencoding_encode(usr),
            urlencoding_encode(pwd)
        ))
        .send()
        .await?;

    let status = response.status().as_u16();
    let headers = response.headers().clone();
    let text = response.text().await.unwrap_or_default();
    let body: Value = serde_json::from_str(&text).unwrap_or(Value::Null);

    if !(200..300).contains(&status) {
        let msg = frappe_message(&body).unwrap_or_else(|| {
            if text.trim().is_empty() {
                format!("Login failed (HTTP {status})")
            } else {
                text.chars().take(200).collect()
            }
        });
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
    let Ok(base) = normalize_site_url(site_url) else {
        return Ok(());
    };
    let url = format!("{base}/api/method/logout");
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

pub async fn fetch_opspilot_settings(
    site_url: &str,
    state: &ErpnextState,
) -> Result<Option<OpsPilotSettingsPayload>, ErpnextError> {
    let base = normalize_site_url(site_url)?;
    let sid = state.sid().ok_or_else(|| {
        ErpnextError::Message("Not logged into ERPNext. Sign in again.".into())
    })?;

    let url = format!("{base}/api/method/opspilot_frappe.api.get_my_opspilot_settings");
    let response = client()?
        .get(&url)
        .header("Accept", "application/json")
        .header("Cookie", format!("sid={sid}"))
        .send()
        .await?;

    let status = response.status().as_u16();
    let text = response.text().await.unwrap_or_default();

    if status == 401 || status == 403 {
        state.clear();
        return Err(ErpnextError::Message(
            "ERPNext session expired. Please sign in again.".into(),
        ));
    }

    if !(200..300).contains(&status) {
        let body: Value = serde_json::from_str(&text).unwrap_or(Value::Null);
        let msg = frappe_message(&body).unwrap_or_else(|| {
            format!("Failed to load OpsPilot Settings (HTTP {status})")
        });
        // App missing often surfaces as 404 / method not found.
        if text.contains("opspilot_frappe") || text.contains("App") || status == 404 {
            return Err(ErpnextError::Message(format!(
                "{msg}. Is the opspilot_frappe app installed on this site?"
            )));
        }
        return Err(ErpnextError::Message(msg));
    }

    let body: Value = serde_json::from_str(&text).map_err(|_| {
        ErpnextError::Message("ERPNext returned non-JSON from get_my_opspilot_settings".into())
    })?;

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
