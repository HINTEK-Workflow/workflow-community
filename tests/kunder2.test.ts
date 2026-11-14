import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { normalizePostalCode } from "../lib/postal-code";
import { customerSchema } from "../lib/kfid/customer-schema";

test("KND-06: postal codes are written as 123 45", () => {
  assert.equal(normalizePostalCode("41878"), "418 78");
  assert.equal(normalizePostalCode(" 418  78 "), "418 78");
  assert.equal(normalizePostalCode("SE-123"), "SE-123");
  assert.equal(customerSchema.parse({ name: "A", postalCode: "41878" }).postalCode, "418 78");
});

test("R2-KND-07: Radera företaget sits in its own danger zone, not beside Ge krediter", () => {
  const source = readFileSync("features/kfid/customer-companies.tsx", "utf8");
  const zone = source.indexOf('data-testid="company-danger-zone"');
  assert.ok(zone > source.indexOf(">Ge krediter</Button>"));
  assert.ok(source.indexOf("Radera företaget</Button>") > zone);
});

test("MOB-21: an unknown offer link answers 404", () => {
  const page = readFileSync("app/(public)/offert/[token]/page.tsx", "utf8");
  assert.match(page, /state === "invalid" && !limited\) notFound\(\)/);
});

test("MOB-22: reset-password without a valid link has its own title, not 'Sätt nytt lösenord'", () => {
  const page = readFileSync("app/(public)/reset-password/page.tsx", "utf8");
  assert.match(page, /valid \? "Sätt nytt lösenord" : "Länken fungerar inte"/);
});

test("KND-15: the setup banner and its settings row follow Visa som, not the real role", () => {
  const source = readFileSync("features/kfid/workspace.tsx", "utf8");
  assert.match(source, /shownAdmin && !preferences\.tours\.setup \? <div[^>]*data-testid="setup-banner"/);
  assert.match(source, /setupHref=\{shownAdmin \?/);
});
