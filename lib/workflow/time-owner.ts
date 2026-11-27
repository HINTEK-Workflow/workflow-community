/**
 * Tid på arbetsorder eller projekt (2026-10-26, svar 5a): a time entry has exactly one owner – a work order, or a
 * project for project time without a work order (project management, meetings). Timer and written time work on both,
 * a person has one running timer, and a work order's time is summed on its project beside the project's own time.
 * Shared by Cloud, Local and the demo.
 */

/** The refusal when an entry names both or neither. */
export const PROJECT_TIME_ENTRY_ONE_OWNER = "Välj arbetsorder eller projekt för tiden.";

/** A project as a time source: closed counts as completed (only an admin corrects the time), archived is frozen. */
export function projectTimeState(project: { archivedAt?: Date | string | null; closedAt?: Date | string | null }) {
  return { status: project.closedAt ? "COMPLETED" : "IN_PROGRESS", archived: Boolean(project.archivedAt) };
}

/** A project's time: its work orders' time and its own, kept apart so project time without a work order shows on its own. */
export function projectTimeTotals(input: { workOrderSeconds: number; projectSeconds: number }) {
  return { workOrders: input.workOrderSeconds, project: input.projectSeconds, total: input.workOrderSeconds + input.projectSeconds };
}

/** The label of a project as a time source ("Projekttid: X"), in pickers and lists. */
export const projectTimeLabel = (name: string) => `Projekttid: ${name.trim() || "(utan namn)"}`;
