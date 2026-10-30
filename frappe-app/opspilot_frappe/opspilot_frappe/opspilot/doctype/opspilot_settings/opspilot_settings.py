# Copyright (c) 2026, OpsPilot and contributors
# For license information, please see license.txt

from __future__ import annotations

import frappe
from frappe import _
from frappe.model.document import Document


class OpsPilotSettings(Document):
	def validate(self):
		if not self.user:
			frappe.throw(_("User is required"))

		# Document name is the User id (autoname field:user).
		if self.name and self.name != self.user:
			frappe.throw(_("Document name must match the User"))

		if frappe.session.user != "Administrator" and "System Manager" not in frappe.get_roles():
			if self.user != frappe.session.user:
				frappe.throw(_("You can only manage your own OpsPilot Settings"))

		if not (self.gateway_url or "").strip():
			frappe.throw(_("Gateway URL is required"))

	def before_insert(self):
		if not self.user:
			self.user = frappe.session.user


def get_permission_query_conditions(user: str | None = None) -> str:
	user = user or frappe.session.user
	if user == "Administrator" or "System Manager" in frappe.get_roles(user):
		return ""
	return f"`tabOpsPilot Settings`.user = {frappe.db.escape(user)}"


def has_permission(doc, ptype: str = "read", user: str | None = None) -> bool:
	user = user or frappe.session.user
	if user == "Administrator" or "System Manager" in frappe.get_roles(user):
		return True
	if not doc:
		return True
	owner_user = getattr(doc, "user", None) or getattr(doc, "name", None)
	return owner_user == user
