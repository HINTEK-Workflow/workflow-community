import { Prisma } from "@prisma/client";
import { z } from "zod";
import { prisma } from "@/lib/db";
import type { Context } from "./server";
import { normalizeControl, validateForCompletion } from "./model";
import { hasWorkflowPermission } from "@/lib/workflow/permissions";
const date = z.union([z.literal(""), z.iso.date()]).default("");
export const recordQuery = z.object({
  kind: z.enum(["controls", "customers"]).default("controls"),
  q: z.string().trim().max(200).default(""),
  from: date,
  to: date,
  status: z.enum(["ALL", "DRAFT", "COMPLETED", "POSTED"]).default("ALL"),
  trash: z.enum(["true", "false"]).default("false"),
  sort: z
    .enum([
      "updated",
      "number",
      "name",
      "date",
      "performer",
      "email",
      "address",
    ])
    .default("updated"),
  direction: z.enum(["asc", "desc"]).default("desc"),
  page: z.coerce.number().int().min(1).max(100000).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(25),
  customerId: z.string().max(100).default(""),
  creator: z.enum(["ALL", "MINE"]).default("ALL"),
  siteId: z.string().max(100).default(""),
  departmentId: z.string().max(100).default(""),
});
export type RecordQuery = z.infer<typeof recordQuery>;
const pattern = (q: string) => `%${q.replace(/[\\%_]/g, "\\$&")}%`;
export const controlSelect = {
  id: true,
  number: true,
  title: true,
  project: true,
  performer: true,
  date: true,
  status: true,
  version: true,
  deletedAt: true,
  updatedAt: true,
  postedAt: true,
  customerId: true,
  projectId: true,
  lastOpenedAt: true,
  siteId: true,
  departmentId: true,
  createdBy: true,
  updatedBy: true,
} as const;
export async function listRecords(ctx: Context, p: RecordQuery) {
  const parts: Prisma.Sql[] = [
    Prisma.sql`"organizationId"=${ctx.organizationId}`,
    p.trash === "true"
      ? Prisma.sql`"deletedAt" IS NOT NULL`
      : Prisma.sql`"deletedAt" IS NULL`,
  ];
  const controls = p.kind === "controls";
  if (p.q)
    parts.push(
      controls
        ? Prisma.sql`concat_ws(' ',"number"::text,title,project,performer,date,data::text) ILIKE ${pattern(p.q)}`
        : Prisma.sql`concat_ws(' ',name,company,address,"postalCode",city,email,phone,mobile,notes) ILIKE ${pattern(p.q)}`,
    );
  if (controls) {
    if (p.from) parts.push(Prisma.sql`date>=${p.from}`);
    if (p.to) parts.push(Prisma.sql`date<=${p.to}`);
    if (p.status === "POSTED") parts.push(Prisma.sql`"postedAt" IS NOT NULL`);
    else if (p.status !== "ALL") parts.push(Prisma.sql`status=${p.status}`);
    if (p.customerId) parts.push(Prisma.sql`"customerId"=${p.customerId}`);
    if (p.creator === "MINE") parts.push(Prisma.sql`"createdBy"=${ctx.user.id}`);
    if (p.siteId) parts.push(Prisma.sql`"siteId"=${p.siteId}`);
    if (p.departmentId) parts.push(Prisma.sql`"departmentId"=${p.departmentId}`);
  }
  const table = Prisma.raw(controls ? '"Control"' : '"Customer"');
  const where = Prisma.join(parts, " AND ");
  const sort = controls
    ? {
        updated: '"updatedAt"',
        number: "number",
        name: "title",
        date: "date",
        performer: "performer",
        email: "title",
        address: "title",
      }[p.sort]
    : {
        updated: '"updatedAt"',
        number: "id",
        name: "name",
        date: '"createdAt"',
        performer: "name",
        email: "email",
        address: "address",
      }[p.sort];
  const order = Prisma.raw(
    `${sort} ${p.direction === "asc" ? "ASC" : "DESC"}, id ASC`,
  );
  return prisma.$transaction(
    async (tx) => {
      const counts = await tx.$queryRaw<
        { total: number }[]
      >`SELECT COUNT(*)::int as total FROM ${table} WHERE ${where}`;
      const total = counts[0].total;
      const pages = Math.max(1, Math.ceil(total / p.limit));
      const page = Math.min(p.page, pages);
      const ids = await tx.$queryRaw<
        { id: string }[]
      >`SELECT id FROM ${table} WHERE ${where} ORDER BY ${order} LIMIT ${p.limit} OFFSET ${(page - 1) * p.limit}`;
      if (controls) {
        const controlsWithCompletion = await tx.control.findMany({
          where: {
            id: { in: ids.map((i) => i.id) },
            organizationId: ctx.organizationId,
          },
          select: {
            ...controlSelect,
            data: true,
            _count: { select: { attachments: true } },
            site: { select: { name: true } },
            department: { select: { name: true } },
          },
        });
        const authorIds = [
          ...new Set(
            controlsWithCompletion.flatMap((control) => [
              control.createdBy,
              control.updatedBy,
            ]),
          ),
        ];
        const authors = await tx.user.findMany({
          where: { id: { in: authorIds } },
          select: { id: true, name: true, email: true },
        });
        const authorById = new Map(
          authors.map((author) => [author.id, author.name || author.email]),
        );
        const rows = controlsWithCompletion.map(
          ({ data, _count, createdBy, updatedBy, site, department, ...control }) => {
            const completion = validateForCompletion(normalizeControl(data), {
              attachmentCount: _count.attachments,
            });
            return {
              ...control,
              createdByName: authorById.get(createdBy) || "Okänd användare",
              updatedByName: authorById.get(updatedBy) || "Okänd användare",
              siteName: site?.name ?? null,
              departmentName: department?.name ?? null,
              completion: {
                complete: completion.complete,
                errors: completion.errors.length,
                warnings: completion.warnings.length,
                percent: completion.progress.percent,
              },
            };
          },
        );
        return {
          items: ids.map((item) => rows.find((row) => row.id === item.id)!),
          total,
          page,
          pages,
          limit: p.limit,
        };
      }
      const customerIds = ids.map((i) => i.id);
      // The register shows all of a customer's work (Daniel 2026-09-26), counted only for modules the member may read.
      const may = (subject: "projects" | "kfid" | "work-order" | "risk-assessment") => ctx.admin || hasWorkflowPermission(ctx.workflowPermissions, subject, "read");
      const [rows, projectCounts, taskCounts] = await Promise.all([
        tx.customer.findMany({
          where: { id: { in: customerIds }, organizationId: ctx.organizationId },
          include: { _count: { select: { controls: { where: { deletedAt: null } } } } },
        }),
        may("projects") ? tx.project.groupBy({ by: ["customerId"], where: { organizationId: ctx.organizationId, customerId: { in: customerIds } }, _count: { _all: true } }) : Promise.resolve([]),
        tx.workflowTask.groupBy({ by: ["customerId", "kind"], where: { organizationId: ctx.organizationId, customerId: { in: customerIds } }, _count: { _all: true } }),
      ]);
      const taskCount = (customerId: string, kind: "WORK_ORDER" | "RISK_ASSESSMENT") => taskCounts.find((row) => row.customerId === customerId && row.kind === kind)?._count._all ?? 0;
      const work = (customerId: string, controls: number) => ({
        projects: may("projects") ? projectCounts.find((row) => row.customerId === customerId)?._count._all ?? 0 : null,
        workOrders: may("work-order") ? taskCount(customerId, "WORK_ORDER") : null,
        riskAssessments: may("risk-assessment") ? taskCount(customerId, "RISK_ASSESSMENT") : null,
        controls: may("kfid") ? controls : null,
      });
      return {
        items: ids.map((i) => rows.find((r) => r.id === i.id)!).map((row) => ({ ...row, work: work(row.id, row._count.controls) })),
        total,
        page,
        pages,
        limit: p.limit,
      };
    },
    { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead },
  );
}
