import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { blankCompanyPlace, blankCompanyProfile, companyProfileSchema } from "../lib/kfid/company";

// Företagets plats i Företagsuppgifter (2026-10-24: "bara en kartnål och adressen"): the company's address and pin,
// stored in the profile JSON beside the rest of Företagsuppgifter.
const text = (path: string) => readFileSync(path, "utf8");

test("a profile from before has an empty place, and a blank profile carries one", () => {
  assert.deepEqual(blankCompanyProfile.place, blankCompanyPlace);
  const old = companyProfileSchema.parse({ organizationNumber: "556000-0000", city: "Provstad" });
  assert.deepEqual(old.place, { address: "", postalCode: "", city: "", latitude: null, longitude: null });
  assert.equal(old.city, "Provstad");
});

test("the place is checked like a customer's top-level place: lengths, postal code and both coordinates or none", () => {
  const saved = companyProfileSchema.parse({ place: { address: " Verkstadsgatan 1 ", postalCode: "12345", city: "Provstad", latitude: 57.7089, longitude: 11.9746 } });
  assert.deepEqual(saved.place, { address: "Verkstadsgatan 1", postalCode: "123 45", city: "Provstad", latitude: 57.7089, longitude: 11.9746 });
  assert.equal(companyProfileSchema.safeParse({ place: { latitude: 57.7, longitude: null } }).success, false, "only one coordinate");
  assert.equal(companyProfileSchema.safeParse({ place: { latitude: 91, longitude: 11 } }).success, false, "latitude out of range");
  assert.equal(companyProfileSchema.safeParse({ place: { latitude: 57, longitude: 181 } }).success, false, "longitude out of range");
  assert.equal(companyProfileSchema.safeParse({ place: { address: "x".repeat(201) } }).success, false, "too long an address");
  // Parsing a stored profile again keeps the place (the superadmin route re-parses before it writes).
  assert.deepEqual(companyProfileSchema.parse({ ...saved, email: "" }).place, saved.place);
});

test("Företagsuppgifter saves the place with the rest and draws it with the place's own address fields and map", () => {
  const route = text("app/api/administration/route.ts");
  assert.match(route, /const details = profile\.parse\(input\.profile\)/, "the server checks the profile, the place with it");
  const form = text("features/kfid/administration.tsx");
  assert.match(form, /usePlaceLocationFields\(/, "the same address field and map as a place");
  assert.match(form, /data-testid="company-place"/);
  assert.match(text("features/workflow/place-editor.tsx"), /usePlaceLocationFields\(/, "the place form uses the same part");
});

test("Företag: the places panel has no developer line and its button is the one on Ställ in Workflow", () => {
  const panel = text("features/kfid/own-company-places.tsx");
  assert.doesNotMatch(panel, /Samma platsträd som kundernas/);
  assert.match(panel, /<Button type="button" variant="outline"[^\n]*data-testid="own-company-places-open"><MapPin \/>/);
  const workspace = text("features/kfid/workspace.tsx");
  assert.match(workspace, /title="Ställ in Workflow"[^\n]*<Button asChild variant="outline">/);
});

// Företagsuppgifter for documents (2026-11-04): säte, bankgiro and plusgiro in the profile JSON, one shared form.
import { COMPANY_DETAIL_KEYS, companyDocumentGaps, mergeCompanyDetails, vatNumberHint } from "../lib/kfid/company";

test("säte, bankgiro and plusgiro default to empty, so a profile from before still reads", () => {
  const old = companyProfileSchema.parse({ organizationNumber: "556000-0000" });
  assert.deepEqual([old.registeredOffice, old.bankgiro, old.plusgiro], ["", "", ""]);
  assert.equal(companyProfileSchema.safeParse({ bankgiro: "123-4567", plusgiro: "12 34 56-7" }).success, true);
  assert.equal(companyProfileSchema.safeParse({ bankgiro: "abc" }).success, false, "giro numbers are digits");
  assert.equal(companyProfileSchema.safeParse({ plusgiro: "1".repeat(21) }).success, false);
});

test("the document gaps name what an invoice or quote letter still lacks, and nothing is missing when it is all there", () => {
  assert.deepEqual(companyDocumentGaps({}).map((gap) => gap.key), ["organizationNumber", "address", "contact", "registeredOffice", "giro"]);
  const full = { organizationNumber: "556000-0000", address: "Gatan 1", postalCode: "123 45", city: "Stad", phone: "010", registeredOffice: "Stad", plusgiro: "12 34 56-7" };
  assert.deepEqual(companyDocumentGaps(full), []);
  assert.deepEqual(companyDocumentGaps({ ...full, address: "", place: { address: "Platsv. 1", city: "Stad" } }), [], "the company's place counts as its address");
  assert.deepEqual(companyDocumentGaps({ ...full, plusgiro: "" }).map((gap) => gap.key), ["giro"]);
  assert.equal(companyDocumentGaps({ email: "inte en adress" })[0].key, "organizationNumber", "an unreadable profile is reported, not hidden");
});

test("mergeCompanyDetails changes only the given details and keeps the place, the notes and what the company works with", () => {
  const stored = { organizationNumber: "556000-0000", notes: "internt", workAreas: ["industry"], place: { address: "Platsv. 1", postalCode: "", city: "Stad", latitude: 1, longitude: 2 } };
  const merged = mergeCompanyDetails(stored, { bankgiro: "123-4567", registeredOffice: "Stad", phone: undefined });
  assert.equal(merged.bankgiro, "123-4567");
  assert.equal(merged.organizationNumber, "556000-0000");
  assert.deepEqual(merged.workAreas, ["industry"]);
  assert.deepEqual(merged.place, stored.place);
  assert.equal(merged.notes, "internt");
  assert.throws(() => mergeCompanyDetails(stored, { bankgiro: "x1" }), "a value the profile refuses is refused");
  assert.throws(() => mergeCompanyDetails(stored, { email: "inte en adress" }));
  assert.ok(COMPANY_DETAIL_KEYS.includes("plusgiro"));
});

test("the VAT number is only a hint from a valid ten-digit organisation number", () => {
  assert.equal(vatNumberHint("5560000000"), "SE556000000001");
  assert.equal(vatNumberHint("123"), "");
});

test("every way a company's details are written uses the one shared form, and the lookups stay helpers", () => {
  const shared = /CompanyDetailsFields/;
  for (const file of ["features/auth/components/register-form.tsx", "features/kfid/setup-guide.tsx", "features/kfid/administration.tsx", "features/kfid/customer-company-edit.tsx", "features/kfid/customer-companies.tsx"])
    assert.match(text(file), shared, `${file} uses the shared fields`);
  const customerCompanies = text("features/kfid/customer-companies.tsx");
  assert.doesNotMatch(customerCompanies, /Företagsinställningar|customer-settings-/, "the settings popup is replaced by the page's edit");
  assert.match(text("features/kfid/customer-company-edit.tsx"), /DialogActions/, "Avbryt and Spara stand top right like Redigera kund");
  const register = text("features/auth/components/register-form.tsx");
  assert.match(register, /lookupEndpoint="\/api\/register\/lookup"/, "the sign-up uses its own protected lookup");
  assert.match(register, /addressSearch=\{false\}/, "no Lantmäteriet question before sign-in");
  const route = text("app/api/superadmin/customer-companies/route.ts");
  assert.match(route, /ctx\.user\.role !== "SUPERADMIN"/);
  assert.doesNotMatch(route, /measurementData/, "company metadata only");
  assert.match(text("app/api/register/lookup/route.ts"), /registrationOpen\(\)[\s\S]*hitRateLimit/, "open only while registration is, and limited per address");
});

test("the sending dialogs warn about missing company details for administrators only, and still allow sending", () => {
  const route = text("app/api/company-gaps/route.ts");
  assert.match(route, /requireAdmin\(ctx\)/, "only a company administrator is answered");
  assert.match(route, /companyDocumentGaps/);
  assert.doesNotMatch(route, /request|searchParams/, "no input: only the caller's own company");
  assert.match(text("features/quotes/send-quote-dialog.tsx"), /<CompanyGapsWarning \/>/);
  assert.match(text("features/quotes/fortnox-dialog.tsx"), /<CompanyGapsWarning \/>/);
  const warning = text("features/kfid/company-gaps-warning.tsx");
  assert.match(warning, /Det går att skicka ändå/);
  assert.match(warning, /view=company/, "links to Företagsuppgifter");
  assert.doesNotMatch(text("features/quotes/customer-quote.tsx"), /CompanyGapsWarning/, "the customer's own quote page is untouched");
});
