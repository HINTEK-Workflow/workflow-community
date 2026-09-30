import { NextResponse } from "next/server";
import { z } from "zod";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { ApiError, context, failure, requireAdmin, requireCloudStorage } from "@/lib/kfid/server";
import { swedishDayKey } from "@/lib/swedish-time";
import { summarizeTaskStatistics, taskStatisticsBucket, TASK_STATISTICS_TYPES } from "@/lib/workflow/task-statistics";

export const dynamic = "force-dynamic";

const PAGE_SIZE = 10;

/**
 * Read-only task statistics for the overview: controls, work orders and risk assessments created and completed
 * per Swedish day. Team aggregates (including per-performer counts) are for company admins only, as with the key
 * figures. Everything is aggregated in PostgreSQL and the list of tasks in the period is paged.
 */
export async function GET(request: Request) {
  try {
    const ctx = await context();
    requireCloudStorage(ctx);
    requireAdmin(ctx);
    const params = new URL(request.url).searchParams;
    const today = swedishDayKey(new Date());
    const defaultStart = `${Number(today.slice(0, 4)) - 1}-${today.slice(5, 7)}-01`;
    const from = z.iso.date().parse(params.get("from") || defaultStart);
    const to = z.iso.date().parse(params.get("to") || today);
    const days = (Date.parse(to) - Date.parse(from)) / 86400000;
    if (days < 0 || days > 1826) throw new ApiError(400, "Välj ett datumintervall på högst fem år, med start före slut.");
    const bucket = taskStatisticsBucket(from, to, z.enum(["auto", "day", "week", "month"]).parse(params.get("bucket") || "auto"));
    const type = z.enum(TASK_STATISTICS_TYPES).parse(params.get("type") || "ALL");
    const page = z.coerce.number().int().min(1).max(10000).parse(params.get("page") || 1);

    // One tenant-bound row per task with Swedish creation/completion days. Completed controls are immutable,
    // so their last update is the completion time.
    // A control or risk assessment made as a form after the switch-over counts as a control or risk assessment
    // (Daniel 2026-09-27); `taskKind` keeps the real kind for the link.
    const tasks = Prisma.sql`
      select c.id, 'KFID' as kind, 'KFID' as "taskKind", c.title, c.status, coalesce(nullif(c.performer, ''), 'Ej angivet') as performer,
        c."createdAt" as "createdAt",
        to_char((c."createdAt" at time zone 'UTC') at time zone 'Europe/Stockholm', 'YYYY-MM-DD') as "createdDay",
        case when c.status = 'COMPLETED' then to_char((c."updatedAt" at time zone 'UTC') at time zone 'Europe/Stockholm', 'YYYY-MM-DD') end as "completedDay"
      from "Control" c where c."organizationId" = ${ctx.organizationId} and c."deletedAt" is null
      union all
      select t.id, case when t.kind = 'FORM' and t."formArea" = 'kfid' then 'KFID' when t.kind = 'FORM' and t."formArea" = 'risk-assessment' then 'RISK_ASSESSMENT' else t.kind end as kind, t.kind as "taskKind", t.title, t.status, coalesce(nullif(t."assignedToName", ''), 'Ej tilldelad') as performer,
        t."createdAt" as "createdAt",
        to_char((t."createdAt" at time zone 'UTC') at time zone 'Europe/Stockholm', 'YYYY-MM-DD') as "createdDay",
        case when t.status = 'COMPLETED' and t."completedAt" is not null then to_char((t."completedAt" at time zone 'UTC') at time zone 'Europe/Stockholm', 'YYYY-MM-DD') end as "completedDay"
      from "WorkflowTask" t where t."organizationId" = ${ctx.organizationId} and t.kind in ('WORK_ORDER', 'RISK_ASSESSMENT', 'FORM')`;
    const typeFilter = type === "ALL" ? Prisma.sql`true` : Prisma.sql`kind = ${type}`;
    const [created, completed, performers, recent, total, members] = await Promise.all([
      prisma.$queryRaw<{ date: string; count: number }[]>`select "createdDay" as date, count(*)::int as count from (${tasks}) x where ${typeFilter} and "createdDay" between ${from} and ${to} group by "createdDay"`,
      prisma.$queryRaw<{ date: string; count: number }[]>`select "completedDay" as date, count(*)::int as count from (${tasks}) x where ${typeFilter} and "completedDay" between ${from} and ${to} group by "completedDay"`,
      prisma.$queryRaw<{ name: string; created: number; completed: number }[]>`
        select performer as name,
          count(*) filter (where "createdDay" between ${from} and ${to})::int as created,
          count(*) filter (where "completedDay" between ${from} and ${to})::int as completed
        from (${tasks}) x where ${typeFilter} and ("createdDay" between ${from} and ${to} or "completedDay" between ${from} and ${to})
        group by performer order by completed desc, created desc, performer limit 30`,
      prisma.$queryRaw<{ id: string; kind: string; taskKind: string; title: string; status: string; performer: string; createdDay: string; completedDay: string | null }[]>`
        select id, kind, "taskKind", title, status, performer, "createdDay", "completedDay" from (${tasks}) x
        where ${typeFilter} and "createdDay" between ${from} and ${to}
        order by "createdAt" desc, id limit ${PAGE_SIZE} offset ${(page - 1) * PAGE_SIZE}`,
      prisma.$queryRaw<{ count: number }[]>`select count(*)::int as count from (${tasks}) x where ${typeFilter} and "createdDay" between ${from} and ${to}`,
      prisma.organizationMember.count({ where: { organizationId: ctx.organizationId, isActive: true, user: { isActive: true } } }),
    ]);
    const summary = summarizeTaskStatistics({ created, completed, from, to, bucket, monthlyTarget: members * 2 });
    const count = total[0]?.count ?? 0;
    return NextResponse.json({
      from,
      to,
      bucket,
      type,
      ...summary,
      kpis: { ...summary.kpis, members },
      performers,
      recent: { items: recent, page, pages: Math.max(1, Math.ceil(count / PAGE_SIZE)), total: count },
    });
  } catch (error) {
    return failure(error);
  }
}
