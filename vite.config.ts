import { defineConfig } from "vite";
import vue from "@vitejs/plugin-vue";
import frappeui from "frappe-ui/vite";
import process from "node:process";

const host = process.env.TAURI_DEV_HOST;

export default defineConfig(() => ({
  plugins: [
    frappeui({
      frappeProxy: false,
      jinjaBootData: false,
      buildConfig: false,
      lucideIcons: true,
    }),
    vue(),
  ],
  clearScreen: false,
  server: {
    port: 1420,
    strictPort: true,
    host: host || false,
    hmr: host
      ? {
          protocol: "ws",
          host,
          port: 1421,
        }
      : undefined,
    watch: {
      ignored: ["**/src-tauri/**"],
    },
  },
}));
