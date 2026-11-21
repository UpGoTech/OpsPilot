import { invoke } from "@opspilot/native-core";
import type {
  AuthProbe,
  ConnectionConfig,
  ErpnextConfig,
  ErpnextSessionInfo,
  OpsPilotSettingsPayload,
} from "../types";

export function getErpnextConfig() {
  return invoke<ErpnextConfig>("get_erpnext_config");
}

export function saveErpnextConfig(config: ErpnextConfig) {
  return invoke<ErpnextConfig>("save_erpnext_config", { config });
}

export function getErpnextSession() {
  return invoke<ErpnextSessionInfo>("get_erpnext_session");
}

export function erpnextLogin(usr: string, pwd: string) {
  return invoke<ErpnextSessionInfo>("erpnext_login", { usr, pwd });
}

export function erpnextLogout() {
  return invoke<void>("erpnext_logout");
}

/** Chromium side panel: adopt Desk `sid` from chrome.cookies (no password form). */
export function erpnextAdoptBrowserSession(siteUrl?: string) {
  return invoke<ErpnextSessionInfo>("erpnext_adopt_browser_session", {
    siteUrl: siteUrl ?? null,
  });
}

export function erpnextProbeSupport() {
  return invoke<boolean>("erpnext_probe_support");
}

export function erpnextFetchOpspilotSettings() {
  return invoke<OpsPilotSettingsPayload | null>("erpnext_fetch_opspilot_settings");
}

export function erpnextActivateSite(siteUrl: string) {
  return invoke<string>("erpnext_activate_site", { siteUrl });
}

export function getActiveSiteKey() {
  return invoke<string | null>("get_active_site_key");
}

export function gatewaySiteState(siteKey: string) {
  return invoke<{
    state: string;
    detail: string | null;
    connected: boolean;
  }>("gateway_site_state", { siteKey });
}

export function getConnection(siteKey?: string) {
  return invoke<ConnectionConfig>("get_connection", {
    siteKey: siteKey ?? null,
  });
}

export function saveConnection(config: ConnectionConfig, siteKey?: string) {
  return invoke<ConnectionConfig>("save_connection", {
    config,
    siteKey: siteKey ?? null,
  });
}

export function probeAuth(config: ConnectionConfig) {
  return invoke<AuthProbe>("probe_auth", { config });
}

export function passwordLogin(config: ConnectionConfig) {
  return invoke<ConnectionConfig>("password_login", { config });
}

export function testConnection(config: ConnectionConfig) {
  return invoke<{ ok: boolean; status: number; body: unknown }>("test_connection", {
    config,
  });
}

export function gatewayConnect(config: ConnectionConfig, siteKey?: string) {
  return invoke<void>("gateway_connect", {
    config,
    siteKey: siteKey ?? null,
  });
}

export function gatewayDisconnect(siteKey?: string) {
  return invoke<void>("gateway_disconnect", {
    siteKey: siteKey ?? null,
  });
}

export function gatewayRpc<T = unknown>(method: string, params?: unknown) {
  return invoke<T>("gateway_rpc", { method, params: params ?? null });
}

/** Answer a Hermes server→client request (approval / clarify). */
export function gatewayRespond(id: string, result?: unknown) {
  return invoke<void>("gateway_respond", { id, result: result ?? null });
}

/** Fail a Hermes server→client request (unknown method / decline). */
export function gatewayFail(id: string, code: number, message: string) {
  return invoke<void>("gateway_fail", { id, code, message });
}

export function fsDefaultCwd(config: ConnectionConfig) {
  return invoke<unknown>("fs_default_cwd", { config });
}

export function fsList(config: ConnectionConfig, path: string) {
  return invoke<unknown>("fs_list", { config, path });
}

export function fsReadText(config: ConnectionConfig, path: string) {
  return invoke<unknown>("fs_read_text", { config, path });
}

export interface DownloadedFile {
  path: string;
  filename: string;
  mime: string;
  base64: string;
  byteLength: number;
}

export interface SavedLocalFile {
  remotePath: string;
  localPath: string;
  filename: string;
  byteLength: number;
}

export function fsDownload(config: ConnectionConfig, path: string) {
  return invoke<DownloadedFile>("fs_download", { config, path });
}

export function fsDownloadToDownloads(config: ConnectionConfig, path: string) {
  return invoke<SavedLocalFile>("fs_download_to_downloads", { config, path });
}

export function fsDownloadToPath(
  config: ConnectionConfig,
  path: string,
  dest: string,
) {
  return invoke<SavedLocalFile>("fs_download_to_path", { config, path, dest });
}

export function fsDownloadForPreview(config: ConnectionConfig, path: string) {
  return invoke<SavedLocalFile>("fs_download_for_preview", { config, path });
}
