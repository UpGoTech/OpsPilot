mod auth;
mod browser;
mod connection;
mod fs_api;
mod gateway;

use browser::BrowserState;
use connection::ConnectionConfig;
use gateway::GatewayManager;
use serde_json::Value;
use std::sync::Arc;
use tauri::State;

struct AppState {
    gateway: Arc<GatewayManager>,
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
        .manage(BrowserState::default())
        .invoke_handler(tauri::generate_handler![
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
