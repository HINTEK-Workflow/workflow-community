import type { ProjectStatus } from "./project-status";

export type UrgencyItem = { needsAction: boolean; overdue: boolean; status: string; dueDate?: string; updatedAt: string };

/**
 * The most urgent items for the folded overview (2026-09-26): needs action or overdue first,
 * then open work with the nearest due date, then the most recently changed. Completed work only fills up.
 */
export function mostUrgentWork<T extends UrgencyItem>(items: T[], count = 3) {
  const finished = ["Slutfört", "Klar att avsluta", "Avslutat", "Arkiverat"];
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
};

export type OverviewProjectInput = { id: string; name: string; updatedAt: string; dueDate: string; status: ProjectStatus; tasks: { status: string; progress: number }[] };
/** A control's progression and remaining mandatory points come from the shared completion rules. */
export type OverviewControlInput = { id: string; title: string; status: string; updatedAt: string; lastOpenedAt?: string | null; projectName?: string; percent: number; errors: number };
export type OverviewTaskInput = { id: string; title: string; kind: string; status: string; progress: number; dueDate?: string; updatedAt: string; projectName?: string };

const taskTypeLabel = (kind: string) => kind === "WORK_ORDER" ? "Arbetsorder" : kind === "RISK_ASSESSMENT" ? "Riskbedömning" : kind === "FORM" ? "Formulär" : "Uppgift";

/** "Projekt och uppgifter" on Översikt: one list of projects, controls and tasks, the same in Cloud, Local and the demo. */
export function buildOverviewWork(input: { projects: OverviewProjectInput[]; controls: OverviewControlInput[]; tasks: OverviewTaskInput[]; today: string }): OverviewWorkItem[] {
  const projects = input.projects.map((project): OverviewWorkItem => {
    const progress = project.tasks.length ? Math.round(project.tasks.reduce((sum, task) => sum + (task.status === "COMPLETED" ? 100 : task.progress), 0) / project.tasks.length) : 0;
    const remaining = project.tasks.filter((task) => task.status !== "COMPLETED").length;
    const overdue = project.status.overdue;
    return {
      id: project.id, kind: "PROJECT", title: project.name, status: overdue ? "Behöver åtgärdas" : project.status.label, progress,
      remaining: project.tasks.length ? `${remaining} ${remaining === 1 ? "uppgift återstår" : "uppgifter återstår"}` : "Inga uppgifter tillagda",
      updatedAt: project.updatedAt, dueDate: project.dueDate || undefined, overdue, href: `/?view=project&projectId=${encodeURIComponent(project.id)}`,
      action: progress > 0 ? "Öppna projekt" : "Planera projekt", needsAction: overdue,
    };
  });
  const controls = input.controls.map((control): OverviewWorkItem => {
    const done = control.status === "COMPLETED";
    const progress = done ? 100 : control.percent;
    return {
      id: control.id, kind: "TASK", title: control.title, taskType: "Kontroll före idrifttagning", projectName: control.projectName || undefined,
      status: done ? "Slutfört" : control.errors > 0 ? "Behöver åtgärdas" : progress > 0 || control.lastOpenedAt ? "Pågår" : "Planerat", progress,
      remaining: done ? "Inget återstår" : control.errors ? `${control.errors} obligatoriska punkter återstår` : "Redo att fortsätta",
      updatedAt: control.updatedAt, overdue: false, href: `/?view=new&id=${encodeURIComponent(control.id)}`,
      action: done ? "Öppna" : progress > 0 ? "Fortsätt" : "Starta", needsAction: !done && control.errors > 0,
    };
  });
  const tasks = input.tasks.map((task): OverviewWorkItem => {
    const done = task.status === "COMPLETED";
    return {
      id: task.id, kind: "TASK", title: task.title, taskType: taskTypeLabel(task.kind), projectName: task.projectName || undefined,
      status: done ? "Slutfört" : task.status === "NEEDS_ACTION" ? "Behöver åtgärdas" : task.status === "PLANNED" ? "Planerat" : task.status === "PAUSED" ? "Pausat" : "Pågår",
      progress: done ? 100 : task.progress, remaining: done ? "Inget återstår" : `${Math.max(0, 100 - task.progress)}% återstår`,
      updatedAt: task.updatedAt, dueDate: task.dueDate || undefined, overdue: Boolean(task.dueDate && task.dueDate < input.today && !done),
      href: `/?view=workflow_task&taskId=${encodeURIComponent(task.id)}&taskType=${task.kind}`, action: done ? "Öppna" : task.progress > 0 ? "Fortsätt" : "Starta",
      needsAction: task.status === "NEEDS_ACTION",
    };
  });
  return [...projects, ...controls, ...tasks];
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
    urgent: mostUrgentWork(items),
  };
}
