import { randomUUID } from "node:crypto";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { ApiError } from "@/lib/kfid/errors";
import { verifyTaskReferences } from "@/lib/kfid/task-references-server";
import { requireSavedTaskLevels } from "@/lib/self-inspection/levels-server";
import { recordFeature } from "@/lib/analytics/record";
import type { CountingSubject } from "@/lib/analytics/exclusion";
import { articleHitById } from "@/lib/catalogue/server";
import { applyArticle, todayInSweden } from "@/lib/catalogue/snapshot";
import { applyRiskStepOnSave } from "@/lib/workflow/risk-step-server";
import { workflowTaskDataSchema, workflowTaskInputSchema, workflowTaskProgress } from "@/lib/workflow/task-model";
import { startForNewJob } from "@/lib/workflow/job-planning";
import { agreedQuoteVersions, compareQuotedUsed, quoteLinesFromMaterials, workOrderPlanFromQuote, type QuoteComparison } from "./conversion";
import { effectiveQuoteStatus, quoteLabel, QUOTE_VAT_PERCENT, quoteTotals, type QuoteLineView, type QuoteStatus } from "./model";
import { getQuote, lineView, quoteAccess, readPriceSettings, requireQuotes, workOrderAccess, type QuoteCaller } from "./server";

/**
 * Offert steg C on the server (2026-10-09). Bound to the caller's company like the rest of lib/quotes/server.ts:
 * - `quoteMaterialSource`: a project's or a work order's material rows as quote lines for a new quote (Offerter – redigera
 *   and Arbetsorder – läsa). Nothing is saved; the page shows the lines in a new draft that the person saves.
 * - `createWorkOrderFromQuote`: an accepted quote becomes a new work order with the quote's Material lines as its
 *   material, its Övrigt lines as expense rows and its Arbete lines as Uppskattad tid and an "Offererat arbete" summary
 *   (Offerter – läsa and Arbetsorder – skapa), checked like any new work order (references, levels, risk step).
 * - `projectQuoteSummary`: the project's quotes and, with Arbetsorder – läsa, Offererat mot använt (material, the quoted
 *   hours against the time reported on the project's work orders, and Övrigt against their expense rows).
 */

const MATERIAL_SOURCE_LIMIT = 500;
type WorkOrderRow = { id: string; title: string; data: Prisma.JsonValue };
const materialsOf = (rows: WorkOrderRow[]) => rows.flatMap((row) => {
  const parsed = workflowTaskDataSchema.safeParse(row.data);
  return parsed.success && parsed.data.kind === "WORK_ORDER" ? parsed.data.details.materials : [];
});

export async function quoteMaterialSource(caller: QuoteCaller, source: { projectId?: string; taskId?: string }) {
  requireQuotes(caller, "edit");
  if (!workOrderAccess(caller).read) throw new ApiError(403, "Du saknar behörighet att läsa arbetsordrar.");
  let name = "", projectId: string | null = null, customerId: string | null = null, facilityId: string | null = null;
  let rows: WorkOrderRow[];
  if (source.taskId) {
    const order = await prisma.workflowTask.findFirst({ where: { id: source.taskId, organizationId: caller.organizationId, kind: "WORK_ORDER" }, select: { id: true, title: true, data: true, projectId: true, customerId: true, facilityId: true } });
    if (!order) throw new ApiError(404, "Arbetsordern hittades inte.");
    rows = [order];
    ({ projectId, customerId, facilityId } = order);
    name = order.title;
  } else if (source.projectId) {
    const project = await prisma.project.findFirst({ where: { id: source.projectId, organizationId: caller.organizationId }, select: { id: true, name: true, customerId: true, facilityId: true } });
    if (!project) throw new ApiError(404, "Projektet hittades inte.");
    rows = await prisma.workflowTask.findMany({ where: { organizationId: caller.organizationId, projectId: project.id, kind: "WORK_ORDER" }, orderBy: [{ updatedAt: "desc" }, { id: "asc" }], take: MATERIAL_SOURCE_LIMIT, select: { id: true, title: true, data: true } });
    ({ customerId, facilityId } = project);
    projectId = project.id;
    name = project.name;
  } else throw new ApiError(400, "Ange ett projekt eller en arbetsorder.");
  const settings = await readPriceSettings(caller.organizationId);
  const result = quoteLinesFromMaterials(materialsOf(rows), { companyMarkup: settings.markupPercent, newId: randomUUID });
  // A line without a price of its own but with a catalogue copy gets the catalogue's latest price (with its source and date).
  const lines = await Promise.all(result.lines.map(async (line): Promise<QuoteLineView> => {
    if (line.unitPrice || !line.catalogue?.articleId) return line;
    const hit = await articleHitById(caller.organizationId, line.catalogue.articleId);
    if (!hit) return line;
    const priced = applyArticle({ id: line.id, name: line.name, quantity: line.quantity, unit: line.unit }, { ...hit, priceHidden: false });
    // Only when the article is priced in the line's own unit; a line in another unit stays without à-pris.
    if (priced.unit.toLocaleLowerCase("sv-SE") !== line.unit.toLocaleLowerCase("sv-SE")) return line;
    return { ...line, unitPrice: priced.unitPrice ?? "", ...(priced.catalogue ? { catalogue: priced.catalogue } : {}) };
  }));
  return { name, projectId, customerId, facilityId, lines, rows: result.rows, mixedPrices: result.mixedPrices };
}

const json = (value: unknown) => JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;

export async function createWorkOrderFromQuote(caller: QuoteCaller, actor: { id: string; name?: string | null; email?: string | null; /** Beteendeanalys: the caller's request context. */ analytics?: CountingSubject }, quoteId: string, today = todayInSweden()): Promise<{ id: string; materials: number; expenses: number; estimatedMinutes: number | null }> {
  requireQuotes(caller, "read");
  if (!workOrderAccess(caller).create) throw new ApiError(403, "Du saknar behörighet att skapa arbetsordrar.");
  const quote = await getQuote(caller, quoteId, today);
  if (quote.storedStatus !== "ACCEPTED") throw new ApiError(409, "Bara en accepterad offert kan bli en arbetsorder.");
  const plan = workOrderPlanFromQuote(quote, quote.lines, randomUUID);
  if (plan.rows.length > 200) throw new ApiError(422, "En arbetsorder har högst 200 rader för material och utgifter. Dela upp offerten.");
  const project = quote.project ? await prisma.project.findFirst({ where: { id: quote.project.id, organizationId: caller.organizationId }, select: { customerId: true, startDate: true, dueDate: true } }) : null;
  // Plan 1K (2026-10-11): the order names the quote it follows, so its guided flow asks for Ansvarig and Klart senast
  // first (lib/workflow/task-flow.ts); the quote's Giltig till never becomes a date on the job (no dueDate here).
  const task = workflowTaskInputSchema.parse({
    kind: "WORK_ORDER", title: quote.title.slice(0, 200), description: plan.description,
    status: "PLANNED", projectId: quote.project?.id ?? null, customerId: project?.customerId ?? (quote.customer?.id || null), facilityId: quote.facility?.id ?? null,
    estimatedMinutes: plan.estimatedMinutes, data: { kind: "WORK_ORDER", details: { materials: plan.rows, quote: { quoteId: quote.id, label: quote.label, version: quote.version } } },
  });
  // The same checks as a new work order saved from its page (app/api/workflow-tasks).
  await verifyTaskReferences(caller.organizationId, task, { canReadWorkOrders: workOrderAccess(caller).read });
  await requireSavedTaskLevels(caller.organizationId, actor, { task, formTemplateId: null, documented: false });
  await applyRiskStepOnSave(caller.organizationId, actor, task, { formArea: null, formTemplateId: null });
  const progress = workflowTaskProgress(task);
  const snapshot = json(task);
  const created = await prisma.$transaction(async (tx) => {
    const row = await tx.workflowTask.create({
      data: {
        organizationId: caller.organizationId, projectId: task.projectId, customerId: task.customerId, facilityId: task.facilityId, kind: "WORK_ORDER",
        title: task.title, description: task.description, status: task.status, progress, dueDate: task.dueDate, data: json(task.data),
        // Offererat arbete: the Arbete lines in hours as Uppskattad tid (the project's Tidplan reads and changes it).
        estimatedMinutes: plan.estimatedMinutes,
        // Start på alla jobb (plan 1M): the order starts today (inside its project's frame).
        plannedStartDate: startForNewJob({ today, frame: project ? { startDate: project.startDate ?? "", dueDate: project.dueDate ?? "" } : null }),
        createdBy: caller.userId, updatedBy: caller.userId, revisions: { create: { version: 1, snapshot, createdBy: caller.userId } },
      },
      select: { id: true },
    });
    // The link back on the quote; the database allows it on an accepted quote only.
    await tx.quote.updateMany({ where: { id: quote.id, organizationId: caller.organizationId, status: "ACCEPTED" }, data: { workOrderId: row.id } });
    if (task.projectId) await tx.projectEvent.create({ data: { organizationId: caller.organizationId, projectId: task.projectId, kind: "UPDATED", summary: `Arbetsordern ${task.title} skapades från offert ${quote.label}`.slice(0, 500), taskId: row.id, actorName: actor.name || actor.email || "", createdBy: caller.userId } });
    return row;
  });
  recordFeature("task_created_WORK_ORDER", actor.analytics);
  return { id: created.id, materials: plan.materials, expenses: plan.expenses, estimatedMinutes: plan.estimatedMinutes };
}

export type QuoteWorkOrderSummary = {
  /** The work orders made from the quote (every one, plan 1D), newest first. */
  workOrders: { id: string; title: string; status: string }[];
  /** Offererat mot använt for the quote's own work orders (the same rule as the project's); null without Arbetsorder – läsa or when the quote is not the agreement. */
  comparison: QuoteComparison | null;
};

/**
 * Offererat mot använt on a quote (plan 1K, 2026-10-11): the quote's lines against the material, time and expenses on
 * the work orders made from it – the same calculation as the project's, so an order made from a quote without a project
 * reads the same. Only an accepted (agreed) version is compared; the quote's work orders are listed for any version.
 */
export async function quoteWorkOrderSummary(caller: QuoteCaller, quoteId: string, today = todayInSweden()): Promise<QuoteWorkOrderSummary> {
  const quote = await getQuote(caller, quoteId, today);
  if (!workOrderAccess(caller).read || !quote.workOrders.length) return { workOrders: quote.workOrders, comparison: null };
  const ids = quote.workOrders.map((order) => order.id);
  const [orders, time] = await Promise.all([
    prisma.workflowTask.findMany({ where: { organizationId: caller.organizationId, id: { in: ids }, kind: "WORK_ORDER" }, select: { id: true, title: true, data: true } }),
    prisma.workflowTimeEntry.aggregate({ where: { endedAt: { not: null }, task: { organizationId: caller.organizationId, id: { in: ids }, kind: "WORK_ORDER" } }, _sum: { durationSec: true } }),
  ]);
  const comparison = quote.storedStatus === "ACCEPTED" ? compareQuotedUsed(quote.lines, materialsOf(orders), time._sum.durationSec ?? 0) : null;
  return { workOrders: quote.workOrders, comparison };
}

export type ProjectQuoteItem = { id: string; label: string; title: string; status: QuoteStatus; version: number; changeOfVersion: number | null; net: number };
export type ProjectQuoteSummary = {
  quotes: ProjectQuoteItem[];
  /** Offererat mot använt (only with Arbetsorder – läsa): the agreed versions' material against the work orders' material. */
  comparison: QuoteComparison | null;
  /** The versions the comparison counts as agreed: per quote number the latest accepted version. */
  agreed: { id: string; label: string }[];
  canCreate: boolean;
};

export async function projectQuoteSummary(caller: QuoteCaller, projectId: string, today = todayInSweden()): Promise<ProjectQuoteSummary> {
  requireQuotes(caller, "read");
  const project = await prisma.project.findFirst({ where: { id: projectId, organizationId: caller.organizationId }, select: { id: true } });
  if (!project) throw new ApiError(404, "Projektet hittades inte.");
  const rows = await prisma.quote.findMany({
    where: { organizationId: caller.organizationId, projectId }, orderBy: [{ number: "asc" }, { version: "asc" }], take: 200,
    select: { id: true, number: true, version: true, title: true, status: true, validUntil: true, supersededAt: true, changeOfVersion: true, vatPercent: true, lines: { orderBy: [{ position: "asc" }, { id: "asc" }], select: { id: true, kind: true, name: true, quantity: true, unit: true, unitPrice: true, markupPercent: true, catalogue: true, rotLabour: true, position: true } } },
  });
  const decimal = (value: Prisma.Decimal | null) => value === null ? null : Number(value.toString());
  const quotes = rows.filter((row) => !row.supersededAt).map((row): ProjectQuoteItem => ({
    id: row.id, label: quoteLabel(row), title: row.title, status: effectiveQuoteStatus(row, today), version: row.version, changeOfVersion: row.changeOfVersion,
    net: quoteTotals(row.lines.map(lineView), decimal(row.vatPercent) ?? QUOTE_VAT_PERCENT).net,
  })).reverse();
  // Per number, the latest accepted version is the agreement (an ÄTA accepted later replaces the one before).
  const agreed = agreedQuoteVersions(rows);
  let comparison: QuoteComparison | null = null;
  if (workOrderAccess(caller).read) {
    const [orders, time] = await Promise.all([
      prisma.workflowTask.findMany({ where: { organizationId: caller.organizationId, projectId, kind: "WORK_ORDER" }, orderBy: [{ updatedAt: "desc" }, { id: "asc" }], take: MATERIAL_SOURCE_LIMIT, select: { id: true, title: true, data: true } }),
      // Rapporterad tid on the project's work orders and the project's own time (Projekttid, 2026-10-26), finished entries.
      prisma.workflowTimeEntry.aggregate({ where: { endedAt: { not: null }, OR: [{ task: { is: { organizationId: caller.organizationId, projectId, kind: "WORK_ORDER" } } }, { project: { is: { organizationId: caller.organizationId, id: projectId } } }] }, _sum: { durationSec: true } }),
    ]);
    comparison = compareQuotedUsed(agreed.flatMap((row) => row.lines.map(lineView)), materialsOf(orders), time._sum.durationSec ?? 0);
  }
  return { quotes, comparison, agreed: agreed.map((row) => ({ id: row.id, label: quoteLabel(row) })), canCreate: quoteAccess(caller).edit };
}
