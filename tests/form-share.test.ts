import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import test from "node:test";
import { env } from "../lib/env";
import { FORM_SHARE_FORMAT, publisherLabel, readFormPackage, signFormPackage } from "../lib/kfid/form-share";

const document = { schema: 2 as const, blocks: [{ id: "a1", type: "section" as const, title: "Del", description: "", newPage: false, blocks: [{ id: "f1", type: "field" as const, key: "notering", label: "Notering", input: "text" as const }] }] };
const meta = { name: "Delad kontroll", displayName: "", description: "", color: "green", icon: "file-spreadsheet", category: "OTHER", allowStandalone: true, allowInProject: true };
// A fresh copy each time, so one test's change never reaches the next.
const unsigned = () => structuredClone({
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

// A newer version of Workflow (2026-11-24): it signs its own reading of each form, with settings this version does not know.
// The bytes are the ones form-share.ts signs (fixed key order), made here the way a newer server makes them.
type Pkg = ReturnType<typeof unsigned>;
const signedByNewerVersion = (pkg: Pkg) => {
  const bytes = JSON.stringify({
    format: pkg.format, formatVersion: pkg.formatVersion, exportedAt: pkg.exportedAt,
    exportedBy: { name: pkg.exportedBy.name, hintek: pkg.exportedBy.hintek },
    forms: pkg.forms.map((form) => ({ sourceTemplateId: form.sourceTemplateId, sourceVersion: form.sourceVersion, publisherName: form.publisherName, meta: form.meta, document: form.document })),
  });
  const key = createHmac("sha256", env.AUTH_SECRET).update("hintek-workflow-form-share-v1").digest();
  return JSON.parse(JSON.stringify({ ...pkg, signature: createHmac("sha256", key).update(bytes).digest("hex") }));
};
const newer = () => {
  const pkg = unsigned();
  Object.assign(pkg.forms[0].document.blocks[0].blocks[0], { hint: "Ny inställning", layout: { width: 2 } });
  Object.assign(pkg.forms[0].meta, { audience: "alla" });
  return pkg;
};

test("a signed file from a newer version is imported: its unknown settings are removed and listed", () => {
  const { pkg, verified, warning } = readFormPackage(signedByNewerVersion(newer()));
  assert.equal(verified, true, "the newer server's signature is genuine");
  const field = pkg.forms[0].document.blocks[0].type === "section" ? pkg.forms[0].document.blocks[0].blocks[0] : null;
  assert.ok(field && !("hint" in field) && !("layout" in field), "the unknown settings are gone");
  assert.equal(field?.type === "field" ? field.label : "", "Notering", "the known ones stay");
  assert.ok(!("audience" in pkg.forms[0].meta));
  assert.match(warning ?? "", /^Filen kommer från en nyare version av Workflow\. 3 inställningar som den här versionen inte känner till togs bort: /);
  for (const place of ["formulär 1 › avsnitt 1 › block 1 › hint", "formulär 1 › avsnitt 1 › block 1 › layout", "formulär 1 › grunduppgifter › audience"]) assert.ok(warning?.includes(place), place);
  // A file from this version has nothing to warn about.
  assert.equal(readFormPackage(JSON.parse(JSON.stringify(signFormPackage(unsigned() as never)))).warning, undefined);
});

test("unknown settings are still refused in an unsigned file, a changed signed file, and outside the forms", () => {
  const unsignedNewer = newer();
  assert.throws(() => readFormPackage(JSON.parse(JSON.stringify(unsignedNewer))), /som formatet inte känner till/, "an AI's file is checked strictly");
  const forged = signedByNewerVersion(newer());
  forged.forms[0].document.blocks[0].blocks[0].hint = "Ändrad";
  assert.throws(() => readFormPackage(forged), /som formatet inte känner till/, "a changed file loses its signature");
  // A genuine file with a setting added afterwards: the signature covers the file as it was, not the addition.
  const added = JSON.parse(JSON.stringify(signFormPackage(unsigned() as never)));
  added.forms[0].document.blocks[0].blocks[0].extra = true;
  assert.throws(() => readFormPackage(added), /fältet ”extra”/);
  const outside = signedByNewerVersion(newer());
  outside.extra = true;
  assert.throws(() => readFormPackage(outside), /som formatet inte känner till/, "a key outside meta and document is never covered");
});

test("a signed file from a newer version with harmful content is refused like any other", () => {
  const markup = newer();
  (markup.forms[0].document.blocks[0].blocks[0] as Record<string, unknown>).hint = "<script>alert(1)</script>";
  assert.throws(() => readFormPackage(signedByNewerVersion(markup)), /HTML eller skript/);
  const proto = JSON.parse(JSON.stringify(signedByNewerVersion(newer())).replace('"hint":', '"__proto__":{"polluted":true},"hint":'));
  assert.throws(() => readFormPackage(proto), /otillåtna fältnamnet ”__proto__”/);
  assert.equal(({} as Record<string, unknown>).polluted, undefined);
  const long = newer();
  (long.forms[0].document.blocks[0].blocks[0] as Record<string, unknown>).hint = "x".repeat(20_000);
  assert.throws(() => readFormPackage(signedByNewerVersion(long)), /för lång/);
  const deep = newer();
  let nested: unknown = "x"; for (let index = 0; index < 100; index++) nested = { inner: nested };
  (deep.forms[0].document.blocks[0].blocks[0] as Record<string, unknown>).layout = nested;
  assert.throws(() => readFormPackage(signedByNewerVersion(deep)), /djupt nästlad/);
});

test("the publisher label shows where an imported form came from", () => {
  assert.equal(publisherLabel("HINTEK", null), "HINTEK");
  assert.equal(publisherLabel("Kund AB", { publisherName: "Elbolaget AB", exportedBy: "Elbolaget AB", verified: true, sourceTemplateId: "x", sourceVersion: 1, importedAt: "2026-09-27" }), "Kund AB · från Elbolaget AB");
  assert.equal(publisherLabel("Kund AB", { publisherName: "Okänd", exportedBy: "Okänd", verified: false, sourceTemplateId: "x", sourceVersion: null, importedAt: "2026-09-27" }), "Kund AB · från Okänd (inte verifierad)");
});
