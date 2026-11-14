import { Prisma } from "@prisma/client";
import { organizationModuleOn } from "@/lib/workflow/modules";
import { prisma } from "@/lib/db";
import { ApiError } from "@/lib/kfid/errors";
import type { Context } from "@/lib/kfid/server";
import { todayInSweden } from "@/lib/catalogue/snapshot";
import { startOfSwedishMonth } from "@/lib/swedish-time";
import { canViewEconomy } from "@/lib/workflow/permissions";
import { readCompanyGoals } from "@/lib/workflow/company-goals-server";
import { visibleCompanyGoals } from "@/lib/workflow/company-goals";
import { readPriceSettings } from "@/lib/quotes/server";
import { timeTypeRules } from "@/lib/workflow/time-types-server";
import { addDays } from "@/lib/quotes/settings";
import { QUOTE_VAT_PERCENT, quoteLabel, quoteTotals, type QuoteLineKind } from "@/lib/quotes/model";
import { invoiceBasisLinesOf, invoiceBasisTotals } from "@/lib/invoice-basis/model";
import { readCreditSummary } from "@/lib/credits/wallet-summary-server";
import { loadAcceptedQuotes } from "./team-server";
import {
  QUOTE_EXPIRY_WINDOW_DAYS, TIME_SOURCE_PREFIX, companyEstimate, daysUntil, economyAccess, hourlyRateOf, invoicedPerMonth, materialSourceKeys, mergeUnbilled, monthKeys, monthLong, quoteWinRate,
  unbilledMaterialGroups, unbilledRows, type EconomyAccess, type EconomyTabData, type MaterialJob, type MoneyCount, type UnbilledGroup,
} from "./economy-model";
import { materialsFromData } from "@/lib/invoice-basis/model";
import { customerTitle } from "@/lib/kfid/customer-name";

export type { EconomyTabData } from "./economy-model";

/**
 * Översikt → Ekonomi on the server (2026-10-28). Only admins and members with Ekonomi – läsa read it (403 for
 * everyone else, also Teamet alone); kronor need the price right besides. Every query is bound to the company and bounded
 * (a limit, or an aggregate in the database); a figure read from a capped set says so (`partial`). What the tab offers to
 * do opens the existing pages and flows: the quote list, the invoice basis list and the proposal of a new basis – nothing
 * here writes.
 */

const UNBILLED_ROWS = 50;
/** Time groups read to merge with the material (oldest first); beyond it they are counted, not listed. */
const UNBILLED_GROUPS = 2000;
/** Completed work orders with unbilled material read at most (oldest first). */
const MATERIAL_JOBS = 2000;
const INVOICED_MONTHS = 6;
const INVOICED_LIMIT = 3000;
const DRAFT_LIMIT = 500;
const QUOTE_SUM_LIMIT = 200;
const EXPIRING_ROWS = 8;
const WIN_RATE_MONTHS = 12;
const WIN_RATE_NUMBERS = 1000;

const decimal = (value: Prisma.Decimal | null) => value === null ? null : Number(value.toString());
const customerName = (customer: { name: string; company: string } | null) => customer ? customerTitle(customer) : "";
const lineNumbers = (line: { kind: string; quantity: Prisma.Decimal; unitPrice: Prisma.Decimal | null; markupPercent: Prisma.Decimal | null }) =>
  ({ kind: line.kind as QuoteLineKind, quantity: decimal(line.quantity) ?? 0, unitPrice: decimal(line.unitPrice), markupPercent: decimal(line.markupPercent) });
const quoteNet = (quote: { vatPercent: Prisma.Decimal; lines: Parameters<typeof lineNumbers>[0][] }) => quoteTotals(quote.lines.map(lineNumbers), decimal(quote.vatPercent) ?? QUOTE_VAT_PERCENT).net;
const basisNet = (basis: { lines: Prisma.JsonValue; vatPercent: Prisma.Decimal }) => invoiceBasisTotals(invoiceBasisLinesOf(basis.lines), decimal(basis.vatPercent) ?? QUOTE_VAT_PERCENT).net;
const quoteLinesSelect = { select: { kind: true, quantity: true, unitPrice: true, markupPercent: true } } as const;

/** A count and, with the price right, the sum of the rows read (capped: `partial` when there were more). */
function moneyCount(count: number, nets: number[], prices: boolean): MoneyCount {
  if (!prices) return { count, net: null };
  return { count, net: Math.round(nets.reduce((sum, net) => sum + net, 0)), ...(count > nets.length ? { partial: true } : {}) };
}

// ---------- ofakturerad tid och material ----------

type UnbilledSqlRow = { kind: "task" | "project"; id: string; seconds: bigint | number; invoiced: bigint | number | null; entries: bigint | number; oldest: Date; totalSeconds: bigint | number; groups: bigint | number };

/**
 * Finished time (endedAt set, durationSec > 0) that no basis has taken (no InvoiceBasisSource "time:<id>" – the key the
 * proposal takes), on the jobs a new basis can take: a COMPLETED work order (grouped under its project when it has one,
 * as the project's basis takes it) and a project's own time. One aggregate in the database: the oldest groups first,
 * with the company's totals over every group. Each group also says how much of its finished time a basis has already taken
 * (2026-10-29: "fakturerat av upparbetat"), so a project billed in parts shows how far it has come. Up to
 * UNBILLED_GROUPS groups, so the material groups can be merged with them.
 */
async function unbilledTimeGroups(organizationId: string) {
  // Beslut 8 (2026-11-01): time of a type the company does not bill is never waiting to be billed.
  const { neverBilled } = await timeTypeRules(organizationId);
  const rows = await prisma.$queryRaw<UnbilledSqlRow[]>`
    WITH src AS (
      SELECT CASE WHEN t."projectId" IS NULL THEN 'task' ELSE 'project' END AS kind, COALESCE(t."projectId", t.id) AS id, e."durationSec" AS sec, e."endedAt" AS ended,
        EXISTS (SELECT 1 FROM "InvoiceBasisSource" s WHERE s."organizationId" = ${organizationId} AND s."sourceKey" = ${TIME_SOURCE_PREFIX} || e.id) AS taken
      FROM "WorkflowTask" t JOIN "WorkflowTimeEntry" e ON e."taskId" = t.id
      WHERE t."organizationId" = ${organizationId} AND t.kind = 'WORK_ORDER' AND t.status = 'COMPLETED'
        AND e."endedAt" IS NOT NULL AND e."durationSec" > 0
        AND (CASE WHEN e."timeTypeId" IS NULL THEN NOT ${neverBilled.standard}::boolean ELSE NOT (e."timeTypeId" = ANY(${neverBilled.ids}::text[])) END)
      UNION ALL
      SELECT 'project' AS kind, p.id AS id, e."durationSec" AS sec, e."endedAt" AS ended,
        EXISTS (SELECT 1 FROM "InvoiceBasisSource" s WHERE s."organizationId" = ${organizationId} AND s."sourceKey" = ${TIME_SOURCE_PREFIX} || e.id) AS taken
      FROM "Project" p JOIN "WorkflowTimeEntry" e ON e."projectId" = p.id AND e."taskId" IS NULL
      WHERE p."organizationId" = ${organizationId}
        AND e."endedAt" IS NOT NULL AND e."durationSec" > 0
        AND (CASE WHEN e."timeTypeId" IS NULL THEN NOT ${neverBilled.standard}::boolean ELSE NOT (e."timeTypeId" = ANY(${neverBilled.ids}::text[])) END)
    ), open_groups AS (
      SELECT kind, id, SUM(sec) FILTER (WHERE NOT taken) AS seconds, SUM(sec) FILTER (WHERE taken) AS invoiced,
        COUNT(*) FILTER (WHERE NOT taken) AS entries, MIN(ended) FILTER (WHERE NOT taken) AS oldest
      FROM src GROUP BY kind, id HAVING COUNT(*) FILTER (WHERE NOT taken) > 0
    )
    SELECT kind, id, seconds::bigint AS seconds, COALESCE(invoiced, 0)::bigint AS invoiced, entries::bigint AS entries, oldest,
      (SUM(seconds) OVER ())::bigint AS "totalSeconds", (COUNT(*) OVER ())::bigint AS groups
    FROM open_groups ORDER BY oldest ASC, id ASC LIMIT ${UNBILLED_GROUPS}`;
  const groups: UnbilledGroup[] = rows.map((row) => ({ kind: row.kind, id: row.id, seconds: Number(row.seconds), invoicedSeconds: Number(row.invoiced ?? 0), entries: Number(row.entries), oldest: new Date(row.oldest) }));
  return { groups, totalSeconds: Number(rows[0]?.totalSeconds ?? 0), total: Number(rows[0]?.groups ?? 0) };
}

type MaterialSqlRow = { id: string; projectId: string | null; completedAt: Date | null; updatedAt: Date; data: unknown };

/**
 * Ofakturerat material (2026-10-29): COMPLETED work orders with a material or expense row whose key ("row:<task>:<row>",
 * the proposal's own) no basis has taken – the database narrows it down, the proposal's rule (lib/invoice-basis/model.ts)
 * decides which rows count and what they cost. Only the rows are read from the data, oldest completion first, bounded.
 */
async function unbilledMaterialSection(organizationId: string, prices: boolean) {
  const rows = await prisma.$queryRaw<MaterialSqlRow[]>`
    SELECT t.id, t."projectId", t."completedAt", t."updatedAt",
      jsonb_build_object('kind', t.data -> 'kind', 'details', jsonb_build_object('materials', t.data #> '{details,materials}')) AS data
    FROM "WorkflowTask" t
    WHERE t."organizationId" = ${organizationId} AND t.kind = 'WORK_ORDER' AND t.status = 'COMPLETED'
      AND jsonb_typeof(t.data #> '{details,materials}') = 'array'
      AND EXISTS (
        SELECT 1 FROM jsonb_array_elements(CASE WHEN jsonb_typeof(t.data #> '{details,materials}') = 'array' THEN t.data #> '{details,materials}' ELSE '[]'::jsonb END) m
        WHERE jsonb_typeof(m) = 'object' AND COALESCE(m ->> 'id', '') <> ''
          AND NOT EXISTS (SELECT 1 FROM "InvoiceBasisSource" s WHERE s."organizationId" = ${organizationId} AND s."sourceKey" = 'row:' || t.id || ':' || (m ->> 'id'))
      )
    ORDER BY COALESCE(t."completedAt", t."updatedAt") ASC, t.id ASC LIMIT ${MATERIAL_JOBS}`;
  const jobs: MaterialJob[] = rows.map((row) => ({ taskId: row.id, projectId: row.projectId, completedAt: new Date(row.completedAt ?? row.updatedAt), materials: materialsFromData(row.data) }));
  const keys = materialSourceKeys(jobs);
  const taken = new Set<string>();
  for (let start = 0; start < keys.length; start += 5000) {
    const found = await prisma.invoiceBasisSource.findMany({ where: { organizationId, sourceKey: { in: keys.slice(start, start + 5000) } }, select: { sourceKey: true } });
    for (const item of found) taken.add(item.sourceKey);
  }
  return { groups: unbilledMaterialGroups(jobs, taken, prices), partial: rows.length >= MATERIAL_JOBS };
}

async function unbilledSection(organizationId: string, access: EconomyAccess, now: Date): Promise<NonNullable<EconomyTabData["unbilled"]>> {
  const [time, material, settings] = await Promise.all([unbilledTimeGroups(organizationId), unbilledMaterialSection(organizationId, access.prices), access.prices ? readPriceSettings(organizationId) : null]);
  const rate = settings ? hourlyRateOf(settings.hourlyRate) : null;
  const all = mergeUnbilled(time.groups, material.groups);
  // Groups beyond what the time query returned are counted, not listed (a long-billed company has thousands).
  const total = all.length + Math.max(0, time.total - time.groups.length);
  const groups = all.slice(0, UNBILLED_ROWS);
  const taskIds = groups.filter((group) => group.kind === "task").map((group) => group.id);
  const projectIds = groups.filter((group) => group.kind === "project").map((group) => group.id);
  const [tasks, projects] = await Promise.all([
    taskIds.length && access.readWorkOrders ? prisma.workflowTask.findMany({ where: { organizationId, id: { in: taskIds } }, select: { id: true, title: true, customer: { select: { name: true, company: true, customerType: true } } } }) : [],
    projectIds.length && access.readProjects ? prisma.project.findMany({ where: { organizationId, id: { in: projectIds } }, select: { id: true, name: true, customer: { select: { name: true, company: true, customerType: true } } } }) : [],
  ]);
  const names = {
    tasks: new Map(tasks.map((task) => [task.id, { title: task.title, customer: customerName(task.customer) }])),
    projects: new Map(projects.map((project) => [project.id, { title: project.name, customer: customerName(project.customer) }])),
  };
  const { rows, hidden } = unbilledRows(groups, names, access, rate, now);
  const partial = material.partial || time.total > time.groups.length;
  return {
    hourlyRate: rate !== null, totalSeconds: time.totalSeconds,
    // The company's estimate: all unbilled hours (the query's total) × the rate, plus the material read.
    totalEstimate: access.prices ? companyEstimate(time.totalSeconds, all, rate) : null,
    ...(partial ? { partial: true } : {}),
    totalMaterialRows: all.reduce((sum, group) => sum + (group.materialRows ?? 0), 0),
    groups: total, rows, hidden, more: Math.max(0, total - groups.length),
  };
}

// ---------- fakturerat ----------

async function invoicedSection(organizationId: string, access: EconomyAccess, today: string, now: Date) {
  const keys = monthKeys(today, INVOICED_MONTHS);
  // A day early, so the first month's first Swedish day is in; the month is decided by the Swedish day below.
  const since = new Date(startOfSwedishMonth(now, -(INVOICED_MONTHS - 1)).getTime() - 86_400_000);
  const invoicedWhere: Prisma.InvoiceBasisWhereInput = { organizationId, status: "INVOICED", invoicedAt: { gte: since } };
  const invoicedOrder: Prisma.InvoiceBasisOrderByWithRelationInput[] = [{ invoicedAt: "desc" }, { id: "asc" }];
  const [invoiced, drafts, draftCount] = await Promise.all([
    // The lines (for the amounts) only for someone who may see them; the others get the count per month.
    access.prices
      ? prisma.invoiceBasis.findMany({ where: invoicedWhere, orderBy: invoicedOrder, take: INVOICED_LIMIT, select: { invoicedAt: true, lines: true, vatPercent: true } })
        .then((rows) => rows.map((row) => ({ invoicedAt: row.invoicedAt, net: basisNet(row) })))
      : prisma.invoiceBasis.findMany({ where: invoicedWhere, orderBy: invoicedOrder, take: INVOICED_LIMIT, select: { invoicedAt: true } })
        .then((rows) => rows.map((row) => ({ invoicedAt: row.invoicedAt, net: 0 }))),
    access.prices ? prisma.invoiceBasis.findMany({ where: { organizationId, status: "DRAFT" }, orderBy: [{ number: "desc" }], take: DRAFT_LIMIT, select: { lines: true, vatPercent: true } }) : [],
    prisma.invoiceBasis.count({ where: { organizationId, status: "DRAFT" } }),
  ]);
  const bases = invoiced.flatMap((row) => row.invoicedAt ? [{ day: todayInSweden(row.invoicedAt), net: row.net }] : []);
  return {
    invoiced: { months: invoicedPerMonth(bases, keys, access.prices), partial: invoiced.length >= INVOICED_LIMIT },
    drafts: moneyCount(draftCount, drafts.map(basisNet), access.prices),
  };
}

// ---------- offerter ----------

async function quotesSection(ctx: Context, access: EconomyAccess, today: string, now: Date): Promise<NonNullable<EconomyTabData["quotes"]>> {
  const organizationId = ctx.organizationId;
  const latest = { organizationId, supersededAt: null };
  const valid: Prisma.QuoteWhereInput = { OR: [{ validUntil: "" }, { validUntil: { gte: today } }] };
  const awaitingWhere: Prisma.QuoteWhereInput = { ...latest, status: "SENT", ...valid };
  const expiringWhere: Prisma.QuoteWhereInput = { ...latest, status: "SENT", validUntil: { gte: today, lte: addDays(today, QUOTE_EXPIRY_WINDOW_DAYS) } };
  const acceptedWhere: Prisma.QuoteWhereInput = { organizationId, status: "ACCEPTED", decidedAt: { gte: startOfSwedishMonth(now) } };
  const since = startOfSwedishMonth(now, -(WIN_RATE_MONTHS - 1));
  const sinceDay = todayInSweden(since);
  const [awaitingCount, awaiting, expiringCount, expiring, acceptedCount, accepted, decided] = await Promise.all([
    prisma.quote.count({ where: awaitingWhere }),
    access.prices ? prisma.quote.findMany({ where: awaitingWhere, orderBy: [{ updatedAt: "desc" }, { id: "asc" }], take: QUOTE_SUM_LIMIT, select: { vatPercent: true, lines: quoteLinesSelect } }) : [],
    prisma.quote.count({ where: expiringWhere }),
    access.readQuotes ? prisma.quote.findMany({
      where: expiringWhere, orderBy: [{ validUntil: "asc" }, { number: "asc" }], take: EXPIRING_ROWS,
      select: { id: true, number: true, version: true, title: true, validUntil: true, vatPercent: true, sentCustomerName: true, customer: { select: { name: true, company: true, customerType: true } }, lines: quoteLinesSelect },
    }) : [],
    prisma.quote.count({ where: acceptedWhere }),
    access.prices ? prisma.quote.findMany({ where: acceptedWhere, orderBy: [{ decidedAt: "desc" }, { id: "asc" }], take: QUOTE_SUM_LIMIT, select: { vatPercent: true, lines: quoteLinesSelect } }) : [],
    // The numbers answered (or run out) in the last twelve months; their versions decide won or lost.
    prisma.quote.findMany({
      where: { organizationId, changeOfVersion: null, OR: [
        { status: { in: ["ACCEPTED", "DECLINED", "EXPIRED"] }, decidedAt: { gte: since } },
        { status: "SENT", validUntil: { gte: sinceDay, lt: today } },
      ] },
      distinct: ["number"], orderBy: [{ number: "desc" }], take: WIN_RATE_NUMBERS, select: { number: true },
    }),
  ]);
  // Won and not started (Teamet's list, the same rule): the rows only for someone who may open a quote, else the count.
  const won = access.readQuotes ? await loadAcceptedQuotes(ctx, access.prices)
    : { total: await prisma.quote.count({ where: { organizationId, status: "ACCEPTED", supersededAt: null, workOrderId: null, changeOfVersion: null } }), rows: [] };
  const versions = decided.length ? await prisma.quote.findMany({
    where: { organizationId, changeOfVersion: null, number: { in: decided.map((row) => row.number) } }, take: WIN_RATE_NUMBERS * 10,
    select: { number: true, status: true, validUntil: true, supersededAt: true, changeOfVersion: true },
  }) : [];
  return {
    awaiting: moneyCount(awaitingCount, awaiting.map(quoteNet), access.prices),
    expiring: {
      count: expiringCount,
      rows: expiring.map((quote) => ({
        id: quote.id, label: quoteLabel(quote), title: quote.title, customer: quote.sentCustomerName ?? customerName(quote.customer),
        validUntil: quote.validUntil, days: daysUntil(today, quote.validUntil), net: access.prices ? Math.round(quoteNet(quote)) : null,
      })),
    },
    acceptedThisMonth: moneyCount(acceptedCount, accepted.map(quoteNet), access.prices),
    winRate: { ...quoteWinRate(versions.map((row) => ({ number: row.number, status: row.status, validUntil: row.validUntil, superseded: Boolean(row.supersededAt), changeOfVersion: row.changeOfVersion })), today), months: WIN_RATE_MONTHS },
    withoutWorkOrder: { count: won?.total ?? 0, rows: won?.rows ?? [] },
  };
}

// ---------- the tab ----------

/** Ekonomi for the caller's company: 403 without canViewEconomy (admin or Ekonomi – läsa). */
export async function loadEconomyTab(ctx: Context, now: Date): Promise<EconomyTabData> {
  if (!canViewEconomy(ctx)) throw new ApiError(403, "Du saknar behörighet att se Ekonomi.");
  const access = economyAccess(ctx);
  const organizationId = ctx.organizationId;
  const today = todayInSweden(now);
  const cloud = ctx.organization.storageMode === "HINTEK_CLOUD";
  const [goals, credits, unbilled, invoiced, quotes] = await Promise.all([
    readCompanyGoals(organizationId).then((value) => visibleCompanyGoals(value, { economy: true })),
    readCreditSummary(organizationId, now),
    // Företagets moduler (0.39.0): nothing is "att fakturera" while Fakturaunderlag is off.
    cloud && organizationModuleOn(ctx.organization, "invoicing") ? unbilledSection(organizationId, access, now) : null,
    cloud && organizationModuleOn(ctx.organization, "invoicing") ? invoicedSection(organizationId, access, today, now) : null,
    cloud && organizationModuleOn(ctx.organization, "quotes") ? quotesSection(ctx, access, today, now) : null,
  ]);
  return {
    cloud, today, monthName: monthLong(today.slice(0, 7)),
    access: { prices: access.prices, readBases: access.readBases, createBases: access.createBases, readQuotes: access.readQuotes },
    goals: { invoicedPerMonth: goals.invoicedPerMonth, quoteWinRatePercent: goals.quoteWinRatePercent },
    invoiced: invoiced?.invoiced ?? null, drafts: invoiced?.drafts ?? null, unbilled, quotes, credits,
  };
}
