import { Prisma } from "@prisma/client";
import { z } from "zod";
import { prisma } from "@/lib/db";
import type { Context } from "./server";
import { hasWorkflowPermission } from "@/lib/workflow/permissions";
import { customerForMember, mayReadCustomerRegister } from "./customer-access";
import { CUSTOMER_FILTERS } from "./customer-list";
import { customerTitleSql } from "./customer-name";
/** The customer register's list query (the older controls' archive is gone with its editor, 2026-10-06). */
export const recordQuery = z.object({
  kind: z.literal("customers").default("customers"),
  q: z.string().trim().max(200).default(""),
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
  // Kundtyp, the chips of the list's toppvisning (2026-10-31); counts=1 also answers how many there are of each.
  type: z.enum(CUSTOMER_FILTERS).default("all"),
  counts: z.enum(["1"]).optional(),
});
export type RecordQuery = z.infer<typeof recordQuery>;
const pattern = (q: string) => `%${q.replace(/[\%_]/g, "\$&")}%`;
export async function listRecords(ctx: Context, p: RecordQuery) {
  const parts: Prisma.Sql[] = [
    Prisma.sql`"organizationId"=${ctx.organizationId}`,
    p.trash === "true"
      ? Prisma.sql`"deletedAt" IS NOT NULL`
      : Prisma.sql`"deletedAt" IS NULL`,
    // Eget företag (2026-10-24): the company's own record is never one of the customers in the register.
    Prisma.sql`"ownCompany" = false`,
  ];
  // Without Kunder the search never looks in the register's own notes (2026-10-24), so they cannot be probed.
  if (p.q)
    parts.push(mayReadCustomerRegister(ctx)
      ? Prisma.sql`concat_ws(' ',name,company,address,"postalCode",city,email,phone,mobile,notes,"specialRequirements") ILIKE ${pattern(p.q)}`
      : Prisma.sql`concat_ws(' ',name,company,address,"postalCode",city,email,phone,mobile) ILIKE ${pattern(p.q)}`);
  // The chips count every customer the search finds, in the same transaction as the list, never only the page.
  const everyType = Prisma.join(parts, " AND ");
  const where = p.type === "all" ? everyType : Prisma.join([...parts, Prisma.sql`"customerType"::text = ${p.type}`], " AND ");
  const sort = {
    updated: '"updatedAt"',
    number: "id",
    // Namn A–Ö follows the heading a person sees: the company for a Företag (2026-11-01, beslut 18).
    name: customerTitleSql(),
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
      >`SELECT COUNT(*)::int as total FROM "Customer" WHERE ${where}`;
      const total = counts[0].total;
      const byType = p.counts ? await tx.$queryRaw<{ type: string; total: number }[]>`SELECT "customerType"::text AS type, COUNT(*)::int AS total FROM "Customer" WHERE ${everyType} GROUP BY 1` : null;
      const pages = Math.max(1, Math.ceil(total / p.limit));
      const page = Math.min(p.page, pages);
      const ids = await tx.$queryRaw<
        { id: string }[]
      >`SELECT id FROM "Customer" WHERE ${where} ORDER BY ${order} LIMIT ${p.limit} OFFSET ${(page - 1) * p.limit}`;
      const customerIds = ids.map((i) => i.id);
      // The register shows a customer's work (2026-09-26), counted only for modules the member may read.
      const may = (subject: "projects" | "work-order" | "risk-assessment") => ctx.admin || hasWorkflowPermission(ctx.workflowPermissions, subject, "read");
      const [rows, projectCounts, taskCounts] = await Promise.all([
        tx.customer.findMany({
          where: { id: { in: customerIds }, organizationId: ctx.organizationId },
        }),
        may("projects") ? tx.project.groupBy({ by: ["customerId"], where: { organizationId: ctx.organizationId, customerId: { in: customerIds } }, _count: { _all: true } }) : Promise.resolve([]),
        tx.workflowTask.groupBy({ by: ["customerId", "kind"], where: { organizationId: ctx.organizationId, customerId: { in: customerIds } }, _count: { _all: true } }),
      ]);
      const taskCount = (customerId: string, kind: "WORK_ORDER" | "RISK_ASSESSMENT") => taskCounts.find((row) => row.customerId === customerId && row.kind === kind)?._count._all ?? 0;
      const work = (customerId: string) => ({
        projects: may("projects") ? projectCounts.find((row) => row.customerId === customerId)?._count._all ?? 0 : null,
        workOrders: may("work-order") ? taskCount(customerId, "WORK_ORDER") : null,
        riskAssessments: may("risk-assessment") ? taskCount(customerId, "RISK_ASSESSMENT") : null,
      });
      return {
        items: ids.map((i) => rows.find((r) => r.id === i.id)!).map((row) => ({ ...customerForMember(ctx, row), work: work(row.id) })),
        total,
        page,
        pages,
        limit: p.limit,
        ...(byType ? { counts: { all: byType.reduce((sum, row) => sum + row.total, 0), COMPANY: byType.find((row) => row.type === "COMPANY")?.total ?? 0, PRIVATE: byType.find((row) => row.type === "PRIVATE")?.total ?? 0 } } : {}),
      };
    },
    { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead },
  );
}
