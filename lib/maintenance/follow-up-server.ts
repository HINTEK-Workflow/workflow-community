import { prisma } from "@/lib/db";
import { ApiError } from "@/lib/kfid/server";
import { swedishDayKey } from "@/lib/swedish-time";
import { addDays } from "@/lib/workflow/schedule";
import { hasWorkflowPermission } from "@/lib/workflow/permissions";
import { maintenanceDowntimeMinutes, MAINTENANCE_TYPE_LABELS, type MaintenanceType } from "@/lib/workflow/maintenance";
import { deviationReadWhere } from "@/lib/self-inspection/incidents";
import { ITEM_SOURCE_LABELS, ITEM_STATUS_LABELS, PART_LIMIT, subtreeIds, type ItemSource, type ItemStatus, type MaintenanceCaller } from "./model";
import { PLACE_ALL, PLACE_NONE } from "./place-model";
import { partsAtPlace } from "./place-server";
import { checklistText, daysLate, FOLLOW_UP_DAYS, readChecklist, followUpText, isDormant, itemOccurrenceState, occurrenceState, planFollowUp, type FollowUpOccurrence, type PlanFollowUp, type PlanOccurrenceState } from "./plan-model";
import { requireMaintenance } from "./server";
import { partFindings } from "@/lib/kfid/round-follow-up-server";
import { findingState, ROUND_FOLLOW_UP_LABELS, roundFollowUpOf } from "@/lib/workflow/round-follow-up";

/**
 * Förfallet och i tid, and the part's history (2026-11-27, docs/beslut/underhall-cmms-2026-11-27.md): read when asked,
 * never stored. Every query is bound to the caller's company and needs the module's read right (lib/maintenance/server.ts).
 * The rules are pure in ./plan-model.ts (planFollowUp).
 */

const OCCURRENCE_LIMIT = 5000;
const LIST_LIMIT = 50;
const SOON_DAYS = 14;

export type FollowUpRow = {
  /** The work order (an occurrence of its own) or the item (an occurrence in a round). */
  kind: "order" | "item"; id: string; workOrderId: string | null; title: string; partName: string; planName: string; due: string; state: PlanOccurrenceState; daysLate: number; assignedToName: string;
};
export type FollowUp = { figures: PlanFollowUp; text: string; late: FollowUpRow[]; soon: FollowUpRow[]; plans: number; truncated: boolean };

/** The parts in scope: a part and everything under it, or every part on a place (Alla platser, Utan plats too). */
async function scopeParts(caller: MaintenanceCaller, scope: { partId: string } | { placeChoice: string }) {
  if ("partId" in scope) {
    const all = await prisma.machinePart.findMany({ where: { organizationId: caller.organizationId }, select: { id: true, parentId: true, name: true }, take: PART_LIMIT });
    if (!all.some((part) => part.id === scope.partId)) throw new ApiError(404, "Delen hittades inte.");
    return subtreeIds(all, scope.partId);
  }
  const choice = scope.placeChoice;
  const { parts, roots } = await partsAtPlace(caller, choice === PLACE_ALL ? { placeId: null } : choice === PLACE_NONE ? { placeId: null, withoutPlace: true } : { placeId: choice });
  return roots.flatMap((root) => subtreeIds(parts, root));
}

/**
 * Hur väl planen följs for a part or a place: the share done in time over the last year (only calendar plans; drifttimmar
 * have no day), the occurrences past their day that are still open (Förfallet, the oldest first), and what is due within two
 * weeks (vilande ones too, marked).
 */
export async function planFollowUpOf(caller: MaintenanceCaller, scope: { partId: string } | { placeChoice: string }, now = new Date()): Promise<FollowUp> {
  requireMaintenance(caller, "read");
  const organizationId = caller.organizationId;
  const ids = await scopeParts(caller, scope);
  const today = swedishDayKey(now);
  const plans = ids.length ? await prisma.maintenancePlan.findMany({ where: { organizationId, partId: { in: ids } }, select: { id: true, name: true, unit: true, part: { select: { name: true } } }, take: 5000 }) : [];
  const empty: FollowUp = { figures: planFollowUp([], today), text: followUpText(planFollowUp([], today)), late: [], soon: [], plans: 0, truncated: false };
  if (!plans.length) return empty;
  const planIds = plans.map((plan) => plan.id);
  const byId = new Map(plans.map((plan) => [plan.id, plan]));
  const from = addDays(today, -FOLLOW_UP_DAYS);
  const until = addDays(today, SOON_DAYS);
  const [orders, items] = await Promise.all([
    prisma.workflowTask.findMany({
      where: { organizationId, kind: "WORK_ORDER", maintenancePlanId: { in: planIds }, OR: [{ maintenanceDue: { gte: from, lte: until } }, { maintenanceDue: { lt: from }, status: { notIn: ["COMPLETED", "CANCELLED"] } }] },
      orderBy: [{ maintenanceDue: "asc" }, { id: "asc" }], take: OCCURRENCE_LIMIT + 1,
      select: { id: true, title: true, status: true, maintenancePlanId: true, maintenanceDue: true, maintenanceActivatedAt: true, completedAt: true, assignedToName: true },
    }),
    prisma.maintenanceItem.findMany({
      where: { organizationId, maintenancePlanId: { in: planIds }, OR: [{ planDue: { gte: from, lte: until } }, { planDue: { lt: from }, status: "OPEN" }] },
      orderBy: [{ planDue: "asc" }, { id: "asc" }], take: OCCURRENCE_LIMIT + 1,
      select: { id: true, fault: true, status: true, maintenancePlanId: true, planDue: true, completedAt: true, workOrder: { select: { id: true, assignedToName: true } } },
    }),
  ]);
  const occurrences: FollowUpOccurrence[] = [];
  const rows: FollowUpRow[] = [];
  for (const order of orders.slice(0, OCCURRENCE_LIMIT)) {
    const plan = byId.get(order.maintenancePlanId ?? "");
    if (!plan) continue;
    const due = order.maintenanceDue ?? "";
    const dormant = isDormant(order, today);
    occurrences.push({ due, status: order.status, completedDay: order.completedAt ? swedishDayKey(order.completedAt) : null, calendar: plan.unit !== "RUN_HOURS", dormant });
    if (order.status === "COMPLETED" || order.status === "CANCELLED") continue;
    rows.push({ kind: "order", id: order.id, workOrderId: order.id, title: order.title, partName: plan.part.name, planName: plan.name, due, state: occurrenceState(order, today), daysLate: daysLate(due, today), assignedToName: order.assignedToName });
  }
  for (const item of items.slice(0, OCCURRENCE_LIMIT)) {
    const plan = byId.get(item.maintenancePlanId ?? "");
    if (!plan) continue;
    const due = item.planDue ?? "";
    const status = item.status === "DONE" ? "COMPLETED" : item.status === "CANCELLED" ? "CANCELLED" : "PLANNED";
    occurrences.push({ due, status, completedDay: item.completedAt ? swedishDayKey(item.completedAt) : null, calendar: plan.unit !== "RUN_HOURS" });
    if (item.status !== "OPEN") continue;
    rows.push({ kind: "item", id: item.id, workOrderId: item.workOrder?.id ?? null, title: item.fault || plan.name, partName: plan.part.name, planName: plan.name, due, state: itemOccurrenceState(item, today), daysLate: daysLate(due, today), assignedToName: item.workOrder?.assignedToName ?? "" });
  }
  const figures = planFollowUp(occurrences, today);
  const byDay = (a: FollowUpRow, b: FollowUpRow) => a.due.localeCompare(b.due) || a.title.localeCompare(b.title, "sv");
  return {
    figures, text: followUpText(figures), plans: plans.length,
    late: rows.filter((row) => row.due < today).sort(byDay).slice(0, LIST_LIMIT),
    soon: rows.filter((row) => row.due >= today && row.due <= until).sort(byDay).slice(0, LIST_LIMIT),
    truncated: orders.length > OCCURRENCE_LIMIT || items.length > OCCURRENCE_LIMIT,
  };
}

// ---------- the part's history ----------

export type HistoryEntry = {
  kind: "order" | "item" | "deviation" | "finding"; id: string; at: string; title: string; line: string; status: string; tone: "success" | "info" | "warning" | "danger" | "neutral";
  /** Where it opens: a work order, a maintenance item (Underhåll's own page) or the deviation log entry. */
  workOrderId: string | null; itemId: string | null; deviationId: string | null;
  /** A brist from a driftrond (2026-11-27): the protocol it opens, its comment and its photos (the protocol's attachment ids). */
  taskId?: string | null; comment?: string; images?: string[];
};

const ORDER_STATUS: Record<string, { label: string; tone: HistoryEntry["tone"] }> = {
  PLANNED: { label: "Planerad", tone: "info" }, IN_PROGRESS: { label: "Pågår", tone: "warning" }, NEEDS_ACTION: { label: "Behöver åtgärdas", tone: "warning" }, PAUSED: { label: "Pausad", tone: "neutral" },
  COMPLETED: { label: "Färdigställd", tone: "success" }, CANCELLED: { label: "Utgått", tone: "neutral" },
};
const HISTORY_LIMIT = 100;
const iso = (value: Date) => value.toISOString();
const minutesText = (minutes: number) => minutes >= 60 ? `${Math.floor(minutes / 60)} h${minutes % 60 ? ` ${minutes % 60} min` : ""}` : `${minutes} min`;

/**
 * Historik (2026-11-27): one list of what happened on a part and everything under it, newest first – its work orders
 * (with the kind of maintenance, the stop and how many files), the maintenance items not held by a work order, and the
 * deviation log entries the work orders fix (only those the person may read, the log's own rule). Vilande work orders are
 * left out: they have not happened. At most 100 rows.
 */
export async function partHistory(caller: MaintenanceCaller, partId: string, now = new Date()) {
  requireMaintenance(caller, "read");
  const organizationId = caller.organizationId;
  const ids = await scopeParts(caller, { partId });
  const today = swedishDayKey(now);
  const [orders, drafts] = await Promise.all([
    prisma.workflowTask.findMany({
      where: { organizationId, kind: "WORK_ORDER", OR: [{ machinePartId: { in: ids } }, { maintenanceItems: { some: { partId: { in: ids } } } }] },
      orderBy: { updatedAt: "desc" }, take: HISTORY_LIMIT * 2,
      select: {
        id: true, title: true, status: true, createdAt: true, completedAt: true, maintenancePlanId: true, maintenanceDue: true, maintenanceActivatedAt: true, roundScheduleId: true, machinePartId: true, data: true,
        _count: { select: { attachments: true } },
        maintenanceItems: {
          where: { partId: { in: ids } }, orderBy: { createdAt: "desc" }, take: 60,
          select: { id: true, type: true, source: true, stoppedAt: true, restoredAt: true, status: true, fault: true, completedAt: true, maintenancePlanId: true, planDue: true, checklist: true, part: { select: { name: true } }, maintenancePlan: { select: { name: true } } },
        },
      },
    }),
    prisma.maintenanceItem.findMany({ where: { organizationId, partId: { in: ids }, workOrderId: null }, orderBy: { createdAt: "desc" }, take: 30, select: { id: true, status: true, type: true, fault: true, source: true, createdAt: true, part: { select: { name: true } } } }),
  ]);
  const shown = orders.filter((order) => !isDormant(order, today));
  const team = caller.admin || hasWorkflowPermission(caller.permissions, "team", "read");
  const deviations = shown.length ? await prisma.selfInspectionDeviation.findMany({
    where: { organizationId, workOrderId: { in: shown.map((order) => order.id) }, AND: [deviationReadWhere({ admin: caller.admin, id: caller.userId, team })] },
    orderBy: { createdAt: "desc" }, take: 50, select: { id: true, number: true, title: true, status: true, createdAt: true, workOrderId: true },
  }) : [];
  const entries: HistoryEntry[] = [];
  for (const order of shown) {
    // Underhåll i driftronden (2026-11-27): each plan occurrence in the round's work order is its own row – Klar on the day it was
    // done, else on its planned day once that has come (a coming one has not happened). The round's work order, open for a year,
    // is shown itself only when it holds other maintenance on the part or is the part's own.
    const planItems = order.maintenanceItems.filter((item) => item.maintenancePlanId && item.planDue);
    const items = order.maintenanceItems.filter((item) => !(item.maintenancePlanId && item.planDue));
    for (const item of planItems) {
      const due = item.planDue as string;
      if (item.status === "OPEN" && due > today) continue;
      const checklist = readChecklist(item.checklist);
      entries.push({
        kind: "item", id: item.id, at: item.completedAt ? iso(item.completedAt) : `${due}T12:00:00.000Z`, title: `Underhåll · ${item.maintenancePlan?.name || item.fault || "Planerat underhåll"}`,
        status: ITEM_STATUS_LABELS[item.status as ItemStatus] ?? item.status, tone: item.status === "DONE" ? "success" : item.status === "CANCELLED" ? "neutral" : due < today ? "warning" : "info",
        workOrderId: order.id, itemId: item.id, deviationId: null,
        line: [item.part.name, "Driftrond", order.title, `Planerat ${due}`, checklistText(checklist)].filter(Boolean).join(" · "),
      });
    }
    if (!items.length && !(order.machinePartId && ids.includes(order.machinePartId)) && planItems.length) continue;
    const types = [...new Set(items.map((item) => item.type).filter(Boolean))].map((type) => MAINTENANCE_TYPE_LABELS[type as MaintenanceType] ?? "").filter(Boolean);
    const sources = [...new Set(items.map((item) => ITEM_SOURCE_LABELS[item.source as ItemSource] ?? "").filter(Boolean))];
    const downtime = items.reduce((sum, item) => sum + (maintenanceDowntimeMinutes({ stoppedAt: item.stoppedAt?.toISOString() ?? null, restoredAt: item.restoredAt?.toISOString() ?? null }) ?? 0), 0);
    const parts = [...new Set(items.map((item) => item.part.name))];
    const status = ORDER_STATUS[order.status] ?? { label: order.status, tone: "neutral" as const };
    // Från ronden (2026-11-27): a work order made from a brist in a round says so, Akut or Planerad.
    const fromRound = roundFollowUpOf(order.data);
    entries.push({
      kind: "order", id: order.id, at: iso(order.completedAt ?? order.createdAt), title: order.title, status: status.label, tone: status.tone, workOrderId: order.id, itemId: null, deviationId: null,
      line: [parts.join(", "), ...types, ...sources, order.roundScheduleId ? "Driftrond" : "", fromRound ? `Från ronden, ${ROUND_FOLLOW_UP_LABELS[fromRound.kind].toLowerCase()}` : "", downtime ? `Stillestånd ${minutesText(downtime)}` : "", order._count.attachments ? `${order._count.attachments} ${order._count.attachments === 1 ? "fil" : "filer"}` : ""].filter(Boolean).join(" · "),
    });
  }
  for (const item of drafts) entries.push({
    kind: "item", id: item.id, at: iso(item.createdAt), title: item.fault || "Underhållspost", status: ITEM_STATUS_LABELS[item.status as ItemStatus] ?? item.status,
    tone: item.status === "DONE" ? "success" : item.status === "CANCELLED" ? "neutral" : "info", workOrderId: null, itemId: item.id, deviationId: null,
    line: [item.part.name, item.type ? MAINTENANCE_TYPE_LABELS[item.type as MaintenanceType] ?? "" : "", ITEM_SOURCE_LABELS[item.source as ItemSource] ?? "", "Utan arbetsorder"].filter(Boolean).join(" · "),
  });
  const titles = new Map(shown.map((order) => [order.id, order.title]));
  for (const deviation of deviations) entries.push({
    kind: "deviation", id: deviation.id, at: iso(deviation.createdAt), title: `Avvikelse ${deviation.number}: ${deviation.title}`, status: deviation.status === "DONE" ? "Åtgärdad" : deviation.status === "IN_PROGRESS" ? "Pågår" : "Öppen",
    tone: deviation.status === "DONE" ? "success" : "warning", workOrderId: deviation.workOrderId, itemId: null, deviationId: deviation.id, line: `Åtgärdas i ${titles.get(deviation.workOrderId ?? "") ?? "arbetsordern"}`,
  });
  // Brister från driftronden (2026-11-27): Åtgärdad direkt with its comment and photo, and the ones that became a work order.
  for (const finding of await partFindings(caller, partId)) {
    const state = findingState(finding);
    entries.push({
      kind: "finding", id: `${finding.protocolId}:${finding.rowId}`, at: finding.at, title: `Brist · ${finding.point || finding.description.split("\n")[0] || "Brist i ronden"}`,
      status: state.label, tone: state.tone, workOrderId: finding.workOrderId, itemId: null, deviationId: null, taskId: finding.protocolId,
      comment: finding.comment, images: finding.images,
      line: [finding.partName, `Driftrond ${finding.day}`, finding.protocolTitle, finding.point ? finding.description : "", finding.severity].filter(Boolean).join(" · ").slice(0, 400),
    });
  }
  entries.sort((a, b) => b.at.localeCompare(a.at));
  return { entries: entries.slice(0, HISTORY_LIMIT), truncated: entries.length > HISTORY_LIMIT || orders.length >= HISTORY_LIMIT * 2 };
}
export type PartHistory = Awaited<ReturnType<typeof partHistory>>;
