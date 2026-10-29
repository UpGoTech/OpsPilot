use crate::connection::ConnectionConfig;
use serde::Serialize;
use serde_json::Value;
use thiserror::Error;

#[derive(Debug, Error)]
pub enum FsApiError {
    #[error("{0}")]
    Message(String),
    #[error(transparent)]
    Http(#[from] reqwest::Error),
    #[error(transparent)]
    Json(#[from] serde_json::Error),
    #[error(transparent)]
    Connection(#[from] crate::connection::ConnectionError),
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct StatusProbe {
    pub ok: bool,
    pub status: u16,
    pub body: Value,
}

fn client() -> Result<reqwest::Client, FsApiError> {
    reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(20))
        .build()
        .map_err(|e| FsApiError::Message(e.to_string()))
}

fn apply_auth(
    builder: reqwest::RequestBuilder,
    config: &ConnectionConfig,
) -> Result<reqwest::RequestBuilder, FsApiError> {
    let mut builder = builder.header("Accept", "application/json");
    let cookie = config.cookie_header();
    let token = config.token.trim();
    if cookie.is_none() && token.is_empty() {
        return Err(FsApiError::Message(
            "Not authenticated — sign in or provide a session token".into(),
        ));
    }
    if let Some(cookie) = cookie {
        builder = builder.header("Cookie", cookie);
    }
    if !token.is_empty() {
        builder = builder.header("X-Hermes-Session-Token", token);
    }
    for (name, value) in config.filtered_extra_headers() {
        builder = builder.header(name, value);
    }
    Ok(builder)
}

async fn authorized_get(
    config: &ConnectionConfig,
    path_and_query: &str,
) -> Result<(u16, Value), FsApiError> {
    let base = config.http_base()?;
    let url = format!("{base}{path_and_query}");
    let response = apply_auth(client()?.get(&url), config)?.send().await?;

    let status = response.status().as_u16();
    let text = response.text().await.unwrap_or_default();
    let body = if text.trim().is_empty() {
        Value::Null
    } else {
        serde_json::from_str(&text).unwrap_or(Value::String(text))
    };

    if !(200..300).contains(&status) {
        let detail = body
            .get("detail")
            .or_else(|| body.get("error"))
            .or_else(|| body.get("message"))
            .cloned()
            .unwrap_or(body.clone());
        return Err(FsApiError::Message(format!("HTTP {status}: {detail}")));
    }

    Ok((status, body))
}

/// Public readiness probe — does not require auth (matches Desktop).
pub async fn test_connection(config: &ConnectionConfig) -> Result<StatusProbe, FsApiError> {
    let base = config.http_base()?;
    let response = client()?
        .get(format!("{base}/api/status"))
        .header("Accept", "application/json")
        .send()
        .await?;
    let status = response.status().as_u16();
    let text = response.text().await.unwrap_or_default();
    if !(200..300).contains(&status) {
        return Err(FsApiError::Message(format!(
            "Gateway not reachable (HTTP {status})"
        )));
    }
    let body: Value = serde_json::from_str(&text).map_err(|_| {
        FsApiError::Message(format!(
            "Got HTTP {status} but not a Hermes /api/status JSON body. \
             Paste the gateway base URL (https://host), not /login. Tried: {base}"
        ))
    })?;
    if body.get("auth_required").is_none() && body.get("overall").is_none() {
        return Err(FsApiError::Message(format!(
            "Unexpected /api/status payload. Use the gateway base URL, not /login. Tried: {base}"
        )));
    }
    Ok(StatusProbe {
        ok: true,
        status,
        body,
    })
}

pub async fn default_cwd(config: &ConnectionConfig) -> Result<Value, FsApiError> {
    let (_, body) = authorized_get(config, "/api/fs/default-cwd").await?;
    Ok(body)
}

pub async fn list_path(config: &ConnectionConfig, path: &str) -> Result<Value, FsApiError> {
    let encoded = urlencoding_path(path);
    let (_, body) = authorized_get(config, &format!("/api/fs/list?path={encoded}")).await?;
    Ok(body)
}

pub async fn read_text(config: &ConnectionConfig, path: &str) -> Result<Value, FsApiError> {
    let encoded = urlencoding_path(path);
    let (_, body) = authorized_get(config, &format!("/api/fs/read-text?path={encoded}")).await?;
    Ok(body)
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DownloadedFile {
    pub path: String,
    pub filename: String,
    pub mime: String,
    pub base64: String,
    pub byte_length: usize,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SavedLocalFile {
    /// Remote gateway path.
    pub remote_path: String,
    /// Absolute path on this Mac.
    pub local_path: String,
    pub filename: String,
    pub byte_length: usize,
}

fn filename_from_path(path: &str) -> String {
    path.rsplit(['/', '\\'])
        .next()
        .filter(|s| !s.is_empty())
        .unwrap_or("download")
        .to_string()
}

fn guess_mime(filename: &str) -> String {
    let lower = filename.to_ascii_lowercase();
    if lower.ends_with(".xlsx") || lower.ends_with(".xlsm") {
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet".into()
    } else if lower.ends_with(".xls") {
        "application/vnd.ms-excel".into()
    } else if lower.ends_with(".pdf") {
        "application/pdf".into()
    } else if lower.ends_with(".csv") {
        "text/csv".into()
    } else if lower.ends_with(".json") {
        "application/json".into()
    } else if lower.ends_with(".png") {
        "image/png".into()
    } else if lower.ends_with(".jpg") || lower.ends_with(".jpeg") {
        "image/jpeg".into()
    } else if lower.ends_with(".txt") || lower.ends_with(".md") {
        "text/plain".into()
    } else {
        "application/octet-stream".into()
    }
}

async fn fetch_remote_bytes(
    config: &ConnectionConfig,
    path: &str,
) -> Result<(String, String, Vec<u8>), FsApiError> {
    let filename = filename_from_path(path);
    let mime = guess_mime(&filename);
    let encoded = urlencoding_path(path);
    let base = config.http_base()?;

    // Prefer streaming download endpoint.
    let download_url = format!("{base}/api/fs/download?path={encoded}");
    let response = apply_auth(
        reqwest::Client::builder()
            .timeout(std::time::Duration::from_secs(120))
            .build()
            .map_err(|e| FsApiError::Message(e.to_string()))?
            .get(&download_url),
        config,
    )?
    .send()
    .await?;

    let status = response.status().as_u16();
    if (200..300).contains(&status) {
        let bytes = response.bytes().await.map_err(FsApiError::Http)?;
        return Ok((filename, mime, bytes.to_vec()));
    }

    // Older / capped gateways: data-URL JSON.
    let data_url_path = format!("/api/fs/read-data-url?path={encoded}");
    match authorized_get(config, &data_url_path).await {
        Ok((_, body)) => {
            let data_url = body
                .as_str()
                .map(str::to_string)
                .or_else(|| {
                    body.get("dataUrl")
                        .or_else(|| body.get("data_url"))
                        .and_then(|v| v.as_str())
                        .map(str::to_string)
                })
                .ok_or_else(|| {
                    FsApiError::Message(
                        "Gateway returned no data URL for this file".into(),
                    )
                })?;
            let (parsed_mime, b64) = split_data_url(&data_url).ok_or_else(|| {
                FsApiError::Message("Invalid data URL from gateway".into())
            })?;
            use base64::{engine::general_purpose::STANDARD, Engine as _};
            let raw = STANDARD
                .decode(b64.as_bytes())
                .map_err(|e| FsApiError::Message(format!("Bad data URL payload: {e}")))?;
            Ok((
                filename,
                if parsed_mime.is_empty() {
                    mime
                } else {
                    parsed_mime
                },
                raw,
            ))
        }
        Err(err) => Err(FsApiError::Message(format!(
            "Couldn't fetch {filename} from the gateway (HTTP {status}; fallback: {err})"
        ))),
    }
}

/// Fetch a remote workspace file through the authenticated FS bridge
/// (`/api/fs/download`, with `/api/fs/read-data-url` fallback) — same path
/// Desktop uses for sandbox:/ and file:// chat artifacts.
pub async fn download_file(
    config: &ConnectionConfig,
    path: &str,
) -> Result<DownloadedFile, FsApiError> {
    let (filename, mime, bytes) = fetch_remote_bytes(config, path).await?;
    use base64::{engine::general_purpose::STANDARD, Engine as _};
    Ok(DownloadedFile {
        path: path.to_string(),
        filename,
        mime,
        byte_length: bytes.len(),
        base64: STANDARD.encode(&bytes),
    })
}

fn unique_download_path(dir: &std::path::Path, filename: &str) -> std::path::PathBuf {
    let candidate = dir.join(filename);
    if !candidate.exists() {
        return candidate;
    }
    let stem = std::path::Path::new(filename)
        .file_stem()
        .and_then(|s| s.to_str())
        .unwrap_or("download");
    let ext = std::path::Path::new(filename)
        .extension()
        .and_then(|s| s.to_str())
        .map(|e| format!(".{e}"))
        .unwrap_or_default();
    for n in 1..1000 {
        let next = dir.join(format!("{stem} ({n}){ext}"));
        if !next.exists() {
            return next;
        }
    }
    dir.join(format!("{stem}-{}{ext}", uuid_like()))
}

fn uuid_like() -> String {
    use std::time::{SystemTime, UNIX_EPOCH};
    let ms = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis())
        .unwrap_or(0);
    format!("{ms}")
}

/// Fetch from the gateway and write into this Mac's Downloads folder.
pub async fn download_to_downloads(
    config: &ConnectionConfig,
    path: &str,
) -> Result<SavedLocalFile, FsApiError> {
    let (filename, _mime, bytes) = fetch_remote_bytes(config, path).await?;
    let downloads = dirs::download_dir().ok_or_else(|| {
        FsApiError::Message("Could not locate your Downloads folder".into())
    })?;
    std::fs::create_dir_all(&downloads)
        .map_err(|e| FsApiError::Message(format!("Could not create Downloads: {e}")))?;
    let dest = unique_download_path(&downloads, &filename);
    std::fs::write(&dest, &bytes)
        .map_err(|e| FsApiError::Message(format!("Could not write {}: {e}", dest.display())))?;
    Ok(SavedLocalFile {
        remote_path: path.to_string(),
        local_path: dest.display().to_string(),
        filename: dest
            .file_name()
            .and_then(|s| s.to_str())
            .unwrap_or(&filename)
            .to_string(),
        byte_length: bytes.len(),
    })
}

/// Fetch from the gateway and write to an absolute path chosen by the user (Save As).
pub async fn download_to_path(
    config: &ConnectionConfig,
    path: &str,
    dest: &str,
) -> Result<SavedLocalFile, FsApiError> {
    let (filename, _mime, bytes) = fetch_remote_bytes(config, path).await?;
    let dest_path = std::path::PathBuf::from(dest);
    if let Some(parent) = dest_path.parent() {
        std::fs::create_dir_all(parent)
            .map_err(|e| FsApiError::Message(format!("Could not create folder: {e}")))?;
    }
    std::fs::write(&dest_path, &bytes).map_err(|e| {
        FsApiError::Message(format!("Could not write {}: {e}", dest_path.display()))
    })?;
    Ok(SavedLocalFile {
        remote_path: path.to_string(),
        local_path: dest_path.display().to_string(),
        filename: dest_path
            .file_name()
            .and_then(|s| s.to_str())
            .unwrap_or(&filename)
            .to_string(),
        byte_length: bytes.len(),
    })
}

/// Fetch from the gateway into a temp file for WebView preview (`convertFileSrc`).
pub async fn download_for_preview(
    config: &ConnectionConfig,
    path: &str,
) -> Result<SavedLocalFile, FsApiError> {
    let (filename, _mime, bytes) = fetch_remote_bytes(config, path).await?;
    let dir = std::env::temp_dir().join("opspilot-preview");
    std::fs::create_dir_all(&dir)
        .map_err(|e| FsApiError::Message(format!("Could not create temp folder: {e}")))?;
    let safe_name = filename
        .chars()
        .map(|c| {
            if c.is_ascii_alphanumeric() || c == '.' || c == '-' || c == '_' {
                c
            } else {
                '_'
            }
        })
        .collect::<String>();
    let dest = unique_download_path(&dir, &safe_name);
    std::fs::write(&dest, &bytes)
        .map_err(|e| FsApiError::Message(format!("Could not write preview file: {e}")))?;
    Ok(SavedLocalFile {
        remote_path: path.to_string(),
        local_path: dest.display().to_string(),
        filename: dest
            .file_name()
            .and_then(|s| s.to_str())
            .unwrap_or(&safe_name)
            .to_string(),
        byte_length: bytes.len(),
    })
}

fn split_data_url(data_url: &str) -> Option<(String, String)> {
    let (meta, b64) = data_url.split_once(',')?;
    let mime = meta
        .strip_prefix("data:")
        .unwrap_or(meta)
        .split(';')
        .next()
        .unwrap_or("application/octet-stream")
        .to_string();
    Some((mime, b64.to_string()))
}

fn urlencoding_path(value: &str) -> String {
    let mut out = String::with_capacity(value.len());
    for b in value.bytes() {
        match b {
            b'A'..=b'Z' | b'a'..=b'z' | b'0'..=b'9' | b'-' | b'_' | b'.' | b'~' | b'/' => {
                out.push(b as char)
            }
            _ => out.push_str(&format!("%{b:02X}")),
        }
    }
    out
}
