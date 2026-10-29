//! Nested child webviews for center-pane browser tabs.

use parking_lot::Mutex;
use serde::Serialize;
use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::Arc;
use tauri::{
  Emitter, Manager, WebviewUrl,
  webview::{DownloadEvent, PageLoadEvent, WebviewBuilder},
  AppHandle, LogicalPosition, LogicalSize, State,
};
use url::Url;

/// Pending download destinations by URL — macOS Finish events omit the path.
pub struct BrowserState {
  pending_downloads: Arc<Mutex<HashMap<String, PathBuf>>>,
}

impl Default for BrowserState {
  fn default() -> Self {
    Self {
      pending_downloads: Arc::new(Mutex::new(HashMap::new())),
    }
  }
}

#[derive(Clone, Serialize)]
struct NavigatedPayload {
  label: String,
  url: String,
}

#[derive(Clone, Serialize)]
struct DownloadStartedPayload {
  label: String,
  url: String,
  path: String,
  file_name: String,
}

#[derive(Clone, Serialize)]
struct DownloadFinishedPayload {
  label: String,
  url: String,
  path: Option<String>,
  file_name: Option<String>,
  success: bool,
}

fn suggested_download_name(url: &Url) -> String {
  let segment = url
    .path_segments()
    .and_then(|mut parts| parts.next_back())
    .filter(|s| !s.is_empty())
    .unwrap_or("download");
  let decoded = segment.replace("%20", " ").replace('+', " ");
  let name = decoded.split('?').next().unwrap_or(&decoded).trim();
  if name.is_empty() {
    "download".into()
  } else {
    name.to_string()
  }
}

fn downloads_dir_path(file_name: &str) -> PathBuf {
  let dir = dirs::download_dir()
    .or_else(dirs::home_dir)
    .unwrap_or_else(|| PathBuf::from("."));
  unique_path(dir.join(file_name))
}

fn unique_path(path: PathBuf) -> PathBuf {
  if !path.exists() {
    return path;
  }
  let stem = path
    .file_stem()
    .and_then(|s| s.to_str())
    .unwrap_or("download");
  let ext = path
    .extension()
    .and_then(|s| s.to_str())
    .map(|e| format!(".{e}"))
    .unwrap_or_default();
  let parent = path.parent().unwrap_or_else(|| Path::new("."));
  for i in 1..1000 {
    let candidate = parent.join(format!("{stem} ({i}){ext}"));
    if !candidate.exists() {
      return candidate;
    }
  }
  path
}

fn normalize_url(raw: &str) -> Result<Url, String> {
  let trimmed = raw.trim();
  if trimmed.is_empty() {
    return Err("URL is empty".into());
  }
  if trimmed.eq_ignore_ascii_case("about:blank") {
    return Url::parse("about:blank").map_err(|e| e.to_string());
  }
  let with_scheme = if trimmed.starts_with("http://")
    || trimmed.starts_with("https://")
    || trimmed.starts_with("about:")
  {
    trimmed.to_string()
  } else {
    format!("https://{trimmed}")
  };
  Url::parse(&with_scheme).map_err(|e| e.to_string())
}

fn get_browser_webview(
  app: &AppHandle,
  label: &str,
) -> Result<tauri::Webview, String> {
  if !label.starts_with("browser-") {
    return Err("invalid browser webview label".into());
  }
  app.get_webview(label)
    .ok_or_else(|| format!("browser webview '{label}' not found"))
}

fn emit_navigated(app: &AppHandle, label: &str, url: &str) {
  let _ = app.emit(
    "browser-navigated",
    NavigatedPayload {
      label: label.to_string(),
      url: url.to_string(),
    },
  );
}

#[tauri::command]
pub async fn browser_create(
  app: AppHandle,
  state: State<'_, BrowserState>,
  label: String,
  url: Option<String>,
  x: f64,
  y: f64,
  width: f64,
  height: f64,
) -> Result<(), String> {
  if !label.starts_with("browser-") {
    return Err("browser label must start with browser-".into());
  }
  if app.get_webview(&label).is_some() {
    return Ok(());
  }

  let window = app
    .get_window("main")
    .ok_or_else(|| "main window not found".to_string())?;

  let initial_url = match url.as_deref().map(str::trim).filter(|s| !s.is_empty()) {
    Some(raw) => WebviewUrl::External(normalize_url(raw)?),
    None => WebviewUrl::External(Url::parse("about:blank").map_err(|e| e.to_string())?),
  };

  let app_nav = app.clone();
  let label_nav = label.clone();
  let app_load = app.clone();
  let label_load = label.clone();
  let label_dl_start = label.clone();
  let label_dl_fin = label.clone();
  // Never use a blocking Save dialog here — WKWebView calls this on the UI
  // thread and a modal deadlocks the app. Save straight to Downloads instead.
  let pending = Arc::clone(&state.pending_downloads);
  let pending_fin = Arc::clone(&state.pending_downloads);

  let builder = WebviewBuilder::new(&label, initial_url)
    .on_navigation(move |url| {
      emit_navigated(&app_nav, &label_nav, &url.to_string());
      true
    })
    .on_page_load(move |_webview, payload| {
      if matches!(payload.event(), PageLoadEvent::Finished) {
        emit_navigated(&app_load, &label_load, &payload.url().to_string());
      }
    })
    .on_download(move |webview, event| match event {
      DownloadEvent::Requested { url, destination } => {
        let file_name = suggested_download_name(&url);
        let path = downloads_dir_path(&file_name);
        *destination = path.clone();
        pending
          .lock()
          .insert(url.to_string(), path.clone());
        let _ = webview.app_handle().emit(
          "browser-download-started",
          DownloadStartedPayload {
            label: label_dl_start.clone(),
            url: url.to_string(),
            path: path.display().to_string(),
            file_name,
          },
        );
        true
      }
      DownloadEvent::Finished { url, path, success } => {
        let tracked = pending_fin.lock().remove(&url.to_string());
        let resolved = path.clone().or(tracked).map(|p| p.display().to_string());
        let file_name = resolved.as_ref().and_then(|p| {
          Path::new(p)
            .file_name()
            .and_then(|s| s.to_str())
            .map(|s| s.to_string())
        });
        let _ = webview.app_handle().emit(
          "browser-download-finished",
          DownloadFinishedPayload {
            label: label_dl_fin.clone(),
            url: url.to_string(),
            path: resolved,
            file_name,
            success,
          },
        );
        true
      }
      _ => true,
    });

  let w = width.max(1.0);
  let h = height.max(1.0);

  window
    .add_child(
      builder,
      LogicalPosition::new(x, y),
      LogicalSize::new(w, h),
    )
    .map_err(|e| e.to_string())?;

  if let Ok(wv) = get_browser_webview(&app, &label) {
    let _ = wv.hide();
  }

  Ok(())
}

#[tauri::command]
pub async fn browser_set_bounds(
  app: AppHandle,
  label: String,
  x: f64,
  y: f64,
  width: f64,
  height: f64,
) -> Result<(), String> {
  let wv = get_browser_webview(&app, &label)?;
  wv.set_position(LogicalPosition::new(x, y))
    .map_err(|e| e.to_string())?;
  wv.set_size(LogicalSize::new(width.max(1.0), height.max(1.0)))
    .map_err(|e| e.to_string())?;
  Ok(())
}

#[tauri::command]
pub async fn browser_show(app: AppHandle, label: String) -> Result<(), String> {
  get_browser_webview(&app, &label)?
    .show()
    .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn browser_hide(app: AppHandle, label: String) -> Result<(), String> {
  get_browser_webview(&app, &label)?
    .hide()
    .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn browser_navigate(
  app: AppHandle,
  label: String,
  url: String,
) -> Result<String, String> {
  let parsed = normalize_url(&url)?;
  let href = parsed.to_string();
  get_browser_webview(&app, &label)?
    .navigate(parsed)
    .map_err(|e| e.to_string())?;
  emit_navigated(&app, &label, &href);
  Ok(href)
}

#[tauri::command]
pub async fn browser_reload(app: AppHandle, label: String) -> Result<(), String> {
  get_browser_webview(&app, &label)?
    .reload()
    .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn browser_back(app: AppHandle, label: String) -> Result<(), String> {
  get_browser_webview(&app, &label)?
    .eval("window.history.back()")
    .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn browser_forward(app: AppHandle, label: String) -> Result<(), String> {
  get_browser_webview(&app, &label)?
    .eval("window.history.forward()")
    .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn browser_close(app: AppHandle, label: String) -> Result<(), String> {
  if let Ok(wv) = get_browser_webview(&app, &label) {
    wv.close().map_err(|e| e.to_string())?;
  }
  Ok(())
}

#[tauri::command]
pub async fn browser_hide_all(app: AppHandle) -> Result<(), String> {
  for wv in app.webviews().values() {
    if wv.label().starts_with("browser-") {
      let _ = wv.hide();
    }
  }
  Ok(())
}
