import { defineStore } from "pinia";
import { ref } from "vue";
import { fsDefaultCwd, fsList, fsReadText } from "../lib/tauri";
import { useGatewayStore } from "./gateway";
import type { FsEntry } from "../types";

function asEntries(raw: unknown, parent: string): FsEntry[] {
  const list = Array.isArray(raw)
    ? raw
    : raw && typeof raw === "object"
      ? ((raw as Record<string, unknown>).entries ??
        (raw as Record<string, unknown>).items ??
        (raw as Record<string, unknown>).files)
      : null;
  if (!Array.isArray(list)) return [];

  return list
    .map((item): FsEntry | null => {
      if (typeof item === "string") {
        const name = item.split("/").filter(Boolean).pop() || item;
        return { name, path: item.startsWith("/") ? item : `${parent}/${item}`, type: "file" };
      }
      if (!item || typeof item !== "object") return null;
      const row = item as Record<string, unknown>;
      const name = String(row.name ?? row.basename ?? "");
      if (!name) return null;
      const path = String(row.path ?? `${parent.replace(/\/$/, "")}/${name}`);
      const type = String(row.type ?? row.kind ?? (row.is_dir ? "dir" : "file"));
      return {
        name,
        path,
        type,
        size: typeof row.size === "number" ? row.size : undefined,
      };
    })
    .filter(Boolean) as FsEntry[];
}

export const useFilesStore = defineStore("files", () => {
  const rootPath = ref<string | null>(null);
  const children = ref<Record<string, FsEntry[]>>({});
  const expanded = ref<Record<string, boolean>>({});
  const selectedPath = ref<string | null>(null);
  const preview = ref<string>("");
  const loading = ref(false);
  const previewLoading = ref(false);
  const error = ref<string | null>(null);

  async function bootstrap() {
    const gateway = useGatewayStore();
    loading.value = true;
    error.value = null;
    try {
      const raw = await fsDefaultCwd(gateway.connection);
      const cwd =
        typeof raw === "string"
          ? raw
          : raw && typeof raw === "object"
            ? String((raw as Record<string, unknown>).cwd ?? (raw as Record<string, unknown>).path ?? "")
            : "";
      if (!cwd) throw new Error("No default workspace path from gateway");
      rootPath.value = cwd;
      expanded.value = { [cwd]: true };
      await loadDir(cwd);
    } catch (err) {
      error.value = err instanceof Error ? err.message : String(err);
    } finally {
      loading.value = false;
    }
  }

  async function loadDir(path: string) {
    const gateway = useGatewayStore();
    const raw = await fsList(gateway.connection, path);
    children.value = { ...children.value, [path]: asEntries(raw, path) };
  }

  async function toggle(path: string) {
    const next = !expanded.value[path];
    expanded.value = { ...expanded.value, [path]: next };
    if (next && !children.value[path]) {
      await loadDir(path);
    }
  }

  async function openFile(path: string) {
    const gateway = useGatewayStore();
    selectedPath.value = path;
    previewLoading.value = true;
    preview.value = "";
    error.value = null;
    const lower = path.toLowerCase();
    const binary =
      /\.(xlsx|xls|xlsm|pdf|png|jpe?g|gif|webp|zip|docx?|pptx?)$/i.test(lower);
    if (binary) {
      preview.value =
        "This is a binary file. Use Download from the chat link to save it locally — text preview isn’t available.";
      previewLoading.value = false;
      return;
    }
    try {
      const raw = await fsReadText(gateway.connection, path);
      if (typeof raw === "string") {
        preview.value = raw;
      } else if (raw && typeof raw === "object") {
        const obj = raw as Record<string, unknown>;
        preview.value = String(obj.content ?? obj.text ?? obj.data ?? JSON.stringify(raw, null, 2));
      } else {
        preview.value = String(raw ?? "");
      }
    } catch (err) {
      error.value = err instanceof Error ? err.message : String(err);
      preview.value = "";
    } finally {
      previewLoading.value = false;
    }
  }

  /** Reveal a remote path in the Files tree (expand parents + select). */
  async function openPath(path: string) {
    if (!rootPath.value) {
      await bootstrap();
    }
    const parts = path.split("/").filter(Boolean);
    let current = "";
    for (let i = 0; i < parts.length - 1; i++) {
      current += `/${parts[i]}`;
      expanded.value = { ...expanded.value, [current]: true };
      if (!children.value[current]) {
        try {
          await loadDir(current);
        } catch {
          // keep walking
        }
      }
    }
    const { useCenterTabsStore } = await import("./centerTabs");
    await useCenterTabsStore().openFileTab(path);
  }

  function isDir(entry: FsEntry) {
    return entry.type === "dir" || entry.type === "directory" || entry.type === "folder";
  }

  return {
    rootPath,
    children,
    expanded,
    selectedPath,
    preview,
    loading,
    previewLoading,
    error,
    bootstrap,
    loadDir,
    toggle,
    openFile,
    openPath,
    isDir,
  };
});
