# OpsPilot

Remote-only Tauri 2 desktop client for [Hermes Agent](https://github.com/nousresearch/hermes-agent). Speaks the same gateway protocol Hermes Desktop uses in remote mode: WebSocket JSON-RPC at `/api/ws` plus REST `/api/fs/*`.

See [`AGENTS.md`](./AGENTS.md) and [`spec/v1.md`](./spec/v1.md).

## Features (v1)

- Chat with streaming responses
- Sessions list / create / resume
- Center tabs: HTML/PDF artifacts + nested browser
- ERPNext login gate; Hermes credentials from per-user `OpsPilot Settings` DocType

## Prerequisites

- Node 20+
- Rust toolchain (for Tauri)
- An ERPNext / Frappe site with the [`opspilot_frappe`](./frappe-app/opspilot_frappe) app installed
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

Hermes credentials are **not** entered in OpsPilot. They live per ERPNext user.

1. Install [`frappe-app/opspilot_frappe`](./frappe-app/opspilot_frappe) on your ERPNext site (`bench get-app` + `install-app` + `migrate`).
2. In Desk, open **OpsPilot Settings** and create a document for each user (Hermes URL + password or session token).
3. In OpsPilot **Settings**, save the ERPNext site URL (e.g. `https://erp.example.com`).
4. Sign in with your ERPNext username and password.
5. OpsPilot loads your DocType settings and connects to Hermes.

The ERPNext session (`sid`) is kept in memory only — every app launch requires login again. See [`spec/erpnext-integration.md`](./spec/erpnext-integration.md).
