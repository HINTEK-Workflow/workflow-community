import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { ASSISTANT_READ_TOOLS, assistantToolNames } from "../lib/ai/assistant-tools";
import { disabledAiSharingPolicy, type AiSharingPolicy } from "../lib/ai/sharing-policy";
import { KEY_SCOPES } from "../lib/integrations/key-catalog";
import { validScopes } from "../lib/integrations/keys";
import { approvedScopes, OAUTH_SCOPES, OPT_IN_SCOPES, requestedScopes, SCOPE_LABEL } from "../lib/oauth/rules";
import { keyMayRun, TOOL_CATALOG, toolInputSchema, toolScope } from "../lib/tools/catalog";
import { INVOICE_BASIS_TOOL_FORBIDDEN_KEYS, invoiceBasisToolList, invoiceBasisToolView } from "../lib/tools/invoice-basis-view";
import { invoiceBasisTotals, type InvoiceBasisSummary, type InvoiceBasisView } from "../lib/invoice-basis/model";
import { workOrderFlow, workOrderFromQuote } from "../lib/workflow/task-flow";
import { nextStepLine } from "../lib/workflow/next-step";

// Fakturaunderlag i API och MCP (plan 1J, 2026-10-11) and the work order made from a quote (plan 1K). Made-up data.

const READ_TOOLS = ["list_invoice_bases", "get_invoice_basis", "propose_invoice_basis"] as const;
const everything: AiSharingPolicy = { ...disabledAiSharingPolicy, enabled: true, shareChatContent: true, shareCustomers: true, shareDocuments: true, shareWork: true };

test("reading is in quotes:read; creating a draft needs invoices:write (API) or mcp:invoices (MCP), never mcp:write alone", () => {
  for (const name of READ_TOOLS) {
    assert.equal(TOOL_CATALOG[name].effect, "read");
    assert.equal(TOOL_CATALOG[name].apiScope, "quotes:read");
    assert.equal(keyMayRun("API", ["quotes:read"], name), true);
    assert.equal(keyMayRun("API", ["tasks:read", "invoices:write"], name), false, "writing does not include reading");
    assert.equal(keyMayRun("MCP", ["mcp:read"], name), true);
  }
  assert.equal(TOOL_CATALOG.create_invoice_basis.effect, "create");
  assert.equal(toolScope("API", "create_invoice_basis"), "invoices:write");
  assert.equal(toolScope("MCP", "create_invoice_basis"), "mcp:invoices");
  assert.equal(keyMayRun("API", ["quotes:read", "tasks:write"], "create_invoice_basis"), false, "an existing key never starts creating drafts by itself");
  assert.equal(keyMayRun("API", ["invoices:write"], "create_invoice_basis"), true);
  assert.equal(keyMayRun("MCP", ["mcp:read", "mcp:write", "mcp:delete"], "create_invoice_basis"), false, "mcp:write is not enough");
  assert.equal(keyMayRun("MCP", ["mcp:invoices"], "create_invoice_basis"), true);
  assert.equal(toolScope("MCP", "create_work_order"), "mcp:write", "other tools keep the scope of their effect");
  // The scopes exist on the API- och MCP page and are valid for a key; the page's new-key defaults never include them.
  assert.ok(KEY_SCOPES.API.some((scope) => scope.key === "invoices:write"));
  assert.ok(KEY_SCOPES.MCP.some((scope) => scope.key === "mcp:invoices"));
  assert.deepEqual(validScopes("API", ["invoices:write"]), ["invoices:write"]);
  assert.deepEqual(validScopes("MCP", ["mcp:invoices"]), ["mcp:invoices"]);
  assert.equal(validScopes("API", ["mcp:invoices"]), null);
  const page = readFileSync("features/integrations/integration-keys.tsx", "utf8");
  assert.ok(!/useState<string\[\]>\(\(\) => [^\n]*invoices/.test(page), "a new key starts without the invoice scope");
});

test("OAuth: mcp:invoices is a scope an app can ask for, never part of 'nothing asked for' and unticked on the approval page", () => {
  assert.ok((OAUTH_SCOPES as readonly string[]).includes("mcp:invoices"));
  assert.equal(SCOPE_LABEL["mcp:invoices"], "Skapa utkast till fakturaunderlag");
  assert.deepEqual(requestedScopes(undefined), ["mcp:read", "mcp:write"]);
  assert.deepEqual(requestedScopes("mcp:read mcp:invoices"), ["mcp:read", "mcp:invoices"]);
  assert.deepEqual(approvedScopes(["mcp:read", "mcp:write"], ["mcp:read", "mcp:write", "mcp:invoices"]), ["mcp:read", "mcp:write"], "left unticked, the app does not get it");
  assert.ok(OPT_IN_SCOPES.includes("mcp:invoices") && OPT_IN_SCOPES.includes("mcp:delete"));
  const page = readFileSync("lib/oauth/page.tsx", "utf8");
  assert.ok(page.includes("optIn: OPT_IN_SCOPES.includes(scope)"),"the approval page unticks the opt-in scopes (decided on the server, never node:crypto in the browser)");
});

test("Workflow AI's chat never gets the invoice tools", () => {
  for (const name of [...READ_TOOLS, "create_invoice_basis"] as const) {
    assert.equal((ASSISTANT_READ_TOOLS as readonly string[]).includes(name), false);
    assert.equal((assistantToolNames(everything) as readonly string[]).includes(name), false);
  }
});

test("the tools' input: a job or a project, a basis id, and the proposal key for a draft", () => {
  assert.equal(TOOL_CATALOG.list_invoice_bases.input.safeParse({ taskId: "t1" }).success, true);
  assert.equal(TOOL_CATALOG.get_invoice_basis.input.safeParse({}).success, false);
  assert.equal(TOOL_CATALOG.create_invoice_basis.input.safeParse({ taskId: "t1" }).success, false, "no draft without the proposal key");
  assert.equal(TOOL_CATALOG.create_invoice_basis.input.safeParse({ projectId: "p1", proposal: "4-abc", title: "Etapp 1" }).success, true);
  assert.deepEqual(Object.keys((toolInputSchema("create_invoice_basis") as { properties: object }).properties).sort(), ["note", "projectId", "proposal", "taskId", "title"]);
  // The tools run the invoice-bases route (its own rights, Cloud and company checks), never the database.
  const registry = readFileSync("lib/tools/registry.ts", "utf8");
  assert.match(registry, /list_invoice_bases: async[^\n]*invoiceBasesRoute\.GET/);
  assert.match(registry, /create_invoice_basis[\s\S]*invoiceBasesRoute\.POST[^\n]*action: "create"/);
});

test("the answers carry selling prices and amounts, never the purchase price, the markup or the sources", () => {
  const lines = [
    { id: "labour:t1", kind: "LABOUR" as const, name: "Arbete", quantity: "3,5", unit: "h", unitPrice: "650", markupPercent: "", sources: ["time:e1", "time:e2"] },
    { id: "row:t1:m1", kind: "MATERIAL" as const, name: "Jordfelsbrytare", quantity: "2", unit: "st", unitPrice: "450", markupPercent: "15", sources: ["row:t1:m1"] },
    { id: "own", kind: "OTHER" as const, name: "Parkering", quantity: "1", unit: "st", unitPrice: "", markupPercent: "", sources: [] },
  ];
  const view: InvoiceBasisView = {
    id: "b1", number: 1, label: "F-0001", revision: 2, title: "Byte av central", status: "DRAFT", vatPercent: 25, note: "", lines, totals: invoiceBasisTotals(lines),
    invoicedAt: null, invoicedByName: "", createdAt: "2026-10-11T08:00:00.000Z", updatedAt: "2026-10-11T08:00:00.000Z",
    task: { id: "t1", title: "Byte av central" }, project: null, customer: { id: "c1", name: "Alfa Fastigheter" }, canEdit: true, quoteNote: "",
    priceDefaults: { hourlyRate: "650", markupPercent: "15" }, proposal: "4-abc",
  };
  const tool = invoiceBasisToolView(view);
  assert.deepEqual(tool.lines.map((line) => [line.name, line.price, line.amount, line.fromWork]), [["Arbete", 650, 2275, true], ["Jordfelsbrytare", 517.5, 1035, true], ["Parkering", null, null, false]], "the material line is given with its markup inside the price");
  assert.deepEqual(tool.totals, { material: 1035, labour: 2275, other: 0, net: 3310, vatPercent: 25, vat: 827.5, gross: 4137.5, unpriced: 1 });
  assert.deepEqual([tool.label, tool.statusLabel, tool.proposal, tool.customer?.name], ["F-0001", "Utkast", "4-abc", "Alfa Fastigheter"]);
  const json = JSON.stringify(tool);
  for (const key of INVOICE_BASIS_TOOL_FORBIDDEN_KEYS) assert.ok(!json.includes(`"${key}"`), `${key} leaked`);
  assert.ok(!json.includes("450") && !json.includes("time:e1"), "the purchase price and the sources never leave");
  const summary: InvoiceBasisSummary = {
    bases: [{ id: "b1", number: 1, label: "F-0001", title: "Byte av central", status: "INVOICED", net: 3310, unpriced: 0, invoicedAt: "2026-10-11T08:00:00.000Z", scope: "task", subjectTitle: "Byte av central" }],
    canEdit: true, available: 0, newReason: "Allt på jobbet finns redan i F-0001.", notCompleted: "", quoteNote: "", marked: { invoiced: ["F-0001"], draft: [] },
  };
  const list = invoiceBasisToolList(summary);
  assert.deepEqual([list.bases[0].statusLabel, list.available, list.newReason, list.marked.invoiced], ["Fakturerat", 0, "Allt på jobbet finns redan i F-0001.", ["F-0001"]]);
});

test("a work order from a quote asks for Ansvarig and Klart senast as its next step; an ordinary order plans optionally", () => {
  const base = { saved: true, title: "Laddplatser", status: "PLANNED", timerRunning: false, totalDurationSec: 0, executionNotes: "", signatureName: "", signatureConfirmed: false };
  assert.equal(workOrderFromQuote({ quote: { quoteId: "q1" } }), true);
  assert.equal(workOrderFromQuote({ materials: [{ quoteRef: { quoteId: "q1" } }] }), true, "an older order carries the quote in its rows");
  assert.equal(workOrderFromQuote({ materials: [{}] }), false);
  const fromQuote = workOrderFlow({ ...base, assigned: false, dueDate: "", fromQuote: true });
  assert.equal(fromQuote.current?.key, "plan");
  const next = nextStepLine({ flow: fromQuote });
  assert.deepEqual([next?.step, next?.target, next?.kind], ["Planering", "task-assignee", "focus"]);
  assert.match(next?.text ?? "", /Välj ansvarig och Klart senast/);
  assert.equal(workOrderFlow({ ...base, assigned: true, dueDate: "", fromQuote: true }).current?.key, "plan", "both are needed");
  assert.equal(workOrderFlow({ ...base, assigned: true, dueDate: "2026-10-20", fromQuote: true }).current?.key, "work");
  const ordinary = workOrderFlow({ ...base, assigned: false, dueDate: "" });
  assert.equal(ordinary.current?.key, "work", "an ordinary order's planning stays optional");
  assert.equal(ordinary.steps.find((step) => step.key === "plan")?.state, "skipped");
});
