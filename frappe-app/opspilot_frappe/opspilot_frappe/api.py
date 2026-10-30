"""Whitelisted OpsPilot API for the desktop client."""

from __future__ import annotations

import json

import frappe
from frappe import _


@frappe.whitelist()
def get_my_opspilot_settings():
	"""Return the signed-in user's OpsPilot Settings, including Password fields.

	Password values are unavailable via /api/resource (masked as ******), so the
	desktop client must call this method after /api/method/login.
	"""
	user = frappe.session.user
	if not user or user == "Guest":
		frappe.throw(_("Not logged in"), frappe.AuthenticationError)

	name = user
	if not frappe.db.exists("OpsPilot Settings", name):
		return None

	doc = frappe.get_doc("OpsPilot Settings", name)
	if doc.user != user and "System Manager" not in frappe.get_roles(user):
		frappe.throw(_("Not permitted"), frappe.PermissionError)

	extra_headers = {}
	if doc.extra_headers:
		try:
			parsed = json.loads(doc.extra_headers)
			if isinstance(parsed, dict):
				extra_headers = {str(k): str(v) for k, v in parsed.items()}
		except (TypeError, ValueError):
			extra_headers = {}

	return {
		"gateway_url": doc.gateway_url or "",
		"auth_mode": doc.auth_mode or "password",
		"gateway_username": doc.gateway_username or "",
		"gateway_password": doc.get_password("gateway_password", raise_exception=False) or "",
		"session_token": doc.get_password("session_token", raise_exception=False) or "",
		"extra_headers": extra_headers,
	}
