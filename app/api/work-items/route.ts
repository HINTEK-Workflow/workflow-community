import { NextResponse } from "next/server";
import { z } from "zod";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { context, failure, requireCloudStorage, requireWorkflowPermission } from "@/lib/kfid/server";
import { loadPlaceSummaries } from "@/lib/kfid/facility-server";
import { hasWorkflowPermission, readableTaskScope, type WorkflowPermissionSubject } from "@/lib/workflow/permissions";
import { readableTaskSql } from "@/lib/workflow/task-access";
import { WORK_ITEM_FILTERS, WORK_ITEM_KINDS, WORK_ORDER_ORIGINS, workItemKindsForQuery } from "@/lib/workflow/work-items";
import { WAITING_REASONS } from "@/lib/workflow/maintenance";
import { WORK_LIST_SCOPES, WORK_LIST_SORTS, workListCountsAllowed } from "@/lib/workflow/work-list";
import { maintenanceListFilterSchema } from "@/lib/workflow/maintenance";
import { workOrderItemFilterSql, workOrderPrioritySql } from "@/lib/maintenance/work-order-sql";
import { listPlaceLabel, tempPlaceOf } from "@/lib/workflow/temp-place";
import { swedishDayKey } from "@/lib/swedish-time";
import { dormantDay, notDormantSql } from "@/lib/maintenance/plan-server";

export const dynamic = "force-dynamic";

const querySchema = z.object({
  filter: z.enum(WORK_ITEM_FILTERS).default("open"),
  q: z.string().trim().max(100).default(""),
  page: z.coerce.number().int().min(1).max(10_000).default(1),
  limit: z.coerce.number().int().min(1).max(48).default(12),
  // Mina / Alla (2026-10-05); "mine" stays the default for older callers such as the list_my_work tool.
  scope: z.enum(WORK_LIST_SCOPES).default("mine"),
  sort: z.enum(WORK_LIST_SORTS).default("updated"),
  // The work order list is the same list limited to work orders; the Jobb tab's type filter (B3, 2026-10-23) may also ask
  // for TASK, every kind that is not a work order.
  kind: z.enum(WORK_ITEM_KINDS).optional(),
  // Underhåll (2026-10-06): type of maintenance and priority on the work order list – of the maintenance items the order
  // holds since 2026-10-30; ignored without kind=WORK_ORDER.
  ...maintenanceListFilterSchema.shape,
  // Rondordrar (2026-10-26): the work orders of rounds, the others, or one round's (a schedule's id).
  origin: z.enum(WORK_ORDER_ORIGINS).default(""),
  round: z.string().min(1).max(100).optional(),
  // Dashboard etapp 3 (2026-10-28): completed jobs only from this Swedish day ("Klara, 30 dagar"; completedFrom).
  from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().catch(undefined),
});

type Row = {
  id: string; kind: string; title: string; status: string; updatedAt: Date; projectId: string | null; projectName: string | null;
  progress: number | null; customerName: string | null; facilityId: string | null; responsibleName: string | null;
  dueDate: string | null; isMine: boolean; priority: string | null; waitingOn: string | null; tempPlace: unknown;
  workOrderId: string | null; workOrderTitle: string | null; roundScheduleId: string | null;
};

/**
 * Mina uppgifter and Arbetsorder as one server-side list (2026-09-26: bounded and paged by the server;
 * 2026-10-05: one way to list work, Mina / Alla). "Mina" is assigned to me, or created by me when nobody is assigned;
 * "Alla" is everything the member may read per module. "Mina" also holds jobs the member is booked on (2026-10-09). Tenant and module read permission are checked here whatever
 * the scope. Filtering, search, counts, sorting and paging run in PostgreSQL; only the returned page reads place paths.
 */
export async function GET(request: Request) {
  try {
    const ctx = await context();
    requireCloudStorage(ctx);
    const input = querySchema.parse(Object.fromEntries(new URL(request.url).searchParams));
    if (input.kind === "WORK_ORDER") requireWorkflowPermission(ctx, "work-order", "read");
    const can = (subject: WorkflowPermissionSubject) => ctx.admin || hasWorkflowPermission(ctx.workflowPermissions, subject, "read");
    // Protocols follow their form's permission area (2026-09-27).
    const readable = readableTaskScope(can).any;
    // Steg 1 (2026-10-09): "Mina" also holds the jobs I am booked on (Bokad personal), not only assigned or created ones.
    // The booked set is one uncorrelated subquery through the organization's index, not a lookup per row.
    const bookedTasks = Prisma.sql`select pa."workflowTaskId" from "PlannedActivity" pa
      where pa."organizationId" = ${ctx.organizationId} and pa."workflowTaskId" is not null and pa."deletedAt" is null and pa.status <> 'CANCELED'
        and (pa."assignedToUserId" = ${ctx.user.id} or exists (select 1 from "PlannedActivityAssignment" a join "OrganizationMember" m on m.id = a."memberId" and m."organizationId" = a."organizationId"
          where a."plannedActivityId" = pa.id and a."organizationId" = pa."organizationId" and m."userId" = ${ctx.user.id}))`;
    const mineTask = Prisma.sql`(t."assignedToUserId" = ${ctx.user.id} or (t."assignedToUserId" is null and t."createdBy" = ${ctx.user.id}) or t.id in (${bookedTasks}))`;
    const parts: Prisma.Sql[] = [];
    if (readable) parts.push(Prisma.sql`
      select t.id, t.kind, t.title, t.status, t."updatedAt", t."projectId", p.name as "projectName", t.progress,
        coalesce(nullif(cu.company, ''), cu.name) as "customerName", t."facilityId", t."assignedToName" as "responsibleName", t."dueDate", t."plannedStartDate", t."startedAt",
        coalesce(${mineTask}, false) as "isMine",
        case when t.status = 'COMPLETED' then 'done' when t.status = 'CANCELLED' then 'cancelled' when t.status in ('IN_PROGRESS', 'PAUSED', 'NEEDS_ACTION') or t.progress > 0 then 'active' else 'planned' end as state,
        case when t.kind = 'WORK_ORDER' then ${workOrderPrioritySql} end as priority,
        case when t.kind = 'WORK_ORDER' then t.data->'details'->>'waitingOn' end as "waitingOn",
        t.data->'tempPlace' as "tempPlace",
        t."workOrderId", ${can("work-order") ? Prisma.sql`wo.title` : Prisma.sql`null::text`} as "workOrderTitle", t."roundScheduleId"
      from "WorkflowTask" t left join "Project" p on p.id = t."projectId" left join "Customer" cu on cu.id = t."customerId"
        left join "WorkflowTask" wo on wo.id = t."workOrderId" and wo."organizationId" = t."organizationId"
      where t."organizationId" = ${ctx.organizationId} and ${readableTaskSql(can)}
        and ${notDormantSql("t", dormantDay(ctx.organization, swedishDayKey(new Date())))}
        ${input.kind === "WORK_ORDER" ? Prisma.sql`and t.kind = 'WORK_ORDER'` : input.kind === "TASK" ? Prisma.sql`and t.kind <> 'WORK_ORDER'` : Prisma.empty}
        ${input.kind === "WORK_ORDER" ? workOrderItemFilterSql(input) : Prisma.empty}
        ${input.round ? Prisma.sql`and t."roundScheduleId" = ${input.round}` : input.origin === "rounds" ? Prisma.sql`and t."roundScheduleId" is not null` : input.origin === "other" ? Prisma.sql`and t."roundScheduleId" is null` : Prisma.empty}
        ${input.from ? Prisma.sql`and (t.status <> 'COMPLETED' or to_char((t."completedAt" at time zone 'UTC') at time zone 'Europe/Stockholm', 'YYYY-MM-DD') >= ${input.from})` : Prisma.empty}
        ${input.scope === "mine" ? Prisma.sql`and ${mineTask}` : Prisma.empty}`);
    const withCounts = workListCountsAllowed(input.scope, ctx.admin);
    const empty = { items: [], total: 0, page: 1, pages: 1, counts: withCounts ? Object.fromEntries(WORK_ITEM_FILTERS.map((filter) => [filter, 0])) : null };
    if (!parts.length) return NextResponse.json(empty);

    const union = Prisma.join(parts, " union all ");
    const pattern = `%${input.q.replace(/[\\%_]/g, "\\$&")}%`;
    const searchedKinds = workItemKindsForQuery(input.q);
    const search = input.q
      ? Prisma.sql`(x.title ilike ${pattern} or coalesce(x."projectName", '') ilike ${pattern} or coalesce(x."customerName", '') ilike ${pattern} or coalesce(x."responsibleName", '') ilike ${pattern} or coalesce(x."workOrderTitle", '') ilike ${pattern}${searchedKinds.length ? Prisma.sql` or x.kind in (${Prisma.join(searchedKinds)})` : Prisma.empty})`
      : Prisma.sql`true`;
    const predicates = {
      open: Prisma.sql`x.state not in ('done', 'cancelled')`,
      active: Prisma.sql`x.state = 'active' and x.status <> 'NEEDS_ACTION'`,
      planned: Prisma.sql`x.state = 'planned'`,
      action: Prisma.sql`x.state not in ('done', 'cancelled') and x.status = 'NEEDS_ACTION'`,
      // Förfallna: isLateTask (lib/workflow/late-tasks.ts) – open, with a Klart senast before today (Swedish day).
      overdue: Prisma.sql`x.state not in ('done', 'cancelled') and nullif(x."dueDate", '') < ${swedishDayKey(new Date())}`,
      // Försenad start: isLateStart – planned (not started), no time, its start has passed, and not yet förfallen.
      late_start: Prisma.sql`x.state = 'planned' and x."startedAt" is null and nullif(x."plannedStartDate", '') < ${swedishDayKey(new Date())} and coalesce(nullif(x."dueDate", '') < ${swedishDayKey(new Date())}, false) = false`,
      // Hinder: Behöver åtgärdas, or Pausad and waiting for something (lib/workflow/obstacles.ts jobObstacle).
      blocked: Prisma.sql`x.state not in ('done', 'cancelled') and (x.status = 'NEEDS_ACTION' or (x.status = 'PAUSED' and x."waitingOn" in (${Prisma.join([...WAITING_REASONS])})))`,
      done: Prisma.sql`x.state = 'done'`,
      cancelled: Prisma.sql`x.state = 'cancelled'`,
      all: Prisma.sql`true`,
    } satisfies Record<(typeof WORK_ITEM_FILTERS)[number], Prisma.Sql>;
    // The same order as compareWork in lib/workflow/work-list.ts: open work orders marked Akut first (2026-10-06).
    // coalesce: a row without priority gives NULL, and NULL sorts first under desc.
    const urgentFirst = Prisma.sql`coalesce(x.state not in ('done', 'cancelled') and x.priority = 'URGENT', false) desc`;
    const order = {
      updated: Prisma.sql`${urgentFirst}, x."updatedAt" desc, x.id`,
      due: Prisma.sql`${urgentFirst}, nullif(x."dueDate", '') asc nulls last, x."updatedAt" desc, x.id`,
      title: Prisma.sql`${urgentFirst}, lower(x.title), x.id`,
    } satisfies Record<(typeof WORK_LIST_SORTS)[number], Prisma.Sql>;
    const countFilters = withCounts ? WORK_ITEM_FILTERS : [input.filter];
    const [countRows, rows] = await Promise.all([
      prisma.$queryRaw<Record<string, number>[]>`select ${Prisma.join(countFilters.map((filter) => Prisma.sql`count(*) filter (where ${predicates[filter]})::int as ${Prisma.raw(`"${filter}"`)}`))} from (${union}) x where ${search}`,
      prisma.$queryRaw<Row[]>`
        select x.id, x.kind, x.title, x.status, x."updatedAt", x."projectId", x."projectName", x.progress,
          x."customerName", x."facilityId", x."responsibleName", x."dueDate", x."isMine", x.priority, x."waitingOn", x."tempPlace", x."workOrderId", x."workOrderTitle", x."roundScheduleId"
        from (${union}) x where ${search} and ${predicates[input.filter]}
        order by ${order[input.sort]} limit ${input.limit} offset ${(input.page - 1) * input.limit}`,
    ]);
    const counted = countRows[0] ?? {};
    // The next planned time is read only for the returned page, through the organization's index (quality check
    // 2026-10-05, F2: a subquery per row in the union scanned every organization's planned activities).
    const taskIds = rows.map((row) => row.id);
    const [places, planned] = await Promise.all([
      loadPlaceSummaries(ctx.organizationId, rows.map((row) => row.facilityId)),
      taskIds.length ? prisma.plannedActivity.groupBy({
        by: ["workflowTaskId"],
        where: { organizationId: ctx.organizationId, workflowTaskId: { in: taskIds }, deletedAt: null, endsAt: { gte: new Date() } },
        _min: { startsAt: true },
      }) : [],
    ]);
    const plannedAt = new Map(planned.map((entry) => [entry.workflowTaskId, entry._min.startsAt]));
    const total = Number(counted[input.filter] ?? 0);
    const shared = (row: Row) => ({
      id: row.id, title: row.title, status: row.status, updatedAt: row.updatedAt, projectId: row.projectId, projectName: row.projectName ?? "",
      customerName: row.customerName ?? "", // Tillfällig plats (2026-10-08): where the place shows, marked, beside a register place when both exist.
      placeName: listPlaceLabel(row.facilityId ? places.get(row.facilityId)?.name : "", tempPlaceOf({ tempPlace: row.tempPlace })), responsibleName: row.responsibleName ?? "",
      dueDate: row.dueDate ?? "", plannedAt: plannedAt.get(row.id) ?? null, isMine: row.isMine,
      // Hör till arbetsorder (Fas 2): shown compactly in the row; the title only for those who may read work orders.
      ...(row.workOrderId ? { workOrderId: row.workOrderId, workOrderTitle: row.workOrderTitle ?? "" } : {}),
      ...(row.roundScheduleId ? { roundScheduleId: row.roundScheduleId } : {}),
    });
    return NextResponse.json({
      items: rows.map((row) => ({ ...shared(row), kind: row.kind, progress: row.progress ?? 0, assignedToName: row.responsibleName ?? "",
        ...(row.kind === "WORK_ORDER" ? { maintenance: { priority: row.priority ?? "", waitingOn: row.waitingOn ?? "" } } : {}) })),
      total,
      page: input.page,
      pages: Math.max(1, Math.ceil(total / input.limit)),
      counts: withCounts ? Object.fromEntries(WORK_ITEM_FILTERS.map((filter) => [filter, Number(counted[filter] ?? 0)])) : null,
    });
  } catch (error) {
    return failure(error);
  }
}
