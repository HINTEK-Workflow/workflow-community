// Dokument (0.87.0): the shared rules of the documents – names, what may be downloaded, the view – and the places the feature is wired
// into: the routes' checks, the module, the export, the erasure, the menu and the AI's names-only tool.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import {
  cleanDocumentName, documentDownloadable, documentListQuerySchema, documentSizeLabel, documentView, renamedDocumentName, storedDocumentName,
} from "../lib/documents/model";
import { menuItemAllowed, MENU_HIDEABLE } from "../lib/workflow/menu-items";
import { noWorkflowPermissionProfile, workflowPermissionPresets, type WorkflowPermissionProfile } from "../lib/workflow/permissions";
import { MODULE_ROUTES } from "../lib/workflow/modules";
import { EXPORT_REGISTER } from "../lib/kfid/cloud-export-registry";
import { assistantToolNames, toolAnswerForModel } from "../lib/ai/assistant-tools";
import { planAnswer } from "../lib/ai/assistant-rules";
import { disabledAiSharingPolicy } from "../lib/ai/sharing-policy";
import { AliasMap } from "../lib/ai/alias";
import { TOOL_CATALOG } from "../lib/tools/catalog";

const root = path.resolve(__dirname, "..");
const read = (file: string) => readFileSync(path.join(root, file), "utf8");

test("a name keeps no path or control characters, and the stored file's real extension", () => {
  assert.equal(cleanDocumentName("C:\\fakepath\\Ritning\u0007  E12.pdf"), "Ritning E12.pdf");
  assert.equal(cleanDocumentName("../../etc/passwd"), "passwd");
  assert.equal(storedDocumentName("skylt.png", "jpg"), "skylt.jpg", "a picture is kept as JPEG");
  assert.equal(storedDocumentName("foto.JPEG", "jpg"), "foto.JPEG");
  assert.equal(storedDocumentName("avtal", "pdf"), "avtal.pdf");
  assert.equal(storedDocumentName("", "pdf"), "dokument.pdf");
  assert.equal(storedDocumentName("a".repeat(400) + ".pdf", "pdf").length, 200);
});

test("a renamed document keeps its extension; an empty name is refused", () => {
  assert.equal(renamedDocumentName("Serviceavtal 2027", "avtal.docx"), "Serviceavtal 2027.docx");
  assert.equal(renamedDocumentName("Nytt.docx", "avtal.docx"), "Nytt.docx");
  assert.equal(renamedDocumentName("   ", "avtal.docx"), "");
});

test("only a clean file – or an unscanned one on an installation without a scanner – is ever given out", () => {
  assert.equal(documentDownloadable("clean", true), true);
  assert.equal(documentDownloadable("unscanned", true), true);
  assert.equal(documentDownloadable("pending", true), false);
  assert.equal(documentDownloadable("infected", false), false);
  assert.equal(documentDownloadable("clean", false), false, "no bytes, nothing to give");
  const row = { id: "d1", name: "a.pdf", mimeType: "application/pdf", size: 1200, customerId: "c1", placeId: null, storagePath: "x.pdf", scanStatus: "pending", createdAt: new Date("2026-11-26T08:00:00Z"), deletedAt: null };
  const names = { customer: "Elbolaget AB", place: null, uploadedBy: "Eva" };
  assert.equal(documentView(row, names).href, null);
  assert.equal(documentView({ ...row, scanStatus: "clean" }, names).href, "/api/documents/d1");
  assert.equal(documentView({ ...row, scanStatus: "clean", deletedAt: new Date() }, names).href, null, "never from the papperskorg");
  assert.equal(documentView({ ...row, scanStatus: "bogus" }, names).scanStatus, "pending", "an unknown status is treated as waiting");
  assert.equal(documentSizeLabel(1_234_567), "1,2 MB");
  assert.equal(documentSizeLabel(340_000), "340 kB");
});

test("the list's query: defaults, and nothing outside its bounds", () => {
  assert.deepEqual(documentListQuerySchema.parse({}), { sort: "newest", filter: "all", page: 1, limit: 25 });
  assert.equal(documentListQuerySchema.safeParse({ limit: "500" }).success, false);
  assert.equal(documentListQuerySchema.safeParse({ sort: "size" }).success, false);
});

test("the routes: session, Origin on every change, the module, and the checks in one place", () => {
  const list = read("app/api/documents/route.ts");
  const one = read("app/api/documents/[id]/route.ts");
  const server = read("lib/documents/server.ts");
  assert.match(list, /export async function POST[\s\S]*checkOrigin\(request\)[\s\S]*requireModule\(ctx, "customers"\)/);
  for (const method of ["PATCH", "DELETE"]) assert.match(one, new RegExp(`export async function ${method}[\\s\\S]*?checkOrigin\\(request\\)[\\s\\S]*?requireModule\\(ctx, "customers"\\)`), method);
  assert.doesNotMatch(one.slice(one.indexOf("export async function GET"), one.indexOf("export async function PATCH")), /requireModule/, "the download stays open with the module off");
  assert.match(one, /"Content-Disposition": disposition\(/);
  assert.match(one, /attachment; filename=/, "always an attachment, never inline");
  assert.match(one, /"X-Content-Type-Options": "nosniff"/);
  // Every query is the active company's; every change needs Cloud's write right and the customers right.
  assert.match(server, /async function requireEdit\(ctx: Context\) \{\s+requireCloudStorage\(ctx\);\s+await requireCloudWriteAccess\(ctx\);\s+requireModule\(ctx, "customers"\);/);
  assert.equal((server.match(/organizationId: ctx\.organizationId/g) ?? []).length >= 8, true);
  assert.match(server, /documentDownloadable\(row\.scanStatus, Boolean\(row\.storagePath\)\)/, "the download asks the scan first");
  assert.match(server, /if \(change\.removeFile && updated\.count\) \{\s+await remove\(row\.storagePath\)/, "an infected file's bytes go at once");
  assert.ok(MODULE_ROUTES.customers.write.includes("documents") && MODULE_ROUTES.customers.write.includes("documents/[id]"));
});

test("the files are in the export and in the company's erasure, and a customer removed for good takes its files along", () => {
  assert.deepEqual(EXPORT_REGISTER.CustomerDocument && { status: EXPORT_REGISTER.CustomerDocument.status, files: (EXPORT_REGISTER.CustomerDocument as { files?: boolean }).files }, { status: "archive", files: true });
  assert.match(read("lib/auth/erasure.ts"), /SELECT "storagePath" FROM "CustomerDocument" WHERE "organizationId"/);
  assert.match(read("app/api/records/route.ts"), /documentFilesOfCustomers\(tx, ctx\.organizationId/);
  assert.match(read("app/api/records/route.ts"), /await removeStoredFiles\(documentFiles\)/);
  assert.match(read("app/api/workspace/route.ts"), /documentFilesOfCustomers\(prisma, ctx\.organizationId, \[id\]\)/);
});

test("the menu: Dokument under Mer for whoever reads customers, on Workflow's server and in the demo", () => {
  const profile = (id: string): WorkflowPermissionProfile => ({ version: 1, grants: [...workflowPermissionPresets.find((item) => item.id === id)!.profile.grants] });
  assert.ok(MENU_HIDEABLE.includes("documents"));
  assert.equal(menuItemAllowed("documents", { memberRole: "MEMBER", workflowPermissions: profile("report") }), true);
  assert.equal(menuItemAllowed("documents", { memberRole: "MEMBER", workflowPermissions: noWorkflowPermissionProfile() }), false);
  assert.equal(menuItemAllowed("documents", { memberRole: "OWNER", workflowPermissions: noWorkflowPermissionProfile(), localStorageMode: true }), false, "a company that keeps its data in its own file");
  assert.equal(menuItemAllowed("documents", { memberRole: "OWNER", workflowPermissions: noWorkflowPermissionProfile(), demo: true }), true);
  assert.equal(menuItemAllowed("documents", { memberRole: "OWNER", workflowPermissions: noWorkflowPermissionProfile(), modules: ["projects"] }), false, "Kunder off");
});

test("Workflow AI reads the names only: the tool is a read, under the company's choice Dokument och bilagor, without a link to the bytes", () => {
  assert.equal(TOOL_CATALOG.list_documents.effect, "read");
  assert.equal(TOOL_CATALOG.list_documents.apiScope, "customers:read");
  const policy = { ...disabledAiSharingPolicy, enabled: true, shareChatContent: true };
  assert.equal(assistantToolNames({ ...policy, shareDocuments: false }).includes("list_documents"), false);
  assert.equal(assistantToolNames({ ...policy, shareDocuments: true }).includes("list_documents"), true);
  const runner = read("lib/tools/registry.ts");
  const body = runner.slice(runner.indexOf("list_documents: async"), runner.indexOf("list_planned_activities: async"));
  assert.doesNotMatch(body, /"href"|readStoredFile|read\(/, "no link and no bytes in the tool's answer");
  // What the model sees: the customer becomes a placeholder; the answer has no link.
  const view = toolAnswerForModel({ ...policy, shareDocuments: true, shareCustomers: true }, new AliasMap(), "list_documents", { documents: [{ id: "d1", name: "Ritning.pdf", customerName: "Elbolaget AB", placeName: "Ställverket", url: "/x" }], total: 1 }) as { documents: Record<string, unknown>[] };
  assert.notEqual(view.documents[0]!.customerName, "Elbolaget AB");
  assert.equal(view.documents[0]!.url, undefined);
});

test("the rules answer \"vilka dokument finns för kund X\" with the names tool", () => {
  assert.deepEqual(planAnswer("Vilka dokument finns för kund Elbolaget?"), { kind: "tool", tool: "list_documents", input: { query: "elbolaget", limit: 25 }, heading: "Dokument för elbolaget" });
  assert.equal((planAnswer("visa dokument") as { tool?: string }).tool, "list_documents");
});
