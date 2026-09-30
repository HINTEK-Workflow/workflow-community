import { swedishDayKey } from "@/lib/swedish-time";

/**
 * The one project status used everywhere (Daniel 2026-09-26): cards, tabs, the project view, the overview list,
 * key figures, Local and the demo. Planerat → Pågår → Klar att avsluta → Avslutat (manual) → Arkiverat.
 * Callers pass every task and planned activity linked to the project, not only the ones the viewer may read,
 * so that one project has the same status for everyone; the result carries no task content.
 */
export type ProjectState = "PLANNED" | "IN_PROGRESS" | "READY_TO_CLOSE" | "CLOSED" | "ARCHIVED";

export type ProjectStatusInput = {
  archivedAt?: string | Date | null;
  closedAt?: string | Date | null;
  /** Project start (YYYY-MM-DD, or empty). */
  startDate?: string;
  /** Project end (YYYY-MM-DD, or empty). */
  dueDate?: string;
  tasks: { status: string }[];
  activities?: { status: string; endsAt: string | Date; deletedAt?: string | Date | null }[];
  now?: Date;
};

export type ProjectStatus = {
  state: ProjectState;
  label: "Planerat" | "Pågår" | "Klar att avsluta" | "Avslutat" | "Arkiverat";
  /** Neither closed nor archived: the "Pågående" tab and the "Pågående projekt" key figure. */
  ongoing: boolean;
  /** The end date has passed while the work is still planned or in progress. */
  overdue: boolean;
};

const labels: Record<ProjectState, ProjectStatus["label"]> = {
  PLANNED: "Planerat",
  IN_PROGRESS: "Pågår",
  READY_TO_CLOSE: "Klar att avsluta",
  CLOSED: "Avslutat",
  ARCHIVED: "Arkiverat",
};

/**
 * Planning counts as active while it is planned or in progress and has not ended yet. Planning whose end has passed
 * no longer holds a project open, so a forgotten status never blocks closing.
 */
export function isActivePlanning(activity: NonNullable<ProjectStatusInput["activities"]>[number], now: Date) {
  return !activity.deletedAt && ["PLANNED", "IN_PROGRESS"].includes(activity.status) && new Date(activity.endsAt).getTime() > now.getTime();
}

export function summarizeProjectStatus(input: ProjectStatusInput): ProjectStatus {
  const now = input.now ?? new Date();
  const today = swedishDayKey(now);
  const openTasks = input.tasks.filter((task) => task.status !== "COMPLETED").length;
  const activePlanning = (input.activities ?? []).some((activity) => isActivePlanning(activity, now));
  const state: ProjectState = input.archivedAt ? "ARCHIVED"
    : input.closedAt ? "CLOSED"
    : input.startDate && input.startDate > today ? "PLANNED"
    : openTasks > 0 || activePlanning ? "IN_PROGRESS"
    : input.tasks.length > 0 ? "READY_TO_CLOSE"
    : "PLANNED";
  return {
    state,
    label: labels[state],
    ongoing: state !== "CLOSED" && state !== "ARCHIVED",
    overdue: (state === "PLANNED" || state === "IN_PROGRESS") && Boolean(input.dueDate) && input.dueDate! < today,
  };
}

/**
 * Who may close, reopen or (later) move a project's dates: the company admin, or the project's responsible member
 * when that member may edit projects. Being responsible never grants anything on its own.
 */
export function canManageProjectLifecycle(input: { admin: boolean; userId: string; responsibleUserId: string | null | undefined; canEditProjects: boolean }) {
  return input.admin || (input.canEditProjects && Boolean(input.responsibleUserId) && input.responsibleUserId === input.userId);
}
