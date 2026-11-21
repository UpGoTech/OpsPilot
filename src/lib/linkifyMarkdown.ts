/**
 * Turn URL-only code spans / fences into markdown links so marked emits <a>.
 * Bare prose URLs are left to marked's GFM autolink.
 */
export function linkifyMarkdown(source: string): string {
  if (!source) return source;

  const saved: string[] = [];
  const protect = (match: string) => {
    const i = saved.length;
    saved.push(match);
    return `\u0000MDLINK${i}\u0000`;
  };

  // Keep real markdown links intact through the rewrite.
  let next = source.replace(/\[[^\]]*\]\([^)]+\)/g, protect);

  // ```\nhttps://…\n```  (optionally with a language tag)
  next = next.replace(
    /```[^\n]*\n\s*((?:https?:\/\/)[^\s`]+)\s*\n```/gim,
    (_m, url: string) => {
      const clean = String(url).replace(/[.,;:!?]+$/, "");
      return `[${clean}](${clean})`;
    },
  );

  // `https://…` inline code that is only a URL
  next = next.replace(/`((?:https?:\/\/)[^`\s]+)`/gim, (_m, url: string) => {
    const clean = String(url).replace(/[.,;:!?]+$/, "");
    return `[${clean}](${clean})`;
  });

  next = next.replace(/\u0000MDLINK(\d+)\u0000/g, (_m, i: string) => {
    return saved[Number(i)] ?? "";
  });

  return next;
}
