import { z } from "zod";
import { ABSENCE_REMOVAL_CONFIRM, absenceRemovalNeedsConfirm } from "@/lib/workflow/team-notice";
import { plannedMinutesForUserInWindow, type CapacityActivity } from "@/lib/workflow/capacity-summary";
import { memberMayReadJob } from "@/lib/workflow/assignee-access";
import { canViewTeam, workflowSubjectForTask, type WorkflowPermissionSubject } from "@/lib/workflow/permissions";
import { addSwedishDays, fromSwedishDateInput, swedishClock, swedishDayKey } from "@/lib/swedish-time";
import { absenceInputSchema, absenceLabel, absentShare, affectedWork, mayRegisterAbsence, suggestReplacements, type Absence } from "@/lib/workflow/absence";
import { expectedWeeklyWorkMinutes } from "@/lib/workflow/work-schedule";
import type { DemoDatabase, DemoUser } from "./demo-data";

/**
 * Frånvaro i demon (2026-10-29, shown on 3011 before the server part): GET and POST /api/absence answered from memory
 * with the rules of lib/workflow/absence.ts – everyone registers their own absence, admins and the Teamet right anyone's;
 * colleagues see only "Frånvarande"; the planned work an absence touches is shown with suggestions and a person chooses
 * (Byt person / Skjut upp / Låt vänta). Nothing is moved by itself; a reload starts over.
 */
export class DemoAbsenceError extends Error {
  constructor(readonly status: number, message: string) { super(message); }
}
type Ctx = { db: DemoDatabase; user: DemoUser; admin: boolean; now: Date };
type Request = { method: string; url: URL; body: unknown };

const teamOf = (ctx: Ctx) => ctx.admin || canViewTeam({ admin: ctx.admin, workflowPermissions: ctx.user.permissions });
const viewerOf = (ctx: Ctx) => ({ id: ctx.user.id, admin: ctx.admin, team: teamOf(ctx) });
const nameOf = (ctx: Ctx, id: string) => ctx.db.users.find((user) => user.id === id)?.name ?? "Tidigare medarbetare";
const taskHref = (id: string, kind: string) => `/?view=workflow_task&taskId=${encodeURIComponent(id)}&taskType=${kind}`;

/** The planned work the company's absences touch, with who could take each over (team view only). */
export function demoAffected(ctx: Ctx) {
  const today = swedishDayKey(ctx.now);
  const bookings = ctx.db.activities.filter((activity) => !activity.deletedAt).map((activity) => {
    const task = activity.workflowTaskId ? ctx.db.tasks.find((item) => item.id === activity.workflowTaskId) : undefined;
    return { id: activity.id, title: activity.title || task?.title || "Bokning", startsAt: activity.startsAt, endsAt: activity.endsAt, userIds: activity.assignments.map((item) => item.userId), status: activity.status,
      href: task ? taskHref(task.id, task.kind) : "/?view=planning", workOrderId: activity.workflowTaskId ?? null };
  });
  const workOrders = ctx.db.tasks.filter((task) => task.kind === "WORK_ORDER").map((task) => ({ id: task.id, title: task.title, status: task.status, assignedToUserId: task.assignedToUserId, dueDate: task.dueDate ?? "", plannedStartDate: task.plannedStartDate ?? "", href: taskHref(task.id, task.kind) }));
  const rows = affectedWork({ absences: ctx.db.absences, bookings, workOrders, today, swedishDay: (iso) => swedishDayKey(new Date(iso)), swedishClock: (iso) => swedishClock(new Date(iso)) });
  const capacity: CapacityActivity[] = ctx.db.activities.filter((activity) => !activity.deletedAt && (activity.status === "PLANNED" || activity.status === "IN_PROGRESS")).map((activity) => ({
    startsAt: activity.startsAt, endsAt: activity.endsAt, assignedToUserId: activity.assignments[0]?.userId ?? null, assignments: activity.assignments, status: activity.status, projectId: activity.projectId, workflowTaskId: activity.workflowTaskId,
  }));
  return rows.map((row) => {
    const absence = ctx.db.absences.find((item) => item.id === row.absenceId)!;
    const subject: WorkflowPermissionSubject | null = row.kind === "work-order" ? "work-order" : (() => { const activity = ctx.db.activities.find((item) => item.id === row.id); const task = activity?.workflowTaskId ? ctx.db.tasks.find((item) => item.id === activity.workflowTaskId) : undefined; return task ? workflowSubjectForTask(task.kind) : null; })();
    const startsAt = fromSwedishDateInput(row.day)!;
    const people = ctx.db.users.map((user) => {
      const weekly = user.weeklyWorkMinutes ?? ctx.db.organization.weeklyWorkMinutes;
      const planned = plannedMinutesForUserInWindow({ activities: capacity, userId: user.id, startsAt, endsAt: addSwedishDays(startsAt, 1), weeklyWorkMinutes: weekly });
      const away = absentShare(ctx.db.absences, user.id, row.day, weekly / 5);
      // Ingen fast arbetstid (2026-10-30), as Cloud: no capacity, so never suggested as free.
      return { id: user.id, name: user.name, freeMinutes: Math.max(0, Math.round((expectedWeeklyWorkMinutes(ctx.db.organization.weeklyWorkMinutes, user) / 5) * (1 - away) - planned)), away: away >= 1,
        mayDo: subject ? memberMayReadJob({ role: user.role, workflowPermissions: user.permissions }, subject) : true };
    });
    return { ...row, personName: nameOf(ctx, row.userId), label: absenceLabel(viewerOf(ctx), absence), suggestions: suggestReplacements(people, row.userId) };
  });
}

/** Absences shown to this viewer: the type only for themselves and the Teamet right. */
export function demoAbsenceView(ctx: Ctx, from?: string) {
  const viewer = viewerOf(ctx);
  const today = swedishDayKey(ctx.now);
  return ctx.db.absences.filter((absence) => absence.to >= (from ?? today))
    .map((absence) => ({ id: absence.id, userId: absence.userId, name: nameOf(ctx, absence.userId), label: absenceLabel(viewer, absence), from: absence.from, to: absence.to, hours: absence.hours,
      type: viewer.team || viewer.admin || absence.userId === viewer.id ? absence.type : null, note: viewer.team || viewer.admin || absence.userId === viewer.id ? absence.note : "",
      mine: absence.userId === viewer.id, byOther: Boolean(absence.createdBy) && absence.createdBy !== absence.userId, canEdit: mayRegisterAbsence(viewer, absence.userId) }))
    .sort((a, b) => a.from.localeCompare(b.from) || a.name.localeCompare(b.name, "sv"));
}

const handleSchema = z.object({ action: z.literal("handle"), key: z.string().min(1), choice: z.enum(["reassign", "postpone", "wait"]), toUserId: z.string().optional() });

export function demoAbsence(ctx: Ctx, request: Request) {
  const viewer = viewerOf(ctx);
  if (request.method === "GET") {
    return { absences: demoAbsenceView(ctx, request.url.searchParams.get("from") ?? undefined), canRegisterOthers: viewer.team || viewer.admin,
      people: (viewer.team || viewer.admin ? ctx.db.users : [ctx.user]).map((user) => ({ id: user.id, name: user.name })), me: ctx.user.id };
  }
  const body = (request.body ?? {}) as { action?: string; id?: string; absence?: unknown; confirm?: boolean };
  if (body.action === "delete") {
    const current = ctx.db.absences.find((item) => item.id === body.id);
    if (!current) throw new DemoAbsenceError(404, "Frånvaron finns inte längre.");
    if (!mayRegisterAbsence(viewer, current.userId)) throw new DemoAbsenceError(403, "Du får bara ta bort din egen frånvaro.");
    // The same rule as Cloud (användartest 2026-10-31, F7): someone else's registration is removed only with a yes.
    if (absenceRemovalNeedsConfirm({ actorId: ctx.user.id, userId: current.userId, createdById: current.createdBy, planner: viewer.team || viewer.admin }) && !body.confirm) throw new DemoAbsenceError(409, ABSENCE_REMOVAL_CONFIRM);
    ctx.db.absences = ctx.db.absences.filter((item) => item.id !== current.id);
    return { ok: true };
  }
  if (body.action === "handle") {
    if (!viewer.team && !viewer.admin) throw new DemoAbsenceError(403, "Det är arbetsledaren som planerar om.");
    const input = handleSchema.parse(body);
    const row = demoAffected(ctx).find((item) => item.key === input.key);
    if (!row) throw new DemoAbsenceError(409, "Jobbet påverkas inte längre – läs in sidan igen.");
    const absence = ctx.db.absences.find((item) => item.id === row.absenceId)!;
    if (input.choice === "wait") { absence.handled = [...absence.handled, row.key]; return { ok: true, message: "Jobbet ligger kvar som det är." }; }
    if (row.kind === "booking") {
      const activity = ctx.db.activities.find((item) => item.id === row.id)!;
      if (input.choice === "reassign") {
        const to = row.suggestions.find((person) => person.id === input.toUserId) ?? (input.toUserId ? { id: input.toUserId, name: nameOf(ctx, input.toUserId) } : null);
        if (!to || !ctx.db.users.some((user) => user.id === to.id)) throw new DemoAbsenceError(400, "Välj vem som tar över.");
        activity.assignments = activity.assignments.map((item) => item.userId === row.userId ? { ...item, userId: to.id } : item);
        activity.assignedToName = activity.assignments.map((item) => nameOf(ctx, item.userId)).join(", ");
        // Only the booking changes person (användartest 2026-10-31, F1); the work order keeps its responsible.
        return { ok: true, message: `${to.name} har tagit över bokningen ${row.title}.` };
      }
      // Skjut upp: the booking moves to the first workday back, keeping its hours.
      const shift = Math.round((Date.parse(`${row.backOn}T12:00:00Z`) - Date.parse(`${swedishDayKey(new Date(activity.startsAt))}T12:00:00Z`)) / 86_400_000);
      activity.startsAt = addSwedishDays(new Date(activity.startsAt), shift).toISOString();
      activity.endsAt = addSwedishDays(new Date(activity.endsAt), shift).toISOString();
      return { ok: true, message: `${row.title} är flyttad till ${row.backOn}.` };
    }
    const task = ctx.db.tasks.find((item) => item.id === row.id)!;
    if (input.choice === "reassign") {
      const to = ctx.db.users.find((user) => user.id === input.toUserId);
      if (!to) throw new DemoAbsenceError(400, "Välj vem som tar över.");
      Object.assign(task, { assignedToUserId: to.id, assignedToName: to.name });
      return { ok: true, message: `${to.name} är ansvarig för ${task.title}.` };
    }
    if (task.plannedStartDate && task.plannedStartDate >= absence.from && task.plannedStartDate <= absence.to) task.plannedStartDate = row.backOn;
    if (task.dueDate && task.dueDate >= absence.from && task.dueDate <= absence.to) task.dueDate = row.backOn;
    return { ok: true, message: `${task.title} är flyttad till ${row.backOn}.` };
  }
  const input = absenceInputSchema.parse(body.absence);
  if (!mayRegisterAbsence(viewer, input.userId)) throw new DemoAbsenceError(403, "Du får bara lägga in din egen frånvaro.");
  if (!ctx.db.users.some((user) => user.id === input.userId)) throw new DemoAbsenceError(400, "Personen finns inte i företaget.");
  const overlap = ctx.db.absences.find((item) => item.id !== input.id && item.userId === input.userId && item.from <= input.to && item.to >= input.from);
  if (overlap) throw new DemoAbsenceError(409, `Det finns redan frånvaro ${overlap.from === overlap.to ? overlap.from : `${overlap.from}–${overlap.to}`}. Ändra den i stället.`);
  const current = input.id ? ctx.db.absences.find((item) => item.id === input.id) : undefined;
  if (input.id && !current) throw new DemoAbsenceError(404, "Frånvaron finns inte längre.");
  const saved: Absence = { id: current?.id ?? `demo-absence-${Date.now()}`, userId: input.userId, type: input.type, note: input.type === "OTHER" ? input.note : "", from: input.from, to: input.to, hours: input.hours,
    createdBy: current?.createdBy ?? ctx.user.id, createdAt: current?.createdAt ?? ctx.now.toISOString(), handled: current?.handled ?? [] };
  ctx.db.absences = current ? ctx.db.absences.map((item) => item.id === current.id ? saved : item) : [...ctx.db.absences, saved];
  return { ok: true, id: saved.id, affected: demoAffected(ctx).filter((row) => row.absenceId === saved.id).length };
}

