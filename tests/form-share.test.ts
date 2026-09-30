import assert from "node:assert/strict";
import test from "node:test";
import { FORM_SHARE_FORMAT, publisherLabel, readFormPackage, signFormPackage } from "../lib/kfid/form-share";

const document = { schema: 2 as const, blocks: [{ id: "a1", type: "section" as const, title: "Del", description: "", newPage: false, blocks: [{ id: "f1", type: "field" as const, key: "notering", label: "Notering", input: "text" as const }] }] };
const meta = { name: "Delad kontroll", displayName: "", description: "", color: "green", icon: "file-spreadsheet", category: "OTHER", allowStandalone: true, allowInProject: true };
const unsigned = () => ({
  format: FORM_SHARE_FORMAT as typeof FORM_SHARE_FORMAT, formatVersion: 1 as const, exportedAt: "2026-09-27T10:00:00.000Z",
  exportedBy: { name: "Elbolaget AB", hintek: false },
  forms: [{ sourceTemplateId: "form-1", sourceVersion: 2, publisherName: "Elbolaget AB", meta, document }],
});

test("a file signed by this server is verified after a round trip through JSON", () => {
  const file = JSON.parse(JSON.stringify(signFormPackage(unsigned() as never)));
  const { pkg, verified } = readFormPackage(file);
  assert.equal(verified, true);
  assert.equal(pkg.forms[0].meta.name, "Delad kontroll");
});

test("a changed or unsigned file is read but not verified", () => {
  const file = JSON.parse(JSON.stringify(signFormPackage(unsigned() as never)));
  file.exportedBy.name = "HINTEK";
  assert.equal(readFormPackage(file).verified, false, "a forged publisher breaks the signature");
  const changedForm = JSON.parse(JSON.stringify(signFormPackage(unsigned() as never)));
  changedForm.forms[0].document.blocks[0].blocks[0].label = "Ändrad";
  assert.equal(readFormPackage(changedForm).verified, false);
  assert.equal(readFormPackage(unsigned()).verified, false);
});

test("anything that is not a form file is rejected with a readable message", () => {
  assert.throws(() => readFormPackage({ hello: "world" }), /inte en formulärfil/);
  assert.throws(() => readFormPackage({ ...unsigned(), forms: [] }), /kunde inte läsas/);
  const script = unsigned();
  (script.forms[0].document.blocks[0].blocks[0] as Record<string, unknown>).input = "script";
  assert.throws(() => readFormPackage(script), /kunde inte läsas/);
});

test("the publisher label shows where an imported form came from", () => {
  assert.equal(publisherLabel("HINTEK", null), "HINTEK");
  assert.equal(publisherLabel("Kund AB", { publisherName: "Elbolaget AB", exportedBy: "Elbolaget AB", verified: true, sourceTemplateId: "x", sourceVersion: 1, importedAt: "2026-09-27" }), "Kund AB · från Elbolaget AB");
  assert.equal(publisherLabel("Kund AB", { publisherName: "Okänd", exportedBy: "Okänd", verified: false, sourceTemplateId: "x", sourceVersion: null, importedAt: "2026-09-27" }), "Kund AB · från Okänd (ej verifierad)");
});
