export type GatewayState = "idle" | "connecting" | "open" | "closed" | "error";

/** Desktop remote auth choice: session token paste vs sign-in. */
export type AuthMode = "auto" | "token" | "password";

export interface ConnectionConfig {
  name?: string;
  url: string;
  token?: string;
  authMode?: AuthMode;
  username?: string;
  password?: string;
  cookies?: Record<string, string>;
  extraHeaders?: Record<string, string>;
}

export interface AuthProviderInfo {
  name: string;
  displayName: string;
  supportsPassword: boolean;
}

export interface AuthProbe {
  authRequired: boolean;
  authMode: AuthMode;
  providers: AuthProviderInfo[];
  signedIn: boolean;
  status: unknown;
  normalizedUrl: string;
}

export interface GatewayStateEvent {
  state: GatewayState;
  detail?: string | null;
}

/** Matches Hermes Desktop GatewayEvent (params of method:"event"). */
export interface GatewayEvent {
  type: string;
  session_id?: string | null;
  payload?: Record<string, unknown> | null;
  seq?: number | null;
}

export interface SessionSummary {
  /** Durable stored id used for list selection and session.resume. */
  id: string;
  /** Live runtime id after resume/create, when known. */
  liveId?: string;
  title?: string;
  updated_at?: string;
  created_at?: string;
  started_at?: number | string;
  preview?: string;
  source?: string;
  /** Backend durable pin flag when the gateway provides it. */
  pinned?: boolean;
  [key: string]: unknown;
}

export type ChatRole = "user" | "assistant" | "system" | "tool";

export interface ChatMessage {
  id: string;
  role: ChatRole;
  content: string;
  streaming?: boolean;
  toolName?: string;
  status?: string;
  /** Local object URLs for images shown in the user bubble (not gateway paths). */
  imagePreviews?: string[];
  /** Non-image filenames shown as chips in the user bubble. */
  fileLabels?: string[];
}

/** Pending / outbound attachment for Desktop remote attach RPCs. */
export interface PromptAttachment {
  id: string;
  kind: "image" | "file";
  name: string;
  mime: string;
  /** Raw base64 (no data: prefix). */
  contentBase64: string;
  /** Local blob URL for image thumbs (optional for files). */
  previewUrl?: string;
  byteLength: number;
}

/** @deprecated Use PromptAttachment */
export type PromptImageAttachment = PromptAttachment;

/** Ephemeral agent work (tools / thinking) — Desktop "scaffold", not a bubble. */
export interface AgentActivity {
  id: string;
  toolName: string;
  /** Plain-language label for non-experts. */
  label: string;
  detail?: string;
  /** Full-ish tool stdout / result for expand peek. */
  output?: string;
  outputBytes?: number;
  startedAt?: number;
  endedAt?: number;
  status: "running" | "done" | "error";
}

/** Desktop-style transcript chrome between prompt and reply. */
export type ScaffoldSegment =
  | {
      kind: "thought";
      id: string;
      text: string;
      live: boolean;
      seconds?: number;
    }
  | {
      kind: "tools";
      id: string;
      steps: AgentActivity[];
      live: boolean;
      summary: string;
      meta?: string;
    };

/** One user prompt + the work/reply that follows it (Desktop turn group). */
export interface ChatTurn {
  id: string;
  user: ChatMessage | null;
  activity: AgentActivity[];
  replies: ChatMessage[];
  running: boolean;
}

export interface FsEntry {
  name: string;
  path: string;
  type: "file" | "dir" | "directory" | string;
  size?: number;
}
