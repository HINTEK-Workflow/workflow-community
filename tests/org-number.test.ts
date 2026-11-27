import assert from "node:assert/strict";
import test from "node:test";
import { formatOrgNumber, isMaskedNumber, looksLikePersonalNumber, maskPersonalNumber, normalizeCompanyOrgNumber, normalizeOrgNumber, normalizePartyNumber, normalizePersonalNumber, numberForOthers } from "../lib/kfid/org-number";
import { companyProfileSchema, mergeCompanyDetails, profileWithMaskedNumber, companySenderOf, companyDocumentGaps } from "../lib/kfid/company";
import { registrationAllowsEmail } from "../lib/auth/registration-gate";

test("an organisation number is ten digits with a Luhn check digit; dashes and the century prefix are accepted", () => {
  assert.equal(normalizeOrgNumber("556012-5790"), "5560125790");
  assert.equal(normalizeOrgNumber("16556012-5790"), "5560125790");
  assert.equal(normalizeOrgNumber("556012 5790"), "5560125790");
  assert.equal(normalizeOrgNumber("556012-5791"), null, "a wrong check digit");
  assert.equal(normalizeOrgNumber("55601257"), null, "too short");
  assert.equal(formatOrgNumber("5560125790"), "556012-5790");
});

test("on a loopback test instance only synthetic addresses may register; on the real server any address", () => {
  assert.equal(registrationAllowsEmail("someone@example.invalid", "http://localhost:3001"), true);
  assert.equal(registrationAllowsEmail("someone@gmail.com", "http://localhost:3001"), false);
  assert.equal(registrationAllowsEmail("someone@gmail.com", "https://workflow.example.com"), true);
});

// Enskild firma (2026-11-04): a personal number stands in for the organisation number.
test("a personal number is ten digits with a Luhn check digit and a real date; samordningsnummer and the century prefix are accepted", () => {
  assert.equal(normalizePersonalNumber("121212-1212"), "1212121212");
  assert.equal(normalizePersonalNumber("19121212-1212"), "1212121212");
  assert.equal(normalizePersonalNumber("191212121212"), "1212121212");
  assert.equal(normalizePersonalNumber("121212 1212"), "1212121212");
  assert.equal(normalizePersonalNumber("121212-1213"), null, "a wrong check digit");
  assert.equal(normalizePersonalNumber("851301-1232"), null, "month 13");
  assert.equal(normalizePersonalNumber("121272-1219"), "1212721219", "samordningsnummer: the day plus 60");
  assert.equal(normalizePersonalNumber("1234"), null);
  assert.equal(normalizePersonalNumber(""), null);
});

test("an organisation number and a personal number are told apart by the third digit", () => {
  assert.equal(normalizeCompanyOrgNumber("556012-5790"), "5560125790");
  assert.equal(normalizeCompanyOrgNumber("121212-1212"), null, "a personal number is no company number");
  assert.equal(normalizePersonalNumber("556012-5790"), null, "a company number is no personal number");
  assert.equal(looksLikePersonalNumber("121212-1212"), true);
  assert.equal(looksLikePersonalNumber("556012-5790"), false);
  assert.equal(looksLikePersonalNumber("hej"), false);
  assert.equal(normalizePartyNumber("121212-1212", "soleTrader"), "1212121212");
  assert.equal(normalizePartyNumber("121212-1212", "company"), null);
  assert.equal(normalizePartyNumber("556012-5790", "soleTrader"), null);
  assert.equal(normalizePartyNumber("556012-5790", "company"), "5560125790");
});

test("one stored form: the same number written differently is the same number, so uniqueness holds", () => {
  const forms = ["121212-1212", "1212121212", "19121212-1212", "121212 1212"];
  assert.equal(new Set(forms.map((form) => formatOrgNumber(normalizePersonalNumber(form) ?? ""))).size, 1);
  assert.equal(formatOrgNumber("1212121212"), "121212-1212");
});

test("a personal number is masked to the date; an organisation number is public and stays", () => {
  assert.equal(maskPersonalNumber("121212-1212"), "121212-••••");
  assert.equal(maskPersonalNumber("1212121212"), "121212-••••");
  assert.equal(maskPersonalNumber("12"), "••••");
  assert.equal(isMaskedNumber("121212-••••"), true);
  assert.equal(isMaskedNumber("121212-1212"), false);
  assert.equal(numberForOthers("121212-1212", "soleTrader"), "121212-••••");
  assert.equal(numberForOthers("556012-5790", "company"), "556012-5790");
  assert.equal(numberForOthers("", "soleTrader"), "");
  assert.equal(numberForOthers("121212-1212", undefined), "121212-1212");
  assert.ok(!maskPersonalNumber("121212-1212").includes("-1212"));
});

test("the profile carries the kind; a profile from before is a company; masking changes only a sole trader's number", () => {
  assert.equal(companyProfileSchema.parse({}).companyType, "company");
  assert.equal(companyProfileSchema.parse({ companyType: "soleTrader", organizationNumber: "121212-1212" }).companyType, "soleTrader");
  assert.equal(companyProfileSchema.safeParse({ companyType: "annat" }).success, false);
  const sole = { companyType: "soleTrader", organizationNumber: "121212-1212", city: "Ort" };
  assert.deepEqual(profileWithMaskedNumber(sole), { companyType: "soleTrader", organizationNumber: "121212-••••", city: "Ort" });
  assert.equal(sole.organizationNumber, "121212-1212", "the original is untouched");
  const company = { companyType: "company", organizationNumber: "556012-5790" };
  assert.equal(profileWithMaskedNumber(company), company);
  assert.equal(profileWithMaskedNumber(null), null);
  assert.equal(profileWithMaskedNumber({ organizationNumber: "121212-1212" }).organizationNumber, "121212-1212", "no kind, no masking");
  // The documents carry the whole number: it is the sole trader's organisation number by law.
  assert.equal(companySenderOf(sole)?.organizationNumber, "121212-1212");
  assert.equal(companyDocumentGaps({ companyType: "soleTrader" }).find((gap) => gap.key === "organizationNumber")?.label, "Personnummer");
  assert.equal(mergeCompanyDetails({}, { companyType: "soleTrader", organizationNumber: "121212-1212" }).companyType, "soleTrader");
  assert.throws(() => mergeCompanyDetails({}, { companyType: "x" }));
});
