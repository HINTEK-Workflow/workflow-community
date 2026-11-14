import { Prisma } from "@prisma/client";
import { moduleOnWhere } from "@/lib/workflow/modules";
import { prisma } from "@/lib/db";
import { alarmKey, alarmRef, claimDecision, claimNote, type AlarmMember } from "@/lib/machine/alarm-notice";
import { alarmSteps, clearAlarmNotices, loadChoices, loadMembers, tellPeople } from "@/lib/machine/alarm-notice-store";
import { escalationDue, ESCALATION_MAX_AGE_MS } from "@/lib/machine/alarm-escalation";
import type { ClaimResult } from "@/lib/machine/alarm-notice-store";
import { SEVERITY_LABELS, type Severity } from "@/lib/operator/rules";

/**
 * Jouren vid felanmälan (2026-10-30): Akut, or Hög outside the company's workday, goes the machine alarms' way
 * (integrationsmotorn E6) – no path of its own. The work order's notice is a MACHINE_ALARM row in NoticeDelivery with the
 * key `MACHINE_ALARM:<work order>|fault-<report>`; the object's alarm contacts (ansvarig, then ersättare) are told first
 * and, without an acknowledgement within the company's minutes, everyone who gets machine alarms (machine:alarms runs
 * runFaultEscalation every 5 minutes); e-mail and push follow the person's choices and the company's hours like every
 * machine alarm (lib/machine/alarm-delivery.ts). "Jag tar den" in the bell acknowledges it (claimFaultAlarm), and so does
 * someone becoming responsible for the order. The acknowledgement is kept on the report: the operator sees it.
 * Workflow is not an alarm or safety system and promises no delivery time.
 */
export const FAULT_SOURCE_PREFIX = "fault-";
export const faultSourceId = (reportId: string) => `${FAULT_SOURCE_PREFIX}${reportId}`;
export const isFaultSourceId = (sourceId: string) => sourceId.startsWith(FAULT_SOURCE_PREFIX);

const json = (value: unknown) => JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;

/** The first step is told (the report's object's contacts, or everyone). Never throws: the report and its order are saved. */
export async function notifyFaultOnCall(input: { organizationId: string; reportId: string; taskId: string; alarmFacilityId: string | null; now?: Date }) {
  try {
    const members = await loadMembers(input.organizationId);
    const steps = await alarmSteps(input.organizationId, input.alarmFacilityId, members, await loadChoices(members.map((member) => member.userId)));
    await prisma.operatorFaultReport.updateMany({ where: { id: input.reportId, organizationId: input.organizationId }, data: { escalationStep: 0, escalatedAt: input.now ?? new Date() } });
    return await tellPeople(input.organizationId, alarmKey(alarmRef({ taskId: input.taskId }), faultSourceId(input.reportId)), steps[0]?.userIds ?? []);
  } catch (error) {
    console.error("operator on-call notice failed", error instanceof Error ? error.name : "unknown");
    return 0;
  }
}

export type FaultEscalationRun = { rows: number; escalated: number; acknowledged: number; told: number };

/** The escalation of unacknowledged on-call reports (machine:alarms, every 5 minutes). One row's failure never stops the rest. */
export async function runFaultEscalation(now = new Date()): Promise<FaultEscalationRun> {
  const result: FaultEscalationRun = { rows: 0, escalated: 0, acknowledged: 0, told: 0 };
  const rows = await prisma.operatorFaultReport.findMany({
    where: { onCall: true, acknowledgedAt: null, taskId: { not: null }, createdAt: { gte: new Date(now.getTime() - ESCALATION_MAX_AGE_MS) }, organization: { ...moduleOnWhere("upkeep"), isActive: true, storageMode: "HINTEK_CLOUD" } },
    orderBy: { createdAt: "asc" }, take: 500,
    select: { id: true, organizationId: true, taskId: true, alarmFacilityId: true, escalationStep: true, escalatedAt: true, createdAt: true, organization: { select: { machineEscalationMinutes: true } } },
  });
  const people = new Map<string, { members: AlarmMember[]; choices: Map<string, string[]> }>();
  for (const row of rows) {
    result.rows++;
    try {
      const task = await prisma.workflowTask.findFirst({ where: { id: row.taskId!, organizationId: row.organizationId, kind: "WORK_ORDER" }, select: { status: true, assignedToUserId: true } });
      if (!task || task.status === "COMPLETED" || task.status === "CANCELLED") continue;
      if (task.assignedToUserId) {
        // Someone is responsible for the order now: that is the acknowledgement; the bell's rows go.
        const done = await prisma.operatorFaultReport.updateMany({ where: { id: row.id, acknowledgedAt: null }, data: { acknowledgedAt: now, acknowledgedById: task.assignedToUserId } });
        if (done.count) { result.acknowledged++; await clearAlarmNotices({ organizationId: row.organizationId, ref: row.taskId! }); }
        continue;
      }
      let found = people.get(row.organizationId);
      if (!found) {
        const members = await loadMembers(row.organizationId);
        found = { members, choices: await loadChoices(members.map((member) => member.userId)) };
        people.set(row.organizationId, found);
      }
      const steps = await alarmSteps(row.organizationId, row.alarmFacilityId, found.members, found.choices);
      const next = escalationDue({ step: row.escalationStep, lastAt: row.escalatedAt ?? row.createdAt, now, minutes: row.organization.machineEscalationMinutes, steps: steps.length });
      if (next === null) continue;
      const claimed = await prisma.operatorFaultReport.updateMany({ where: { id: row.id, escalationStep: row.escalationStep, acknowledgedAt: null }, data: { escalationStep: next, escalatedAt: now } });
      if (!claimed.count) continue;
      result.escalated++;
      result.told += await tellPeople(row.organizationId, alarmKey(alarmRef({ taskId: row.taskId! }), faultSourceId(row.id)), steps[next].userIds);
    } catch (error) {
      console.error("operator on-call escalation failed", error instanceof Error ? error.name : "unknown");
    }
  }
  return result;
}

/**
 * "Jag tar den" on a fault report's work order (the bell's Kvittera, app/api/workflow-tasks claim_machine_alarm, when the
 * order is not a machine alarm's). The same rules as claimMachineAlarm: the first one gets the order, the condition is in
 * the update itself, the order's status never changes. The caller has checked session, company and permission.
 */
export async function claimFaultAlarm(input: { organizationId: string; userId: string; userName: string; taskId: string }): Promise<ClaimResult> {
  return prisma.$transaction(async (tx) => {
    // Every fault report's order can be taken (kundresan 2026-11-07, H1: the order shows Jag tar den like a machine alarm's), not
    // only one that went to the on-call person; the acknowledgement below is kept on the report either way.
    const report = await tx.operatorFaultReport.findFirst({ where: { organizationId: input.organizationId, taskId: input.taskId }, orderBy: { createdAt: "desc" }, select: { id: true } });
    const read = () => tx.workflowTask.findFirst({
      where: { id: input.taskId, organizationId: input.organizationId, kind: "WORK_ORDER" },
      select: { version: true, title: true, description: true, status: true, progress: true, data: true, assignedToUserId: true, assignedToName: true },
    });
    const task = report ? await read() : null;
    if (!report || !task) return { result: "not_found" };
    const decision = claimDecision(task, input.userId);
    if (decision.result === "closed") return { result: "closed" };
    if (decision.result === "taken") return { result: "taken", by: decision.by };
    const acknowledge = () => tx.operatorFaultReport.updateMany({ where: { id: report.id, acknowledgedAt: null }, data: { acknowledgedAt: new Date(), acknowledgedById: input.userId } });
    if (decision.result === "mine") {
      await acknowledge();
      await clearAlarmNotices({ organizationId: input.organizationId, ref: input.taskId }, tx);
      return { result: "mine", version: task.version, status: task.status };
    }
    const changed = await tx.workflowTask.updateMany({
      where: { id: input.taskId, organizationId: input.organizationId, assignedToUserId: null, status: { notIn: ["COMPLETED", "CANCELLED"] } },
      data: { assignedToUserId: input.userId, assignedToName: input.userName, version: { increment: 1 }, updatedBy: input.userId },
    });
    if (!changed.count) {
      const now = await read();
      if (!now) return { result: "not_found" };
      const again = claimDecision(now, input.userId);
      return again.result === "taken" ? { result: "taken", by: again.by } : again.result === "mine" ? { result: "mine", version: now.version, status: now.status } : { result: "closed" };
    }
    const fresh = (await read())!;
    await tx.workflowTaskRevision.create({ data: { taskId: input.taskId, version: fresh.version, createdBy: input.userId, snapshot: json({ title: fresh.title, description: fresh.description, status: fresh.status, progress: fresh.progress, data: fresh.data, completedAt: null, note: claimNote(input.userName) }) } });
    await acknowledge();
    await clearAlarmNotices({ organizationId: input.organizationId, ref: input.taskId }, tx);
    return { result: "claimed", version: fresh.version, status: fresh.status };
  });
}

/** The bell's words for fault reports' notices (lib/workflow/task-notifications-server.ts): "Felanmälan, Akut: Läckage – <maskin>" (no brackets: they were stripped to "Akut : Läckage", L48). */
export async function faultAlarmTexts(organizationId: string, taskIds: readonly string[]) {
  if (!taskIds.length) return new Map<string, { sourceName: string; text: string; code: string }>();
  const rows = await prisma.operatorFaultReport.findMany({ where: { organizationId, taskId: { in: [...taskIds] }, onCall: true }, select: { taskId: true, machineLabel: true, cause: true, severity: true } });
  return new Map(rows.flatMap((row) => row.taskId ? [[row.taskId, { sourceName: row.machineLabel, text: `Felanmälan, ${SEVERITY_LABELS[row.severity as Severity] ?? row.severity}: ${row.cause}`, code: row.severity }] as const] : []));
}
