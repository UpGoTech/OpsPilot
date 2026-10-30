// Copyright (c) 2026, OpsPilot and contributors
// For license information, please see license.txt

frappe.ui.form.on("OpsPilot Settings", {
  refresh(frm) {
    if (frm.is_new() && !frm.doc.user) {
      frm.set_value("user", frappe.session.user);
    }
  },
});
