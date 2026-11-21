import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { clearAlarmNotices, noteAlarm, notifyAlarm } from "@/lib/machine/alarm-notice-store";
import { SIM_TEXT_PREFIX } from "@/lib/machine/simulator/limits";
import { alarmOrderText, decideAlarm, SYSTEM_CREATOR, triggersOrder, type AlarmMode } from "@/lib/machine/alarm-rules";
import { resolveScope, STOP_BEFORE_ALARM_MS } from "@/lib/machine/alarm-scope";
import { signalIgnored, steeringSignal, type CatalogueSignal } from "@/lib/machine/signals";
import { workflowTaskInputSchema, workflowTaskProgress } from "@/lib/workflow/task-model";

/**
 * Larm blir arbetsorder (S3). Called after an event is saved. Rules:
 * - only a new alarm of level fault or critical counts; the source's mode says what happens (off / direct / approval);
 *   an alarm code the admin set to Ignorerad in the signal catalogue (E2) makes nothing;
 * - at most one open row per company and scope (integrationsmotorn E1: the object, else the source), claimed by the database
 *   itself (partial unique index), so two alarms at once – or two sources on the same object – make one;
 * - a cooldown after each row of the scope and a daily cap per company (20 by default, Workflow may raise it per company);
 * - the order is made by the system ("Maskinlarm"), gets the machine part (Underhåll, 2026-10-30: the machine tree,
 *   never the customer's place tree) and the tree's customer, holds a maintenance item on the part, is only Planerad, and is
 *   never closed or finished automatically.
 * It never throws into the intake: a failure here must not lose the event, which is already saved.
 */

type AlarmNoteReason = Parameters<typeof noteAlarm>[0]["reason"];
type StoredAlarm = { id: string; occurredAt: Date; type: string; code: string; severity: string; state: string | null; text: string };
const DAY_MS = 24 * 3_600_000;

/** Rows whose order is finished, cancelled or gone no longer count as open. decidedAt stays: the key figures count from it. */
async function releaseFinished(organizationId: string, scopeKey: string) {
  const open = await prisma.machineAlarmOrder.findMany({ where: { organizationId, scopeKey, status: "created" }, select: { id: true, taskId: true } });
  for (const row of open) {
    const task = row.taskId ? await prisma.workflowTask.findFirst({ where: { id: row.taskId, organizationId }, select: { status: true } }) : null;
    if (!task || task.status === "COMPLETED" || task.status === "CANCELLED") {
      await prisma.machineAlarmOrder.updateMany({ where: { id: row.id, status: "created" }, data: { status: "closed" } });
    }
  }
}

export async function considerAlarm(principal: { sourceId: string; organizationId: string }, event: StoredAlarm, now = new Date(), signal: CatalogueSignal | null = null): Promise<"created" | "queued" | "skipped"> {
  try {
    // 2026-11-05: an alarm that gives no order is told too, with why. An alarm the admin set to Ignorerad is not, and a real
    // machine's lowest level is no alarm to bother anyone with.
    const simulated = event.text.startsWith(SIM_TEXT_PREFIX);
    const tell = (reason: AlarmNoteReason, taskId: string | null = null) => noteAlarm({ organizationId: principal.organizationId, sourceId: principal.sourceId, eventId: event.id, reason, simulated, taskId, now });
    if (signalIgnored(signal)) return "skipped";
    if (!triggersOrder(event)) {
      if (event.type === "alarm" && event.state !== "cleared" && (simulated || event.severity === "warning")) {
        const off = await prisma.machineSource.findFirst({ where: { id: principal.sourceId, organizationId: principal.organizationId }, select: { alarmMode: true } });
        await tell(off?.alarmMode === "off" ? "off" : "level");
      }
      return "skipped";
    }
    const source = await prisma.machineSource.findFirst({
      where: { id: principal.sourceId, organizationId: principal.organizationId },
      select: { name: true, alarmMode: true, cooldownMinutes: true, machinePartId: true, organization: { select: { machineDailyOrderCap: true } } },
    });
    if (!source) return "skipped";
    // E2: an active code signal decides – its own machine part, else the source's, else the signal itself.
    const scope = resolveScope({ sourceId: principal.sourceId, sourcePartId: source.machinePartId, signal: steeringSignal(signal) });
    await releaseFinished(principal.organizationId, scope.scopeKey);
    const [last, rowsToday] = await Promise.all([
      prisma.machineAlarmOrder.findFirst({ where: { organizationId: principal.organizationId, scopeKey: scope.scopeKey }, orderBy: { createdAt: "desc" }, select: { createdAt: true, taskId: true } }),
      prisma.machineAlarmOrder.count({ where: { organizationId: principal.organizationId, createdAt: { gte: new Date(now.getTime() - DAY_MS) } } }),
    ]);
    const decision = decideAlarm({ mode: source.alarmMode as AlarmMode, now, cooldownMinutes: source.cooldownMinutes, lastRowAt: last?.createdAt ?? null, rowsToday, dailyCap: source.organization.machineDailyOrderCap });
    if (decision.act === "skip") {
      await (decision.reason === "mode_off" ? tell("off") : decision.reason === "daily_cap" ? tell("cap") : tell("cooldown", last?.taskId ?? null));
      return "skipped";
    }
    const base = {
      organizationId: principal.organizationId, sourceId: principal.sourceId, eventRef: event.id, code: event.code, severity: event.severity, text: event.text.slice(0, 200),
      scopeKey: scope.scopeKey, machinePartId: scope.partId,
    };
    let row: { id: string };
    try {
      row = await prisma.machineAlarmOrder.create({ data: { ...base, status: "pending" }, select: { id: true } });
    } catch (error) {
      // The partial unique index: another alarm of the same object (or source) is still open.
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
        const open = await prisma.machineAlarmOrder.findFirst({ where: { organizationId: principal.organizationId, scopeKey: scope.scopeKey, status: { in: ["pending", "created"] } }, orderBy: { createdAt: "desc" }, select: { taskId: true } });
        await tell("open", open?.taskId ?? null);
        return "skipped";
      }
      throw error;
    }
    if (decision.act === "queue") {
      // S4: administrators are told that a suggestion waits (never throws).
      await notifyAlarm({ organizationId: principal.organizationId, sourceId: principal.sourceId, pendingRowId: row.id });
      return "queued";
    }
    try {
      await makeOrder(row.id, principal.organizationId, source.name, event, now);
    } catch (error) {
      // A row that could not get its order must not block the object: it is set aside.
      await prisma.machineAlarmOrder.updateMany({ where: { id: row.id, status: "pending" }, data: { status: "dismissed", decidedAt: now } });
      throw error;
    }
    return "created";
  } catch (error) {
    console.error("machine alarm order failed", error instanceof Error ? error.message : "unknown");
    return "skipped";
  }
}

/**
 * The order's machine part and customer: the row's part, and the customer that owns its tree (Eget företag for the company's
 * own tree; none when the customer is removed). A part that is gone gives an order without them, as before E1.
 */
async function orderPart(organizationId: string, partId: string | null) {
  if (!partId) return { customerId: null, partId: null, partName: "" };
  const part = await prisma.machinePart.findFirst({ where: { id: partId, organizationId }, select: { id: true, name: true, parentId: true, customerId: true } });
  if (!part) return { customerId: null, partId: null, partName: "" };
  let root: { parentId: string | null; customerId: string | null } = part;
  for (let depth = 0; root.parentId && depth < 12; depth += 1) {
    const parent = await prisma.machinePart.findFirst({ where: { id: root.parentId, organizationId }, select: { parentId: true, customerId: true } });
    if (!parent) break;
    root = parent;
  }
  // The company's own tree (Eget) gives the order to the company's own record, Eget företag, when there is one.
  const customer = await prisma.customer.findFirst({ where: { organizationId, deletedAt: null, ...(root.customerId ? { id: root.customerId } : { ownCompany: true }) }, select: { id: true } });
  return { customerId: customer?.id ?? null, partId: part.id, partName: part.name };
}

/**
 * "Ur drift" from the machine itself: the object's (or, without one, the source's) latest run state from shortly before
 * the alarm on, when it is `stopped` – sent before the alarm, or earlier in the same call.
 */
async function stoppedBefore(organizationId: string, scope: { sourceId: string; machinePartId: string | null }, alarmAt: Date) {
  const latest = await prisma.machineEvent.findFirst({
    where: { organizationId, type: "state", occurredAt: { gte: new Date(alarmAt.getTime() - STOP_BEFORE_ALARM_MS) }, ...(scope.machinePartId ? { machinePartId: scope.machinePartId } : { sourceId: scope.sourceId }) },
    orderBy: { occurredAt: "desc" }, select: { state: true, occurredAt: true },
  });
  return latest?.state === "stopped" ? latest.occurredAt.toISOString() : null;
}

/** Makes the work order for a pending row (directly, or when an administrator approves it) and links the row. Returns the order's id. */
export async function makeOrder(rowId: string, organizationId: string, sourceName: string, alarm: { code: string; severity: string; text: string; occurredAt: Date }, now: Date, decidedById: string | null = null) {
  const text = alarmOrderText({ sourceName, ...alarm });
  const pending = await prisma.machineAlarmOrder.findFirst({ where: { id: rowId, organizationId }, select: { sourceId: true, machinePartId: true, scopeKey: true } });
  const place = await orderPart(organizationId, pending?.machinePartId ?? null);
  // A signal's own scope (an active alarm code without an object) has no run state of its own to read.
  const stoppedAt = pending && !pending.scopeKey.startsWith("signal:") ? await stoppedBefore(organizationId, { sourceId: pending.sourceId, machinePartId: pending.machinePartId }, alarm.occurredAt) : null;
  const task = workflowTaskInputSchema.parse({
    kind: "WORK_ORDER", title: text.title, description: text.description, status: "PLANNED",
    projectId: null, customerId: place.customerId, facilityId: null, assignedToUserId: null, assignedToName: "",
    // Underhåll (2026-10-30): the fault, priority and times are the maintenance item's (below), not the order's.
    // 2026-11-06: the safety step (riskbedömning) is required before the time starts, as on every work order.
    data: { kind: "WORK_ORDER", details: {}, riskStep: true },
  });
  const json = (value: unknown) => JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;
  const taskId = await prisma.$transaction(async (tx) => {
    const created = await tx.workflowTask.create({
      data: { organizationId, projectId: null, customerId: task.customerId, facilityId: null, machinePartId: place.partId, kind: "WORK_ORDER", title: task.title, description: task.description, assignedToUserId: null, assignedToName: "",
        status: task.status, progress: workflowTaskProgress(task), dueDate: task.dueDate, data: json(task.data), createdBy: SYSTEM_CREATOR, updatedBy: SYSTEM_CREATOR,
        revisions: { create: { version: 1, snapshot: json(task), createdBy: SYSTEM_CREATOR } } },
      select: { id: true },
    });
    const linked = await tx.machineAlarmOrder.updateMany({ where: { id: rowId, organizationId, status: "pending" }, data: { status: "created", taskId: created.id, decidedAt: now, decidedById } });
    // A second approval of the same row finds it already handled: nothing is made twice.
    if (!linked.count) throw new Error("already_handled");
    // Underhåll (2026-10-30): the order holds a maintenance item on the machine part with the alarm's facts; without a part
    // (a source with no machine) only the work order is made, its description naming the alarm.
    if (place.partId) await tx.maintenanceItem.create({ data: {
      organizationId, partId: place.partId, workOrderId: created.id, type: "CORRECTIVE", priority: text.priority, fault: text.fault, reportedAt: now, stoppedAt: stoppedAt ? new Date(stoppedAt) : null,
      source: "MACHINE_ALARM", machineAlarmOrderId: rowId, createdById: SYSTEM_CREATOR, updatedById: SYSTEM_CREATOR,
    } });
    return created.id;
  });
  // S4 (Notis med kvittens): the right people are told, except the one who approved it. A failure here never undoes the order.
  try {
    await clearAlarmNotices({ organizationId, ref: `p-${rowId}` });
    if (pending) await notifyAlarm({ organizationId, sourceId: pending.sourceId, taskId, exceptUserId: decidedById });
  } catch (error) {
    console.error("machine alarm notice failed", error instanceof Error ? error.name : "unknown");
  }
  return taskId;
}
