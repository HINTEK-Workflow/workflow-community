import { Prisma } from "@prisma/client";
import { organizationModuleOn } from "@/lib/workflow/modules";
import { prisma } from "@/lib/db";
import { ApiError, type Context } from "@/lib/kfid/server";
import { fromSwedishDateInput, swedishDayKey } from "@/lib/swedish-time";
import { canViewTeam, hasWorkflowPermission, workflowSubjectForTask, type WorkflowPermissionSubject } from "@/lib/workflow/permissions";
import { addDays } from "@/lib/workflow/schedule";
import { invoiceBasisLinesOf, invoiceBasisTotals } from "@/lib/invoice-basis/model";
import { quoteLabel, quoteTotals, QUOTE_VAT_PERCENT, type QuoteLineKind } from "@/lib/quotes/model";
import { deviationHref, isDeviationOverdue } from "@/lib/self-inspection/model";
import {
  CUSTOMERS_LINKS, RECENT_DAYS, UPCOMING_DAYS, actionTotal, attentionCustomers, customerTotals, customersAccessRights, customersChip, customersTabAccess, deviationStats, invoiceStats, mergeCustomerFigures,
  LAPSED_ROWS, lapsedCustomers, quoteAnswerState, quoteStats, sortActionRows, sortUpcomingRows, upcomingDay,
  type CustomerActionRow, type CustomerFigures, type CustomerLapsedRow, type CustomerTotals, type CustomerUpcomingRow, type WorkOrderStat,
} from "./customers-model";
import { customerContact, customerTitle } from "@/lib/kfid/customer-name";

/**
 * Översikt – Kunder (2026-10-28, 0.29.0; reworked 2026-10-29 the same way as Jag and Teamet): which customers need
 * attention now (late and Behöver åtgärdas work orders, late deviations tied to a customer, quotes going out soon), what
 * comes up the coming week, and per customer the state, the progression and the money side (waiting quotes, invoice drafts).
 * Needs the customer register (customers:read or admin); each part still follows its module's read right, sums the price
 * right and deviations the log's own rule. SQL aggregates per customer, bounded reads, the company on every query. No
 * service agreements – they do not exist. Cloud only; the demo answers the same shape (features/demo/demo-overview.ts).
 */

export type CustomerRow = CustomerFigures & { name: string; place: string; href: string };
export type CustomersTabData = {
  today: string;
  /** The tab's chip (Kräver åtgärd's count), as Teamet's. */
  chip: string | null;
  rights: { workOrders: boolean; quotes: boolean; prices: boolean; deviations: "company" | "own" };
  totals: CustomerTotals;
  /** Customers with something in Kräver åtgärd. */
  attentionCustomers: number;
  rows: CustomerRow[];
  action: { total: number; rows: CustomerActionRow[] };
  upcoming: { total: number; rows: CustomerUpcomingRow[] } | null;
  /** Länge sedan (2026-10-29): worked for, but nothing färdigställt for a year and nothing open; null without the work-order right. */
  lapsed: { total: number; rows: CustomerLapsedRow[] } | null;
  links: typeof CUSTOMERS_LINKS;
};

const ROWS = 15;
const LIST_ROWS = 8;
const vatOf = (value: Prisma.Decimal | null) => { const number = value === null ? NaN : Number(value.toString()); return Number.isFinite(number) ? number : QUOTE_VAT_PERCENT; };
const decimal = (value: Prisma.Decimal | null) => value === null ? null : Number(value.toString());
const customerHref = (id: string) => `/?view=customers&customerId=${encodeURIComponent(id)}`;
const taskHref = (id: string) => `/?view=workflow_task&taskId=${encodeURIComponent(id)}&taskType=WORK_ORDER`;
const nameOf = customerTitle;
const count = (value: bigint | number) => Number(value);

export async function loadCustomersTab(ctx: Context, now: Date): Promise<CustomersTabData> {
  const access = customersTabAccess(ctx);
  if (!access.customers) throw new ApiError(403, "Du saknar behörighet att se kundregistret.");
  const today = swedishDayKey(now);
  const last = addDays(today, UPCOMING_DAYS - 1);
  const since = fromSwedishDateInput(addDays(today, -RECENT_DAYS))!;
  const can = (subject: WorkflowPermissionSubject) => ctx.admin || hasWorkflowPermission(ctx.workflowPermissions, subject, "read");
  const openOrder = { organizationId: ctx.organizationId, kind: "WORK_ORDER", status: { notIn: ["COMPLETED", "CANCELLED"] }, customerId: { not: null }, customer: { is: { deletedAt: null } } } satisfies Prisma.WorkflowTaskWhereInput;
  const orderSelect = { id: true, title: true, status: true, progress: true, dueDate: true, plannedStartDate: true, roundScheduleId: true, customer: { select: { name: true, company: true, customerType: true } } } satisfies Prisma.WorkflowTaskSelect;
  const [workOrders, overdueOrders, needsActionOrders, upcomingOrders, quotes, invoices, deviations] = await Promise.all([
    access.workOrders ? prisma.$queryRaw<{ customerId: string; open: bigint; overdue: bigint; rounds: bigint; inProgress: bigint; needsAction: bigint; completedRecent: bigint; upcoming: bigint; nextOn: string | null; lastCompletedAt: Date | null }[]>`
      select t."customerId",
        count(*) filter (where t.status not in ('COMPLETED', 'CANCELLED')) as open,
        count(*) filter (where t.status not in ('COMPLETED', 'CANCELLED') and t."dueDate" <> '' and t."dueDate" < ${today}) as overdue,
        count(*) filter (where t.status not in ('COMPLETED', 'CANCELLED') and t."roundScheduleId" is not null) as rounds,
        count(*) filter (where t.status = 'IN_PROGRESS') as "inProgress",
        count(*) filter (where t.status = 'NEEDS_ACTION' and not (t."dueDate" <> '' and t."dueDate" < ${today})) as "needsAction",
        count(*) filter (where t.status = 'COMPLETED' and t."completedAt" >= ${since}) as "completedRecent",
        count(*) filter (where t.status not in ('COMPLETED', 'CANCELLED', 'NEEDS_ACTION') and (t."dueDate" = '' or t."dueDate" >= ${today})
          and coalesce(nullif(t."plannedStartDate", ''), t."dueDate") between ${today} and ${last}) as upcoming,
        min(coalesce(nullif(t."plannedStartDate", ''), t."dueDate")) filter (where t.status not in ('COMPLETED', 'CANCELLED') and coalesce(nullif(t."plannedStartDate", ''), t."dueDate") >= ${today}) as "nextOn",
        max(t."completedAt") filter (where t.status = 'COMPLETED') as "lastCompletedAt"
      from "WorkflowTask" t join "Customer" c on c.id = t."customerId" and c."organizationId" = t."organizationId" and c."deletedAt" is null
      where t."organizationId" = ${ctx.organizationId} and t.kind = 'WORK_ORDER'
      group by t."customerId"` : [],
    // Kräver åtgärd: the late ones (the earliest Klart senast first) and the ones marked Behöver åtgärdas (the latest changed).
    access.workOrders ? prisma.workflowTask.findMany({ where: { ...openOrder, AND: [{ dueDate: { not: "" } }, { dueDate: { lt: today } }] }, orderBy: [{ dueDate: "asc" }, { id: "asc" }], take: LIST_ROWS, select: orderSelect }) : [],
    access.workOrders ? prisma.workflowTask.findMany({ where: { ...openOrder, status: "NEEDS_ACTION", OR: [{ dueDate: "" }, { dueDate: { gte: today } }] }, orderBy: [{ updatedAt: "desc" }, { id: "asc" }], take: LIST_ROWS, select: orderSelect }) : [],
    // Närmaste veckan: a planned start within the week, else a Klart senast within it.
    access.workOrders ? prisma.workflowTask.findMany({
      where: { ...openOrder, status: { notIn: ["COMPLETED", "CANCELLED", "NEEDS_ACTION"] }, OR: [{ plannedStartDate: { gte: today, lte: last } }, { plannedStartDate: "", dueDate: { gte: today, lte: last } }] },
      orderBy: [{ plannedStartDate: "asc" }, { dueDate: "asc" }, { id: "asc" }], take: 100, select: orderSelect,
    }) : [],
    access.quotes && organizationModuleOn(ctx.organization, "quotes") ? prisma.quote.findMany({
      where: { organizationId: ctx.organizationId, status: "SENT", supersededAt: null, customerId: { not: null }, customer: { is: { deletedAt: null } } },
      take: 5000, select: { id: true, number: true, version: true, title: true, customerId: true, status: true, validUntil: true, customer: { select: { name: true, company: true, customerType: true } } },
    }) : [],
    access.quotes && organizationModuleOn(ctx.organization, "invoicing") ? prisma.invoiceBasis.findMany({
      where: { organizationId: ctx.organizationId, status: "DRAFT", customerId: { not: null }, customer: { is: { deletedAt: null } } },
      orderBy: { updatedAt: "desc" }, take: 1000,
      select: { customerId: true, projectId: true, vatPercent: true, lines: access.prices, task: { select: { kind: true, formArea: true } } },
    }) : [],
    loadDeviations(ctx, access.deviationsCompany),
  ]);
  const workStats: WorkOrderStat[] = workOrders.map((row) => ({
    customerId: row.customerId, open: count(row.open), overdue: count(row.overdue), rounds: count(row.rounds), lastCompletedOn: row.lastCompletedAt ? swedishDayKey(row.lastCompletedAt) : null,
    inProgress: count(row.inProgress), needsAction: count(row.needsAction), completedRecent: count(row.completedRecent), upcoming: count(row.upcoming), nextOn: row.nextOn || null,
  }));
  // A basis is read like the basis itself (lib/invoice-basis/server.ts): its job's kind or its project must be readable.
  const readableBases = invoices.filter((basis) => (!basis.task || can(workflowSubjectForTask(basis.task.kind, basis.task.formArea))) && (!basis.projectId || can("projects")));
  const figures = mergeCustomerFigures({
    access,
    workOrders: workStats,
    quotes: quoteStats(quotes.map((quote) => ({ customerId: quote.customerId!, status: quote.status, validUntil: quote.validUntil })), today),
    invoices: invoiceStats(readableBases.map((basis) => ({
      customerId: basis.customerId!,
      net: access.prices ? invoiceBasisTotals(invoiceBasisLinesOf((basis as { lines?: unknown }).lines), vatOf(basis.vatPercent)).net : 0,
    }))),
    deviations: deviationStats(deviations, today),
  });
  const totals = customerTotals(figures, access);

  // Kräver åtgärd: the rows of each kind, in one order; the total is the figures' own count.
  const expiring = quotes.filter((quote) => quoteAnswerState(quote, today) === "expiringSoon").sort((a, b) => a.validUntil.localeCompare(b.validUntil) || a.number - b.number).slice(0, LIST_ROWS);
  const quoteNet = await quoteNets(ctx, access.prices ? expiring.map((quote) => quote.id) : []);
  const orderRow = (reason: "overdue" | "needsAction") => (row: (typeof overdueOrders)[number]): CustomerActionRow => ({
    key: `${reason}:${row.id}`, reason, id: row.id, title: row.title, href: taskHref(row.id), customerName: nameOf(row.customer), day: row.dueDate, status: row.status, progress: row.progress, round: Boolean(row.roundScheduleId),
  });
  const actionRows = sortActionRows([
    ...overdueOrders.map(orderRow("overdue")),
    ...needsActionOrders.map(orderRow("needsAction")),
    ...deviations.filter((entry) => isDeviationOverdue(entry, today)).map((entry): CustomerActionRow => ({
      key: `deviation:${entry.id}`, reason: "deviation", id: entry.id, title: entry.title, href: deviationHref(entry.id), customerName: entry.customerName, day: entry.dueDate, status: entry.status,
    })),
    ...expiring.map((quote): CustomerActionRow => ({
      key: `quote:${quote.id}`, reason: "quote", id: quote.id, title: `${quoteLabel(quote)} · ${quote.title || "Utan rubrik"}`, href: `/?view=quote&quoteId=${encodeURIComponent(quote.id)}`,
      customerName: nameOf(quote.customer), day: quote.validUntil, net: access.prices ? quoteNet.get(quote.id) ?? 0 : null,
    })),
  ]).slice(0, LIST_ROWS);

  const upcoming = access.workOrders ? sortUpcomingRows(upcomingOrders.flatMap((row) => {
    const when = upcomingDay({ status: row.status, dueDate: row.dueDate, plannedStartDate: row.plannedStartDate }, today);
    return when ? [{ id: row.id, title: row.title, href: taskHref(row.id), customerName: nameOf(row.customer), day: when.day, starts: when.starts, status: row.status, progress: row.progress, round: Boolean(row.roundScheduleId) }] : [];
  })) : null;

  const shown = figures.slice(0, ROWS);
  // Länge sedan from the same per-customer sums: worked for, nothing färdigställt for a year, nothing going on now.
  const lapsed = access.workOrders ? lapsedCustomers(workStats, new Set(figures.map((row) => row.customerId)), today) : null;
  const named = [...shown.map((row) => row.customerId), ...(lapsed ?? []).slice(0, LAPSED_ROWS).map((row) => row.customerId)];
  const customers = named.length ? await prisma.customer.findMany({
    where: { organizationId: ctx.organizationId, id: { in: named }, deletedAt: null },
    select: { id: true, name: true, company: true, customerType: true, city: true },
  }) : [];
  const byId = new Map(customers.map((customer) => [customer.id, customer]));
  const placeOf = (customer: (typeof customers)[number]) => [customerContact(customer), customer.city].filter(Boolean).join(" · ");
  return {
    today,
    chip: customersChip(totals),
    rights: customersAccessRights(access),
    totals,
    attentionCustomers: attentionCustomers(figures),
    rows: shown.flatMap((row) => {
      const customer = byId.get(row.customerId);
      if (!customer) return [];
      return [{ ...row, name: nameOf(customer), place: placeOf(customer), href: customerHref(customer.id) }];
    }),
    action: { total: Math.max(actionRows.length, actionTotal(totals)), rows: actionRows },
    upcoming: upcoming ? { total: upcoming.length, rows: upcoming.slice(0, LIST_ROWS) } : null,
    lapsed: lapsed ? { total: lapsed.length, rows: lapsed.slice(0, LAPSED_ROWS).flatMap((row) => {
      const customer = byId.get(row.customerId);
      return customer ? [{ customerId: customer.id, name: nameOf(customer), place: placeOf(customer), href: customerHref(customer.id), lastCompletedOn: row.lastCompletedOn }] : [];
    }) } : null,
    links: CUSTOMERS_LINKS,
  };
}

/** The sums (exkl. moms) of the quotes going out soon; the lines are read only for someone who may see the sum. */
async function quoteNets(ctx: Context, ids: string[]): Promise<Map<string, number>> {
  if (!ids.length) return new Map();
  const rows = await prisma.quote.findMany({ where: { organizationId: ctx.organizationId, id: { in: ids } }, select: { id: true, vatPercent: true, lines: { select: { kind: true, quantity: true, unitPrice: true, markupPercent: true } } } });
  return new Map(rows.map((row) => [row.id, Math.round(quoteTotals(row.lines.map((line) => ({ kind: line.kind as QuoteLineKind, quantity: decimal(line.quantity) ?? 0, unitPrice: decimal(line.unitPrice), markupPercent: decimal(line.markupPercent) })), vatOf(row.vatPercent)).net)]));
}

/**
 * The open entries of the company's deviation log tied to a customer – through the work order that fixes them, else the
 * protocol they were taken from. An admin reads the whole log; anyone else what they reported or are responsible for, as
 * the log shows them (lib/self-inspection/server.ts, Teamet's loadDeviations).
 */
async function loadDeviations(ctx: Context, company: boolean) {
  // The log's own read rule (lib/self-inspection/incidents.ts): a near miss or an accident by its reporter or the Teamet right (2026-10-30).
  const incidents = canViewTeam(ctx) ? Prisma.sql`true` : Prisma.sql`d."reportedById" = ${ctx.user.id}`;
  const own = company ? Prisma.empty : Prisma.sql`and ((d.type in ('SELF_INSPECTION', 'RISK_OBSERVATION') and (d."reportedById" = ${ctx.user.id} or d."responsibleUserId" = ${ctx.user.id})) or (d.type in ('NEAR_MISS', 'ACCIDENT') and ${incidents}))`;
  const rows = await prisma.$queryRaw<{ id: string; title: string; status: string; dueDate: string; customerId: string; customerName: string; customerCompany: string; customerType: string | null }[]>`
    select d.id, d.title, d.status, d."dueDate", c.id as "customerId", c.name as "customerName", c.company as "customerCompany", c."customerType"
    from "SelfInspectionDeviation" d
    left join "WorkflowTask" w on w.id = d."workOrderId" and w."organizationId" = d."organizationId"
    left join "WorkflowTask" s on s.id = d."sourceTaskId" and s."organizationId" = d."organizationId"
    join "Customer" c on c.id = coalesce(w."customerId", s."customerId") and c."organizationId" = d."organizationId" and c."deletedAt" is null
    where d."organizationId" = ${ctx.organizationId} and d.status <> 'DONE' ${own}
    order by d."dueDate" asc, d.number asc
    limit 2000`;
  return rows.map((row) => ({ id: row.id, title: row.title, status: row.status, dueDate: row.dueDate, customerId: row.customerId, customerName: nameOf({ name: row.customerName, company: row.customerCompany, customerType: row.customerType }) }));
}
