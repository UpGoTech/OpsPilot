mod auth;
mod browser;
mod connection;
mod erpnext;
mod fs_api;
mod gateway;

use browser::BrowserState;
use connection::ConnectionConfig;
use erpnext::ErpnextState;
use gateway::GatewayManager;
use serde_json::Value;
use std::sync::Arc;
use tauri::State;

struct AppState {
    gateway: Arc<GatewayManager>,
}

#[tauri::command]
fn get_erpnext_config(app: tauri::AppHandle) -> Result<erpnext::ErpnextConfig, String> {
    erpnext::load_config(&app).map_err(|e| e.to_string())
}

#[tauri::command]
fn save_erpnext_config(
    app: tauri::AppHandle,
    config: erpnext::ErpnextConfig,
    erpnext_state: State<'_, ErpnextState>,
) -> Result<erpnext::ErpnextConfig, String> {
    let previous = erpnext::load_config(&app).map_err(|e| e.to_string())?;
    let mut cleaned = config;
    if !cleaned.site_url.trim().is_empty() {
        cleaned.site_url =
            erpnext::normalize_site_url(&cleaned.site_url).map_err(|e| e.to_string())?;
    }
    erpnext::save_config(&app, &cleaned).map_err(|e| e.to_string())?;
    // Changing the site invalidates any in-memory ERPNext session.
    if previous.site_url.trim() != cleaned.site_url.trim() {
        erpnext_state.clear();
    }
    Ok(cleaned)
}

#[tauri::command]
fn get_erpnext_session(
    app: tauri::AppHandle,
    erpnext_state: State<'_, ErpnextState>,
) -> Result<erpnext::ErpnextSessionInfo, String> {
    let config = erpnext::load_config(&app).map_err(|e| e.to_string())?;
    Ok(erpnext::session_info(&config.site_url, &erpnext_state))
}

#[tauri::command]
async fn erpnext_login(
    app: tauri::AppHandle,
    erpnext_state: State<'_, ErpnextState>,
    usr: String,
    pwd: String,
) -> Result<erpnext::ErpnextSessionInfo, String> {
    let config = erpnext::load_config(&app).map_err(|e| e.to_string())?;
    if config.site_url.trim().is_empty() {
        return Err("Save an ERPNext site URL in Settings first.".into());
    }
    erpnext::login(&config.site_url, &usr, &pwd, &erpnext_state)
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
async fn erpnext_logout(
    app: tauri::AppHandle,
    erpnext_state: State<'_, ErpnextState>,
) -> Result<(), String> {
    let config = erpnext::load_config(&app).map_err(|e| e.to_string())?;
    erpnext::logout(&config.site_url, &erpnext_state)
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
async fn erpnext_fetch_opspilot_settings(
    app: tauri::AppHandle,
    erpnext_state: State<'_, ErpnextState>,
) -> Result<Option<erpnext::OpsPilotSettingsPayload>, String> {
    let config = erpnext::load_config(&app).map_err(|e| e.to_string())?;
    if config.site_url.trim().is_empty() {
        return Err("ERPNext site URL is not configured.".into());
    }
    erpnext::fetch_opspilot_settings(&config.site_url, &erpnext_state)
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
fn get_connection(app: tauri::AppHandle) -> Result<ConnectionConfig, String> {
    connection::load_connection(&app).map_err(|e| e.to_string())
}

#[tauri::command]
fn save_connection(
    app: tauri::AppHandle,
    config: ConnectionConfig,
) -> Result<ConnectionConfig, String> {
    connection::save_connection(&app, &config).map_err(|e| e.to_string())?;
    let mut cleaned = config;
    cleaned.password.clear();
    Ok(cleaned)
}

#[tauri::command]
async fn probe_auth(config: ConnectionConfig) -> Result<auth::AuthProbe, String> {
    auth::probe_auth(&config).await.map_err(|e| e.to_string())
}

#[tauri::command]
async fn password_login(
    app: tauri::AppHandle,
    config: ConnectionConfig,
) -> Result<ConnectionConfig, String> {
    let signed_in = auth::password_login(config)
        .await
        .map_err(|e| e.to_string())?;
    connection::save_connection(&app, &signed_in).map_err(|e| e.to_string())?;
    Ok(signed_in)
}

#[tauri::command]
async fn test_connection(config: ConnectionConfig) -> Result<fs_api::StatusProbe, String> {
    fs_api::test_connection(&config)
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
async fn gateway_connect(
    app: tauri::AppHandle,
    state: State<'_, AppState>,
    config: ConnectionConfig,
) -> Result<(), String> {
    connection::save_connection(&app, &config).map_err(|e| e.to_string())?;
    state.gateway.connect(app, config).await
}

#[tauri::command]
async fn gateway_disconnect(state: State<'_, AppState>) -> Result<(), String> {
    state.gateway.disconnect().await;
    Ok(())
}

#[tauri::command]
async fn gateway_rpc(
    state: State<'_, AppState>,
    method: String,
    params: Option<Value>,
) -> Result<Value, String> {
    state
        .gateway
        .rpc(method, params.unwrap_or(Value::Null))
        .await
}

#[tauri::command]
async fn fs_default_cwd(config: ConnectionConfig) -> Result<Value, String> {
    fs_api::default_cwd(&config)
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
async fn fs_list(config: ConnectionConfig, path: String) -> Result<Value, String> {
    fs_api::list_path(&config, &path)
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
async fn fs_read_text(config: ConnectionConfig, path: String) -> Result<Value, String> {
    fs_api::read_text(&config, &path)
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
async fn fs_download(
    config: ConnectionConfig,
    path: String,
) -> Result<fs_api::DownloadedFile, String> {
    fs_api::download_file(&config, &path)
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
async fn fs_download_to_downloads(
    config: ConnectionConfig,
    path: String,
) -> Result<fs_api::SavedLocalFile, String> {
    fs_api::download_to_downloads(&config, &path)
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
async fn fs_download_to_path(
    config: ConnectionConfig,
    path: String,
    dest: String,
) -> Result<fs_api::SavedLocalFile, String> {
    fs_api::download_to_path(&config, &path, &dest)
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
async fn fs_download_for_preview(
    config: ConnectionConfig,
    path: String,
) -> Result<fs_api::SavedLocalFile, String> {
    fs_api::download_for_preview(&config, &path)
        .await
        .map_err(|e| e.to_string())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let gateway = Arc::new(GatewayManager::new());

    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_store::Builder::new().build())
        .plugin(tauri_plugin_dialog::init())
        .manage(AppState {
            gateway: gateway.clone(),
        })
        .manage(ErpnextState::default())
        .manage(BrowserState::default())
        .invoke_handler(tauri::generate_handler![
            get_erpnext_config,
            save_erpnext_config,
            get_erpnext_session,
            erpnext_login,
            erpnext_logout,
            erpnext_fetch_opspilot_settings,
            get_connection,
            save_connection,
            probe_auth,
            password_login,
            test_connection,
            gateway_connect,
            gateway_disconnect,
            gateway_rpc,
            fs_default_cwd,
            fs_list,
            fs_read_text,
            fs_download,
            fs_download_to_downloads,
            fs_download_to_path,
            fs_download_for_preview,
            browser::browser_create,
            browser::browser_set_bounds,
            browser::browser_show,
            browser::browser_hide,
            browser::browser_navigate,
            browser::browser_reload,
            browser::browser_back,
            browser::browser_forward,
            browser::browser_close,
            browser::browser_hide_all,
        ])
        .setup(|app| {
            GatewayManager::state_idle(app.handle());
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running OpsPilot");
}
