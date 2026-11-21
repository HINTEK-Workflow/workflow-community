import { prisma } from "@/lib/db";
import { moduleOnWhere } from "@/lib/workflow/modules";
import { SYSTEM_CREATOR } from "@/lib/machine/alarm-rules";
import { alarmKey, alarmRef, type AlarmMember } from "@/lib/machine/alarm-notice";
import { alarmSteps, clearAlarmNotices, loadChoices, loadMembers, tellPeople } from "@/lib/machine/alarm-notice-store";
import { escalationDue, ESCALATION_MAX_AGE_MS } from "@/lib/machine/alarm-escalation";

/**
 * Integrationsmotorn E6: eskaleringen. Jobbet machine:alarms (var 5:e minut, dygnet runt) går igenom de öppna automatiska
 * ordrar som ingen kvitterat. Ett steg som inte kvitterat på företagets antal minuter går vidare till nästa (ansvarig →
 * ersättare → alla som får maskinlarm). En order som någon blivit ansvarig för på annat sätt än med Jag tar den räknas som
 * kvitterad när jobbet ser det. Inget stängs, ingen status ändras och ingen tilldelas av jobbet. Klockans rad skapas här;
 * e-post och push går sedan med samma jobb (alarm-delivery.ts) efter personens val och företagets tider.
 */
export type EscalationRun = { rows: number; escalated: number; acknowledged: number; told: number };

export async function runAlarmEscalation(now = new Date()): Promise<EscalationRun> {
  const result: EscalationRun = { rows: 0, escalated: 0, acknowledged: 0, told: 0 };
  const rows = await prisma.machineAlarmOrder.findMany({
    where: { status: "created", acknowledgedAt: null, taskId: { not: null }, createdAt: { gte: new Date(now.getTime() - ESCALATION_MAX_AGE_MS) },
      organization: { isActive: true, storageMode: "HINTEK_CLOUD", ...moduleOnWhere("upkeep") } },
    orderBy: { createdAt: "asc" }, take: 500,
    select: { id: true, organizationId: true, sourceId: true, taskId: true, machinePartId: true, escalationStep: true, escalatedAt: true, decidedAt: true, createdAt: true,
      organization: { select: { machineEscalationMinutes: true } } },
  });
  // One read of each company's members and choices per run.
  const people = new Map<string, { members: AlarmMember[]; choices: Map<string, string[]> }>();
  const peopleOf = async (organizationId: string) => {
    let found = people.get(organizationId);
    if (!found) {
      const members = await loadMembers(organizationId);
      found = { members, choices: await loadChoices(members.map((member) => member.userId)) };
      people.set(organizationId, found);
    }
    return found;
  };
  for (const row of rows) {
    result.rows++;
    try {
      const task = await prisma.workflowTask.findFirst({ where: { id: row.taskId!, organizationId: row.organizationId, kind: "WORK_ORDER", createdBy: SYSTEM_CREATOR }, select: { status: true, assignedToUserId: true } });
      if (!task || task.status === "COMPLETED" || task.status === "CANCELLED") continue;
      if (task.assignedToUserId) {
        // Someone took the order (edited it, or was given it): that is the acknowledgement; the bell's rows go.
        const done = await prisma.machineAlarmOrder.updateMany({ where: { id: row.id, acknowledgedAt: null }, data: { acknowledgedAt: now, acknowledgedById: task.assignedToUserId } });
        if (done.count) { result.acknowledged++; await clearAlarmNotices({ organizationId: row.organizationId, ref: row.taskId! }); }
        continue;
      }
      const { members, choices } = await peopleOf(row.organizationId);
      const steps = await alarmSteps(row.organizationId, row.machinePartId, members, choices);
      const next = escalationDue({ step: row.escalationStep, lastAt: row.escalatedAt ?? row.decidedAt ?? row.createdAt, now, minutes: row.organization.machineEscalationMinutes, steps: steps.length });
      if (next === null) continue;
      // The step is claimed on the row first, so two runs at once never tell the same step twice.
      const claimed = await prisma.machineAlarmOrder.updateMany({ where: { id: row.id, escalationStep: row.escalationStep, acknowledgedAt: null, status: "created" }, data: { escalationStep: next, escalatedAt: now } });
      if (!claimed.count) continue;
      result.escalated++;
      result.told += await tellPeople(row.organizationId, alarmKey(alarmRef({ taskId: row.taskId! }), row.sourceId), steps[next].userIds);
    } catch (error) {
      // One row's failure never stops the others; only the name of the error is kept.
      console.error("machine alarm escalation failed", error instanceof Error ? error.name : "unknown");
    }
  }
  return result;
}
