/** Chrome stand-in for `@tauri-apps/plugin-dialog` `save` — returns a suggested filename. */
export async function save(options?: {
  defaultPath?: string;
  filters?: { name: string; extensions: string[] }[];
}): Promise<string | null> {
  return options?.defaultPath ?? "download";
}
