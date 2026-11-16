# OpsPilot

Desktop AI client for ERPNext users. Sign in to your site; per-user AI settings live in ERPNext.

See [`AGENTS.md`](./AGENTS.md), [`spec/v1.md`](./spec/v1.md), and [`spec/erpnext-integration.md`](./spec/erpnext-integration.md).

## Features

- Chat with streaming responses
- Sessions list / create / resume
- Center tabs: HTML/PDF artifacts + nested browser
- ERPNext login gate; AI credentials from per-user `OpsPilot Settings`

## Prerequisites

- Node 20+
- Rust toolchain (for Tauri)
- An ERPNext / Frappe site with the [`opspilot_frappe`](./frappe-app/opspilot_frappe) app installed
- A reachable AI gateway configured in each user’s OpsPilot Settings

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

AI credentials are **not** entered in OpsPilot. They live per ERPNext user.

1. Install the Frappe app on your ERPNext site:

```bash
bench get-app https://github.com/UpGoTech/opspilot_frappe.git
bench --site <site> install-app opspilot_frappe
bench --site <site> migrate
```
2. In Desk, open **OpsPilot Settings** and create a document for each user (AI gateway URL + password or session token).
3. In OpsPilot **Settings**, save the ERPNext site URL (e.g. `https://erp.example.com` or `http://sitename.localhost` locally).
4. Sign in with your ERPNext username and password.
5. OpsPilot checks that the site supports OpsPilot, loads your settings, and connects.

If the app is missing: **This site does not support OpsPilot (…). Install the OpsPilot app on this site.**  

If the user has no settings: **This user is not permitted to use AI.**

The ERPNext session (`sid`) is kept in memory only — every app launch requires login again.
