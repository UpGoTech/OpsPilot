import { invoke } from "@tauri-apps/api/core";
import type { AuthProbe, ConnectionConfig } from "../types";

export function getConnection() {
  return invoke<ConnectionConfig>("get_connection");
}

export function saveConnection(config: ConnectionConfig) {
  return invoke<ConnectionConfig>("save_connection", { config });
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

export function gatewayConnect(config: ConnectionConfig) {
  return invoke<void>("gateway_connect", { config });
}

export function gatewayDisconnect() {
  return invoke<void>("gateway_disconnect");
}

export function gatewayRpc<T = unknown>(method: string, params?: unknown) {
  return invoke<T>("gateway_rpc", { method, params: params ?? null });
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
