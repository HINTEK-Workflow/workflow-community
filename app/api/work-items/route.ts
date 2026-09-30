import { controlProgress } from "@/lib/workflow/project-progress";
import { NextResponse } from "next/server";
import { z } from "zod";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { context, failure, requireCloudStorage } from "@/lib/kfid/server";
import { normalizeControl, validateForCompletion } from "@/lib/kfid/model";
import { hasWorkflowPermission, readableTaskScope, type WorkflowPermissionSubject } from "@/lib/workflow/permissions";
import { readableTaskSql } from "@/lib/workflow/task-access";
import { WORK_ITEM_FILTERS, workItemKindsForQuery } from "@/lib/workflow/work-items";

export const dynamic = "force-dynamic";

const querySchema = z.object({
  filter: z.enum(WORK_ITEM_FILTERS).default("open"),
  q: z.string().trim().max(100).default(""),
  page: z.coerce.number().int().min(1).max(10_000).default(1),
  limit: z.coerce.number().int().min(1).max(48).default(12),
});

/**
 * Mina uppgifter as a server-side list (2026-09-26: lists are bounded and paged by the server).
 * The same "mine" rule as before – assigned to me, or created by me when nobody is assigned; controls I created or
 * perform – within the tenant and the member's read permission per module. Filtering, search, counts and paging run in
 * PostgreSQL; only the returned page computes control completion from its content.
 */
export async function GET(request: Request) {
  try {
    const ctx = await context();
    requireCloudStorage(ctx);
    const input = querySchema.parse(Object.fromEntries(new URL(request.url).searchParams));
    const can = (subject: WorkflowPermissionSubject) => ctx.admin || hasWorkflowPermission(ctx.workflowPermissions, subject, "read");
    // Protocols follow their form's permission area (2026-09-27).
    const readable = readableTaskScope(can).any;
    const performers = [ctx.user.name, ctx.user.email].filter((value): value is string => Boolean(value));
    const parts: Prisma.Sql[] = [];
    if (readable) parts.push(Prisma.sql`
      select t.id, t.kind, null::int as number, t.title, t.status, t."updatedAt", t."projectId", p.name as "projectName", t.progress, null::timestamp as "lastOpenedAt",
        case when t.status = 'COMPLETED' then 'done' when t.status in ('IN_PROGRESS', 'PAUSED', 'NEEDS_ACTION') or t.progress > 0 then 'active' else 'planned' end as state
      from "WorkflowTask" t left join "Project" p on p.id = t."projectId"
      where t."organizationId" = ${ctx.organizationId} and ${readableTaskSql(can)}
        and (t."assignedToUserId" = ${ctx.user.id} or (t."assignedToUserId" is null and t."createdBy" = ${ctx.user.id}))`);
    if (can("kfid")) parts.push(Prisma.sql`
      select c.id, 'COMMISSIONING_CONTROL' as kind, c.number, c.title, c.status, c."updatedAt", c."projectId", p.name as "projectName", null::int as progress, c."lastOpenedAt",
        case when c.status = 'COMPLETED' then 'done' when c."lastOpenedAt" is not null or c.version > 1 then 'active' else 'planned' end as state
      from "Control" c left join "Project" p on p.id = c."projectId"
      where c."organizationId" = ${ctx.organizationId} and c."deletedAt" is null
        and (c."createdBy" = ${ctx.user.id}${performers.length ? Prisma.sql` or c.performer in (${Prisma.join(performers)})` : Prisma.empty})`);
    const empty = { items: [], total: 0, page: 1, pages: 1, counts: Object.fromEntries(WORK_ITEM_FILTERS.map((filter) => [filter, 0])) };
    if (!parts.length) return NextResponse.json(empty);

    const union = Prisma.join(parts, " union all ");
    const pattern = `%${input.q.replace(/[\\%_]/g, "\\$&")}%`;
    const searchedKinds = workItemKindsForQuery(input.q);
    const search = input.q
      ? Prisma.sql`(x.title ilike ${pattern} or coalesce(x."projectName", '') ilike ${pattern}${searchedKinds.length ? Prisma.sql` or x.kind in (${Prisma.join(searchedKinds)})` : Prisma.empty})`
      : Prisma.sql`true`;
    const predicates = {
      open: Prisma.sql`x.state <> 'done'`,
      active: Prisma.sql`x.state = 'active' and x.status <> 'NEEDS_ACTION'`,
      planned: Prisma.sql`x.state = 'planned'`,
      action: Prisma.sql`x.state <> 'done' and x.status = 'NEEDS_ACTION'`,
      done: Prisma.sql`x.state = 'done'`,
      all: Prisma.sql`true`,
    } satisfies Record<(typeof WORK_ITEM_FILTERS)[number], Prisma.Sql>;
    const [countRows, rows] = await Promise.all([
      prisma.$queryRaw<Record<string, number>[]>`select ${Prisma.join(WORK_ITEM_FILTERS.map((filter) => Prisma.sql`count(*) filter (where ${predicates[filter]})::int as ${Prisma.raw(`"${filter}"`)}`))} from (${union}) x where ${search}`,
      prisma.$queryRaw<{ id: string; kind: string; number: number | null; title: string; status: string; updatedAt: Date; projectId: string | null; projectName: string | null; progress: number | null; lastOpenedAt: Date | null }[]>`
        select x.id, x.kind, x.number, x.title, x.status, x."updatedAt", x."projectId", x."projectName", x.progress, x."lastOpenedAt"
        from (${union}) x where ${search} and ${predicates[input.filter]}
        order by x."updatedAt" desc, x.id limit ${input.limit} offset ${(input.page - 1) * input.limit}`,
    ]);
    const counts = countRows[0] ?? empty.counts;
    const controlIds = rows.filter((row) => row.kind === "COMMISSIONING_CONTROL").map((row) => row.id);
    const controls = controlIds.length ? await prisma.control.findMany({
      where: { id: { in: controlIds }, organizationId: ctx.organizationId },
      select: { id: true, data: true, _count: { select: { attachments: true } } },
    }) : [];
    const completion = new Map(controls.map((control) => [control.id, validateForCompletion(normalizeControl(control.data), { attachmentCount: control._count.attachments }).progress.percent]));
    const total = Number(counts[input.filter] ?? 0);
    return NextResponse.json({
      items: rows.map((row) => row.kind === "COMMISSIONING_CONTROL"
        ? { id: row.id, number: row.number ?? undefined, title: row.title, status: row.status, updatedAt: row.updatedAt, projectId: row.projectId, projectName: row.projectName ?? "", lastOpenedAt: row.lastOpenedAt, completion: controlProgress(row.status, completion.get(row.id)), isMine: true }
        : { id: row.id, kind: row.kind, title: row.title, status: row.status, updatedAt: row.updatedAt, projectId: row.projectId, projectName: row.projectName ?? "", progress: row.progress ?? 0, isMine: true }),
      total,
      page: input.page,
      pages: Math.max(1, Math.ceil(total / input.limit)),
      counts,
    });
  } catch (error) {
    return failure(error);
  }
}
