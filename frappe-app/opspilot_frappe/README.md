# opspilot_frappe

Frappe / ERPNext app that stores per-user AI gateway settings for [OpsPilot](../../).

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
3. Set AI `gateway_url`, auth mode, and credentials.
4. OpsPilot logs into this site, calls `opspilot_frappe.api.ping`, then `get_my_opspilot_settings`.

## API

- `GET /api/method/opspilot_frappe.api.ping` — confirms the site supports OpsPilot
- `GET /api/method/opspilot_frappe.api.get_my_opspilot_settings` — caller’s AI settings (Password fields decrypted)

Requires a logged-in session (`sid`). Guest and cross-user access are rejected.
No settings row → OpsPilot shows “This user is not permitted to use AI.”
