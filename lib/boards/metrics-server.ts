import { prisma } from "@/lib/db";
import { hasWorkflowPermission, workflowSubjectForTask } from "@/lib/workflow/permissions";
import { workStateMatches, workStateOf } from "@/lib/workflow/work-list";
import { timeEntryInOrganization } from "@/lib/workflow/timer-server";
import { expectedWeeklyWorkMinutes } from "@/lib/workflow/work-schedule";
import { canReadPlannedActivity } from "@/lib/workflow/planned-activity-access";
import { deviationReadWhere, DEVIATION_TYPES, deviationType } from "@/lib/self-inspection/incidents";
import { addSwedishDays, swedishClock, swedishDayKey, swedishMonday, startOfSwedishDay } from "@/lib/swedish-time";
import { isoWeekOf } from "./week";
import { metricAccess, metricDefinition, metricPeriod, type MetricKey, type MetricViewer } from "./metrics";
import { periodDays, periodRange, type Period } from "./period";
import { deviationSeries, invoiceNet, machineStatusShape, storeBelowMinShape, withPrevious, workOrderSeries } from "./metric-shapes";
import type { EventsShape, NumberShape, SeriesShape, Shape, TableShape } from "./shapes";

/**
 * Workflow-mått counted on the server (Tavlor etapp 1, 2026-11-18): each measure reads only the viewer's company, with the same
 * right as its page (lib/boards/metrics.ts says which), bounded to what the figure needs. A measure never returns ids of customers
 * or people – only the finished figures, and names where the measure is about people (marked personal, masked outside the app).
 */
export type MetricCaller = MetricViewer & { organizationId: string; organization: MetricViewer["organization"] & { weeklyWorkMinutes: number } };

const OPEN = { notIn: ["COMPLETED", "CANCELLED"] };
const TASK_SELECT = { kind: true, formArea: true, status: true, progress: true, dueDate: true, plannedStartDate: true, startedAt: true } as const;
const reads = (caller: MetricCaller, kind: string, formArea: string | null) => caller.admin || hasWorkflowPermission(caller.workflowPermissions, workflowSubjectForTask(kind, formArea), "read");
const hours = (seconds: number) => Math.round((seconds / 3600) * 10) / 10;
const weekLabel = (monday: Date) => `v. ${isoWeekOf(monday)}`;


/** One measure for the caller, or the reason it cannot be read. */
export async function countMetric(caller: MetricCaller, key: MetricKey, now = new Date(), wanted?: Period | null): Promise<{ ok: true; data: Shape } | { ok: false; reason: "module_off" | "forbidden" }> {
  const access = metricAccess(key, caller);
  if (access !== "ok") return { ok: false, reason: access };
  return { ok: true, data: await COUNT[key](caller, now, metricPeriod(key, wanted) ?? "week") };
}

async function readableOpenTasks(caller: MetricCaller, where: Record<string, unknown> = {}) {
  const rows = await prisma.workflowTask.findMany({ where: { organizationId: caller.organizationId, status: OPEN, ...where }, select: TASK_SELECT, take: 20_000 });
  return rows.filter((row) => reads(caller, row.kind, row.formArea));
}

async function hoursBetween(caller: MetricCaller, from: Date, to: Date) {
  const entries = await prisma.workflowTimeEntry.findMany({
    where: { startedAt: { gte: from, lt: to }, AND: [timeEntryInOrganization(caller.organizationId)] },
    select: { startedAt: true, endedAt: true, durationSec: true }, take: 50_000,
  });
  const now = Date.now();
  return entries.reduce((sum, entry) => sum + entry.durationSec + (!entry.endedAt ? Math.max(0, Math.floor((now - entry.startedAt.getTime()) / 1000)) : 0), 0);
}

const COUNT: Record<MetricKey, (caller: MetricCaller, now: Date, period: Period) => Promise<Shape>> = {
  async work_orders_open(caller) {
    const value = await prisma.workflowTask.count({ where: { organizationId: caller.organizationId, kind: "WORK_ORDER", status: OPEN } });
    return { kind: "number", value } satisfies NumberShape;
  },
  async work_orders_by_status(caller, now, period) {
    const { from, to } = periodRange(period, now);
    const rows = await prisma.workflowTask.findMany({ where: { organizationId: caller.organizationId, kind: "WORK_ORDER", OR: [{ status: OPEN }, { completedAt: { gte: from, lt: to } }] }, select: { status: true, progress: true }, take: 20_000 });
    return workOrderSeries(rows.map((row) => workStateOf(row)));
  },
  async tasks_overdue(caller, now) {
    const today = swedishDayKey(now);
    const rows = await readableOpenTasks(caller, { dueDate: { not: "", lt: today } });
    return { kind: "number", value: rows.filter((row) => workStateMatches({ ...row, state: workStateOf(row) }, "overdue", today)).length } satisfies NumberShape;
  },
  async tasks_completed_week(caller, now, period) {
    const range = periodRange(period, now);
    const rows = await prisma.workflowTask.findMany({ where: { organizationId: caller.organizationId, status: "COMPLETED", completedAt: { gte: range.previousFrom, lt: range.to } }, select: { kind: true, formArea: true, completedAt: true }, take: 20_000 });
    const readable = rows.filter((row) => reads(caller, row.kind, row.formArea));
    return withPrevious(period, readable.filter((row) => row.completedAt! >= range.from).length, readable.filter((row) => row.completedAt! < range.previousTo).length);
  },
  async projects_active(caller) {
    const value = await prisma.project.count({ where: { organizationId: caller.organizationId, archivedAt: null, closedAt: null } });
    return { kind: "number", value } satisfies NumberShape;
  },
  async deviations_open(caller) {
    const value = await prisma.selfInspectionDeviation.count({ where: { organizationId: caller.organizationId, status: { notIn: ["DONE", "WITHDRAWN"] }, AND: [deviationReadWhere({ admin: caller.admin, id: caller.userId, team: canTeam(caller) })] } });
    return { kind: "number", value } satisfies NumberShape;
  },
  async deviations_new(caller, now, period) {
    const range = periodRange(period, now);
    const rows = await prisma.selfInspectionDeviation.findMany({ where: { organizationId: caller.organizationId, createdAt: { gte: range.previousFrom, lt: range.to }, AND: [deviationReadWhere({ admin: caller.admin, id: caller.userId, team: canTeam(caller) })] }, select: { createdAt: true }, take: 20_000 });
    return withPrevious(period, rows.filter((row) => row.createdAt >= range.from).length, rows.filter((row) => row.createdAt < range.previousTo).length);
  },
  async deviations_by_type(caller, now, period) {
    const { from, to } = periodRange(period, now);
    const rows = await prisma.selfInspectionDeviation.findMany({ where: { organizationId: caller.organizationId, createdAt: { gte: from, lt: to }, AND: [deviationReadWhere({ admin: caller.admin, id: caller.userId, team: canTeam(caller) })] }, select: { type: true }, take: 10_000 });
    return deviationSeries(rows.map((row) => row.type));
  },
  async deviations_latest(caller) {
    const rows = await prisma.selfInspectionDeviation.findMany({
      where: { organizationId: caller.organizationId, AND: [deviationReadWhere({ admin: caller.admin, id: caller.userId, team: canTeam(caller) })] },
      orderBy: { createdAt: "desc" }, take: 20, select: { createdAt: true, title: true, type: true, status: true, serious: true },
    });
    return { kind: "events", items: rows.map((row) => ({ at: row.createdAt.toISOString(), title: row.title || DEVIATION_TYPES[deviationType(row.type)], level: row.serious ? "error" : row.status === "DONE" ? "info" : "warning", detail: `${DEVIATION_TYPES[deviationType(row.type)]}${row.status === "DONE" ? " · Klar" : ""}` })) } satisfies EventsShape;
  },
  async hours_week(caller, now, period) {
    const range = periodRange(period, now);
    const [seconds, before, members] = await Promise.all([
      hoursBetween(caller, range.from, range.to),
      hoursBetween(caller, range.previousFrom, range.previousTo),
      period === "week" ? prisma.organizationMember.findMany({ where: { organizationId: caller.organizationId, isActive: true, user: { is: { isActive: true } } }, select: { weeklyWorkMinutes: true, noFixedHours: true }, take: 2000 }) : Promise.resolve([]),
    ]);
    // Förväntad tid is a week's (each member's own week); the other periods have no target of their own.
    const expected = members.reduce((sum, member) => sum + expectedWeeklyWorkMinutes(caller.organization.weeklyWorkMinutes, member), 0);
    return { ...withPrevious(period, hours(seconds), hours(before)), unit: "h", ...(period === "week" ? { target: Math.round(expected / 6) / 10 } : {}) } satisfies NumberShape;
  },
  async hours_by_week(caller, now) {
    const monday = swedishMonday(now);
    const weeks = Array.from({ length: 8 }, (_, index) => addSwedishDays(monday, (index - 7) * 7));
    const values = await Promise.all(weeks.map((start) => hoursBetween(caller, start, addSwedishDays(start, 7))));
    return { kind: "series", labels: weeks.map(weekLabel), series: [{ name: "Timmar", values: values.map(hours) }], unit: "h" } satisfies SeriesShape;
  },
  async absence_today_count(caller, now) {
    const today = swedishDayKey(now);
    const rows = await prisma.absence.findMany({ where: { organizationId: caller.organizationId, status: "APPROVED", fromDate: { lte: today }, toDate: { gte: today } }, select: { userId: true }, take: 5000 });
    return { kind: "number", value: new Set(rows.map((row) => row.userId)).size } satisfies NumberShape;
  },
  async absence_today(caller, now) {
    const today = swedishDayKey(now);
    // Only who and when – never the type or the note (the decision on medical details).
    const rows = await prisma.absence.findMany({ where: { organizationId: caller.organizationId, status: "APPROVED", fromDate: { lte: today }, toDate: { gte: today } }, select: { userId: true, toDate: true, startTime: true, endTime: true }, take: 500 });
    const users = await prisma.user.findMany({ where: { id: { in: [...new Set(rows.map((row) => row.userId))] }, organizationMemberships: { some: { organizationId: caller.organizationId } } }, select: { id: true, name: true, email: true } });
    const name = new Map(users.map((user) => [user.id, user.name?.trim() || user.email.split("@")[0]!]));
    const seen = new Set<string>();
    const tableRows = rows.filter((row) => !seen.has(row.userId) && seen.add(row.userId)).map((row) => ({
      person: name.get(row.userId) ?? "Okänd",
      when: row.startTime && row.endTime ? `${row.startTime}–${row.endTime}` : row.toDate === today ? "I dag" : `Till ${row.toDate}`,
    })).sort((a, b) => String(a.person).localeCompare(String(b.person), "sv"));
    return { kind: "table", columns: [{ key: "person", label: "Person", type: "text" }, { key: "when", label: "När", type: "text" }], rows: tableRows, total: tableRows.length } satisfies TableShape;
  },
  async planning_today(caller, now) {
    const start = startOfSwedishDay(now);
    const rows = await prisma.plannedActivity.findMany({
      where: { organizationId: caller.organizationId, deletedAt: null, status: { not: "CANCELED" }, startsAt: { lt: addSwedishDays(start, 1) }, endsAt: { gt: start } },
      orderBy: { startsAt: "asc" }, take: 200,
      select: { title: true, startsAt: true, endsAt: true, projectId: true, assignedToName: true, workflowTask: { select: { kind: true, formArea: true, title: true, projectId: true } }, assignments: { select: { member: { select: { user: { select: { name: true, email: true } } } } } } },
    });
    const readable = rows.filter((row) => canReadPlannedActivity(caller.workflowPermissions, caller.admin, row as never)).slice(0, 60);
    return {
      kind: "table",
      columns: [{ key: "time", label: "Tid", type: "text" }, { key: "title", label: "Jobb", type: "text" }, { key: "people", label: "Vem", type: "text" }],
      rows: readable.map((row) => ({
        time: `${swedishClock(row.startsAt < start ? start : row.startsAt)}–${swedishClock(row.endsAt)}`,
        title: row.workflowTask?.title || row.title,
        people: row.assignments.length ? row.assignments.map((item) => item.member.user.name?.trim() || item.member.user.email.split("@")[0]).join(", ") : row.assignedToName,
      })),
      total: readable.length,
    } satisfies TableShape;
  },
  async quotes_sent(caller) {
    const value = await prisma.quote.count({ where: { organizationId: caller.organizationId, status: "SENT", supersededAt: null } });
    return { kind: "number", value } satisfies NumberShape;
  },
  async quotes_accepted(caller, now, period) {
    const range = periodRange(period, now);
    const rows = await prisma.quote.findMany({ where: { organizationId: caller.organizationId, status: "ACCEPTED", decidedAt: { gte: range.previousFrom, lt: range.to } }, select: { decidedAt: true }, take: 20_000 });
    return withPrevious(period, rows.filter((row) => row.decidedAt! >= range.from).length, rows.filter((row) => row.decidedAt! < range.previousTo).length);
  },
  async invoiced_amount(caller, now, period) {
    const days = periodDays(period, now);
    const rows = await prisma.customerInvoice.findMany({ where: { organizationId: caller.organizationId, issuedOn: { gte: days.previousFrom, lt: days.to } }, select: { issuedOn: true, content: true }, take: 20_000 });
    const net = (from: string, to: string) => Math.round(rows.filter((row) => row.issuedOn >= from && row.issuedOn < to).reduce((sum, row) => sum + invoiceNet(row.content), 0));
    return { ...withPrevious(period, net(days.from, days.to), net(days.previousFrom, days.previousTo)), unit: "kr" } satisfies NumberShape;
  },
  async invoices_overdue(caller, now) {
    const value = await prisma.customerInvoice.count({ where: { organizationId: caller.organizationId, kind: "INVOICE", paidOn: null, credits: { none: {} }, dueOn: { not: null, lt: swedishDayKey(now) } } });
    return { kind: "number", value } satisfies NumberShape;
  },
  async customers_new(caller, now, period) {
    const range = periodRange(period, now);
    const rows = await prisma.customer.findMany({ where: { organizationId: caller.organizationId, deletedAt: null, createdAt: { gte: range.previousFrom, lt: range.to } }, select: { createdAt: true }, take: 20_000 });
    return withPrevious(period, rows.filter((row) => row.createdAt >= range.from).length, rows.filter((row) => row.createdAt < range.previousTo).length);
  },
  async rounds_missed(caller, now, period) {
    const range = periodRange(period, now);
    const rows = await prisma.roundOccurrenceOutcome.findMany({ where: { organizationId: caller.organizationId, outcome: "NOT_DONE", revokedAt: null, recordedAt: { gte: range.previousFrom, lt: range.to } }, select: { recordedAt: true }, take: 20_000 });
    return withPrevious(period, rows.filter((row) => row.recordedAt >= range.from).length, rows.filter((row) => row.recordedAt < range.previousTo).length);
  },
  async machine_status(caller) {
    const [parts, faults] = await Promise.all([
      prisma.machinePart.findMany({ where: { organizationId: caller.organizationId, parentId: null, isActive: true, status: { not: "DECOMMISSIONED" } }, orderBy: [{ position: "asc" }, { name: "asc" }], take: 40, select: { id: true, name: true, status: true } }),
      prisma.maintenanceItem.findMany({ where: { organizationId: caller.organizationId, status: "OPEN" }, select: { partId: true, stoppedAt: true, restoredAt: true }, take: 5000 }),
    ]);
    return machineStatusShape(parts, faults);
  },
  async faults_open(caller) {
    const value = await prisma.maintenanceItem.count({ where: { organizationId: caller.organizationId, status: "OPEN" } });
    return { kind: "number", value } satisfies NumberShape;
  },
  async store_below_min(caller) {
    const items = await prisma.storeItem.findMany({ where: { organizationId: caller.organizationId, minQuantity: { not: null } }, select: { name: true, unit: true, minQuantity: true, balances: { select: { quantity: true } } }, take: 2000 });
    return storeBelowMinShape(items.map((item) => ({ name: item.name, min: Number(item.minQuantity), have: item.balances.reduce((sum, balance) => sum + Number(balance.quantity), 0) })));
  },
};

function canTeam(caller: MetricCaller) {
  return caller.admin || hasWorkflowPermission(caller.workflowPermissions, "team", "read");
}

/** The measure's name, for a card without its own title. */
export const metricLabel = (key: MetricKey) => metricDefinition(key).label;
