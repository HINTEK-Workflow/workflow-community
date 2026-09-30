import { Prisma } from "@prisma/client";
import { readableTaskScope, type WorkflowPermissionSubject } from "./permissions";

/**
 * List filters for the tasks a member may read (2026-09-27): work orders and risk assessments by kind, and
 * protocols by the permission area of their form, so a control or risk assessment built as a form follows the same
 * permission as before. A protocol without an area belongs to Formulär.
 */
export function readableTaskWhere(can: (subject: WorkflowPermissionSubject) => boolean): Prisma.WorkflowTaskWhereInput {
  const { kinds, areas } = readableTaskScope(can);
  const or: Prisma.WorkflowTaskWhereInput[] = [];
  if (kinds.length) or.push({ kind: { in: kinds } });
  if (areas.length) or.push({ kind: "FORM", formArea: { in: areas } });
  if (areas.includes("forms")) or.push({ kind: "FORM", formArea: null });
  return or.length ? { OR: or } : { id: { in: [] } };
}

/** The same filter for raw SQL on a WorkflowTask table alias such as `t`. */
export function readableTaskSql(can: (subject: WorkflowPermissionSubject) => boolean, alias = "t"): Prisma.Sql {
  const { kinds, areas } = readableTaskScope(can);
  const table = Prisma.raw(`"${alias.replace(/[^a-z]/gi, "")}"`);
  const parts: Prisma.Sql[] = [];
  if (kinds.length) parts.push(Prisma.sql`${table}.kind in (${Prisma.join(kinds)})`);
  if (areas.length) parts.push(Prisma.sql`(${table}.kind = 'FORM' and coalesce(${table}."formArea", 'forms') in (${Prisma.join(areas)}))`);
  return parts.length ? Prisma.sql`(${Prisma.join(parts, " or ")})` : Prisma.sql`false`;
}
