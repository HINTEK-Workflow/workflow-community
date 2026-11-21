import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { readFileSync } from "node:fs";
import test from "node:test";
import { customerSchema, customerTypeOf, CUSTOMER_TYPE_LABELS } from "../lib/kfid/customer-schema";
import { customerHasAddress, firstPlaceOf } from "../lib/kfid/customer-first-place";
import { quoteCustomerDetails } from "../lib/quotes/customer-details";
import { quoteFieldsFromProject, quoteTypeFromCustomer } from "../lib/quotes/project-defaults";
import { publicQuoteView } from "../lib/quotes/customer-link";
import { createQuotePdf } from "../lib/quotes/quote-report";
import { placeAddress, quoteTotals, type QuoteView } from "../lib/quotes/model";
import { pdfText } from "../lib/import/pdf-text";
import { createLocalWorkspace, saveLocalCustomerRecord, saveLocalNewCustomer } from "../features/kfid/local-workspace-store";
import { blankCustomerForm, customerFormOf } from "../features/kfid/customer-form-dialog";
import { CUSTOMER_SCREENS, parseCustomerScreen } from "../lib/workflow/native-mode";

// Kundtyp på kunden, kundkortets offerter, kunden i offerten och "Skapa en plats med samma adress" (2026-10-10).
// Made-up data only.

test("Kundtyp: Företag or Privatperson on the customer, optional so a sender without it keeps what is stored", () => {
  assert.equal(customerSchema.parse({ name: "Anna" }).customerType, undefined, "not sent = not changed (a new customer starts as a company in the database)");
  assert.equal(customerSchema.parse({ name: "Anna", customerType: "PRIVATE" }).customerType, "PRIVATE");
  assert.throws(() => customerSchema.parse({ name: "Anna", customerType: "BRF" }));
  assert.equal(customerTypeOf(undefined), "COMPANY", "an older file or record reads as a company");
  assert.equal(customerTypeOf("PRIVATE"), "PRIVATE");
  assert.deepEqual(CUSTOMER_TYPE_LABELS, { COMPANY: "Företag", PRIVATE: "Privatperson" });
  assert.equal(blankCustomerForm.customerType, "COMPANY");
  assert.equal(customerFormOf({ id: "c", name: "Anna", company: "", address: "", postalCode: "", city: "", email: "", phone: "", mobile: "", lat: null, lng: null, notes: "", version: 1, deletedAt: null, customerType: "PRIVATE" }).customerType, "PRIVATE");
});

test("Local: the type is stored, kept when a page does not send it, and changed only on purpose", () => {
  const created = saveLocalCustomerRecord(createLocalWorkspace({ id: "org-1", name: "Bolaget" }), { name: "Anna Andersson", customerType: "PRIVATE" });
  assert.equal(created.customer.customerType, "PRIVATE");
  const edited = saveLocalCustomerRecord(created.workspace, { name: "Anna A." }, created.customer.id, created.customer.version);
  assert.equal(edited.customer.customerType, "PRIVATE", "an older page without the field never resets it");
  const changed = saveLocalCustomerRecord(edited.workspace, { name: "Anna A.", customerType: "COMPANY" }, created.customer.id, edited.customer.version);
  assert.equal(changed.customer.customerType, "COMPANY");
});

test("Skapa en plats med samma adress: a facility with the customer's address, named after the address", () => {
  const customer = { name: "Anna Andersson", company: "", address: " Storgatan 1 ", postalCode: "123 45", city: "Elstad" };
  assert.equal(customerHasAddress(customer), true);
  assert.deepEqual(firstPlaceOf(customer), { name: "Storgatan 1", kind: "FACILITY", parentId: null, address: "Storgatan 1", postalCode: "123 45", city: "Elstad" });
  // Only a town: the place takes the customer's name (the company first).
  assert.equal(firstPlaceOf({ name: "Kontakt", company: "Brf Ljuset", address: "", postalCode: "", city: "Elstad" })?.name, "Brf Ljuset");
  assert.equal(firstPlaceOf({ name: "Anna", company: "", address: " ", postalCode: "", city: "" }), null, "no address, no place");
  assert.equal(customerHasAddress({ address: "", postalCode: "", city: "" }), false);
});

test("Local: a new customer and its first place are written together; without the choice no place is made", () => {
  const input = { ...blankCustomerForm, name: "Brf Ljuset", company: "Brf Ljuset", address: "Ljusvägen 2", postalCode: "123 45", city: "Elstad" };
  const withPlace = saveLocalNewCustomer(createLocalWorkspace({ id: "org-1", name: "Bolaget" }), input, firstPlaceOf(input));
  assert.equal(withPlace.firstPlaceError, undefined);
  const places = withPlace.workspace.customerFacilities.filter((place) => place.customerId === withPlace.customer.id);
  assert.equal(places.length, 1);
  assert.deepEqual([places[0].name, places[0].kind, places[0].address, places[0].postalCode, places[0].city, places[0].parentId ?? null], ["Ljusvägen 2", "FACILITY", "Ljusvägen 2", "123 45", "Elstad", null]);
  const without = saveLocalNewCustomer(createLocalWorkspace({ id: "org-1", name: "Bolaget" }), input, null);
  assert.equal(without.workspace.customerFacilities.length, 0);
  // A place the rules refuse never stops the customer: it is saved and the reason is handed back.
  const refused = saveLocalNewCustomer(createLocalWorkspace({ id: "org-1", name: "Bolaget" }), input, { name: "" });
  assert.ok(refused.firstPlaceError);
  assert.equal(refused.workspace.customers.length, 1);
  assert.equal(refused.workspace.customerFacilities.length, 0);
});

test("the quote takes the customer's type when the customer is set, never writes it back, and a company has no ROT", () => {
  const draft = { customerType: "COMPANY" as const, rotEnabled: false };
  assert.deepEqual(quoteTypeFromCustomer(draft, { customerType: "PRIVATE" }), { customerType: "PRIVATE", rotEnabled: false });
  assert.deepEqual(quoteTypeFromCustomer({ customerType: "PRIVATE", rotEnabled: true }, { customerType: "COMPANY" }), { customerType: "COMPANY", rotEnabled: false });
  assert.deepEqual(quoteTypeFromCustomer({ customerType: "PRIVATE", rotEnabled: true }, {}), { customerType: "COMPANY", rotEnabled: false }, "an older customer without a type is a company");
  assert.deepEqual(quoteTypeFromCustomer({ customerType: "PRIVATE", rotEnabled: true }, null), { customerType: "PRIVATE", rotEnabled: true }, "no customer: the quote keeps its own choice");
  // A project that brings a new customer brings its type; the same customer keeps the quote's exception.
  const customers: Record<string, { customerType: "COMPANY" | "PRIVATE" }> = { c1: { customerType: "COMPANY" }, c2: { customerType: "PRIVATE" } };
  const lookup = (id: string) => customers[id];
  const empty = { customerId: null, facilityId: null, title: "", description: "", customerType: "COMPANY" as const, rotEnabled: false };
  assert.equal(quoteFieldsFromProject(empty, { name: "Villa", customerId: "c2" }, lookup).customerType, "PRIVATE");
  const exception = { ...empty, customerId: "c1", customerType: "PRIVATE" as const, rotEnabled: true };
  assert.deepEqual(quoteFieldsFromProject(exception, { name: "P", customerId: "c1" }, lookup), { customerId: "c1", facilityId: null, title: "P", description: "", customerType: "PRIVATE", rotEnabled: true });
  // Without a lookup the fields are exactly the project's, as before.
  assert.deepEqual(Object.keys(quoteFieldsFromProject({ customerId: null, facilityId: null, title: "", description: "" }, { name: "P", customerId: "c2" })).sort(), ["customerId", "description", "facilityId", "title"]);
  // The editor applies it on a customer change and when a new quote starts for a customer, never on save of the customer.
  const editor = readFileSync("features/quotes/quote-editor.tsx", "utf8");
  assert.match(editor, /quoteTypeFromCustomer\(draft, next\.customer/);
  assert.match(editor, /quoteFieldsFromProject\(draft, project, \(customerId\) =>/);
  assert.doesNotMatch(editor, /customer_save/, "the quote never writes the type back to the customer");
});

test("the customer in the quote: name, contact person and address – nothing else", () => {
  assert.deepEqual(quoteCustomerDetails({ name: "Eva Ek", company: "Brf Ljuset", address: "Ljusvägen 2", postalCode: "123 45", city: "Elstad" }), { name: "Brf Ljuset", contactName: "Eva Ek", address: "Ljusvägen 2, 123 45 Elstad" });
  assert.deepEqual(quoteCustomerDetails({ name: "Anna Andersson", company: "", address: "", postalCode: "", city: "Elstad" }), { name: "Anna Andersson", contactName: "", address: "Elstad" });
  assert.equal(quoteCustomerDetails({ name: "Brf Ljuset", company: "Brf Ljuset" }).contactName, "", "the same name twice is no contact person");
  assert.deepEqual(quoteCustomerDetails(null), { name: "", contactName: "", address: "" });
});

test("the customer's page shows the customer's contact person and address, never its notes", () => {
  const view = publicQuoteView({
    quote: { number: 1, version: 1, title: "Byte", description: "", validUntil: "2026-11-01", terms: "", vatPercent: 25, customerType: "COMPANY", rotEnabled: false, rotPercent: null, rotCap: null, changeOfVersion: null, lines: [], sentAt: null },
    customerName: "Brf Ljuset", placeName: "", customerContact: "Eva Ek", customerAddress: "Ljusvägen 2, 123 45 Elstad",
    company: { name: "Alfa El", email: "" }, senderName: "",
    notes: "intern anteckning",
  } as unknown as Parameters<typeof publicQuoteView>[0]);
  assert.equal(view.customerContact, "Eva Ek");
  assert.equal(view.customerAddress, "Ljusvägen 2, 123 45 Elstad");
  assert.ok(!JSON.stringify(view).includes("intern anteckning"));
});

test("the quote PDF prints the customer's contact person and address", async () => {
  const lines = [{ id: "1", kind: "LABOUR" as const, name: "Montör", quantity: "2", unit: "h", unitPrice: "600", markupPercent: "" }];
  const quote: QuoteView = {
    id: "q", number: 3, version: 1, label: "O-0003", revision: 1, title: "Laddbox", description: "", status: "SENT", storedStatus: "SENT",
    validUntil: "2026-11-08", terms: "", vatPercent: 25, customer: { id: "c", name: "Brf Ljuset", contactName: "Eva Ek", address: "Ljusvägen 2, 123 45 Elstad" }, facility: null, project: null, lines,
    totals: quoteTotals(lines), sentAt: "2026-10-09T08:00:00.000Z", decidedAt: null, createdAt: "2026-10-09T07:00:00.000Z", updatedAt: "2026-10-09T08:00:00.000Z", superseded: false,
    versions: [], actions: [], canEdit: true,
    customerType: "COMPANY", rotEnabled: false, rotPercent: null, rotCap: null, changeOfVersion: null, change: null, workOrder: null, workOrders: [], canCreateWorkOrder: false,
  };
  const fontBytes = new Uint8Array(await readFile("public/fonts/DejaVuSans.ttf"));
  const text = pdfText(Buffer.from(await createQuotePdf({ identity: { company: "QA El AB" }, fontBytes, quote, createdAt: new Date("2026-10-09T08:00:00Z") })))!.replace(/\s+/g, " ");
  assert.match(text, /Att: Eva Ek/);
  assert.match(text, /Eva Ek/);
  assert.match(text, /Ljusvägen 2, 123 45 Elstad/);
  // Without them the boxes are left out.
  const bare = pdfText(Buffer.from(await createQuotePdf({ identity: { company: "QA El AB" }, fontBytes, quote: { ...quote, customer: { id: "c", name: "Anna Andersson" } } })))!;
  assert.doesNotMatch(bare, /Att:/);
});

test("the customer card's quotes: a screen at level 1, the panel and Ny offert for the customer", () => {
  assert.ok((CUSTOMER_SCREENS as readonly string[]).includes("offerter"));
  assert.equal(parseCustomerScreen("offerter"), "offerter");
  const route = readFileSync("app/api/customer-card/route.ts", "utf8");
  assert.match(route, /quoteAccess\(/, "the count is given only to those who may read quotes");
  assert.match(route, /customerId: customer\.id, supersededAt: null/, "the latest version of each quote");
  const panel = readFileSync("features/quotes/customer-quotes.tsx", "utf8");
  assert.match(panel, /\/api\/quotes\?\$\{new URLSearchParams\(\{ customerId, filter: "all"/);
  assert.match(panel, /`\/\?view=quote&customerId=\$\{encodeURIComponent\(customerId\)\}`/);
  const card = readFileSync("features/kfid/customer-card.tsx", "utf8");
  assert.match(card, /const quotes = !own && !local && data\.quotes && moduleIsOn\("quotes"\) \? data\.quotes : null;/, "never in Local, nor on the company's own places (2026-10-24), nor while Offerter is off (0.39.0)");
});

test("the quote PDF prints the place's address beside its name", async () => {
  const lines = [{ id: "1", kind: "LABOUR" as const, name: "Montör", quantity: "1", unit: "h", unitPrice: "600", markupPercent: "" }];
  const quote = {
    id: "q", number: 4, version: 1, label: "O-0004", revision: 1, title: "Byte", description: "", status: "SENT", storedStatus: "SENT",
    validUntil: "2026-11-08", terms: "", vatPercent: 25, customer: { id: "c", name: "Brf Ljuset" }, facility: { id: "f", name: "Fastigheten", address: placeAddress({ address: "Provgatan 5", postalCode: "418 78", city: "Göteborg" }) }, project: null, lines,
    totals: quoteTotals(lines), sentAt: "2026-10-09T08:00:00.000Z", decidedAt: null, createdAt: "2026-10-09T07:00:00.000Z", updatedAt: "2026-10-09T08:00:00.000Z", superseded: false,
    versions: [], actions: [], canEdit: true,
    customerType: "COMPANY", rotEnabled: false, rotPercent: null, rotCap: null, changeOfVersion: null, change: null, workOrder: null, workOrders: [], canCreateWorkOrder: false,
  } as QuoteView;
  const fontBytes = new Uint8Array(await readFile("public/fonts/DejaVuSans.ttf"));
  const text = pdfText(Buffer.from(await createQuotePdf({ identity: { company: "QA El AB" }, fontBytes, quote })))!.replace(/\s+/g, " ");
  assert.match(text, /Fastigheten, Provgatan 5, 418 78 Göteborg/);
});
