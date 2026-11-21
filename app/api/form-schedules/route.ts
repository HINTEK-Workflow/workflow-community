import { NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { ApiError, body, checkOrigin, context, failure, requireCloudStorage, requireCloudWriteAccess, requireModule } from "@/lib/kfid/server";
import { visibleFormsWhere } from "@/lib/kfid/form-server";
import { swedishDayKey } from "@/lib/swedish-time";
import { formScheduleInputSchema } from "@/lib/workflow/form-schedule";
import { loadPlanningRounds, loadRoundLabelPlaces, loadScheduleViews, roundOfOrder, roundPlanStates } from "@/lib/kfid/rounds-server";
import { canReadRounds } from "@/lib/workflow/permissions";
import { canPlanRounds, roundChangeRefusal, roundPlanRefusal, type RoundPlanActor } from "@/lib/workflow/round-planning";
import { planningRoundPeriod } from "@/lib/workflow/planning-rounds";
import { requireAssignLevels } from "@/lib/self-inspection/levels-server";
import { markNotDoneSchema, revokeNotDoneSchema } from "@/lib/workflow/round-outcome";
import { markNotDoneNoticesSeen, markRoundNotDone, revokeRoundNotDone } from "@/lib/kfid/round-outcome-server";

export const dynamic = "force-dynamic";
const identifier = z.string().min(1).max(100);

/**
 * Driftronder (2026-09-28): the company's round schedules with what is due, missed and coming. A member sees the
 * schedules of forms they may read. Who plans them (2026-10-10, was: only the admin) follows the booking rules –
 * lib/workflow/round-planning.ts: the right to create the form's protocols, the project right for a project's round, and
 * others' rounds only by an admin or the project's responsible person or stand-in. A round is held by a work order with
 * a period (2026-10-27, punkt 3), made by a person; each occurrence is started in it and carries the schedule and
 * the day. This page only reads. The round is the time rules (2026-10-27 kväll): no customer, place, temporary
 * place or project is saved on it – they come with the work order that holds it; what an older round has stored is kept
 * untouched.
 */
export async function GET(request: Request) {
  try {
    const ctx = await context();
    requireCloudStorage(ctx);
    // "Upprepa kontrollen" (2026-10-06) only asks whether the person may plan a round, without reading the rounds.
    const params = new URL(request.url).searchParams;
    const actor: RoundPlanActor = { admin: ctx.admin, userId: ctx.user.id, permissions: ctx.workflowPermissions };
    if (params.get("canPlan") === "1") {
      // With a form: whether the person may plan a round of exactly that form (Upprepa kontrollen).
      const templateId = params.get("templateId") ? identifier.parse(params.get("templateId")) : null;
      if (!templateId) return NextResponse.json({ canPlan: canPlanRounds(ctx.admin, ctx.workflowPermissions) });
      const [state] = await roundPlanStates(ctx.organizationId, [{ templateId, projectId: null, assignedToUserId: ctx.user.id }]);
      return NextResponse.json({ canPlan: !roundPlanRefusal(actor, state) });
    }
    // The round on its work order (2026-10-27): the round and period it holds, Starta ronden and the late occurrences.
    if (params.get("roundOrder")) return NextResponse.json({ round: await roundOfOrder(ctx, identifier.parse(params.get("roundOrder"))), canMarkNotDone: true }, { headers: { "Cache-Control": "private, no-store" } });
    // A round's QR label sheet (?labels=<id>): the round and only its own places, read within the round's visibility.
    if (params.get("labels")) return NextResponse.json(await loadRoundLabelPlaces(ctx, identifier.parse(params.get("labels"))), { headers: { "Cache-Control": "private, no-store" } });
    const today = swedishDayKey(new Date());
    // Planning (2026-10-06): the rounds inside the shown period, computed from the schedules, at most 200 days.
    if (params.get("planning") === "1") {
      const period = planningRoundPeriod(params.get("from"), params.get("to"), today);
      return NextResponse.json({ today, ...period, ...(await loadPlanningRounds(ctx, period, today)) });
    }
    // The page's right is the menu's (canReadRounds; webbplatskartan 2026-10-25): without it the page is the permission box
    // and nothing is read; with it the page opens, also when none of the company's rounds is one the person may read.
    if (!canReadRounds(ctx.admin, ctx.workflowPermissions)) return NextResponse.json({ canRead: false, canPlan: false, canPlanOthers: false, today, schedules: [] });
    const views = await loadScheduleViews(ctx, today);
    // Ej utfört (2026-10-28): opening Driftronder reads the person's notices about occurrences recorded as not done.
    await markNotDoneNoticesSeen(ctx);
    // A member who reads none of the rounds is told so, not that none are planned (2026-10-07); only whether any exist.
    const hidden = !views.length && !ctx.admin && (await prisma.formSchedule.count({ where: { organizationId: ctx.organizationId, deletedAt: null } })) > 0;
    // Each round says whether this person may change it, so the page offers Ändra and Ta bort only there.
    // A round from before 2026-10-27 (kväll) may still have a project stored; it decides who may change the round, as before.
    const states = ctx.admin ? null : await roundPlanStates(ctx.organizationId, views.map((view) => ({ templateId: view.templateId, projectId: view.legacyPlace?.projectId ?? null, assignedToUserId: view.assignedToUserId })));
    const schedules = views.map((view, index) => ({ ...view, canEdit: ctx.admin || !roundPlanRefusal(actor, states![index]) }));
    return NextResponse.json({ canRead: true, canPlan: canPlanRounds(ctx.admin, ctx.workflowPermissions), canPlanOthers: ctx.admin, canMarkNotDone: true, today, schedules, ...(hidden ? { hidden: true } : {}) });
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
    requireModule(ctx, "rounds");
    const input = z.discriminatedUnion("action", [
      z.object({ action: z.literal("save"), schedule: formScheduleInputSchema }),
      z.object({ action: z.literal("delete"), id: identifier }),
      // Ej utfört (2026-10-28, etapp 5): record or revoke that an occurrence will not be done – the right to start the round.
      markNotDoneSchema, revokeNotDoneSchema,
    ]).parse(await body(request));
    if (input.action === "mark_not_done") return NextResponse.json({ outcome: await markRoundNotDone(ctx, input) });
    if (input.action === "revoke_not_done") return NextResponse.json(await revokeRoundNotDone(ctx, input.id));
    // Planning rights (2026-10-10): the round as it is now and as it becomes must both be allowed.
    const actor: RoundPlanActor = { admin: ctx.admin, userId: ctx.user.id, permissions: ctx.workflowPermissions };
    const currentId = input.action === "delete" ? input.id : input.schedule.id;
    const current = currentId ? await prisma.formSchedule.findFirst({ where: { id: currentId, organizationId: ctx.organizationId, deletedAt: null }, select: { templateId: true, projectId: true, assignedToUserId: true } }) : null;
    if (currentId && !current) throw new ApiError(404, "Ronden hittades inte.");
    if (!ctx.admin) {
      const [before, after] = await roundPlanStates(ctx.organizationId, [
        ...(current ? [current] : []),
        // The round's project is never changed by a save (2026-10-27 kväll): an older round keeps the one it has.
        ...(input.action === "save" ? [{ templateId: input.schedule.templateId, projectId: current?.projectId ?? null, assignedToUserId: input.schedule.assignedToUserId }] : []),
      ]).then((states) => current ? [states[0], states[1] ?? null] : [null, states[0] ?? null]);
      const refusal = roundChangeRefusal(actor, before, after);
      if (refusal) throw new ApiError(403, refusal);
    }
    if (input.action === "delete") {
      const updated = await prisma.formSchedule.updateMany({ where: { id: input.id, organizationId: ctx.organizationId, deletedAt: null }, data: { deletedAt: new Date(), updatedBy: ctx.user.id, version: { increment: 1 } } });
      if (!updated.count) throw new ApiError(404, "Ronden hittades inte.");
      return NextResponse.json({ ok: true });
    }
    const schedule = input.schedule;
    if (!(await prisma.formTemplate.findFirst({ where: { id: schedule.templateId, ...visibleFormsWhere(ctx.organizationId) }, select: { id: true } }))) throw new ApiError(400, "Formuläret hittades inte.");
    if (schedule.assignedToUserId && !(await prisma.organizationMember.findFirst({ where: { organizationId: ctx.organizationId, userId: schedule.assignedToUserId, isActive: true }, select: { id: true } }))) throw new ApiError(400, "Den ansvariga är inte medlem i företaget.");
    // Roller med nivå (2026-10-07): the person a round is given to must reach the form's risk class (a new assignee only).
    if (schedule.assignedToUserId) {
      const current = schedule.id ? await prisma.formSchedule.findFirst({ where: { id: schedule.id, organizationId: ctx.organizationId, deletedAt: null }, select: { assignedToUserId: true } }) : null;
      if (current?.assignedToUserId !== schedule.assignedToUserId)
        await requireAssignLevels(ctx.organizationId, { kind: "FORM", formTemplateId: schedule.templateId }, [{ id: schedule.assignedToUserId, name: schedule.assignedToName.trim() || undefined }], ctx.user);
    }
    // Only the round's own fields (2026-10-27 kväll): the customer, place, temporary place and project stored on an older
    // round are left as they are, and a new round has none.
    const data = {
      title: schedule.title, templateId: schedule.templateId,
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
