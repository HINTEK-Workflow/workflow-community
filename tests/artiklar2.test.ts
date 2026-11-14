import assert from "node:assert/strict";
import { test } from "node:test";
import { purchaseLineAmount, purchaseTotals } from "../lib/purchases/model";
import { quoteLineNumbers } from "../lib/quotes/model";
import { sentenceAlreadyShown } from "../lib/workflow/toast";
import { GET, DELETE } from "../app/api/v1/tools/[name]/route";

test("R2-ART-04: ett negativt antal ger aldrig en negativ summa", () => {
  assert.equal(purchaseLineAmount({ quantity: "-2", unitPrice: "100" }), 0);
  assert.equal(purchaseLineAmount({ quantity: "3", unitPrice: "100" }), 300);
  assert.equal(purchaseTotals([{ quantity: "-2", unitPrice: "100", supplierName: "A", deliveredAt: null }]).amount, 0);
  assert.equal(quoteLineNumbers({ quantity: "-2", unitPrice: "100" }).amount, 0);
});

test("ART-18: besked om låst status är början på sidans egen rad, så bara ett visas", () => {
  const banner = "Offerten är skickad och låst. Gör en ny version för att ändra den.";
  assert.equal(sentenceAlreadyShown("Offerten är skickad och låst.", [banner]), true);
  assert.equal(sentenceAlreadyShown("Alla rader har kommit.", ["Alla rader har kommit."]), true);
});

test("API-17: GET mot ett verktyg svarar 405 med Allow och kort JSON", async () => {
  for (const method of [GET, DELETE]) {
    const response = method();
    assert.equal(response.status, 405);
    assert.equal(response.headers.get("allow"), "POST");
    assert.deepEqual(await response.json(), { error: "Använd POST." });
  }
});
