import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { AliasMap } from "../lib/ai/alias";
import { formatRuleAnswer } from "../lib/ai/assistant-rules";
import { assistantToolNames, createAssistantToolRunner } from "../lib/ai/assistant-tools";
import { disabledAiSharingPolicy, type AiSharingPolicy } from "../lib/ai/sharing-policy";
import { catalogueAccess, requireCatalogue } from "../lib/catalogue/access";
import { buildCatalogueTransfer, catalogueTransferCounts, catalogueTransferRows, catalogueTransferSchema, CATALOGUE_TRANSFER_LIMITS, parseCatalogueTransfer, type CatalogueExportRows } from "../lib/catalogue/transfer-format";
import { KEY_SCOPES } from "../lib/integrations/key-catalog";
import { validScopes } from "../lib/integrations/keys";
import { ApiError } from "../lib/kfid/errors";
import { keyMayRun, TOOL_CATALOG, toolInputSchema } from "../lib/tools/catalog";
import { createLocalWorkspace, parseLocalWorkspace } from "../features/kfid/local-workspace-store";
import { defaultWorkflowPermissionProfile, noWorkflowPermissionProfile, workflowPermissionPresets } from "../lib/workflow/permissions";

// Artiklar och priser in the tools and the Cloud export (2026-10-08). The data is made up.

const CATALOGUE_TOOLS = ["search_articles", "get_article_price_history"] as const;

test("the catalogue tools only read, with their own API scope and bounded input", () => {
  for (const name of CATALOGUE_TOOLS) {
    assert.equal(TOOL_CATALOG[name].effect, "read");
    assert.equal(TOOL_CATALOG[name].apiScope, "catalogue:read");
  }
  const search = TOOL_CATALOG.search_articles.input;
  assert.equal(search.safeParse({ query: "kabel", supplier: "Grossist", limit: 20 }).success, true);
  assert.equal(search.safeParse({ query: "kabel", limit: 21 }).success, false, "at most 20 articles");
  assert.equal(search.safeParse({ query: "k" }).success, false, "a word of at least two characters");
  assert.equal(search.safeParse({}).success, false);
  const history = TOOL_CATALOG.get_article_price_history.input;
  assert.equal(history.safeParse({ articleId: "a1", limit: 50 }).success, true);
  assert.equal(history.safeParse({ articleId: "a1", limit: 51 }).success, false, "at most 50 price rows");
  assert.equal(history.safeParse({ articleId: "" }).success, false);
  assert.deepEqual(Object.keys((toolInputSchema("search_articles") as { properties: object }).properties).sort(), ["limit", "query", "supplier"]);
});

test("a key reads the catalogue only with catalogue:read (API) or mcp:read (MCP); old keys do not get it by themselves", () => {
  assert.ok(KEY_SCOPES.API.some((scope) => scope.key === "catalogue:read"));
  assert.deepEqual(validScopes("API", ["catalogue:read"]), ["catalogue:read"]);
  assert.equal(validScopes("MCP", ["catalogue:read"]), null, "not an MCP scope");
  for (const name of CATALOGUE_TOOLS) {
    assert.equal(keyMayRun("API", ["tasks:read", "projects:read", "customers:read"], name), false);
    assert.equal(keyMayRun("API", ["catalogue:read"], name), true);
    assert.equal(keyMayRun("MCP", ["mcp:read"], name), true);
    assert.equal(keyMayRun("MCP", ["mcp:write", "mcp:delete"], name), false);
  }
  // The key never gets more than the member: the tools run the catalogue route with its read check.
  const registry = readFileSync("lib/tools/registry.ts", "utf8");
  assert.match(registry, /search_articles: async[^\n]*catalogueRoute\.GET[^\n]*\/api\/catalogue\?articles=/);
  assert.match(registry, /get_article_price_history: async[^\n]*catalogueRoute\.GET[^\n]*\/api\/catalogue\?history=/);
  const route = readFileSync("app/api/catalogue/route.ts", "utf8");
  for (const mode of ["articles", "history"]) assert.match(route, new RegExp(`get\\("${mode}"\\);\\s*if \\(\\w+ !== null\\) \\{\\s*requireCatalogue\\(who, "read"\\);`), `${mode} checks the read right first`);
});

test("the read right: Cloud only, catalogue:read (work-order:edit alone is not enough for the tools)", () => {
  const cloud = { admin: false, storageMode: "HINTEK_CLOUD" };
  const status = (code: number) => (error: unknown) => error instanceof ApiError && error.status === code;
  assert.doesNotThrow(() => requireCatalogue({ ...cloud, permissions: defaultWorkflowPermissionProfile() }, "read"));
  assert.doesNotThrow(() => requireCatalogue({ ...cloud, permissions: workflowPermissionPresets.find((preset) => preset.id === "field")!.profile }, "read"));
  assert.throws(() => requireCatalogue({ ...cloud, permissions: noWorkflowPermissionProfile() }, "read"), status(403));
  const pickOnly = { version: 1 as const, grants: ["work-order:read", "work-order:edit"] as const };
  assert.equal(catalogueAccess({ admin: false, permissions: { version: 1, grants: [...pickOnly.grants] } }).pick, true);
  assert.throws(() => requireCatalogue({ ...cloud, permissions: { version: 1, grants: [...pickOnly.grants] } }, "read"), status(403));
  assert.throws(() => requireCatalogue({ admin: true, storageMode: "LOCAL_HWF", permissions: defaultWorkflowPermissionProfile() }, "read"), status(409), "a Local company has no catalogue");
});

test("Workflow AI: the catalogue tools follow the company's work choice and answer with dated prices excl. VAT", async () => {
  const onlyCustomers: AiSharingPolicy = { ...disabledAiSharingPolicy, enabled: true, shareChatContent: true, shareCustomers: true };
  const onlyWork: AiSharingPolicy = { ...disabledAiSharingPolicy, enabled: true, shareChatContent: true, shareWork: true };
  for (const name of CATALOGUE_TOOLS) {
    assert.equal(assistantToolNames(disabledAiSharingPolicy).includes(name), false);
    assert.equal(assistantToolNames(onlyCustomers).includes(name), false);
    assert.equal(assistantToolNames(onlyWork).includes(name), true);
  }
  const found = { articles: [{ id: "a1", articleNo: "K-1", eNumber: "1812345", name: "Installationskabel 3G1,5", unit: "m", supplier: "Min leverantör", unitPrice: 13, currency: "SEK", priceDate: "2026-10-01", confirmedDate: "2026-10-08" }], total: 1 };
  const ran: unknown[] = [];
  const tools = createAssistantToolRunner({ policy: onlyWork, alias: new AliasMap(), run: async (name, input) => { ran.push({ name, input }); return found; } });
  const answer = JSON.parse(await tools.callTool("search_articles", JSON.stringify({ query: "kabel", supplier: null, limit: null })));
  assert.deepEqual(ran, [{ name: "search_articles", input: { query: "kabel" } }]);
  assert.equal(answer.data.articles[0].unitPrice, 13);
  assert.equal(answer.sources[0].key, "source-7", "the catalogue panel is the source");
  const refused = createAssistantToolRunner({ policy: onlyCustomers, alias: new AliasMap(), run: async () => { throw new Error("never run"); } });
  assert.match(JSON.parse(await refused.callTool("search_articles", JSON.stringify({ query: "kabel" }))).error, /inte tillåtet/);
  const rule = formatRuleAnswer("search_articles", "Artiklar", found);
  assert.match(rule.answer, /13 kr exkl\. moms, prisdatum 2026-10-01, bekräftat 2026-10-08 · Min leverantör/);
  assert.deepEqual(rule.citations.map((item) => [item.resourceType, item.href]), [["VIEW", "/?view=import"]]);
});

// ---------- Export ----------
const at = new Date("2026-10-08T10:00:00.000Z");
const rows = (): CatalogueExportRows => ({
  suppliers: [{ id: "cloud-s1", name: "Min leverantör", customerNumber: "K-42", createdAt: at }],
  imports: [{ id: "cloud-i1", supplierId: "cloud-s1", fileName: "prislista-1.csv", contentHash: "a".repeat(64), rowCount: 3, newArticles: 2, changedPrices: 0, unchangedPrices: 0, failedRows: 1, createdAt: at },
    { id: "cloud-i2", supplierId: "cloud-s1", fileName: "prislista-2.csv", contentHash: "b".repeat(64), rowCount: 2, newArticles: 0, changedPrices: 1, unchangedPrices: 1, failedRows: 0, createdAt: at }],
  articles: [{ id: "cloud-a1", supplierId: "cloud-s1", supplierArticleNo: "K-1", eNumber: "1812345", articleKey: "K-1", name: "Installationskabel 3G1,5", unit: "m", discountGroup: "12", createdAt: at },
    { id: "cloud-a2", supplierId: "gone", supplierArticleNo: "X", eNumber: "", articleKey: "X", name: "Föräldralös", unit: "", discountGroup: "", createdAt: at }],
  prices: [{ id: "cloud-p1", articleId: "cloud-a1", importId: "cloud-i1", amount: "1250", perQuantity: 100, unitPrice: 12.5, currency: "SEK", priceDate: new Date("2026-09-01T00:00:00Z"), sourceFileName: "prislista-1.csv", createdAt: at }],
  confirmations: [{ priceId: "cloud-p1", importId: "cloud-i2", confirmedDate: new Date("2026-10-08T00:00:00Z"), createdAt: at }],
  profiles: [{ supplierId: "cloud-s1", fingerprint: "artikelnummer|benamning|nettopris", mapping: { articleNo: "Artikelnummer", name: "Benämning", price: "Nettopris", eNumber: null, junk: 5 }, updatedAt: at }],
});

test("the export section: its own format, refs instead of Cloud ids, exact amounts, rows without a parent left out", () => {
  const transfer = buildCatalogueTransfer(rows());
  assert.equal(catalogueTransferSchema.safeParse(transfer).success, true);
  assert.deepEqual(Object.keys(transfer), ["format", "schemaVersion", "suppliers", "imports", "articles", "prices", "confirmations", "mappings", "wholesale", "fileRows"]);
  assert.equal(transfer.format, "HWF_CATALOGUE");
  assert.equal(transfer.schemaVersion, 3, "version 2 carries the prices on a wholesaler's catalogue articles, version 3 the rows of a file for a wholesaler without a catalogue");
  assert.deepEqual(transfer.wholesale, [], "a company with only its own suppliers has none");
  assert.equal(JSON.stringify(transfer).includes("cloud-"), false, "no Cloud id in the file");
  assert.deepEqual(transfer.suppliers, [{ ref: "s1", name: "Min leverantör", customerNumber: "K-42", createdAt: at.toISOString() }]);
  assert.deepEqual(transfer.articles.map((row) => [row.ref, row.supplier, row.articleNo, row.eNumber, row.discountGroup]), [["a1", "s1", "K-1", "1812345", "12"]]);
  assert.deepEqual(transfer.prices, [{ ref: "p1", article: "a1", import: "i1", amount: "1250.0000", perQuantity: 100, unitPrice: "12.5000", currency: "SEK", priceDate: "2026-09-01", sourceFileName: "prislista-1.csv", createdAt: at.toISOString() }]);
  assert.deepEqual(transfer.confirmations, [{ price: "p1", import: "i2", confirmedDate: "2026-10-08", createdAt: at.toISOString() }]);
  assert.deepEqual(transfer.mappings[0].mapping, { articleNo: "Artikelnummer", name: "Benämning", price: "Nettopris", eNumber: null }, "only text or empty columns");
  assert.deepEqual(catalogueTransferCounts(transfer), { suppliers: 1, articles: 1, prices: 1, confirmations: 1, mappings: 1, wholesalePrices: 0, fileRows: 0 });
});

// Priser direkt mot grossistens katalogartikel (2026-10-17): the prices travel by the article's natural key, never by the register's running number.
const wholesaleRows = (): CatalogueExportRows => {
  const base = rows();
  const price = (articleNo: string, amount: string, over: Record<string, unknown> = {}) => ({ importId: "cloud-i1", wholesaler: "solar", articleNo, amount, perQuantity: 1, unitPrice: amount, priceKind: "NET", priceDate: new Date("2026-10-01T00:00:00Z"), createdAt: at,
    discountGroup: "", packageSize: "", orderMultiple: "", minOrderQuantity: "", stocked: "", status: "", ...over });
  return { ...base,
    suppliers: [{ ...base.suppliers[0], wholesaler: "solar" }],
    wholesalePrices: [price("2000000001", "48.5", { discountGroup: "K12", minOrderQuantity: "10", stocked: "J" }), price("2000000002", "1250", { perQuantity: 100, unitPrice: "12.5", priceKind: "BASE", status: "UTGAR" }),
      price("2000000003", "7", { importId: "gone" }), price("x".repeat(101), "7")],
    wholesaleSeen: [{ importId: "cloud-i1", wholesaler: "solar", confirmedDate: new Date("2026-10-08T00:00:00Z"), articleNos: ["2000000001", "2000000002", "2000000009"] }, { importId: "gone", wholesaler: "solar", confirmedDate: at, articleNos: ["1"] }],
  };
};

test("a wholesaler's prices are written by the article's number and the wholesaler, with the import's bit list as article numbers", () => {
  const transfer = buildCatalogueTransfer(wholesaleRows());
  assert.equal(catalogueTransferSchema.safeParse(transfer).success, true);
  assert.deepEqual(transfer.suppliers[0], { ref: "s1", name: "Min leverantör", customerNumber: "K-42", wholesaler: "solar", createdAt: at.toISOString() }, "the supplier says which wholesaler it is");
  assert.equal(transfer.wholesale.length, 1, "one group per import and wholesaler; prices of an import that is not in the file are left out");
  const [group] = transfer.wholesale;
  assert.deepEqual([group.import, group.wholesaler, group.prices.length], ["i1", "solar", 2], "an article number the file cannot hold is left out");
  assert.deepEqual(group.prices[0], ["2000000001", "48.5000", 1, "48.5000", "N", "2026-10-01", at.toISOString(), "K12", "", "", "10", "J", ""]);
  assert.deepEqual(group.prices[1].slice(0, 5), ["2000000002", "1250.0000", 100, "12.5000", "B"], "base price, price for 100");
  assert.equal(group.prices[1][12], "UTGAR");
  assert.deepEqual(group.seen, { confirmedDate: "2026-10-08", articles: ["2000000001", "2000000002", "2000000009"] });
  assert.equal(JSON.stringify(transfer).includes("seq"), false, "the register's running number never leaves the database");
  assert.equal(JSON.stringify(transfer).includes("cloud-"), false);
  assert.deepEqual(catalogueTransferCounts(transfer), { suppliers: 1, articles: 1, prices: 1, confirmations: 1, mappings: 1, wholesalePrices: 2, fileRows: 0 });
  assert.equal(catalogueTransferRows(transfer), 3, "the Cloud import's time limit counts both kinds of price rows");
  assert.equal(catalogueTransferRows(null), 0);
  // The file is the same after a round trip through JSON.
  assert.deepEqual(parseCatalogueTransfer(JSON.parse(JSON.stringify(transfer))), transfer);
});

test("a version 1 file still reads as before: no wholesale part, no wholesaler on the suppliers", () => {
  const { wholesale, ...rest } = buildCatalogueTransfer(rows());
  void wholesale;
  const old = parseCatalogueTransfer(JSON.parse(JSON.stringify({ ...rest, schemaVersion: 1 })));
  assert.ok(old);
  assert.deepEqual([old.schemaVersion, old.wholesale, old.suppliers[0].wholesaler], [1, [], undefined]);
  assert.equal(old.prices.length, 1);
  assert.equal(catalogueTransferCounts(old)?.wholesalePrices, 0);
  const status = (error: unknown) => error instanceof ApiError && error.status === 422;
  const withWholesale = buildCatalogueTransfer(wholesaleRows());
  assert.throws(() => parseCatalogueTransfer({ ...withWholesale, schemaVersion: 1 }), status, "version 1 has no prices on a wholesaler's articles");
  assert.throws(() => parseCatalogueTransfer({ ...withWholesale, schemaVersion: 4 }), status, "an unknown version");
});

test("a damaged wholesale part is refused: an import not in the file, a group twice, a price row of the wrong shape or too large a list", () => {
  const status = (error: unknown) => error instanceof ApiError && error.status === 422;
  const good = buildCatalogueTransfer(wholesaleRows());
  const group = good.wholesale[0];
  assert.throws(() => parseCatalogueTransfer({ ...good, wholesale: [{ ...group, import: "i9" }] }), status, "the group must point at an import of the file");
  assert.throws(() => parseCatalogueTransfer({ ...good, wholesale: [group, group] }), status, "one group per import and wholesaler");
  assert.throws(() => parseCatalogueTransfer({ ...good, wholesale: [{ ...group, wholesaler: "okand" }] }), status, "a wholesaler the product knows");
  assert.throws(() => parseCatalogueTransfer({ ...good, wholesale: [{ ...group, prices: [[...group.prices[0], "extra"]] }] }), status, "a price row is exactly its fields");
  assert.throws(() => parseCatalogueTransfer({ ...good, wholesale: [{ ...group, prices: [["", ...group.prices[0].slice(1)]] }] }), status, "an article number is required");
  assert.throws(() => parseCatalogueTransfer({ ...good, wholesale: [{ ...group, prices: [[group.prices[0][0], "-1", ...group.prices[0].slice(2)]] }] }), status, "an amount is a plain amount");
  assert.throws(() => parseCatalogueTransfer({ ...good, wholesale: [{ ...group, seen: { confirmedDate: "2026-13-40", articles: [] } }] }), status);
  assert.throws(() => parseCatalogueTransfer({ ...good, wholesale: [{ ...group, extra: 1 }] }), status, "strict: nothing unknown");
  assert.throws(() => parseCatalogueTransfer({ ...good, wholesale: Array.from({ length: CATALOGUE_TRANSFER_LIMITS.imports + 1 }, (_, index) => ({ ...group, import: `i${index + 1}` })) }), status, "bounded");
});

test("importing back: no section is fine; a damaged, unlinked or oversized section is refused before anything is stored", () => {
  const status = (error: unknown) => error instanceof ApiError && error.status === 422;
  assert.equal(parseCatalogueTransfer(undefined), null);
  assert.equal(catalogueTransferCounts(parseCatalogueTransfer(undefined)), null);
  const good = buildCatalogueTransfer(rows());
  assert.deepEqual(parseCatalogueTransfer(JSON.parse(JSON.stringify(good))), good);
  assert.throws(() => parseCatalogueTransfer({ ...good, format: "OTHER" }), status);
  assert.throws(() => parseCatalogueTransfer({ ...good, extra: 1 }), status, "strict: nothing unknown");
  assert.throws(() => parseCatalogueTransfer({ ...good, prices: [{ ...good.prices[0], article: "a9" }] }), status, "a price must point at an article in the file");
  assert.throws(() => parseCatalogueTransfer({ ...good, confirmations: [{ ...good.confirmations[0], price: "p9" }] }), status);
  assert.throws(() => parseCatalogueTransfer({ ...good, articles: [good.articles[0], good.articles[0]] }), status, "a ref is unique");
  assert.throws(() => parseCatalogueTransfer({ ...good, prices: [{ ...good.prices[0], amount: "-1" }] }), status);
  assert.throws(() => parseCatalogueTransfer({ ...good, suppliers: Array.from({ length: CATALOGUE_TRANSFER_LIMITS.suppliers + 1 }, (_, index) => ({ ...good.suppliers[0], ref: `s${index + 1}` })) }), status, "bounded");
});

test("Local mode keeps the section untouched in the .hwf and has no catalogue of its own", () => {
  const workspace = createLocalWorkspace({ id: "org-1", name: "Alfa" });
  const catalogue = buildCatalogueTransfer(rows());
  const parsed = parseLocalWorkspace({ ...workspace, catalogue }, "org-1");
  assert.deepEqual(parsed.catalogue, catalogue);
  assert.equal(parseLocalWorkspace(workspace, "org-1").catalogue, undefined);
  // The export writes it; Local never reads it (the catalogue route refuses a Local company, tested above).
  assert.match(readFileSync("lib/kfid/cloud-export.ts", "utf8"), /workspace\.catalogue = await catalogueForExport\(organizationId\)/);
  assert.match(readFileSync("lib/kfid/cloud-import.ts", "utf8"), /parseCatalogueTransfer\(input\.bundle\.workspace\.catalogue\)/);
});
