import { prisma } from "@/lib/db";
import type { Context } from "@/lib/kfid/server";
import { loadScheduleViews } from "@/lib/kfid/rounds-server";
import { cloudSelfInspectionReminders } from "@/lib/self-inspection/server";
import { addSwedishDays, swedishDayKey } from "@/lib/swedish-time";
import { roundNotifications, roundReminderFor } from "@/lib/workflow/form-schedule";
import { canViewTeam, hasWorkflowPermission, readableTaskScope, type WorkflowPermissionSubject } from "@/lib/workflow/permissions";
import { readableTaskWhere } from "@/lib/workflow/task-access";
import { alarmNoteNotifications, alarmNotifications, MACHINE_ALARM_CHANNEL, MACHINE_ALARM_LIMIT, MACHINE_NOTE_CHANNEL, MACHINE_NOTE_DAYS, MACHINE_NOTE_LIMIT, parseAlarmKey, parseAlarmNoteKey } from "@/lib/machine/alarm-notice";
import { faultAlarmTexts, isFaultSourceId } from "@/lib/operator/on-call-store";
import { FAULT_NOTICE_DAYS, faultReportNotifications, operatorNotifications } from "@/lib/operator/admin-notice";
import { ASSIGNED_NOTICE_CHANNEL, ASSIGNED_NOTICE_LIMIT, ASSIGNED_READ_CHANNEL, ASSIGNED_READ_DAYS, assignmentNotifications, parseAssignmentKey } from "@/lib/workflow/task-assignment-notice";
import { OBSTACLE_NOTICE_CHANNEL, OBSTACLE_NOTICE_LIMIT, obstacleNotifications, parseObstacleKey } from "@/lib/workflow/obstacle-notice";
import { monthRef, parseMonthRef, parseTeamNoticeKey, TEAM_NOTICE_CHANNEL, TEAM_NOTICE_LIMIT, teamNotifications, type TeamNoticeContext } from "@/lib/workflow/team-notice";
import { periodLabel } from "@/lib/workflow/time-periods";
import { FOLLOW_UP_DAYS, followUpNotifications, NOTIFICATION_DUE_DAYS, notificationToday, orderNotifications, taskNotifications, withoutAssignedDueSoon, type NotificationSource, type TaskNotification } from "@/lib/workflow/task-notifications";
import { CLOSED_TASK_STATUSES } from "@/lib/workflow/task-cancel";
import { NOT_DONE_NOTICE_CHANNEL, NOT_DONE_NOTICE_LIMIT, notDoneNotifications, parseNotDoneNoticeKey } from "@/lib/workflow/round-outcome";
import { parseRoundFollowUpNoticeKey, ROUND_FOLLOW_UP_CHANNEL, ROUND_FOLLOW_UP_NOTICE_DAYS, ROUND_FOLLOW_UP_NOTICE_LIMIT, roundFollowUpNotifications } from "@/lib/workflow/round-follow-up";
import { loadQuoteAnswerNotifications } from "@/lib/quotes/customer-link-server";
import { loadCommentNotifications } from "@/lib/comments/server";
import { loadTeamAbsence } from "@/lib/absence/server";
import { ABSENCE_CONFLICT_PREFIX, NOTICE_READ_CHANNEL, withReadMarks } from "@/lib/workflow/notification-list";
import { noticeKey } from "@/lib/workflow/notice-channels";
import { organizationModuleOn, type ModuleKey } from "@/lib/workflow/modules";
import { loadNewsNotifications } from "@/lib/news/server";

/**
 * The reminders the bell shows, computed from the company's data for one person (their own work, or the team's for a
 * company admin) – the one place that does it. The notification route (the bell, the API and the assistant's
 * list_notifications) and the job that e-mails or pushes them (lib/workflow/notice-delivery.ts, 2026-10-07) both
 * call it, so a notice never differs between the bell and the mail. Callers pass a Context, which has already checked
 * session or membership, so the same tenant, role and permission rules apply to both.
 *
 * Notislistan (beslut 4, 2026-11-01): by default what the person has not read, so the mail and the API never send what they
 * read. `includeRead` keeps the read ones, marked, for the list. `teamReader` is the list's own: a member with team:read also
 * gets the reminders of the team's tasks they may read, marked as Teamet; the mail stays with what the person chose.
 */
export async function loadCloudNotifications(ctx: Context, now = new Date(), options: { includeRead?: boolean; teamReader?: boolean } = {}): Promise<TaskNotification[]> {
  // Företagets moduler (0.39.0): a module that is off gives no reminders, in the bell, the mail, the push and the API alike.
  const on = (key: ModuleKey) => organizationModuleOn(ctx.organization, key);
  const can = (subject: WorkflowPermissionSubject) => ctx.admin || hasWorkflowPermission(ctx.workflowPermissions, subject, "read");
  // Protocols follow their form's permission area (2026-09-27).
  const readable = readableTaskScope(can).any ? readableTaskWhere(can) : null;
  // Organization admins see the team's reminders; members only their own work, using the same rule as "Mina uppgifter".
  const seesTeamTasks = ctx.admin || (options.teamReader === true && canViewTeam(ctx));
  const ownTasks = seesTeamTasks ? {} : { OR: [{ assignedToUserId: ctx.user.id }, { assignedToUserId: null, createdBy: ctx.user.id }] };
  // Only tasks that can produce a reminder are read (2026-09-26: bounded server reads): needs action, or a
  // due date no later than the last day of the reminder window. ISO dates compare correctly as text.
  const lastDueDay = swedishDayKey(addSwedishDays(now, NOTIFICATION_DUE_DAYS));
  // An open work order marked Akut is always a reminder for its responsible person (Underhåll, 2026-10-06): one that
  // holds an open maintenance item marked Akut (the facts moved to the items 2026-10-30).
  const urgentOrder = { kind: "WORK_ORDER", maintenanceItems: { some: { status: "OPEN", priority: "URGENT" } } };
  const reminderCandidates = { OR: [{ status: "NEEDS_ACTION" }, { AND: [{ dueDate: { not: "" } }, { dueDate: { lte: lastDueDay } }] }, urgentOrder] };
  const openTasks = readable ? { organizationId: ctx.organizationId, status: { notIn: [...CLOSED_TASK_STATUSES] }, AND: [readable, { OR: [{ projectId: null }, { project: { is: { archivedAt: null } } }] }, ownTasks] } : null;
  const [tasks, urgentIds] = await Promise.all([
    openTasks ? prisma.workflowTask.findMany({
      where: { ...openTasks, AND: [...openTasks.AND, reminderCandidates] },
      select: { id: true, title: true, kind: true, status: true, dueDate: true, assignedToUserId: true, createdBy: true },
    }) : [],
    openTasks ? prisma.workflowTask.findMany({ where: { ...openTasks, AND: [...openTasks.AND, urgentOrder] }, select: { id: true } }).then((rows) => new Set(rows.map((row) => row.id))) : new Set<string>(),
  ]);
  const today = notificationToday(now);
  // Whose reminder it is: the same rule as "Mina uppgifter". The rest is the team's.
  const teamTaskIds = new Set(tasks.filter((task) => !(task.assignedToUserId === ctx.user.id || (!task.assignedToUserId && task.createdBy === ctx.user.id))).map((task) => `${task.kind}:${task.id}`));
  const items = taskNotifications(
    tasks.flatMap((task): NotificationSource[] => task.kind === "WORK_ORDER" || task.kind === "RISK_ASSESSMENT" || task.kind === "FORM" ? [{ ...task, kind: task.kind, urgent: urgentIds.has(task.id) }] : []),
    today);
  // Rounds due today, missed or left unfinished (2026-09-30), for the responsible person – or the admins.
  // The bell needs only each protocol's round marker, not the whole protocol data.
  const roundViews = on("rounds") ? await loadScheduleViews(ctx, today, { deviations: false, places: false }) : [];
  const othersRounds = new Set(roundViews.filter((view) => !roundReminderFor(view, { id: ctx.user.id, admin: false })).map((view) => view.id));
  const rounds = roundNotifications(roundViews, { id: ctx.user.id, admin: ctx.admin }, today).map((item) => othersRounds.has(item.id.split(":")[1]) ? { ...item, audience: "team" as const } : item);
  // Ej utfört (2026-10-28): the person's unread notices that someone recorded an occurrence of their round as not done.
  const notDone = on("rounds") ? await loadNotDoneNotifications(ctx, new Map(roundViews.map((view) => [view.id, view.title])), now) : [];
  // Från ronden (2026-11-27): work orders made from a brist in a round, for arbetsledare and admin while they are open.
  const roundFollowUps = readable && on("rounds") ? await loadRoundFollowUpNotifications(ctx, readable, now) : [];
  // Work orders from a deviation finished lately (flödesvåg 2): bounded to the last days and to readable tasks; the
  // protocol they came from must be readable and the reader's own (admins: the team's).
  const followUps = readable ? await (async () => {
    const finished = await prisma.workflowTask.findMany({
      where: { organizationId: ctx.organizationId, kind: "WORK_ORDER", status: "COMPLETED", completedAt: { gte: addSwedishDays(now, -FOLLOW_UP_DAYS - 1) }, AND: [readable] },
      select: { id: true, title: true, status: true, completedAt: true, data: true }, orderBy: { completedAt: "desc" }, take: 200,
    });
    const withSource = finished.map((task) => {
      const source = (task.data as { details?: { source?: { taskId?: unknown; rowId?: unknown } } } | null)?.details?.source;
      return { ...task, completedAt: task.completedAt?.toISOString() ?? null, source: typeof source?.taskId === "string" ? { taskId: source.taskId, ...(typeof source.rowId === "string" ? { rowId: source.rowId } : {}) } : null };
    }).filter((task) => task.source);
    if (!withSource.length) return [];
    const origins = await prisma.workflowTask.findMany({
      where: { organizationId: ctx.organizationId, id: { in: [...new Set(withSource.map((task) => task.source!.taskId))] }, AND: [readable, { OR: [{ projectId: null }, { project: { is: { archivedAt: null } } }] }, ownTasks] },
      select: { id: true, title: true, kind: true, updatedAt: true },
    });
    const byId = new Map(origins.map((origin) => [origin.id, { ...origin, updatedAt: origin.updatedAt.toISOString() }]));
    return followUpNotifications(withSource.map((workOrder) => ({ workOrder, origin: byId.get(workOrder.source!.taskId) ?? null })), now);
  })() : [];
  // Egenkontroll (2026-10-06): the yearly review for admins, an unread programme version and actions due – first.
  const selfInspection = await cloudSelfInspectionReminders(ctx, today);
  // "Tilldelad dig" (Fas 1B, 2026-10-08): the person's own unread assignments – also for an admin, never the team's.
  const assignedRows = readable ? await loadAssignmentNotifications(ctx, readable, now, Boolean(options.includeRead)) : [];
  const assigned = assignedRows.filter((item) => !item.read);
  // "Hinder rapporterat" (plan 1M, 2026-10-11): the same, for obstacles reported on the person's jobs or projects.
  const obstacles = readable ? await loadObstacleNotifications(ctx, readable) : [];
  // Teamet (användartest 2026-10-31): bookings, absence and the month's time that someone else changed for the person.
  const team = await loadTeamNotifications(ctx, now);
  // Agenter (2026-11-21): "Notis i Workflow" from the person's own missions, with the link to what the agent made.
  const agents = ctx.organization.storageMode === "HINTEK_CLOUD" ? await import("@/lib/agents/server").then((module) => module.loadAgentNotifications(ctx, now)).catch(() => []) : [];
  // Kommentarer (beslut 14, 2026-11-01): @namn and what the person follows, read and unread (the parent is checked again there).
  const comments = await loadCommentNotifications(ctx, now);
  // Nyheter (2026-11-21): what the company published the last week, by someone else; off with the module.
  const news = await loadNewsNotifications(ctx, now);
  // Frånvarokrock (beslut 4): planned work an absence touches, for those who plan.
  const absenceConflicts = on("time") && canViewTeam(ctx) && ctx.organization.storageMode === "HINTEK_CLOUD" ? await loadAbsenceConflictNotifications(ctx, now) : [];
  // "Larm från <källa>" (S4, 2026-10-20): the person's own unread machine-alarm notices; Kvittera for those who may edit work orders.
  const machineAlarms = readable && on("upkeep") ? await loadMachineAlarmNotifications(ctx, readable) : [];
  const machineNotes = on("upkeep") ? await loadMachineNoteNotifications(ctx, now) : [];
  // "Offert besvarad" (steg E, 2026-10-09): the customer's answer through the link, unread until the quote is opened –
  // only for someone who may read quotes, in Cloud.
  const quoteAnswers = on("quotes") ? await loadQuoteAnswerNotifications({ organizationId: ctx.organizationId, userId: ctx.user.id, admin: ctx.admin, permissions: ctx.workflowPermissions, storageMode: ctx.organization.storageMode }) : [];
  // "Nytt operatörskonto" (operatörssidan, 2026-10-30): the company's admins, in Cloud, until the account's machines are chosen.
  const operators = on("upkeep") && ctx.admin && ctx.organization.storageMode === "HINTEK_CLOUD" ? operatorNotifications(await prisma.operatorAccount.findMany({
    where: { organizationId: ctx.organizationId, kind: "microsoft", active: true, machines: { none: {} } }, orderBy: { createdAt: "desc" }, take: 20,
    select: { id: true, displayName: true, createdAt: true },
  }).then((rows) => rows.map((row) => ({ id: row.id, name: row.displayName || "Microsoft-konto", createdAt: row.createdAt })))) : [];
  // "Ny felanmälan" (användartest 2026-10-31, A2): an operator's fault report nobody has taken, for admins and the machine's contacts.
  const faultReports = on("upkeep") && ctx.organization.storageMode === "HINTEK_CLOUD" && can("work-order") ? await loadFaultReportNotifications(ctx, now) : [];
  // Urgent work orders first, whatever kind of notice would otherwise come before them.
  const teamOnly = selfInspection.map((item) => item.id.startsWith("self-inspection:reportable:") ? { ...item, audience: "team" as const } : item);
  const reminders = withoutAssignedDueSoon(items, assigned).map((item) => teamTaskIds.has(item.id) ? { ...item, audience: "team" as const } : item);
  const all = orderNotifications([...machineAlarms, ...machineNotes, ...assignedRows, ...obstacles, ...team, ...agents, ...comments, ...news, ...absenceConflicts, ...quoteAnswers, ...faultReports, ...operators, ...teamOnly, ...followUps, ...roundFollowUps, ...notDone, ...rounds, ...reminders]);
  const marked = await applyReadMarks(ctx, all);
  return options.includeRead ? marked : marked.filter((item) => !item.read);
}

/** The person's stored read marks on these notices (lib/workflow/notification-list.ts), within the company. */
export async function applyReadMarks(ctx: Context, items: readonly TaskNotification[]) {
  if (!items.length) return [...items];
  const marks = await prisma.noticeDelivery.findMany({ where: { organizationId: ctx.organizationId, userId: ctx.user.id, channel: NOTICE_READ_CHANNEL, key: { in: [...new Set(items.map((item) => noticeKey(item)))] } }, select: { key: true } });
  return withReadMarks(items, new Set(marks.map((mark) => mark.key)));
}

/**
 * Planned work an approved absence touches (the same rows as Teamet's "Krockar och frånvaro"), one notice per person and absence,
 * for those who plan. Never the reason for the absence: the person's name and how much it touches.
 */
async function loadAbsenceConflictNotifications(ctx: Context, now: Date): Promise<TaskNotification[]> {
  const { section } = await loadTeamAbsence(ctx, now);
  const groups = new Map<string, typeof section.affected>();
  for (const row of section.affected) groups.set(row.absenceId, [...(groups.get(row.absenceId) ?? []), row]);
  return [...groups].slice(0, 20).map(([absenceId, rows]): TaskNotification => ({
    id: `${ABSENCE_CONFLICT_PREFIX}${absenceId}`, kind: "TEAM", label: "Frånvarokrock", title: `${rows[0].personName}: ${rows.length} jobb under frånvaron`,
    detail: rows.slice(0, 2).map((row) => row.title).join(", ") + (rows.length > 2 ? " med flera" : ""),
    href: "/?tab=team#team-group-conflicts", dueDate: rows[0].day, deadline: null, needsAction: true, audience: "team",
  }));
}

/**
 * Fault reports from the operator page that became a work order nobody is responsible for yet (lib/operator/admin-notice.ts):
 * every one for an admin, the ones on machines the person has alarm responsibility for (ansvarig, ersättare) for anyone else.
 * The on-call path (Akut, Hög outside the workday) has its own notice. Within the company only.
 */
export async function loadFaultReportNotifications(ctx: Context, now: Date) {
  const parts = ctx.admin ? null : (await prisma.machineAlarmContact.findMany({ where: { organizationId: ctx.organizationId, userId: ctx.user.id, machinePartId: { not: null } }, select: { machinePartId: true }, take: 500 }))
    .flatMap((row) => row.machinePartId ? [row.machinePartId] : []);
  if (parts && !parts.length) return [];
  const reports = await prisma.operatorFaultReport.findMany({
    where: { organizationId: ctx.organizationId, status: "received", onCall: false, taskId: { not: null }, createdAt: { gte: new Date(now.getTime() - FAULT_NOTICE_DAYS * 86_400_000) }, ...(parts ? { alarmFacilityId: { in: parts } } : {}) },
    orderBy: { createdAt: "desc" }, take: 20, select: { id: true, taskId: true, workOrderLabel: true, cause: true, machineLabel: true, createdAt: true },
  });
  const ids = reports.flatMap((report) => report.taskId ? [report.taskId] : []);
  if (!ids.length) return [];
  const untaken = new Set((await prisma.workflowTask.findMany({
    where: { organizationId: ctx.organizationId, id: { in: ids }, kind: "WORK_ORDER", assignedToUserId: null, status: { notIn: [...CLOSED_TASK_STATUSES] } }, select: { id: true },
  })).map((row) => row.id));
  return faultReportNotifications(reports.flatMap((report) => report.taskId && untaken.has(report.taskId) ? [{ id: report.id, taskId: report.taskId, label: report.workOrderLabel, cause: report.cause, machineLabel: report.machineLabel, createdAt: report.createdAt }] : []));
}

/** The person's unread machine alarms (lib/machine/alarm-notice.ts): open automatic orders nobody has taken, and suggestions that wait (admins). */
async function loadMachineAlarmNotifications(ctx: Context, readable: ReturnType<typeof readableTaskWhere>) {
  const rows = await prisma.noticeDelivery.findMany({
    where: { organizationId: ctx.organizationId, userId: ctx.user.id, channel: MACHINE_ALARM_CHANNEL },
    orderBy: { createdAt: "desc" }, take: MACHINE_ALARM_LIMIT, select: { key: true, createdAt: true },
  });
  const parsed = rows.flatMap((row) => { const key = parseAlarmKey(row.key); return key ? [{ ...row, ...key }] : []; });
  if (!parsed.length) return [];
  const taskIds = [...new Set(parsed.flatMap((row) => row.taskId ? [row.taskId] : []))];
  const rowIds = [...new Set(parsed.flatMap((row) => row.rowId ? [row.rowId] : []))];
  const [tasks, orderRows] = await Promise.all([
    taskIds.length ? prisma.workflowTask.findMany({
      where: { organizationId: ctx.organizationId, id: { in: taskIds }, kind: "WORK_ORDER", status: { notIn: [...CLOSED_TASK_STATUSES] }, AND: [readable] },
      select: { id: true, status: true, dueDate: true, assignedToUserId: true },
    }) : [],
    // Tenant: only this company's rows, by the order they made or by their own id (a suggestion, only an admin's to see).
    prisma.machineAlarmOrder.findMany({
      where: { organizationId: ctx.organizationId, OR: [...(taskIds.length ? [{ taskId: { in: taskIds } }] : []), ...(rowIds.length && ctx.admin ? [{ id: { in: rowIds } }] : [])] },
      select: { id: true, taskId: true, status: true, code: true, text: true, source: { select: { name: true } } },
    }),
  ]);
  const taskById = new Map(tasks.map((task) => [task.id, task]));
  const rowByTask = new Map(orderRows.flatMap((row) => row.taskId ? [[row.taskId, row] as const] : []));
  const rowById = new Map(orderRows.map((row) => [row.id, row]));
  // Felanmälan till jouren (operatörssidan, 2026-10-30): the same notice, its words from the fault report.
  const faults = await faultAlarmTexts(ctx.organizationId, [...new Set(parsed.flatMap((row) => row.taskId && isFaultSourceId(row.sourceId) ? [row.taskId] : []))]);
  const canAck = ctx.admin || hasWorkflowPermission(ctx.workflowPermissions, "work-order", "edit");
  return alarmNotifications(parsed.map((entry) => {
    const row = entry.taskId ? rowByTask.get(entry.taskId) : rowById.get(entry.rowId ?? "");
    const fault = entry.taskId && isFaultSourceId(entry.sourceId) ? faults.get(entry.taskId) ?? null : null;
    return {
      key: entry.key, createdAt: entry.createdAt,
      alarm: fault ?? (row ? { sourceName: row.source.name, text: row.text, code: row.code } : null),
      task: entry.taskId ? taskById.get(entry.taskId) ?? null : null,
      pendingOpen: Boolean(entry.rowId && row?.status === "pending"),
    };
  }), { canAck });
}

/**
 * The person's own notes about alarms that gave no order (2026-11-05), a week back. Only for someone who still has the machines'
 * right; the words come from the company's own event and source, and a link to an open order only for someone who may read work orders.
 */
async function loadMachineNoteNotifications(ctx: Context, now: Date) {
  const machines = ctx.admin || hasWorkflowPermission(ctx.workflowPermissions, "maintenance", "read");
  if (!machines) return [];
  const rows = await prisma.noticeDelivery.findMany({
    where: { organizationId: ctx.organizationId, userId: ctx.user.id, channel: MACHINE_NOTE_CHANNEL, createdAt: { gte: addSwedishDays(now, -MACHINE_NOTE_DAYS) } },
    orderBy: { createdAt: "desc" }, take: MACHINE_NOTE_LIMIT, select: { key: true, createdAt: true },
  });
  const parsed = rows.flatMap((row) => { const key = parseAlarmNoteKey(row.key); return key ? [{ ...row, ...key }] : []; });
  if (!parsed.length) return [];
  const [events, sources] = await Promise.all([
    prisma.machineEvent.findMany({ where: { organizationId: ctx.organizationId, id: { in: parsed.map((row) => row.eventId) } }, select: { id: true, text: true, code: true } }),
    prisma.machineSource.findMany({ where: { organizationId: ctx.organizationId, id: { in: [...new Set(parsed.map((row) => row.sourceId))] } }, select: { id: true, name: true } }),
  ]);
  const eventById = new Map(events.map((event) => [event.id, event]));
  const nameById = new Map(sources.map((source) => [source.id, source.name]));
  const canOpen = ctx.admin || hasWorkflowPermission(ctx.workflowPermissions, "work-order", "read");
  return alarmNoteNotifications(parsed.map((row) => {
    const event = eventById.get(row.eventId);
    const sourceName = nameById.get(row.sourceId);
    return {
      key: row.key, createdAt: row.createdAt, alarm: event && sourceName ? { sourceName, text: event.text, code: event.code } : null,
      taskHref: row.taskId && canOpen ? `/?view=workflow_task&taskId=${encodeURIComponent(row.taskId)}&taskType=WORK_ORDER` : null,
    };
  }), { machinesHref: ctx.admin ? "/?view=advanced&section=machines" : "/?view=maintenance" });
}

/** The person's unread "Tilldelad dig" (lib/workflow/task-assignment-notice.ts), only for tasks they may read now. */
async function loadAssignmentNotifications(ctx: Context, readable: ReturnType<typeof readableTaskWhere>, now: Date, includeRead: boolean) {
  const rows = await prisma.noticeDelivery.findMany({
    where: { organizationId: ctx.organizationId, userId: ctx.user.id, OR: [{ channel: ASSIGNED_NOTICE_CHANNEL }, ...(includeRead ? [{ channel: ASSIGNED_READ_CHANNEL, createdAt: { gte: addSwedishDays(now, -ASSIGNED_READ_DAYS) } }] : [])] },
    orderBy: { createdAt: "desc" }, take: ASSIGNED_NOTICE_LIMIT, select: { key: true, createdAt: true, channel: true },
  });
  const parsed = rows.flatMap((row) => { const key = parseAssignmentKey(row.key); return key ? [{ ...row, ...key }] : []; });
  if (!parsed.length) return [];
  const [tasks, people] = await Promise.all([
    prisma.workflowTask.findMany({
      where: { organizationId: ctx.organizationId, id: { in: [...new Set(parsed.map((row) => row.taskId))] }, assignedToUserId: ctx.user.id, status: { notIn: [...CLOSED_TASK_STATUSES] }, AND: [readable, { OR: [{ projectId: null }, { project: { is: { archivedAt: null } } }] }] },
      select: { id: true, title: true, kind: true, status: true, dueDate: true, assignedToUserId: true },
    }),
    // Only the name of someone in the same company (the one who assigned it).
    prisma.organizationMember.findMany({
      where: { organizationId: ctx.organizationId, userId: { in: [...new Set(parsed.map((row) => row.byUserId))] } },
      select: { userId: true, user: { select: { name: true, email: true } } },
    }),
  ]);
  const taskById = new Map(tasks.map((task) => [task.id, task]));
  const nameById = new Map(people.map((member) => [member.userId, member.user.name || member.user.email]));
  return assignmentNotifications(parsed.map((row) => ({ key: row.key, createdAt: row.createdAt, task: taskById.get(row.taskId) ?? null, byName: nameById.get(row.byUserId) ?? "", read: row.channel === ASSIGNED_READ_CHANNEL })), ctx.user.id);
}

/** The person's unread "Hinder rapporterat" (lib/workflow/obstacle-notice.ts), only for open jobs they may read that still have the obstacle. */
async function loadObstacleNotifications(ctx: Context, readable: ReturnType<typeof readableTaskWhere>) {
  const rows = await prisma.noticeDelivery.findMany({
    where: { organizationId: ctx.organizationId, userId: ctx.user.id, channel: OBSTACLE_NOTICE_CHANNEL },
    orderBy: { createdAt: "desc" }, take: OBSTACLE_NOTICE_LIMIT, select: { key: true, createdAt: true },
  });
  const parsed = rows.flatMap((row) => { const key = parseObstacleKey(row.key); return key ? [{ ...row, ...key }] : []; });
  if (!parsed.length) return [];
  const [tasks, people] = await Promise.all([
    prisma.workflowTask.findMany({
      where: { organizationId: ctx.organizationId, id: { in: [...new Set(parsed.map((row) => row.taskId))] }, status: { notIn: [...CLOSED_TASK_STATUSES] }, AND: [readable, { OR: [{ projectId: null }, { project: { is: { archivedAt: null } } }] }] },
      select: { id: true, title: true, kind: true, status: true, dueDate: true, data: true, updatedAt: true },
    }),
    prisma.organizationMember.findMany({
      where: { organizationId: ctx.organizationId, userId: { in: [...new Set(parsed.map((row) => row.byUserId))] } },
      select: { userId: true, user: { select: { name: true, email: true } } },
    }),
  ]);
  const taskById = new Map(tasks.map((task) => [task.id, task]));
  const nameById = new Map(people.map((member) => [member.userId, member.user.name || member.user.email]));
  return obstacleNotifications(parsed.map((row) => ({ key: row.key, createdAt: row.createdAt, task: taskById.get(row.taskId) ?? null, byName: nameById.get(row.byUserId) ?? "" })));
}

/** The person's notices of work orders made from a round's brist (lib/workflow/round-follow-up.ts), only readable, open ones. */
async function loadRoundFollowUpNotifications(ctx: Context, readable: ReturnType<typeof readableTaskWhere>, now: Date) {
  const rows = await prisma.noticeDelivery.findMany({
    where: { organizationId: ctx.organizationId, userId: ctx.user.id, channel: ROUND_FOLLOW_UP_CHANNEL, createdAt: { gte: new Date(now.getTime() - ROUND_FOLLOW_UP_NOTICE_DAYS * 86_400_000) } },
    orderBy: { createdAt: "desc" }, take: ROUND_FOLLOW_UP_NOTICE_LIMIT, select: { key: true, createdAt: true },
  });
  const parsed = rows.flatMap((row) => { const key = parseRoundFollowUpNoticeKey(row.key); return key ? [{ ...row, ...key }] : []; });
  if (!parsed.length) return [];
  const orders = await prisma.workflowTask.findMany({
    where: { organizationId: ctx.organizationId, kind: "WORK_ORDER", id: { in: [...new Set(parsed.map((row) => row.workOrderId))] }, status: { notIn: [...CLOSED_TASK_STATUSES] }, AND: [readable] },
    select: { id: true, title: true, status: true, dueDate: true, plannedStartDate: true, data: true, createdBy: true },
  });
  const byId = new Map(orders.map((order) => [order.id, order]));
  const people = orders.length ? await prisma.organizationMember.findMany({
    where: { organizationId: ctx.organizationId, userId: { in: [...new Set(orders.map((order) => order.createdBy))] } }, select: { userId: true, user: { select: { name: true, email: true } } },
  }) : [];
  const names = new Map(people.map((member) => [member.userId, member.user.name || member.user.email]));
  return roundFollowUpNotifications(parsed.map((row) => { const order = byId.get(row.workOrderId) ?? null; return { createdAt: row.createdAt, byName: order ? names.get(order.createdBy) ?? "" : "", order }; }), now);
}

/** The person's unread Ej utfört notices (lib/workflow/round-outcome.ts), only for rounds they may read (`titles`) and not revoked. */
async function loadNotDoneNotifications(ctx: Context, titles: ReadonlyMap<string, string>, now: Date) {
  const rows = await prisma.noticeDelivery.findMany({
    where: { organizationId: ctx.organizationId, userId: ctx.user.id, channel: NOT_DONE_NOTICE_CHANNEL },
    orderBy: { createdAt: "desc" }, take: NOT_DONE_NOTICE_LIMIT, select: { key: true, createdAt: true },
  });
  const parsed = rows.flatMap((row) => { const key = parseNotDoneNoticeKey(row.key); return key ? [{ ...row, ...key }] : []; });
  if (!parsed.length) return [];
  const outcomes = await prisma.roundOccurrenceOutcome.findMany({
    where: { organizationId: ctx.organizationId, id: { in: parsed.map((row) => row.outcomeId) } },
    select: { id: true, scheduleId: true, occurrence: true, reason: true, userId: true, userName: true, recordedAt: true, revokedAt: true },
  });
  const byId = new Map(outcomes.map((outcome) => [outcome.id, outcome]));
  return notDoneNotifications(parsed.map((row) => {
    const outcome = byId.get(row.outcomeId);
    const title = outcome ? titles.get(outcome.scheduleId) : undefined;
    return { createdAt: row.createdAt, outcome: outcome && title !== undefined ? { id: outcome.id, scheduleId: outcome.scheduleId, occurrence: outcome.occurrence, reason: outcome.reason, userId: outcome.userId, userName: outcome.userName, recordedAt: outcome.recordedAt.toISOString(), revoked: Boolean(outcome.revokedAt), title } : null };
  }), now);
}

/**
 * The person's Teamet notices (lib/workflow/team-notice.ts): bookings, absence and the month's time that someone else changed
 * for them – each checked again here, within the company, so a notice whose cause is gone is not shown.
 */
async function loadTeamNotifications(ctx: Context, now: Date) {
  if (ctx.organization.storageMode !== "HINTEK_CLOUD") return [];
  const rows = await prisma.noticeDelivery.findMany({
    where: { organizationId: ctx.organizationId, userId: ctx.user.id, channel: TEAM_NOTICE_CHANNEL },
    orderBy: { createdAt: "desc" }, take: TEAM_NOTICE_LIMIT, select: { key: true, createdAt: true },
  });
  // Företagets moduler (0.39.0): a booking's notice follows Planering, absence and the month's time follow Tid och lön.
  const shown = (type: string) => organizationModuleOn(ctx.organization, type === "BOOKED" || type === "MOVED" || type === "UNBOOKED" ? "planning" : "time");
  const parsed = rows.flatMap((row) => { const key = parseTeamNoticeKey(row.key); return key && shown(key.type) ? [{ ...row, parsed: key }] : []; });
  if (!parsed.length) return [];
  const refs = (types: readonly string[]) => [...new Set(parsed.filter((row) => types.includes(row.parsed.type)).map((row) => row.parsed.ref))];
  const bookingIds = refs(["BOOKED", "MOVED", "UNBOOKED"]);
  const absenceIds = refs(["ABSENCE_SET", "ABSENCE_REPORTED"]);
  const months = refs(["TIME_SUBMITTED", "TIME_RETURNED", "TIME_APPROVED", "TIME_REMINDER"]).flatMap((ref) => { const month = parseMonthRef(ref); return month ? [month] : []; });
  const approver = canViewTeam(ctx);
  const [bookings, absences, periods, people] = await Promise.all([
    bookingIds.length ? prisma.plannedActivity.findMany({
      where: { organizationId: ctx.organizationId, id: { in: bookingIds } },
      select: { id: true, title: true, startsAt: true, endsAt: true, status: true, deletedAt: true, assignedToUserId: true, workflowTask: { select: { id: true, kind: true, title: true } }, assignments: { select: { member: { select: { userId: true } } } } },
    }) : [],
    absenceIds.length ? prisma.absence.findMany({ where: { organizationId: ctx.organizationId, id: { in: absenceIds } }, select: { id: true } }) : [],
    months.length ? prisma.timePeriod.findMany({ where: { organizationId: ctx.organizationId, OR: months.map((month) => ({ userId: month.userId, period: month.period })) }, select: { userId: true, period: true, status: true, note: true } }) : [],
    prisma.organizationMember.findMany({
      where: { organizationId: ctx.organizationId, userId: { in: [...new Set([...parsed.map((row) => row.parsed.byUserId), ...months.map((month) => month.userId)])] } },
      select: { userId: true, user: { select: { name: true, email: true } } },
    }),
  ]);
  const nameById = new Map(people.map((member) => [member.userId, member.user.name || member.user.email]));
  const bookingById = new Map(bookings.map((item) => [item.id, item]));
  const absenceIdsFound = new Set(absences.map((item) => item.id));
  const periodOfRef = new Map(periods.map((item) => [monthRef(item.userId, item.period), item]));
  return teamNotifications(parsed.map((row) => {
    const key = row.parsed;
    const context: TeamNoticeContext = { byName: nameById.get(key.byUserId) ?? "" };
    if (key.type === "BOOKED" || key.type === "MOVED" || key.type === "UNBOOKED") {
      const item = bookingById.get(key.ref);
      context.booking = item ? {
        title: item.title || item.workflowTask?.title || "Bokning", startsAt: item.startsAt.toISOString(), endsAt: item.endsAt.toISOString(),
        href: item.workflowTask ? `/?view=workflow_task&taskId=${encodeURIComponent(item.workflowTask.id)}&taskType=${encodeURIComponent(item.workflowTask.kind)}` : "/?view=planning",
        booked: !item.deletedAt && (item.assignedToUserId === ctx.user.id || item.assignments.some((assignment) => assignment.member.userId === ctx.user.id)),
        active: !item.deletedAt && (item.status === "PLANNED" || item.status === "IN_PROGRESS"),
      } : null;
    } else if (key.type === "ABSENCE_SET" || key.type === "ABSENCE_REPORTED") {
      // Someone else's absence is told only to those who still plan (admins and the Teamet right).
      context.absenceExists = absenceIdsFound.has(key.ref) && (key.type === "ABSENCE_SET" || approver);
    } else if (key.type.startsWith("TIME_")) {
      const month = parseMonthRef(key.ref);
      const stored = month ? periodOfRef.get(key.ref) : undefined;
      // The approver's notice only while they still approve; the person's only for their own month.
      const allowed = month && (key.type === "TIME_SUBMITTED" ? approver && month.userId !== ctx.user.id : month.userId === ctx.user.id);
      // A reminder is about a month that may have no row yet (not sent in).
      const row = stored ?? (key.type === "TIME_REMINDER" ? { status: "OPEN", note: "" } : null);
      context.month = month && row && allowed ? { status: row.status, note: row.note, personName: nameById.get(month.userId) ?? "", label: periodLabel(month.period) } : null;
    }
    return { key: row.key, createdAt: row.createdAt, context };
  }), now, (iso) => swedishDayKey(new Date(iso)));
}
