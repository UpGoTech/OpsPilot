# OpsPilot

Remote-only Tauri 2 desktop client for [Hermes Agent](https://github.com/nousresearch/hermes-agent). Speaks the same gateway protocol Hermes Desktop uses in remote mode: WebSocket JSON-RPC at `/api/ws` plus REST `/api/fs/*`.

See [`AGENTS.md`](./AGENTS.md) and [`spec/v1.md`](./spec/v1.md).

## Features (v1)

- Chat with streaming responses
- Sessions list / create / resume
- Remote workspace file tree (read-only preview)
- Settings: gateway URL + username/password (Desktop-style), or legacy session token

## Prerequisites

- Node 20+
- Rust toolchain (for Tauri)
- A running Hermes backend: `hermes serve` (or dashboard) reachable over the network

## Develop

```bash
npm install
npm run tauri dev
```

## Build

```bash
npm run tauri build
```

## Connect

Same flow as Hermes Desktop:

1. Open **Settings**
2. Enter the gateway base URL (e.g. `https://hermes.example.com`)
3. OpsPilot probes `/api/status` — if the gateway uses username/password, enter those credentials
4. Click **Sign in & connect**

Password gateways use session cookies + a reminted WebSocket ticket. Legacy token-only gateways still accept a session token field.
