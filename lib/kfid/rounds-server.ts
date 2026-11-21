import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { visibleFormsWhere } from "@/lib/kfid/form-server";
import { ApiError, type Context } from "@/lib/kfid/server";
import { formScheduleRuleSchema, parseScheduleReminders, roundLegacyPlace, scheduleViews, type FormSchedule } from "@/lib/workflow/form-schedule";
import { planningRounds } from "@/lib/workflow/planning-rounds";
import { placeSubtree } from "@/lib/workflow/customer-facility";
import { formPermissionArea, hasWorkflowPermission } from "@/lib/workflow/permissions";
import type { RoundPlanState } from "@/lib/workflow/round-planning";
import { addDays } from "@/lib/workflow/form-schedule";
import { loadRoundWorkOrders } from "@/lib/kfid/round-work-orders-server";
import { roundHolderOf, roundOrderSummary } from "@/lib/workflow/round-work-orders";
import { swedishClock, swedishDayKey } from "@/lib/swedish-time";
import { roundNotDoneOf } from "@/lib/workflow/round-outcome";

export const ROUND_WINDOW_DAYS = 45;

/**
 * What the round-planning rule needs to know about rounds (lib/workflow/round-planning.ts): the area of each round's form
 * and its project's responsible person and stand-in, read within the company.
 */
export async function roundPlanStates<T extends { templateId: string; projectId: string | null; assignedToUserId: string | null }>(organizationId: string, rounds: T[]): Promise<(T & RoundPlanState)[]> {
  const templateIds = [...new Set(rounds.map((round) => round.templateId))];
  const projectIds = [...new Set(rounds.flatMap((round) => round.projectId ? [round.projectId] : []))];
  const [templates, projects] = await Promise.all([
    templateIds.length ? prisma.formTemplate.findMany({ where: { id: { in: templateIds }, ...visibleFormsWhere(organizationId) }, select: { id: true, permissionArea: true } }) : [],
    projectIds.length ? prisma.project.findMany({ where: { id: { in: projectIds }, organizationId }, select: { id: true, responsibleUserId: true, planningDelegateUserId: true } }) : [],
  ]);
  return rounds.map((round) => ({ ...round, formArea: templates.find((template) => template.id === round.templateId)?.permissionArea ?? null, project: projects.find((project) => project.id === round.projectId) ?? null }));
}
type RoundsContext = Pick<Context, "organizationId" | "admin" | "workflowPermissions">;

/**
 * Ej utfört (2026-10-28): the active (not revoked) outcomes of some rounds of the company with their day from `from`
 * (to `to`), bounded. Revoked rows stay in the table as history but are not read for the views.
 */
export async function loadActiveNotDone(organizationId: string, scheduleIds: string[], from: string, to?: string) {
  if (!scheduleIds.length) return [];
  const rows = await prisma.roundOccurrenceOutcome.findMany({
    where: { organizationId, scheduleId: { in: scheduleIds }, outcome: "NOT_DONE", revokedAt: null, occurrence: { gte: from, ...(to ? { lte: to } : {}) } },
    orderBy: { occurrence: "desc" }, take: 3000,
    select: { id: true, scheduleId: true, occurrence: true, reason: true, userId: true, userName: true, recordedAt: true, workOrderId: true },
  });
  return rows.map((row) => ({ ...roundNotDoneOf(row), scheduleId: row.scheduleId }));
}

/** The company's schedules of forms the person may read, with names for the lists (at most 300). */
async function loadReadableSchedules(ctx: RoundsContext): Promise<FormSchedule[]> {
  const rows = await prisma.formSchedule.findMany({
    where: { organizationId: ctx.organizationId, deletedAt: null }, orderBy: { title: "asc" }, take: 300,
  });
  const templates = rows.length ? await prisma.formTemplate.findMany({ where: { id: { in: [...new Set(rows.map((row) => row.templateId))] }, ...visibleFormsWhere(ctx.organizationId) }, select: { id: true, name: true, displayName: true, permissionArea: true, publishedVersion: true, status: true } }) : [];
  // A Workflow original the company has published its own version of starts from that version (as /api/forms does).
  const copies = templates.length ? await prisma.formTemplate.findMany({ where: { organizationId: ctx.organizationId, baseTemplateId: { in: templates.map((item) => item.id) }, status: "PUBLISHED", publishedVersion: { not: null } }, select: { baseTemplateId: true } }) : [];
  const published = (template: (typeof templates)[number] | undefined) => Boolean(template && ((template.status === "PUBLISHED" && template.publishedVersion) || copies.some((copy) => copy.baseTemplateId === template.id)));
  const readable = (templateId: string) => {
    const template = templates.find((item) => item.id === templateId);
    return ctx.admin || hasWorkflowPermission(ctx.workflowPermissions, formPermissionArea(template?.permissionArea), "read");
  };
  return rows.filter((row) => readable(row.templateId)).flatMap((row) => {
    const rule = formScheduleRuleSchema.safeParse(row.rule);
    if (!rule.success) return [];
    const template = templates.find((item) => item.id === row.templateId);
    return [{
      id: row.id, version: row.version, title: row.title, templateId: row.templateId,
      // A round whose form is removed cannot be started, so it counts as paused: never missed, never in the calendar or a reminder
      // (kundresa 2026-11-07, M31). Nothing is stored; with the form back it runs again.
      assignedToUserId: row.assignedToUserId, assignedToName: row.assignedToName, active: row.active && Boolean(template), rule: rule.data, reminders: parseScheduleReminders(row.reminders),
      templateName: template ? template.displayName || template.name : "Formuläret är borttaget", templateMissing: !published(template), templateUnpublished: Boolean(template) && !published(template),
      // A round from before 2026-10-27 (kväll) keeps what it stored; it is only the suggestion for its work order now.
      legacyPlace: roundLegacyPlace(row),
      createdAt: row.createdAt.toISOString(), updatedAt: row.updatedAt.toISOString(),
    }];
  });
}

/**
 * The round on its work order (2026-10-27, punkt 3): which round and period the work order holds, "Starta ronden"
 * for the occurrence to do now (today's, else the latest late one, else the next in the period) as the protocol's link in
 * this work order, and the occurrences in the period that are late (no protocol yet). A 0.24.0 work order for one
 * occurrence starts that day while it has no protocol. Within the round's visibility; the form's notice instead of the
 * link when it cannot be started. Null when the work order holds no round.
 */
export async function roundOfOrder(ctx: RoundsContext, workOrderId: string) {
  const order = await prisma.workflowTask.findFirst({ where: { id: workOrderId, organizationId: ctx.organizationId, kind: "WORK_ORDER" }, select: { id: true, status: true, roundScheduleId: true, roundOccurrence: true, plannedStartDate: true, dueDate: true } });
  if (!order) throw new ApiError(404, "Arbetsordern hittades inte.");
  if (!order.roundScheduleId) return null;
  const round = (await loadReadableSchedules(ctx)).find((schedule) => schedule.id === order.roundScheduleId);
  if (!round) return roundOrderSummary(order, null, new Set(), swedishDayKey(new Date()), swedishClock());
  const marked = await prisma.$queryRaw<{ occurrence: string | null; status: string }[]>`
    select t.data #>> '{details,values,round,occurrence}' as occurrence, t.status from "WorkflowTask" t
    where t."organizationId" = ${ctx.organizationId} and t."workOrderId" = ${order.id} and t.kind = 'FORM'
      and t.data #>> '{details,values,round,scheduleId}' = ${round.id}
    limit 5000`;
  const started = new Set(marked.flatMap((row) => row.status !== "CANCELLED" && row.occurrence ? [row.occurrence] : []));
  // Ej utfört (2026-10-28): the days of the work order's period recorded as not done are handled, and listed with their reason.
  const holder = roundHolderOf(order);
  const from = holder?.from ?? order.roundOccurrence ?? "";
  const notDone = from ? await loadActiveNotDone(ctx.organizationId, [round.id], from, holder?.to ?? order.roundOccurrence ?? undefined) : [];
  return roundOrderSummary(order, round, started, swedishDayKey(new Date()), swedishClock(), notDone);
}

/**
 * What a round's QR label sheet needs (2026-10-23, also on a phone): the round as the person may see it, and only
 * the active place of the work order that holds it now (2026-10-27 kväll: the place comes with the work order) and
 * the places under it – names, markings and kinds – never the rest of the customer's card. So a person who may see the
 * round but not the customer register still gets the labels, and nothing more than the round shows. Without a work order
 * holding the round there are no places (the sheet says "Ingen arbetsorder").
 */
export async function loadRoundLabelPlaces(ctx: RoundsContext, roundId: string) {
  const today = swedishDayKey(new Date());
  const round = (await loadScheduleViews(ctx, today, { deviations: false })).find((schedule) => schedule.id === roundId);
  if (!round) throw new ApiError(404, "Ronden finns inte, eller så får du inte se den.");
  const holder = round.holder;
  const places = holder?.customerId && holder.facilityId ? placeSubtree(await prisma.customerFacility.findMany({
    where: { organizationId: ctx.organizationId, customerId: holder.customerId, isActive: true },
    orderBy: { name: "asc" }, take: 2000,
    select: { id: true, parentId: true, name: true, kind: true },
  }), holder.facilityId) : [];
  return {
    round: { id: round.id, title: round.title, customerId: holder?.customerId ?? null, facilityId: holder?.facilityId ?? null, facilityName: holder?.facilityName ?? "", customerName: holder?.customerName ?? "",
      workOrder: holder ? { id: holder.id, title: holder.title ?? "" } : null },
    places,
  };
}

/**
 * The company's rounds as the person may see them (2026-09-28): schedules of forms they may read, each with what is due,
 * missed and coming from the protocols of the last 45 days. Shared by Driftronder and the bell (2026-09-30).
 */
export async function loadScheduleViews(ctx: RoundsContext, today: string, options: { deviations?: boolean; /** false: the work orders' places are not needed (the bell). */ places?: boolean } = {}) {
  // Driftrond i arbetsordern (2026-10-27): only read – the round's work orders are made by a person, never by this page.
  const schedules = await loadReadableSchedules(ctx);
  const orders = await loadRoundWorkOrders(ctx.organizationId, schedules.map((schedule) => schedule.id), addDays(today, -ROUND_WINDOW_DAYS), prisma, { places: options.places });
  const notDone = await loadActiveNotDone(ctx.organizationId, schedules.map((schedule) => schedule.id), addDays(today, -ROUND_WINDOW_DAYS), today);
  // Only the protocols of these schedules, and only from the window the overview shows.
  const since = new Date(Date.now() - ROUND_WINDOW_DAYS * 86_400_000);
  // Without deviations (the bell) only the round marker is read, never the whole protocol (quality check 2026-10-05, F3).
  if (options.deviations === false) {
    const marked = schedules.length ? await prisma.$queryRaw<{ id: string; status: string; round: unknown }[]>`
      select t.id, t.status, t.data #> '{details,values,round}' as round from "WorkflowTask" t
      where t."organizationId" = ${ctx.organizationId} and t.kind = 'FORM' and t."updatedAt" >= ${since}
        and t.data #>> '{details,values,round,scheduleId}' in (${Prisma.join(schedules.map((schedule) => schedule.id))})
      limit 3000` : [];
    return scheduleViews(schedules, marked.map((task) => ({ id: task.id, status: task.status, data: { details: { values: { round: task.round } } } })), today, orders, swedishClock(), notDone);
  }
  const tasks = schedules.length ? await prisma.workflowTask.findMany({
    where: { organizationId: ctx.organizationId, kind: "FORM", updatedAt: { gte: since }, OR: schedules.map((schedule) => ({ data: { path: ["details", "values", "round", "scheduleId"], equals: schedule.id } })) },
    select: { id: true, status: true, data: true }, take: 3000,
  }) : [];
  return scheduleViews(schedules, tasks, today, orders, swedishClock(), notDone);
}

/**
 * Driftronder i Planeringen (2026-10-06): the occurrences of the readable, active schedules inside the shown period,
 * computed from the schedules (never stored as planned activities) with the state their protocols give them. Only the
 * round marker of the protocols whose occurrence lies in the period is read.
 */
export async function loadPlanningRounds(ctx: RoundsContext, period: { from: string; to: string }, today: string) {
  const schedules = (await loadReadableSchedules(ctx)).filter((schedule) => schedule.active);
  const marked = schedules.length ? await prisma.$queryRaw<{ id: string; status: string; round: unknown }[]>`
    select t.id, t.status, t.data #> '{details,values,round}' as round from "WorkflowTask" t
    where t."organizationId" = ${ctx.organizationId} and t.kind = 'FORM'
      and t.data #>> '{details,values,round,scheduleId}' in (${Prisma.join(schedules.map((schedule) => schedule.id))})
      and t.data #>> '{details,values,round,occurrence}' between ${period.from} and ${period.to}
    limit 5000` : [];
  const orders = await loadRoundWorkOrders(ctx.organizationId, schedules.map((schedule) => schedule.id), period.from, prisma, { until: period.to });
  const notDone = await loadActiveNotDone(ctx.organizationId, schedules.map((schedule) => schedule.id), period.from, period.to);
  return planningRounds(schedules, marked.map((task) => ({ id: task.id, status: task.status, data: { details: { values: { round: task.round } } } })), period, today, undefined, orders, swedishClock(), notDone);
}
