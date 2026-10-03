import { NextResponse } from "next/server";
import { z } from "zod";
import * as tasksRoute from "@/app/api/workflow-tasks/route";
import { prisma } from "@/lib/db";
import { ApiError, body, checkOrigin, context, failure, requireCloudStorage, requireCloudWriteAccess, requireWorkflowPermission, type Context } from "@/lib/kfid/server";
import { read, remove, store } from "@/lib/kfid/storage";
import { workflowSubjectForTask } from "@/lib/workflow/permissions";
import { workflowTaskAttachmentLimit } from "@/lib/workflow/task-model";
import { prepareAttachmentFile } from "@/lib/workflow/attachment-file";
import { callRoute, ToolError } from "@/lib/tools/call-route";
import { runTool } from "@/lib/tools/registry";
import { aiImportAvailability, analyzeWithAi, mergeAiDetection } from "@/lib/import/ai";
import { buildPlan, controlPointsOf, detectImport, IMPORT_TARGETS, TARGET_FIELDS, textToWorkOrder, textToWorkOrderRows, aiRowsToWorkOrders, type Detection, type ExtractedFile, type ImportTarget, type PlanItem } from "@/lib/import/detect";
import { extractFile } from "@/lib/import/extract";

export const dynamic = "force-dynamic";

const MAX_FILES = 10;
const MAX_PLAN_ROWS = 300;
const MAX_SAVED_FILES = 50;
type Input = Record<string, unknown>;

const extractedSchema = z.object({
  name: z.string().min(1).max(200), mimeType: z.string().max(200), size: z.number().int().nonnegative(),
  kind: z.enum(["table", "text", "json", "binary"]),
  headers: z.array(z.string().max(200)).max(60).optional(), rows: z.array(z.array(z.string().max(2000)).max(60)).max(1000).optional(), sheet: z.string().max(200).optional(),
  text: z.string().max(60_000).optional(), json: z.unknown().optional(),
  aiRows: z.array(z.object({ section: z.string().max(120), title: z.string().max(200), description: z.string().max(1000), date: z.string().max(10) })).max(200).optional(),
});
const mappingSchema = z.record(z.string().max(40), z.string().max(200).nullable());
const planItemSchema = z.object({
  index: z.number().int().nonnegative(), kind: z.enum(["customer", "project", "work_order", "planned_activity"]), title: z.string().max(200),
  data: z.record(z.string(), z.unknown()), refs: z.object({ project: z.string().max(200).optional(), customer: z.string().max(200).optional(), responsible: z.string().max(200).optional(), assignee: z.string().max(200).optional() }),
  issues: z.array(z.string().max(300)).max(20), duplicateOf: z.object({ id: z.string(), name: z.string() }).nullable().optional(), skip: z.boolean().optional(),
});
const requestSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("plan"), file: extractedSchema, target: z.enum(IMPORT_TARGETS), mapping: mappingSchema.default({}), keys: z.array(z.string().max(40)).max(500).default([]) }),
  z.object({ action: z.literal("apply"), items: z.array(planItemSchema).max(MAX_PLAN_ROWS) }),
  z.object({ action: z.literal("attach"), id: z.string().min(1).max(60), taskId: z.string().min(1).max(60) }),
  z.object({ action: z.literal("discard"), id: z.string().min(1).max(60) }),
]);

const savedSelect = { id: true, filename: true, mimeType: true, size: true, createdAt: true } as const;

/** Saves a file that is just an attachment at once, private to the person, so it is never lost before it has a task (2026-10-02). */
async function saveFile(ctx: Context, file: File) {
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
const KIND_LABEL = { customer: "kund", project: "projekt", work_order: "arbetsorder", planned_activity: "planerad aktivitet" } as const;
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

/** The plan for a file and a chosen kind of import: tool inputs per row, or the sections of a form for control points. */
async function planFor(file: ExtractedFile, target: ImportTarget, mapping: Record<string, string | null>, keys: string[]) {
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
  if (target in TARGET_FIELDS && file.kind === "table") {
    const items = buildPlan(file, target as keyof typeof TARGET_FIELDS, mapping);
    return { target, items: await resolvePlan(items), truncated: items.length > MAX_PLAN_ROWS, total: items.length };
  }
  return { target, items: [] as PlanItem[], truncated: false };
}

async function analyze(ctx: Context, request: Request) {
  const form = await request.formData();
  const files = form.getAll("file").filter((item): item is File => item instanceof File);
  if (!files.length) throw new ApiError(400, "Välj minst en fil.");
  if (files.length > MAX_FILES) throw new ApiError(413, `Högst ${MAX_FILES} filer åt gången.`);
  const wantAi = form.get("ai") === "1";
  const keys = String(form.get("keys") ?? "").split(",").filter(Boolean);
  const aiAvailable = await aiImportAvailability(ctx);
  const results = [];
  for (const file of files) {
    const extracted = await extractFile(file);
    let detection: Detection = detectImport(extracted);
    let ai: { used: boolean; reason?: string; chargedCredits?: number; model?: string } = { used: false, reason: wantAi ? aiAvailable.reason : "" };
    // The AI is asked when the person wants it and the rules are unsure what the file is – never to double-check a
    // file the rules already call an attachment (2026-10-02: a reference manual cost credits for that alone).
    if (wantAi && aiAvailable.ok && detection.target !== "attachment" && (detection.target === "unknown" || detection.confidence < 0.9)) {
      const outcome = await analyzeWithAi(ctx, extracted, detection);
      if (outcome.used) {
        detection = mergeAiDetection(detection, extracted, outcome.result);
        ai = { used: true, chargedCredits: outcome.chargedCredits, model: outcome.model };
        // The rows the AI read travel with the file, so the plan (and a later change of kind) can use them.
        if (extracted.kind === "text" && outcome.result.rows.length) extracted.aiRows = outcome.result.rows;
      }
      else ai = { used: false, reason: outcome.reason };
    }
    const plan = detection.target === "unknown" || detection.target === "attachment" || detection.target === "forms_file" || detection.target === "hwf_file" ? null : await planFor(extracted, detection.target, detection.mapping, keys);
    // The rows travel back to the browser, so the person can change the mapping without uploading again.
    // A plain attachment is saved at once; the person picks the task afterwards, from the list of saved files.
    const savedFile = detection.target === "attachment" ? await saveFile(ctx, file) : { saved: null, saveError: "" };
    results.push({ id: `${Date.now().toString(36)}-${results.length}`, file: extracted, detection, plan, ai, saved: savedFile.saved, saveError: savedFile.saveError });
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
    if (input.action === "plan") return NextResponse.json({ plan: await planFor(input.file as ExtractedFile, input.target, input.mapping, input.keys) });
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
      if (task.status === "COMPLETED") throw new ApiError(409, "En slutförd uppgift kan inte ändras.");
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
        const created = await runTool(TOOL_OF[item.kind], item.data) as Input;
        const id = String(created.id ?? "");
        const url = typeof created.url === "string" ? created.url : item.kind === "customer" ? `/?view=customers&customerId=${encodeURIComponent(id)}` : item.kind === "planned_activity" ? "/?view=planning" : undefined;
        results.push({ index: item.index, title: item.title, kind: item.kind, ok: true, id, url });
        counts.created++;
      } catch (error) {
        const message = error instanceof ToolError ? error.message : "Raden kunde inte sparas.";
        results.push({ index: item.index, title: item.title, kind: item.kind, ok: false, error: message });
        counts.failed++;
        // Without the right to create, every later row would fail the same way.
        if (error instanceof ToolError && error.status === 403) { for (const rest of input.items.slice(input.items.indexOf(item) + 1)) { results.push({ index: rest.index, title: rest.title, kind: rest.kind, ok: false, error: message }); counts.failed++; } break; }
      }
    }
    const kinds = [...new Set(input.items.map((item) => KIND_LABEL[item.kind]))].join(", ");
    await prisma.administrationEvent.create({ data: { actorId: ctx.user.id, organizationId: ctx.organizationId, action: "import_apply", detail: `Import (${kinds}): ${counts.created} skapade, ${counts.skipped} överhoppade, ${counts.failed} misslyckade.` } });
    return NextResponse.json({ results, counts });
  } catch (error) {
    return failure(error);
  }
}
