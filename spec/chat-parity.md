# OpsPilot ↔ Hermes Desktop — Chat parity

Authority for chat behavior is **Hermes Desktop** (`~/.hermes/hermes-agent/apps/desktop` + `apps/shared`). OpsPilot must match that chat surface over the same gateway wire. The **only intentional divergences** are how previews, downloads, and Desk links are handled in OpsPilot (especially the Chromium side panel).

## OpsPilot-only handling (do not copy Desktop)

| Concern | Desktop | OpsPilot |
|---|---|---|
| HTML/PDF preview | Center rail / nested preview | **New browser tab** via MV3 **sandbox** page (`html-preview.html` → sandbox iframe) so inline scripts run (blob: tabs inherit extension CSP and show empty shells); relative sibling CSS/JS/JSON still **bundled** before open |
| Download / Save As | Native dialog + FS write | **Chromium Save As** (`chrome.downloads` + `saveAs: true`) via authenticated `/api/fs` |
| Public tunnels | Agent may open cloudflared | **Forbidden** — client policy + UI strip of trycloudflare/ngrok links |
| Workspace / nested browser | Center tabs | **None** — chat-only side panel |
| Desk deep links | Preview / external open | Navigate the **focused OpsPilot Desk tab** (or open one) |
| ERPNext identity | N/A in Hermes Desktop | Desk session + site gate |
| Transcript refresh | N/A | Header refresh reloads history + remounts artifact extractors |

Everything else in this doc is **parity target**.

## Desktop inventory → OpsPilot status

### A. Transcript & rendering

| Feature | Status |
|---|---|
| User / assistant / system turns | Done |
| Streaming `message.start/delta/interim/complete` | Done |
| Thinking / reasoning deltas → scaffold | Done |
| Markdown body | Done (simpler than Desktop Streamdown/embeds) |
| Copy reply | Done |
| Auto-scroll | Done |
| Tool activity scaffold | Done |
| Reactions / MoA / vibe hearts / KaTeX / social embeds | Out of OpsPilot v2 scope (document only) |
| Virtualized transcript window | Out (narrow panel; full list OK) |

### B. Interactive server→client prompts (critical — agent blocks)

| Method | Desktop UI | OpsPilot |
|---|---|---|
| `approval` | Once / Session / Always / Deny | **Done** |
| `clarify` | Multi-question card + `clarify.lock` | **Done** |
| `setup_choose` | Setup pickers | **Done** (clarify-like card) |
| `sudo` / `display.install.sudo` | Password modal | **Done** (`{value}`) |
| `secret` | Secret modal | **Done** |
| `vault.unlock_prompt` / `vault.save_login` / `vault.code` | Vault modals | **Done** (minimal cards) |
| `preview.act` / `preview.read` / `terminal.read` / `window.read` / `tour` | Desktop surfaces | **Done** (empty `{value:""}`) |
| Unknown methods | JSON-RPC error | **Done** (`-32601` via `gateway_fail`) |

Cancel: `request.cancel`, `approval.cancelled` — Done for approvals; extend to all parked prompts.

### C. Composer

| Feature | Status |
|---|---|
| Send / Stop (interrupt) | Done |
| Image + file attachments | Done |
| `/clear` local + server | Done |
| `/new`, `/stop` local | **Done** |
| Queue / steer / redirect | Phase later |
| Slash catalog / @ path complete | Phase later |
| Voice / wake / TTS | Out |
| Model picker | Out (show static “Automatic” OK) |

### D. Sessions

| Feature | Status |
|---|---|
| List / create / resume / pin / delete | Done |
| History search + groups | Done |
| Session tabs (desktop chrome) | Done on Tauri; history overlay on extension |
| `session.title` live updates | **Done** |
| Branch / archive / export JSON | Phase later (MD export Done) |

### E. Gateway events

| Event | Status |
|---|---|
| message / thinking / tool / error | Done |
| `status.update` | **Done** (status line under live turn) |
| `request.cancel` / `approval.cancelled` | Done (approvals); extend |
| `session.title` | **Required** |
| `todo.updated` / subagent.* / connection.* | Phase later |
| Auto-reconnect after WS drop | **Done** (backoff remint + redial) |

### F. Artifacts

| Feature | Status |
|---|---|
| Extract PDF/HTML/files + cards | Done (PDF + HTML/htm + other exts mine tool logs for workspace paths) |
| OpsPilot preview/download behavior | Done (tabs + Save As) |
| Multi-file HTML (sibling JSON/JS/CSS) | Done — `bundleWorkspaceHtmlForPreview` inlines relatives before blob open |
| Desktop center workspace | N/A for extension; keep on Tauri |

## Implementation phases

| Phase | Scope | Status |
|---|---|---|
| **P0** | Approvals + never-drop server requests + clarify/sudo/secret/vault minimal + status.update + title + `/new`/`/stop` + reconnect + extension new-chat/export fixes | **Done** |
| **P1** | Steer/queue, richer markdown, session title rename UI, connection consent cards | Planned |
| **P2** | Subagents, YOLO, compression UI, BTW/background, voice | Planned / optional |

## Progress log

### 2026-11-17
- Stale session recovery: if a session is deleted/cleared in another Hermes client, OpsPilot no longer binds the dead id as active
- `sessions.refresh` / `withLiveSession` / `openSession` drop ghost ids; tab restore fallbacks run again (openSession rethrows)
- New chat uses `tabs.newTabSession` with surfaced errors; WS disconnect clears `sending` so the composer unlocks

### 2026-11-16
- Documented Desktop chat inventory vs OpsPilot
- Locked OpsPilot-only preview/download/Desk-link exceptions
- P0 shipped: clarify/setup_choose/sudo/secret/vault cards; never-drop (`gateway_fail` / empty surface answers); `status.update` + `session.title`; `/new` `/stop`; gateway reconnect backoff; SideChat new-chat + export fixes
- FS download 401 fixed (`credentials: include` + gateway-tab fallback); no-tunnel policy + UI; transcript refresh; Tauri removed (extension-only)
