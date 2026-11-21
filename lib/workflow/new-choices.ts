/**
 * Fewer ways in (Fas 4A, 2026-10-08): the same few choices wherever new work is started, so nothing changes
 * meaning by page. A work order is created from the menu, the project page (Nytt jobb) and follow-ups (Nästa steg, a
 * deviation row, a work order's Uppgifter); the mobile bar's "Ny" always offers the same chooser, and Uppgift starts with
 * which work order (Arbetsordern styr, 2026-10-26). Display only: what the
 * person may create comes from their permissions, and the server decides every save again.
 */
import { taskDeviations } from "@/lib/ai/proposals";

/**
 * The permission areas behind "Ny uppgift" (a work order has its own choice, so it is not one of them). The menu, the
 * mobile bar and the overview's button all read this list, so no surface offers what another hides (simulation 0.6.4).
 */
export const NEW_TASK_SUBJECTS = ["kfid", "risk-assessment", "forms"] as const;

export type NewChoice = { key: "work-order" | "task" | "project" | "customer" | "quote" | "purchase" | "round" | "link" | "deviation" | "absence"; label: string; href?: string };

const query = (params: Record<string, string | null | undefined>) => {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) if (value) search.set(key, value);
  return `/?${search.toString()}`;
};

/**
 * The mobile bar's and the level-1 tab bar's "Ny": Arbetsorder / Uppgift / Projekt, and since plan 1A (
 * 2026-10-11) Kund and Offert beside them, each only when the person may create it, in that order. Offert needs the
 * right Offerter and exists only in Cloud and the demo (the caller passes `quote: false` in Local), as in the menu.
 */
export function mobileNewChoices(can: { workOrder: boolean; task: boolean; project: boolean; customer?: boolean; quote?: boolean }): NewChoice[] {
  return [
    can.workOrder ? { key: "work-order" as const, label: "Arbetsorder", href: "/?view=workflow_task&taskType=WORK_ORDER" } : null,
    can.task ? { key: "task" as const, label: "Uppgift", href: "/?view=new_task" } : null,
    can.project ? { key: "project" as const, label: "Projekt", href: "/?view=new_project" } : null,
    can.customer ? { key: "customer" as const, label: "Kund", href: "/?view=customers&new=1" } : null,
    can.quote ? { key: "quote" as const, label: "Offert", href: "/?view=quote" } : null,
  ].filter((choice) => choice !== null);
}

/**
 * The level-1 Ny sheet (2026-10-18, decision 10): every "Ny ..." the desktop menu has and the person may make –
 * the mobile bar's choices plus Driftrond (after Uppgift) and Inköp (last). The phone's quickest steps (2026-11-01): Avvikelse and
 * Frånvaro right after the jobs, where one looks first when something happens or one is ill. Everyone may report a deviation
 * and their own absence; Frånvaro needs the company's database (`absence`). Display only; the server decides every save.
 */
export function nativeNewChoices(can: Parameters<typeof mobileNewChoices>[0] & { round?: boolean; purchase?: boolean; deviation?: boolean; absence?: boolean }): NewChoice[] {
  const quick: NewChoice[] = [
    ...(can.deviation ? [{ key: "deviation" as const, label: "Avvikelse", href: "/?view=deviations&new=1" }] : []),
    ...(can.absence ? [{ key: "absence" as const, label: "Frånvaro", href: "/?view=stats&tab=me&absence=new" }] : []),
  ];
  const jobs = mobileNewChoices(can);
  const afterJobs = jobs.filter((choice) => choice.key === "work-order" || choice.key === "task").length;
  const base = [...jobs.slice(0, afterJobs), ...quick, ...jobs.slice(afterJobs)];
  const round: NewChoice[] = can.round ? [{ key: "round", label: "Driftrond", href: "/?view=rounds&new=1" }] : [];
  const purchase: NewChoice[] = can.purchase ? [{ key: "purchase", label: "Inköp", href: "/?view=purchase" }] : [];
  const at = base.findIndex((choice) => choice.key === "project");
  return [...base.slice(0, at >= 0 ? at : base.length), ...round, ...base.slice(at >= 0 ? at : base.length), ...purchase];
}

/**
 * A yrkesprofil's choices first, in its order; everything else follows as it stood, so nothing is left out. Only reorders what
 * the person may create already: display only.
 */
export function orderNewChoices<T extends { key: string }>(choices: readonly T[], first: readonly string[] = []): T[] {
  const rank = (choice: T) => { const at = first.indexOf(choice.key); return at < 0 ? first.length : at; };
  return [...choices].map((choice, index) => ({ choice, index })).sort((left, right) => rank(left.choice) - rank(right.choice) || left.index - right.index).map(({ choice }) => choice);
}

/**
 * The project page's "Nytt jobb" (Arbetsordern styr, 2026-10-26): Ny arbetsorder / Ny uppgift with the project and its
 * customer and place filled in – Ny uppgift first asks which of the project's work orders the task goes into – and Flytta
 * arbetsorder hit (opens the project's move page, so it has no address; the work order's tasks follow it). "Koppla
 * befintlig uppgift" is gone: a task follows its work order.
 */
export function projectJobChoices(project: { id: string; customerId?: string | null; facilityId?: string | null }, can: { workOrder: boolean; task: boolean; link: boolean }): NewChoice[] {
  const context = { projectId: project.id, customerId: project.customerId, facilityId: project.facilityId };
  return [
    can.workOrder ? { key: "work-order" as const, label: "Ny arbetsorder", href: query({ view: "workflow_task", taskType: "WORK_ORDER", ...context }) } : null,
    can.task ? { key: "task" as const, label: "Ny uppgift", href: query({ view: "new_task", ...context }) } : null,
    can.link && can.workOrder ? { key: "link" as const, label: "Flytta arbetsorder hit" } : null,
  ].filter((choice) => choice !== null);
}

/**
 * "Skapa arbetsorder" in a protocol's or risk assessment's header is a follow-up of a deviation: shown only for a saved
 * task that is not itself a work order and has something to act on (the same rules Workflow AI's proposal uses).
 * Without a deviation a work order is started from the menu or the project; after completion Nästa steg offers it.
 */
/** The header's follow-up button (kundresa 2026-11-07, M21: "Skapa arbetsorder" read as moving the protocol). */
export const FOLLOW_UP_ORDER_LABEL = "Ny arbetsorder för felet";

export function headerWorkOrderShown(task: { id?: string | null; kind: string; data?: unknown }) {
  return Boolean(task.id) && task.kind !== "WORK_ORDER" && taskDeviations(task as Parameters<typeof taskDeviations>[0]).length > 0;
}

/** Ny uppgift opened from a work order says where the task goes; the title is only what the link carried. */
export function linkedTaskNotice(workOrderTitle?: string | null) {
  const title = workOrderTitle?.trim().slice(0, 120);
  return title ? `Uppgiften läggs i arbetsorder ${title}.` : "Uppgiften läggs i arbetsordern.";
}
