import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { ApiError } from "@/lib/kfid/server";
import { swedishDayKey } from "@/lib/swedish-time";
import { moduleOnWhere, organizationModuleOn } from "@/lib/workflow/modules";
import { addDays, daysBetween, isDayKey } from "@/lib/workflow/schedule";
import { workflowTaskInputSchema, workflowTaskProgress } from "@/lib/workflow/task-model";
import { itemInputSchema, maintenanceAccess, PART_LIMIT, rootOf, type MaintenanceCaller } from "./model";
import {
  checklistRows, dormantProblem, firstRunHours, holderForDay, intervalText, isDormant, itemOccurrenceState, itemPlanOrder, occurrenceState, PLAN_LIMIT_PER_PART, planFill, planInputSchema, planOrderTitle,
  readChecklistTexts, roundPlanStep, roundWaitingText, runHoursStep,
  type PlanningMaintenance, type PlanOccurrenceState, type PlanOrder, type PlanUnit, type RoundHolder, type RoundStep,
} from "./plan-model";
import { formScheduleRuleSchema, scheduleRuleText } from "@/lib/workflow/form-schedule";
import { audit, createItemAs, requireMaintenance, type Db } from "./server";

/**
 * Återkommande underhåll on the server (2026-10-30; the rules: ./plan-model.ts). A plan belongs to one machine part
 * and keeps one work order per occurrence – vilande ahead for calendar time, one at a time for drifttimmar. Every query is
 * bound to the caller's company; the database checks the plan of a work order again (a composite key). The work orders are
 * filled in when a plan is saved, when one of its work orders is closed, set to Utgår, moved or reopened (the route
 * app/api/workflow-tasks calls planOrderChanged), when a part's drifttimmar change, and each night by the job
 * scripts/maintenance/run-plans.ts (which also catches what the others missed).
 */

export const PLAN_CREATOR = "system:maintenance-plan";
const json = (value: unknown) => JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;
const NOT_FOUND = "Underhållsplanen hittades inte.";
const STALE = "Planen har ändrats av någon annan. Läs in den igen.";

/** SQL: the work order `alias` is not vilande today (the lists Arbetsordrar, Mina uppgifter and Min dag leave vilande ones out). */
export const notDormantSql = (alias: string, today: string) => {
  const column = (name: string) => Prisma.raw(`${alias}."${name}"`);
  return Prisma.sql`not (${column("maintenancePlanId")} is not null and ${column("maintenanceActivatedAt")} is null and ${Prisma.raw(`${alias}.status`)} = 'PLANNED' and ${column("maintenanceDue")} > ${today})`;
};

/**
 * The day notDormantSql compares with. A plan's vilande work orders are made ahead, so with Underhåll off they would otherwise wake up
 * one by one in the lists as their days came: compared with no day at all, every one of them stays vilande until the module is on.
 */
export const dormantDay = (organization: { disabledModules?: readonly string[] | null }, today: string) => organizationModuleOn(organization, "upkeep") ? today : "";

/** A vilande work order cannot be started: no time, no Pågår, no Färdigställ (the routes call this before). */
export async function assertNotDormant(db: Db, organizationId: string, taskId: string, now = new Date()) {
  const order = await db.workflowTask.findFirst({ where: { id: taskId, organizationId }, select: { maintenancePlanId: true, maintenanceDue: true, maintenanceActivatedAt: true, status: true } });
  if (order && isDormant(order, swedishDayKey(now))) throw new ApiError(409, dormantProblem(order.maintenanceDue ?? ""));
}

async function memberName(db: Db, organizationId: string, userId: string | null) {
  if (!userId) return "";
  const member = await db.organizationMember.findFirst({ where: { organizationId, userId, isActive: true, user: { isActive: true } }, select: { user: { select: { name: true, email: true } } } });
  if (!member) throw new ApiError(400, "Den ansvariga personen tillhör inte företaget.");
  return member.user.name || member.user.email || "";
}

// ---------- filling a plan ----------

const orderSelect = {
  id: true, status: true, dueDate: true, plannedStartDate: true, maintenanceDue: true, maintenancePinned: true, maintenanceActivatedAt: true, completedAt: true,
  _count: { select: { timeEntries: true, linkedTasks: true, plannedActivities: true, storeTransactions: true, purchases: true, attachments: true, maintenanceItems: true, invoiceBases: true } },
} satisfies Prisma.WorkflowTaskSelect;
type OrderRow = Prisma.WorkflowTaskGetPayload<{ select: typeof orderSelect }>;
const CLOSED = new Set(["COMPLETED", "CANCELLED"]);

/** Something hangs on the work order (more than the plan's own maintenance item): the plan never removes it. */
const touched = (row: OrderRow) => {
  const count = row._count;
  return count.timeEntries + count.linkedTasks + count.plannedActivities + count.storeTransactions + count.purchases + count.attachments + count.invoiceBases > 0 || count.maintenanceItems > 1;
};
const planOrder = (row: OrderRow): PlanOrder => ({
  id: row.id, status: row.status, due: row.maintenanceDue ?? "", activated: Boolean(row.maintenanceActivatedAt), pinned: row.maintenancePinned, plannedStartDate: row.plannedStartDate,
  completedDay: row.completedAt ? swedishDayKey(row.completedAt) : null, touched: touched(row),
});

type PlanRow = Prisma.MaintenancePlanGetPayload<{ include: { part: { select: { id: true; name: true; runHours: true; isActive: true; status: true } } } }>;

async function createOrder(tx: Prisma.TransactionClient, plan: PlanRow, due: string, customerId: string | null, actorId: string) {
  const task = workflowTaskInputSchema.parse({
    kind: "WORK_ORDER", title: planOrderTitle(plan.name, plan.part.name), description: plan.description, status: "PLANNED",
    projectId: null, customerId, facilityId: null, assignedToUserId: plan.assignedToUserId, assignedToName: plan.assignedToName, dueDate: due, plannedStartDate: due,
    data: { kind: "WORK_ORDER", details: {} },
  });
  const created = await tx.workflowTask.create({
    data: {
      organizationId: plan.organizationId, projectId: null, customerId, facilityId: null, machinePartId: plan.part.id, maintenancePlanId: plan.id, maintenanceDue: due,
      kind: "WORK_ORDER", title: task.title, description: task.description, assignedToUserId: plan.assignedToUserId, assignedToName: plan.assignedToName, status: "PLANNED",
      progress: workflowTaskProgress(task), dueDate: due, plannedStartDate: due, estimatedMinutes: plan.estimatedMinutes, data: json(task.data), createdBy: actorId, updatedBy: actorId,
      revisions: { create: { version: 1, snapshot: json(task), createdBy: actorId } },
    },
    select: { id: true },
  });
  // The work order holds a preventive maintenance item on the part (the module's item, source PLAN), with what is to be done.
  await createItemAs(tx, { organizationId: plan.organizationId, userId: actorId }, itemInputSchema.parse({ partId: plan.part.id, workOrderId: created.id, type: "PREVENTIVE", fault: plan.name }), "PLAN", { plan: planWork(plan) });
  return created.id;
}

/** Vad som ska göras (2026-11-27): the plan's instruction and checklist for a new occurrence's item. */
const planWork = (plan: Pick<PlanRow, "description" | "checklist">) => ({ instruction: plan.description, checklist: checklistRows(readChecklistTexts(plan.checklist)) });

// ---------- gör i driftronden (2026-11-27) ----------

const itemSelect = {
  id: true, status: true, planDue: true, completedAt: true, workOrderId: true, version: true, workOrder: { select: { status: true } }, _count: { select: { storeTransactions: true } },
} satisfies Prisma.MaintenanceItemSelect;
type PlanItemRow = Prisma.MaintenanceItemGetPayload<{ select: typeof itemSelect }>;
/** A person changed it (ticked, wrote, moved) or something was drawn for it: the plan never removes it. */
const itemTouched = (row: PlanItemRow) => row.version > 1 || row._count.storeTransactions > 0;
const asPlanOrder = (row: PlanItemRow) => itemPlanOrder({ id: row.id, status: row.status, planDue: row.planDue ?? "", completedDay: row.completedAt ? swedishDayKey(row.completedAt) : null, touched: itemTouched(row) });

/** The round's work orders for a period that are still open (Driftrond i arbetsordern, 2026-10-27). */
async function roundHolders(db: Db, organizationId: string, roundScheduleId: string): Promise<RoundHolder[]> {
  const rows = await db.workflowTask.findMany({
    where: { organizationId, kind: "WORK_ORDER", roundScheduleId, roundOccurrence: null, status: { notIn: [...CLOSED] } },
    orderBy: { plannedStartDate: "asc" }, take: 100, select: { id: true, status: true, plannedStartDate: true, dueDate: true },
  });
  return rows.map((row) => ({ id: row.id, status: row.status, from: row.plannedStartDate, to: row.dueDate }));
}

async function createRoundItem(tx: Prisma.TransactionClient, plan: PlanRow, due: string, workOrderId: string, actorId: string) {
  await createItemAs(tx, { organizationId: plan.organizationId, userId: actorId }, itemInputSchema.parse({ partId: plan.part.id, workOrderId, type: "PREVENTIVE", fault: plan.name }), "PLAN",
    { plan: { ...planWork(plan), planId: plan.id, due } });
}

/**
 * Fyll på a plan done in a round: one occurrence at a time, as an item in the round's work order that holds its day
 * (plan-model roundPlanStep). Under the plan's lock, in the fill's transaction. The plan's vilande work orders from before
 * the round go (untouched ones); its open work orders stay and count as open.
 */
async function fillRoundPlan(tx: Prisma.TransactionClient, plan: PlanRow & { roundScheduleId: string }, rows: OrderRow[], items: PlanItemRow[], active: boolean, today: string, actorId: string, summary: FillSummary) {
  const orders = rows.map(planOrder);
  const leftover = planFill({ unit: "DAY", every: 1, startDate: today, isActive: false }, orders, today).remove;
  summary.removed = await removeOrders(tx, plan.organizationId, plan.id, leftover);
  const kept = orders.filter((order) => !leftover.includes(order.id));
  const openOrder = rows.some((row) => !CLOSED.has(row.status) && !leftover.includes(row.id) && !isDormant({ maintenancePlanId: plan.id, maintenanceDue: row.maintenanceDue, maintenanceActivatedAt: row.maintenanceActivatedAt, status: row.status }, today));
  const openRows = items.filter((row) => row.status === "OPEN").sort((a, b) => (a.planDue ?? "").localeCompare(b.planDue ?? ""));
  const openRow = openRows[0] ?? null;
  const round = await tx.formSchedule.findFirst({ where: { id: plan.roundScheduleId, organizationId: plan.organizationId, deletedAt: null }, select: { id: true } });
  const holders = round ? await roundHolders(tx, plan.organizationId, plan.roundScheduleId) : [];
  const open = openRow ? { id: openRow.id, due: openRow.planDue ?? today, workOrderId: openRow.workOrderId, holderOpen: Boolean(openRow.workOrderId && openRow.workOrder && !CLOSED.has(openRow.workOrder.status)), touched: itemTouched(openRow) } : null;
  if ((plan.unit as PlanUnit) === "RUN_HOURS") {
    // Drifttimmar in the round: the item is made in the round's work order for today when the part reaches the hours.
    const step = runHoursStep({ every: plan.every, nextAt: plan.nextRunHours, runHours: plan.part.runHours, hasOpen: Boolean(open) || openOrder, isActive: active });
    let nextAt = step.nextAt;
    if (step.create) {
      const holder = holderForDay(holders, today);
      if (holder) { await createRoundItem(tx, plan, today, holder.id, actorId); summary.created = 1; }
      else { nextAt = plan.nextRunHours; summary.waiting = "no_holder"; summary.next = today; }
    }
    if (open && !open.holderOpen) {
      const holder = holderForDay(holders, today);
      if (holder) await tx.maintenanceItem.updateMany({ where: { id: open.id, organizationId: plan.organizationId, status: "OPEN" }, data: { workOrderId: holder.id } });
    }
    if (nextAt !== plan.nextRunHours) await tx.maintenancePlan.updateMany({ where: { id: plan.id, organizationId: plan.organizationId }, data: { nextRunHours: nextAt } });
    summary.nextRunHours = nextAt;
    return summary;
  }
  const step = roundPlanStep({ rule: { unit: plan.unit as PlanUnit, every: plan.every, startDate: plan.startDate, isActive: active }, orders: [...kept, ...items.map(asPlanOrder)], open, openOrder, holders, today });
  summary.next = step.next;
  summary.waiting = round ? step.waiting : "no_round";
  if (step.create) { await createRoundItem(tx, plan, step.create.due, step.create.workOrderId, actorId); summary.created = 1; }
  if (step.move) {
    // Moved by the plan, not changed by a person: the version stays, so the plan may still take it away when paused.
    const moved = await tx.maintenanceItem.updateMany({ where: { id: step.move.id, organizationId: plan.organizationId, status: "OPEN" }, data: { workOrderId: step.move.workOrderId } });
    summary.updated += moved.count;
  }
  if (step.remove.length) {
    const gone = await tx.maintenanceItem.deleteMany({ where: { organizationId: plan.organizationId, maintenancePlanId: plan.id, id: { in: step.remove }, status: "OPEN", version: 1, storeTransactions: { none: {} } } });
    summary.removed += gone.count;
  }
  return summary;
}

/**
 * Leaving the round (the plan is changed back to a work order per occurrence): an open item whose day is ahead and that nobody
 * touched goes; one that is due, late or touched stays where it is and counts as the open occurrence.
 */
async function dropRoundItems(tx: Prisma.TransactionClient, organizationId: string, planId: string, items: PlanItemRow[], today: string) {
  const ids = items.filter((row) => row.status === "OPEN" && (row.planDue ?? "") > today && !itemTouched(row)).map((row) => row.id);
  if (!ids.length) return { removed: 0, left: items };
  const gone = await tx.maintenanceItem.deleteMany({ where: { organizationId, maintenancePlanId: planId, id: { in: ids }, status: "OPEN", version: 1, storeTransactions: { none: {} } } });
  return { removed: gone.count, left: items.filter((row) => !ids.includes(row.id)) };
}

async function removeOrders(tx: Prisma.TransactionClient, organizationId: string, planId: string, ids: string[]) {
  if (!ids.length) return 0;
  // Only untouched, still planned work orders of this plan (checked again here): the item the plan made goes with them.
  const gone = (await tx.workflowTask.findMany({
    where: { organizationId, id: { in: ids }, maintenancePlanId: planId, status: "PLANNED", timeEntries: { none: {} }, linkedTasks: { none: {} }, plannedActivities: { none: {} }, storeTransactions: { none: {} }, purchases: { none: {} }, attachments: { none: {} }, invoiceBases: { none: {} } },
    select: { id: true },
  })).map((row) => row.id);
  if (!gone.length) return 0;
  await tx.maintenanceItem.deleteMany({ where: { organizationId, workOrderId: { in: gone }, source: "PLAN" } });
  const removed = await tx.workflowTask.deleteMany({ where: { organizationId, id: { in: gone } } });
  return removed.count;
}

/** A vilande work order's new Klart senast: kept when a person moved Start and Klart senast still holds it, else shifted with the day. */
function movedDueDate(row: OrderRow, day: string) {
  if (!isDayKey(row.dueDate)) return day;
  const shifted = row.maintenanceDue && isDayKey(row.maintenanceDue) ? addDays(row.dueDate, daysBetween(row.maintenanceDue, day)) : day;
  return shifted < day ? day : shifted;
}

export type FillSummary = {
  created: number; updated: number; removed: number; next: string | null; nextRunHours: number | null;
  /** A plan in a round that made nothing, and why (plan-model RoundStep.waiting; no_round: the round is gone). */
  waiting?: RoundStep["waiting"] | "no_round";
};

/**
 * Fyll på one plan: makes, moves and removes its vilande work orders (calendar time) or makes the work order at the hours
 * (drifttimmar). One transaction under a lock per plan, so the job and a save never fill the same plan twice at once.
 */
export async function fillPlan(organizationId: string, planId: string, now = new Date(), actorId = PLAN_CREATOR): Promise<FillSummary | null> {
  return prisma.$transaction(async (tx) => {
    await tx.$executeRaw`select pg_advisory_xact_lock(hashtext(${`maintenance-plan:${planId}`}))`;
    const plan = await tx.maintenancePlan.findFirst({ where: { id: planId, organizationId }, include: { part: { select: { id: true, name: true, runHours: true, isActive: true, status: true } } } });
    if (!plan) return null;
    const today = swedishDayKey(now);
    const rows = await tx.workflowTask.findMany({ where: { organizationId, maintenancePlanId: planId }, orderBy: [{ maintenanceDue: "asc" }, { id: "asc" }], take: 2000, select: orderSelect });
    const allItems = await tx.maintenanceItem.findMany({ where: { organizationId, maintenancePlanId: planId }, orderBy: [{ planDue: "asc" }, { id: "asc" }], take: 2000, select: itemSelect });
    // A paused or decommissioned part keeps no vilande work orders either.
    const active = plan.isActive && plan.part.isActive && plan.part.status !== "DECOMMISSIONED";
    if (plan.roundScheduleId) return fillRoundPlan(tx, { ...plan, roundScheduleId: plan.roundScheduleId }, rows, allItems, active, today, actorId, { created: 0, updated: 0, removed: 0, next: null, nextRunHours: plan.nextRunHours });
    // A work order per occurrence: the items left from a round count as occurrences (an open one as the open occurrence).
    const dropped = await dropRoundItems(tx, organizationId, plan.id, allItems, today);
    const orders = [...rows.map(planOrder), ...dropped.left.map(asPlanOrder)];
    const openItem = dropped.left.some((row) => row.status === "OPEN");
    let customer: string | null | undefined;
    const customerId = async () => {
      if (customer !== undefined) return customer;
      const parts = await tx.machinePart.findMany({ where: { organizationId }, select: { id: true, parentId: true, name: true, customerId: true }, take: PART_LIMIT });
      customer = parts.find((part) => part.id === rootOf(parts, plan.part.id))?.customerId ?? null;
      return customer;
    };
    const summary: FillSummary = { created: 0, updated: 0, removed: dropped.removed, next: null, nextRunHours: plan.nextRunHours };
    if ((plan.unit as PlanUnit) === "RUN_HOURS") {
      // Left over from calendar time (the plan's unit was changed): its vilande work orders go.
      const leftover = planFill({ unit: "DAY", every: 1, startDate: today, isActive: false }, orders, today).remove;
      summary.removed += await removeOrders(tx, organizationId, plan.id, leftover);
      const step = runHoursStep({ every: plan.every, nextAt: plan.nextRunHours, runHours: plan.part.runHours, hasOpen: openItem || rows.some((row) => !CLOSED.has(row.status) && !leftover.includes(row.id)), isActive: active });
      if (step.create) { await createOrder(tx, plan, today, await customerId(), actorId); summary.created = 1; }
      if (step.nextAt !== plan.nextRunHours) await tx.maintenancePlan.updateMany({ where: { id: plan.id, organizationId }, data: { nextRunHours: step.nextAt } });
      summary.nextRunHours = step.nextAt;
      return summary;
    }
    const fill = planFill({ unit: plan.unit as PlanUnit, every: plan.every, startDate: plan.startDate, isActive: active }, orders, today);
    summary.next = fill.next;
    for (const change of fill.update) {
      const row = rows.find((item) => item.id === change.id)!;
      const changed = await tx.workflowTask.updateMany({
        where: { id: change.id, organizationId, maintenancePlanId: plan.id, status: "PLANNED" },
        data: { maintenanceDue: change.due, maintenancePinned: change.pinned, plannedStartDate: change.due, dueDate: movedDueDate(row, change.due), version: { increment: 1 }, updatedBy: actorId },
      });
      summary.updated += changed.count;
    }
    for (const due of fill.create) await createOrder(tx, plan, due, await customerId(), actorId);
    summary.created = fill.create.length;
    summary.removed += await removeOrders(tx, organizationId, plan.id, fill.remove);
    return summary;
  }, { timeout: 30_000 });
}

/** After a work order was saved, closed, set to Utgår, reopened or moved: its plan fills again (nothing for other orders). */
export async function planOrderChanged(organizationId: string, taskId: string) {
  const order = await prisma.workflowTask.findFirst({ where: { id: taskId, organizationId }, select: { maintenancePlanId: true } });
  if (order?.maintenancePlanId) await fillPlan(organizationId, order.maintenancePlanId);
}

/** A plan's occurrence in a round was saved (Klar, Utgår, moved): its plan fills again – done counts the next from that day. */
export async function planItemChanged(organizationId: string, planId: string | null | undefined) {
  if (planId) await fillPlan(organizationId, planId);
}

/**
 * A round's work order was made, closed, set to Utgår, reopened or got another period: the plans done in that round fill again
 * (a plan that waited for a work order gets its item; an open item on a closed one follows to the next), and so do the plans
 * of the items it holds. Bounded; the night's job catches the rest.
 */
export async function roundOrderChanged(organizationId: string, order: { id: string; roundScheduleId?: string | null }) {
  const [byRound, byItem] = await Promise.all([
    order.roundScheduleId ? prisma.maintenancePlan.findMany({ where: { organizationId, roundScheduleId: order.roundScheduleId }, select: { id: true }, take: 200 }) : [],
    prisma.maintenanceItem.findMany({ where: { organizationId, workOrderId: order.id, maintenancePlanId: { not: null } }, distinct: ["maintenancePlanId"], select: { maintenancePlanId: true }, take: 200 }),
  ]);
  const ids = new Set([...byRound.map((row) => row.id), ...byItem.flatMap((row) => row.maintenancePlanId ? [row.maintenancePlanId] : [])]);
  for (const id of ids) await fillPlan(organizationId, id);
}

/** A part's drifttimmar or its pause changed: its plans fill again. */
export async function partPlansChanged(organizationId: string, partId: string) {
  const plans = await prisma.maintenancePlan.findMany({ where: { organizationId, partId }, select: { id: true }, take: PLAN_LIMIT_PER_PART });
  for (const plan of plans) await fillPlan(organizationId, plan.id);
}

/**
 * The night's job (scripts/maintenance/run-plans.ts): every plan of every active Cloud company fills again, one at a time.
 * A failing plan is counted and the rest go on. Prints counts only.
 */
export async function fillAllPlans(now = new Date()) {
  // Företagets moduler (0.39.0): with Underhåll off a plan makes nothing; it fills up by itself the night after the module is on.
  const plans = await prisma.maintenancePlan.findMany({ where: { organization: { isActive: true, storageMode: "HINTEK_CLOUD", ...moduleOnWhere("upkeep") } }, orderBy: { id: "asc" }, select: { id: true, organizationId: true }, take: 20_000 });
  const totals = { plans: plans.length, created: 0, updated: 0, removed: 0, failed: 0 };
  for (const plan of plans) {
    try {
      const result = await fillPlan(plan.organizationId, plan.id, now);
      if (result) { totals.created += result.created; totals.updated += result.updated; totals.removed += result.removed; }
    } catch {
      totals.failed += 1;
    }
  }
  return totals;
}

// ---------- the part's plans ----------

export type PlanOccurrence = {
  id: string; title: string; due: string; state: PlanOccurrenceState; pinned: boolean; assignedToName: string;
  /** Gör i driftronden (2026-11-27): the occurrence is an item in the round's work order (open it with `&item=`), not a work order. */
  itemId: string | null; workOrderId: string | null; workOrderTitle: string;
};
export type PlanView = {
  id: string; partId: string; name: string; description: string; unit: PlanUnit; every: number; intervalText: string; startDate: string; nextRunHours: number | null;
  assignedToUserId: string | null; assignedToName: string; estimatedMinutes: number | null; isActive: boolean; version: number;
  /** Vad som ska göras (2026-11-27): the checklist's texts. */
  checklist: string[];
  /** Gör i driftronden: the round (null: a work order per occurrence), and what the plan waits for ("" when nothing). */
  round: { id: string; title: string } | null;
  waitingText: string;
  /** The open occurrences (vilande, due, late, started), by day. */
  coming: PlanOccurrence[];
  /** The latest closed occurrence. */
  last: PlanOccurrence | null;
};

/** The rounds a plan can be done in: the company's rounds that are not removed (title and rule), for whoever edits plans. */
async function roundChoices(organizationId: string) {
  const rows = await prisma.formSchedule.findMany({ where: { organizationId, deletedAt: null }, orderBy: { title: "asc" }, take: 300, select: { id: true, title: true, rule: true, active: true } });
  return rows.map((row) => {
    const rule = formScheduleRuleSchema.safeParse(row.rule);
    return { id: row.id, title: row.title || "Driftrond", ruleText: rule.success ? scheduleRuleText(rule.data) : "", active: row.active };
  });
}

export async function listPlans(caller: MaintenanceCaller, partId: string) {
  const access = requireMaintenance(caller, "read");
  const part = await prisma.machinePart.findFirst({ where: { id: partId, organizationId: caller.organizationId }, select: { id: true, runHours: true } });
  if (!part) throw new ApiError(404, "Delen hittades inte.");
  const today = swedishDayKey(new Date());
  const plans = await prisma.maintenancePlan.findMany({ where: { organizationId: caller.organizationId, partId }, orderBy: [{ isActive: "desc" }, { name: "asc" }], take: PLAN_LIMIT_PER_PART,
    include: { roundSchedule: { select: { id: true, title: true, deletedAt: true } } } });
  const planIds = plans.map((plan) => plan.id);
  const [orders, items] = planIds.length ? await Promise.all([
    prisma.workflowTask.findMany({
      where: { organizationId: caller.organizationId, maintenancePlanId: { in: planIds }, maintenanceDue: { gte: addDays(today, -400) } },
      orderBy: [{ maintenanceDue: "asc" }, { id: "asc" }], take: 2000,
      select: { id: true, title: true, status: true, maintenancePlanId: true, maintenanceDue: true, maintenancePinned: true, maintenanceActivatedAt: true, completedAt: true, assignedToName: true },
    }),
    prisma.maintenanceItem.findMany({
      where: { organizationId: caller.organizationId, maintenancePlanId: { in: planIds }, planDue: { gte: addDays(today, -400) } },
      orderBy: [{ planDue: "asc" }, { id: "asc" }], take: 2000,
      select: { ...itemSelect, maintenancePlanId: true, fault: true, workOrder: { select: { id: true, title: true, status: true, assignedToName: true } } },
    }),
  ]) : [[], []];
  const roundIds = [...new Set(plans.flatMap((plan) => plan.roundScheduleId ? [plan.roundScheduleId] : []))];
  const holders = new Map<string, RoundHolder[]>();
  for (const roundId of roundIds) holders.set(roundId, await roundHolders(prisma, caller.organizationId, roundId));
  const [members, rounds] = access.edit ? await Promise.all([
    prisma.organizationMember.findMany({ where: { organizationId: caller.organizationId, isActive: true, user: { isActive: true } }, orderBy: { user: { name: "asc" } }, take: 500, select: { userId: true, user: { select: { name: true, email: true } } } }),
    roundChoices(caller.organizationId),
  ]) : [[], []];
  const occurrence = (row: (typeof orders)[number]): PlanOccurrence => ({ id: row.id, title: row.title, due: row.maintenanceDue ?? "", state: occurrenceState(row, today), pinned: row.maintenancePinned, assignedToName: row.assignedToName, itemId: null, workOrderId: row.id, workOrderTitle: row.title });
  const itemOccurrence = (row: (typeof items)[number]): PlanOccurrence => ({
    id: row.id, title: row.fault, due: row.planDue ?? "", state: itemOccurrenceState(row, today), pinned: false, assignedToName: row.workOrder?.assignedToName ?? "",
    itemId: row.id, workOrderId: row.workOrder?.id ?? null, workOrderTitle: row.workOrder?.title ?? "",
  });
  return {
    plans: plans.map((plan): PlanView => {
      const own = [...orders.filter((row) => row.maintenancePlanId === plan.id).map((row) => ({ view: occurrence(row), closed: CLOSED.has(row.status), at: row.completedAt?.getTime() ?? 0 })),
        ...items.filter((row) => row.maintenancePlanId === plan.id).map((row) => ({ view: itemOccurrence(row), closed: row.status !== "OPEN", at: row.completedAt?.getTime() ?? 0 }))];
      const closed = own.filter((row) => row.closed).sort((a, b) => a.at - b.at || a.view.due.localeCompare(b.view.due));
      const coming = own.filter((row) => !row.closed).map((row) => row.view).sort((a, b) => a.due.localeCompare(b.due));
      const round = plan.roundSchedule && !plan.roundSchedule.deletedAt ? { id: plan.roundSchedule.id, title: plan.roundSchedule.title || "Driftrond" } : null;
      let waitingText = "";
      if (plan.roundScheduleId && !round) waitingText = "Ronden finns inte längre. Välj en annan rond eller Egen arbetsorder.";
      else if (round && plan.isActive && (plan.unit as PlanUnit) !== "RUN_HOURS" && !coming.length) {
        const planItems = items.filter((row) => row.maintenancePlanId === plan.id);
        const step = roundPlanStep({ rule: { unit: plan.unit as PlanUnit, every: plan.every, startDate: plan.startDate, isActive: true }, orders: [...orders.filter((row) => row.maintenancePlanId === plan.id).map((row) => ({ id: row.id, status: row.status, due: row.maintenanceDue ?? "", activated: Boolean(row.maintenanceActivatedAt), pinned: row.maintenancePinned, plannedStartDate: row.maintenanceDue ?? "", completedDay: row.completedAt ? swedishDayKey(row.completedAt) : null, touched: true })), ...planItems.map(asPlanOrder)],
          open: null, openOrder: false, holders: holders.get(round.id) ?? [], today });
        waitingText = roundWaitingText(step, round.title);
      }
      return {
        id: plan.id, partId: plan.partId, name: plan.name, description: plan.description, unit: plan.unit as PlanUnit, every: plan.every, intervalText: intervalText(plan.unit as PlanUnit, plan.every),
        startDate: plan.startDate, nextRunHours: plan.nextRunHours, assignedToUserId: plan.assignedToUserId, assignedToName: plan.assignedToName, estimatedMinutes: plan.estimatedMinutes,
        isActive: plan.isActive, version: plan.version, checklist: readChecklistTexts(plan.checklist), round, waitingText,
        coming, last: closed.length ? closed.at(-1)!.view : null,
      };
    }),
    runHours: part.runHours,
    members: members.map((member) => ({ id: member.userId, name: member.user.name || member.user.email || "" })),
    rounds,
    canEdit: access.edit,
    canActivate: access.edit || access.workOrderEdit,
  };
}

/** The round a plan names must be the company's own and not removed. */
async function checkRound(organizationId: string, roundScheduleId: string | null) {
  if (!roundScheduleId) return;
  const round = await prisma.formSchedule.findFirst({ where: { id: roundScheduleId, organizationId, deletedAt: null }, select: { id: true } });
  if (!round) throw new ApiError(404, "Ronden hittades inte.");
}

export async function createPlan(caller: MaintenanceCaller, raw: unknown) {
  requireMaintenance(caller, "edit");
  const input = planInputSchema.parse(raw);
  const part = await prisma.machinePart.findFirst({ where: { id: input.partId, organizationId: caller.organizationId }, select: { id: true, name: true, runHours: true } });
  if (!part) throw new ApiError(404, "Delen hittades inte.");
  if (await prisma.maintenancePlan.count({ where: { organizationId: caller.organizationId, partId: part.id } }) >= PLAN_LIMIT_PER_PART) throw new ApiError(422, `Högst ${PLAN_LIMIT_PER_PART} planer per del.`);
  await checkRound(caller.organizationId, input.roundScheduleId);
  const assignedToName = await memberName(prisma, caller.organizationId, input.assignedToUserId);
  const plan = await prisma.$transaction(async (tx) => {
    const row = await tx.maintenancePlan.create({
      data: {
        organizationId: caller.organizationId, partId: part.id, name: input.name, description: input.description, unit: input.unit, every: input.every, startDate: input.startDate,
        nextRunHours: input.unit === "RUN_HOURS" ? firstRunHours({ every: input.every, runHours: part.runHours, chosen: input.firstRunHours }) : null,
        assignedToUserId: input.assignedToUserId, assignedToName, estimatedMinutes: input.estimatedMinutes, isActive: input.isActive, createdById: caller.userId, updatedById: caller.userId,
        checklist: input.checklist, roundScheduleId: input.roundScheduleId,
      },
      select: { id: true, version: true },
    });
    await audit(tx, caller, "maintenance_plan_created", `Underhåll: ny plan ${input.name} på ${part.name}${input.roundScheduleId ? " (görs i driftronden)" : ""}.`);
    return row;
  });
  const filled = await fillPlan(caller.organizationId, plan.id, new Date(), caller.userId);
  return { ...plan, created: filled?.created ?? 0, inRound: Boolean(input.roundScheduleId), waiting: filled?.waiting ?? null, next: filled?.next ?? null };
}

/**
 * Ändra planen: name, what is done, interval, start, responsible, estimated time, paused. The vilande work orders follow at
 * once (their days, and – for the ones the plan makes from now on – the title and responsible person). The part never changes.
 */
export async function updatePlan(caller: MaintenanceCaller, id: string, version: number, raw: unknown) {
  requireMaintenance(caller, "edit");
  const input = planInputSchema.parse(raw);
  const current = await prisma.maintenancePlan.findFirst({ where: { id, organizationId: caller.organizationId }, include: { part: { select: { name: true, runHours: true } } } });
  if (!current) throw new ApiError(404, NOT_FOUND);
  if (current.partId !== input.partId) throw new ApiError(409, "En plan byter inte del. Skapa en ny plan på den andra delen.");
  const assignedToName = input.assignedToUserId === current.assignedToUserId ? current.assignedToName : await memberName(prisma, caller.organizationId, input.assignedToUserId);
  if (input.roundScheduleId !== current.roundScheduleId) await checkRound(caller.organizationId, input.roundScheduleId);
  // Drifttimmar: a new "Första vid" counts while no work order is open; switching to drifttimmar starts from the hours now.
  const nextRunHours = input.unit !== "RUN_HOURS" ? null
    : current.unit !== "RUN_HOURS" || input.firstRunHours !== null ? firstRunHours({ every: input.every, runHours: current.part.runHours, chosen: input.firstRunHours }) : current.nextRunHours;
  await prisma.$transaction(async (tx) => {
    const changed = await tx.maintenancePlan.updateMany({
      where: { id, organizationId: caller.organizationId, version },
      data: { name: input.name, description: input.description, unit: input.unit, every: input.every, startDate: input.startDate, nextRunHours, assignedToUserId: input.assignedToUserId, assignedToName,
        estimatedMinutes: input.estimatedMinutes, isActive: input.isActive, checklist: input.checklist, roundScheduleId: input.roundScheduleId, updatedById: caller.userId, version: { increment: 1 } },
    });
    if (!changed.count) throw new ApiError(409, STALE);
    const today = swedishDayKey(new Date());
    // The vilande work orders take the new name, description, responsible person and estimated time.
    const dormantWhere = { organizationId: caller.organizationId, maintenancePlanId: id, status: "PLANNED", maintenanceActivatedAt: null, maintenanceDue: { gt: today } };
    const dormant = await tx.workflowTask.findMany({ where: dormantWhere, select: { id: true }, take: 2000 });
    await tx.workflowTask.updateMany({
      where: dormantWhere,
      data: { title: planOrderTitle(input.name, current.part.name), description: input.description, assignedToUserId: input.assignedToUserId, assignedToName, estimatedMinutes: input.estimatedMinutes, version: { increment: 1 }, updatedBy: caller.userId },
    });
    // What is to be done follows to the occurrences nobody has started on: the vilande work orders' items, and an untouched item in
    // the round whose day is ahead (a touched one keeps what the person worked from). The version stays: the plan changed it, not a person.
    const work = { fault: input.name, instruction: input.description.slice(0, 2000), checklist: checklistRows(input.checklist) as unknown as Prisma.InputJsonValue };
    if (dormant.length) await tx.maintenanceItem.updateMany({ where: { organizationId: caller.organizationId, workOrderId: { in: dormant.map((row) => row.id) }, source: "PLAN", status: "OPEN", version: 1 }, data: work });
    await tx.maintenanceItem.updateMany({ where: { organizationId: caller.organizationId, maintenancePlanId: id, status: "OPEN", version: 1, planDue: { gt: today }, storeTransactions: { none: {} } }, data: work });
    if (current.isActive !== input.isActive) await audit(tx, caller, "maintenance_plan_paused", `Underhåll: planen ${input.name} ${input.isActive ? "aktiv igen" : "pausad"}.`);
    if (current.roundScheduleId !== input.roundScheduleId) await audit(tx, caller, "maintenance_plan_round", `Underhåll: planen ${input.name} ${input.roundScheduleId ? "görs i driftronden" : "får egna arbetsordrar"}.`);
  });
  await fillPlan(caller.organizationId, id, new Date(), caller.userId);
  return { id, version: version + 1 };
}

/** Ta bort: only while none of its work orders has history (closed, started, or something hangs on it); else pause it. */
export async function deletePlan(caller: MaintenanceCaller, id: string) {
  requireMaintenance(caller, "edit");
  return prisma.$transaction(async (tx) => {
    await tx.$executeRaw`select pg_advisory_xact_lock(hashtext(${`maintenance-plan:${id}`}))`;
    const plan = await tx.maintenancePlan.findFirst({ where: { id, organizationId: caller.organizationId }, select: { id: true, name: true } });
    if (!plan) throw new ApiError(404, NOT_FOUND);
    const rows = await tx.workflowTask.findMany({ where: { organizationId: caller.organizationId, maintenancePlanId: id }, take: 2000, select: orderSelect });
    if (rows.some((row) => row.status !== "PLANNED" || touched(row) || row.maintenanceActivatedAt)) throw new ApiError(409, "Planen har arbetsordrar med historik. Pausa den i stället.");
    // Its occurrences in a round: only open ones nobody touched may go with it.
    const items = await tx.maintenanceItem.findMany({ where: { organizationId: caller.organizationId, maintenancePlanId: id }, take: 2000, select: itemSelect });
    if (items.some((row) => row.status !== "OPEN" || itemTouched(row))) throw new ApiError(409, "Planen har tillfällen med historik i driftronden. Pausa den i stället.");
    if (items.length) await tx.maintenanceItem.deleteMany({ where: { organizationId: caller.organizationId, maintenancePlanId: id, status: "OPEN", version: 1 } });
    const removed = await removeOrders(tx, caller.organizationId, id, rows.map((row) => row.id));
    if (removed !== rows.length) throw new ApiError(409, "Planen har ändrats. Läs in den igen.");
    await tx.maintenancePlan.deleteMany({ where: { id, organizationId: caller.organizationId } });
    await audit(tx, caller, "maintenance_plan_removed", `Underhåll: tog bort planen ${plan.name}.`);
    return { ok: true, removed };
  });
}

// ---------- one occurrence ----------

async function readPlanOrder(caller: MaintenanceCaller, id: string) {
  const access = maintenanceAccess(caller);
  if (!access.cloud || !(access.edit || access.workOrderEdit)) throw new ApiError(403, "Du saknar behörighet att ändra arbetsordern.");
  const order = await prisma.workflowTask.findFirst({ where: { id, organizationId: caller.organizationId, kind: "WORK_ORDER" }, select: { id: true, status: true, dueDate: true, maintenancePlanId: true, maintenanceDue: true, maintenanceActivatedAt: true } });
  if (!order?.maintenancePlanId) throw new ApiError(404, "Arbetsordern hittades inte i någon underhållsplan.");
  return { ...order, maintenancePlanId: order.maintenancePlanId };
}

/** Aktivera nu: a vilande work order becomes active before its day (planned activities, time, start). The day stays. */
export async function activateOrder(caller: MaintenanceCaller, id: string) {
  const order = await readPlanOrder(caller, id);
  if (!isDormant(order, swedishDayKey(new Date()))) return { ok: true, changed: false };
  await prisma.workflowTask.updateMany({ where: { id, organizationId: caller.organizationId, status: "PLANNED" }, data: { maintenanceActivatedAt: new Date(), version: { increment: 1 }, updatedBy: caller.userId } });
  return { ok: true, changed: true };
}

/**
 * Skjut upp: the occurrence gets another day (kept from now on), and the plan's following ones move with it. A planned one
 * that is moved ahead is vilande again until its new day.
 */
export async function postponeOrder(caller: MaintenanceCaller, id: string, day: string) {
  if (!isDayKey(day)) throw new ApiError(400, "Ange ett datum (ÅÅÅÅ-MM-DD).");
  const order = await readPlanOrder(caller, id);
  if (CLOSED.has(order.status)) throw new ApiError(409, "Arbetsordern är stängd.");
  if (day < swedishDayKey(new Date())) throw new ApiError(400, "Välj i dag eller en senare dag.");
  await prisma.workflowTask.updateMany({
    where: { id, organizationId: caller.organizationId, status: { notIn: [...CLOSED] } },
    data: { maintenanceDue: day, maintenancePinned: true, plannedStartDate: day, dueDate: isDayKey(order.dueDate) && order.dueDate > day ? order.dueDate : day,
      ...(order.status === "PLANNED" ? { maintenanceActivatedAt: null } : {}), version: { increment: 1 }, updatedBy: caller.userId },
  });
  await fillPlan(caller.organizationId, order.maintenancePlanId, new Date(), caller.userId);
  return { ok: true };
}

// ---------- the planning (Kalender) ----------

export const PLANNING_MAINTENANCE_LIMIT = 1000;

/**
 * The plans' work orders whose day lies in the period, for Planering → Kalender (vilande ones clearly marked). For whoever
 * reads Underhåll or work orders; Cloud only (the module is).
 */
export async function planningMaintenance(caller: MaintenanceCaller, from: string, to: string) {
  const access = maintenanceAccess(caller);
  if (!access.cloud || !(access.read || access.workOrderRead) || !isDayKey(from) || !isDayKey(to)) return { occurrences: [] as PlanningMaintenance[], truncated: false };
  const today = swedishDayKey(new Date());
  const rows = await prisma.workflowTask.findMany({
    where: { organizationId: caller.organizationId, kind: "WORK_ORDER", maintenancePlanId: { not: null }, maintenanceDue: { gte: from, lte: to > addDays(from, 400) ? addDays(from, 400) : to } },
    orderBy: [{ maintenanceDue: "asc" }, { title: "asc" }], take: PLANNING_MAINTENANCE_LIMIT + 1,
    select: { id: true, title: true, status: true, maintenancePlanId: true, maintenanceDue: true, maintenanceActivatedAt: true, assignedToUserId: true, assignedToName: true, projectId: true, machinePart: { select: { name: true } } },
  });
  return {
    occurrences: rows.slice(0, PLANNING_MAINTENANCE_LIMIT).map((row): PlanningMaintenance => ({
      id: row.id, title: row.title, partName: row.machinePart?.name ?? "", date: row.maintenanceDue ?? "", state: occurrenceState(row, today), assignedToUserId: row.assignedToUserId,
      assignedToName: row.assignedToName, projectId: row.projectId,
    })),
    truncated: rows.length > PLANNING_MAINTENANCE_LIMIT,
  };
}
