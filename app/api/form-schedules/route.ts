import { NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { ApiError, body, checkOrigin, context, failure, requireAdmin, requireCloudStorage, requireCloudWriteAccess } from "@/lib/kfid/server";
import { visibleFormsWhere } from "@/lib/kfid/form-server";
import { swedishDayKey } from "@/lib/swedish-time";
import { formScheduleInputSchema } from "@/lib/workflow/form-schedule";
import { loadScheduleViews } from "@/lib/kfid/rounds-server";

export const dynamic = "force-dynamic";
const identifier = z.string().min(1).max(100);

/**
 * Driftronder (2026-09-28): the company's round schedules with what is due, missed and coming. A member sees the
 * schedules of forms they may read; the company's administrator plans them. Protocols are never created in advance –
 * a round is started from an occurrence and the protocol carries the schedule and the day.
 */
export async function GET() {
  try {
    const ctx = await context();
    requireCloudStorage(ctx);
    const today = swedishDayKey(new Date());
    const views = await loadScheduleViews(ctx, today);
    return NextResponse.json({ canPlan: ctx.admin, today, schedules: views });
  } catch (error) {
    return failure(error);
  }
}

export async function POST(request: Request) {
  try {
    checkOrigin(request);
    const ctx = await context();
    requireCloudStorage(ctx);
    await requireCloudWriteAccess(ctx);
    requireAdmin(ctx);
    const input = z.discriminatedUnion("action", [
      z.object({ action: z.literal("save"), schedule: formScheduleInputSchema }),
      z.object({ action: z.literal("delete"), id: identifier }),
    ]).parse(await body(request));
    if (input.action === "delete") {
      const updated = await prisma.formSchedule.updateMany({ where: { id: input.id, organizationId: ctx.organizationId, deletedAt: null }, data: { deletedAt: new Date(), updatedBy: ctx.user.id, version: { increment: 1 } } });
      if (!updated.count) throw new ApiError(404, "Ronden hittades inte.");
      return NextResponse.json({ ok: true });
    }
    const schedule = input.schedule;
    if (!(await prisma.formTemplate.findFirst({ where: { id: schedule.templateId, ...visibleFormsWhere(ctx.organizationId) }, select: { id: true } }))) throw new ApiError(400, "Formuläret hittades inte.");
    if (schedule.customerId && !(await prisma.customer.findFirst({ where: { id: schedule.customerId, organizationId: ctx.organizationId, deletedAt: null }, select: { id: true } }))) throw new ApiError(400, "Kunden hittades inte.");
    if (schedule.facilityId) {
      const facility = await prisma.customerFacility.findFirst({ where: { id: schedule.facilityId, organizationId: ctx.organizationId }, select: { customerId: true } });
      if (!facility) throw new ApiError(400, "Anläggningen hittades inte.");
      if (schedule.customerId && facility.customerId !== schedule.customerId) throw new ApiError(400, "Anläggningen tillhör en annan kund.");
      schedule.customerId = facility.customerId;
    }
    if (schedule.projectId && !(await prisma.project.findFirst({ where: { id: schedule.projectId, organizationId: ctx.organizationId, archivedAt: null }, select: { id: true } }))) throw new ApiError(400, "Projektet hittades inte.");
    if (schedule.assignedToUserId && !(await prisma.organizationMember.findFirst({ where: { organizationId: ctx.organizationId, userId: schedule.assignedToUserId, isActive: true }, select: { id: true } }))) throw new ApiError(400, "Den ansvariga är inte medlem i företaget.");
    const data = {
      title: schedule.title, templateId: schedule.templateId, customerId: schedule.customerId, facilityId: schedule.facilityId, projectId: schedule.projectId,
      assignedToUserId: schedule.assignedToUserId, assignedToName: schedule.assignedToName, active: schedule.active, rule: schedule.rule as Prisma.InputJsonValue, reminders: schedule.reminders as Prisma.InputJsonValue, updatedBy: ctx.user.id,
    };
    if (schedule.id) {
      const updated = await prisma.formSchedule.updateMany({ where: { id: schedule.id, organizationId: ctx.organizationId, deletedAt: null, ...(schedule.version !== undefined ? { version: schedule.version } : {}) }, data: { ...data, version: { increment: 1 } } });
      if (!updated.count) throw new ApiError(409, "Ronden har ändrats eller tagits bort. Läs in sidan på nytt.");
      return NextResponse.json({ id: schedule.id });
    }
    const created = await prisma.formSchedule.create({ data: { ...data, organizationId: ctx.organizationId, createdBy: ctx.user.id } });
    return NextResponse.json({ id: created.id });
  } catch (error) {
    return failure(error);
  }
}
