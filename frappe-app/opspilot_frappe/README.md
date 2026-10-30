# opspilot_frappe

Frappe / ERPNext app that stores per-user Hermes gateway settings for [OpsPilot](../../).

## Install

```bash
cd ~/frappe-bench
bench get-app /path/to/OpsPilot/frappe-app/opspilot_frappe
bench --site <site> install-app opspilot_frappe
bench --site <site> migrate
```

## Usage

1. Open **OpsPilot Settings** in Desk.
2. Create one document per User (name = User id).
3. Set Hermes `gateway_url`, auth mode, and credentials.
4. OpsPilot logs into this site and calls `opspilot_frappe.api.get_my_opspilot_settings`.

## API

`GET /api/method/opspilot_frappe.api.get_my_opspilot_settings`

Requires a logged-in session (`sid`). Returns the caller's own settings, including
decrypted Password fields. Guest and cross-user access are rejected.
