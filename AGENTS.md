# OpsPilot Engineering Guide

OpsPilot is a **Tauri 2** remote-only desktop client for [Hermes Agent](https://github.com/nousresearch/hermes-agent). It talks to an already-running `hermes serve` / dashboard gateway the same way Hermes Desktop does in remote mode. It does **not** install, bundle, or manage a local Hermes runtime.

Product and implementation plans live under [`spec/`](./spec/). Read [`spec/v1.md`](./spec/v1.md) before changing scope.

## What this app is

Three parties, each authoritative for one thing:

- **Tauri (Rust)** owns the machine: persisted connection config, HTTP probes, remote `/api/fs` calls, and the WebSocket JSON-RPC dial to the gateway. Native networking stays in Rust so proxied remotes work (same lesson as Desktop dialing WS from the main process).
- **The Vue renderer** owns the experience: navigation, presentation, and ephemeral interaction state.
- **The Hermes gateway** owns the work: sessions, tools, model calls, streaming events, and the remote workspace filesystem.

Keep the seams clean. The UI never reimplements agent behavior. Gateway truth is cached in Pinia stores; merge, don't clobber.

## Protocol (must match Hermes Desktop remote)

| Concern | Endpoint / method |
|---|---|
| Readiness | `GET {base}/api/status` |
| Chat / sessions | `wss://{host}{prefix}/api/ws?token=…` newline-delimited JSON-RPC |
| Files | `GET /api/fs/default-cwd`, `/api/fs/list`, `/api/fs/read-text` with `X-Hermes-Session-Token` |

Auth matches Hermes Desktop remote mode:

1. Probe `GET /api/status` (+ `/api/auth/providers` when `auth_required`).
2. **Password gateways** (`basic`): `POST /auth/password-login` → `hermes_session_*` cookies; REST sends `Cookie`; WS remints `POST /api/auth/ws-ticket` then dials `/api/ws?ticket=…`.
3. **Token gateways** (no auth gate / legacy): `X-Hermes-Session-Token` + `/api/ws?token=…`.

Settings mirrors Desktop’s single **Remote gateway → Save connection** form: name, URL, auth toggle (Session token | Sign in), and optional extra gateway headers. One connection only — no multi-connection registry. Persist cookies (not the password).

Core RPCs: `ping`, `session.create`, `session.list`, `session.activate`, `session.history`, `session.title`, `prompt.submit`, `session.interrupt`.

## Stack

- Tauri 2 + Rust
- Vue 3 + Vite + TypeScript + Pinia
- [frappe-ui](https://ui.frappe.io/) for shell primitives (Sidebar / rail / inputs / buttons)
- Persist connection as `{app_config_dir}/connection.json` (cookies yes, password no); keep the token out of plaintext logs

## UI contract

- Cursor-like shell: **Workspace** (left, toggleable files/browser switch), **center** (tabbed file/artifact preview + nested webview browser), **Agent** (right, resizable).
- App top bar: left panel toggle · centered **OpsPilot** · chat toggle + settings.
- Agent chrome: open session tabs (× to close) · + new · clock history (search/pin/groups) · ⋯ export · panel toggle.
- Flat, not boxed. Group with whitespace and hairlines; avoid nested cards and purple/glow defaults.
- Distinct empty / loading / reconnecting / error states with honest copy and a way forward.
- Never steal focus or navigate because a background gateway event arrived.

## State rules

- Connection config lives in Rust; the renderer holds a cache.
- Sessions, messages, and file listings are gateway-authoritative caches.
- Scope persisted keys clearly (`connection`, not ad-hoc locals).
- A stale async result must not overwrite newer user intent.

## v1 scope

In: chat, sessions (history + tabs + pin/delete), remote workspace file tree (read-only preview), center tabs (files + HTML/PDF artifacts + nested webview browser), export transcript, settings (gateway URL + token + test).

Out: local Hermes bootstrap, OAuth, multi-profile connections, voice, terminal, file write/delete, native spreadsheet preview.

## Taste test before handoff

- Does every piece of state live with its authority?
- Does connection / WS / FS routing still agree with Desktop remote mode?
- Does async failure leave a usable UI?
- Did you update `spec/` if product scope changed?

## Planning / Spec-ing

Use Tracer bullets comes from the Pragmatic Programmer. When building systems, you want to write code that gets you feedback as quickly as possible. Tracer bullets are small slices of functionality that go through all layers of the system, allowing you to test and validate your approach early. This helps in identifying potential issues and ensures that the overall architecture is sound before investing significant time in development.

## Implementation Guidelines

* Create a new branch before working on a new feature/spec (branch name patterns: feat/, fix/, just like conventional commit pre-fixes)
* Never commit directly to `develop` — open a PR against `develop`
* Reconcile the spec and log the progress after each phase of development
* Commit after each meaningful phase
* Commit the spec before the development commits
* Use comments only when necessary to explain "why?" not "how?", how must be clear from the code itself

## Frontend / Backend Sync

* Whenever a new field is added to a backend DocType that is surfaced in the frontend (e.g. settings panels), it must also be handled in the corresponding frontend component so the two stay in sync. This is a convention/reminder only — there is no automatic syncing mechanism; the frontend enumerates fields explicitly.

## Regression tests

* When we fix a bug, add at the very least a Unit test, and verify before/after by temp revert of fix to make sure the test tests what is intended
* CI: GitHub Actions workflow `.github/workflows/ci.yml` runs on every PR to `develop`

## Pull Requests

* Raise PR always against the develop branch
* Wait for CI (`CI / Success`) to pass before merging
* Keep pull request descriptions stupid simple
* Some formats:
    1. h2 Problem (1-2 sentences), h2 Solution: good for bugs, etc.
    2. h2 Why? h2 What? h2 How?: good for new features and enhancements

## Branch protection

* `develop` is protected: PRs required, CI must pass, no direct pushes
* Use `feat/` or `fix/` branches for all work