import assert from "node:assert/strict";
import test from "node:test";
import { kfidFormDocument } from "../lib/workflow/builtin-kfid-form";
import { formSectionShown, initialFormValues, type FormSection } from "../lib/workflow/form-document";

// "Ta med stöd vid bedömning" (2026-10-19): on from the start, only an explicit Nej leaves the chapter out of the report,
// and a protocol that never answered it keeps the chapter exactly as before.
const support = kfidFormDocument.blocks.find((block): block is FormSection => block.type === "section" && block.id === "kfid-support")!;

test("the Stöd vid bedömning chapter follows a new protocol, and only Nej leaves it out", () => {
  assert.ok(support, "the chapter exists");
  const fresh = initialFormValues(kfidFormDocument);
  assert.equal(fresh.fields.support, "YES", "ticked from the start");
  assert.equal(formSectionShown(kfidFormDocument, support, fresh), true);
  assert.equal(formSectionShown(kfidFormDocument, support, { ...fresh, fields: { ...fresh.fields, support: "NO" } }), false, "Nej leaves the chapter out");
  const rest = Object.fromEntries(Object.entries(fresh.fields).filter(([key]) => key !== "support"));
  assert.equal(formSectionShown(kfidFormDocument, support, { ...fresh, fields: rest }), true, "an older protocol without the answer keeps the chapter");
});
