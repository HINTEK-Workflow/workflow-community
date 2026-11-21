import { NextResponse } from "next/server";
import { z } from "zod";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { ApiError, context, failure, requireCloudStorage } from "@/lib/kfid/server";
import { canViewTeam, hasWorkflowPermission, type WorkflowPermissionSubject } from "@/lib/workflow/permissions";
import { readableTaskSql } from "@/lib/workflow/task-access";
import { swedishDayKey } from "@/lib/swedish-time";
import { readCompanyGoals } from "@/lib/workflow/company-goals-server";
import { emptyTaskStatisticsMeasures, measureKey, summarizeTaskStatistics, summarizeWorkOrderGoal, taskStatisticsBucket, TASK_STATISTICS_TYPES, UNASSIGNED_PERFORMER, type TaskStatisticsMeasure } from "@/lib/workflow/task-statistics";

export const dynamic = "force-dynamic";

const PAGE_SIZE = 10;

/**
 * Read-only task statistics for the overview: work orders, tasks in work orders and round occurrences created and
 * completed per Swedish day, each counted once in its own measure (lib/workflow/task-statistics.ts has the rules,
 * 2026-10-28); drafts count nowhere and Utgått is never completed. Team aggregates (including per-performer counts, by
 * user id) are for those who may see Teamet (company admins or team:read, 2026-10-28), as with the key figures; a
 * member counts only the task types they may read. The goal is the company's own (Inställningar → Arbetssätt → Mål).
 * Everything is aggregated in PostgreSQL and the list of tasks in the period is paged.
 *
 * `mine=1` (Jag, 2026-10-29): only the viewer's own assigned tasks, for every member – no performers, no members
 * count and no company goal, so nothing of the team is shown.
 *
 * `type`: ALL (every measure), WORK_ORDER, TASK, ROUND, or a task kind (KFID, RISK_ASSESSMENT, FORM) across tasks and
 * round occurrences. Besides the earlier fields the answer has `measures` (all three measures, whatever the type),
 * `kpis.cancelled` and `goal` (the work-order goal against the completed work orders; null figures = no goal set).
 */
export async function GET(request: Request) {
  try {
    const ctx = await context();
    requireCloudStorage(ctx);
    const params = new URL(request.url).searchParams;
    const mine = params.get("mine") === "1";
    if (!mine && !canViewTeam(ctx)) throw new ApiError(403, "Du saknar behörighet att se teamets statistik.");
    // Opening Teamet never reads past the module rights: a member counts only readable tasks (admins read every area).
    const readableSql = ctx.admin ? Prisma.empty : Prisma.sql` and ${readableTaskSql((subject: WorkflowPermissionSubject) => hasWorkflowPermission(ctx.workflowPermissions, subject, "read"))}`;
    const readable = mine ? Prisma.sql`${readableSql} and t."assignedToUserId" = ${ctx.user.id}` : readableSql;
    const today = swedishDayKey(new Date());
    const defaultStart = `${Number(today.slice(0, 4)) - 1}-${today.slice(5, 7)}-01`;
    const from = z.iso.date().parse(params.get("from") || defaultStart);
    const to = z.iso.date().parse(params.get("to") || today);
    const days = (Date.parse(to) - Date.parse(from)) / 86400000;
    if (days < 0 || days > 1826) throw new ApiError(400, "Välj ett datumintervall på högst fem år, med start före slut.");
    const bucket = taskStatisticsBucket(from, to, z.enum(["auto", "day", "week", "month"]).parse(params.get("bucket") || "auto"));
    const type = z.enum(TASK_STATISTICS_TYPES).parse(params.get("type") || "ALL");
    const page = z.coerce.number().int().min(1).max(10000).parse(params.get("page") || 1);

    // One tenant-bound row per counted task with Swedish creation/completion days (at time zone 'Europe/Stockholm', so
    // month and year boundaries and summer/winter time follow the Swedish calendar). A control or risk assessment made as
    // a form counts as a control or risk assessment (2026-09-27); `taskKind` keeps the real kind for the link.
    // Drafts – a task without a work order that is Planerad or Utgår – are left out (taskStatisticsMeasure). The
    // performer is the assigned user's current name, by id; no user is the one "Ej tilldelad" bucket.
    const tasks = Prisma.sql`
      select t.id, case when t.kind = 'FORM' and t."formArea" = 'kfid' then 'KFID' when t.kind = 'FORM' and t."formArea" = 'risk-assessment' then 'RISK_ASSESSMENT' else t.kind end as kind,
        t.kind as "taskKind", t.title, t.status, t."assignedToUserId" as "userId",
        case when t."assignedToUserId" is null then ${UNASSIGNED_PERFORMER}::text else coalesce(nullif(u.name, ''), nullif(t."assignedToName", ''), 'Okänd användare') end as performer,
        case when t.kind = 'WORK_ORDER' then 'WORK_ORDER' when t.kind = 'FORM' and jsonb_typeof(t.data #> '{details,values,round,scheduleId}') = 'string' then 'ROUND' else 'TASK' end as measure,
        t."createdAt" as "createdAt",
        to_char((t."createdAt" at time zone 'UTC') at time zone 'Europe/Stockholm', 'YYYY-MM-DD') as "createdDay",
        case when t.status = 'COMPLETED' and t."completedAt" is not null then to_char((t."completedAt" at time zone 'UTC') at time zone 'Europe/Stockholm', 'YYYY-MM-DD') end as "completedDay"
      from "WorkflowTask" t left join "User" u on u.id = t."assignedToUserId"
      where t."organizationId" = ${ctx.organizationId} and t.kind in ('WORK_ORDER', 'RISK_ASSESSMENT', 'FORM')
        and (t.kind = 'WORK_ORDER' or t."workOrderId" is not null or t.status not in ('PLANNED', 'CANCELLED'))${readable}`;
    const typeFilter = type === "ALL" ? Prisma.sql`true`
      : type === "WORK_ORDER" || type === "TASK" || type === "ROUND" ? Prisma.sql`measure = ${type}`
      : Prisma.sql`measure <> 'WORK_ORDER' and kind = ${type}`;
    const [created, completed, performers, recent, total, measureRows, workOrdersCompleted, members, goals] = await Promise.all([
      prisma.$queryRaw<{ date: string; count: number }[]>`select "createdDay" as date, count(*)::int as count from (${tasks}) x where ${typeFilter} and "createdDay" between ${from} and ${to} group by "createdDay"`,
      prisma.$queryRaw<{ date: string; count: number }[]>`select "completedDay" as date, count(*)::int as count from (${tasks}) x where ${typeFilter} and "completedDay" between ${from} and ${to} group by "completedDay"`,
      prisma.$queryRaw<{ userId: string | null; name: string; created: number; completed: number }[]>`
        select "userId", min(performer) as name,
          count(*) filter (where "createdDay" between ${from} and ${to})::int as created,
          count(*) filter (where "completedDay" between ${from} and ${to})::int as completed
        from (${tasks}) x where ${typeFilter} and ("createdDay" between ${from} and ${to} or "completedDay" between ${from} and ${to})
        group by "userId" order by completed desc, created desc, name, "userId" limit 30`,
      prisma.$queryRaw<{ id: string; kind: string; taskKind: string; measure: TaskStatisticsMeasure; title: string; status: string; performer: string; createdDay: string; completedDay: string | null }[]>`
        select id, kind, "taskKind", measure, title, status, performer, "createdDay", "completedDay" from (${tasks}) x
        where ${typeFilter} and "createdDay" between ${from} and ${to}
        order by "createdAt" desc, id limit ${PAGE_SIZE} offset ${(page - 1) * PAGE_SIZE}`,
      prisma.$queryRaw<{ count: number; cancelled: number }[]>`select count(*)::int as count, count(*) filter (where status = 'CANCELLED')::int as cancelled from (${tasks}) x where ${typeFilter} and "createdDay" between ${from} and ${to}`,
      prisma.$queryRaw<{ measure: TaskStatisticsMeasure; created: number; completed: number; cancelled: number }[]>`
        select measure,
          count(*) filter (where "createdDay" between ${from} and ${to})::int as created,
          count(*) filter (where "completedDay" between ${from} and ${to})::int as completed,
          count(*) filter (where "createdDay" between ${from} and ${to} and status = 'CANCELLED')::int as cancelled
        from (${tasks}) x group by measure`,
      prisma.$queryRaw<{ date: string; count: number }[]>`select "completedDay" as date, count(*)::int as count from (${tasks}) x where measure = 'WORK_ORDER' and "completedDay" between ${from} and ${to} group by "completedDay"`,
      prisma.organizationMember.count({ where: { organizationId: ctx.organizationId, isActive: true, user: { isActive: true } } }),
      readCompanyGoals(ctx.organizationId),
    ]);
    const goalPerMonth = mine ? null : goals.completedWorkOrdersPerMonth;
    // The target line belongs to work orders: drawn only when the chart shows them and the company has set a goal.
    const summary = summarizeTaskStatistics({ created, completed, from, to, bucket, monthlyTarget: type === "WORK_ORDER" ? goalPerMonth ?? 0 : 0 });
    const measures = emptyTaskStatisticsMeasures();
    for (const row of measureRows) measures[measureKey[row.measure]] = { created: row.created, completed: row.completed, cancelled: row.cancelled };
    const count = total[0]?.count ?? 0;
    return NextResponse.json({
      from,
      to,
      bucket,
      type,
      ...summary,
      kpis: { ...summary.kpis, cancelled: total[0]?.cancelled ?? 0, members: mine ? 1 : members },
      measures,
      goal: summarizeWorkOrderGoal({ completed: workOrdersCompleted, from, to, perMonth: goalPerMonth }),
      performers: mine ? [] : performers,
      recent: { items: recent, page, pages: Math.max(1, Math.ceil(count / PAGE_SIZE)), total: count },
    });
  } catch (error) {
    return failure(error);
  }
}
