import assert from "node:assert/strict";
import test from "node:test";
import { applyArticle, articleNumberOf, type CatalogueHit } from "../lib/catalogue/snapshot";
import { parseCatalogueRows, suggestCatalogueMapping } from "../lib/catalogue/model";
import { workOrderDataSchema } from "../lib/workflow/task-model";
import { withoutMaterialPrices } from "../lib/workflow/material-prices";
import { summarizeProjectMaterials } from "../lib/workflow/project-materials";

// Materialsökningen (2026-10-09): traced from the search to the saved material row.
const hit: CatalogueHit = {
  id: "a1", name: "Installationskabel EKK 3G1,5", unit: "m", supplierArticleNo: "QA-100", eNumber: "1234567", supplierName: "Grossist AB", manufacturerArticleNo: "MFR-9",
  price: { unitPrice: 12.5, priceDate: "2026-10-01", sourceFileName: "pris.csv", importId: "i1" },
};

test("a new, still empty material row no longer stops the autosave of the whole work order", () => {
  const data = workOrderDataSchema.parse({ executionNotes: "Bytt kabel", deviations: "", materials: [{ id: crypto.randomUUID(), name: "", quantity: "", unit: "" }] });
  assert.equal(data.materials[0].name, "");
  assert.equal(data.executionNotes, "Bytt kabel");
  // Rows without a name stay out of Material i projektet (and the report filters them the same way).
  assert.equal(summarizeProjectMaterials([{ id: "w", title: "AO", materials: data.materials }]).lines.length, 0);
});

test("picking an article fills Benämning, unit, article number with its source and the manufacturer's number", () => {
  const row = applyArticle({ id: "r1", name: "kab", quantity: "10", unit: "" }, hit);
  assert.equal(row.name, "Installationskabel EKK 3G1,5", "Benämning is filled");
  assert.equal(row.quantity, "10", "the quantity typed stays");
  assert.equal(row.unit, "m");
  assert.equal(row.articleNo, "QA-100");
  assert.equal(row.articleSource, "Grossist AB");
  assert.equal(row.manufacturerArticleNo, "MFR-9");
  assert.equal(row.unitPrice, "12,5");
  assert.equal(row.catalogue?.manufacturerArticleNo, "MFR-9");
  // Someone who may not see prices gets the name and numbers, and the server prices the row on save.
  const hidden = applyArticle({ id: "r2", name: "", quantity: "1", unit: "" }, { ...hit, price: null, priceHidden: true });
  assert.equal(hidden.name, hit.name);
  assert.equal(hidden.articleNo, "QA-100");
  assert.equal(hidden.pickedArticleId, "a1");
  assert.equal(hidden.unitPrice, undefined);
  // Without the supplier's number the E-nummer is the article number.
  assert.equal(articleNumberOf({ supplierArticleNo: "", eNumber: "1234567" }), "E 1234567");
});

test("the article numbers are saved, kept for a person without the price right, and a manual row works without the catalogue", () => {
  const picked = applyArticle({ id: crypto.randomUUID(), name: "", quantity: "2", unit: "" }, hit);
  const manual = { id: crypto.randomUUID(), name: "Egen skarvdosa", quantity: "3", unit: "st", articleNo: "EGEN-1", articleSource: "", manufacturerArticleNo: "" };
  const saved = workOrderDataSchema.parse({ executionNotes: "", deviations: "", materials: [picked, manual] });
  assert.equal(saved.materials[0].articleNo, "QA-100");
  assert.equal(saved.materials[0].manufacturerArticleNo, "MFR-9");
  assert.equal(saved.materials[1].name, "Egen skarvdosa");
  assert.equal(saved.materials[1].articleNo, "EGEN-1");
  const redacted = withoutMaterialPrices(saved.materials);
  assert.equal(redacted[0].articleNo, "QA-100", "an article number is not a price");
  assert.equal(redacted[0].unitPrice, undefined);
});

test("a price file may carry the manufacturer's article number beside the supplier's", () => {
  const headers = ["Artikelnummer", "Tillverkarens artikelnummer", "Benämning", "Enhet", "Pris"];
  const mapping = suggestCatalogueMapping(headers);
  assert.equal(mapping.articleNo, "Artikelnummer");
  assert.equal(mapping.manufacturerArticleNo, "Tillverkarens artikelnummer");
  const parsed = parseCatalogueRows(headers, [["QA-100", " MFR 9 ", "Kabel", "m", "12,50"]], mapping, "2026-10-09");
  assert.equal(parsed.rows[0].manufacturerArticleNo, "MFR 9");
  const without = parseCatalogueRows(["Artikelnummer", "Benämning", "Pris"], [["QA-1", "Dosa", "4"]], suggestCatalogueMapping(["Artikelnummer", "Benämning", "Pris"]), "2026-10-09");
  assert.equal(without.rows[0].manufacturerArticleNo, "", "optional");
});
