# OpsPilot

Chromium **side panel** AI client for ERPNext users. Sign in via your Desk session; per-user AI settings live in ERPNext.

See [`AGENTS.md`](./AGENTS.md), [`spec/v2.md`](./spec/v2.md), [`spec/chat-parity.md`](./spec/chat-parity.md), and [`spec/erpnext-integration.md`](./spec/erpnext-integration.md).

## Features

- Streaming chat (Hermes gateway remote protocol)
- Sessions list / create / resume / history
- Artifact Preview (new tab) and Download (Save As)
- Multi-site: side panel only on Desk tabs with `opspilot_frappe`; per-site Hermes sessions
- Desk session gate; AI credentials from per-user `OpsPilot Settings`
- Transcript refresh to reprocess artifact cards

## Prerequisites

- Node 20+
- An ERPNext / Frappe site with the [`opspilot_frappe`](./frappe-app/opspilot_frappe) app installed
- A reachable AI gateway configured in each user’s OpsPilot Settings

## Develop

```bash
npm install
npm run build
```

Load `extension/dist` as an unpacked extension (`chrome://extensions`, `brave://extensions`, or `edge://extensions`). See [`extension/README.md`](./extension/README.md).

```bash
npm run dev   # Vite on :1422 for side-panel HMR during development
```

## Connect

AI credentials are **not** entered in OpsPilot. They live per ERPNext user.

1. Install the Frappe app on your ERPNext site:

```bash
bench get-app https://github.com/UpGoTech/opspilot_frappe.git
bench --site <site> install-app opspilot_frappe
bench --site <site> migrate
```

2. In Desk, open **OpsPilot Settings** and create a document for each user (AI gateway URL + password or session token).
3. Open that Desk site in a browser tab — OpsPilot enables the side panel only there, adopts the Desk session, and connects to that site’s Hermes gateway.
4. Open another OpsPilot-enabled Desk site in a different tab to keep a separate chat/connection (see [`spec/multi-site.md`](./spec/multi-site.md)).
