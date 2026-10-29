/**
 * Hide remote gateway filesystem paths in chat prose.
 * Download cards / filename labels stay; /opt/… never ships to the bubble.
 */

const SERVER_ROOT = String.raw`\/(?:opt|home|tmp|var|Users|root|data)`;
const FILE_EXT = String.raw`pdf|zip|rar|7z|xls|xlsx|xlsm|csv|doc|docx|ppt|pptx|txt|md|rtf|png|jpe?g|gif|webp|bmp|html?|json|xml|yaml|yml|py|js|ts|sh|log`;

const PATH_CORE = String.raw`${SERVER_ROOT}\/[^\s)\]>"'\`]+?\.(?:${FILE_EXT})`;

function filenameOf(path: string): string {
  return path.split(/[/\\]/).pop() || path;
}

/** Fresh regex each call — avoid sticky lastIndex on module-level /g patterns. */
function pathAnywhereRe() {
  return new RegExp(
    String.raw`(?:sandbox:|file:\/\/|MEDIA:)?\`?(${PATH_CORE})\`?`,
    "gi",
  );
}

function mdLinkToPathRe() {
  return new RegExp(
    String.raw`\[[^\]]*\]\((?:sandbox:|file:\/\/|MEDIA:)?\`?(${PATH_CORE})\`?\)`,
    "gi",
  );
}

function leadInPhraseRe() {
  return new RegExp(
    String.raw`(?:^|[\n.!?])\s*(?:Created(?:\s+and\s+verified)?(?:\s+the)?(?:\s+\w+\s+file)?|The verified (?:\w+\s+)?download is available|Here(?:'s| is)(?:\s+the)?(?:\s+\w+)?|File\s*path|Saved\s*(?:to|as)|Download(?:\s+the)?(?:\s+\w+)?(?:\s+here)?(?:\s+at)?|You can (?:download|find) (?:it|the file)(?:\s+at|here)?)\s*[:：]?\s*`,
    "gi",
  );
}

/** Replace gateway paths with nothing (chat body) or the filename (tool logs). */
export function scrubServerPaths(
  source: string,
  mode: "remove" | "filename" = "remove",
): string {
  if (!source) return source;
  let next = source;

  next = next.replace(mdLinkToPathRe(), (_m, path: string) =>
    mode === "filename" ? filenameOf(path) : "",
  );
  next = next.replace(pathAnywhereRe(), (_m, path: string) =>
    mode === "filename" ? filenameOf(path) : "",
  );

  if (mode === "remove") {
    next = next.replace(leadInPhraseRe(), (match) => {
      const lead = match[0];
      if (lead === "." || lead === "!" || lead === "?") return `${lead}\n`;
      return "\n";
    });
    next = next.replace(/(?:^|\n)[ \t]*[:：][ \t]*(?=\n|$)/g, "\n");
    next = next.replace(/\bPath\(\s*['"]?\s*['"]?\s*\)/g, "");
  }

  return next.replace(/[ \t]+\n/g, "\n").replace(/\n{3,}/g, "\n\n").trim();
}
