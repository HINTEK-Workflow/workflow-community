import assert from "node:assert/strict";
import { test } from "node:test";
import { isLegalDocumentRequired } from "../lib/kfid/legal-policy";

test("terms and privacy are required while DPA follows the storage mode", () => {
  for (const mode of ["LOCAL", "HINTEK_CLOUD"] as const) {
    assert.equal(isLegalDocumentRequired("TERMS", mode), true);
    assert.equal(isLegalDocumentRequired("PRIVACY", mode), true);
  }
  assert.equal(isLegalDocumentRequired("DPA", "LOCAL"), false);
  assert.equal(isLegalDocumentRequired("DPA", "HINTEK_CLOUD"), true);
});
