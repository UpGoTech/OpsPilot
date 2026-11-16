import type { ConnectionConfig } from "../../src/types";
import * as auth from "./auth";
import * as connection from "./connection";
import * as erpnext from "./erpnext";
import * as fs from "./fs";
import * as gateway from "./gateway";

/** Nested Tauri webviews are not available — open in a normal Chromium tab. */
const browserLabels = new Map<string, string>();

async function browserOpen(url: string) {
  if (chrome.tabs?.create) {
    await chrome.tabs.create({ url });
  } else {
    window.open(url, "_blank", "noopener,noreferrer");
  }
}

export async function handleCommand(
  cmd: string,
  args: Record<string, unknown>,
): Promise<unknown> {
  switch (cmd) {
    case "get_erpnext_config":
      return erpnext.loadConfig();
    case "save_erpnext_config":
      return erpnext.saveConfig(
        args.config as { siteUrl: string; lastUsername?: string },
      );
    case "get_erpnext_session":
      return erpnext.sessionInfo();
    case "erpnext_login":
      return erpnext.login(String(args.usr ?? ""), String(args.pwd ?? ""));
    case "erpnext_logout":
      return erpnext.logout();
    case "erpnext_adopt_browser_session":
      return erpnext.adoptBrowserSession();
    case "erpnext_probe_support":
      return erpnext.probeSupport();
    case "erpnext_fetch_opspilot_settings":
      return erpnext.fetchOpspilotSettings();

    case "get_connection":
      return connection.loadConnection();
    case "save_connection":
      return connection.saveConnection(args.config as ConnectionConfig);
    case "probe_auth":
      return auth.probeAuth(args.config as ConnectionConfig);
    case "password_login": {
      const signedIn = await auth.passwordLogin(args.config as ConnectionConfig);
      await connection.saveConnection(signedIn);
      return signedIn;
    }
    case "test_connection":
      return fs.testConnection(args.config as ConnectionConfig);
    case "gateway_connect": {
      const config = args.config as ConnectionConfig;
      await connection.saveConnection(config);
      await gateway.gatewayConnect(config);
      return null;
    }
    case "gateway_disconnect":
      await gateway.gatewayDisconnect();
      return null;
    case "gateway_rpc":
      return gateway.gatewayRpc(
        String(args.method ?? ""),
        args.params ?? null,
      );

    case "fs_default_cwd":
      return fs.defaultCwd(args.config as ConnectionConfig);
    case "fs_list":
      return fs.listPath(args.config as ConnectionConfig, String(args.path ?? ""));
    case "fs_read_text":
      return fs.readText(
        args.config as ConnectionConfig,
        String(args.path ?? ""),
      );
    case "fs_download":
      return fs.downloadFile(
        args.config as ConnectionConfig,
        String(args.path ?? ""),
      );
    case "fs_download_to_downloads":
      return fs.downloadToDownloads(
        args.config as ConnectionConfig,
        String(args.path ?? ""),
      );
    case "fs_download_to_path":
      return fs.downloadToPath(
        args.config as ConnectionConfig,
        String(args.path ?? ""),
        String(args.dest ?? ""),
      );
    case "fs_download_for_preview":
      return fs.downloadForPreview(
        args.config as ConnectionConfig,
        String(args.path ?? ""),
      );

    case "browser_create": {
      const label = String(args.label ?? "");
      const url = args.url ? String(args.url) : "about:blank";
      browserLabels.set(label, url);
      return null;
    }
    case "browser_set_bounds":
    case "browser_show":
    case "browser_hide":
    case "browser_hide_all":
    case "browser_reload":
    case "browser_back":
    case "browser_forward":
    case "browser_destroy":
      return null;
    case "browser_navigate": {
      const label = String(args.label ?? "");
      const url = String(args.url ?? "");
      browserLabels.set(label, url);
      await browserOpen(url);
      return url;
    }
    case "browser_current_url":
      return browserLabels.get(String(args.label ?? "")) ?? "";

    default:
      throw new Error(`Unknown command in Chromium extension: ${cmd}`);
  }
}
