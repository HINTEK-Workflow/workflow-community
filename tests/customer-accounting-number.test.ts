import assert from "node:assert/strict";
import { test } from "node:test";
import { customerSchema } from "../lib/kfid/customer-schema";
import { blankCustomerForm, customerFormOf, customerPayload } from "../features/kfid/customer-form-dialog";
import { createLocalWorkspace, parseLocalWorkspace, saveLocalCustomerRecord } from "../features/kfid/local-workspace-store";

// Kundnummer i bokföringen (2026-10-11, plan 1L): the customer's number in the company's accounts, on the customer
// form, in the Local file and in the export/re-import. At most 60 characters, trimmed, optional so a sender without the
// field never empties what is stored.

const customer = { id: "c", name: "Anna", company: "", address: "", postalCode: "", city: "", email: "", phone: "", mobile: "", lat: null, lng: null, notes: "", version: 1, deletedAt: null };

test("Kundnummer i bokföringen: trimmed, at most 60 characters, optional", () => {
  assert.equal(customerSchema.parse({ name: "Anna" }).accountingCustomerNumber, undefined, "not sent = not changed");
  assert.equal(customerSchema.parse({ name: "Anna", accountingCustomerNumber: "  K-1042 " }).accountingCustomerNumber, "K-1042");
  assert.equal(customerSchema.parse({ name: "Anna", accountingCustomerNumber: "" }).accountingCustomerNumber, "", "an emptied field is sent as empty");
  assert.throws(() => customerSchema.parse({ name: "Anna", accountingCustomerNumber: "x".repeat(61) }));
});

test("the customer form carries the number: blank for a new customer, the stored one for an existing, and sends it back", () => {
  assert.equal(blankCustomerForm.accountingCustomerNumber, "");
  assert.equal(customerFormOf(customer).accountingCustomerNumber, "", "an older record without the field reads as empty");
  const form = customerFormOf({ ...customer, accountingCustomerNumber: "K-1042" });
  assert.equal(form.accountingCustomerNumber, "K-1042");
  assert.equal((customerPayload(form, { ...customer, accountingCustomerNumber: "K-1042" }) as { accountingCustomerNumber?: string }).accountingCustomerNumber, "K-1042");
});

test("Local: the number is stored in the file, kept when a page does not send it, and read back", () => {
  const created = saveLocalCustomerRecord(createLocalWorkspace({ id: "org-1", name: "Bolaget" }), { name: "Anna Andersson", accountingCustomerNumber: " 2001 " });
  assert.equal(created.customer.accountingCustomerNumber, "2001");
  const edited = saveLocalCustomerRecord(created.workspace, { name: "Anna A." }, created.customer.id, created.customer.version);
  assert.equal(edited.customer.accountingCustomerNumber, "2001", "an older page without the field never resets it");
  const reread = parseLocalWorkspace(JSON.parse(JSON.stringify(edited.workspace)), "org-1");
  assert.equal(reread.customers[0].accountingCustomerNumber, "2001");
  // A file from before the field reads as before.
  const older = JSON.parse(JSON.stringify(edited.workspace));
  delete older.customers[0].accountingCustomerNumber;
  assert.equal(parseLocalWorkspace(older, "org-1").customers[0].accountingCustomerNumber, undefined);
});

test("a Företag typed before the type was switched to Privatperson is not saved, a stored one is kept (Fas 2)", () => {
  const typed = { ...customerFormOf(customer), customerType: "PRIVATE" as const, company: "Bör kvar?" };
  assert.equal((customerPayload(typed, null) as { company: string }).company, "");
  assert.equal((customerPayload(typed, customer) as { company: string }).company, "");
  const stored = { ...customer, company: "Gammalt AB" };
  assert.equal((customerPayload({ ...customerFormOf(stored), customerType: "PRIVATE" as const }, stored) as { company: string }).company, "Gammalt AB");
});
