import { build, defineConfig } from "vite";
import vue from "@vitejs/plugin-vue";
import frappeui from "frappe-ui/vite";
import { resolve } from "node:path";
import { copyFileSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";

const extensionDir = resolve(__dirname);
const outDir = resolve(extensionDir, "dist");

function copyExtensionAssets() {
  return {
    name: "copy-extension-assets",
    async closeBundle() {
      // Classic IIFE — MV3 content_scripts cannot load ES modules.
      await build({
        configFile: false,
        root: extensionDir,
        build: {
          outDir,
          emptyOutDir: false,
          sourcemap: true,
          lib: {
            entry: resolve(extensionDir, "content.ts"),
            formats: ["iife"],
            name: "OpsPilotContent",
            fileName: () => "content",
          },
          rollupOptions: {
            output: {
              entryFileNames: "content.js",
              extend: true,
            },
          },
        },
        logLevel: "warn",
      });

      mkdirSync(resolve(outDir, "icons"), { recursive: true });
      const manifest = JSON.parse(
        readFileSync(resolve(extensionDir, "manifest.json"), "utf8"),
      ) as Record<string, unknown>;
      writeFileSync(
        resolve(outDir, "manifest.json"),
        JSON.stringify(manifest, null, 2),
      );

      // Static extension pages (not hashed).
      for (const name of [
        "html-preview.html",
        "html-preview.js",
        "html-preview-sandbox.html",
        "unavailable-popup.html",
        "unavailable-popup.css",
        "unavailable-popup.js",
      ]) {
        copyFileSync(resolve(extensionDir, name), resolve(outDir, name));
      }

      for (const size of [16, 32, 48, 128]) {
        copyFileSync(
          resolve(extensionDir, `icons/icon-${size}.png`),
          resolve(outDir, `icons/icon-${size}.png`),
        );
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
      "@opspilot/native-core": resolve(extensionDir, "shims/native-core.ts"),
      "@opspilot/native-events": resolve(extensionDir, "shims/native-events.ts"),
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
