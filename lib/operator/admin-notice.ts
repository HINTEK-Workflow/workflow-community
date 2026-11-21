import type { TaskNotification } from "@/lib/workflow/task-notifications";
import { workflowTaskHref } from "@/lib/workflow/work-order-link";

/**
 * "Nytt operatörskonto" i klockan (2026-10-30): a member of the company's Microsoft group signed in on the operator
 * page for the first time and got an account that sees no machines. The company's admins are told until someone chooses
 * the account's machines (or blocks or removes it). No table of its own: the notice is the state itself. Needs action, so
 * it also goes by e-mail or push to an admin who chose "Uppgifter som behöver åtgärdas".
 */
export const OPERATOR_NOTICE_PREFIX = "OPERATOR_NEW:";
export const OPERATOR_ADMIN_HREF = "/?view=operator_accounts";
/** The new account's own page, where its machines are chosen. */
export const operatorAccountHref = (id: string) => `${OPERATOR_ADMIN_HREF}&account=${encodeURIComponent(id)}`;

export function operatorNotifications(accounts: readonly { id: string; name: string; createdAt: Date }[]): TaskNotification[] {
  return accounts.map((account) => ({
    id: `${OPERATOR_NOTICE_PREFIX}${account.id}`,
    title: `Nytt operatörskonto: ${account.name.replace(/[\r\n]+/g, " ").slice(0, 80)}`,
    kind: "OPERATOR" as const,
    detail: "Loggade in via Microsoft. Välj vilka maskiner kontot ser.",
    href: operatorAccountHref(account.id),
    dueDate: "", deadline: null, needsAction: true,
    assignedAt: account.createdAt.toISOString(),
  }));
}

/**
 * "Ny felanmälan" i klockan (användartest 2026-10-31, A2): a fault report from the operator page that became a work order
 * nobody has taken yet is told to the company's admins and to the machine's alarm contacts (ansvarig, ersättare), whatever
 * its severity – Akut and Hög already reach the on-call person, so those are left to that path. Like the account notice, no
 * table of its own: the notice is the state, and it goes when someone becomes responsible or the order is closed. It needs
 * action, so it also goes by e-mail or push to whoever chose "Uppgifter som behöver åtgärdas".
 */
export const FAULT_NOTICE_PREFIX = "OPERATOR_FAULT:";
/** How long an untaken fault report is told. */
export const FAULT_NOTICE_DAYS = 14;

export function faultReportNotifications(reports: readonly { id: string; taskId: string; label: string; cause: string; machineLabel: string; createdAt: Date }[]): TaskNotification[] {
  const line = (value: string, max: number) => value.replace(/[\r\n]+/g, " ").slice(0, max);
  return reports.map((report) => ({
    id: `${FAULT_NOTICE_PREFIX}${report.id}`,
    title: `Ny felanmälan${report.label ? ` ${report.label}` : ""}: ${line(report.cause, 60)} – ${line(report.machineLabel, 80)}`,
    kind: "OPERATOR" as const,
    detail: "Från operatörssidan. Ingen ansvarig ännu – öppna arbetsordern och välj ansvarig.",
    href: workflowTaskHref({ id: report.taskId, kind: "WORK_ORDER" }),
    dueDate: "", deadline: null, needsAction: true,
    assignedAt: report.createdAt.toISOString(),
  }));
}
