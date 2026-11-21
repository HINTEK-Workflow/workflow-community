/**
 * Arbetsordern styr (2026-10-26, replaces "Hör till arbetsorder" and "fristående uppgift" of 2026-10-08; changed
 * 2026-10-27, "uppgifter får skapas först"): a task – a protocol, a control or a risk assessment – may be made first and
 * saved as a draft (Planerad, nothing filled in, no time) without a work order, but it is linked to one before the work
 * starts: starting the time, filling in, signing or completing the protocol, reporting an obstacle or any status but
 * Planerad needs the link (the database refuses it too, migration 20261027120000_task_draft_round_holder). A work order
 * holds one or more tasks and never belongs to another work order. A linked task may only be moved to another work order,
 * never let go.
 *
 * Arbetsordern som hållare (2026-10-30, replaces "the task's own responsible person, Klart senast and place" of
 * 2026-10-26): the work order HOLDS Grunduppgifter and Riskbedömning, and a linked task shows and edits the same data – it
 * never has a responsible person, place, project, customer or dates of its own (another place is a new work order). Only
 * its title (and the protocol itself) is its own. A round's work order (punkt 3, 2026-10-27) keeps its occurrences' own
 * days, so its tasks take everything but the dates.
 *
 * Time is recorded only on a work order or a project (`WorkflowTimeEntry.taskId` of a WORK_ORDER, or `projectId`), never
 * on a task of its own: time started or written in a task lands on its work order and remembers the task it was reported
 * from (`sourceTaskId`, so a round occurrence keeps its own time), and the page says so.
 *
 * The rules here are shared by Cloud (lib/kfid/work-order-link-server.ts, with database constraints behind it), Local and
 * the demo, and by the pages, which offer only what the rules allow.
 */

export type WorkOrderLinkTask = { id?: string | null; kind: string; projectId: string | null; customerId: string | null; facilityId?: string | null; workOrderId?: string | null;
  assignedToUserId?: string | null; assignedToName?: string; plannedStartDate?: string | null; dueDate?: string };
/**
 * The work order a task is linked to. The responsible person and the dates are optional: a caller that read them (the
 * server, Local, the demo, the page) passes them and the task takes them; one that did not leaves the task's as they are.
 */
export type WorkOrderLinkTarget = { id: string; kind: string; title?: string; status: string; projectId: string | null; customerId: string | null; facilityId?: string | null;
  assignedToUserId?: string | null; assignedToName?: string; plannedStartDate?: string | null; dueDate?: string; roundScheduleId?: string | null };

/** The fields of Grunduppgifter a linked task always shares with its work order (2026-10-30). */
export const SHARED_BASIC_KEYS = ["projectId", "customerId", "facilityId", "assignedToUserId", "assignedToName", "plannedStartDate", "dueDate"] as const;
export type SharedBasicKey = (typeof SHARED_BASIC_KEYS)[number];
export type SharedBasicShown = Exclude<SharedBasicKey, "assignedToName">;
/** The words for each shared field, for the difference shown before a draft is linked. */
export const SHARED_BASIC_LABELS: Record<SharedBasicShown, string> = { projectId: "Projekt", customerId: "Kund", facilityId: "Plats", assignedToUserId: "Ansvarig", plannedStartDate: "Start", dueDate: "Klart senast" };

/** The line on a task's shared panels: "Hör till arbetsorder X – ändras på båda ställena." */
export const holderLine = (title: string) => `Hör till arbetsorder ${title.trim() || "(utan rubrik)"} – ändras på båda ställena.`;
/** The toast after a draft got its new work order. */
export const WORK_ORDER_CREATED_FROM_DRAFT = "Arbetsordern är skapad och uppgiften ligger i den.";

/** The text when work would start on a task without a work order (Cloud, Local, the demo, API and MCP say the same). */
export const WORK_ORDER_REQUIRED = "Koppla uppgiften till en arbetsorder innan arbetet påbörjas.";
/** The text when a linked task would be let go of its work order. */
export const WORK_ORDER_KEPT = "Uppgiften ligger i en arbetsorder. Den kan flyttas till en annan arbetsorder men inte tas ur den.";

/**
 * A browser draft brought back (a closed tab, Koppla till arbetsorder leaving the page) never takes the task out of the
 * work order it has now – the saved one, or for a new task the one in the address (testflöde 2026-10-31: a new control came
 * back as a restored draft without its work order and was saved so). `fromAddress`: a new task's work order is the
 * address's, also over a draft that named another; a saved task keeps a move the draft made.
 */
export function draftKeepsWorkOrder<T extends { workOrderId?: string | null }>(restored: T, now: string | null | undefined, { fromAddress = false }: { fromAddress?: boolean } = {}): T {
  if (!now || restored.workOrderId === now) return restored;
  return fromAddress || !restored.workOrderId ? { ...restored, workOrderId: now } : restored;
}
/** The words in lists and on the task when the link is missing. */
export const WORK_ORDER_MISSING_LABEL = "Saknar arbetsorder";

/**
 * Utkast (2026-10-27): the statuses a task without a work order may have – Planerad (nothing started) and Utgår (a
 * draft that will not be done). Everything else means the work has started.
 */
export const DRAFT_STATUSES = ["PLANNED", "CANCELLED"] as const;
export const isDraftStatus = (status: string) => (DRAFT_STATUSES as readonly string[]).includes(status);

/** What the input itself breaks, before anything is read: a work order is never linked, and a task never to itself. */
export function workOrderLinkShapeError(task: Pick<WorkOrderLinkTask, "id" | "kind" | "workOrderId">): string | null {
  if (!task.workOrderId) return null;
  if (task.kind === "WORK_ORDER") return "En arbetsorder kan inte höra till en annan arbetsorder.";
  if (task.id && task.workOrderId === task.id) return "En uppgift kan inte höra till sig själv.";
  return null;
}

/** A task (anything but a work order) without a work order: a draft, shown with "Saknar arbetsorder" and Koppla till arbetsorder. */
export const taskNeedsWorkOrder = (task: Pick<WorkOrderLinkTask, "kind" | "workOrderId">) => task.kind !== "WORK_ORDER" && !task.workOrderId;

/**
 * Whether a task without a work order may be saved as it is: only as a draft – Planerad or Utgår (`status`, when known)
 * and nothing filled in (`documented`, when known). Returns the refusal, or null.
 */
export function workOrderRequiredError(task: Pick<WorkOrderLinkTask, "kind" | "workOrderId"> & { status?: string; documented?: boolean }): string | null {
  if (!taskNeedsWorkOrder(task)) return null;
  if (task.status !== undefined && !isDraftStatus(task.status)) return WORK_ORDER_REQUIRED;
  return task.documented ? WORK_ORDER_REQUIRED : null;
}

/**
 * Grunduppgifter är gemensamma (2026-10-30): a linked task always has its work order's project, customer, place,
 * responsible person, Start and Klart senast – the same data, shown and edited in the work order and in each task. The
 * responsible person and the dates are taken when the caller read them (see WorkOrderLinkTarget); a round's work order keeps
 * its occurrences' own days. A work order without a customer gives its tasks no customer and no place. A draft without a
 * work order keeps what it has; a work order itself is never changed. (`isNew` is kept for the callers.)
 */
export function inheritFromWorkOrder<T extends WorkOrderLinkTask>(task: T, workOrder: WorkOrderLinkTarget | null | undefined, options: { isNew: boolean }): T {
  void options;
  if (!workOrder || !task.workOrderId || task.kind === "WORK_ORDER") return task;
  const customerId = workOrder.customerId;
  const next: T = { ...task, projectId: workOrder.projectId, customerId, facilityId: customerId ? workOrder.facilityId ?? null : null };
  if (workOrder.assignedToUserId !== undefined) Object.assign(next, { assignedToUserId: workOrder.assignedToUserId ?? null, assignedToName: workOrder.assignedToName ?? "" });
  if (!workOrder.roundScheduleId) {
    if (workOrder.plannedStartDate !== undefined) Object.assign(next, { plannedStartDate: workOrder.plannedStartDate ?? "" });
    if (workOrder.dueDate !== undefined) Object.assign(next, { dueDate: workOrder.dueDate });
  }
  return next;
}

/**
 * Koppla till arbetsorder (2026-10-30): the shared fields where a draft differs from the work order it is about to be
 * linked to – the page shows them before linking, so the person can cancel. Empty when nothing changes.
 */
export function sharedBasicsDifference(task: WorkOrderLinkTask, workOrder: WorkOrderLinkTarget): SharedBasicShown[] {
  const linked = inheritFromWorkOrder({ ...task, workOrderId: workOrder.id, kind: task.kind === "WORK_ORDER" ? "FORM" : task.kind }, workOrder, { isNew: false });
  const same = (a: unknown, b: unknown) => (a ?? "") === (b ?? "");
  return (Object.keys(SHARED_BASIC_LABELS) as SharedBasicShown[]).filter((key) => {
    if (key === "assignedToUserId") return !same(task.assignedToUserId, linked.assignedToUserId) || (!task.assignedToUserId && !same(task.assignedToName?.trim(), linked.assignedToName?.trim()));
    return !same(task[key], linked[key]);
  });
}

/**
 * Why the task cannot belong to the work order, or null. `changed` is whether the link is new or another order: a
 * completed or cancelled order takes no new tasks, but a task already in it stays there. `previousWorkOrderId` is the order
 * the saved task is in: it may be moved, never let go. A task without a work order passes as a draft; its status is
 * checked with workOrderRequiredError when it is given here or once the save knows it.
 */
export function workOrderLinkError(task: WorkOrderLinkTask & { status?: string; documented?: boolean }, workOrder: WorkOrderLinkTarget | null | undefined, { changed = true, previousWorkOrderId = null }: { changed?: boolean; previousWorkOrderId?: string | null } = {}): string | null {
  if (task.kind === "WORK_ORDER") return workOrderLinkShapeError(task);
  if (!task.workOrderId) return previousWorkOrderId ? WORK_ORDER_KEPT : workOrderRequiredError(task);
  const shape = workOrderLinkShapeError(task);
  if (shape) return shape;
  if (!workOrder || workOrder.id !== task.workOrderId || workOrder.kind !== "WORK_ORDER") return "Arbetsordern hittades inte.";
  if (changed && workOrder.status === "COMPLETED") return "Arbetsordern är färdigställd. Återöppna den innan du lägger till fler uppgifter i den.";
  if (changed && workOrder.status === "CANCELLED") return "Arbetsordern har utgått. Återuppta den innan du lägger till fler uppgifter i den.";
  if ((task.projectId ?? null) !== (workOrder.projectId ?? null)) return "Uppgiften har arbetsorderns projekt.";
  if ((task.customerId ?? null) !== (workOrder.customerId ?? null)) return "Uppgiften har arbetsorderns kund.";
  return null;
}

/**
 * En riskbedömning per arbete (2026-10-27, punkt 2): the full risk assessment is made and kept in the work order, so
 * a work order holds at most one risk assessment that has not been cancelled. `others` are the order's other risk
 * assessments. Returns the refusal (naming the one there is), or null.
 */
export function duplicateRiskAssessmentError(others: readonly { title: string; status: string }[]): string | null {
  const existing = others.find((item) => item.status !== "CANCELLED");
  return existing ? `Arbetsordern har redan en riskbedömning (”${existing.title.trim() || "Riskbedömning"}”). Öppna och uppdatera den i stället.` : null;
}

/** The work orders a task may be moved to: open ones (the server decides again). */
export function workOrderChoiceAllowed(task: Pick<WorkOrderLinkTask, "id" | "kind" | "projectId" | "customerId" | "facilityId">, option: WorkOrderLinkTarget) {
  const linked = inheritFromWorkOrder({ ...task, workOrderId: option.id }, option, { isNew: !task.id });
  return !workOrderLinkError(linked, option);
}

/**
 * Tid på arbetsordern: the work order a time entry or a timer of a task is recorded on – the task itself when it is the
 * work order. A draft without one falls back to itself (the persistence boundary refuses time on it).
 */
export const timeOwnerId = (task: { id: string; kind?: string; workOrderId?: string | null }) => task.kind === "WORK_ORDER" ? task.id : task.workOrderId || task.id;

/** The compact line in lists: "Arbetsorder: <title>". */
export const workOrderLinkLabel = (title: string) => `Arbetsorder: ${title.trim() || "(utan rubrik)"}`;

/** Where the task's time lands, said on the task's page ("Tiden räknas på arbetsorder X"). */
export const timeOnWorkOrderLabel = (title: string) => `Tiden räknas på arbetsorder ${title.trim() || "(utan rubrik)"}`;

/** The locked line at the top of a task's Grunduppgifter: "Arbetsorder X · Kund · Projekt Y". */
export function workOrderLockedLine(input: { workOrderTitle?: string | null; customerName?: string | null; projectName?: string | null }) {
  return [`Arbetsorder ${input.workOrderTitle?.trim() || "(utan rubrik)"}`, input.customerName?.trim() || "", input.projectName?.trim() ? `Projekt ${input.projectName.trim()}` : ""].filter(Boolean).join(" · ");
}

/** A project takes a work order, never a task of its own: the tasks follow their order (2026-10-26). */
export const PROJECT_LINK_WORK_ORDER_ONLY = "En uppgift följer sin arbetsorder. Flytta arbetsordern till projektet i stället.";

/**
 * The tasks of a work order after the order moved or its Grunduppgifter changed (2026-10-30: they are the same data):
 * those whose project, customer, place, responsible person or dates change, as they will be stored.
 */
export function tasksFollowingWorkOrder<T extends WorkOrderLinkTask & { id: string }>(order: WorkOrderLinkTarget, tasks: readonly T[]): T[] {
  return tasks.filter((task) => task.workOrderId === order.id && task.kind !== "WORK_ORDER").flatMap((task) => {
    const next = inheritFromWorkOrder(task, order, { isNew: false });
    return SHARED_BASIC_KEYS.every((key) => (next[key] ?? null) === (task[key] ?? null)) ? [] : [next];
  });
}

/** Whether a save of a work order changed any of the fields its tasks share (or the round it holds, which decides the dates). */
export function sharedBasicsChanged(before: WorkOrderLinkTask & { roundScheduleId?: string | null }, after: WorkOrderLinkTask & { roundScheduleId?: string | null }) {
  return SHARED_BASIC_KEYS.some((key) => (before[key] ?? null) !== (after[key] ?? null)) || (before.roundScheduleId ?? null) !== (after.roundScheduleId ?? null);
}

/** The link to open a task (or the work order) in its editor. */
export const workflowTaskHref = (task: { id: string; kind: string }) => `/?view=workflow_task&taskId=${encodeURIComponent(task.id)}&taskType=${encodeURIComponent(task.kind)}`;

/** "Lägg till uppgift" on the work order: Ny uppgift with the order and its project, customer and place filled in. */
// The order's title rides along only so Ny uppgift can say "Uppgiften läggs i arbetsorder X" (display only).
export function newLinkedTaskHref(workOrder: { id: string; projectId: string | null; customerId: string | null; facilityId?: string | null; title?: string | null }) {
  const params = new URLSearchParams({ view: "new_task", workOrderId: workOrder.id });
  if (workOrder.projectId) params.set("projectId", workOrder.projectId);
  if (workOrder.customerId) params.set("customerId", workOrder.customerId);
  if (workOrder.facilityId) params.set("facilityId", workOrder.facilityId);
  const title = workOrder.title?.trim().slice(0, 120);
  if (title) params.set("workOrderTitle", title);
  return `/?${params.toString()}`;
}

/** Bounded reads (2026-09-26): the choices of work orders and the order's Uppgifter. */
export const WORK_ORDER_OPTION_LIMIT = 50;
export const WORK_ORDER_LINK_LIST_LIMIT = 100;

/** A work order offered in a choice, as the server, Local and the demo send it. */
export type WorkOrderOption = WorkOrderLinkTarget & { title: string; projectName?: string; customerName?: string; /** ISO time the order was created, to tell apart orders with the same name. */ createdAt?: string };
/** A task in the order's Uppgifter. */
// `durationSec`: the time on the order reported from the task; `occurrence`: a round occurrence's day (2026-10-27).
export type LinkedTaskRow = { id: string; kind: string; title: string; status: string; progress: number; dueDate: string; assignedToName: string; durationSec?: number; occurrence?: string;
  /** A protocol's form (2026-11-20), so the row is named by what it is and not only by the place its title follows. */
  formName?: string };

/** The form a protocol was made from, or "" for anything else: read from the task's stored data. */
export function linkedTaskFormName(data: unknown): string {
  const value = data as { kind?: unknown; details?: { templateName?: unknown } } | null;
  return value?.kind === "FORM" && typeof value.details?.templateName === "string" ? value.details.templateName.trim() : "";
}

/**
 * A row in the work order's Uppgifter (2026-11-20): a protocol whose title follows a field (the place of a control) is named by its
 * form first, with its own title as the line under it; a title that already is the form's name, or a task without a form, stays.
 */
export function linkedTaskHeading(row: Pick<LinkedTaskRow, "title" | "formName">): { title: string; place: string } {
  const form = row.formName?.trim() ?? "";
  const title = row.title.trim();
  if (!form || form.toLocaleLowerCase("sv") === title.toLocaleLowerCase("sv")) return { title: title || form, place: "" };
  return { title: form, place: title };
}

/**
 * Färdigställ with tasks left in the order (2026-11-07, kundresan M6): allowed, but the completion dialog says how many are
 * not done – named, the first three – and asks for an explicit confirmation. A cancelled (Utgår) task is not left. Empty when none.
 */
export function openTasksWarning(rows: readonly Pick<LinkedTaskRow, "title" | "status">[], more = false): string {
  const open = rows.filter((row) => row.status !== "COMPLETED" && row.status !== "CANCELLED");
  if (!open.length) return "";
  const count = `${more ? "Minst " : ""}${open.length} ${open.length === 1 ? "uppgift" : "uppgifter"}`;
  const names = open.slice(0, 3).map((row) => `”${row.title.trim() || "Utan rubrik"}”`).join(", ");
  return `${count} i arbetsordern är inte klar${open.length === 1 ? "" : "a"}: ${names}${open.length > 3 ? ` och ${open.length - 3} till` : ""}.`;
}

/** The choice's query for Cloud and the demo: open orders (of the project, when the choice is made in one), plus the current one. */
export function workOrderOptionsQuery(task: { id?: string | null; projectId: string | null; customerId: string | null; workOrderId?: string | null }, q = "") {
  const params = new URLSearchParams();
  if (q.trim()) params.set("q", q.trim().slice(0, 100));
  if (task.projectId) params.set("projectId", task.projectId);
  if (task.customerId) params.set("customerId", task.customerId);
  if (task.workOrderId) params.set("include", task.workOrderId);
  return params.toString();
}

/**
 * Ta bort arbetsorder (2026-10-26, svar 2b): the work order and its tasks that are not completed are removed after a
 * confirmation that lists them; a work order with a completed or signed protocol cannot be removed – it is completed or
 * cancelled (Utgår) instead, so history and traceability are kept. Returns the refusal, or null.
 */
export type WorkOrderRemovalTask = { id: string; kind: string; title: string; status: string; signed?: boolean };
export function workOrderRemovalRefusal(tasks: readonly WorkOrderRemovalTask[]): string | null {
  const kept = tasks.filter((task) => task.status === "COMPLETED" || task.signed);
  if (!kept.length) return null;
  return `Arbetsordern har ${kept.length === 1 ? "ett färdigställt eller signerat protokoll" : `${kept.length} färdigställda eller signerade protokoll`} och kan inte tas bort. Färdigställ arbetsordern eller markera den som Utgår i stället, så att historiken finns kvar.`;
}

/** What the confirmation before removal lists: the tasks that go with the work order. */
export function workOrderRemovalSummary(tasks: readonly Pick<WorkOrderRemovalTask, "title">[]) {
  if (!tasks.length) return "Arbetsordern har inga uppgifter.";
  const names = tasks.slice(0, 10).map((task) => task.title.trim() || "(utan rubrik)");
  const more = tasks.length > names.length ? ` och ${tasks.length - names.length} till` : "";
  return `${tasks.length === 1 ? "Uppgiften" : `De ${tasks.length} uppgifterna`} tas bort med arbetsordern: ${names.join(", ")}${more}.`;
}

/** Whether a stored task carries a signature or approval that removal would lose (a protocol's signature, a risk assessment's approval). */
export function taskIsSigned(data: unknown): boolean {
  const value = data as { kind?: string; details?: { approval?: { confirmed?: boolean }; values?: { signatures?: Record<string, { confirmed?: boolean; signedAt?: string | null } | null> } } } | null;
  if (!value?.details) return false;
  if (value.kind === "RISK_ASSESSMENT") return Boolean(value.details.approval?.confirmed);
  if (value.kind === "FORM") return Object.values(value.details.values?.signatures ?? {}).some((signature) => Boolean(signature && (signature.confirmed || signature.signedAt)));
  return false;
}
