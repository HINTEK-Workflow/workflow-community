import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { context, failure, requireCloudStorage } from "@/lib/kfid/server";
import { normalizeControl, validateForCompletion } from "@/lib/kfid/model";
import { hasWorkflowPermission, readableTaskScope, type WorkflowPermissionSubject } from "@/lib/workflow/permissions";
import { readableTaskWhere } from "@/lib/workflow/task-access";
import { FOLLOW_UP_DAYS, followUpNotifications, NOTIFICATION_DUE_DAYS, notificationToday, taskNotifications, type NotificationSource } from "@/lib/workflow/task-notifications";
import { addSwedishDays, swedishDayKey } from "@/lib/swedish-time";
import { loadScheduleViews } from "@/lib/kfid/rounds-server";
import { roundNotifications } from "@/lib/workflow/form-schedule";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const ctx = await context();
    requireCloudStorage(ctx);
    const can = (subject: WorkflowPermissionSubject) => ctx.admin || hasWorkflowPermission(ctx.workflowPermissions, subject, "read");
    // Protocols follow their form's permission area (2026-09-27).
    const readable = readableTaskScope(can).any ? readableTaskWhere(can) : null;
    // Organization admins see the team's reminders; members only their own work, using the same rule as "Mina uppgifter".
    const ownTasks = ctx.admin ? {} : { OR: [{ assignedToUserId: ctx.user.id }, { assignedToUserId: null, createdBy: ctx.user.id }] };
    const ownControls = ctx.admin ? {} : { OR: [{ createdBy: ctx.user.id }, ...[ctx.user.name, ctx.user.email].filter((value): value is string => Boolean(value)).map((performer) => ({ performer }))] };
    // Only tasks that can produce a reminder are read (2026-09-26: bounded server reads): needs action, or a
    // due date no later than the last day of the reminder window. ISO dates compare correctly as text.
    const lastDueDay = swedishDayKey(addSwedishDays(new Date(), NOTIFICATION_DUE_DAYS));
    const reminderCandidates = { OR: [{ status: "NEEDS_ACTION" }, { AND: [{ dueDate: { not: "" } }, { dueDate: { lte: lastDueDay } }] }] };
    const [tasks, controls] = await Promise.all([
      readable ? prisma.workflowTask.findMany({
        where: { organizationId: ctx.organizationId, status: { not: "COMPLETED" }, AND: [readable, { OR: [{ projectId: null }, { project: { is: { archivedAt: null } } }] }, ownTasks, reminderCandidates] },
        select: { id: true, title: true, kind: true, status: true, dueDate: true },
      }) : [],
      can("kfid") ? prisma.control.findMany({
        where: { organizationId: ctx.organizationId, deletedAt: null, status: { not: "COMPLETED" }, AND: [{ OR: [{ projectId: null }, { workflowProject: { is: { archivedAt: null } } }] }, ownControls] },
        select: { id: true, title: true, status: true, data: true, _count: { select: { attachments: true } } },
      }) : [],
    ]);
    const today = notificationToday();
    const items = taskNotifications([
      ...tasks.flatMap((task): NotificationSource[] => task.kind === "WORK_ORDER" || task.kind === "RISK_ASSESSMENT" || task.kind === "FORM" ? [{ ...task, kind: task.kind }] : []),
      ...controls.map((control) => ({ id: control.id, title: control.title, status: control.status, kind: "COMMISSIONING_CONTROL" as const,
        completionErrors: validateForCompletion(normalizeControl(control.data), { attachmentCount: control._count.attachments }).errors.length })),
    ], today);
    // Rounds due today, missed or left unfinished (2026-09-30), for the responsible person – or the admins.
    const rounds = roundNotifications(await loadScheduleViews(ctx, today), { id: ctx.user.id, admin: ctx.admin }, today);
    // Work orders from a deviation finished lately (flödesvåg 2): bounded to the last days and to readable tasks; the
    // protocol they came from must be readable and the reader's own (admins: the team's).
    const followUps = readable ? await (async () => {
      const finished = await prisma.workflowTask.findMany({
        where: { organizationId: ctx.organizationId, kind: "WORK_ORDER", status: "COMPLETED", completedAt: { gte: addSwedishDays(new Date(), -FOLLOW_UP_DAYS - 1) }, AND: [readable] },
        select: { id: true, title: true, status: true, completedAt: true, data: true }, orderBy: { completedAt: "desc" }, take: 200,
      });
      const withSource = finished.map((task) => {
        const source = (task.data as { details?: { source?: { taskId?: unknown } } } | null)?.details?.source;
        return { ...task, completedAt: task.completedAt?.toISOString() ?? null, source: typeof source?.taskId === "string" ? { taskId: source.taskId } : null };
      }).filter((task) => task.source);
      if (!withSource.length) return [];
      const origins = await prisma.workflowTask.findMany({
        where: { organizationId: ctx.organizationId, id: { in: [...new Set(withSource.map((task) => task.source!.taskId))] }, AND: [readable, { OR: [{ projectId: null }, { project: { is: { archivedAt: null } } }] }, ownTasks] },
        select: { id: true, title: true, kind: true, updatedAt: true },
      });
      const byId = new Map(origins.map((origin) => [origin.id, { ...origin, updatedAt: origin.updatedAt.toISOString() }]));
      return followUpNotifications(withSource.map((workOrder) => ({ workOrder, origin: byId.get(workOrder.source!.taskId) ?? null })));
    })() : [];
    return NextResponse.json({ items: [...followUps, ...rounds, ...items], today, scope: ctx.admin ? "team" : "mine" }, { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) {
    return failure(error);
  }
}
