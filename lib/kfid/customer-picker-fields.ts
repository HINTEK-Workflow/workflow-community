import { hasWorkflowPermission, type WorkflowPermissionProfile } from "@/lib/workflow/permissions";

/**
 * Kundväljaren utan Kunder (2026-10-24): a member without Kunder (customers:read) picks a customer when a job is
 * made and gets what the picker and the job need – name, company, address, contact details – but never the register
 * itself: no notes, no special requirements, no customer number in the accounting and no counts of the customer's work.
 * The register's page needs Kunder (features/kfid/workspace.tsx), and its list API (app/api/records) answers a member
 * without Kunder only with these fields, at most a picker's page of them. The server decides; the client hides nothing.
 */
export const PICKER_CUSTOMER_FIELDS = ["id", "name", "company", "address", "postalCode", "city", "email", "phone", "mobile", "lat", "lng", "customerType", "ownCompany", "version", "deletedAt"] as const;
/** The register's own fields, sent blank to the picker so a client that reads them finds an empty text. */
export const REGISTER_CUSTOMER_FIELDS = ["notes", "specialRequirements", "accountingCustomerNumber"] as const;
/** The most a member without Kunder gets in one answer: the picker shows 20. */
export const PICKER_PAGE_LIMIT = 20;
/** The most customers a choice in a form gets at once without Kunder, however large a limit is asked for; a search reaches the rest. */
export const PICKER_CHOICE_LIMIT = 25;
/** The rights that make or change a job or a project, where a customer is picked. */
const PICKING_SUBJECTS = ["work-order", "kfid", "risk-assessment", "forms", "projects"] as const;

/** Whether the person may use the customer picker without Kunder (beslut 10): only someone who can make or change a job, a project or a quote. */
export function mayPickCustomer(ctx: { admin: boolean; workflowPermissions: WorkflowPermissionProfile }) {
  if (ctx.admin || hasWorkflowPermission(ctx.workflowPermissions, "quotes", "edit")) return true;
  return PICKING_SUBJECTS.some((subject) => hasWorkflowPermission(ctx.workflowPermissions, subject, "create") || hasWorkflowPermission(ctx.workflowPermissions, subject, "edit"));
}

/** True when the person may read the customer register (Kunder): an admin, or the right customers:read. */
export function readsCustomerRegister(ctx: { admin: boolean; workflowPermissions: WorkflowPermissionProfile }) {
  return ctx.admin || hasWorkflowPermission(ctx.workflowPermissions, "customers", "read");
}

/** A customer row as the picker may get it: only the picker's fields, the register's own blank, nothing else. */
export function pickerCustomer(row: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const field of PICKER_CUSTOMER_FIELDS) if (field in row) out[field] = row[field];
  for (const field of REGISTER_CUSTOMER_FIELDS) out[field] = "";
  return out;
}

/** A customer as someone who only may read a job there gets it: who it is, no way to reach them and nothing from the register. */
const CONTACT_FIELDS = ["address", "postalCode", "city", "email", "phone", "mobile"] as const;
export function customerReference(row: Record<string, unknown>): Record<string, unknown> {
  const out = pickerCustomer(row);
  for (const field of CONTACT_FIELDS) out[field] = "";
  delete out.lat; delete out.lng;
  return out;
}

/** The fields the picker's search may match on: never the register's notes, so a search cannot probe them. */
const SEARCHED = ["name", "company", "address", "postalCode", "city", "email", "phone", "mobile"] as const;
export function pickerMatches(row: Record<string, unknown>, q: string): boolean {
  const needle = q.trim().toLocaleLowerCase("sv-SE");
  if (!needle) return true;
  return SEARCHED.map((field) => row[field]).filter((value) => typeof value === "string").join(" ").toLocaleLowerCase("sv-SE").includes(needle);
}

/**
 * The register's list answer as a member without Kunder may get it: the rows that match on the picker's own fields, each
 * with only those fields, and no total that would count matches in the notes.
 */
export function pickerAnswer<T extends Record<string, unknown>>(answer: { items: T[]; limit: number }, q: string) {
  const items = answer.items.filter((row) => pickerMatches(row, q)).slice(0, PICKER_PAGE_LIMIT).map(pickerCustomer);
  return { items, total: items.length, page: 1, pages: 1, limit: Math.min(answer.limit, PICKER_PAGE_LIMIT) };
}
