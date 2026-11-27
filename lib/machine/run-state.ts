import { prisma } from "@/lib/db";
import { SYSTEM_CREATOR } from "@/lib/machine/alarm-rules";
import { resolveScope, runStateChange } from "@/lib/machine/alarm-scope";
import { signalIgnored, steeringSignal, type CatalogueSignal } from "@/lib/machine/signals";

/**
 * Integrationsmotorn E1: the machine's own run state (`stopped`/`running`) fills in "Ur drift" and "Åter i drift" on the open
 * automatic order of the same object (or, without an object, the same source) – since 2026-10-30 on the maintenance
 * item the alarm made, where the times live. Only the machine's own state or a person may do it (decision 2026-10-18); a
 * value already there is never overwritten, the order's status never changes and it is never closed. A person editing the
 * item at the same moment wins (the update is conditional on the version read). An alarm order without a machine part has
 * no item, so nothing is filled in. Never throws into the intake: the event is already saved.
 */
type RunStateEvent = { occurredAt: Date; state: string | null };

export async function applyRunState(principal: { sourceId: string; organizationId: string }, source: { name: string; machinePartId: string | null }, event: RunStateEvent, signal: CatalogueSignal | null = null): Promise<"stoppedAt" | "restoredAt" | null> {
  try {
    if ((event.state !== "running" && event.state !== "stopped") || signalIgnored(signal)) return null;
    // E2: the state's code signal, when active, says which machine (part) it is about.
    const scope = resolveScope({ sourceId: principal.sourceId, sourcePartId: source.machinePartId, signal: steeringSignal(signal) });
    const row = await prisma.machineAlarmOrder.findFirst({ where: { organizationId: principal.organizationId, scopeKey: scope.scopeKey, status: "created", taskId: { not: null } }, select: { id: true, taskId: true, eventRef: true, createdAt: true } });
    if (!row?.taskId) return null;
    const alarm = await prisma.machineEvent.findFirst({ where: { id: row.eventRef, organizationId: principal.organizationId }, select: { occurredAt: true } });
    const task = await prisma.workflowTask.findFirst({
      where: { id: row.taskId, organizationId: principal.organizationId, kind: "WORK_ORDER", createdBy: SYSTEM_CREATOR, status: { notIn: ["COMPLETED", "CANCELLED"] } },
      select: { id: true },
    });
    if (!task) return null;
    const item = await prisma.maintenanceItem.findFirst({
      where: { organizationId: principal.organizationId, workOrderId: task.id, source: "MACHINE_ALARM", machineAlarmOrderId: row.id },
      select: { id: true, version: true, stoppedAt: true, restoredAt: true },
    });
    if (!item) return null;
    const change = runStateChange({ state: event.state, occurredAt: event.occurredAt, alarmAt: alarm?.occurredAt ?? row.createdAt, stoppedAt: item.stoppedAt?.toISOString() ?? null, restoredAt: item.restoredAt?.toISOString() ?? null });
    if (!change) return null;
    // The item's own version: a person saving the item meanwhile wins; the machine is recorded as the one who changed it.
    const updated = await prisma.maintenanceItem.updateMany({
      where: { id: item.id, organizationId: principal.organizationId, version: item.version, [change.field]: null },
      data: { [change.field]: new Date(change.value), updatedById: SYSTEM_CREATOR, version: { increment: 1 } },
    });
    if (!updated.count) return null;
    return change.field;
  } catch (error) {
    console.error("machine run state failed", error instanceof Error ? error.name : "unknown");
    return null;
  }
}
