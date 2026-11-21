import { Prisma } from "@prisma/client";

/**
 * Underhåll (2026-10-30) in the work lists' SQL: a work order's priority is the highest priority of the open
 * maintenance items it holds (the facts moved off the order to the items). For a query whose work order alias is `t`;
 * bound to the order's own company, read through the index (organizationId, workOrderId). Null when it holds none.
 */
export const workOrderPrioritySql = Prisma.sql`(select case min(case i.priority when 'URGENT' then 0 when 'HIGH' then 1 when 'NORMAL' then 2 when 'LOW' then 3 end)
    when 0 then 'URGENT' when 1 then 'HIGH' when 2 then 'NORMAL' when 3 then 'LOW' end
  from "MaintenanceItem" i where i."organizationId" = t."organizationId" and i."workOrderId" = t.id and i.status = 'OPEN')`;

/** The work list's filters (Mina arbetsordrar): an item the order holds has the type, and one has the priority. */
export function workOrderItemFilterSql(filter: { mtype?: string; priority?: string }) {
  const item = (column: "type" | "priority", value: string) =>
    Prisma.sql`and exists (select 1 from "MaintenanceItem" i where i."organizationId" = t."organizationId" and i."workOrderId" = t.id and i.${Prisma.raw(`"${column}"`)} = ${value})`;
  return Prisma.sql`${filter.mtype ? item("type", filter.mtype) : Prisma.empty} ${filter.priority ? item("priority", filter.priority) : Prisma.empty}`;
}
