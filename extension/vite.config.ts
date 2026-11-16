import { defineConfig } from "vite";
import vue from "@vitejs/plugin-vue";
import frappeui from "frappe-ui/vite";
import { resolve } from "node:path";
import { copyFileSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";

const root = resolve(__dirname, "..");
const extensionDir = resolve(__dirname);
const outDir = resolve(extensionDir, "dist");

function copyExtensionAssets() {
  return {
    name: "copy-extension-assets",
    closeBundle() {
      mkdirSync(resolve(outDir, "icons"), { recursive: true });
      const manifest = JSON.parse(
        readFileSync(resolve(extensionDir, "manifest.json"), "utf8"),
      ) as Record<string, unknown>;
      writeFileSync(
        resolve(outDir, "manifest.json"),
        JSON.stringify(manifest, null, 2),
      );

      const iconSrc = resolve(root, "public/icon.png");
      for (const size of [16, 32, 48, 128]) {
        // Reuse the app icon for all Chromium toolbar sizes in v2 scaffold.
        copyFileSync(iconSrc, resolve(outDir, `icons/icon-${size}.png`));
      }
    },
  };
}

export default defineConfig({
  root: extensionDir,
  base: "./",
  plugins: [
    frappeui({
      frappeProxy: false,
      jinjaBootData: false,
      buildConfig: false,
      lucideIcons: true,
    }),
    vue(),
    copyExtensionAssets(),
  ],
  resolve: {
    alias: {
      "@tauri-apps/api/core": resolve(extensionDir, "shims/tauri-core.ts"),
      "@tauri-apps/api/event": resolve(extensionDir, "shims/tauri-event.ts"),
      "@tauri-apps/plugin-dialog": resolve(extensionDir, "shims/dialog.ts"),
      "@tauri-apps/plugin-opener": resolve(extensionDir, "shims/opener.ts"),
    },
  },
  build: {
    outDir,
    emptyOutDir: true,
    sourcemap: true,
    rollupOptions: {
      input: {
        sidepanel: resolve(extensionDir, "sidepanel.html"),
        background: resolve(extensionDir, "background.ts"),
      },
      output: {
        entryFileNames: (chunk) =>
          chunk.name === "background" ? "background.js" : "assets/[name]-[hash].js",
        chunkFileNames: "assets/[name]-[hash].js",
        assetFileNames: "assets/[name]-[hash][extname]",
      },
    },
  },
  server: {
    port: 1422,
    strictPort: true,
  },
});
