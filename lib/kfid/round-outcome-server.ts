import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { visibleFormsWhere } from "@/lib/kfid/form-server";
import { loadRoundWorkOrders } from "@/lib/kfid/round-work-orders-server";
import { ApiError, requireWorkflowPermission, type Context } from "@/lib/kfid/server";
import { swedishDayKey } from "@/lib/swedish-time";
import { formScheduleRuleSchema, roundOrderForDay } from "@/lib/workflow/form-schedule";
import { formPermissionArea } from "@/lib/workflow/permissions";
import { mayRevokeNotDone, NOT_DONE_NOTICE_CHANNEL, notDoneNoticeKey, notDoneRecipients, notDoneRefusal, roundNotDoneOf } from "@/lib/workflow/round-outcome";

/**
 * Ej utfört (2026-10-28, 0.28.0 etapp 5) on the server: record that a round's occurrence will not be done, or revoke
 * it. The round is the company's (404 otherwise, never another company's), and the person needs the same right as to start
 * the round – create in the round's form area (the protocol it would have made). Nothing else is made: no protocol, no work
 * order; the row only notes the work order that held the day. The responsible person (or the admins) get an unread notice.
 */
async function roundForOutcome(ctx: Context, scheduleId: string, options: { deleted?: boolean } = {}) {
  const schedule = await prisma.formSchedule.findFirst({
    where: { id: scheduleId, organizationId: ctx.organizationId, ...(options.deleted ? {} : { deletedAt: null }) },
    select: { id: true, templateId: true, title: true, rule: true, assignedToUserId: true },
  });
  if (!schedule) throw new ApiError(404, "Ronden hittades inte.");
  const template = await prisma.formTemplate.findFirst({ where: { id: schedule.templateId, ...visibleFormsWhere(ctx.organizationId) }, select: { permissionArea: true } });
  const area = formPermissionArea(template?.permissionArea);
  // The round must be one the person may see, and its occurrences ones they may start.
  requireWorkflowPermission(ctx, area, "read");
  requireWorkflowPermission(ctx, area, "create");
  return schedule;
}

export async function markRoundNotDone(ctx: Context, input: { scheduleId: string; occurrence: string; reason: string }) {
  const schedule = await roundForOutcome(ctx, input.scheduleId);
  const rule = formScheduleRuleSchema.safeParse(schedule.rule);
  if (!rule.success) throw new ApiError(409, "Rondens regel kunde inte läsas.");
  const today = swedishDayKey(new Date());
  const [protocols, orders, active] = await Promise.all([
    prisma.$queryRaw<{ status: string }[]>`
      select t.status from "WorkflowTask" t
      where t."organizationId" = ${ctx.organizationId} and t.kind = 'FORM'
        and t.data #>> '{details,values,round,scheduleId}' = ${schedule.id}
        and t.data #>> '{details,values,round,occurrence}' = ${input.occurrence}
      limit 50`,
    loadRoundWorkOrders(ctx.organizationId, [schedule.id], input.occurrence, prisma, { until: input.occurrence, places: false }),
    prisma.roundOccurrenceOutcome.findFirst({ where: { organizationId: ctx.organizationId, scheduleId: schedule.id, occurrence: input.occurrence, revokedAt: null }, select: { id: true } }),
  ]);
  const order = roundOrderForDay(orders, schedule.id, input.occurrence);
  const refusal = notDoneRefusal({ rule: rule.data, occurrence: input.occurrence, today, protocolStatuses: protocols.map((row) => row.status),
    closedDayOrder: Boolean(order?.occurrence && (order.status === "COMPLETED" || order.status === "CANCELLED")), active: Boolean(active) });
  if (refusal) throw new ApiError(refusal.status, refusal.message);
  const members = await prisma.organizationMember.findMany({
    where: { organizationId: ctx.organizationId, isActive: true, user: { isActive: true } }, select: { userId: true, role: true }, take: 2000,
  });
  const recipients = notDoneRecipients({ assignedToUserId: schedule.assignedToUserId, recorderId: ctx.user.id, members: members.map((member) => ({ userId: member.userId, admin: member.role === "OWNER" || member.role === "ADMIN" })) });
  try {
    const row = await prisma.$transaction(async (tx) => {
      const created = await tx.roundOccurrenceOutcome.create({
        data: { organizationId: ctx.organizationId, scheduleId: schedule.id, occurrence: input.occurrence, outcome: "NOT_DONE", reason: input.reason,
          userId: ctx.user.id, userName: (ctx.user.name || ctx.user.email || "").slice(0, 160), workOrderId: order?.id ?? null },
      });
      for (const userId of recipients)
        await tx.noticeDelivery.create({ data: { organizationId: ctx.organizationId, userId, key: notDoneNoticeKey(created.id), channel: NOT_DONE_NOTICE_CHANNEL }, select: { id: true } });
      return created;
    });
    return roundNotDoneOf(row);
  } catch (error) {
    // Two people at the same moment: the partial unique index lets only one active Ej utfört per round and day through.
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") throw new ApiError(409, "Tillfället är redan markerat Ej utfört.");
    throw error;
  }
}

export async function revokeRoundNotDone(ctx: Context, id: string) {
  const outcome = await prisma.roundOccurrenceOutcome.findFirst({ where: { id, organizationId: ctx.organizationId }, select: { id: true, scheduleId: true, userId: true, revokedAt: true } });
  if (!outcome) throw new ApiError(404, "Markeringen hittades inte.");
  const schedule = await roundForOutcome(ctx, outcome.scheduleId, { deleted: true });
  if (!mayRevokeNotDone({ userId: ctx.user.id, admin: ctx.admin }, outcome, schedule)) throw new ApiError(403, "Bara den som markerade, rondens ansvarige eller en administratör kan ångra.");
  if (outcome.revokedAt) throw new ApiError(409, "Markeringen är redan ångrad.");
  // Never deleted (append-only history): the row is marked revoked once; the notices about it go.
  const updated = await prisma.$transaction(async (tx) => {
    const result = await tx.roundOccurrenceOutcome.updateMany({ where: { id: outcome.id, organizationId: ctx.organizationId, revokedAt: null },
      data: { revokedAt: new Date(), revokedById: ctx.user.id, revokedByName: (ctx.user.name || ctx.user.email || "").slice(0, 160) } });
    if (result.count) await tx.noticeDelivery.deleteMany({ where: { organizationId: ctx.organizationId, channel: NOT_DONE_NOTICE_CHANNEL, key: notDoneNoticeKey(outcome.id) } });
    return result.count;
  });
  if (!updated) throw new ApiError(409, "Markeringen är redan ångrad.");
  return { ok: true as const };
}

/** The person has opened Driftronder: their unread Ej utfört notices are read. */
export async function markNotDoneNoticesSeen(ctx: Pick<Context, "organizationId" | "user">) {
  await prisma.noticeDelivery.deleteMany({ where: { organizationId: ctx.organizationId, userId: ctx.user.id, channel: NOT_DONE_NOTICE_CHANNEL } });
}
