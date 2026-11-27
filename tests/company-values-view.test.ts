import assert from "node:assert/strict";
import test from "node:test";
import { BUILTIN_FORMS } from "../lib/workflow/builtin-forms";
import { ROUND_FORMS } from "../lib/workflow/builtin-rounds";
import { kfidForm } from "../lib/workflow/builtin-kfid-form";
import { riskForm } from "../lib/workflow/builtin-risk-form";
import { planningForm } from "../lib/workflow/builtin-planning-form";
import { KFID_FORM_ID } from "../lib/workflow/builtin-originals";
import { companyValueCatalog, SHARED_GROUP, type CompanyValue } from "../lib/workflow/company-values";
import { catalogForm, catalogForms, companyValuesHref, emptyValueFilter, FLAT_GROUP, isValueSort, valueFilterNarrowed, viewCompanyValues, type ValueFilter } from "../lib/workflow/company-values-view";

// Värden och referenser: filter, sort and the direct link ?form=<id> (2026-10-07).
const forms = [...BUILTIN_FORMS, ...ROUND_FORMS, kfidForm, riskForm, planningForm];
const catalog = companyValueCatalog(forms.map((form) => ({ id: form.id, name: form.meta.displayName || form.meta.name, document: form.document })));
const rowKeys = (groups: typeof catalog) => groups.flatMap((group) => group.rows.map((row) => row.key));
const value = (key: string, fields: Partial<CompanyValue> = {}): CompanyValue => ({ key, low: null, high: null, warnLow: null, warnHigh: null, source: "", reference: "", version: 1, updatedByName: "", ...fields });
const view = (filter: Partial<ValueFilter>, values: CompanyValue[] = []) => viewCompanyValues(catalog, values, { ...emptyValueFilter, ...filter });

test("every row names the forms that use it, with their ids", () => {
  const isolation = catalog.flatMap((group) => group.rows).find((row) => row.key === "isolation_min")!;
  assert.deepEqual(isolation.forms.map((form) => form.id).sort(), ["hintek-isolationsmatning-ebr", KFID_FORM_ID]);
  assert.equal(isolation.usedIn.length, isolation.forms.length);
  assert.ok(catalog.some((group) => group.title === SHARED_GROUP));
  assert.ok(catalogForms(catalog).some((form) => form.id === KFID_FORM_ID));
  const names = catalogForms(catalog).map((form) => form.name);
  assert.deepEqual(names, [...names].sort((a, b) => a.localeCompare(b, "sv")), "the forms are listed by name");
});

test("no filter shows everything; the form filter shows only what that form uses", () => {
  const all = view({});
  assert.equal(all.shown, all.total);
  assert.equal(all.form, null);
  const control = view({ formId: KFID_FORM_ID });
  assert.equal(control.form?.id, KFID_FORM_ID);
  assert.ok(control.shown > 0 && control.shown < all.total);
  assert.ok(rowKeys(control.groups).includes("isolation_min"), "also what it shares with another form");
  assert.ok(rowKeys(control.groups).includes("zs_max"));
  assert.ok(!rowKeys(control.groups).includes("delta_ref"), "nothing that only another form uses");
  for (const row of control.groups.flatMap((group) => group.rows)) assert.ok(row.forms.some((form) => form.id === KFID_FORM_ID), row.key);
  assert.equal(valueFilterNarrowed({ ...emptyValueFilter, formId: KFID_FORM_ID }), true);
  assert.equal(valueFilterNarrowed({ ...emptyValueFilter, sort: "key" }), false, "the order alone does not narrow");
});

test("an id that names no form with limits shows nothing, never everything", () => {
  const nothing = view({ formId: "finns-inte" });
  assert.equal(nothing.shown, 0);
  assert.equal(nothing.form, null);
  assert.deepEqual(nothing.groups, []);
  // The risk assessment declares no limits, so it is no form in the list either.
  assert.equal(view({ formId: riskForm.id }).shown, 0);
});

test("a company's own version is found by its original's id as well", () => {
  const own = forms.map((form) => ({ id: form.id === KFID_FORM_ID ? "company-copy-1" : form.id, baseId: form.id === KFID_FORM_ID ? KFID_FORM_ID : null, name: form.meta.name, document: form.document }));
  const groups = companyValueCatalog(own);
  assert.equal(catalogForm(groups, "company-copy-1")?.name, "Kontroll före idrifttagning");
  assert.equal(catalogForm(groups, KFID_FORM_ID)?.id, "company-copy-1", "a link made for the original reaches the company's version");
  assert.ok(viewCompanyValues(groups, [], { ...emptyValueFilter, formId: KFID_FORM_ID }).shown > 0);
});

test("Saknar värde leaves the limits without a number, and counts them within the form and the search", () => {
  const values = [value("isolation_min", { low: 1 }), value("zs_max", { high: 1.2 }), value("continuity_max", { source: "Bara en källa" })];
  const control = view({ formId: KFID_FORM_ID }, values);
  const missing = view({ formId: KFID_FORM_ID, missingOnly: true }, values);
  assert.equal(missing.shown, control.shown - 2, "isolation_min and zs_max have numbers");
  assert.equal(missing.missing, control.missing, "the count does not depend on the switch itself");
  assert.equal(control.missing, control.shown - 2);
  assert.ok(rowKeys(missing.groups).includes("continuity_max"), "a source alone is no value");
  assert.ok(!rowKeys(missing.groups).includes("isolation_min"));
  assert.equal(view({}, []).missing, view({}).total, "with nothing entered every limit is missing");
});

test("the search reads name, key, unit, forms and source, ignoring case and å ä ö", () => {
  assert.deepEqual(rowKeys(view({ query: "ZS_MAX" }).groups), ["zs_max"], "by key");
  assert.ok(rowKeys(view({ query: "isolationsresistans" }).groups).includes("isolation_min"), "by name");
  assert.ok(rowKeys(view({ query: "pumpstation" }).groups).includes("strom"), "by the form that uses it");
  assert.ok(rowKeys(view({ query: "kontroll före" }).groups).includes("zs_max"), "all words must match");
  assert.deepEqual(view({ query: "kontroll xyz" }).groups, []);
  const bySource = view({ query: "rutin 2026" }, [value("delta_ref", { high: 30, source: "Företagets rutin", reference: "2026-01" })]);
  assert.deepEqual(rowKeys(bySource.groups), ["delta_ref"], "by the company's own source and its version");
  assert.ok(rowKeys(view({ query: "mohm" }).groups).length === 0, "a unit is read as written");
  assert.ok(rowKeys(view({ query: "mΩ" }).groups).includes("isolation_min"));
});

test("the order: per form keeps the groups, the others give one flat list", () => {
  const perForm = view({});
  assert.equal(perForm.groups[0].title, SHARED_GROUP, "what several forms share comes first");
  assert.ok(perForm.groups.length > 3);
  const byName = view({ sort: "name" });
  assert.deepEqual(byName.groups.map((group) => group.title), [FLAT_GROUP]);
  const labels = byName.groups[0].rows.map((row) => row.label);
  assert.deepEqual(labels, [...labels].sort((a, b) => a.localeCompare(b, "sv")));
  const byKey = rowKeys(view({ sort: "key" }).groups);
  assert.deepEqual(byKey, [...byKey].sort((a, b) => a.localeCompare(b, "sv")));
  const values = [value("zs_max", { high: 1.2 }), value("effekt", { low: 1 })];
  const missingFirst = view({ sort: "missing" }, values).groups[0].rows.map((row) => row.key);
  assert.deepEqual(missingFirst.slice(-2).sort(), ["effekt", "zs_max"], "what has a value comes last");
  assert.equal(missingFirst.length, byName.shown);
  assert.equal(view({ sort: "name", formId: "finns-inte" }).groups.length, 0, "a flat list with nothing in it has no heading");
  assert.ok(isValueSort("missing") && !isValueSort("annat") && !isValueSort(null));
});

test("a card's shortcut leads to the page on that form, and the id survives the address", () => {
  assert.equal(companyValuesHref(KFID_FORM_ID), "/?view=company_values&form=hintek-kontroll-fore-idrifttagning");
  assert.equal(companyValuesHref("a b&c"), "/?view=company_values&form=a%20b%26c");
  const id = new URL(companyValuesHref("cuid_123"), "https://x.invalid").searchParams.get("form");
  assert.equal(id, "cuid_123");
});

test("the RCD 1× times for TN/IT and TT are listed only while the company has a value for them (2026-10-10)", () => {
  const empty = view({ formId: KFID_FORM_ID });
  assert.ok(rowKeys(empty.groups).includes("rcd_t1_en"));
  assert.ok(!rowKeys(empty.groups).includes("rcd_t1_tnit") && !rowKeys(empty.groups).includes("rcd_t1_tt"), "hidden without a value");
  assert.ok(!rowKeys(view({ query: "TN/IT" }).groups).includes("rcd_t1_tnit"), "not found by a search either");
  const withTt = view({ formId: KFID_FORM_ID }, [value("rcd_t1_tt", { high: 200, source: "Egen rutin" })]);
  assert.ok(rowKeys(withTt.groups).includes("rcd_t1_tt"), "a value the company set stays readable and changeable");
  assert.ok(!rowKeys(withTt.groups).includes("rcd_t1_tnit"));
  assert.equal(withTt.total, empty.total + 1, "the count follows what is listed");
  // A source alone is not a value: the row stays hidden.
  assert.ok(!rowKeys(view({ formId: KFID_FORM_ID }, [value("rcd_t1_tnit", { source: "Gammal" })]).groups).includes("rcd_t1_tnit"));
});
