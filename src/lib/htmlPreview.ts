/** Session key for a one-shot HTML preview payload. */
export function htmlPreviewStorageKey(id: string): string {
  return `opspilot.htmlPreview.${id}`;
}

export function newHtmlPreviewId(): string {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

function chromeRuntime(): {
  getURL: (path: string) => string;
  storage?: {
    session: {
      set: (items: Record<string, unknown>) => Promise<void>;
      remove: (keys: string | string[]) => Promise<void>;
    };
  };
} | null {
  try {
    const c = (
      globalThis as {
        chrome?: {
          runtime?: { id?: string; getURL: (path: string) => string };
          storage?: {
            session: {
              set: (items: Record<string, unknown>) => Promise<void>;
              remove: (keys: string | string[]) => Promise<void>;
            };
          };
        };
      }
    ).chrome;
    if (c?.runtime?.id && c.runtime.getURL) {
      return {
        getURL: (path) => c.runtime!.getURL(path),
        storage: c.storage,
      };
    }
  } catch {
    // not an extension
  }
  return null;
}

/** Extension URL for the MV3 sandbox page (inline scripts allowed). */
export function htmlPreviewSandboxUrl(): string | null {
  const runtime = chromeRuntime();
  return runtime ? runtime.getURL("html-preview-sandbox.html") : null;
}

/**
 * Stash HTML and return the bridge-tab URL. Scripts run inside the sandbox
 * iframe — blob: tabs inherit extension CSP and block inline JS.
 */
export async function prepareHtmlPreviewTabUrl(html: string): Promise<string> {
  const runtime = chromeRuntime();
  if (!runtime?.storage?.session) {
    throw new Error("HTML preview requires the OpsPilot extension");
  }
  const id = newHtmlPreviewId();
  const key = htmlPreviewStorageKey(id);
  await runtime.storage.session.set({ [key]: html });
  return runtime.getURL(`html-preview.html?id=${encodeURIComponent(id)}`);
}

export function postHtmlToPreviewFrame(
  frame: HTMLIFrameElement | null | undefined,
  html: string,
): boolean {
  if (!frame?.contentWindow || typeof html !== "string") return false;
  frame.contentWindow.postMessage(
    { type: "opspilot-html-preview", html },
    "*",
  );
  return true;
}
