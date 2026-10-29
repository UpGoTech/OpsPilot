import type { AgentActivity } from "../types";

/** Map Hermes tool names to short, plain-language activity copy. */
const LABELS: Record<string, string> = {
  skill_view: "Looking up a skill",
  skill_list: "Listing available skills",
  thinking: "Thinking",
  terminal: "Running a command",
  bash: "Running a command",
  shell: "Running a command",
  execute: "Running a command",
  execute_code: "Running code",
  code_execution: "Running code",
  file: "Working with files",
  read_file: "Reading a file",
  write_file: "Writing a file",
  edit_file: "Editing a file",
  list_dir: "Browsing folders",
  list_files: "Browsing folders",
  search: "Searching",
  search_files: "Searching files",
  web: "Searching the web",
  web_search: "Searching the web",
  web_extract: "Reading a web page",
  browser: "Using the browser",
  crawl: "Reading a web page",
  memory: "Checking memory",
  todo: "Updating the task list",
  clarify: "Asking a clarifying question",
  image_gen: "Generating an image",
  vision: "Looking at an image",
  vision_analyze: "Looking at an image",
  github_readonly: "Checking GitHub",
  delegation: "Delegating work",
  delegate_task: "Delegating work",
  session_search: "Searching past chats",
  session_search_recall: "Searching past chats",
};

type RunCategory = "edit" | "explore" | "run" | "delegate" | "other" | "think";

const CATEGORY_ORDER: RunCategory[] = [
  "think",
  "edit",
  "explore",
  "run",
  "delegate",
  "other",
];

const CATEGORY_COPY: Record<
  RunCategory,
  { noun: [string, string]; past: string; present: string }
> = {
  think: { noun: ["thought", "thoughts"], past: "Thought", present: "Thinking" },
  edit: { noun: ["file", "files"], past: "Edited", present: "Editing" },
  explore: { noun: ["file", "files"], past: "Explored", present: "Exploring" },
  run: { noun: ["command", "commands"], past: "Ran", present: "Running" },
  delegate: { noun: ["task", "tasks"], past: "Delegated", present: "Delegating" },
  other: { noun: ["step", "steps"], past: "Used", present: "Working" },
};

const EXPLORE = new Set([
  "list_files",
  "list_dir",
  "read_file",
  "search_files",
  "search",
  "session_search",
  "session_search_recall",
  "vision_analyze",
  "vision",
  "web_extract",
  "web_search",
  "web",
  "crawl",
  "browser",
  "skill_view",
  "skill_list",
  "file",
]);

const EDIT = new Set(["write_file", "edit_file"]);
const RUN = new Set([
  "terminal",
  "bash",
  "shell",
  "execute",
  "execute_code",
  "code_execution",
]);
const DELEGATE = new Set(["delegation", "delegate_task"]);

function humanize(name: string): string {
  const cleaned = name.replace(/[_-]+/g, " ").trim();
  if (!cleaned) return "Working";
  return cleaned.charAt(0).toUpperCase() + cleaned.slice(1);
}

export function activityLabel(toolName: string | undefined | null): string {
  if (!toolName) return "Working";
  const key = toolName.trim().toLowerCase();
  return LABELS[key] ?? humanize(key);
}

export function summarizeDetail(raw: unknown): string | undefined {
  if (raw == null) return undefined;
  if (typeof raw === "string") {
    const t = raw.trim();
    if (!t || /^Running tool/i.test(t)) return undefined;
    return t.length > 160 ? `${t.slice(0, 157)}…` : t;
  }
  if (typeof raw === "object") {
    const obj = raw as Record<string, unknown>;
    for (const key of [
      "summary",
      "path",
      "query",
      "command",
      "name",
      "skill",
      "file",
      "filepath",
      "url",
    ]) {
      const v = obj[key];
      if (typeof v === "string" && v.trim()) {
        return summarizeDetail(v);
      }
    }
  }
  return undefined;
}

function categoryOf(toolName: string): RunCategory {
  const key = toolName.trim().toLowerCase();
  if (key === "thinking") return "think";
  if (EDIT.has(key)) return "edit";
  if (RUN.has(key)) return "run";
  if (DELEGATE.has(key)) return "delegate";
  if (EXPLORE.has(key) || key.startsWith("browser_")) return "explore";
  return "other";
}

function lowerFirst(text: string): string {
  return text.charAt(0).toLowerCase() + text.slice(1);
}

/**
 * Desktop-style one-line stand-in for a tool run:
 * live → "Exploring foo.ts, running 2 commands"
 * settled → "Explored 3 files, ran 2 commands"
 */
export function summarizeToolRun(
  steps: readonly AgentActivity[],
  live: boolean,
): string {
  if (!steps.length) return live ? "Working…" : "Done";

  const narrating = live
    ? (steps.find((s) => s.status === "running") ?? steps[steps.length - 1])
    : undefined;
  const liveCategory = narrating ? categoryOf(narrating.toolName) : null;

  const byCategory = new Map<RunCategory, AgentActivity[]>();
  for (const step of steps) {
    const cat = categoryOf(step.toolName);
    const group = byCategory.get(cat);
    if (group) group.push(step);
    else byCategory.set(cat, [step]);
  }

  const clauses = CATEGORY_ORDER.flatMap((cat) => {
    const group = byCategory.get(cat);
    if (!group) return [];
    const copy = CATEGORY_COPY[cat];
    const verb = cat === liveCategory ? copy.present : copy.past;

    if (cat === "think") {
      return [cat === liveCategory ? "Thinking" : "Thought"];
    }

    // Desktop often names the first command: "Ran code from foo + 7 commands"
    if (cat === "run") {
      const firstDetail = group.find((s) => s.detail)?.detail;
      if (firstDetail && group.length > 1) {
        const rest = group.length - 1;
        return [
          `${verb} ${firstDetail} + ${rest} ${copy.noun[rest === 1 ? 0 : 1]}`,
        ];
      }
      if (firstDetail && (live || group.length === 1)) {
        return [`${verb} ${firstDetail}`];
      }
    }

    if (group.length === 1 && group[0].detail) {
      return [`${verb} ${group[0].detail}`];
    }
    return [
      `${verb} ${group.length} ${copy.noun[group.length === 1 ? 0 : 1]}`,
    ];
  });

  return clauses.map((t, i) => (i === 0 ? t : lowerFirst(t))).join(", ");
}
