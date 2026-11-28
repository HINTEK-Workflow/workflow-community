import { prisma } from "@/lib/db";
import { ApiError, type Context } from "@/lib/kfid/server";
import { canReadMachineEvents } from "@/lib/kfid/place-machine-server";
import { SYSTEM_CREATOR } from "@/lib/machine/alarm-rules";
import { ALARM_DEVIATION_EXISTS, ALARM_DEVIATION_REFUSAL, alarmDeviationText } from "@/lib/machine/alarm-deviation";
import { newEntryPatch } from "@/lib/self-inspection/deviation-link";
import { selfInspectionAccess } from "@/lib/self-inspection/model";
import { formatSwedish } from "@/lib/swedish-time";

/**
 * Integrationsmotorn E6: "Skapa avvikelse" på en automatisk arbetsorder (2026-10-24). Anroparen har kontrollerat
 * session, Origin och Cloud-skrivning. Här: rätten att föra en avvikelse (egenkontrollens regel: varje aktiv medlem), rätten
 * att läsa arbetsordrar (ordern och larmet), att ordern är en automatisk order i företaget och att den inte redan har en
 * post. Posten börjar som en medlems rapport (Öppen, utan ansvarig och plan) och länkas till ordern med samma regel som när
 * en post förs från en rad som redan har en order (Pågår; Åtgärdad om ordern redan är färdig).
 */
export async function createDeviationFromAlarmOrder(ctx: Context, taskId: string, now = new Date()): Promise<{ id: string; number: number }> {
  if (!selfInspectionAccess({ active: true, admin: ctx.admin }).reportDeviation) throw new ApiError(403, "Du kan inte föra avvikelser.");
  if (!canReadMachineEvents(ctx)) throw new ApiError(403, ALARM_DEVIATION_REFUSAL);
  const organizationId = ctx.organizationId;
  const actor = { id: ctx.user.id, name: ctx.user.name?.trim() || ctx.user.email };
  return prisma.$transaction(async (tx) => {
    // The company is locked, like every new entry, so two at once never get the same number. The log needs no programme
    // (Avvikelser, 2026-10-30); the entry is tied to it when the company has one.
    await tx.$queryRaw`SELECT id FROM "Organization" WHERE id = ${organizationId} FOR UPDATE`;
    const program = await tx.selfInspectionProgram.findUnique({ where: { organizationId_scopeKey: { organizationId, scopeKey: "company" } }, select: { id: true } });
    const task = await tx.workflowTask.findFirst({ where: { id: taskId, organizationId, kind: "WORK_ORDER", createdBy: SYSTEM_CREATOR }, select: { id: true, title: true, status: true, completedAt: true } });
    const row = task ? await tx.machineAlarmOrder.findFirst({ where: { organizationId, taskId: task.id }, select: { eventRef: true, code: true, severity: true, text: true, createdAt: true, source: { select: { name: true } } } }) : null;
    if (!task || !row) throw new ApiError(404, "Den automatiska arbetsordern finns inte i ditt företag.");
    const existing = await tx.selfInspectionDeviation.findFirst({ where: { organizationId, workOrderId: task.id }, orderBy: { number: "asc" }, select: { number: true } });
    if (existing) throw new ApiError(409, ALARM_DEVIATION_EXISTS(existing.number));
    const event = await tx.machineEvent.findFirst({ where: { id: row.eventRef, organizationId }, select: { occurredAt: true } });
    const text = alarmDeviationText({ orderTitle: task.title, sourceName: row.source.name, code: row.code, severity: row.severity, text: row.text, occurredAt: formatSwedish(event?.occurredAt ?? row.createdAt) });
    const linked = newEntryPatch({ status: "OPEN", action: "", closedAt: null }, { id: task.id, title: task.title, status: task.status, completedAt: task.completedAt?.toISOString() ?? null }, actor, now.toISOString());
    const last = await tx.selfInspectionDeviation.findFirst({ where: { organizationId }, orderBy: { number: "desc" }, select: { number: true } });
    const number = (last?.number ?? 0) + 1;
    const created = await tx.selfInspectionDeviation.create({
      // A machine's alarm is a Driftfel (2026-11-28), with or without a programme.
      data: { organizationId, programId: program?.id ?? null, number, kind: "DEVIATION", type: "OPERATING_FAULT", title: text.title, description: text.description, category: text.category, systematic: false,
        status: linked.status ?? "OPEN", action: linked.action ?? "", responsibleUserId: null, dueDate: "", followUp: "", reportedById: actor.id,
        closedAt: linked.closedAt ? new Date(linked.closedAt) : null, closedById: linked.closedById ?? null, closedByName: linked.closedByName ?? "", workOrderId: task.id },
      select: { id: true },
    });
    return { id: created.id, number };
  });
}
