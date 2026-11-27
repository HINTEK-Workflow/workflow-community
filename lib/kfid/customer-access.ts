import { hasWorkflowPermission, type WorkflowPermissionProfile } from "@/lib/workflow/permissions";

/**
 * Kundväljaren utan Kunder (2026-10-24, analysens fråga 1: "Ja, men utan anteckningar"): a member without Kunder
 * (customers:read) still picks a customer when a job is made, and gets what the job needs – name, company, address,
 * contact details and places – but never the register's own notes: Anteckningar, Särskilda krav or the customer number in
 * the accounting. The server decides; the client is never trusted to hide them.
 */
export const REGISTER_ONLY_CUSTOMER_FIELDS = ["notes", "specialRequirements", "accountingCustomerNumber"] as const;

/** True when the member may read the whole customer register (Kunder), i.e. the register's own notes too. */
export function mayReadCustomerRegister(ctx: { admin: boolean; workflowPermissions: WorkflowPermissionProfile }) {
  return ctx.admin || hasWorkflowPermission(ctx.workflowPermissions, "customers", "read");
}

/** The customer as the member may see it: unchanged with Kunder, without the register's notes otherwise (blank strings). */
export function customerForMember<T extends object>(ctx: { admin: boolean; workflowPermissions: WorkflowPermissionProfile }, customer: T): T {
  if (mayReadCustomerRegister(ctx)) return customer;
  const visible = { ...customer } as Record<string, unknown>;
  for (const field of REGISTER_ONLY_CUSTOMER_FIELDS) if (field in visible) visible[field] = "";
  return visible as T;
}
