# OpsPilot Engineering Guide

OpsPilot is a **Manifest V3 Side Panel** for Chrome / Brave / Edge ([`extension/`](./extension/), [`spec/v2.md`](./spec/v2.md)). It talks to an already-running `hermes serve` / dashboard gateway the same way Hermes Desktop does in remote mode. It does **not** install, bundle, or manage a local Hermes runtime.

This repo is **extension-only**. The former Tauri desktop client lived under `version-01` / archived [`spec/archive/v1-tauri.md`](./spec/archive/v1-tauri.md).

Product and implementation plans live under [`spec/`](./spec/). Read [`spec/v2.md`](./spec/v2.md) and [`spec/chat-parity.md`](./spec/chat-parity.md) before changing scope.

## What this app is

Four parties, each authoritative for one thing:

- **Extension native (TypeScript)** owns the machine: persisted ERPNext site URL, in-memory ERPNext `sid`, Frappe HTTP (via Desk tab RPC when needed), Hermes probes / `/api/fs`, and the WebSocket JSON-RPC dial. Networking stays in `extension/native/*` so proxied remotes work.
- **The Vue side panel** owns the experience: boot gate (site URL → Desk session → shell), navigation, presentation, and ephemeral interaction state.
- **ERPNext + `opspilot_frappe`** owns identity and per-user Hermes settings (DocType vault). See [`spec/erpnext-integration.md`](./spec/erpnext-integration.md).
- **The Hermes gateway** owns the work: sessions, tools, model calls, streaming events, and the remote workspace filesystem.

Keep the seams clean. The UI never reimplements agent behavior. Gateway truth is cached in Pinia stores; merge, don't clobber.

## Protocol (must match Hermes Desktop remote)

| Concern | Endpoint / method |
|---|---|
| Readiness | `GET {base}/api/status` |
| Chat / sessions | `wss://{host}{prefix}/api/ws?token=…` newline-delimited JSON-RPC |
| Files | `GET /api/fs/default-cwd`, `/api/fs/list`, `/api/fs/read-text`, `/api/fs/download` with session cookies (`credentials: "include"`) or `X-Hermes-Session-Token` |

Auth matches Hermes Desktop remote mode:

1. Probe `GET /api/status` (+ `/api/auth/providers` when `auth_required`).
2. **Password gateways** (`basic`): `POST /auth/password-login` → `hermes_session_*` cookies in the browser jar; REST uses `credentials: "include"` (+ gateway-tab fallback); WS remints `POST /api/auth/ws-ticket` then dials `/api/ws?ticket=…`.
3. **Token gateways** (no auth gate / legacy): `X-Hermes-Session-Token` + `/api/ws?token=…`.

Hermes credentials are **not** edited in OpsPilot. After Desk session adopt, native fetches the signed-in user’s `OpsPilot Settings` DocType and maps it onto `ConnectionConfig`.

Core RPCs: `ping`, `session.create`, `session.list`, `session.activate`, `session.history`, `session.title`, `prompt.submit`, `session.interrupt`.

## Stack

- Chromium MV3 Side Panel + service worker
- Vue 3 + Vite + TypeScript + Pinia (shared `src/` + `extension/sidepanel/`)
- [frappe-ui](https://ui.frappe.io/) for shell primitives
- Multi-site: side panel enables only on tabs where `opspilot_frappe.api.ping` succeeds (see [`spec/multi-site.md`](./spec/multi-site.md)). Per-hostname Hermes sockets, Desk sessions, and chat/session caches. ERPNext `sid` stays memory/`storage.session` only (Desk cookie adopt).
- Companion Frappe app: [`frappe-app/opspilot_frappe`](./frappe-app/opspilot_frappe)

## UI contract

- Chat-only side panel (no center workspace / nested browser).
- Boot: focused OpsPilot Desk tab → Desk browser session → shell (optional site URL override in settings).
- Artifacts: Preview opens a new tab; Download uses Chromium Save As. No Cloudflare tunnels for file sharing — client policy steers Hermes to workspace paths.
- Flat, not boxed. Group with whitespace and hairlines.
- Distinct empty / loading / reconnecting / error states.
- Never steal focus or navigate because a background gateway event arrived.
- Header **Refresh** reloads session history and remounts artifact extractors.

## State rules

- ERPNext site URL lives in extension storage; ERPNext `sid` lives in memory only.
- Hermes `ConnectionConfig` is derived from ERPNext after login; the renderer holds a cache.
- Sessions, messages, and file listings are gateway-authoritative caches.
- A stale async result must not overwrite newer user intent.

## Scope

In: chat, sessions (history + pin/delete), artifact cards (preview tab + Save As), export transcript, ERPNext URL settings + Desk gate, Hermes connect via per-user DocType, interactive prompts (approval / clarify / sudo / secret / vault), transcript refresh.

Out: Tauri/desktop shell, left workspace file tree, local Hermes bootstrap, OAuth, voice, terminal, file write/delete, editing Hermes credentials inside OpsPilot, persisting ERPNext `sid`, public tunnels for file share.

Multi-site Hermes profiles (per Desk hostname) are in scope — see [`spec/multi-site.md`](./spec/multi-site.md).

## Taste test before handoff

- Does every piece of state live with its authority?
- Does connection / WS / FS routing still agree with Desktop remote mode?
- Does async failure leave a usable UI?
- Did you update `spec/` if product scope changed?

## Implementation Guidelines

* Create a new branch before working on a new feature/spec (branch name patterns: feat/, fix/)
* Never commit directly to `develop` — open a PR against `develop`
* Reconcile the spec and log the progress after each phase of development
* Commit after each meaningful phase
* Commit the spec before the development commits
* Use comments only when necessary to explain "why?" not "how?"

## Frontend / Backend Sync

* Whenever a new field is added to a backend DocType that is surfaced in the frontend, it must also be handled in the corresponding frontend component.

## Regression tests

* When we fix a bug, add at the very least a Unit test, and verify before/after by temp revert of fix
* CI: GitHub Actions workflow `.github/workflows/ci.yml` runs on every PR to `develop`

## Pull Requests

* Raise PR always against the develop branch
* Wait for CI (`CI / Success`) to pass before merging
* Keep pull request descriptions stupid simple

## Branch protection

* `develop` is protected: PRs required, CI must pass, no direct pushes
* Use `feat/` or `fix/` branches for all work
