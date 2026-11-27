import { NextResponse } from "next/server";
import { z } from "zod";
import * as tasksRoute from "@/app/api/workflow-tasks/route";
import { prisma } from "@/lib/db";
import { ApiError, body, checkOrigin, context, failure, requireCloudStorage, requireCloudWriteAccess, requireModule, requireWorkflowPermission, type Context } from "@/lib/kfid/server";
import { read, remove, store } from "@/lib/kfid/storage";
import { workflowSubjectForTask } from "@/lib/workflow/permissions";
import { workflowTaskAttachmentLimit } from "@/lib/workflow/task-model";
import { prepareAttachmentFile } from "@/lib/workflow/attachment-file";
import { callRoute, ToolError } from "@/lib/tools/call-route";
import { runTool } from "@/lib/tools/registry";
import { aiImportAvailability, analyzeWithAi, mergeAiDetection } from "@/lib/import/ai";
import { buildPlan, controlPointsOf, detectImport, looksLikePriceFile, IMPORT_TARGETS, TARGET_FIELDS, textToWorkOrder, textToWorkOrderRows, aiRowsToWorkOrders, type Detection, type ExtractedFile, type ImportTarget, type PlanItem } from "@/lib/import/detect";
import { extractFile, isTableFile } from "@/lib/import/extract";
import { MAX_TABLE_ROWS } from "@/lib/import/csv";
import { readLimitedFormData } from "@/lib/security/limited-body";
import { MAX_CATALOGUE_ROWS, type CatalogueParseOptions } from "@/lib/catalogue/model";
import { parseOfColumns, suggestCatalogueColumns, type ColumnSuggestions } from "@/lib/catalogue/columns";
import { isWorkbookName, textIsTable, type PriceFile } from "@/lib/catalogue/file/open";
import { previewCatalogueFile } from "@/lib/catalogue/import-file";
import { formJson, MAX_PRICE_FILE_BYTES, openUploadedPriceFile, priceFormatSchema, priceParseSchema } from "@/lib/catalogue/request";
import { catalogueAccess } from "@/lib/catalogue/access";
import { readRebateFile } from "@/lib/catalogue/request";
import { previewRebate } from "@/lib/catalogue/rebate-server";
import type { RebateRead } from "@/lib/catalogue/rebate";
import { todayInSweden } from "@/lib/catalogue/snapshot";
import { selfInspectionActionSchema, SelfInspectionError } from "@/lib/self-inspection/model";
import { applyCloudSelfInspectionAction } from "@/lib/self-inspection/server";
import { absenceApplySchema, absencePlan, applyAbsenceImport, applyEmployeeNumbers, employeeNumbersPlan, savedAbsenceMapping } from "@/lib/payroll/server";

export const dynamic = "force-dynamic";

const MAX_FILES = 10;
const MAX_PLAN_ROWS = 300;
const MAX_SAVED_FILES = 50;
/** One upload of up to 10 files; below the proxy's 110 MB. Each file has its own limit in extractFile. */
const MAX_UPLOAD_BYTES = 105_000_000;
type Input = Record<string, unknown>;

const extractedSchema = z.object({
  name: z.string().min(1).max(200), mimeType: z.string().max(200), size: z.number().int().nonnegative(),
  kind: z.enum(["table", "text", "json", "binary"]),
  headers: z.array(z.string().max(200)).max(60).optional(), rows: z.array(z.array(z.string().max(2000)).max(60)).max(MAX_TABLE_ROWS).optional(), sheet: z.string().max(200).optional(),
  rowCount: z.number().int().nonnegative().optional(), truncated: z.boolean().optional(),
  text: z.string().max(60_000).optional(), json: z.unknown().optional(),
  aiRows: z.array(z.object({ section: z.string().max(120), title: z.string().max(200), description: z.string().max(1000), date: z.string().max(10) })).max(200).optional(),
});
const mappingSchema = z.record(z.string().max(40), z.string().max(200).nullable());
const planItemSchema = z.object({
  index: z.number().int().nonnegative(), kind: z.enum(["customer", "project", "work_order", "planned_activity", "competence"]), title: z.string().max(200),
  data: z.record(z.string(), z.unknown()), refs: z.object({ project: z.string().max(200).optional(), customer: z.string().max(200).optional(), responsible: z.string().max(200).optional(), assignee: z.string().max(200).optional(), person: z.string().max(200).optional() }),
  issues: z.array(z.string().max(300)).max(20), duplicateOf: z.object({ id: z.string(), name: z.string() }).nullable().optional(), skip: z.boolean().optional(),
});
const requestSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("plan"), file: extractedSchema, target: z.enum(IMPORT_TARGETS), mapping: mappingSchema.default({}), keys: z.array(z.string().max(40)).max(500).default([]),
    /** Frånvaro: codes the person mapped in the preview, used for this preview (saved only on import). */
    codeMap: z.record(z.string().max(60), z.string().max(20)).default({}) }),
  // Frånvaro och anställningsnummer (2026-10-29, lib/payroll/server.ts): the server plans the file again and writes it.
  z.object({ action: z.literal("absence_apply"), file: extractedSchema, ...absenceApplySchema.shape }),
  z.object({ action: z.literal("employee_numbers_apply"), file: extractedSchema, mapping: mappingSchema }),
  z.object({ action: z.literal("apply"), items: z.array(planItemSchema).max(MAX_PLAN_ROWS) }),
  z.object({ action: z.literal("attach"), id: z.string().min(1).max(60), taskId: z.string().min(1).max(60) }),
  z.object({ action: z.literal("discard"), id: z.string().min(1).max(60) }),
]);

const savedSelect = { id: true, filename: true, mimeType: true, size: true, createdAt: true } as const;

/** Saves a file that is just an attachment at once, private to the person, so it is never lost before it has a task (2026-10-02). */
async function saveFile(ctx: Context, file: File) {
  // The same payment check as every other write (2026-11-25): a paused or unpaid Cloud company keeps reading its files but saves no
  // new one. Community and Local are not touched (requireCloudWriteAccess only asks Cloud). The rest of the analysis still answers.
  try { await requireCloudWriteAccess(ctx); }
  catch (error) { if (error instanceof ApiError) return { saved: null, saveError: error.message }; throw error; }
  const count = await prisma.importedFile.count({ where: { organizationId: ctx.organizationId, userId: ctx.user.id } });
  if (count >= MAX_SAVED_FILES) return { saved: null, saveError: `Du har redan ${MAX_SAVED_FILES} sparade filer. Lägg några på uppgifter eller ta bort dem först.` };
  let storagePath: string | undefined;
  try {
    const { buffer, mimeType, extension } = await prepareAttachmentFile(file);
    storagePath = await store(buffer, extension);
    const saved = await prisma.importedFile.create({ data: { organizationId: ctx.organizationId, userId: ctx.user.id, filename: file.name.slice(0, 200), storagePath, mimeType, size: buffer.length }, select: savedSelect });
    return { saved, saveError: "" };
  } catch (error) {
    if (storagePath) await remove(storagePath);
    return { saved: null, saveError: error instanceof ApiError ? error.message : "Filen kunde inte sparas." };
  }
}

const TOOL_OF = { customer: "create_customer", project: "create_project", work_order: "create_work_order", planned_activity: "create_planned_activity" } as const;
const KIND_LABEL = { customer: "kund", project: "projekt", work_order: "arbetsorder", planned_activity: "planerad aktivitet", competence: "kompetens" } as const;

/**
 * Kompetens (kompetenskort v2, 2026-10-08): a row names a person by name or e-mail; only the company's active
 * members are matched, and only for an admin – the cards are personal data and only admins keep them. A training the
 * person already has (same name and date) is marked as a duplicate for the person to decide.
 */
async function resolveCompetence(ctx: Context | undefined, items: PlanItem[]): Promise<PlanItem[]> {
  const limited = items.slice(0, MAX_PLAN_ROWS);
  if (!ctx?.admin) return limited.map((item) => ({ ...item, issues: [...item.issues, "bara företagets administratör kan importera kompetens"], skip: true }));
  const members = await prisma.organizationMember.findMany({ where: { organizationId: ctx.organizationId, isActive: true, user: { isActive: true } }, select: { userId: true, user: { select: { name: true, email: true } } } });
  const find = (text: string) => members.find((member) => same(member.user.name, text) || same(member.user.email, text));
  const matched = limited.flatMap((item) => { const found = item.refs.person ? find(item.refs.person) : undefined; return found ? [found.userId] : []; });
  const existing = matched.length ? await prisma.selfInspectionCredential.findMany({ where: { organizationId: ctx.organizationId, userId: { in: [...new Set(matched)] }, leftAt: null }, select: { id: true, userId: true, title: true, issuedAt: true }, take: 5000 }) : [];
  return limited.map((item) => {
    const next: PlanItem = { ...item, data: { ...item.data }, issues: [...item.issues], duplicateOf: null };
    const person = item.refs.person ? find(item.refs.person) : undefined;
    if (item.refs.person && !person) { next.issues.push(`”${item.refs.person}” är inte en aktiv medlem i företaget – raden hoppas över`); next.skip = true; }
    if (person) {
      next.data.personId = person.userId;
      const twin = existing.find((line) => line.userId === person.userId && same(line.title, item.data.title) && (line.issuedAt ?? "") === String(item.data.issuedAt ?? ""));
      if (twin) { next.duplicateOf = { id: twin.id, name: twin.title }; if (next.skip === undefined) next.skip = true; }
    }
    return next;
  });
}
const same = (a: unknown, b: unknown) => String(a ?? "").trim().toLowerCase() === String(b ?? "").trim().toLowerCase();

/** Members of the company, to turn "Ansvarig: Elin" into a user id. */
async function members(): Promise<{ id: string; name: string; email: string }[]> {
  try {
    const result = await callRoute(tasksRoute.GET, "GET", "/api/workflow-tasks?members=only");
    return ((result.members as Input[]) ?? []).map((member) => ({ id: String(member.userId ?? member.id ?? ""), name: String(member.name ?? ""), email: String(member.email ?? "") })).filter((member) => member.id);
  } catch { return []; }
}

/**
 * Fills in what only the server knows: a project or customer named in a row becomes an id (or an issue when it does
 * not exist), a person's name becomes a member, and a row whose name already exists is marked as a duplicate so the
 * person decides. Bounded: at most 300 rows are planned at a time.
 */
async function resolvePlan(items: PlanItem[]): Promise<PlanItem[]> {
  const limited = items.slice(0, MAX_PLAN_ROWS);
  const projectCache = new Map<string, Input | null>();
  const customerCache = new Map<string, Input | null>();
  const people = limited.some((item) => item.refs.responsible || item.refs.assignee) ? await members() : [];
  const findProject = async (name: string) => {
    const key = name.toLowerCase();
    if (!projectCache.has(key)) {
      try { const result = await runTool("list_projects", { state: "ongoing", query: name.slice(0, 100) }) as Input; projectCache.set(key, ((result.projects as Input[]) ?? []).find((project) => same(project.name, name)) ?? null); }
      catch { projectCache.set(key, null); }
    }
    return projectCache.get(key) ?? null;
  };
  const findCustomer = async (name: string) => {
    const key = name.toLowerCase();
    if (!customerCache.has(key)) {
      try { const result = await runTool("list_customers", { query: name.slice(0, 100), limit: 20 }) as Input; customerCache.set(key, ((result.customers as Input[]) ?? []).find((customer) => same(customer.name, name) || same(customer.company, name) || (name.includes("@") && same(customer.email, name))) ?? null); }
      catch { customerCache.set(key, null); }
    }
    return customerCache.get(key) ?? null;
  };
  const resolved: PlanItem[] = [];
  for (const item of limited) {
    const next: PlanItem = { ...item, data: { ...item.data }, issues: [...item.issues], duplicateOf: null };
    if (item.refs.project) {
      const project = await findProject(item.refs.project);
      if (project) next.data.projectId = project.id; else next.issues.push(`projektet ”${item.refs.project}” finns inte – skapas utan projekt`);
    }
    if (item.refs.customer) {
      const customer = await findCustomer(item.refs.customer);
      if (customer) next.data.customerId = customer.id; else next.issues.push(`kunden ”${item.refs.customer}” finns inte – skapas utan kund`);
    }
    for (const [ref, field] of [["responsible", "responsibleUserId"], ["assignee", "assignedToUserId"]] as const) {
      const name = item.refs[ref];
      if (!name) continue;
      const person = people.find((member) => same(member.name, name) || same(member.email, name));
      if (person) next.data[field] = person.id; else next.issues.push(`”${name}” är inte medlem i företaget – lämnas tom`);
    }
    if (item.kind === "customer" && (item.data.name || item.data.email)) {
      const existing = await findCustomer(String(item.data.email || item.data.name));
      if (existing) next.duplicateOf = { id: String(existing.id), name: String(existing.name) };
    }
    if (item.kind === "project" && item.data.name) {
      const existing = await findProject(String(item.data.name));
      if (existing) next.duplicateOf = { id: String(existing.id), name: String(existing.name) };
    }
    if (next.duplicateOf && next.skip === undefined) next.skip = true;
    resolved.push(next);
  }
  return resolved;
}

/**
 * Artiklar och priser: the preview of a price file read as a stream (prisfiler etapp 1, 2026-10-12). A preview only –
 * the file is imported through /api/catalogue, which reads it again. The counts cover every row; only the first rows
 * and errors travel back, with how the file was read and the column suggestion. The same content imported before is said.
 */
async function cataloguePlan(file: PriceFile, mapping: Record<string, string | null>, parse: CatalogueParseOptions, ctx?: Context) {
  const mayRead = ctx && ctx.organization.storageMode === "HINTEK_CLOUD" && catalogueAccess({ admin: ctx.admin, permissions: ctx.workflowPermissions }).read;
  const preview = await previewCatalogueFile(file, mapping, parse, todayInSweden(), mayRead ? { organizationId: ctx.organizationId } : null);
  const { hash, ...catalogue } = preview;
  void hash;
  return { target: "catalogue" as const, items: [] as PlanItem[], truncated: false, catalogue: { ...catalogue, parse, mapping } };
}

/**
 * Rabattbrev (2026-10-14): a discount letter is recognised from its content and previewed as such – what it
 * holds and how much of the matching supplier's list it reaches – never as a price list with columns to choose.
 */
async function rebatePlan(read: RebateRead, ctx?: Context) {
  const mayRead = ctx && ctx.organization.storageMode === "HINTEK_CLOUD" && catalogueAccess({ admin: ctx.admin, permissions: ctx.workflowPermissions }).read;
  const rebate = await previewRebate(read, mayRead ? { organizationId: ctx.organizationId } : null);
  return { target: "catalogue" as const, items: [] as PlanItem[], truncated: false,
    catalogue: { rows: [], rowCount: 0, errors: [], errorCount: 0, missing: [], total: read.rows.length, previous: null, rebateFile: rebate } };
}
const REBATE_COLUMNS = ["Sort", "Grupp eller artikel", "Rabatt %", "Följdrabatt %", "Nettopris"];
const REBATE_KIND_LABEL = { GROUP: "Grupp", ARTICLE: "Artikel", NET: "Nettopris" } as const;
/** A discount letter as the Import page's table: its first rules. */
const tableOfRebate = (file: File, read: RebateRead): ExtractedFile => ({ name: file.name.slice(0, 200), mimeType: file.type || "text/plain", size: file.size, kind: "table", headers: REBATE_COLUMNS,
  rows: read.rows.slice(0, 200).map((row) => [REBATE_KIND_LABEL[row.kind], row.label, String(row.percent).replace(".", ","), row.percent2 ? String(row.percent2).replace(".", ",") : "", row.netPrice === null ? "" : String(row.netPrice).replace(".", ",")]),
  rowCount: read.rows.length, truncated: read.rows.length > 200 });

/** The plan for a file and a chosen kind of import: tool inputs per row, or the sections of a form for control points. */
async function planFor(file: ExtractedFile, target: ImportTarget, mapping: Record<string, string | null>, keys: string[], ctx?: Context, codeMap: Record<string, string> = {}) {
  if (target === "catalogue") return { target, items: [] as PlanItem[], truncated: false };
  // Frånvaro och anställningsnummer (2026-10-29): previewed against the company's people and absence, never through the AI.
  if (target === "absence" && file.kind === "table" && ctx) return { target, items: [] as PlanItem[], truncated: false, absence: await absencePlan(ctx, file, mapping, codeMap) };
  if (target === "employee_numbers" && file.kind === "table" && ctx) return { target, items: [] as PlanItem[], truncated: false, employeeNumbers: await employeeNumbersPlan(ctx, file, mapping) };
  if (target === "control_points") {
    const result = controlPointsOf(file, new Set(keys));
    return { target, items: [] as PlanItem[], control: result, truncated: false };
  }
  if (target === "work_order_text") {
    // The AI's reading first, then the report's dated actions, otherwise the whole text as one work order.
    const ruled = textToWorkOrderRows(file.text ?? "");
    const rows = file.aiRows?.length ? file.aiRows : ruled.length >= 2 ? ruled : null;
    return { target, items: await resolvePlan(rows ? aiRowsToWorkOrders(rows) : [textToWorkOrder(file)]), truncated: false };
  }
  if (target === "competence" && file.kind === "table") {
    const items = buildPlan(file, "competence", mapping);
    return { target, items: await resolveCompetence(ctx, items), truncated: items.length > MAX_PLAN_ROWS, total: items.length };
  }
  if (target in TARGET_FIELDS && file.kind === "table") {
    const items = buildPlan(file, target as keyof typeof TARGET_FIELDS, mapping);
    return { target, items: await resolvePlan(items), truncated: items.length > MAX_PLAN_ROWS, total: items.length };
  }
  return { target, items: [] as PlanItem[], truncated: false };
}

/** A table as the kinds other than Artiklar och priser read it: the first 1 000 rows, as always. */
const asOrdinaryTable = (file: ExtractedFile): ExtractedFile => (file.kind === "table" && (file.rows?.length ?? 0) > MAX_TABLE_ROWS ? { ...file, rows: file.rows!.slice(0, MAX_TABLE_ROWS), rowCount: MAX_TABLE_ROWS, truncated: true } : file);

/**
 * Up to these sizes an Excel or CSV file is read the ordinary way for recognising what it is (as before, so other kinds
 * of import are unchanged); a larger one, or a text table (.txt), as a stream. A price list is always previewed and
 * imported from the stream.
 */
const ORDINARY_WORKBOOK_BYTES = 2_000_000;
const ORDINARY_CSV_BYTES = 4_000_000;

/** Whether a file may be a price list read as a stream: Excel, CSV/TSV, or a text file whose lines form a table. */
async function priceCandidate(file: File): Promise<boolean> {
  if (isTableFile(file)) return true;
  if (!/\.(txt|prn|dat)$/i.test(file.name) || file.size > MAX_PRICE_FILE_BYTES) return false;
  return textIsTable(new Uint8Array(await file.slice(0, 128 * 1024).arrayBuffer()), file.name);
}

/** The streamed price file as the Import page's table (headings and the first rows; all rows are counted). */
async function tableOfPriceFile(file: File, price: PriceFile): Promise<ExtractedFile> {
  let rowCount = 0;
  for await (const row of price.rows()) { void row; rowCount++; if (rowCount > MAX_CATALOGUE_ROWS) break; }
  return { name: price.name, mimeType: file.type || "text/csv", size: file.size, kind: "table", headers: price.info.headers, rows: price.sample.slice(0, MAX_TABLE_ROWS), rowCount, truncated: rowCount > MAX_TABLE_ROWS, ...(price.info.sheet ? { sheet: price.info.sheet } : {}) };
}

async function analyze(ctx: Context, request: Request) {
  const form = await readLimitedFormData(request, MAX_UPLOAD_BYTES);
  const files = form.getAll("file").filter((item): item is File => item instanceof File);
  if (!files.length) throw new ApiError(400, "Välj minst en fil.");
  // Artiklar och priser with another column choice (prisfil 2026-10-08): the browser sends the file again rather than
  // its rows, so a price list of any length is previewed from every row without the rows travelling back and forth.
  // Prisfiler etapp 1 (2026-10-12): with how the file is read (headings, fixed-width positions, sheet) and parsed
  // (price scale, article number as E-nummer); the answer says how it was read, so the page can show the new columns.
  if (form.get("action") === "plan") {
    const letter = await readRebateFile(files[0], todayInSweden());
    if (letter) return NextResponse.json({ plan: await rebatePlan(letter, ctx) });
    let raw: unknown;
    try { raw = JSON.parse(String(form.get("mapping") ?? "{}")); } catch { throw new ApiError(400, "Ogiltiga kolumnval."); }
    const mapping = mappingSchema.parse(raw);
    const price = await openUploadedPriceFile(files[0], formJson(form, "format", priceFormatSchema));
    // "remap": the file is read another way (other headings or positions), so its columns are suggested anew.
    const remap = form.get("remap") === "1";
    const suggested = remap ? suggestCatalogueColumns(price.info.headers, price.sample, price.info) : null;
    const used = suggested ? suggested.mapping : mapping;
    // Read anew: a known layout brings its own price scale and kind; the price column's heading suggests the kind.
    const sent = formJson(form, "parse", priceParseSchema);
    const parse = suggested ? { ...sent, ...parseOfColumns(suggested) } : sent;
    return NextResponse.json({ plan: await cataloguePlan(price, used, parse, ctx) });
  }
  if (files.length > MAX_FILES) throw new ApiError(413, `Högst ${MAX_FILES} filer åt gången.`);
  const wantAi = form.get("ai") === "1";
  const keys = String(form.get("keys") ?? "").split(",").filter(Boolean);
  const aiAvailable = await aiImportAvailability(ctx);
  const results = [];
  for (const file of files) {
    // A discount letter (2026-10-14) is read for what it is first: rules, not a price list.
    const letter = await readRebateFile(file, todayInSweden());
    if (letter) {
      results.push({ id: `${Date.now().toString(36)}-${results.length}`, file: tableOfRebate(file, letter),
        detection: { target: "catalogue" as const, confidence: 1, reasons: [letter.format.label], mapping: {}, candidates: [{ target: "catalogue" as const, confidence: 1 }], questions: [], rowCount: letter.rows.length },
        plan: await rebatePlan(letter, ctx), ai: { used: false, reason: wantAi ? "Filer med priser skickas aldrig till Workflow AI. Reglerna gör analysen." : "" }, saved: null, saveError: "" });
      continue;
    }
    // A price list (any CSV or text table, a large Excel file) is read as a stream (prisfiler etapp 1, 2026-10-12);
    // a small Excel file the ordinary way. Every kind but Artiklar och priser uses the first 1 000 rows.
    const price = await priceCandidate(file) ? await openUploadedPriceFile(file).catch(() => null) : null;
    const ordinary = isTableFile(file) && file.size <= (isWorkbookName(file.name) ? ORDINARY_WORKBOOK_BYTES : ORDINARY_CSV_BYTES);
    const streamed = Boolean(price) && !ordinary;
    const full = price && streamed ? await tableOfPriceFile(file, price) : await extractFile(file, isTableFile(file) ? { maxRows: MAX_CATALOGUE_ROWS } : {});
    const extracted = asOrdinaryTable(full);
    let detection: Detection = detectImport(extracted);
    // Kolumnförslag (2026-10-12): a table the headings do not settle is read by its content; a price list found that way
    // is Artiklar och priser – and, like every price list, never goes to the AI. A price list found by its headings gets
    // its open fields filled from the content too.
    let columns: ColumnSuggestions | null = null;
    if (price && extracted.kind === "table") {
      columns = suggestCatalogueColumns(price.info.headers, price.sample, price.info);
      const complete = Boolean(columns.mapping.name && columns.mapping.price && (columns.mapping.articleNo || columns.mapping.eNumber));
      // A wholesaler's own price list (2026-10-14) is that, whatever else the headings could also mean.
      if (columns.variant) detection = { ...detection, target: "catalogue", confidence: 1, mapping: columns.mapping, questions: [], reasons: [columns.variant],
        candidates: [{ target: "catalogue", confidence: 1 }, ...detection.candidates.filter((item) => item.target !== "catalogue")] };
      else if (detection.target === "catalogue") detection = { ...detection, mapping: columns.mapping };
      else if (complete && (detection.target === "unknown" || detection.confidence < 0.6)) {
        const content = columns.suggestions.filter((item) => item.source === "content").length;
        detection = { ...detection, target: "catalogue", confidence: 0.7, mapping: columns.mapping, questions: [],
          reasons: [`kolumnerna ser ut som en prislista${content ? ` (${content} föreslagna från innehållet – kontrollera dem)` : ""}`],
          candidates: [{ target: "catalogue", confidence: 0.7 }, ...detection.candidates.filter((item) => item.target !== "catalogue")] };
      }
    }
    // Frånvaro (2026-10-29): a file with the same headings as one imported before uses the company's saved column choice.
    if (extracted.kind === "table" && (detection.target === "absence" || detection.target === "unknown" || detection.confidence < 0.9)) {
      const saved = await savedAbsenceMapping(ctx.organizationId, extracted.headers ?? []).catch(() => null);
      if (saved) detection = { ...detection, target: "absence", confidence: 1, mapping: saved, questions: [], reasons: ["samma kolumner som en tidigare importerad frånvarofil"],
        candidates: [{ target: "absence", confidence: 1 }, ...detection.candidates.filter((item) => item.target !== "absence")] };
    }
    let ai: { used: boolean; reason?: string; chargedCredits?: number; model?: string } = { used: false, reason: wantAi ? aiAvailable.reason : "" };
    // The AI is asked when the person wants it and the rules are unsure what the file is – never to double-check a
    // file the rules already call an attachment (2026-10-02: a reference manual cost credits for that alone).
    // A price list is never sent to the AI, not even to ask what it is (grossistimport 2026-10-08).
    const priceFile = detection.target === "catalogue" || looksLikePriceFile(extracted) || Boolean(columns?.mapping.price);
    if (wantAi && priceFile) ai = { used: false, reason: "Filer med priser skickas aldrig till Workflow AI. Reglerna gör analysen." };
    // Kompetens (2026-10-08): people's trainings are personal data and never go to the AI either.
    else if (wantAi && detection.target === "competence") ai = { used: false, reason: "Kompetensuppgifter skickas aldrig till Workflow AI. Reglerna gör analysen." };
    // Frånvaro and staff numbers are personal data (sick leave may be health data): never to the AI either.
    else if (wantAi && (detection.target === "absence" || detection.target === "employee_numbers")) ai = { used: false, reason: "Frånvaro och personaluppgifter skickas aldrig till Workflow AI. Reglerna gör analysen." };
    else if (wantAi && aiAvailable.ok && detection.target !== "attachment" && (detection.target === "unknown" || detection.confidence < 0.9)) {
      const outcome = await analyzeWithAi(ctx, extracted, detection);
      if (outcome.used) {
        detection = mergeAiDetection(detection, extracted, outcome.result);
        ai = { used: true, chargedCredits: outcome.chargedCredits, model: outcome.model };
        // The rows the AI read travel with the file, so the plan (and a later change of kind) can use them.
        if (extracted.kind === "text" && outcome.result.rows.length) extracted.aiRows = outcome.result.rows;
      }
      else ai = { used: false, reason: outcome.reason };
    }
    const plan = detection.target === "catalogue" && price ? await cataloguePlan(price, detection.mapping, columns ? parseOfColumns(columns) : { priceKind: "NET" }, ctx)
      : ["unknown", "attachment", "forms_file", "hwf_file", "catalogue"].includes(detection.target) ? null : await planFor(extracted, detection.target, detection.mapping, keys, ctx);
    // The rows travel back to the browser, so the person can change the mapping without uploading again – at most
    // 1 000 of them, with the number of rows the file had (a price list is sent again instead, see "plan" above).
    // A plain attachment is saved at once; the person picks the task afterwards, from the list of saved files.
    const savedFile = detection.target === "attachment" ? await saveFile(ctx, file) : { saved: null, saveError: "" };
    results.push({ id: `${Date.now().toString(36)}-${results.length}`, file: { ...extracted, rowCount: full.rowCount, truncated: full.truncated }, detection, plan, ai, saved: savedFile.saved, saveError: savedFile.saveError });
  }
  return NextResponse.json({ files: results, aiAvailable });
}

/**
 * The Import page (2026-10-01). analyze: reads the files, lets the rules (and, when allowed, the AI) say what
 * they are, and returns the plan for the person to check. plan: the plan again for another kind or mapping. apply:
 * creates the rows with the same tools as the API, MCP and Workflow AI – every row goes through the ordinary route with
 * the person's own permissions, so nothing is written that the person could not write by hand.
 */
/** The person's own saved files, or one of them as a download. */
export async function GET(request: Request) {
  try {
    const ctx = await context();
    requireCloudStorage(ctx);
    const where = { organizationId: ctx.organizationId, userId: ctx.user.id };
    const id = new URL(request.url).searchParams.get("file");
    if (!id) return NextResponse.json({ files: await prisma.importedFile.findMany({ where, orderBy: { createdAt: "desc" }, take: MAX_SAVED_FILES, select: savedSelect }) });
    const file = await prisma.importedFile.findFirst({ where: { ...where, id } });
    if (!file) throw new ApiError(404, "Filen hittades inte.");
    return new Response(new Uint8Array(await read(file.storagePath)), { headers: { "Content-Type": file.mimeType, "Content-Disposition": `${file.mimeType.startsWith("image/") ? "inline" : "attachment"}; filename*=UTF-8''${encodeURIComponent(file.filename)}`, "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff" } });
  } catch (error) {
    return failure(error);
  }
}

export async function POST(request: Request) {
  try {
    checkOrigin(request);
    const ctx = await context();
    requireCloudStorage(ctx);
    if ((request.headers.get("content-type") ?? "").includes("multipart/form-data")) return await analyze(ctx, request);
    const input = requestSchema.parse(await body(request));
    if (input.action === "plan") return NextResponse.json({ plan: await planFor(input.file as ExtractedFile, input.target, input.mapping, input.keys, ctx, input.codeMap) });
    if (input.action === "absence_apply") {
      requireModule(ctx, "time");
      const { file, ...rest } = input;
      return NextResponse.json(await applyAbsenceImport(ctx, file as ExtractedFile, rest));
    }
    if (input.action === "employee_numbers_apply") { requireModule(ctx, "time"); return NextResponse.json(await applyEmployeeNumbers(ctx, input.file as ExtractedFile, input.mapping)); }
    if (input.action === "discard") {
      const file = await prisma.importedFile.findFirst({ where: { id: input.id, organizationId: ctx.organizationId, userId: ctx.user.id } });
      if (!file) throw new ApiError(404, "Filen hittades inte.");
      await prisma.importedFile.delete({ where: { id: file.id } });
      await remove(file.storagePath);
      return NextResponse.json({ ok: true });
    }
    if (input.action === "attach") {
      await requireCloudWriteAccess(ctx);
      const file = await prisma.importedFile.findFirst({ where: { id: input.id, organizationId: ctx.organizationId, userId: ctx.user.id } });
      if (!file) throw new ApiError(404, "Filen hittades inte.");
      const task = await prisma.workflowTask.findFirst({ where: { id: input.taskId, organizationId: ctx.organizationId } });
      if (!task) throw new ApiError(404, "Uppgiften hittades inte.");
      requireWorkflowPermission(ctx, workflowSubjectForTask(task.kind, task.formArea), "edit");
      if (task.status === "COMPLETED" || task.status === "CANCELLED") throw new ApiError(409, task.status === "CANCELLED" ? "Jobbet har utgått. Återuppta det innan du ändrar det." : "En slutförd uppgift kan inte ändras.");
      const limit = workflowTaskAttachmentLimit(task.kind);
      if (await prisma.workflowTaskAttachment.count({ where: { taskId: task.id, organizationId: ctx.organizationId } }) >= limit) throw new ApiError(400, `Max ${limit} bilagor per uppgift.`);
      // The stored file is handed over, not copied: the attachment takes the path, the saved-file row goes.
      const [attachment] = await prisma.$transaction([
        prisma.workflowTaskAttachment.create({ data: { organizationId: ctx.organizationId, taskId: task.id, filename: file.filename, storagePath: file.storagePath, mimeType: file.mimeType, size: file.size }, select: { id: true } }),
        prisma.importedFile.delete({ where: { id: file.id } }),
      ]);
      return NextResponse.json({ id: attachment.id, taskTitle: task.title });
    }

    const results: { index: number; title: string; kind: PlanItem["kind"]; ok: boolean; id?: string; url?: string; error?: string; skipped?: boolean }[] = [];
    const counts = { created: 0, skipped: 0, failed: 0 };
    for (const item of input.items) {
      if (item.skip) { results.push({ index: item.index, title: item.title, kind: item.kind, ok: true, skipped: true }); counts.skipped++; continue; }
      try {
        if (item.kind === "competence") {
          // The same change as the competence tab, in the person's own session and rights (admins only).
          await requireCloudWriteAccess(ctx);
          requireModule(ctx, "self_inspection");
          const action = selfInspectionActionSchema.parse({ action: "save_credential", credential: { personId: String(item.data.personId ?? ""), title: item.data.title, provider: item.data.provider ?? "",
            issuedAt: item.data.issuedAt ?? null, validUntil: item.data.validUntil ?? null, note: item.data.note ?? "" } });
          await applyCloudSelfInspectionAction(ctx, action);
          results.push({ index: item.index, title: item.title, kind: item.kind, ok: true, url: "/?view=self_inspection&tab=competence" });
          counts.created++;
          continue;
        }
        const created = await runTool(TOOL_OF[item.kind], item.data) as Input;
        const id = String(created.id ?? "");
        const url = typeof created.url === "string" ? created.url : item.kind === "customer" ? `/?view=customers&customerId=${encodeURIComponent(id)}` : item.kind === "planned_activity" ? "/?view=planning" : undefined;
        results.push({ index: item.index, title: item.title, kind: item.kind, ok: true, id, url });
        counts.created++;
      } catch (error) {
        const message = error instanceof ToolError || error instanceof SelfInspectionError || error instanceof ApiError ? error.message : "Raden kunde inte sparas.";
        const status = error instanceof ToolError || error instanceof SelfInspectionError || error instanceof ApiError ? error.status : 0;
        results.push({ index: item.index, title: item.title, kind: item.kind, ok: false, error: message });
        counts.failed++;
        // Without the right to create, every later row would fail the same way.
        if (status === 403) { for (const rest of input.items.slice(input.items.indexOf(item) + 1)) { results.push({ index: rest.index, title: rest.title, kind: rest.kind, ok: false, error: message }); counts.failed++; } break; }
      }
    }
    const kinds = [...new Set(input.items.map((item) => KIND_LABEL[item.kind]))].join(", ");
    await prisma.administrationEvent.create({ data: { actorId: ctx.user.id, organizationId: ctx.organizationId, action: "import_apply", detail: `Import (${kinds}): ${counts.created} skapade, ${counts.skipped} överhoppade, ${counts.failed} misslyckade.` } });
    return NextResponse.json({ results, counts });
  } catch (error) {
    return failure(error);
  }
}
