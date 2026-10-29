use crate::connection::{AuthMode, ConnectionConfig};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use thiserror::Error;

#[derive(Debug, Error)]
pub enum AuthError {
    #[error("{0}")]
    Message(String),
    #[error(transparent)]
    Http(#[from] reqwest::Error),
    #[error(transparent)]
    Connection(#[from] crate::connection::ConnectionError),
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AuthProviderInfo {
    pub name: String,
    pub display_name: String,
    pub supports_password: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AuthProbe {
    pub auth_required: bool,
    pub auth_mode: AuthMode,
    pub providers: Vec<AuthProviderInfo>,
    pub signed_in: bool,
    pub status: Value,
    /// Canonical base URL after stripping `/login` etc.
    pub normalized_url: String,
}

fn client() -> Result<reqwest::Client, AuthError> {
    reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(20))
        .redirect(reqwest::redirect::Policy::none())
        .build()
        .map_err(|e| AuthError::Message(e.to_string()))
}

fn apply_auth_headers(
    builder: reqwest::RequestBuilder,
    config: &ConnectionConfig,
) -> reqwest::RequestBuilder {
    let mut builder = builder.header("Accept", "application/json");
    if let Some(cookie) = config.cookie_header() {
        builder = builder.header("Cookie", cookie);
    }
    if !config.token.trim().is_empty() {
        builder = builder.header("X-Hermes-Session-Token", config.token.trim());
    }
    for (name, value) in config.filtered_extra_headers() {
        builder = builder.header(name, value);
    }
    builder
}

fn collect_set_cookies(response: &reqwest::Response) -> Vec<String> {
    let mut out: Vec<String> = response
        .headers()
        .get_all(reqwest::header::SET_COOKIE)
        .iter()
        .filter_map(|v| v.to_str().ok().map(|s| s.to_string()))
        .collect();

    // Some stacks only expose cookies via the cookies() helper.
    for cookie in response.cookies() {
        out.push(format!("{}={}", cookie.name(), cookie.value()));
    }
    out
}

fn absorb_response_cookies(config: &mut ConnectionConfig, response: &reqwest::Response) {
    config.merge_set_cookies(&collect_set_cookies(response));
    for cookie in response.cookies() {
        config.insert_cookie(cookie.name().to_string(), cookie.value().to_string());
    }
}

pub async fn probe_auth(config: &ConnectionConfig) -> Result<AuthProbe, AuthError> {
    let base = config.http_base()?;
    let status_resp = client()?
        .get(format!("{base}/api/status"))
        .header("Accept", "application/json")
        .send()
        .await?;
    let status_code = status_resp.status().as_u16();
    let status_text = status_resp.text().await.unwrap_or_default();
    if !(200..300).contains(&status_code) {
        return Err(AuthError::Message(format!(
            "Gateway status probe failed (HTTP {status_code}). Use the gateway base URL, not /login."
        )));
    }
    let status: Value = serde_json::from_str(&status_text).map_err(|_| {
        AuthError::Message(format!(
            "Gateway did not return JSON from /api/status. \
             Use the base URL (e.g. https://host) instead of /login. Normalized tried: {base}"
        ))
    })?;

    let auth_required = status
        .get("auth_required")
        .and_then(|v| v.as_bool())
        .unwrap_or(false);

    let mut providers = Vec::new();
    if auth_required {
        let providers_resp = client()?
            .get(format!("{base}/api/auth/providers"))
            .header("Accept", "application/json")
            .send()
            .await;
        if let Ok(resp) = providers_resp {
            if resp.status().is_success() {
                let body: Value = resp.json().await.unwrap_or(Value::Null);
                if let Some(list) = body.get("providers").and_then(|p| p.as_array()) {
                    for item in list {
                        providers.push(AuthProviderInfo {
                            name: item
                                .get("name")
                                .and_then(|v| v.as_str())
                                .unwrap_or("")
                                .to_string(),
                            display_name: item
                                .get("display_name")
                                .and_then(|v| v.as_str())
                                .unwrap_or("Sign in")
                                .to_string(),
                            supports_password: item
                                .get("supports_password")
                                .and_then(|v| v.as_bool())
                                .unwrap_or(false),
                        });
                    }
                }
            }
        }
    }

    let password_gateway = auth_required
        && !providers.is_empty()
        && providers.iter().all(|p| p.supports_password);

    let auth_mode = if password_gateway {
        AuthMode::Password
    } else if auth_required {
        // OAuth / mixed — still cookie-ticket based once signed in.
        AuthMode::Password
    } else {
        AuthMode::Token
    };

    let signed_in = if matches!(auth_mode, AuthMode::Password) {
        config.has_session_access_cookie() || me_ok(config).await.unwrap_or(false)
    } else {
        !config.token.trim().is_empty()
    };

    Ok(AuthProbe {
        auth_required,
        auth_mode,
        providers,
        signed_in,
        status,
        normalized_url: base,
    })
}

async fn me_ok(config: &ConnectionConfig) -> Result<bool, AuthError> {
    if config.cookie_header().is_none() && config.token.trim().is_empty() {
        return Ok(false);
    }
    let base = config.http_base()?;
    let resp = apply_auth_headers(client()?.get(format!("{base}/api/auth/me")), config)
        .send()
        .await?;
    Ok(resp.status().is_success())
}

pub async fn password_login(
    mut config: ConnectionConfig,
) -> Result<ConnectionConfig, AuthError> {
    let username = config.username.trim();
    let password = config.password.clone();
    if username.is_empty() || password.is_empty() {
        return Err(AuthError::Message(
            "Username and password are required".into(),
        ));
    }

    let base = config.http_base()?;
    let provider = "basic";
    let mut req = client()?
        .post(format!("{base}/auth/password-login"))
        .header("Content-Type", "application/json")
        .header("Accept", "application/json");
    for (name, value) in config.filtered_extra_headers() {
        req = req.header(name, value);
    }
    let resp = req
        .json(&json!({
            "provider": provider,
            "username": username,
            "password": password,
            "next": "/",
        }))
        .send()
        .await?;

    let status = resp.status().as_u16();
    absorb_response_cookies(&mut config, &resp);
    let text = resp.text().await.unwrap_or_default();

    if !(200..400).contains(&status) {
        let detail = serde_json::from_str::<Value>(&text)
            .ok()
            .and_then(|v| {
                v.get("detail")
                    .or_else(|| v.get("error"))
                    .or_else(|| v.get("message"))
                    .cloned()
            })
            .unwrap_or(Value::String(text));
        return Err(AuthError::Message(format!(
            "Sign-in failed (HTTP {status}): {detail}"
        )));
    }

    // Hermes returns {"ok": true, "next": "..."} on password login.
    let body: Value = serde_json::from_str(&text).unwrap_or(Value::Null);
    if body.get("ok").and_then(|v| v.as_bool()) != Some(true) && !(200..300).contains(&status) {
        return Err(AuthError::Message(format!(
            "Sign-in failed: unexpected response {text}"
        )));
    }

    config.auth_mode = AuthMode::Password;
    config.password.clear();
    config.token.clear();

    if !config.has_session_access_cookie() {
        let names: Vec<_> = config.cookies.keys().cloned().collect();
        return Err(AuthError::Message(format!(
            "Sign-in succeeded but no hermes_session_at cookie was returned \
             (got cookies: [{}]). On HTTPS Hermes uses __Host-hermes_session_at.",
            names.join(", ")
        )));
    }

    Ok(config)
}

pub async fn mint_ws_ticket(config: &ConnectionConfig) -> Result<String, AuthError> {
    if config.cookie_header().is_none() {
        return Err(AuthError::Message(
            "Not signed in — sign in with username and password first".into(),
        ));
    }
    let base = config.http_base()?;
    let resp = apply_auth_headers(
        client()?.post(format!("{base}/api/auth/ws-ticket")),
        config,
    )
    .send()
    .await?;

    let status = resp.status().as_u16();
    let text = resp.text().await.unwrap_or_default();
    if status == 401 || status == 403 {
        return Err(AuthError::Message(
            "Session expired — sign in again".into(),
        ));
    }
    if !(200..300).contains(&status) {
        return Err(AuthError::Message(format!(
            "WS ticket mint failed (HTTP {status}): {text}"
        )));
    }
    let body: Value = serde_json::from_str(&text)
        .map_err(|_| AuthError::Message(format!("Invalid ws-ticket response: {text}")))?;
    let ticket = body
        .get("ticket")
        .and_then(|v| v.as_str())
        .ok_or_else(|| AuthError::Message("ws-ticket response missing ticket".into()))?;
    Ok(ticket.to_string())
}

pub async fn resolve_ws_url(config: &ConnectionConfig) -> Result<String, AuthError> {
    if config.uses_cookies() || config.cookies.contains_key("hermes_session_at") {
        let ticket = mint_ws_ticket(config).await?;
        return Ok(config.ws_url_with_ticket(&ticket)?);
    }
    Ok(config.ws_url_with_token()?)
}
