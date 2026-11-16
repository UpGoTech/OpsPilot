/** Open a URL in a normal Chrome tab. */
export async function openUrl(url: string): Promise<void> {
  await chrome.tabs.create({ url });
}

/** No Finder reveal in Chrome — downloads land in the browser Downloads UI. */
export async function revealItemInDir(_path: string): Promise<void> {
  // no-op
}
