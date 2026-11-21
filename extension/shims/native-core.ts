import { handleCommand } from "../native/commands";

/** Extension invoke — routes to `extension/native/commands.ts`. */
export async function invoke<T = unknown>(
  cmd: string,
  args?: Record<string, unknown>,
): Promise<T> {
  return handleCommand(cmd, args ?? {}) as Promise<T>;
}

/** Pass through blob/object URLs used for Chromium preview tabs. */
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
