import { swedishDayKey } from "@/lib/swedish-time";
import { isTaskClosed, isTaskOpen } from "./task-cancel";

/**
 * The one project status used everywhere (2026-09-26): cards, tabs, the project view, the overview list,
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
  /** `id` lets a booking on a completed job be recognised (steg 1, 2026-10-09). */
  tasks: { id?: string; status: string }[];
  activities?: { status: string; endsAt: string | Date; deletedAt?: string | Date | null; workflowTaskId?: string | null }[];
  now?: Date;
};

export type ProjectStatus = {
  state: ProjectState;
  label: "Planerat" | "Pågår" | "Klar att avsluta" | "Avslutat" | "Arkiverat";
  /** Neither closed nor archived: the "Pågående" tab and the "Pågående projekt" key figure. */
  ongoing: boolean;
  /** The end date has passed while the work is still planned or in progress. */
  overdue: boolean;
  /**
   * Why "Avsluta projekt" cannot be used yet, shown next to the disabled button (2026-10-08: always visible,
   * with the reason), e.g. "3 uppgifter återstår". Null when ready to close, closed or archived. Optional so a status
   * built elsewhere still type-checks; the server's close rule checks the state only.
   */
  closeBlocker?: string | null;
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
  // Utgått jobs (2026-10-09) are neither open nor remaining: they count as done for closing the project.
  const openTasks = input.tasks.filter((task) => isTaskOpen(task.status)).length;
  // A booking on a completed job no longer holds the project open (projektförslaget 2026-10-09, steg 1).
  const completed = new Set(input.tasks.flatMap((task) => task.id && isTaskClosed(task.status) ? [task.id] : []));
  const activePlanning = (input.activities ?? []).some((activity) => isActivePlanning(activity, now) && !(activity.workflowTaskId && completed.has(activity.workflowTaskId)));
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
    closeBlocker: state === "PLANNED" || state === "IN_PROGRESS" ? closeBlocker(openTasks, activePlanning, input.tasks.length, input.startDate) : null,
  };
}

/** The reason in words; the order follows what the person has to do first. */
function closeBlocker(openTasks: number, activePlanning: boolean, taskCount: number, startDate?: string) {
  const remaining = openTasks ? `${openTasks} ${openTasks === 1 ? "uppgift återstår" : "uppgifter återstår"}` : "";
  if (remaining && activePlanning) return `${remaining} och planering är aktiv`;
  if (remaining) return remaining;
  if (activePlanning) return "Planering är aktiv";
  if (!taskCount) return "Projektet har inga uppgifter";
  return startDate ? `Projektet startar ${startDate}` : "Projektet har inte startat";
}

/**
 * Who may close, reopen or (later) move a project's dates: the company admin, or the project's responsible member
 * when that member may edit projects. Being responsible never grants anything on its own.
 */
export function canManageProjectLifecycle(input: { admin: boolean; userId: string; responsibleUserId: string | null | undefined; canEditProjects: boolean }) {
  return input.admin || (input.canEditProjects && Boolean(input.responsibleUserId) && input.responsibleUserId === input.userId);
}

/**
 * Arkivera projekt (beslut 9, 2026-11-01): the company admin and the project's responsible member by default, as for
 * closing a project; anyone else only with the right projects:archive, which an admin gives. Restoring follows the same rule.
 */
export function canArchiveProject(input: { admin: boolean; userId: string; responsibleUserId: string | null | undefined; canEditProjects: boolean; canArchiveProjects: boolean }) {
  return input.canArchiveProjects || canManageProjectLifecycle(input);
}
