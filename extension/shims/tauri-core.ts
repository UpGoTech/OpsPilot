import { handleCommand } from "../native/commands";

/** Chrome stand-in for `@tauri-apps/api/core` `invoke`. */
export async function invoke<T = unknown>(
  cmd: string,
  args?: Record<string, unknown>,
): Promise<T> {
  return handleCommand(cmd, args ?? {}) as Promise<T>;
}

/** Desktop uses asset:// for local PDF preview; Chrome uses blob/object URLs already. */
export function convertFileSrc(path: string): string {
  if (
    path.startsWith("blob:") ||
    path.startsWith("data:") ||
    path.startsWith("http://") ||
    path.startsWith("https://")
  ) {
    return path;
  }
  return path;
}
