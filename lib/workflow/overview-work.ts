import { summarizeProjectStatus, type ProjectStatus } from "./project-status";
import { projectCompletion } from "./project-progress";
import { isTaskCancelled, isTaskOpen } from "./task-cancel";
import { isLateTask } from "./late-tasks";
import { projectPeople, type ProjectPerson } from "./project-people";

export type UrgencyItem = { needsAction: boolean; overdue: boolean; status: string; dueDate?: string; updatedAt: string };

/**
 * The most urgent items for the folded overview (2026-09-26): needs action or overdue first,
 * then open work with the nearest due date, then the most recently changed. Completed work only fills up.
 */
export function mostUrgentWork<T extends UrgencyItem>(items: T[], count = 3) {
  const finished = ["Färdigställt", "Klar att avsluta", "Avslutat", "Arkiverat"];
  const rank = (item: T) => (item.needsAction || item.overdue ? 0 : !finished.includes(item.status) ? 1 : 2);
  return [...items]
    .sort((a, b) => rank(a) - rank(b) || (a.dueDate || "9999").localeCompare(b.dueDate || "9999") || b.updatedAt.localeCompare(a.updatedAt))
    .slice(0, count);
}

export const OVERVIEW_WORK_FILTERS = ["all", "projects", "tasks", "action"] as const;
export const OVERVIEW_WORK_SORTS = ["updated", "progress", "due"] as const;
export type OverviewWorkFilter = (typeof OVERVIEW_WORK_FILTERS)[number];
export type OverviewWorkSort = (typeof OVERVIEW_WORK_SORTS)[number];

export type OverviewWorkItem = UrgencyItem & {
  id: string;
  kind: "PROJECT" | "TASK";
  title: string;
  taskType?: string;
  projectName?: string;
  progress: number;
  remaining: string;
  href: string;
  action: string;
  /** A project's name badges (2026-10-22): the responsible person and whoever has one of its jobs the reader may see. */
  people?: ProjectPerson[];
};

export type OverviewProjectInput = { id: string; name: string; updatedAt: string; dueDate: string; status: ProjectStatus; tasks: { status: string; progress: number }[]; people?: ProjectPerson[] };
export type OverviewTaskInput = { id: string; title: string; kind: string; status: string; progress: number; dueDate?: string; updatedAt: string; projectName?: string;
  /** Who has the job, for its project's name badges (Local). */
  assignedToUserId?: string | null; assignedToName?: string };

const taskTypeLabel = (kind: string) => kind === "WORK_ORDER" ? "Arbetsorder" : kind === "RISK_ASSESSMENT" ? "Riskbedömning" : kind === "FORM" ? "Formulär" : "Uppgift";

/** "Projekt och uppgifter" on Översikt: one list of projects and tasks, the same in Cloud, Local and the demo. */
export function buildOverviewWork(input: { projects: OverviewProjectInput[]; tasks: OverviewTaskInput[]; today: string }): OverviewWorkItem[] {
  const projects = input.projects.map((project): OverviewWorkItem => {
    // Utgått jobs (2026-10-09) are left out of the percentage and never remain.
    const progress = projectCompletion(project.tasks);
    const remaining = project.tasks.filter((task) => isTaskOpen(task.status)).length;
    const overdue = project.status.overdue;
    return {
      id: project.id, kind: "PROJECT", title: project.name, status: overdue ? "Behöver åtgärdas" : project.status.label, progress,
      remaining: project.tasks.length ? `${remaining} ${remaining === 1 ? "uppgift återstår" : "uppgifter återstår"}` : "Inga uppgifter tillagda",
      updatedAt: project.updatedAt, dueDate: project.dueDate || undefined, overdue, href: `/?view=project&projectId=${encodeURIComponent(project.id)}`,
      action: progress > 0 ? "Öppna projekt" : "Planera projekt", needsAction: overdue,
      // Only a project with people gets badges; an empty row of them says nothing on a card.
      ...(project.people?.length ? { people: project.people } : {}),
    };
  });
  const tasks = input.tasks.map((task): OverviewWorkItem => {
    const done = task.status === "COMPLETED";
    const cancelled = isTaskCancelled(task.status);
    if (cancelled) return {
      id: task.id, kind: "TASK", title: task.title, taskType: taskTypeLabel(task.kind), projectName: task.projectName || undefined,
      status: "Utgått", progress: task.progress, remaining: "Utgår – görs inte", updatedAt: task.updatedAt, dueDate: task.dueDate || undefined, overdue: false,
      href: `/?view=workflow_task&taskId=${encodeURIComponent(task.id)}&taskType=${task.kind}`, action: "Öppna", needsAction: false,
    };
    return {
      id: task.id, kind: "TASK", title: task.title, taskType: taskTypeLabel(task.kind), projectName: task.projectName || undefined,
      status: done ? "Färdigställt" : task.status === "NEEDS_ACTION" ? "Behöver åtgärdas" : task.status === "PLANNED" ? "Planerat" : task.status === "PAUSED" ? "Pausat" : "Pågår",
      progress: done ? 100 : task.progress, remaining: done ? "Inget återstår" : `${Math.max(0, 100 - task.progress)}% återstår`,
      updatedAt: task.updatedAt, dueDate: task.dueDate || undefined, overdue: isLateTask(task, input.today),
      href: `/?view=workflow_task&taskId=${encodeURIComponent(task.id)}&taskType=${task.kind}`, action: done ? "Öppna" : task.progress > 0 ? "Fortsätt" : "Starta",
      needsAction: task.status === "NEEDS_ACTION",
    };
  });
  return [...projects, ...tasks];
}

const matchesFilter = (item: OverviewWorkItem, filter: OverviewWorkFilter) => filter === "all" || (filter === "projects" && item.kind === "PROJECT")
  || (filter === "tasks" && item.kind === "TASK") || (filter === "action" && (item.needsAction || item.overdue));

/** Filters, sorts and pages the list; the server sends only the page and the three most urgent items. */
export function selectOverviewWork(items: OverviewWorkItem[], options: { filter: OverviewWorkFilter; sort: OverviewWorkSort; page: number; pageSize?: number }) {
  const pageSize = options.pageSize ?? 10;
  const visible = items.filter((item) => matchesFilter(item, options.filter)).sort((a, b) => {
    if (options.sort === "progress") return a.progress - b.progress || b.updatedAt.localeCompare(a.updatedAt);
    if (options.sort === "due") return (a.dueDate || "9999").localeCompare(b.dueDate || "9999") || b.updatedAt.localeCompare(a.updatedAt);
    return b.updatedAt.localeCompare(a.updatedAt);
  });
  const page = Math.max(1, Math.floor(options.page) || 1);
  return {
    // One page at a time; "Visa fler" appends the next page.
    items: visible.slice((page - 1) * pageSize, page * pageSize),
    total: visible.length,
    page,
    counts: Object.fromEntries(OVERVIEW_WORK_FILTERS.map((filter) => [filter, items.filter((item) => matchesFilter(item, filter)).length])) as Record<OverviewWorkFilter, number>,
    /** Late jobs only, by the same rule as the key figure "Förfallna" (lib/workflow/late-tasks.ts). */
    late: items.filter((item) => item.kind === "TASK" && item.overdue).length,
    urgent: mostUrgentWork(items),
  };
}

/** The open file's projects and tasks as Local's Översikt sends them to the shared list. */
export type LocalOverviewSource = {
  projects: { id: string; name: string; updatedAt: string; startDate?: string; dueDate: string; archivedAt?: string | null; closedAt?: string | null; status?: ProjectStatus;
    responsibleUserId?: string | null; responsibleName?: string; workflowTasks?: OverviewTaskInput[] }[];
  workflowTasks: OverviewTaskInput[];
};

/**
 * Local's "Projekt och uppgifter" with the same rules as Cloud (quality check 2026-10-05, F8): a project with a future
 * start is "Planerat" (the start date is part of the status).
 */
export function localOverviewWork(data: LocalOverviewSource, today: string) {
  const projectOf = new Map(data.projects.flatMap((project) => (project.workflowTasks ?? []).map((task) => [task.id, project.name] as const)));
  return buildOverviewWork({
    today,
    projects: data.projects.map((project) => {
      const tasks = (project.workflowTasks ?? []).map((task) => ({ status: task.status, progress: task.progress }));
      return { id: project.id, name: project.name, updatedAt: project.updatedAt, dueDate: project.dueDate, tasks, people: projectPeople(project, project.workflowTasks ?? []),
        status: project.status ?? summarizeProjectStatus({ archivedAt: project.archivedAt, closedAt: project.closedAt, startDate: project.startDate, dueDate: project.dueDate, tasks }) };
    }),
    tasks: [...data.projects.flatMap((project) => project.workflowTasks ?? []), ...data.workflowTasks].map((task) => ({ ...task, projectName: projectOf.get(task.id) })),
  });
}
