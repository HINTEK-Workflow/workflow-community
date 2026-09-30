"use client";

import { useConfirm } from "./confirm";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { AlertTriangle, Archive, ArrowRight, CalendarDays, CalendarPlus, CheckCircle2, ChevronLeft, ChevronRight, CircleDashed, ClipboardList, Clock3, FolderKanban, History, Link2, Pencil, PlayCircle, Plus, RotateCcw, Search, Trash2, UserRound } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { addSwedishDays, formatSwedish, fromSwedishDateInput, fromSwedishDateTimeInput, isSameSwedishDay, startOfSwedishDay, SWEDISH_TIME_ZONE, swedishDayDifference, swedishDayKey, swedishParts, toSwedishDateTimeInput } from "@/lib/swedish-time";
import { api } from "./api";
import { Empty, Modal, Panel, ShowMore } from "./ui";
import type { ControlItem, CustomerItem, ProjectItem } from "./types";
import type { WorkflowReportOptions } from "@/lib/workflow/report";
import { ReportOptionsButton, type ProjectReportChoice } from "@/features/workflow/report-options";
import { defaultWorkflowPermissionProfile, hasWorkflowPermission, workflowSubjectForTask, type WorkflowPermissionAction, type WorkflowPermissionProfile, type WorkflowPermissionSubject } from "@/lib/workflow/permissions";
import { summarizeProjectBudget } from "@/lib/workflow/project-budget";
import { canManageProjectLifecycle, summarizeProjectStatus, type ProjectStatus } from "@/lib/workflow/project-status";
import { formatFrame, frameShiftDays, hasProjectFrame, planningAfterTaskDue, planningFrameError, projectFieldRows, projectFrameError, projectFrameIssues, taskDueDateError } from "@/lib/workflow/project-frame";
import { plannedMinutesByProject, plannedMinutesByTask, plannedMinutesForUserInWindow, summarizeWeeklyCapacity, type CapacityActivity } from "@/lib/workflow/capacity-summary";
import { plannedActivityAssignments } from "@/lib/workflow/planned-activity";
import { projectCompletion, summarizeFrameAdherence, type FrameAdherence } from "@/lib/workflow/project-progress";
import { facilityLabel } from "@/lib/workflow/customer-facility";
import { summarizeAvailability } from "@/lib/workflow/availability-summary";
import { isInSwedishMonth, movePlannedActivityToDay, movePlanningCalendar, planningActivitiesForDay, planningCalendarDays, planningCalendarTitle, planningDefaultInterval, type PlanningCalendarMode } from "@/lib/workflow/planning-calendar-summary";
import { effectiveWeeklyWorkMinutes } from "@/lib/workflow/work-schedule";
import { personInitials, personSolidTone, personSurfaceTone } from "@/features/workflow/person-tone";
import { budgetTone, indicatorBadge, indicatorBar, indicatorText, progressTone, statusTone, type IndicatorTone } from "@/features/workflow/indicator-tone";
import { ProjectStarter } from "@/features/workflow/project-starter";
import { CustomerSearchBox } from "./customer-search-box";

export type WorkflowTask = Pick<ControlItem, "id" | "title" | "status" | "updatedAt"> & {
  number?: number;
  /** A protocol's permission area (forms, kfid or risk-assessment). */
  formArea?: string | null;
  projectId?: string | null;
  lastOpenedAt?: string | null;
  completion?: number;
  progress?: number;
  totalDurationSec?: number;
  kind?: "WORK_ORDER" | "RISK_ASSESSMENT" | "FORM";
  dueDate?: string;
  customerId?: string | null;
  isMine?: boolean;
  assignedToUserId?: string | null;
  assignedToName?: string;
};
export type WorkflowProject = ProjectItem & {
  customer?: { id: string; name: string; company: string } | null;
  controls: WorkflowTask[];
  workflowTasks?: WorkflowTask[];
};
type ProjectMember = { id: string; name: string };
type PlanningCapacity = { currentUserId: string; weeklyWorkMinutes: number; timeEntries: { startedAt: string; durationSec: number }[] };
type TeamCapacityMember = { id: string; name: string; weeklyWorkMinutes: number; memberWeeklyWorkMinutes: number | null; events: { id: string; previousMinutes: number | null; nextMinutes: number | null; actorName: string; createdAt: string }[] };
type PlanningTeamCapacity = { canViewTeam: boolean; organizationWeeklyWorkMinutes: number; members: TeamCapacityMember[]; activities: CapacityActivity[] };
export type PlannedActivity = {
  id: string;
  version: number;
  title: string;
  description: string;
  kind: "TASK" | "MEETING" | "DEADLINE" | "OTHER";
  status: "PLANNED" | "IN_PROGRESS" | "COMPLETED" | "CANCELED";
  startsAt: string;
  endsAt: string;
  projectId: string | null;
  workflowTaskId: string | null;
  controlId: string | null;
  assignedToUserId: string | null;
  assignedToUserIds: string[];
  assignments: { userId: string; plannedMinutes: number | null; startsAt: string | null; endsAt: string | null }[];
  assignedToName: string;
  deletedAt?: string | null;
  project?: { id: string; name: string; timeBudgetMinutes: number } | null;
  events?: { id: string; kind: string; summary: string; actorName: string; createdAt: string }[];
  eventCount?: number;
};
type PlannedActivityInput = Omit<PlannedActivity, "id" | "version" | "deletedAt" | "events" | "eventCount"> & { id?: string; version?: number; frameExceptionReason?: string };

/** The link guide's choices (decision 7): the project's value per field, or keep the task's own. */
type LinkChoices = { customer: boolean; responsible: boolean; dueDate: string };
type LocalProjectAdapter = {
  projects: WorkflowProject[];
  workflowTasks?: WorkflowTask[];
  save: (project: ProjectFormInput) => Promise<string>;
  link: (task: WorkflowTask, projectId: string, apply: LinkChoices) => Promise<void>;
  archive: (projectId: string, archived: boolean) => Promise<void>;
  close: (projectId: string, closed: boolean) => Promise<void>;
  decide: (projectId: string, decision: ProjectDecisionInput) => Promise<void>;
  reopen: (taskId: string) => Promise<void>;
  plannedActivities: PlannedActivity[];
  savePlannedActivity: (activity: PlannedActivityInput) => Promise<{ id: string; version: number }>;
  removePlannedActivity: (id: string, version: number) => Promise<void>;
  members: ProjectMember[];
  capacity: PlanningCapacity;
  teamCapacity: PlanningTeamCapacity;
  report?: (project: WorkflowProject, options: WorkflowReportOptions, selected: ProjectReportChoice[]) => Promise<void>;
};
type ProjectFormInput = { id?: string; name: string; description: string; startDate: string; dueDate: string; client: string; contactPerson: string; reference: string; workSite: string; customerId: string | null; facilityId?: string | null; responsibleUserId: string | null; responsibleName: string; timeBudgetMinutes?: number; shiftDays?: number };

function taskState(task: WorkflowTask) {
  if (task.status === "COMPLETED") return "done" as const;
  if (["IN_PROGRESS", "PAUSED", "NEEDS_ACTION"].includes(task.status) || (task.completion ?? task.progress ?? 0) > 0 || task.lastOpenedAt) return "active" as const;
  return "planned" as const;
}

const projectTasks = (project: WorkflowProject) => [...project.controls, ...(project.workflowTasks ?? [])];

const taskProgress = (task: WorkflowTask) => task.status === "COMPLETED" ? 100 : task.completion ?? task.progress ?? 0;

const taskTypeLabel = (task: WorkflowTask) => task.kind === "WORK_ORDER" ? "Arbetsorder" : task.kind === "RISK_ASSESSMENT" ? "Riskbedömning" : task.kind === "FORM" ? "Formulär" : "Kontroll före idrifttagning";

const taskHref = (task: WorkflowTask) => task.kind
  ? `/?view=workflow_task&taskId=${encodeURIComponent(task.id)}&taskType=${task.kind}`
  : `/?view=new&id=${encodeURIComponent(task.id)}`;

function projectProgress(project: WorkflowProject) {
  return projectCompletion(projectTasks(project).map((task) => ({ status: task.status, progress: taskProgress(task) })));
}

/** Cloud sends the status computed on the server; Local computes it from the open file with the same function. */
function withProjectStatus(project: WorkflowProject, activities: PlannedActivity[]): WorkflowProject {
  if (project.status) return project;
  return { ...project, status: summarizeProjectStatus({ archivedAt: project.archivedAt, closedAt: project.closedAt, startDate: project.startDate, dueDate: project.dueDate, tasks: projectTasks(project), activities: activities.filter((activity) => activity.projectId === project.id) }) };
}

const projectStatusOf = (project: WorkflowProject) => project.status ?? summarizeProjectStatus({ archivedAt: project.archivedAt, closedAt: project.closedAt, startDate: project.startDate, dueDate: project.dueDate, tasks: projectTasks(project) });

function projectStatusTone(status: ProjectStatus): IndicatorTone {
  if (status.overdue) return "danger";
  if (status.state === "IN_PROGRESS") return "warning";
  if (status.state === "READY_TO_CLOSE" || status.state === "CLOSED") return "success";
  return "neutral";
}

/** New work and planning may only target projects that are neither closed nor archived. */
export const projectAcceptsWork = (project: { archivedAt?: string | null; closedAt?: string | null }) => !project.archivedAt && !project.closedAt;

function TaskState({ task }: { task: WorkflowTask }) {
  const state = taskState(task);
  const attention = state !== "done" && task.status === "NEEDS_ACTION";
  return <Badge variant="outline" className={indicatorBadge(attention ? "danger" : statusTone(state))}>
    {state === "done" ? "Slutförd" : attention ? "Behöver åtgärdas" : state === "active" ? "Pågår" : "Planerad"}
  </Badge>;
}

type ProjectTab = "ongoing" | "closed" | "archived";
type ProjectListMeta = { total: number; page: number; pages: number; counts: Record<ProjectTab, number> };
type ProjectsResponse = { projects: WorkflowProject[]; workflowTasks: WorkflowTask[]; controls?: WorkflowTask[]; members: ProjectMember[]; currentUserId?: string } & Partial<ProjectListMeta>;
const NO_TASKS: WorkflowTask[] = [];

export function WorkflowProjects({
  view,
  projectId,
  customers,
  controls: localControls = NO_TASKS,
  local,
  permissions,
  admin = false,
}: {
  view: "projects" | "planning" | "project" | "tasks" | "new_project";
  projectId?: string;
  customers: CustomerItem[];
  /** Local only: the open file's controls. Cloud reads standalone controls with the projects when a view needs them. */
  controls?: WorkflowTask[];
  local?: LocalProjectAdapter;
  permissions?: WorkflowPermissionProfile;
  admin?: boolean;
}) {
  const [currentUserId, setCurrentUserId] = useState("");
  const [cloudProjects, setCloudProjects] = useState<WorkflowProject[]>([]);
  const [cloudControls, setCloudControls] = useState<WorkflowTask[]>([]);
  const [cloudCandidates, setCloudCandidates] = useState<(WorkflowTask & { fromProject?: string })[] | null>(null);
  // "Mina projekt" in Cloud: one tab at a time, a page of cards from the server (Daniel 2026-09-26).
  const [listTab, setListTab] = useState<ProjectTab>("ongoing");
  const [listMeta, setListMeta] = useState<ProjectListMeta | null>(null);
  const [listBusy, setListBusy] = useState(false);
  const controls = local ? localControls : cloudControls;
  const [cloudWorkflowTasks, setCloudWorkflowTasks] = useState<WorkflowTask[]>([]);
  const [cloudMembers, setCloudMembers] = useState<ProjectMember[]>([]);
  const [cloudPlannedActivities, setCloudPlannedActivities] = useState<PlannedActivity[]>([]);
  const [cloudCapacity, setCloudCapacity] = useState<PlanningCapacity | null>(null);
  const [cloudTeamCapacity, setCloudTeamCapacity] = useState<PlanningTeamCapacity | null>(null);
  const router = useRouter();
  const [loading, setLoading] = useState(!local);
  const [error, setError] = useState("");
  const [editing, setEditing] = useState(false);
  const [linking, setLinking] = useState(false);
  const permissionProfile = permissions ?? defaultWorkflowPermissionProfile();
  const can = (subject: WorkflowPermissionSubject, action: WorkflowPermissionAction) => Boolean(local || admin || hasWorkflowPermission(permissionProfile, subject, action));
  const canCreateTask = (["kfid", "work-order", "risk-assessment"] as const).some((subject) => can(subject, "create"));
  const canReadTask = (task: WorkflowTask) => can(workflowSubjectForTask(task.kind ?? "COMMISSIONING_CONTROL", task.formArea), "read");
  const canEditTask = (task: WorkflowTask) => can(workflowSubjectForTask(task.kind ?? "COMMISSIONING_CONTROL", task.formArea), "edit");
  const canReopenTask = (task: WorkflowTask) => can(workflowSubjectForTask(task.kind ?? "COMMISSIONING_CONTROL", task.formArea), "reopen");
  const [reopening, setReopening] = useState(false);
  const [linkTarget, setLinkTarget] = useState<(WorkflowTask & { fromProject?: string }) | null>(null);
  // Only the project's responsible (with project edit rights) or a company admin may plan outside its frame, with a logged reason.
  const canFrameException = (project: WorkflowProject) => Boolean(local) || canManageProjectLifecycle({ admin, userId: currentUserId, responsibleUserId: project.responsibleUserId, canEditProjects: can("projects", "edit") });
  const [busy, setBusy] = useState(false);
  const plannedActivities = local?.plannedActivities ?? cloudPlannedActivities;
  const sourceProjects = local?.projects ?? cloudProjects;
  const projects = useMemo(() => sourceProjects.map((project) => withProjectStatus(project, plannedActivities)), [plannedActivities, sourceProjects]);
  const generalTasks = local?.workflowTasks ?? cloudWorkflowTasks;
  const members = local?.members ?? cloudMembers;
  const capacity = local?.capacity ?? cloudCapacity;
  const teamCapacity = local?.teamCapacity ?? cloudTeamCapacity;
  const load = useCallback(async () => {
    if (local) return;
    // Mina uppgifter pages its own list from the server; the full project load is not needed there.
    if (view === "tasks") { setLoading(false); return; }
    // Bounded reads (Daniel 2026-09-26): Mina projekt reads one page of one tab and the project view one project.
    if (view === "projects" || view === "new_project") {
      try {
        const result = await api<ProjectsResponse>(`/api/projects?list=${listTab}&page=1`);
        setCloudProjects(result.projects);
        setCloudMembers(result.members);
        setCurrentUserId(result.currentUserId ?? "");
        setListMeta({ total: result.total ?? result.projects.length, page: result.page ?? 1, pages: result.pages ?? 1, counts: result.counts ?? { ongoing: 0, closed: 0, archived: 0 } });
        setError("");
      } catch (issue) {
        setError((issue as Error).message);
      } finally {
        setLoading(false);
        setListBusy(false);
      }
      return;
    }
    try {
      const [result, planning, time, team] = await Promise.all([
        api<ProjectsResponse>(view === "project" && projectId ? `/api/projects?id=${encodeURIComponent(projectId)}` : "/api/projects?scope=planning"),
        api<{ activities: PlannedActivity[] }>("/api/planned-activities"),
        // Only this week's own time for the capacity panel, not every time entry.
        view === "planning"
          ? api<{ currentUserId: string; timeEntries: { startedAt: string; durationSec: number }[]; schedule: { organizationWeeklyWorkMinutes: number; memberWeeklyWorkMinutes: number | null } }>("/api/workflow-time?capacity=week")
          : Promise.resolve(null),
        view === "planning" ? api<PlanningTeamCapacity>("/api/planning-capacity") : Promise.resolve(null),
      ]);
      setCloudProjects(result.projects);
      setCloudWorkflowTasks(result.workflowTasks);
      setCloudControls(result.controls ?? []);
      setCloudCandidates(null);
      setCloudMembers(result.members);
      setCurrentUserId(result.currentUserId ?? "");
      setCloudPlannedActivities(planning.activities);
      setCloudCapacity(time ? {
        currentUserId: time.currentUserId,
        weeklyWorkMinutes: effectiveWeeklyWorkMinutes(time.schedule.organizationWeeklyWorkMinutes, time.schedule.memberWeeklyWorkMinutes),
        timeEntries: time.timeEntries,
      } : null);
      setCloudTeamCapacity(team);
      setError("");
    } catch (issue) {
      setError((issue as Error).message);
    } finally {
      setLoading(false);
    }
  }, [local, view, projectId, listTab]);
  useEffect(() => { void load(); }, [load]);
  async function loadMoreProjects() {
    if (!listMeta || listMeta.page >= listMeta.pages) return;
    setListBusy(true);
    try {
      const result = await api<ProjectsResponse>(`/api/projects?list=${listTab}&page=${listMeta.page + 1}`);
      setCloudProjects((current) => [...current, ...result.projects.filter((project) => !current.some((item) => item.id === project.id))]);
      setListMeta({ total: result.total ?? listMeta.total, page: result.page ?? listMeta.page + 1, pages: result.pages ?? listMeta.pages, counts: result.counts ?? listMeta.counts });
    } catch (issue) {
      setError((issue as Error).message);
    } finally {
      setListBusy(false);
    }
  }
  // The link dialog's candidates are read when it opens, not with the project.
  useEffect(() => {
    if (local || !linking || !projectId) return;
    let active = true;
    api<{ tasks: (WorkflowTask & { fromProject?: string })[] }>(`/api/projects?candidatesFor=${encodeURIComponent(projectId)}`)
      .then((result) => { if (active) setCloudCandidates(result.tasks); })
      .catch((issue) => { if (active) { setCloudCandidates([]); setError((issue as Error).message); } });
    return () => { active = false; };
  }, [local, linking, projectId]);
  const current = projects.find((project) => project.id === projectId);
  const projectTaskIds = useMemo(() => new Set(projects.flatMap((project) => projectTasks(project).map((task) => task.id))), [projects]);
  const tasks = useMemo(() => [
    ...projects.flatMap((project) => projectTasks(project).map((task) => ({ ...task, projectName: project.name }))),
    ...controls.filter((task) => !projectTaskIds.has(task.id)).map((task) => ({ ...task, projectName: "" })),
    ...generalTasks.filter((task) => !projectTaskIds.has(task.id)).map((task) => ({ ...task, projectName: "" })),
  ].filter((task) => task.isMine !== false).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)), [controls, generalTasks, projectTaskIds, projects]);
  // Koppla/Flytta (decision 7): standalone tasks, and tasks in other open projects that can be moved here.
  const linkCandidates = (targetProjectId: string) => (local ? [
    ...controls.filter((task) => !task.projectId),
    ...generalTasks.filter((task) => !task.projectId),
    ...projects.filter((project) => project.id !== targetProjectId && projectAcceptsWork(project)).flatMap((project) => projectTasks(project).map((task) => ({ ...task, projectId: project.id, fromProject: project.name }))),
  ] as (WorkflowTask & { fromProject?: string })[] : (cloudCandidates ?? []).map((task) => ({ ...task, fromProject: task.projectId ? task.fromProject : undefined }))).filter(canEditTask).sort((a, b) => Number(Boolean(a.fromProject)) - Number(Boolean(b.fromProject)) || b.updatedAt.localeCompare(a.updatedAt));
  const planningTasksById = useMemo(() => new Map([
    ...projects.flatMap((project) => projectTasks(project)),
    ...controls,
    ...generalTasks,
  ].map((task) => [task.id, task])), [controls, generalTasks, projects]);
  const planningContextTasks = [...planningTasksById.values()].filter(canReadTask);
  const canEditPlannedActivity = (activity: PlannedActivity) => !activity.deletedAt
    && can("projects", "edit")
    && (!activity.workflowTaskId || Boolean(planningTasksById.get(activity.workflowTaskId) && canEditTask(planningTasksById.get(activity.workflowTaskId)!)))
    && (!activity.controlId || can("kfid", "edit"));

  async function saveProject(input: ProjectFormInput) {
    setBusy(true);
    try {
      const id = local
        ? await local.save(input)
        : (await api<{ id: string }>("/api/projects", { method: "POST", body: JSON.stringify({ action: "save", project: input }) })).id;
      if (!local) await load();
      setEditing(false);
      router.push(`/?view=project&projectId=${encodeURIComponent(id)}`);
    } catch (issue) {
      setError((issue as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function linkTask(task: WorkflowTask, targetProjectId: string, apply: LinkChoices) {
    setBusy(true);
    setError("");
    try {
      if (local) await local.link(task, targetProjectId, apply);
      else {
        await api("/api/projects", {
          method: "POST",
          body: JSON.stringify({
            action: "link",
            projectId: targetProjectId,
            taskId: task.id,
            taskKind: task.kind ?? "COMMISSIONING_CONTROL",
            apply,
          }),
        });
        await load();
      }
      setLinking(false);
      setLinkTarget(null);
    } catch (issue) {
      setError((issue as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function setArchived(projectId: string, archived: boolean) {
    setBusy(true); setError("");
    try {
      if (local) await local.archive(projectId, archived);
      else { await api("/api/projects", { method: "POST", body: JSON.stringify({ action: archived ? "archive" : "restore", id: projectId }) }); await load(); }
    } catch (issue) { setError((issue as Error).message); } finally { setBusy(false); }
  }

  async function setClosed(projectId: string, closed: boolean) {
    setBusy(true); setError("");
    try {
      if (local) await local.close(projectId, closed);
      else { await api("/api/projects", { method: "POST", body: JSON.stringify({ action: closed ? "close" : "reopen_project", id: projectId }) }); await load(); }
    } catch (issue) { setError((issue as Error).message); } finally { setBusy(false); }
  }

  // Errors are shown in the decision form, so they are thrown rather than set on the page.
  async function addDecision(projectId: string, decision: ProjectDecisionInput) {
    if (local) return local.decide(projectId, decision);
    await api("/api/projects", { method: "POST", body: JSON.stringify({ action: "decision", projectId, decision }) });
    await load();
  }

  async function reopenTask(taskId: string) {
    setBusy(true); setError("");
    try {
      if (local) await local.reopen(taskId);
      else { await api("/api/workflow-tasks", { method: "POST", body: JSON.stringify({ action: "reopen", id: taskId }) }); await load(); }
      setReopening(false);
    } catch (issue) { setError((issue as Error).message); } finally { setBusy(false); }
  }

  async function savePlannedActivity(input: PlannedActivityInput) {
    setBusy(true); setError("");
    try {
      const result = local
        ? await local.savePlannedActivity(input)
        : await api<{ id: string; version: number }>("/api/planned-activities", { method: "POST", body: JSON.stringify({ action: "save", activity: input }) });
      if (!local) await load();
      return result;
    } catch (issue) {
      const message = (issue as Error).message;
      setError(message);
      throw new Error(message);
    } finally { setBusy(false); }
  }

  async function removePlannedActivity(id: string, version: number) {
    setBusy(true); setError("");
    try {
      if (local) await local.removePlannedActivity(id, version);
      else await api("/api/planned-activities", { method: "POST", body: JSON.stringify({ action: "delete", id, version }) });
      if (!local) await load();
    } catch (issue) {
      const message = (issue as Error).message;
      setError(message);
      throw new Error(message);
    } finally { setBusy(false); }
  }

  async function exportProjectReport(project: WorkflowProject, options: WorkflowReportOptions, selected: ProjectReportChoice[]) {
    if (local?.report) return local.report(project, options, selected);
    const sections = Object.entries(options).filter(([, included]) => included).map(([key]) => key).join(",");
    const taskIds = selected.filter((choice) => choice.kind !== "COMMISSIONING_CONTROL").map((choice) => choice.id).join(",");
    const controlIds = selected.filter((choice) => choice.kind === "COMMISSIONING_CONTROL").map((choice) => choice.id).join(",");
    const link = document.createElement("a");
    link.href = `/api/projects/${encodeURIComponent(project.id)}/report?taskIds=${encodeURIComponent(taskIds)}&controlIds=${encodeURIComponent(controlIds)}&sections=${encodeURIComponent(sections)}`;
    link.download = "";
    link.click();
  }

  if (loading) return <Panel title="Hämtar projekt"><p role="status" className="text-sm text-muted-foreground">Läser projekt och uppgifter…</p></Panel>;
  if (error && !projects.length && view !== "new_project") return <Panel title="Projekt kunde inte hämtas"><p role="alert" className="text-sm text-destructive">{error}</p></Panel>;
  if (view === "new_project" && !can("projects", "create")) return <Panel title="Behörighet saknas"><p className="text-sm text-muted-foreground">Du saknar behörighet att skapa projekt. Kontakta en företagsadministratör.</p></Panel>;
  const remoteList = local ? undefined : { tab: listTab, meta: listMeta, busy: listBusy, onTab: (tab: ProjectTab) => { if (tab !== listTab) { setListBusy(true); setListTab(tab); } }, onMore: () => void loadMoreProjects() };
  if (view === "new_project") return <>
    <ProjectsPage projects={projects} error={error} canCreate remote={remoteList} />
    <Modal
      open
      onOpenChange={(open) => { if (!open) router.push("/?view=projects"); }}
      title="Nytt projekt"
      className="max-w-2xl"
    >
      <p className="page-description mb-5">Skapa projektets grunduppgifter. Nya eller befintliga uppgifter kopplas till projektet efteråt.</p>
      <ProjectForm customers={customers} members={members} busy={busy} error={error} onCancel={() => router.push("/?view=projects")} onSave={saveProject} />
    </Modal>
  </>;
  if (view === "planning") return <PlanningOverview canCreateTask={canCreateTask} activities={plannedActivities} projects={projects} contextTasks={planningContextTasks} members={members} capacity={capacity} teamCapacity={teamCapacity} busy={busy} error={error} canCreate={can("projects", "create")} canEdit={canEditPlannedActivity} canReadTask={canReadTask} canFrameException={canFrameException} onSave={savePlannedActivity} onRemove={removePlannedActivity} />;
  if (view === "tasks") return <TaskList tasks={tasks} canCreate={canCreateTask} remote={!local} />;
  if (view === "project") {
    if (!current) return <Empty title="Projektet hittades inte" description="Det kan ha tagits bort eller tillhöra en annan arbetsyta."><Button asChild variant="outline"><Link href="/?view=projects">Till mina projekt</Link></Button></Empty>;
    const currentTasks = projectTasks(current);
    const groups = {
      planned: currentTasks.filter((task) => taskState(task) === "planned"),
      active: currentTasks.filter((task) => taskState(task) === "active"),
      done: currentTasks.filter((task) => taskState(task) === "done"),
    };
    const progress = projectProgress(current);
    const status = projectStatusOf(current);
    const archived = status.state === "ARCHIVED";
    const closed = status.state === "CLOSED";
    const locked = archived || closed;
    const canManage = Boolean(local) || canManageProjectLifecycle({ admin, userId: currentUserId, responsibleUserId: current.responsibleUserId, canEditProjects: can("projects", "edit") });
    const frameIssues = projectFrameIssues(current, currentTasks);
    const taskPlannedMinutes = plannedMinutesByTask(plannedActivities);
    const reportChoices: ProjectReportChoice[] = currentTasks.map((task) => ({ id: task.id, kind: task.kind ?? "COMMISSIONING_CONTROL", title: task.title, status: task.status }));
    return <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0"><Link className="text-sm text-primary hover:underline" href="/?view=projects">← Mina projekt</Link><h1 className="page-title mt-2">{current.name}</h1><p className="page-description mt-1">{current.description || "Gemensam arbetsyta för projektets uppgifter."}</p></div>
        <div className="flex flex-wrap justify-end gap-2">{can("projects", "report") && currentTasks.length > 0 && (!local || local.report) && <ReportOptionsButton choices={reportChoices} onExport={(options, selected) => exportProjectReport(current, options, selected)} />}{archived ? can("projects", "archive") && <Button variant="outline" disabled={busy} onClick={() => void setArchived(current.id, false)}><RotateCcw />Återställ projekt</Button> : <>{can("projects", "edit") && <Button variant="outline" onClick={() => setEditing(true)}><Pencil />Redigera</Button>}{!closed && can("projects", "edit") && <Button variant="outline" onClick={() => setLinking(true)}><Link2 />Koppla befintlig uppgift</Button>}{can("projects", "archive") && <Button variant="outline" disabled={busy} onClick={() => void setArchived(current.id, true)}><Archive />Arkivera</Button>}{closed ? canManage && <Button disabled={busy} onClick={() => void setClosed(current.id, false)}><RotateCcw />Återöppna projekt</Button> : canCreateTask && <Button asChild><Link href={`/?view=new_task&projectId=${encodeURIComponent(current.id)}`}><Plus />Skapa ny uppgift</Link></Button>}</>}</div>
      </div>
      {archived && <div className="notice">Projektet är arkiverat och skrivskyddat. Rapporter och historik går fortfarande att läsa. Återställ projektet för att redigera eller lägga till arbete.</div>}
      {closed && <div data-testid="project-closed-notice" className="notice">Projektet är avslutat. Nya uppgifter och ny planering är spärrade; rapporter och historik går att läsa. {canManage ? "Återöppna projektet om arbetet ska fortsätta." : "Projektansvarig eller en administratör kan återöppna det."}</div>}
      {status.state === "READY_TO_CLOSE" && <div data-testid="project-ready-to-close" className={cn("flex flex-wrap items-center justify-between gap-3 rounded-xl border p-4 text-sm", indicatorBadge("success"))}><span><strong>Klar att avsluta.</strong> Alla uppgifter är slutförda och ingen planering är aktiv. {canManage ? "Avsluta projektet när arbetet är klart, eller återuppta arbetet." : "Projektansvarig eller en administratör kan avsluta det."}</span><div className="flex flex-wrap gap-2"><Button size="sm" variant="outline" onClick={() => setReopening(true)}><RotateCcw />Återuppta arbete</Button>{canManage && <Button size="sm" disabled={busy} onClick={() => void setClosed(current.id, true)}><CheckCircle2 />Avsluta projekt</Button>}</div></div>}
      {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
      {!locked && !hasProjectFrame(current) && <div data-testid="project-frame-missing" className={cn("flex flex-wrap items-center justify-between gap-3 rounded-xl border p-4 text-sm", indicatorBadge("warning"))}><span><strong>Projektet saknar tidsram.</strong> Ange start- och slutdatum så att uppgifter och planering kan följa projektets ram.</span>{canManage && can("projects", "edit") ? <Button size="sm" variant="outline" onClick={() => setEditing(true)}><CalendarDays />Ange tidsram</Button> : null}</div>}
      {frameIssues.length > 0 && <section data-testid="project-frame-issues" aria-label="Avvikelser mot projektets ramar" className={cn("rounded-xl border p-4 text-sm", indicatorBadge("warning"))}><p className="flex items-center gap-2 font-semibold"><AlertTriangle className="size-4" />Avvikelser mot projektets ramar</p><ul className="mt-2 space-y-1">{frameIssues.map((issue) => <li key={`${issue.taskId}-${issue.kind}`}><span className="font-medium">{issue.title}:</span> {issue.message}</li>)}</ul><p className="mt-2 text-xs opacity-80">Ändra uppgiften så att den följer projektet. Inget ändras automatiskt.</p></section>}
      {projectFieldRows(current).length > 0 && <Panel title="Projektets uppgifter" description="Gäller alla uppgifter i projektet och skrivs ut i rapporterna."><dl data-testid="project-fields" className="grid gap-3 text-sm sm:grid-cols-2">{projectFieldRows(current).map(([label, value]) => <div key={label} className={label === "Arbetsbeskrivning" ? "sm:col-span-2" : undefined}><dt className="text-xs text-muted-foreground">{label}</dt><dd className="mt-0.5 whitespace-pre-wrap">{value}</dd></div>)}</dl></Panel>}
      <Panel title="Projektprogression" description="Beräknas från uppgifternas verkliga status och innehåll – inga obligatoriska steg.">
        <div className="flex flex-wrap items-end justify-between gap-4"><div><p className="text-3xl font-semibold tracking-tight">{progress}%</p><p className="mt-1 text-sm text-muted-foreground">{status.label} · {currentTasks.length} {currentTasks.length === 1 ? "uppgift" : "uppgifter"}</p></div><div className="space-y-2 text-sm text-muted-foreground">{current.responsibleName && <p className="flex items-center gap-2"><UserRound className="size-4" />Ansvarig: {current.responsibleName}</p>}{hasProjectFrame(current) ? <p data-testid="project-frame" className="flex items-center gap-2"><CalendarDays className="size-4" />Tidsram {formatFrame(current)}</p> : current.dueDate ? <p className="flex items-center gap-2"><CalendarDays className="size-4" />Klart senast {current.dueDate}</p> : null}</div></div>
        <div className="mt-4 h-2 overflow-hidden rounded-full bg-muted" aria-label={`${progress} procent klart`}><div className={`h-full rounded-full transition-all ${indicatorBar(progressTone({ percent: progress }))}`} style={{ width: `${progress}%` }} /></div>
        <FrameAdherenceRow adherence={summarizeFrameAdherence({ startDate: current.startDate, dueDate: current.dueDate, completion: progress })} />
        <div className="mt-4 grid grid-cols-3 gap-2 text-center text-xs"><div className={cn("rounded-lg border p-2.5", indicatorBadge("neutral"))}><strong className="block text-lg text-foreground">{groups.planned.length}</strong>Planerade</div><div className={cn("rounded-lg border p-2.5", indicatorBadge("warning"))}><strong className="block text-lg">{groups.active.length}</strong>Pågående</div><div className={cn("rounded-lg border p-2.5", indicatorBadge("success"))}><strong className="block text-lg">{groups.done.length}</strong>Slutförda</div></div>
      </Panel>
      <PlanningPanel
        project={current}
        tasks={currentTasks}
        activities={plannedActivities.filter((activity) => activity.projectId === current.id && !activity.deletedAt)}
        availabilityActivities={plannedActivities}
        members={members}
        currentUserId={capacity?.currentUserId ?? ""}
        canViewTeamAvailability={Boolean(teamCapacity?.canViewTeam)}
        busy={busy}
        error={error}
        canFrameException={canFrameException}
        canCreate={can("projects", "create") && !locked}
        canEdit={(activity) => !locked && can("projects", "edit") && (!activity.workflowTaskId || (() => { const task = currentTasks.find((candidate) => candidate.id === activity.workflowTaskId); return Boolean(task && canEditTask(task)); })()) && (!activity.controlId || can("kfid", "edit"))}
        onSave={savePlannedActivity}
        onRemove={removePlannedActivity}
      />
      {!currentTasks.length && !archived && !closed && canCreateTask ? <ProjectStarter projectId={current.id} customerId={current.customerId}
        canCreate={{ workOrder: can("work-order", "create"), risk: can("risk-assessment", "create"), control: can("kfid", "create") }} /> : null}
      {/* One board instead of a numbered flow plus the same tasks again in status columns (Daniel 2026-09-26). */}
      <Panel title="Projektets arbetsflöde" description="Uppgifterna som faktiskt är kopplade till projektet, grupperade efter status.">
        <div className="grid items-start gap-3 lg:grid-cols-3">
          <TaskColumn title="Planerade" icon={<CircleDashed />} tasks={groups.planned} empty="Inget väntar på start." plannedMinutes={taskPlannedMinutes} />
          <TaskColumn title="Pågående" icon={<PlayCircle />} tasks={groups.active} empty="Ingen uppgift pågår." plannedMinutes={taskPlannedMinutes} />
          <TaskColumn title="Slutförda" icon={<CheckCircle2 />} tasks={groups.done} empty="Inget är slutfört ännu." plannedMinutes={taskPlannedMinutes} />
        </div>
      </Panel>
      <ProjectDecisionLog key={`decisions-${current.id}`} project={current} local={Boolean(local)} canAdd={!archived && can("projects", "edit")} onAdd={(decision) => addDecision(current.id, decision)} />
      <ProjectHistory key={current.id} project={current} local={Boolean(local)} />
      <Modal open={editing} onOpenChange={setEditing} title="Redigera projekt" className="max-w-2xl">
        <ProjectForm project={current} customers={customers} members={members} busy={busy} error={error} canEditFrame={canManage} tasks={currentTasks} activities={plannedActivities.filter((activity) => activity.projectId === current.id || currentTasks.some((task) => task.id === activity.workflowTaskId || task.id === activity.controlId))} onCancel={() => setEditing(false)} onSave={saveProject} />
      </Modal>
      <Modal open={reopening} onOpenChange={setReopening} title="Återuppta arbete" className="max-w-2xl">
        <p className="page-description mb-5">Välj hur arbetet ska fortsätta. En slutförd kontroll bevaras och kopieras med Spara som.</p>
        <div className="space-y-2">{groups.done.map((task) => <article key={task.id} className="flex items-center gap-3 rounded-xl border p-4"><div className="min-w-0 flex-1"><p className="font-medium">{task.title}</p><p className="text-xs text-muted-foreground">{taskTypeLabel(task)}</p></div>{task.kind ? canReopenTask(task) && <Button size="sm" variant="outline" disabled={busy} onClick={() => void reopenTask(task.id)}><RotateCcw />Återöppna</Button> : canEditTask(task) && <Button asChild size="sm" variant="outline"><Link href={taskHref(task)}>Öppna och välj Spara som</Link></Button>}</article>)}</div>
        {canCreateTask && <div className="mt-5 flex justify-end"><Button asChild><Link href={`/?view=new_task&projectId=${encodeURIComponent(current.id)}`}><Plus />Skapa ny uppgift</Link></Button></div>}
      </Modal>
      <Modal open={linking} onOpenChange={(open) => { setLinking(open); if (!open) { setLinkTarget(null); setCloudCandidates(null); } }} title="Koppla befintlig uppgift" className="max-w-2xl">
        {linkTarget ? <LinkGuide task={linkTarget} project={current} customers={customers} members={members} plannedCount={plannedActivities.filter((activity) => !activity.deletedAt && (activity.workflowTaskId === linkTarget.id || activity.controlId === linkTarget.id)).length} busy={busy} error={error} onBack={() => setLinkTarget(null)} onConfirm={(apply) => void linkTask(linkTarget, current.id, apply)} /> : <>
          <p className="page-description mb-5">Välj en fristående uppgift, eller flytta en uppgift från ett annat projekt. Innan kopplingen visas vad som skiljer sig från projektets ramar.</p>
          {error && <p role="alert" className="mb-4 text-sm text-destructive">{error}</p>}
          {!local && cloudCandidates === null ? <p role="status" className="text-sm text-muted-foreground">Hämtar uppgifter att koppla…</p> : linkCandidates(current.id).length ? <div className="max-h-[55vh] space-y-2 overflow-y-auto pr-1">{linkCandidates(current.id).map((task) => <article key={`${task.kind ?? "CONTROL"}-${task.id}`} className="flex items-center gap-3 rounded-xl border bg-card p-4"><span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary"><Link2 className="size-4" /></span><div className="min-w-0 flex-1"><p className="truncate text-sm font-semibold">{task.title}</p><p className="mt-1 text-xs text-muted-foreground">{taskTypeLabel(task)} · {task.fromProject ? `I projektet ${task.fromProject}` : task.status === "COMPLETED" ? "Slutförd" : "Fristående"}</p></div><Button size="sm" variant={task.fromProject ? "outline" : "default"} disabled={busy} onClick={() => setLinkTarget(task)}>{task.fromProject ? "Flytta hit" : "Koppla"}</Button></article>)}</div> : <Empty title="Inga uppgifter att koppla" description="Det finns inga fristående uppgifter eller uppgifter i andra öppna projekt. Du kan i stället skapa en ny uppgift." />}
        </>}
      </Modal>
    </div>;
  }
  return <ProjectsPage projects={projects} error={error} canCreate={can("projects", "create")} remote={remoteList} />;
}

// Paged project history (Daniel 2026-09-26): Cloud sends the newest ten events and a count; Local pages the open file.
function ProjectHistory({ project, local }: { project: WorkflowProject; local: boolean }) {
  const [older, setOlder] = useState<NonNullable<WorkflowProject["events"]>>([]);
  const [limit, setLimit] = useState(10);
  const [busy, setBusy] = useState(false);
  const all = [...(project.events ?? []), ...older].sort((left, right) => String(right.createdAt).localeCompare(String(left.createdAt)));
  const shown = local ? all.slice(0, limit) : all;
  const total = Math.max(project.eventCount ?? 0, all.length);
  const loadMore = async () => {
    if (local) return setLimit((current) => current + 20);
    setBusy(true);
    try {
      const oldest = all[all.length - 1]?.createdAt ?? "";
      const page = await api<{ events: NonNullable<WorkflowProject["events"]> }>(`/api/projects?eventsFor=${encodeURIComponent(project.id)}&before=${encodeURIComponent(oldest)}`);
      setOlder((current) => [...current, ...page.events]);
    } finally { setBusy(false); }
  };
  return <Panel title="Projekthistorik" description={total ? `${total} händelser, senaste först.` : "Viktiga förändringar i projektets livscykel."}>
    {shown.length ? <ol className="divide-y">{shown.map((event) => <li key={event.id} className="flex items-center gap-3 py-2 first:pt-0 last:pb-0"><span className="flex size-7 shrink-0 items-center justify-center rounded-full bg-secondary text-primary"><History className="size-3.5" /></span><div className="flex min-w-0 flex-1 flex-wrap items-baseline justify-between gap-x-3"><p className="text-sm font-medium">{event.summary}</p><p className="text-xs text-muted-foreground">{formatDateTime(event.createdAt)}{event.actorName ? ` · ${event.actorName}` : ""}</p></div></li>)}</ol> : <p className="text-sm text-muted-foreground">Ingen historik har registrerats ännu.</p>}
    <ShowMore shown={shown.length} total={total} busy={busy} onMore={() => void loadMore()} />
  </Panel>;
}

type ProjectDecision = NonNullable<WorkflowProject["decisions"]>[number];
type ProjectDecisionInput = Pick<ProjectDecision, "decidedOn" | "text" | "decidedBy">;

// The project's decision log (Daniel 2026-09-26): append-only, newest first, paged like the history.
function ProjectDecisionLog({ project, local, canAdd, onAdd }: { project: WorkflowProject; local: boolean; canAdd: boolean; onAdd: (decision: ProjectDecisionInput) => Promise<void> }) {
  const [older, setOlder] = useState<ProjectDecision[]>([]);
  const [limit, setLimit] = useState(10);
  const [busy, setBusy] = useState(false);
  const [adding, setAdding] = useState(false);
  const [form, setForm] = useState<ProjectDecisionInput>({ decidedOn: "", text: "", decidedBy: "" });
  const [formError, setFormError] = useState("");
  const all = [...(project.decisions ?? []), ...older].sort((left, right) => String(right.createdAt).localeCompare(String(left.createdAt)));
  const shown = local ? all.slice(0, limit) : all;
  const total = Math.max(project.decisionCount ?? (local ? all.length : 0), all.length);
  const loadMore = async () => {
    if (local) return setLimit((current) => current + 20);
    setBusy(true);
    try {
      const oldest = all[all.length - 1]?.createdAt ?? "";
      const page = await api<{ decisions: ProjectDecision[] }>(`/api/projects?decisionsFor=${encodeURIComponent(project.id)}&before=${encodeURIComponent(oldest)}`);
      setOlder((current) => [...current, ...page.decisions]);
    } finally { setBusy(false); }
  };
  const open = () => { setForm({ decidedOn: swedishDayKey(new Date()), text: "", decidedBy: "" }); setFormError(""); setAdding(true); };
  const save = async () => {
    setBusy(true); setFormError("");
    try { await onAdd({ decidedOn: form.decidedOn, text: form.text.trim(), decidedBy: form.decidedBy.trim() }); setAdding(false); }
    catch (issue) { setFormError((issue as Error).message); }
    finally { setBusy(false); }
  };
  return <Panel title="Beslutslogg" description={total ? `${total} beslut, senaste först. Beslut kan inte ändras eller tas bort.` : "Dokumentera beslut som påverkar projektet, t.ex. ändrad omfattning eller tidplan."}
    actions={canAdd ? <Button size="sm" variant="outline" onClick={open}><Plus />Nytt beslut</Button> : undefined}>
    {shown.length ? <ol data-testid="project-decisions" className="divide-y">{shown.map((decision) => <li key={decision.id} className="flex gap-3 py-2.5 first:pt-0 last:pb-0"><span className="flex size-7 shrink-0 items-center justify-center rounded-full bg-secondary text-primary"><CheckCircle2 className="size-3.5" /></span><div className="min-w-0 flex-1"><p className="whitespace-pre-wrap text-sm">{decision.text}</p><p className="mt-0.5 text-xs text-muted-foreground">{decision.decidedOn} · Beslutat av {decision.decidedBy}{decision.actorName ? ` · Registrerat av ${decision.actorName}` : ""}</p></div></li>)}</ol> : <p className="text-sm text-muted-foreground">Inga beslut har registrerats ännu.</p>}
    <ShowMore shown={shown.length} total={total} busy={busy} onMore={() => void loadMore()} />
    <Modal open={adding} onOpenChange={setAdding} title="Nytt beslut" className="max-w-lg">
      <form className="space-y-4" onSubmit={(event) => { event.preventDefault(); void save(); }}>
        <p className="page-description">Beslutet läggs till i projektets logg och kan inte ändras efteråt.</p>
        <div className="grid gap-4 sm:grid-cols-2">
          <label className="block space-y-2 text-xs font-medium text-muted-foreground">Datum<Input type="date" value={form.decidedOn} onChange={(event) => setForm({ ...form, decidedOn: event.target.value })} required /></label>
          <label className="block space-y-2 text-xs font-medium text-muted-foreground">Beslutat av<Input value={form.decidedBy} onChange={(event) => setForm({ ...form, decidedBy: event.target.value })} maxLength={160} required placeholder="Namn eller funktion" /></label>
        </div>
        <label className="block space-y-2 text-xs font-medium text-muted-foreground">Beslut<textarea className="form-textarea" value={form.text} onChange={(event) => setForm({ ...form, text: event.target.value })} maxLength={2000} required /></label>
        {formError && <p role="alert" className="text-sm text-destructive">{formError}</p>}
        <div className="flex justify-end gap-2"><Button type="button" variant="outline" onClick={() => setAdding(false)}>Avbryt</Button><Button type="submit" disabled={busy}>Spara beslut</Button></div>
      </form>
    </Modal>
  </Panel>;
}

function formatMinutes(minutes: number) {
  const rounded = Math.max(0, Math.round(minutes));
  const hours = Math.floor(rounded / 60);
  const rest = rounded % 60;
  return rest ? `${hours} h ${rest} min` : `${hours} h`;
}

function formatDateTime(value: string) {
  return formatSwedish(value, { dateStyle: "medium", timeStyle: "short" });
}

// datetime-local fields show and are read as Swedish time, whatever the browser's time zone.
function localDateTimeValue(value?: string) {
  return toSwedishDateTimeInput(value ? new Date(value) : new Date());
}
const inputInstant = (value: string) => fromSwedishDateTimeInput(value) ?? new Date(Number.NaN);

function planningKindLabel(kind: PlannedActivity["kind"]) {
  return kind === "MEETING" ? "Möte" : kind === "DEADLINE" ? "Deadline" : kind === "OTHER" ? "Övrigt" : "Arbete";
}

function planningStatusLabel(status: PlannedActivity["status"]) {
  return status === "COMPLETED" ? "Slutförd" : status === "CANCELED" ? "Inställd" : status === "IN_PROGRESS" ? "Pågår" : "Planerad";
}

type PlanningCalendarColorBy = "status" | "project" | "assignee";

const planningCalendarPaletteTone = personSurfaceTone;

// Project responsible first, then assignees of linked tasks; keyed by member id so colors match the calendar.
function projectPeople(project: WorkflowProject) {
  const people = new Map<string, string>();
  const add = (key: string | null | undefined, name: string | null | undefined) => { const label = name?.trim(); if (label && !people.has(key || label)) people.set(key || label, label); };
  add(project.responsibleUserId, project.responsibleName);
  for (const task of projectTasks(project)) add(task.assignedToUserId, task.assignedToName);
  return [...people].map(([key, name]) => ({ key, name }));
}

function PersonAvatars({ people, max = 4 }: { people: { key: string; name: string }[]; max?: number }) {
  if (!people.length) return <span className="text-xs text-muted-foreground">Ingen ansvarig</span>;
  return <div className="flex items-center" data-testid="project-people">
    <span className="sr-only">Medarbetare: {people.map((person) => person.name).join(", ")}</span>
    {people.slice(0, max).map((person, index) => <span key={person.key} aria-hidden="true" title={person.name} className={cn("flex size-7 items-center justify-center rounded-full text-[11px] font-semibold text-white ring-2 ring-card", personSolidTone(person.key), index ? "-ml-2" : "")}>{personInitials(person.name)}</span>)}
    {people.length > max ? <span aria-hidden="true" className="-ml-2 flex size-7 items-center justify-center rounded-full border-2 border-border bg-muted text-[11px] font-semibold text-muted-foreground ring-2 ring-card">+{people.length - max}</span> : null}
  </div>;
}

function planningCalendarActivityTone(activity: PlannedActivity, colorBy: PlanningCalendarColorBy) {
  if (colorBy === "project") return planningCalendarPaletteTone(activity.projectId ?? "no-project");
  if (colorBy === "assignee") return planningCalendarPaletteTone(activity.assignedToUserIds[0] ?? activity.assignedToUserId ?? activity.assignedToName ?? "unallocated");
  return activity.status === "COMPLETED"
    ? "border-emerald-500 bg-emerald-50 text-emerald-950 dark:bg-emerald-950 dark:text-emerald-100"
    : activity.status === "CANCELED"
      ? "border-muted-foreground bg-muted text-muted-foreground"
      : activity.status === "IN_PROGRESS"
        ? "border-sky-500 bg-sky-50 text-sky-950 dark:bg-sky-950 dark:text-sky-100"
        : "border-primary bg-secondary text-secondary-foreground";
}

function PlanningOverview({ canCreateTask = false, activities, projects, contextTasks, members, capacity, teamCapacity, busy, error, canCreate, canEdit, canReadTask, canFrameException, onSave, onRemove }: { canCreateTask?: boolean; canFrameException?: (project: WorkflowProject) => boolean; activities: PlannedActivity[]; projects: WorkflowProject[]; contextTasks: WorkflowTask[]; members: ProjectMember[]; capacity: PlanningCapacity | null; teamCapacity: PlanningTeamCapacity | null; busy: boolean; error: string; canCreate: boolean; canEdit: (activity: PlannedActivity) => boolean; canReadTask: (task: WorkflowTask) => boolean; onSave: (input: PlannedActivityInput) => Promise<{ id: string; version: number }>; onRemove: (id: string, version: number) => Promise<void> }) {
  const [projectId, setProjectId] = useState("all");
  // Empty selection means every visible responsible; "unallocated" is a selectable pseudo-member.
  const [assignedTo, setAssignedTo] = useState<string[]>([]);
  const [taskId, setTaskId] = useState("all");
  const [audience, setAudience] = useState<"all" | "mine" | "team">("all");
  const [status, setStatus] = useState<"all" | PlannedActivity["status"]>("all");
  const [scope, setScope] = useState<"upcoming" | "all" | "past">("upcoming");
  const [calendarColorBy, setCalendarColorBy] = useState<PlanningCalendarColorBy>("status");
  const [calendarDefaults, setCalendarDefaults] = useState<{ startsAt: Date; endsAt: Date } | null>(null);
  const [calendarEditing, setCalendarEditing] = useState<PlannedActivity | null>(null);
  const [calendarDeleting, setCalendarDeleting] = useState<PlannedActivity | null>(null);
  const [now] = useState(() => new Date());
  const projectById = useMemo(() => new Map(projects.map((project) => [project.id, project])), [projects]);
  const horizon = useMemo(() => new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000), [now]);
  const upcoming = activities.filter((activity) => !activity.deletedAt && new Date(activity.endsAt) >= now && new Date(activity.startsAt) <= horizon).length;
  const active = activities.filter((activity) => !activity.deletedAt && activity.status === "IN_PROGRESS").length;
  const projectName = (activity: PlannedActivity) => activity.project?.name ?? (activity.projectId ? projectById.get(activity.projectId)?.name : undefined) ?? "Utan projekt";
  const weeklyCapacity = useMemo(() => capacity ? summarizeWeeklyCapacity({
    anchor: now,
    weeklyWorkMinutes: capacity.weeklyWorkMinutes,
    userId: capacity.currentUserId,
    activities,
    timeEntries: capacity.timeEntries,
  }) : null, [activities, capacity, now]);
  const plannedByProject = useMemo(() => plannedMinutesByProject(activities), [activities]);
  const availability = useMemo(() => summarizeAvailability(activities), [activities]);
  const [moveNotice, setMoveNotice] = useState<{ text: string; tone: "info" | "warning" | "error" } | null>(null);
  // Drag-and-drop only reschedules planned time through the ordinary versioned save; reported time is untouched.
  async function moveActivity(activity: PlannedActivity, day: Date) {
    if (!canEdit(activity)) return;
    const moved = movePlannedActivityToDay(activity, day);
    if (!moved) return;
    const dayText = formatSwedish(day, { weekday: "long", day: "numeric", month: "long" });
    try {
      await onSave({ id: activity.id, version: activity.version, title: activity.title, description: activity.description, kind: activity.kind, status: activity.status,
        startsAt: moved.startsAt, endsAt: moved.endsAt, projectId: activity.projectId, workflowTaskId: activity.workflowTaskId, controlId: activity.controlId,
        assignedToUserId: activity.assignedToUserId, assignedToUserIds: activity.assignedToUserIds, assignedToName: activity.assignedToName, assignments: moved.assignments });
      const conflicts = summarizeAvailability(activities.map((item) => item.id === activity.id ? { ...item, ...moved } : item)).conflicts
        .filter((conflict) => (conflict.first.activityId === activity.id || conflict.second.activityId === activity.id) && (Boolean(teamCapacity?.canViewTeam) || conflict.userId === currentUserId));
      setMoveNotice(conflicts.length
        ? { tone: "warning", text: `${activity.title} flyttades till ${dayText}. Tidskrock: ${conflicts.map((conflict) => (conflict.first.activityId === activity.id ? conflict.second : conflict.first).title).join(", ")}. Flytten är sparad; varningen är rådgivande.` }
        : { tone: "info", text: `${activity.title} flyttades till ${dayText}.` });
    } catch (issue) {
      setMoveNotice({ tone: "error", text: (issue as Error).message });
    }
  }
  const portfolio = useMemo(() => projects.filter((project) => !project.archivedAt).map((project) => ({
    project,
    plannedMinutes: plannedByProject.get(project.id) ?? 0,
    budget: summarizeProjectBudget(project.timeBudgetMinutes, projectTasks(project).reduce((sum, task) => sum + (task.totalDurationSec ?? 0), 0)),
  })).filter(({ plannedMinutes, budget }) => plannedMinutes || budget.hasBudget || budget.reportedMinutes), [plannedByProject, projects]);
  // New planning only targets projects that still accept work (not closed, not archived).
  const planningProjects = useMemo(() => projects.filter(projectAcceptsWork), [projects]);
  const planningTasks = useMemo(() => {
    const byId = new Map(contextTasks.map((task) => [task.id, task]));
    for (const project of planningProjects)
      for (const task of projectTasks(project))
        byId.set(task.id, { ...task, projectId: task.projectId ?? project.id });
    return [...byId.values()];
  }, [contextTasks, planningProjects]);
  const planningTaskOptions = useMemo(() => {
    const referencedTaskIds = new Set(activities.flatMap((activity) => [activity.workflowTaskId, activity.controlId]).filter((id): id is string => Boolean(id)));
    return planningTasks.filter((task) => referencedTaskIds.has(task.id));
  }, [activities, planningTasks]);
  const currentUserId = capacity?.currentUserId ?? "";
  const canQuickFilterTeam = Boolean(teamCapacity?.canViewTeam && teamCapacity.members.some((member) => member.id !== currentUserId));
  // Daniel 2026-09-25: "Tidsperiod" narrows only the list; the calendar shows whatever period it is navigated to.
  const calendarVisible = useMemo(() => activities
    .filter((activity) => !activity.deletedAt)
    .filter((activity) => projectId === "all" || activity.projectId === projectId)
    .filter((activity) => taskId === "all" || activity.workflowTaskId === taskId || activity.controlId === taskId)
    .filter((activity) => audience === "all" || (audience === "mine" ? Boolean(currentUserId) && activity.assignedToUserIds.includes(currentUserId) : activity.assignedToUserIds.length > 0))
    .filter((activity) => !assignedTo.length || (assignedTo.includes("unallocated") && !activity.assignedToUserIds.length && !activity.assignedToName) || activity.assignedToUserIds.some((userId) => assignedTo.includes(userId)))
    .filter((activity) => status === "all" || activity.status === status)
    .sort((left, right) => left.startsAt.localeCompare(right.startsAt)), [activities, assignedTo, audience, currentUserId, projectId, status, taskId]);
  const visible = useMemo(() => calendarVisible
    .filter((activity) => scope === "all" || (scope === "upcoming" ? new Date(activity.endsAt) >= now && new Date(activity.startsAt) <= horizon : new Date(activity.endsAt) < now)), [calendarVisible, horizon, now, scope]);
  const toggleAssignee = (id: string) => setAssignedTo((current) => current.includes(id) ? current.filter((item) => item !== id) : [...current, id]);
  return <div className="space-y-6">
    <div className="flex flex-wrap items-start justify-between gap-4"><div><h1 className="page-title">Planering</h1><p className="page-description mt-2">Kommande arbete, möten och deadlines. Planering är separat från rapporterad tid.</p></div><div className="flex flex-wrap gap-2"><Button asChild variant="outline"><Link href="/?view=projects"><FolderKanban />Mina projekt</Link></Button>{canCreate ? <Button type="button" onClick={() => setCalendarDefaults(planningDefaultInterval(new Date()))}><Plus />Ny planering</Button> : null}</div></div>
    {/* One shared selection for calendar and list; it only narrows activities the user may already see. */}
    <section aria-label="Urval för planering" className="space-y-3">
      <div className="flex flex-wrap items-center gap-2" data-testid="planning-assignee-filter">
        <div className="flex flex-wrap gap-1 rounded-full border bg-card p-1" aria-label="Planeringsurval">{([["all", "Alla synliga"], ["mine", "Mina aktiviteter"], ...(canQuickFilterTeam ? [["team", "Teamets synliga"] as const] : [])] as const).map(([value, label]) => <Button key={value} type="button" size="sm" className="h-7 rounded-full" variant={audience === value ? "default" : "ghost"} onClick={() => setAudience(value)}>{label}</Button>)}</div>
        <span className="mx-1 hidden h-6 w-px bg-border sm:block" aria-hidden="true" />
        <div role="group" aria-label="Ansvariga" className="flex flex-wrap gap-2">{[...members, { id: "unallocated", name: "Oallokerad" }].map((member) => { const pressed = assignedTo.includes(member.id); return <button key={member.id} type="button" aria-pressed={pressed} onClick={() => toggleAssignee(member.id)} className={cn("inline-flex h-8 items-center gap-2 rounded-full border px-3 text-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring", pressed ? "border-primary bg-secondary font-medium text-secondary-foreground" : "bg-card hover:border-primary/40 hover:bg-secondary hover:text-secondary-foreground")}><span aria-hidden="true" className={cn("size-2.5 rounded-full", member.id === "unallocated" ? "bg-muted-foreground/50" : personSolidTone(member.id))} />{member.name}</button>; })}</div>
        {assignedTo.length ? <Button type="button" size="sm" variant="ghost" onClick={() => setAssignedTo([])}>Visa alla ansvariga</Button> : null}
      </div>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5"><div className="space-y-1"><label htmlFor="planning-scope" className="block text-xs font-medium text-muted-foreground">Tidsperiod</label><select id="planning-scope" className="form-select" value={scope} onChange={(event) => setScope(event.target.value as typeof scope)}><option value="upcoming">Kommande 30 dagar</option><option value="all">Alla datum</option><option value="past">Tidigare aktiviteter</option></select></div><div className="space-y-1"><label htmlFor="planning-project" className="block text-xs font-medium text-muted-foreground">Projekt</label><select id="planning-project" className="form-select" value={projectId} onChange={(event) => setProjectId(event.target.value)}><option value="all">Alla projekt</option>{projects.filter((project) => !project.archivedAt).map((project) => <option key={project.id} value={project.id}>{project.name}</option>)}</select></div><div className="space-y-1"><label htmlFor="planning-task" className="block text-xs font-medium text-muted-foreground">Uppgift</label><select id="planning-task" className="form-select" value={taskId} onChange={(event) => setTaskId(event.target.value)}><option value="all">Alla uppgifter</option>{planningTaskOptions.map((task) => <option key={task.id} value={task.id}>{taskTypeLabel(task)} · {task.title}</option>)}</select></div><div className="space-y-1"><label htmlFor="planning-status" className="block text-xs font-medium text-muted-foreground">Status</label><select id="planning-status" className="form-select" value={status} onChange={(event) => setStatus(event.target.value as typeof status)}><option value="all">Alla statusar</option><option value="PLANNED">Planerad</option><option value="IN_PROGRESS">Pågår</option><option value="COMPLETED">Slutförd</option><option value="CANCELED">Inställd</option></select></div><div className="space-y-1"><label htmlFor="planning-calendar-color" className="block text-xs font-medium text-muted-foreground">Kalenderfärg</label><select id="planning-calendar-color" data-testid="planning-calendar-color" className="form-select" value={calendarColorBy} onChange={(event) => setCalendarColorBy(event.target.value as PlanningCalendarColorBy)}><option value="status">Efter status</option><option value="project">Efter projekt</option><option value="assignee">Efter ansvarig</option></select></div></div>
    </section>
    <PlanningCalendar canCreateTask={canCreateTask} activities={calendarVisible}capacityActivities={teamCapacity?.canViewTeam ? teamCapacity.activities : activities} currentUserId={currentUserId} weeklyWorkMinutes={capacity?.weeklyWorkMinutes ?? null} teamMemberIds={canQuickFilterTeam ? teamCapacity!.members.map((member) => member.id) : []} members={members} conflicts={availability.conflicts} canViewTeamAvailability={Boolean(teamCapacity?.canViewTeam)} projects={projects} tasks={planningTasks} colorBy={calendarColorBy} canCreate={canCreate} canEdit={canEdit} canReadTask={canReadTask} onPlanDay={(day) => setCalendarDefaults(planningDefaultInterval(day))} onEdit={(activity) => setCalendarEditing(activity)} onDelete={(activity) => setCalendarDeleting(activity)} onMove={moveActivity} busy={busy} moveNotice={moveNotice} />
    <div className="grid gap-3 sm:grid-cols-3"><div className="rounded-xl border bg-muted/40 p-4"><p className="text-xs font-medium text-muted-foreground">Kommande 30 dagar</p><p className="mt-1 text-2xl font-semibold">{upcoming}</p></div><div className="rounded-xl border bg-sky-50 p-4 text-sky-900 dark:bg-sky-950 dark:text-sky-100"><p className="text-xs font-medium opacity-80">Pågår</p><p className="mt-1 text-2xl font-semibold">{active}</p></div><div className="rounded-xl border bg-muted/40 p-4"><p className="text-xs font-medium text-muted-foreground">Alla planeringar</p><p className="mt-1 text-2xl font-semibold">{activities.filter((activity) => !activity.deletedAt).length}</p></div></div>
    <Panel title="Min kapacitet denna vecka" description="Planerad tid jämförs med din ordinarie veckoarbetstid. Rapporterad tid visas separat och dras aldrig automatiskt av från planeringen.">
      {weeklyCapacity ? <>
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          <div className="rounded-xl border bg-muted/40 p-4"><p className="text-xs font-medium text-muted-foreground">Veckomål</p><p className="mt-1 text-xl font-semibold">{formatMinutes(weeklyCapacity.weeklyWorkMinutes)}</p><p className="mt-1 text-xs text-muted-foreground">{formatSwedish(weeklyCapacity.startsAt, { day: "numeric", month: "short" })}–{formatSwedish(new Date(weeklyCapacity.endsAt.getTime() - 1), { day: "numeric", month: "short" })}</p></div>
          <div className="rounded-xl border bg-primary/20 bg-primary/5 p-4"><p className="text-xs font-medium text-primary">Planerad tid</p><p className="mt-1 text-xl font-semibold">{formatMinutes(weeklyCapacity.plannedMinutes)}</p><p className="mt-1 text-xs text-muted-foreground">{weeklyCapacity.plannedPercent}% av veckomålet</p></div>
          <div className={`rounded-xl border p-4 ${weeklyCapacity.overplannedMinutes ? "border-amber-300 bg-amber-50 text-amber-900 dark:bg-amber-950 dark:text-amber-100" : "bg-muted/40"}`}><p className="text-xs font-medium opacity-80">{weeklyCapacity.overplannedMinutes ? "Överbokad" : "Kvar att planera"}</p><p className="mt-1 text-xl font-semibold">{formatMinutes(weeklyCapacity.overplannedMinutes || weeklyCapacity.remainingPlannedMinutes)}</p><p className="mt-1 text-xs opacity-80">Endast planerade aktiviteter</p></div>
          <div className="rounded-xl border bg-sky-50 p-4 text-sky-900 dark:bg-sky-950 dark:text-sky-100"><p className="text-xs font-medium opacity-80">Rapporterad tid</p><p className="mt-1 text-xl font-semibold">{formatMinutes(weeklyCapacity.reportedMinutes)}</p><p className="mt-1 text-xs opacity-80">Faktisk tid denna vecka</p></div>
        </div>
        <div className="mt-4 h-2 overflow-hidden rounded-full bg-muted" aria-label={`${weeklyCapacity.plannedPercent} procent av veckans planeringskapacitet`}><div className={`h-full rounded-full ${weeklyCapacity.overplannedMinutes ? "bg-amber-500" : "bg-primary"}`} style={{ width: `${weeklyCapacity.plannedPercent}%` }} /></div>
        {weeklyCapacity.unassignedPlannedMinutes ? <p className="mt-3 rounded-lg border border-dashed p-3 text-xs text-muted-foreground">{formatMinutes(weeklyCapacity.unassignedPlannedMinutes)} planerad tid saknar ansvarig och räknas därför inte mot din personliga kapacitet.</p> : null}
      </> : <p className="text-sm text-muted-foreground">Din arbetstid och rapporterade tid läses in.</p>}
    </Panel>
    {teamCapacity?.canViewTeam ? <TeamCapacityPanel teamCapacity={teamCapacity} anchor={now} /> : null}
    {capacity ? <AvailabilityPanel conflicts={availability.conflicts} currentUserId={capacity.currentUserId} canViewTeam={Boolean(teamCapacity?.canViewTeam)} members={members} /> : null}
    {portfolio.length ? <Panel title="Projektbudget och planerad tid" description="Projektbudget bygger på faktisk rapporterad tid. Planerade aktiviteter visas bredvid som en egen prognos och ändrar aldrig budgetutfallet.">
      <ol className="divide-y rounded-xl border">{portfolio.map(({ project, plannedMinutes, budget }) => <li key={project.id} className="flex flex-wrap items-center gap-4 p-4"><div className="min-w-0 flex-1"><Link href={`/?view=project&projectId=${encodeURIComponent(project.id)}`} className="text-sm font-semibold hover:text-primary hover:underline">{project.name}</Link><p className="mt-1 text-xs text-muted-foreground">Planerat totalt: {formatMinutes(plannedMinutes)} · Rapporterat totalt: {formatMinutes(budget.reportedMinutes)}{budget.hasBudget ? ` av ${formatMinutes(budget.budgetMinutes)}` : " · ingen tidsbudget"}</p></div>{budget.hasBudget ? <div className="w-full sm:w-44"><div className="flex justify-between text-xs text-muted-foreground"><span>Budget</span><span className={budget.isOverBudget || budget.isHighUsage ? `font-semibold ${indicatorText(budgetTone(budget))}` : "font-medium text-foreground"}>{budget.percentUsed}%</span></div><div className="mt-2 h-1.5 overflow-hidden rounded-full bg-muted"><div className={`h-full rounded-full ${indicatorBar(budgetTone(budget))}`} style={{ width: `${budget.percentUsed}%` }} /></div></div> : null}</li>)}</ol>
    </Panel> : null}
    <Panel title="Planerade aktiviteter" description="Samma urval som kalendern, avgränsat med Tidsperiod. Det ändrar aldrig planering eller rapporterad tid.">
      {visible.length ? <ol data-testid="planning-overview-list" className="divide-y rounded-xl border">{visible.map((activity) => <li key={activity.id} className="p-4"><div className="flex flex-wrap items-start gap-3"><span className="mt-0.5 flex size-10 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary"><CalendarDays className="size-4" /></span><div className="min-w-0 flex-1"><div className="flex flex-wrap items-center gap-2"><p className="text-sm font-semibold">{activity.title}</p><Badge variant="outline" className={indicatorBadge(activity.status === "PLANNED" ? "info" : statusTone(activity.status))}>{planningStatusLabel(activity.status)}</Badge><span className="text-xs text-muted-foreground">{planningKindLabel(activity.kind)}</span></div><p className="mt-1 text-sm text-muted-foreground">{formatDateTime(activity.startsAt)} – {formatDateTime(activity.endsAt)}</p><p className="mt-1 text-xs text-muted-foreground">{projectName(activity)}{activity.assignedToName ? ` · ${activity.assignedToName}` : ""}</p>{activity.description && <p className="mt-2 text-sm text-muted-foreground">{activity.description}</p>}</div>{activity.projectId && <Button asChild size="sm" variant="ghost"><Link href={`/?view=project&projectId=${encodeURIComponent(activity.projectId)}`}>Öppna projekt<ArrowRight /></Link></Button>}</div></li>)}</ol> : <Empty title="Inga aktiviteter matchar urvalet" description="Ändra tidsperiod eller filter för att se andra planerade aktiviteter." />}
    </Panel>
    <Modal open={Boolean(calendarDefaults)} onOpenChange={(open) => { if (!open) setCalendarDefaults(null); }} title="Ny planering" className="max-w-2xl">
      {calendarDefaults ? <><p className="page-description mb-5">Datumet är förifyllt till 08:00–09:00. Granska och ändra uppgifterna innan du sparar.</p><PlannedActivityForm projects={planningProjects} tasks={planningTasks} members={members} availabilityActivities={activities} currentUserId={currentUserId} canViewTeamAvailability={Boolean(teamCapacity?.canViewTeam)} canFrameException={canFrameException} defaultStartsAt={calendarDefaults.startsAt} defaultEndsAt={calendarDefaults.endsAt} busy={busy} error={error} onCancel={() => setCalendarDefaults(null)} onSave={async (input) => { await onSave(input); setCalendarDefaults(null); }} /></> : null}
    </Modal>
    <Modal open={Boolean(calendarEditing)} onOpenChange={(open) => { if (!open) setCalendarEditing(null); }} title="Redigera planering" className="max-w-2xl">
      {calendarEditing ? <><p className="page-description mb-5">Ändringen sparas med den aktuella versionen. Om någon annan redan har ändrat planeringen visas en konflikt i stället för att skriva över.</p><PlannedActivityForm projects={planningProjects} tasks={planningTasks} members={members} availabilityActivities={activities} currentUserId={currentUserId} canViewTeamAvailability={Boolean(teamCapacity?.canViewTeam)} canFrameException={canFrameException} activity={calendarEditing} busy={busy} error={error} onCancel={() => setCalendarEditing(null)} onSave={async (input) => { await onSave(input); setCalendarEditing(null); }} /></> : null}
    </Modal>
    <Modal open={Boolean(calendarDeleting)} onOpenChange={(open) => { if (!open) setCalendarDeleting(null); }} title="Ta bort planering" className="max-w-lg">
      {calendarDeleting ? <div className="space-y-5"><p className="text-sm text-muted-foreground">Ta bort <strong className="text-foreground">{calendarDeleting.title}</strong>? Planeringen tas bort från kalendern men dess revisionshistorik bevaras.</p>{error ? <p role="alert" className="text-sm text-destructive">{error}</p> : null}<div className="flex flex-wrap justify-end gap-2"><Button type="button" variant="outline" onClick={() => setCalendarDeleting(null)}>Avbryt</Button><Button type="button" variant="destructive" disabled={busy} onClick={() => void onRemove(calendarDeleting.id, calendarDeleting.version).then(() => setCalendarDeleting(null))}><Trash2 />Ta bort planering</Button></div></div> : null}
    </Modal>
  </div>;
}

function PlanningCalendar({ canCreateTask = false, activities, capacityActivities, currentUserId, weeklyWorkMinutes, teamMemberIds, members, conflicts, canViewTeamAvailability, projects, tasks, colorBy, canCreate, canEdit, canReadTask, onPlanDay, onEdit, onDelete, onMove, busy = false, moveNotice = null }: { canCreateTask?: boolean; activities: PlannedActivity[]; capacityActivities: CapacityActivity[]; currentUserId: string; weeklyWorkMinutes: number | null; teamMemberIds: string[]; members: ProjectMember[]; conflicts: ReturnType<typeof summarizeAvailability>["conflicts"]; canViewTeamAvailability: boolean; projects: WorkflowProject[]; tasks: WorkflowTask[]; colorBy: PlanningCalendarColorBy; canCreate: boolean; canEdit: (activity: PlannedActivity) => boolean; canReadTask: (task: WorkflowTask) => boolean; onPlanDay: (day: Date) => void; onEdit: (activity: PlannedActivity) => void; onDelete: (activity: PlannedActivity) => void; onMove?: (activity: PlannedActivity, startDay: Date) => void; busy?: boolean; moveNotice?: { text: string; tone: "info" | "warning" | "error" } | null }) {
  const [mode, setMode] = useState<PlanningCalendarMode>("month");
  const [anchor, setAnchor] = useState(() => new Date());
  const [selected, setSelected] = useState<PlannedActivity | null>(null);
  const [dragging, setDragging] = useState<{ id: string; fromDay: Date } | null>(null);
  const [dropTarget, setDropTarget] = useState<string | null>(null);
  const canDrag = (activity: PlannedActivity) => Boolean(onMove) && !busy && mode !== "day" && canEdit(activity);
  const dropOn = (day: Date) => {
    const activity = dragging ? activities.find((item) => item.id === dragging.id) : undefined;
    setDragging(null); setDropTarget(null);
    if (!activity || !onMove) return;
    // Move by the number of days dragged, so a multi-day activity can be grabbed on any of its days.
    const days = swedishDayDifference(dragging!.fromDay, day);
    if (!days) return;
    onMove(activity, addSwedishDays(startOfSwedishDay(activity.startsAt), days));
  };
  const days = useMemo(() => planningCalendarDays(anchor, mode), [anchor, mode]);
  const conflictedActivityIds = useMemo(() => new Set(conflicts.flatMap((conflict) => [conflict.first.activityId, conflict.second.activityId])), [conflicts]);
  const dayLabel = new Intl.DateTimeFormat("sv-SE", { weekday: "short", timeZone: SWEDISH_TIME_ZONE });
  const timeLabel = new Intl.DateTimeFormat("sv-SE", { hour: "2-digit", minute: "2-digit", timeZone: SWEDISH_TIME_ZONE });
  const today = new Date();
  const selectedProject = selected?.projectId ? projects.find((project) => project.id === selected.projectId) : undefined;
  const selectedProjectTasks = selectedProject ? projectTasks(selectedProject) : [];
  const selectedProjectBudget = selectedProject ? summarizeProjectBudget(selectedProject.timeBudgetMinutes, selectedProjectTasks.reduce((sum, task) => sum + (task.totalDurationSec ?? 0), 0)) : null;
  const selectedTaskId = selected?.workflowTaskId ?? selected?.controlId ?? null;
  const selectedTask = selectedTaskId ? tasks.find((task) => task.id === selectedTaskId) : undefined;
  const timeReportHref = selectedTask?.kind ? `/?view=time&timeTaskId=${encodeURIComponent(selectedTask.id)}` : null;
  const memberNameById = useMemo(() => new Map(members.map((member) => [member.id, member.name])), [members]);
  const selectedAssignments = selected ? plannedActivityAssignments(selected) : [];
  const selectedDurationMinutes = selected ? Math.max(0, Math.round((new Date(selected.endsAt).getTime() - new Date(selected.startsAt).getTime()) / 60_000)) : 0;
  const selectedConflictsByUserId = useMemo(() => {
    const byUserId = new Map<string, ReturnType<typeof summarizeAvailability>["conflicts"]>();
    if (!selected) return byUserId;
    for (const conflict of conflicts) {
      if (!canViewTeamAvailability && conflict.userId !== currentUserId) continue;
      if (conflict.first.activityId !== selected.id && conflict.second.activityId !== selected.id) continue;
      byUserId.set(conflict.userId, [...(byUserId.get(conflict.userId) ?? []), conflict]);
    }
    return byUserId;
  }, [canViewTeamAvailability, conflicts, currentUserId, selected]);
  const capacityByDay = useMemo(() => new Map(days.map((day) => {
    const startsAt = startOfSwedishDay(day);
    const endsAt = addSwedishDays(startsAt, 1);
    const ownMinutes = currentUserId ? plannedMinutesForUserInWindow({ activities: capacityActivities, userId: currentUserId, startsAt, endsAt }) : 0;
    const teamMinutes = teamMemberIds.reduce((sum, userId) => sum + plannedMinutesForUserInWindow({ activities: capacityActivities, userId, startsAt, endsAt }), 0);
    return [swedishDayKey(startsAt), { ownMinutes, teamMinutes }];
  })), [capacityActivities, currentUserId, days, teamMemberIds]);
  const weeklyCalendarCapacity = useMemo(() => mode === "week" && currentUserId && weeklyWorkMinutes !== null
    ? summarizeWeeklyCapacity({ anchor, weeklyWorkMinutes, userId: currentUserId, activities: capacityActivities, timeEntries: [] })
    : null, [anchor, capacityActivities, currentUserId, mode, weeklyWorkMinutes]);
  const weeklyTeamMinutes = useMemo(() => mode === "week" ? [...capacityByDay.values()].reduce((sum, day) => sum + day.teamMinutes, 0) : 0, [capacityByDay, mode]);
  return <Panel title="Planeringskalender" description={canCreate ? "Klicka på en dag för att planera och på en aktivitet för detaljer. Inget sparas förrän du väljer Skapa planering." : "Läsande dag-, vecko- och månadsvy av samma planering. Planerad och rapporterad tid är separata."}
    actions={<div className="flex items-center gap-1 rounded-lg border bg-muted/40 p-1" aria-label="Kalenderintervall">{(["day", "week", "month"] as const).map((item) => <Button key={item} size="sm" className="h-7" variant={mode === item ? "default" : "ghost"} onClick={() => setMode(item)}>{item === "day" ? "Dag" : item === "week" ? "Vecka" : "Månad"}</Button>)}</div>}>
    <div className="mb-3 flex flex-wrap items-center justify-between gap-3"><p className="text-lg font-semibold capitalize">{planningCalendarTitle(anchor, mode)}</p><div className="flex items-center gap-1"><Button size="icon" variant="ghost" aria-label="Föregående period" onClick={() => setAnchor((current) => movePlanningCalendar(current, mode, -1))}><ChevronLeft /></Button><Button size="sm" variant="outline" onClick={() => setAnchor(new Date())}>Idag</Button><Button size="icon" variant="ghost" aria-label="Nästa period" onClick={() => setAnchor((current) => movePlanningCalendar(current, mode, 1))}><ChevronRight /></Button></div></div>
    {weeklyCalendarCapacity ? <div data-testid="calendar-week-capacity" className={`mb-3 inline-flex rounded-full border px-3 py-1 text-xs ${weeklyCalendarCapacity.overplannedMinutes ? "border-amber-300 bg-amber-50 text-amber-900 dark:bg-amber-950 dark:text-amber-100" : "border-primary/20 bg-secondary text-secondary-foreground"}`}><span className="font-medium">Min planering: {formatMinutes(weeklyCalendarCapacity.plannedMinutes)} av {formatMinutes(weeklyCalendarCapacity.weeklyWorkMinutes)}</span><span className="opacity-80">&nbsp;· {weeklyCalendarCapacity.plannedPercent}%</span>{teamMemberIds.length ? <span className="opacity-80">&nbsp;· Team: {formatMinutes(weeklyTeamMinutes)}</span> : null}</div> : null}
    {moveNotice ?<p data-testid="planning-move-notice" role={moveNotice.tone === "error" ? "alert" : "status"} className={cn("mb-3 flex items-start gap-2 rounded-lg border px-3 py-2 text-xs", moveNotice.tone === "warning" ? "border-amber-200 bg-amber-50/60 text-amber-950 dark:border-amber-900 dark:bg-amber-950/30 dark:text-amber-100" : moveNotice.tone === "error" ? "border-destructive/30 bg-destructive/5 text-destructive" : "border-primary/20 bg-primary/5 text-foreground")}>{moveNotice.tone === "warning" ? <AlertTriangle className="mt-0.5 size-4 shrink-0 text-amber-600 dark:text-amber-300" /> : null}{moveNotice.text}</p> : null}
    {/* One continuous grid: gap-px on a border-colored background draws single 1px lines between cells. */}
    <div className="overflow-hidden rounded-xl border bg-border">
      {mode !== "day" ? <div aria-hidden="true" className="hidden grid-cols-7 gap-px border-b sm:grid">{["Mån", "Tis", "Ons", "Tors", "Fre", "Lör", "Sön"].map((name) => <div key={name} className="bg-secondary px-2 py-2 text-xs font-semibold text-secondary-foreground">{name}</div>)}</div> : null}
      <div data-testid="planning-calendar" data-color-by={colorBy} className={`grid gap-px ${mode === "month" ? "grid-cols-2 sm:grid-cols-7" : mode === "week" ? "grid-cols-1 sm:grid-cols-7" : "grid-cols-1"}`}>{days.map((day) => {
      const items = planningActivitiesForDay(activities, day); const currentMonth = isInSwedishMonth(day, anchor); const isToday = isSameSwedishDay(day, today);
      const dayNumber = swedishParts(day).day;
      const planLabel = `Planera på ${formatSwedish(day, { weekday: "long", day: "numeric", month: "long", year: "numeric" })}`;
      const dayKey = swedishDayKey(day);
      const dayCapacity = capacityByDay.get(dayKey);
      const shownItems = mode === "month" ? items.slice(0, 3) : items;
      const label = <>{mode === "day" ? <span className="mr-1.5 capitalize">{formatSwedish(day, { weekday: "long" })}</span> : <span className="mr-1 capitalize sm:hidden">{dayLabel.format(day)}</span>}<span className={isToday ? "inline-flex size-6 items-center justify-center rounded-full bg-primary font-semibold text-primary-foreground" : ""}>{dayNumber}</span>{mode === "day" ? <span className="ml-1.5 text-muted-foreground">{formatSwedish(day, { month: "long" })}</span> : null}</>;
      return <section key={day.toISOString()} data-testid="planning-calendar-day" data-day={dayKey}
        onDragOver={(event) => { if (!dragging) return; event.preventDefault(); event.dataTransfer.dropEffect = "move"; if (dropTarget !== dayKey) setDropTarget(dayKey); }}
        onDragLeave={(event) => { if (!event.currentTarget.contains(event.relatedTarget as Node | null) && dropTarget === dayKey) setDropTarget(null); }}
        onDrop={(event) => { if (!dragging) return; event.preventDefault(); dropOn(day); }}
        className={cn("min-h-28 p-2 transition-colors", mode === "week" && "sm:min-h-44", mode === "month" && !currentMonth ? "bg-muted/60 text-muted-foreground" : "bg-card", dropTarget === dayKey && "bg-secondary ring-2 ring-inset ring-primary/40")}><div className="mb-1.5 flex items-center justify-between gap-2">{canCreate ? <button type="button" aria-label={planLabel} title={planLabel} onClick={() => onPlanDay(day)} className="flex items-center rounded-full px-1 text-left text-xs font-medium transition-colors hover:bg-secondary hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">{label}</button> : <p className="flex items-center px-1 text-xs font-medium">{label}</p>}</div>{mode !== "month" && dayCapacity ? <div data-testid="calendar-day-capacity" className="mb-2 flex flex-wrap gap-x-2 px-1 text-[11px] text-muted-foreground"><span>Min planering: {formatMinutes(dayCapacity.ownMinutes)}</span>{teamMemberIds.length ? <span data-testid="calendar-team-capacity">Team: {formatMinutes(dayCapacity.teamMinutes)}</span> : null}</div> : null}<ol className="space-y-1">{shownItems.map((activity) => <li key={activity.id}><button type="button" onClick={() => setSelected(activity)} aria-label={`Visa planering ${activity.title}`} draggable={canDrag(activity)} onDragStart={(event) => { if (!canDrag(activity)) { event.preventDefault(); return; } event.dataTransfer.effectAllowed = "move"; event.dataTransfer.setData("text/plain", activity.id); setDragging({ id: activity.id, fromDay: day }); }} onDragEnd={() => { setDragging(null); setDropTarget(null); }} data-color-by={colorBy} className={cn("block w-full truncate rounded-md border-l-[3px] px-2 py-1 text-left text-[11px] leading-4 transition-[filter] hover:brightness-95 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring", conflictedActivityIds.has(activity.id) ? "border-amber-500 bg-amber-50 text-amber-900 dark:bg-amber-950 dark:text-amber-100" : planningCalendarActivityTone(activity, colorBy))} title={`${activity.title} · ${formatDateTime(activity.startsAt)}–${formatDateTime(activity.endsAt)}`}><span className="font-semibold">{timeLabel.format(new Date(activity.startsAt))}</span> {activity.title}</button></li>)}</ol>{items.length > shownItems.length ? <p className="mt-1 px-1 text-[11px] text-muted-foreground">+{items.length - shownItems.length} till</p> : null}{mode === "day" && !items.length ? <p className="px-1 text-xs text-muted-foreground">Inget planerat</p> : null}</section>;
    })}</div>
    </div>
    <p className="mt-3 text-xs text-muted-foreground">Kalendern använder samma projekt-, uppgifts-, ansvarig- och statusurval som listan nedan. Dag- och veckoraden visar bara planerad kapacitet från den redan tillåtna arbetsytan; rapporterad tid är fortsatt separat. Välj en aktivitet för läsande detaljer.{canCreate ? " Datumklick fyller endast i formuläret och skapar ingen aktivitet automatiskt." : ""}{onMove && mode !== "day" && activities.some(canEdit) ? " Dra en aktivitet till en annan dag för att flytta den; klockslag och längd behålls. Flytten ändrar aldrig rapporterad tid, och en tidskrock varnar men stoppar inte. Du kan också flytta via Redigera." : ""}</p>
    <Modal open={Boolean(selected)} onOpenChange={(open) => { if (!open) setSelected(null); }} title="Planeringsdetaljer" className="max-w-lg">
      {selected ? <div className="space-y-4"><div><div className="flex flex-wrap items-center gap-2"><p className="text-base font-semibold">{selected.title}</p><Badge variant="outline">{planningStatusLabel(selected.status)}</Badge></div><p data-testid="planning-shared-interval" className="mt-1 text-sm text-muted-foreground"><span className="font-medium text-foreground">Aktivitetens gemensamma intervall:</span> {formatDateTime(selected.startsAt)} – {formatDateTime(selected.endsAt)}</p></div><dl className="grid gap-3 rounded-xl border bg-muted/20 p-4 text-sm"><div><dt className="text-xs font-medium text-muted-foreground">Projekt</dt><dd className="mt-1">{selected.project?.name ?? selectedProject?.name ?? "Utan projekt"}</dd></div><div><dt className="text-xs font-medium text-muted-foreground">Ansvarig</dt><dd className="mt-1">{selected.assignedToName || "Oallokerad"}</dd></div><div><dt className="text-xs font-medium text-muted-foreground">Typ</dt><dd className="mt-1">{planningKindLabel(selected.kind)}</dd></div></dl>{selectedAssignments.length ? <section data-testid="planning-assignment-details" className="rounded-xl border bg-muted/20 p-4"><p className="text-xs font-medium text-muted-foreground">Deltagare och kapacitet</p><p className="mt-1 text-xs text-muted-foreground">Personens intervall och belastning visas separat från aktivitetens gemensamma tid. Det här skapar aldrig rapporterad tid.</p><ol className="mt-3 divide-y rounded-lg border bg-background/70">{selectedAssignments.map((assignment) => { const assignmentConflicts = selectedConflictsByUserId.get(assignment.userId) ?? []; return <li key={assignment.userId} className="p-3 text-sm"><div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-1"><div><p className="font-medium">{memberNameById.get(assignment.userId) ?? "Intern deltagare"}</p><p className="mt-1 text-xs text-muted-foreground">{assignment.startsAt && assignment.endsAt ? `Individuellt intervall: ${formatDateTime(assignment.startsAt)}–${formatDateTime(assignment.endsAt)}` : "Delar aktivitetens gemensamma intervall"}</p></div><p className="text-xs font-medium text-primary">{assignment.plannedMinutes === null ? `Belastning: full bokning · ${formatMinutes(selectedDurationMinutes)}` : `Belastning: ${formatMinutes(assignment.plannedMinutes)}`}</p></div>{assignmentConflicts.length ? <div data-testid="planning-assignment-conflict" className="mt-3 flex gap-2 rounded-lg border border-amber-200 bg-amber-50/60 p-2 text-xs text-amber-950 dark:border-amber-900 dark:bg-amber-950/30 dark:text-amber-100"><AlertTriangle className="mt-0.5 size-4 shrink-0 text-amber-600 dark:text-amber-300" /><div><p className="font-medium">Tidskrock i planeringen</p>{assignmentConflicts.map((conflict) => { const other = conflict.first.activityId === selected.id ? conflict.second : conflict.first; return <p key={`${conflict.first.activityId}-${conflict.second.activityId}-${conflict.startsAt}`} className="mt-1">Överlapp med {other.title}: {formatDateTime(conflict.startsAt)}–{formatDateTime(conflict.endsAt)} · {formatMinutes(conflict.minutes)}</p>; })}</div></div> : null}</li>; })}</ol></section> : null}{selectedProject && selectedProjectBudget ? <section className="rounded-xl border bg-muted/20 p-4"><div className="flex flex-wrap items-start justify-between gap-3"><div><p className="text-xs font-medium text-muted-foreground">Projektkontext</p><p className="mt-1 text-sm font-semibold">{selectedProject.name}</p></div><Button asChild size="sm" variant="outline"><Link href={`/?view=project&projectId=${encodeURIComponent(selectedProject.id)}`}>Öppna projekt<ArrowRight /></Link></Button></div><div className="mt-3 grid grid-cols-3 gap-2 text-xs"><div className="rounded-lg bg-background/70 p-2"><p className="text-muted-foreground">Klart</p><p className="mt-1 font-semibold">{projectProgress(selectedProject)}%</p></div><div className="rounded-lg bg-background/70 p-2"><p className="text-muted-foreground">Budget</p><p className="mt-1 font-semibold">{selectedProjectBudget.hasBudget ? formatMinutes(selectedProjectBudget.budgetMinutes) : "—"}</p></div><div className="rounded-lg bg-background/70 p-2"><p className="text-muted-foreground">Rapporterat totalt</p><p className="mt-1 font-semibold">{formatMinutes(selectedProjectBudget.reportedMinutes)}</p></div></div></section> : null}{selectedTask ? <section className="rounded-xl border bg-muted/20 p-4"><div className="flex flex-wrap items-start justify-between gap-3"><div><p className="text-xs font-medium text-muted-foreground">Kopplad uppgift</p><p className="mt-1 text-sm font-semibold">{taskTypeLabel(selectedTask)} · {selectedTask.title}</p><p className="mt-1 text-xs text-muted-foreground">{taskProgress(selectedTask)}% verkligt klart</p></div>{canReadTask(selectedTask) ? <div className="flex flex-wrap gap-2"><Button asChild size="sm" variant="outline"><Link href={taskHref(selectedTask)}>Öppna uppgift<ArrowRight /></Link></Button>{timeReportHref ? <Button asChild size="sm"><Link href={timeReportHref}>Visa tidrapport<Clock3 /></Link></Button> : null}</div> : null}</div></section>
      : !selectedTaskId && canCreateTask && !selectedProject?.archivedAt && !selectedProject?.closedAt ? <section data-testid="planning-create-task" className="rounded-xl border border-dashed p-4"><div className="flex flex-wrap items-center justify-between gap-3"><div><p className="text-xs font-medium text-muted-foreground">Ingen kopplad uppgift</p><p className="mt-1 text-sm">{selected.projectId ? "Skapa uppgiften för arbetet direkt i projektet." : "Skapa en uppgift för arbetet."}</p></div><Button asChild size="sm"><Link href={`/?view=new_task${selected.projectId ? `&projectId=${encodeURIComponent(selected.projectId)}` : ""}`}><Plus />Skapa uppgift</Link></Button></div></section> : null}{selected.description ? <div><p className="text-xs font-medium text-muted-foreground">Beskrivning</p><p className="mt-1 whitespace-pre-wrap text-sm">{selected.description}</p></div> : null}<details className="rounded-xl border bg-muted/20 p-3"><summary className="cursor-pointer text-xs font-medium">Historik ({selected.eventCount ?? selected.events?.length ?? 0})</summary>{(selected.eventCount ?? 0) > (selected.events?.length ?? 0) ? <p className="mt-2 text-xs text-muted-foreground">Visar de {selected.events?.length} senaste händelserna.</p> : null}{selected.events?.length ? <ol className="mt-3 space-y-2 text-xs">{selected.events.map((event) => <li key={event.id} className="flex flex-wrap justify-between gap-x-3 gap-y-1"><span>{event.summary}{event.actorName ? ` · ${event.actorName}` : ""}</span><span className="text-muted-foreground">{formatDateTime(event.createdAt)}</span></li>)}</ol> : <p className="mt-2 text-xs text-muted-foreground">Ingen historik är tillgänglig för den här aktiviteten.</p>}</details>{canEdit(selected) ? <div className="flex flex-wrap justify-end gap-2 border-t pt-4"><Button type="button" variant="outline" onClick={() => { onEdit(selected); setSelected(null); }}><Pencil />Redigera</Button><Button type="button" variant="destructive" onClick={() => { onDelete(selected); setSelected(null); }}><Trash2 />Ta bort</Button></div> : <p className="text-xs text-muted-foreground">Du har läsbehörighet till planeringen men saknar behörighet att ändra den.</p>}<p className="text-xs text-muted-foreground">Planerad tid är inte rapporterad tid.</p></div> : null}
    </Modal>
  </Panel>;
}

function AvailabilityPanel({ conflicts, currentUserId, canViewTeam, members }: { conflicts: ReturnType<typeof summarizeAvailability>["conflicts"]; currentUserId: string; canViewTeam: boolean; members: ProjectMember[] }) {
  const memberName = new Map(members.map((member) => [member.id, member.name]));
  const visible = conflicts.filter((conflict) => canViewTeam || conflict.userId === currentUserId);
  return <Panel title="Tillgänglighet och tidskrockar" description={canViewTeam ? "Varningar för överlappande aktiva planeringar per intern ansvarig. De ändrar inget och är inte en kalender." : "Varningar för dina överlappande aktiva planeringar. De ändrar inget och är inte en kalender."}>
    {visible.length ? <ol data-testid="availability-conflict-list" className="divide-y rounded-xl border border-amber-200 bg-amber-50/40 dark:border-amber-900 dark:bg-amber-950/20">{visible.map((conflict, index) => <li key={`${conflict.userId}-${conflict.first.activityId}-${conflict.second.activityId}-${conflict.startsAt}-${index}`} className="flex gap-3 p-4"><AlertTriangle className="mt-0.5 size-4 shrink-0 text-amber-600 dark:text-amber-300" /><div className="min-w-0"><p className="text-sm font-semibold">{canViewTeam ? `${memberName.get(conflict.userId) ?? "Okänd medlem"}: ` : ""}{conflict.first.title} och {conflict.second.title}</p><p className="mt-1 text-xs text-muted-foreground">Överlapp {formatDateTime(conflict.startsAt)}–{formatDateTime(conflict.endsAt)} · {formatMinutes(conflict.minutes)}. Justera en planering när bemanningen är bestämd.</p></div></li>)}</ol> : <div data-testid="availability-no-conflicts" className="flex items-start gap-3 rounded-xl border border-dashed p-4"><CheckCircle2 className="mt-0.5 size-4 shrink-0 text-emerald-600" /><div><p className="text-sm font-medium">Inga tidskrockar i synlig planering</p><p className="mt-1 text-xs text-muted-foreground">Endast aktiva interna bokningar jämförs. Oallokerat och externt arbete räknas inte som personkrockar.</p></div></div>}
  </Panel>;
}

function TeamCapacityPanel({ teamCapacity, anchor }: { teamCapacity: PlanningTeamCapacity; anchor: Date }) {
  const summaries = useMemo(() => teamCapacity.members.map((member) => ({
    member,
    summary: summarizeWeeklyCapacity({ anchor, weeklyWorkMinutes: member.weeklyWorkMinutes, userId: member.id, activities: teamCapacity.activities, timeEntries: [] }),
  })), [anchor, teamCapacity]);
  return <Panel title="Teamets kapacitet" description="Företagsadministratörer ser teamets effektiva veckoarbetstid, personliga undantag, planering och historik för att kunna bemanna arbetet.">
    <ol className="divide-y rounded-xl border">{summaries.map(({ member, summary }) => <li key={member.id} className="p-4"><div className="flex flex-wrap items-start gap-4"><div className="min-w-0 flex-1"><p className="text-sm font-semibold">{member.name}</p><p className="mt-1 text-xs text-muted-foreground">Veckoarbetstid: {formatMinutes(member.weeklyWorkMinutes)} · {member.memberWeeklyWorkMinutes === null ? "organisationsstandard" : `personligt undantag (${formatMinutes(member.memberWeeklyWorkMinutes)})`}</p></div><div className="grid min-w-full grid-cols-3 gap-2 sm:min-w-80 sm:grid-cols-3"><div className="rounded-lg bg-muted/50 p-2"><p className="text-[11px] text-muted-foreground">Planerat</p><p className="mt-1 text-sm font-semibold">{formatMinutes(summary.plannedMinutes)}</p></div><div className={`rounded-lg p-2 ${summary.overplannedMinutes ? "bg-amber-50 text-amber-900 dark:bg-amber-950 dark:text-amber-100" : "bg-primary/5 text-foreground"}`}><p className="text-[11px] opacity-80">{summary.overplannedMinutes ? "Överbokad" : "Tillgänglig"}</p><p className="mt-1 text-sm font-semibold">{formatMinutes(summary.overplannedMinutes || summary.remainingPlannedMinutes)}</p></div><div className="rounded-lg bg-muted/50 p-2"><p className="text-[11px] text-muted-foreground">Belastning</p><p className="mt-1 text-sm font-semibold">{summary.plannedPercent}%</p></div></div></div><details className="mt-4 rounded-lg border bg-muted/20 p-3"><summary className="cursor-pointer text-xs font-medium">Arbetstidsdetaljer och ändringshistorik ({member.events.length})</summary><p className="mt-2 text-xs text-muted-foreground">Organisationsstandard: {formatMinutes(teamCapacity.organizationWeeklyWorkMinutes)}. {member.memberWeeklyWorkMinutes === null ? "Medlemmen följer standarden." : `Personligt undantag: ${formatMinutes(member.memberWeeklyWorkMinutes)}.`}</p>{member.events.length ? <ol className="mt-3 space-y-2 text-xs">{member.events.map((event) => <li key={event.id} className="flex flex-wrap justify-between gap-x-3 gap-y-1"><span>{event.previousMinutes === null ? "Inget undantag" : formatMinutes(event.previousMinutes)} → {event.nextMinutes === null ? "Inget undantag" : formatMinutes(event.nextMinutes)}{event.actorName ? ` · ${event.actorName}` : ""}</span><span className="text-muted-foreground">{formatDateTime(event.createdAt)}</span></li>)}</ol> : <p className="mt-2 text-xs text-muted-foreground">Ingen personlig ändringshistorik.</p>}</details></li>)}</ol>
  </Panel>;
}

function PlanningPanel({ project, tasks, activities, availabilityActivities, members, currentUserId, canViewTeamAvailability, busy, error, canCreate, canEdit, canFrameException, onSave, onRemove }: {
  canFrameException?: (project: WorkflowProject) => boolean;
  project: WorkflowProject;
  tasks: WorkflowTask[];
  activities: PlannedActivity[];
  availabilityActivities: PlannedActivity[];
  members: ProjectMember[];
  currentUserId: string;
  canViewTeamAvailability: boolean;
  busy: boolean;
  error: string;
  canCreate: boolean;
  canEdit: (activity: PlannedActivity) => boolean;
  onSave: (input: PlannedActivityInput) => Promise<{ id: string; version: number }>;
  onRemove: (id: string, version: number) => Promise<void>;
}) {
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<PlannedActivity | undefined>();
  const [confirmCard, confirmElement] = useConfirm();
  const budgetSummary = summarizeProjectBudget(project.timeBudgetMinutes, tasks.reduce((sum, task) => sum + (task.totalDurationSec ?? 0), 0));
  const openCreate = () => { setEditing(undefined); setOpen(true); };
  const openEdit = (activity: PlannedActivity) => { setEditing(activity); setOpen(true); };
  return <Panel title="Planering och tidsbudget" description="Planerad tid och faktisk rapporterad tid är separata. Kalenderbokningar skapar aldrig tidrapporter.">
    {confirmElement}
    <div className="grid gap-3 sm:grid-cols-3">
      <div className="rounded-xl border bg-muted/40 p-4"><p className="text-xs font-medium text-muted-foreground">Tidsbudget</p><p className="mt-1 text-xl font-semibold">{budgetSummary.hasBudget ? formatMinutes(budgetSummary.budgetMinutes) : "Inte angiven"}</p></div>
      <div className="rounded-xl border bg-muted/40 p-4"><p className="text-xs font-medium text-muted-foreground">Rapporterad tid totalt</p><p className="mt-1 text-xl font-semibold">{formatMinutes(budgetSummary.reportedMinutes)}</p></div>
      <div className={`rounded-xl border p-4 ${budgetSummary.isOverBudget ? indicatorBadge("danger") : "bg-muted/40"}`}><p className="text-xs font-medium opacity-80">{budgetSummary.isOverBudget ? "Överskriden budget" : "Återstår"}</p><p className="mt-1 text-xl font-semibold">{budgetSummary.hasBudget ? formatMinutes(budgetSummary.isOverBudget ? budgetSummary.overBudgetMinutes : budgetSummary.remainingMinutes) : "—"}</p></div>
    </div>
    {project.outsideFrameMinutes ? <p data-testid="project-time-outside-frame" className={cn("mt-3 flex items-start gap-2 rounded-lg border p-2.5 text-xs", indicatorBadge("warning"))}><AlertTriangle className="mt-0.5 size-3.5 shrink-0" />{formatMinutes(project.outsideFrameMinutes)} är rapporterat utanför projektets tidsram. Tiden räknas men bör stämmas av.</p> : null}
    {budgetSummary.hasBudget && <div className="mt-4"><div className="flex items-center justify-between gap-3 text-xs text-muted-foreground"><span>Rapporterad tid av budget</span><span className={budgetSummary.isOverBudget || budgetSummary.isHighUsage ? `font-semibold ${indicatorText(budgetTone(budgetSummary))}` : "font-medium text-foreground"}>{budgetSummary.percentUsed}%</span></div><div className="mt-2 h-2 overflow-hidden rounded-full bg-muted"><div className={`h-full rounded-full ${indicatorBar(budgetTone(budgetSummary))}`} style={{ width: `${budgetSummary.percentUsed}%` }} /></div></div>}
    <div className="mt-6 flex flex-wrap items-center justify-between gap-3"><div><h3 className="text-sm font-semibold">Planerade aktiviteter</h3><p className="mt-1 text-xs text-muted-foreground">Bokningar för arbete, möten och deadlines i projektet.</p></div>{canCreate && <Button size="sm" onClick={openCreate}><CalendarPlus />Ny planering</Button>}</div>
    {activities.length ? <ol data-testid="planned-activity-list" className="mt-4 divide-y rounded-xl border">{activities.slice().sort((left, right) => left.startsAt.localeCompare(right.startsAt)).map((activity) => <li key={activity.id} className="p-4"><div className="flex flex-wrap items-start gap-3"><span className="mt-0.5 flex size-9 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary"><Clock3 className="size-4" /></span><div className="min-w-0 flex-1"><div className="flex flex-wrap items-center gap-2"><p className="text-sm font-semibold">{activity.title}</p><Badge variant="outline" className={indicatorBadge(activity.status === "PLANNED" ? "info" : statusTone(activity.status))}>{activity.status === "COMPLETED" ? "Slutförd" : activity.status === "CANCELED" ? "Inställd" : activity.status === "IN_PROGRESS" ? "Pågår" : "Planerad"}</Badge></div><p className="mt-1 text-xs text-muted-foreground">{formatDateTime(activity.startsAt)} – {formatDateTime(activity.endsAt)}{activity.assignedToName ? ` · ${activity.assignedToName}` : ""}</p>{activity.description && <p className="mt-2 text-sm text-muted-foreground">{activity.description}</p>}{activity.events?.length ? <details className="mt-3 text-xs text-muted-foreground"><summary className="cursor-pointer font-medium text-foreground">Historik ({activity.eventCount ?? activity.events.length})</summary><ol className="mt-2 space-y-1">{activity.events.map((event) => <li key={event.id}>{event.summary} · {formatDateTime(event.createdAt)}{event.actorName ? ` · ${event.actorName}` : ""}</li>)}</ol></details> : null}</div>{canEdit(activity) && <div className="flex gap-1"><Button size="icon" variant="ghost" aria-label={`Redigera ${activity.title}`} onClick={() => openEdit(activity)}><Pencil /></Button><Button size="icon" variant="ghost" aria-label={`Ta bort ${activity.title}`} disabled={busy} onClick={async () => { if (await confirmCard({ title: "Ta bort planeringen?", message: `”${activity.title}” tas bort. Rapporterad tid påverkas inte.`, confirmLabel: "Ta bort", tone: "danger" })) void onRemove(activity.id, activity.version); }}><Trash2 /></Button></div>}</div></li>)}</ol> : <p className="mt-4 rounded-xl border border-dashed p-4 text-sm text-muted-foreground">Inga aktiviteter är planerade ännu. Planering påverkar inte rapporterad tid.</p>}
    <Modal open={open} onOpenChange={setOpen} title={editing ? "Redigera planering" : "Ny planering"} className="max-w-2xl"><PlannedActivityForm project={project} tasks={tasks} members={members} availabilityActivities={availabilityActivities} currentUserId={currentUserId} canViewTeamAvailability={canViewTeamAvailability} canFrameException={canFrameException} activity={editing} busy={busy} error={error} onCancel={() => setOpen(false)} onSave={async (input) => { await onSave(input); setOpen(false); }} /></Modal>
  </Panel>;
}

function PlannedActivityForm({ project, projects = [], tasks, members, availabilityActivities, currentUserId, canViewTeamAvailability, canFrameException = () => false, activity, defaultStartsAt, defaultEndsAt, busy, error, onCancel, onSave }: { project?: WorkflowProject; projects?: WorkflowProject[]; tasks: WorkflowTask[]; members: ProjectMember[]; availabilityActivities: PlannedActivity[]; currentUserId: string; canViewTeamAvailability: boolean; canFrameException?: (project: WorkflowProject) => boolean; activity?: PlannedActivity; defaultStartsAt?: Date; defaultEndsAt?: Date; busy: boolean; error: string; onCancel: () => void; onSave: (input: PlannedActivityInput) => Promise<void> }) {
  const [frameExceptionReason, setFrameExceptionReason] = useState("");
  const [title, setTitle] = useState(activity?.title ?? "");
  const [description, setDescription] = useState(activity?.description ?? "");
  const [kind, setKind] = useState<PlannedActivity["kind"]>(activity?.kind ?? "TASK");
  const [status, setStatus] = useState<PlannedActivity["status"]>(activity?.status ?? "PLANNED");
  const [startsAt, setStartsAt] = useState(activity ? localDateTimeValue(activity.startsAt) : defaultStartsAt ? localDateTimeValue(defaultStartsAt.toISOString()) : "");
  const [endsAt, setEndsAt] = useState(activity ? localDateTimeValue(activity.endsAt) : defaultEndsAt ? localDateTimeValue(defaultEndsAt.toISOString()) : "");
  const [selectedProjectId, setSelectedProjectId] = useState(activity?.projectId ?? project?.id ?? "");
  const [assignedToUserIds, setAssignedToUserIds] = useState<string[]>(activity?.assignedToUserIds.length ? activity.assignedToUserIds : activity?.assignedToUserId ? [activity.assignedToUserId] : []);
  const [plannedMinutesByUserId, setPlannedMinutesByUserId] = useState<Record<string, string>>(() => Object.fromEntries((activity?.assignments ?? []).map((assignment) => [assignment.userId, assignment.plannedMinutes === null ? "" : String(assignment.plannedMinutes)])));
  const initialIndividualTimes = Object.fromEntries((activity?.assignments ?? []).map((assignment) => [assignment.userId, { startsAt: assignment.startsAt ? localDateTimeValue(assignment.startsAt) : "", endsAt: assignment.endsAt ? localDateTimeValue(assignment.endsAt) : "" }]));
  const [individualTimesByUserId, setIndividualTimesByUserId] = useState<Record<string, { startsAt: string; endsAt: string }>>(() => initialIndividualTimes);
  const individualTimesRef = useRef<Record<string, { startsAt: string; endsAt: string }>>(initialIndividualTimes);
  const [formError, setFormError] = useState("");
  const [externalAssigneeName, setExternalAssigneeName] = useState(activity && !activity.assignedToUserIds.length && !activity.assignedToUserId ? activity.assignedToName : "");
  const existingTask = activity?.workflowTaskId ? `workflow:${activity.workflowTaskId}` : activity?.controlId ? `control:${activity.controlId}` : "";
  const [taskReference, setTaskReference] = useState(existingTask);
  const selectedProject = project ?? projects.find((candidate) => candidate.id === selectedProjectId);
  const availableTasks = project ? tasks : tasks.filter((task) => task.projectId === selectedProjectId);
  // The project is the frame (Daniel 2026-09-26): planning outside it is blocked unless the project's responsible or
  // an admin records a reason; ending after the task's "Klart senast" is only a warning.
  const [linkedKind, linkedId] = taskReference.split(":");
  const linkedTask = linkedId ? tasks.find((task) => task.id === linkedId && (linkedKind === "workflow") === Boolean(task.kind)) : undefined;
  const frameProject = selectedProject ?? (linkedTask?.projectId ? projects.find((candidate) => candidate.id === linkedTask.projectId) : undefined);
  const previewInterval = { startsAt: inputInstant(startsAt), endsAt: inputInstant(endsAt) };
  const intervalValid = !Number.isNaN(previewInterval.startsAt.getTime()) && !Number.isNaN(previewInterval.endsAt.getTime()) && previewInterval.endsAt > previewInterval.startsAt;
  const intervalChanged = !activity || !intervalValid || previewInterval.startsAt.toISOString() !== activity.startsAt || previewInterval.endsAt.toISOString() !== activity.endsAt || (activity.projectId ?? "") !== (selectedProject?.id ?? "");
  const frameError = intervalValid && intervalChanged && !["COMPLETED", "CANCELED"].includes(status) ? planningFrameError(previewInterval, frameProject) : null;
  const mayMakeException = Boolean(frameProject && canFrameException(frameProject));
  const afterTaskDue = intervalValid && planningAfterTaskDue(previewInterval, linkedTask?.dueDate);
  const knownAssigneeIds = new Set(members.map((member) => member.id));
  const hasPreservedCloudAssignee = assignedToUserIds.some((id) => !knownAssigneeIds.has(id));
  function toggleAssignee(userId: string) {
    setAssignedToUserIds((current) => current.includes(userId) ? current.filter((id) => id !== userId) : [...current, userId]);
  }
  function updateIndividualTime(userId: string, field: "startsAt" | "endsAt", value: string) {
    setFormError("");
    const times = { startsAt: individualTimesRef.current[userId]?.startsAt ?? "", endsAt: individualTimesRef.current[userId]?.endsAt ?? "", [field]: value };
    const next = { ...individualTimesRef.current, [userId]: value ? times : { startsAt: "", endsAt: "" } };
    individualTimesRef.current = next;
    setIndividualTimesByUserId(next);
    const individualStartsAt = inputInstant(next[userId].startsAt); const individualEndsAt = inputInstant(next[userId].endsAt);
    if (next[userId].startsAt && next[userId].endsAt && !Number.isNaN(individualStartsAt.getTime()) && !Number.isNaN(individualEndsAt.getTime()) && individualEndsAt > individualStartsAt)
      setPlannedMinutesByUserId((minutes) => ({ ...minutes, [userId]: String(Math.round((individualEndsAt.getTime() - individualStartsAt.getTime()) / 60_000)) }));
  }
  function clearIndividualPlan(userId: string) {
    setFormError("");
    const next = { ...individualTimesRef.current, [userId]: { startsAt: "", endsAt: "" } };
    individualTimesRef.current = next;
    setIndividualTimesByUserId(next);
    setPlannedMinutesByUserId((current) => ({ ...current, [userId]: "" }));
  }
  const previewConflictsByUserId = useMemo(() => {
    const previewStartsAt = inputInstant(startsAt);
    const previewEndsAt = inputInstant(endsAt);
    if (Number.isNaN(previewStartsAt.getTime()) || Number.isNaN(previewEndsAt.getTime()) || previewEndsAt <= previewStartsAt) return new Map<string, ReturnType<typeof summarizeAvailability>["conflicts"]>();
    const previewId = activity?.id ?? "planning-preview";
    const preview: PlannedActivity = {
      id: previewId, version: activity?.version ?? 0, title: title.trim() || "Den här planeringen", description: "", kind, status,
      startsAt: previewStartsAt.toISOString(), endsAt: previewEndsAt.toISOString(), projectId: null, workflowTaskId: null, controlId: null,
      assignedToUserId: assignedToUserIds[0] ?? null, assignedToUserIds, assignedToName: "", deletedAt: null,
      assignments: assignedToUserIds.map((userId) => {
        const individual = individualTimesByUserId[userId];
        const individualStartsAt = individual?.startsAt ? inputInstant(individual.startsAt) : null;
        const individualEndsAt = individual?.endsAt ? inputInstant(individual.endsAt) : null;
        const hasValidIndividualInterval = Boolean(individualStartsAt && individualEndsAt && !Number.isNaN(individualStartsAt.getTime()) && !Number.isNaN(individualEndsAt.getTime()) && individualEndsAt > individualStartsAt);
        return { userId, plannedMinutes: null, startsAt: hasValidIndividualInterval ? individualStartsAt!.toISOString() : null, endsAt: hasValidIndividualInterval ? individualEndsAt!.toISOString() : null };
      }),
    };
    const byUserId = new Map<string, ReturnType<typeof summarizeAvailability>["conflicts"]>();
    for (const conflict of summarizeAvailability([...availabilityActivities.filter((item) => item.id !== previewId), preview]).conflicts) {
      if (!canViewTeamAvailability && conflict.userId !== currentUserId) continue;
      if (conflict.first.activityId !== previewId && conflict.second.activityId !== previewId) continue;
      byUserId.set(conflict.userId, [...(byUserId.get(conflict.userId) ?? []), conflict]);
    }
    return byUserId;
  }, [activity?.id, activity?.version, assignedToUserIds, availabilityActivities, canViewTeamAvailability, currentUserId, endsAt, individualTimesByUserId, kind, startsAt, status, title]);
  return <form className="space-y-5" onSubmit={(event) => {
    event.preventDefault();
    setFormError("");
    const activityStartsAt = inputInstant(startsAt); const activityEndsAt = inputInstant(endsAt);
    if (Number.isNaN(activityStartsAt.getTime()) || Number.isNaN(activityEndsAt.getTime())) { setFormError("Ange giltig start och slut."); return; }
    const assignments = [] as PlannedActivityInput["assignments"];
    for (const userId of assignedToUserIds) {
      const existing = activity?.assignments.find((assignment) => assignment.userId === userId);
      const individualTimes = individualTimesByUserId[userId] ?? { startsAt: existing?.startsAt ? localDateTimeValue(existing.startsAt) : "", endsAt: existing?.endsAt ? localDateTimeValue(existing.endsAt) : "" };
      if (Boolean(individualTimes.startsAt) !== Boolean(individualTimes.endsAt)) { setFormError("Individuell start och slut måste anges tillsammans."); return; }
      if (individualTimes.startsAt && individualTimes.endsAt) {
        const individualStartsAt = inputInstant(individualTimes.startsAt); const individualEndsAt = inputInstant(individualTimes.endsAt);
        if (Number.isNaN(individualStartsAt.getTime()) || Number.isNaN(individualEndsAt.getTime()) || individualEndsAt <= individualStartsAt || individualStartsAt < activityStartsAt || individualEndsAt > activityEndsAt) { setFormError("Individuell tid måste ligga inom aktivitetens tidsintervall."); return; }
        assignments.push({ userId, plannedMinutes: Math.round((individualEndsAt.getTime() - individualStartsAt.getTime()) / 60_000), startsAt: individualStartsAt.toISOString(), endsAt: individualEndsAt.toISOString() });
      } else {
        const rawMinutes = plannedMinutesByUserId[userId]?.trim() ?? "";
        assignments.push({ userId, plannedMinutes: rawMinutes ? Number(rawMinutes) : null, startsAt: null, endsAt: null });
      }
    }
    const [referenceKind, referenceId] = taskReference.split(":");
    const internalNames = assignedToUserIds.map((id) => members.find((member) => member.id === id)?.name).filter(Boolean).join(", ");
    void onSave({ id: activity?.id, version: activity?.version, title, description, kind, status,
      startsAt: activityStartsAt.toISOString(), endsAt: activityEndsAt.toISOString(), projectId: selectedProject?.id ?? null,
      workflowTaskId: referenceKind === "workflow" ? referenceId : null, controlId: referenceKind === "control" ? referenceId : null,
      assignedToUserId: assignedToUserIds[0] ?? null, assignedToUserIds, assignedToName: internalNames || externalAssigneeName,
      assignments, frameExceptionReason: frameError ? frameExceptionReason.trim() : "",
    });
  }}>
    <label className="block space-y-2 text-xs font-medium text-muted-foreground">Namn<Input value={title} onChange={(event) => setTitle(event.target.value)} maxLength={200} required autoFocus /></label>
    {!project ? <label className="block space-y-2 text-xs font-medium text-muted-foreground">Projekt (valfritt)<select aria-label="Projekt för planering" className="form-select" value={selectedProjectId} onChange={(event) => { setSelectedProjectId(event.target.value); setTaskReference(""); }}><option value="">Utan projekt</option>{projects.map((candidate) => <option key={candidate.id} value={candidate.id}>{candidate.name}</option>)}</select></label> : null}
    {assignedToUserIds.length ? <div className="rounded-xl border p-4"><p className="text-xs font-medium text-muted-foreground">Individuell tidsfördelning <span className="font-normal">(tomt = hela intervallet)</span></p><p className="mt-1 text-xs text-muted-foreground">Ange valfritt ett eget start-/slutpar för en deltagare. Minuter beräknas då automatiskt; tomt läge är full bokning.</p><div className="mt-3 space-y-3">{members.filter((member) => assignedToUserIds.includes(member.id)).map((member) => { const individualTimes = individualTimesByUserId[member.id] ?? { startsAt: "", endsAt: "" }; const hasIndividualTimes = Boolean(individualTimes.startsAt || individualTimes.endsAt); return <fieldset key={member.id} className="rounded-lg border bg-muted/20 p-3"><legend className="px-1 text-xs font-medium text-foreground">{member.name}</legend><div className="grid gap-3 sm:grid-cols-3"><label className="block text-xs font-medium text-muted-foreground">Planerad tid i minuter<Input aria-label={`Planerad tid i minuter för ${member.name}`} type="number" min="1" step="1" value={plannedMinutesByUserId[member.id] ?? ""} onChange={(event) => setPlannedMinutesByUserId((current) => ({ ...current, [member.id]: event.target.value }))} placeholder="Hela intervallet" disabled={hasIndividualTimes} className="mt-1" /></label><label className="block text-xs font-medium text-muted-foreground">Individuell start<Input aria-label={`Individuell start för ${member.name}`} type="datetime-local" min={startsAt} max={endsAt} value={individualTimes.startsAt} onChange={(event) => updateIndividualTime(member.id, "startsAt", event.target.value)} className="mt-1" /></label><label className="block text-xs font-medium text-muted-foreground">Individuellt slut<Input aria-label={`Individuellt slut för ${member.name}`} type="datetime-local" min={startsAt} max={endsAt} value={individualTimes.endsAt} onChange={(event) => updateIndividualTime(member.id, "endsAt", event.target.value)} className="mt-1" /></label></div><div className="mt-2 flex flex-wrap items-center justify-between gap-2"><p className="text-xs text-muted-foreground">{hasIndividualTimes ? "Individuell tid räknas som deltagarens planerade belastning." : "Deltagaren delar aktivitetens intervall och belastas för hela tiden."}</p>{hasIndividualTimes || plannedMinutesByUserId[member.id] ? <Button type="button" size="sm" variant="ghost" onClick={() => clearIndividualPlan(member.id)}>Återställ full bokning</Button> : null}</div></fieldset>; })}</div></div> : null}
    {assignedToUserIds.length ? <div className="space-y-2">{members.filter((member) => assignedToUserIds.includes(member.id)).map((member) => {
      const conflicts = previewConflictsByUserId.get(member.id) ?? [];
      const previewId = activity?.id ?? "planning-preview";
      return conflicts.length ? <div key={member.id} data-testid="planning-preview-conflict" className="flex gap-2 rounded-lg border border-amber-200 bg-amber-50/60 p-3 text-xs text-amber-950 dark:border-amber-900 dark:bg-amber-950/30 dark:text-amber-100"><AlertTriangle className="mt-0.5 size-4 shrink-0 text-amber-600 dark:text-amber-300" /><div><p className="font-medium">Tidskrock i planeringen för {member.name}</p><p className="mt-1">Detta är en rådgivande förhandsvarning och stoppar inte sparandet.</p>{conflicts.map((conflict) => { const other = conflict.first.activityId === previewId ? conflict.second : conflict.first; return <p key={`${conflict.first.activityId}-${conflict.second.activityId}-${conflict.startsAt}`} className="mt-1">Överlapp med {other.title}: {formatDateTime(conflict.startsAt)}–{formatDateTime(conflict.endsAt)} · {formatMinutes(conflict.minutes)}</p>; })}</div></div> : null;
    })}</div> : null}
    <div className="grid gap-4 sm:grid-cols-2"><label className="block space-y-2 text-xs font-medium text-muted-foreground">Start<Input type="datetime-local" value={startsAt} onChange={(event) => setStartsAt(event.target.value)} required /></label><label className="block space-y-2 text-xs font-medium text-muted-foreground">Slut<Input type="datetime-local" value={endsAt} onChange={(event) => setEndsAt(event.target.value)} required /></label></div>
    <div className="grid gap-4 sm:grid-cols-2"><label className="block space-y-2 text-xs font-medium text-muted-foreground">Typ<select className="form-select" value={kind} onChange={(event) => setKind(event.target.value as PlannedActivity["kind"])}><option value="TASK">Arbete</option><option value="MEETING">Möte</option><option value="DEADLINE">Deadline</option><option value="OTHER">Övrigt</option></select></label><label className="block space-y-2 text-xs font-medium text-muted-foreground">Status<select className="form-select" value={status} onChange={(event) => setStatus(event.target.value as PlannedActivity["status"])}><option value="PLANNED">Planerad</option><option value="IN_PROGRESS">Pågår</option><option value="COMPLETED">Slutförd</option><option value="CANCELED">Inställd</option></select></label></div>
    <fieldset className="rounded-xl border p-4"><legend className="px-1 text-xs font-medium text-muted-foreground">Interna ansvariga</legend><p className="mb-3 text-xs text-muted-foreground">Varje vald person bokas för hela tidsintervallet. Lämna tomt för oallokerat arbete.</p><div className="grid gap-2 sm:grid-cols-2">{members.map((member) => <label key={member.id} className="flex items-center gap-2 rounded-lg border px-3 py-2 text-sm"><input type="checkbox" checked={assignedToUserIds.includes(member.id)} onChange={() => toggleAssignee(member.id)} />{member.name}</label>)}</div>{hasPreservedCloudAssignee ? <p className="mt-3 text-xs text-muted-foreground">En bevarad Cloud-koppling saknar lokal medlemsmappning och ändras inte här.</p> : null}</fieldset>
    {!assignedToUserIds.length && <label className="block space-y-2 text-xs font-medium text-muted-foreground">Ansvarig utan kapacitetskoppling (valfri)<Input value={externalAssigneeName} onChange={(event) => setExternalAssigneeName(event.target.value)} maxLength={160} placeholder="Exempelvis extern entreprenör" /></label>}
    <label className="block space-y-2 text-xs font-medium text-muted-foreground">Koppla till uppgift (valfritt)<select className="form-select" value={taskReference} onChange={(event) => setTaskReference(event.target.value)} disabled={!project && !selectedProjectId}><option value="">{selectedProjectId || project ? "Endast projektet" : "Välj först ett projekt"}</option>{availableTasks.map((task) => <option key={`${task.kind ?? "control"}:${task.id}`} value={`${task.kind ? "workflow" : "control"}:${task.id}`}>{taskTypeLabel(task)} · {task.title}</option>)}</select></label>
    {frameError ? <div data-testid="planning-frame-error" className={cn("space-y-2 rounded-lg border p-3 text-xs", indicatorBadge(mayMakeException ? "warning" : "danger"))}><p className="flex items-start gap-2 font-medium"><AlertTriangle className="mt-0.5 size-4 shrink-0" />{frameError}</p>{mayMakeException ? <label className="block space-y-1 font-medium">Motivering för undantag (loggas)<textarea className="form-textarea min-h-16 bg-card text-foreground" value={frameExceptionReason} onChange={(event) => setFrameExceptionReason(event.target.value)} maxLength={500} required /></label> : <p>Ändra tiden så att den ligger inom projektets tidsram. Projektansvarig eller en företagsadministratör kan göra ett undantag.</p>}</div> : null}
    {afterTaskDue ? <p data-testid="planning-after-task-due" className={cn("flex items-start gap-2 rounded-lg border p-3 text-xs", indicatorBadge("warning"))}><AlertTriangle className="mt-0.5 size-4 shrink-0" />Planeringen slutar efter uppgiftens Klart senast ({linkedTask?.dueDate}). Det är tillåtet men bör stämmas av.</p> : null}
    <label className="block space-y-2 text-xs font-medium text-muted-foreground">Beskrivning<textarea className="form-textarea" value={description} onChange={(event) => setDescription(event.target.value)} maxLength={2000} /></label>{formError || error ? <p role="alert" className="text-sm text-destructive">{formError || error}</p> : null}<div className="flex flex-wrap justify-end gap-2"><Button type="button" variant="outline" onClick={onCancel}>Avbryt</Button><Button type="submit" disabled={busy || !title.trim() || !startsAt || !endsAt || Boolean(frameError && (!mayMakeException || !frameExceptionReason.trim()))}>{activity ? "Spara planering" : "Skapa planering"}</Button></div>
  </form>;
}

/** The card shows "följer tidsramen" only while the project is ongoing and has a frame that has started. */
function ProjectCardAdherence({ project, progress }: { project: WorkflowProject; progress: number }) {
  if (!projectStatusOf(project).ongoing) return null;
  const adherence = summarizeFrameAdherence({ startDate: project.startDate, dueDate: project.dueDate, completion: progress });
  if (!["ON_TRACK", "BEHIND", "OVERDUE"].includes(adherence.state)) return null;
  const tone: IndicatorTone = adherence.state === "OVERDUE" ? "danger" : adherence.state === "BEHIND" ? "warning" : "success";
  return <span data-testid="project-card-adherence" className={cn("font-medium", indicatorText(tone))}> · {adherence.label}</span>;
}

function ProjectsPage({ projects, error, canCreate, remote }: { projects: WorkflowProject[]; error: string; canCreate: boolean;
  /** Cloud: the server pages one tab at a time and counts every tab; Local filters the open file. */
  remote?: { tab: ProjectTab; meta: ProjectListMeta | null; busy: boolean; onTab: (tab: ProjectTab) => void; onMore: () => void } }) {
  // Same tabs as the "Pågående projekt" key figure (Daniel 2026-09-26): one status function decides where a project belongs.
  const [localTab, setLocalTab] = useState<ProjectTab>("ongoing");
  const tab = remote?.tab ?? localTab;
  const tabOf = (project: WorkflowProject) => { const state = projectStatusOf(project).state; return state === "ARCHIVED" ? "archived" : state === "CLOSED" ? "closed" : "ongoing"; };
  const visible = remote ? projects : projects.filter((project) => tabOf(project) === tab);
  const count = (value: ProjectTab) => remote ? remote.meta?.counts[value] ?? 0 : projects.filter((project) => tabOf(project) === value).length;
  const anyProjects = remote ? (["ongoing", "closed", "archived"] as const).some((value) => count(value) > 0) : projects.length > 0;
  const tabs = [["ongoing", "Pågående"], ["closed", "Avslutade"], ["archived", "Arkiverade"]] as const;
  return <div className="space-y-6">
    <div className="flex flex-wrap items-start justify-between gap-4"><div><h1 className="page-title">Mina projekt</h1><p className="page-description mt-2">Samla uppgifter och följ arbetets verkliga progression.</p></div>{anyProjects && canCreate ? <Button asChild><Link href="/?view=new_project"><Plus />Nytt projekt</Link></Button> : null}</div>
    {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
    {anyProjects ? <><div className="flex w-fit max-w-full overflow-x-auto rounded-xl border bg-card p-1" role="group" aria-label="Visa projekt">{tabs.map(([value, label]) => <Button key={value} size="sm" variant={tab === value ? "secondary" : "ghost"} aria-pressed={tab === value} onClick={() => remote ? remote.onTab(value) : setLocalTab(value)}>{label} ({count(value)})</Button>)}</div>{remote?.busy && !visible.length ? <p role="status" className="text-sm text-muted-foreground">Hämtar projekt…</p> : visible.length ? <><div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3" aria-busy={remote?.busy || undefined} data-testid="project-cards">{visible.map((project) => { const progress = projectProgress(project); const budgetSummary = summarizeProjectBudget(project.timeBudgetMinutes, projectTasks(project).reduce((sum, task) => sum + (task.totalDurationSec ?? 0), 0)); return <Link key={project.id} href={`/?view=project&projectId=${encodeURIComponent(project.id)}`} className="workflow-card group flex flex-col p-4">
      <div className="flex items-start gap-3"><span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary"><FolderKanban className="size-4" /></span><div className="min-w-0 flex-1"><h2 className="line-clamp-2 text-sm font-semibold group-hover:text-primary">{project.name}</h2><p className="mt-0.5 truncate text-xs text-muted-foreground">{project.customer?.name || project.description || "Inget kundval"}</p></div><Badge variant="outline" className={indicatorBadge(projectStatusTone(projectStatusOf(project)))}>{projectStatusOf(project).label}</Badge></div>
      <div className="mt-3 flex flex-wrap items-center justify-between gap-2"><PersonAvatars people={projectPeople(project)} />{project.dueDate ? <span data-testid="project-due" className={cn("inline-flex items-center gap-1 text-xs", projectStatusOf(project).overdue ? `font-semibold ${indicatorText("danger")}` : "text-muted-foreground")}><CalendarDays className="size-3.5" aria-hidden="true" />Slutdatum {formatSwedish(fromSwedishDateInput(project.dueDate) ?? project.dueDate, { day: "numeric", month: "short", year: "numeric" })}</span> : <span className="text-xs text-muted-foreground">Inget slutdatum</span>}</div>
      <div className="mt-auto space-y-3 pt-4"><div><div className="h-1.5 overflow-hidden rounded-full bg-muted"><div className={`h-full rounded-full ${indicatorBar(progressTone({ percent: progress }))}`} style={{ width: `${progress}%` }} /></div><div className="mt-2 flex justify-between text-xs text-muted-foreground"><span>{projectTasks(project).length} {projectTasks(project).length === 1 ? "uppgift" : "uppgifter"}</span><span>{progress}% klart<ProjectCardAdherence project={project} progress={progress} /></span></div></div>{budgetSummary.hasBudget ? <div><div className="flex justify-between gap-2 text-xs text-muted-foreground"><span>Rapporterat totalt</span><span className={budgetSummary.isOverBudget || budgetSummary.isHighUsage ? `font-semibold ${indicatorText(budgetTone(budgetSummary))}` : "font-medium text-foreground"}>{formatMinutes(budgetSummary.reportedMinutes)} av {formatMinutes(budgetSummary.budgetMinutes)}</span></div><div className="mt-2 h-1.5 overflow-hidden rounded-full bg-muted"><div className={`h-full rounded-full ${indicatorBar(budgetTone(budgetSummary))}`} style={{ width: `${budgetSummary.percentUsed}%` }} /></div><p data-testid="project-budget-remaining" className={cn("mt-1.5 text-right text-[11px]", budgetSummary.isOverBudget || budgetSummary.isHighUsage ? `font-semibold ${indicatorText(budgetTone(budgetSummary))}` : "text-muted-foreground")}>{budgetSummary.isOverBudget ? `${formatMinutes(budgetSummary.overBudgetMinutes)} över budget` : `${budgetSummary.isHighUsage ? "Hög förbrukning · " : ""}Återstår ${formatMinutes(budgetSummary.remainingMinutes)}`}</p></div> : <div data-testid="project-reported-total" className="flex justify-between gap-2 text-xs text-muted-foreground"><span>Rapporterat totalt</span><span><span className="font-medium text-foreground">{formatMinutes(budgetSummary.reportedMinutes)}</span> · ingen tidsbudget</span></div>}<div className="flex items-center justify-end gap-1 text-xs font-medium text-primary">Öppna projekt<ArrowRight className="size-3.5" /></div></div>
    </Link>; })}</div>{remote?.meta && remote.meta.total > visible.length ? <ShowMore shown={visible.length} total={remote.meta.total} busy={remote.busy} onMore={remote.onMore} /> : null}</> : <div className="notice">Det finns inga {tab === "archived" ? "arkiverade" : tab === "closed" ? "avslutade" : "pågående"} projekt.</div>}</> : <WorkspaceEmptyState kind="projects" />}
  </div>;
}

/**
 * The link guide (Daniel 2026-09-26, decision 7): shows what differs from the project's frame, with the project's
 * value preselected. A completed task is only moved; its content is never changed.
 */
function LinkGuide({ task, project, customers, members, plannedCount, busy, error, onBack, onConfirm }: { task: WorkflowTask & { fromProject?: string }; project: WorkflowProject; customers: CustomerItem[]; members: ProjectMember[]; plannedCount: number; busy: boolean; error: string; onBack: () => void; onConfirm: (apply: LinkChoices) => void }) {
  const completed = task.status === "COMPLETED";
  const customerName = (id: string | null | undefined) => customers.find((customer) => customer.id === id)?.name ?? "Ingen kund";
  const memberName = (id: string | null | undefined, fallback?: string) => members.find((member) => member.id === id)?.name ?? (fallback || "Inte tilldelad");
  const customerDiffers = Boolean(project.customerId) && task.customerId !== project.customerId;
  const responsibleDiffers = Boolean(task.kind) && Boolean(project.responsibleUserId) && task.assignedToUserId !== project.responsibleUserId;
  const dueOutside = Boolean(task.kind) && hasProjectFrame(project) && (!task.dueDate || Boolean(taskDueDateError(task.dueDate, project)));
  const [useCustomer, setUseCustomer] = useState(true);
  const [useResponsible, setUseResponsible] = useState(!task.assignedToUserId);
  const [useDueDate, setUseDueDate] = useState(true);
  const reportedMinutes = Math.round((task.totalDurationSec ?? 0) / 60);
  const row = (label: string, from: string, to: string, checked: boolean, onChange: (value: boolean) => void, choice: string) => <div className="rounded-lg border bg-card p-3"><p className="text-xs font-medium text-muted-foreground">{label}</p><p className="mt-1 text-sm">Uppgiften: <strong>{from}</strong> · Projektet: <strong>{to}</strong></p>{completed ? null : <label className="mt-2 flex items-center gap-2 text-sm"><input type="checkbox" checked={checked} onChange={(event) => onChange(event.target.checked)} />{choice}</label>}</div>;
  return <div data-testid="link-guide" className="space-y-3">
    <p className="text-sm"><strong>{task.title}</strong> · {taskTypeLabel(task)}{task.fromProject ? ` · flyttas från projektet ${task.fromProject}` : ""}</p>
    {completed ? <p className={cn("rounded-lg border p-3 text-xs", indicatorBadge("info"))}>Uppgiften är slutförd. Dess innehåll ändras inte – bara projektkopplingen. Skillnader nedan visas som avvikelser på projektet.</p> : null}
    {customerDiffers ? row("Kund", customerName(task.customerId), customerName(project.customerId), useCustomer, setUseCustomer, "Använd projektets kund") : null}
    {responsibleDiffers ? row("Ansvarig", memberName(task.assignedToUserId, task.assignedToName), memberName(project.responsibleUserId, project.responsibleName), useResponsible, setUseResponsible, "Använd projektansvarig") : null}
    {dueOutside ? row("Klart senast", task.dueDate || "Inte angivet", `tidsram ${formatFrame(project as ProjectFrameLike)}`, useDueDate, setUseDueDate, `Sätt Klart senast till projektets slutdatum (${project.dueDate})`) : null}
    <ul className="space-y-1 rounded-lg border bg-muted/30 p-3 text-xs text-muted-foreground">
      {task.kind ? <li>{reportedMinutes ? `${formatMinutes(reportedMinutes)} redan rapporterad tid räknas mot projektets tid och budget.` : "Ingen tid är rapporterad på uppgiften ännu."}</li> : null}
      <li>{plannedCount ? `${plannedCount} ${plannedCount === 1 ? "planering följer" : "planeringar följer"} med uppgiften till projektet.` : "Uppgiften har ingen planering."}</li>
      <li>Kopplingen skrivs i projektets historik{task.fromProject ? " och i det tidigare projektets historik" : ""}.</li>
    </ul>
    {error ? <p role="alert" className="text-sm text-destructive">{error}</p> : null}
    <div className="flex flex-wrap justify-end gap-2"><Button type="button" variant="outline" onClick={onBack}>Tillbaka</Button><Button type="button" disabled={busy} onClick={() => onConfirm({ customer: customerDiffers ? useCustomer : true, responsible: responsibleDiffers && useResponsible, dueDate: dueOutside && useDueDate ? project.dueDate : "" })}>{task.fromProject ? "Flytta till projektet" : "Koppla till projektet"}</Button></div>
  </div>;
}
type ProjectFrameLike = { startDate: string; dueDate: string };

/** Planned against reported time per task (decision 14). Two separate values; reported time above plan is amber. */
function PlannedVersusReported({ planned, reportedSec }: { planned: number; reportedSec?: number }) {
  const reported = reportedSec === undefined ? null : Math.round(reportedSec / 60);
  if (!planned && !reported) return null;
  const over = planned > 0 && reported !== null && reported > planned;
  return <p data-testid="task-planned-reported" className={cn("mt-2 flex flex-wrap gap-x-3 text-xs", over ? indicatorText("warning") : "text-muted-foreground")}>
    <span>Planerat {formatMinutes(planned)}</span>{reported !== null && <span>Rapporterat {formatMinutes(reported)}</span>}
  </p>;
}

/** "Följer tidsramen" (decision 9): shown beside completion as its own measure, never merged with it. */
function FrameAdherenceRow({ adherence }: { adherence: FrameAdherence }) {
  const tone: IndicatorTone = adherence.state === "OVERDUE" ? "danger" : adherence.state === "BEHIND" ? "warning" : adherence.state === "ON_TRACK" || adherence.state === "DONE" ? "success" : "neutral";
  const detail = adherence.state === "NO_FRAME" ? "Ange start- och slutdatum för att följa tidsramen."
    : adherence.state === "NOT_STARTED" ? "Tidsramen har inte börjat."
    : `${adherence.completionPercent} % klart · ${adherence.elapsedPercent} % av tidsramen har gått`;
  return <div data-testid="project-frame-adherence" className="mt-4 flex flex-wrap items-center gap-x-3 gap-y-1 border-t pt-3 text-sm">
    <span className="text-xs font-medium text-muted-foreground">Tidsram</span>
    <Badge variant="outline" className={indicatorBadge(tone)}>{adherence.label}</Badge>
    <span className="text-xs text-muted-foreground">{detail}</span>
  </div>;
}

function TaskColumn({ title, icon, tasks, empty, plannedMinutes }: { title: string; icon: React.ReactNode; tasks: WorkflowTask[]; empty: string; plannedMinutes: Map<string, number> }) {
  return <section className="rounded-xl border bg-muted/25 p-3"><h3 className="flex items-center gap-2 px-1 text-sm font-semibold [&_svg]:size-4 [&_svg]:text-muted-foreground">{icon}{title}<span className="ml-auto rounded-full bg-card px-2 py-0.5 text-xs font-medium text-muted-foreground">{tasks.length}</span></h3><div className="mt-3 space-y-2">{tasks.length ? tasks.map((task) => { const progress = taskProgress(task); return <article key={task.id} className="workflow-card p-3"><div className="flex items-start justify-between gap-2"><div className="min-w-0"><h4 className="line-clamp-2 text-sm font-semibold">{task.title}</h4><p className="mt-0.5 text-xs text-muted-foreground">{taskTypeLabel(task)}</p></div><TaskState task={task} /></div><div className="mt-3 flex items-center gap-2"><div className="h-1.5 flex-1 overflow-hidden rounded-full bg-muted"><div className={`h-full rounded-full ${indicatorBar(progressTone({ percent: progress, completed: task.status === "COMPLETED", attention: task.status === "NEEDS_ACTION" }))}`} style={{ width: `${progress}%` }} /></div><span className="text-xs font-semibold tabular-nums">{progress}%</span></div><PlannedVersusReported planned={plannedMinutes.get(task.id) ?? 0} reportedSec={task.totalDurationSec} /><Button asChild size="sm" variant="ghost" className="-mx-1 mt-2 w-[calc(100%+0.5rem)] justify-between"><Link href={taskHref(task)} aria-label={`${taskState(task) === "planned" ? "Starta uppgift" : taskState(task) === "done" ? "Visa eller återöppna" : "Fortsätt uppgift"}: ${task.title}`}>{taskState(task) === "planned" ? "Starta uppgift" : taskState(task) === "done" ? "Visa eller återöppna" : "Fortsätt uppgift"}<ArrowRight /></Link></Button></article>; }) : <p className="rounded-lg border border-dashed bg-card p-3 text-sm text-muted-foreground">{empty}</p>}</div></section>;
}

const TASK_PAGE_SIZE = 12;
type TaskFilter = "open" | "active" | "planned" | "action" | "done" | "all";

type RemoteTaskPage = { items: (WorkflowTask & { projectName: string })[]; total: number; page: number; pages: number; counts: Record<TaskFilter, number> };

function TaskList({ tasks, canCreate, remote = false }: { tasks: (WorkflowTask & { projectName: string })[]; canCreate: boolean; remote?: boolean }) {
  // Compact, filterable cards (Daniel 2026-09-26): open work first, search, and a bounded page instead of one endless grid.
  // Cloud asks the server for one page at a time (/api/work-items); Local filters the open file in memory.
  const [filter, setFilter] = useState<TaskFilter>("open");
  const [query, setQuery] = useState("");
  const [limit, setLimit] = useState(TASK_PAGE_SIZE);
  const [remotePage, setRemotePage] = useState<RemoteTaskPage | null>(null);
  const [remoteBusy, setRemoteBusy] = useState(false);
  const [remoteError, setRemoteError] = useState("");
  const loadRemote = useCallback(async (page: number, append: boolean) => {
    setRemoteBusy(true);
    try {
      const params = new URLSearchParams({ filter, q: query.trim(), page: String(page), limit: String(TASK_PAGE_SIZE) });
      const next = await api<RemoteTaskPage>(`/api/work-items?${params}`);
      setRemotePage((current) => append && current ? { ...next, items: [...current.items, ...next.items] } : next);
      setRemoteError("");
    } catch (issue) { setRemoteError((issue as Error).message); } finally { setRemoteBusy(false); }
  }, [filter, query]);
  useEffect(() => {
    if (!remote) return;
    const timer = setTimeout(() => void loadRemote(1, false), query ? 250 : 0);
    return () => clearTimeout(timer);
  }, [remote, loadRemote, query]);
  if (remote) return <RemoteTaskList page={remotePage} busy={remoteBusy} error={remoteError} filter={filter} query={query} canCreate={canCreate}
    onFilter={(value) => setFilter(value)} onQuery={setQuery} onMore={() => remotePage && void loadRemote(remotePage.page + 1, true)} />;
  const matchesFilter = (task: WorkflowTask, value: TaskFilter) => {
    const state = taskState(task);
    if (value === "all") return true;
    if (value === "open") return state !== "done";
    if (value === "done") return state === "done";
    if (value === "action") return state !== "done" && task.status === "NEEDS_ACTION";
    if (value === "planned") return state === "planned";
    return state === "active" && task.status !== "NEEDS_ACTION";
  };
  const needle = query.trim().toLocaleLowerCase("sv-SE");
  const filtered = tasks.filter((task) => matchesFilter(task, filter) && (!needle || `${task.title} ${task.projectName} ${taskTypeLabel(task)}`.toLocaleLowerCase("sv-SE").includes(needle)));
  const shown = filtered.slice(0, limit);
  const filters: [TaskFilter, string][] = [["open", "Öppna"], ["active", "Pågår"], ["planned", "Planerade"], ["action", "Behöver åtgärdas"], ["done", "Slutförda"], ["all", "Alla"]];
  return <div className="space-y-5">
    <div className="flex flex-wrap items-start justify-between gap-4"><div><h1 className="page-title">Mina uppgifter</h1><p className="page-description mt-2">Uppgifter som är tilldelade till dig eller skapade av dig. Översikt visar hela teamets arbete.</p></div>{tasks.length && canCreate ? <Button asChild><Link href="/?view=new_task"><Plus />Ny uppgift</Link></Button> : null}</div>
    {tasks.length ? <>
      <div className="flex flex-col gap-3 rounded-xl border bg-card p-2.5 shadow-xs lg:flex-row lg:items-center lg:justify-between">
        <div className="-mx-1 flex gap-1 overflow-x-auto px-1 lg:flex-wrap lg:overflow-visible" role="group" aria-label="Filtrera mina uppgifter">{filters.map(([value, label]) => <Button key={value} type="button" size="sm" variant={filter === value ? "secondary" : "ghost"} aria-pressed={filter === value} onClick={() => { setFilter(value); setLimit(TASK_PAGE_SIZE); }}>{label} ({tasks.filter((task) => matchesFilter(task, value)).length})</Button>)}</div>
        <div className="relative lg:w-72"><Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden="true" /><Input type="search" aria-label="Sök bland mina uppgifter" placeholder="Sök uppgift eller projekt" value={query} onChange={(event) => { setQuery(event.target.value); setLimit(TASK_PAGE_SIZE); }} className="pl-9" /></div>
      </div>
      {shown.length ? <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">{shown.map((task) => <TaskCard key={`${task.kind ?? "CONTROL"}-${task.id}`} task={task} />)}</div> : <div className="notice">Inga uppgifter matchar urvalet.</div>}
      {filtered.length > shown.length ? <div className="flex items-center justify-center gap-3 text-xs text-muted-foreground"><span>Visar {shown.length} av {filtered.length}</span><Button type="button" variant="outline" onClick={() => setLimit((current) => current + TASK_PAGE_SIZE * 2)}>Visa fler</Button></div> : null}
    </> : <WorkspaceEmptyState kind="tasks" />}
  </div>;
}

function TaskCard({ task }: { task: WorkflowTask & { projectName: string } }) {
  const progress = taskProgress(task);
  const remaining = task.status === "COMPLETED" ? "Inget återstår" : `${Math.max(0, 100 - progress)}% återstår`;
  return <Link href={taskHref(task)} className="workflow-card group flex flex-col p-4">
    <div className="flex items-start gap-3"><span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-feature-control-soft text-feature-control"><CheckCircle2 className="size-4" /></span><div className="min-w-0 flex-1"><h2 className="line-clamp-2 text-sm font-semibold group-hover:text-primary">{task.number ? `#${task.number} · ` : ""}{task.title}</h2><p className="mt-0.5 truncate text-xs text-muted-foreground">{taskTypeLabel(task)} · {task.projectName ? `Projekt: ${task.projectName}` : "Fristående uppgift"}</p></div><TaskState task={task} /></div>
    <div className="mt-4"><div className="h-1.5 overflow-hidden rounded-full bg-muted"><div className={`h-full rounded-full ${indicatorBar(progressTone({ percent: progress, completed: task.status === "COMPLETED", attention: task.status === "NEEDS_ACTION" }))}`} style={{ width: `${progress}%` }} /></div><div className="mt-1.5 flex items-center justify-between gap-3 text-xs text-muted-foreground"><span>{remaining}</span><span className="inline-flex items-center gap-1 font-medium text-foreground">{progress}% klart<ArrowRight className="size-3.5 text-primary" aria-label={task.status === "COMPLETED" && task.kind ? "Visa eller återöppna" : "Öppna uppgift"} /></span></div></div>
  </Link>;
}

function RemoteTaskList({ page, busy, error, filter, query, canCreate, onFilter, onQuery, onMore }: { page: RemoteTaskPage | null; busy: boolean; error: string; filter: TaskFilter; query: string; canCreate: boolean; onFilter: (value: TaskFilter) => void; onQuery: (value: string) => void; onMore: () => void }) {
  const filters: [TaskFilter, string][] = [["open", "Öppna"], ["active", "Pågår"], ["planned", "Planerade"], ["action", "Behöver åtgärdas"], ["done", "Slutförda"], ["all", "Alla"]];
  const hasAny = Boolean(page && (page.counts.all > 0 || query));
  return <div className="space-y-5">
    <div className="flex flex-wrap items-start justify-between gap-4"><div><h1 className="page-title">Mina uppgifter</h1><p className="page-description mt-2">Uppgifter som är tilldelade till dig eller skapade av dig. Översikt visar hela teamets arbete.</p></div>{hasAny && canCreate ? <Button asChild><Link href="/?view=new_task"><Plus />Ny uppgift</Link></Button> : null}</div>
    {error ? <p role="alert" className="notice text-destructive">{error}</p> : null}
    {!page ? <p role="status" className="text-sm text-muted-foreground">Hämtar dina uppgifter…</p> : hasAny ? <>
      <div className="flex flex-col gap-3 rounded-xl border bg-card p-2.5 shadow-xs lg:flex-row lg:items-center lg:justify-between">
        <div className="-mx-1 flex gap-1 overflow-x-auto px-1 lg:flex-wrap lg:overflow-visible" role="group" aria-label="Filtrera mina uppgifter">{filters.map(([value, label]) => <Button key={value} type="button" size="sm" variant={filter === value ? "secondary" : "ghost"} aria-pressed={filter === value} onClick={() => onFilter(value)}>{label} ({page.counts[value] ?? 0})</Button>)}</div>
        <div className="relative lg:w-72"><Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden="true" /><Input type="search" aria-label="Sök bland mina uppgifter" placeholder="Sök uppgift eller projekt" value={query} onChange={(event) => onQuery(event.target.value)} className="pl-9" /></div>
      </div>
      {page.items.length ? <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3" aria-busy={busy}>{page.items.map((task) => <TaskCard key={`${task.kind ?? "CONTROL"}-${task.id}`} task={task} />)}</div> : <div className="notice">Inga uppgifter matchar urvalet.</div>}
      <ShowMore shown={page.items.length} total={page.total} busy={busy} onMore={onMore} />
    </> : <WorkspaceEmptyState kind="tasks" />}
  </div>;
}

function WorkspaceEmptyState({ kind }: { kind: "projects" | "tasks" }) {
  const projects = kind === "projects";
  const steps = projects
    ? ["Skapa projektets grunduppgifter", "Lägg till nya eller befintliga uppgifter", "Följ status och verklig progression"]
    : ["Välj uppgiftstyp", "Arbeta fristående eller välj ett projekt", "Koppla uppgiften till ett projekt även senare"];
  return <section className="overflow-hidden rounded-2xl border bg-card shadow-xs">
    <div className="grid min-h-80 lg:grid-cols-[1.15fr_.85fr]">
      <div className="flex flex-col justify-center p-7 sm:p-10">
        <span className="flex size-12 items-center justify-center rounded-2xl bg-secondary text-primary">{projects ? <FolderKanban className="size-6" /> : <ClipboardList className="size-6" />}</span>
        <p className="mt-6 text-xs font-semibold uppercase tracking-[.16em] text-primary">Kom igång</p>
        <h2 className="mt-2 text-xl font-semibold tracking-tight">{projects ? "Skapa din första gemensamma arbetsyta" : "Skapa din första uppgift"}</h2>
        <p className="mt-3 max-w-xl text-sm leading-6 text-muted-foreground">{projects ? "Ett projekt samlar uppgifter, ansvar och progression på ett ställe. Du kan också fortsätta arbeta med fristående uppgifter." : "Välj Kontroll före idrifttagning, Arbetsorder eller Riskbedömning. Uppgiften kan vara fristående eller kopplas till ett projekt."}</p>
        <div className="mt-6 flex flex-wrap gap-2"><Button asChild><Link href={projects ? "/?view=new_project" : "/?view=new_task"}><Plus />{projects ? "Skapa projekt" : "Skapa uppgift"}</Link></Button><Button asChild variant="outline"><Link href={projects ? "/?view=new_task" : "/?view=projects"}>{projects ? "Skapa fristående uppgift" : "Visa projekt"}</Link></Button></div>
      </div>
      <div className="border-t bg-muted/35 p-7 sm:p-10 lg:border-l lg:border-t-0">
        <p className="text-sm font-semibold">Så fungerar det</p>
        <ol className="mt-5 space-y-4">{steps.map((step, index) => <li key={step} className="flex items-start gap-3"><span className="flex size-7 shrink-0 items-center justify-center rounded-full bg-card text-xs font-semibold text-primary shadow-xs ring-1 ring-border">{index + 1}</span><span className="pt-1 text-sm leading-5 text-muted-foreground">{step}</span></li>)}</ol>
      </div>
    </div>
  </section>;
}

function ProjectForm({ project, customers, members, busy, error, canEditFrame = true, tasks = [], activities = [], onCancel, onSave }: { project?: WorkflowProject; customers: CustomerItem[]; members: ProjectMember[]; busy: boolean; error: string; canEditFrame?: boolean; tasks?: WorkflowTask[]; activities?: PlannedActivity[]; onCancel?: () => void; onSave: (input: ProjectFormInput) => Promise<void> }) {
  // Changing the frame shows what falls outside first (Daniel 2026-09-26, decision 5).
  const [preview, setPreview] = useState<{ input: ProjectFormInput; outside: string[]; shiftDays: number } | null>(null);
  const [name, setName] = useState(project?.name ?? ""); const [description, setDescription] = useState(project?.description ?? ""); const [customerId, setCustomerId] = useState(project?.customerId ?? ""); const [responsibleUserId, setResponsibleUserId] = useState(project?.responsibleUserId ?? ""); const [timeBudgetHours, setTimeBudgetHours] = useState(project?.timeBudgetMinutes ? String(project.timeBudgetMinutes / 60) : "");
  const [startDate, setStartDate] = useState(project?.startDate ?? ""); const [dueDate, setDueDate] = useState(project?.dueDate ?? "");
  // The customer's facility (decision 11): chosen among the selected customer's facilities; a paused one stays if already linked.
  const [facilityId, setFacilityId] = useState(project?.facilityId ?? "");
  const facilities = (customers.find((customer) => customer.id === customerId)?.facilities ?? []).filter((facility) => facility.isActive || facility.id === project?.facilityId);
  const [fields, setFields] = useState({ client: project?.client ?? "", contactPerson: project?.contactPerson ?? "", reference: project?.reference ?? "", workSite: project?.workSite ?? "" });
  const [formError, setFormError] = useState("");
  const responsibleName = members.find((member) => member.id === responsibleUserId)?.name ?? "";
  // New projects need a frame (Daniel 2026-09-26); an existing project may stay without one until someone sets it.
  const frameRequired = !project || Boolean(project.startDate || project.dueDate);
  const field = (key: keyof typeof fields, label: string, max: number) => <label className="block space-y-2 text-xs font-medium text-muted-foreground">{label}<Input value={fields[key]} onChange={(event) => setFields((current) => ({ ...current, [key]: event.target.value }))} maxLength={max} /></label>;
  return <form className="space-y-5" onSubmit={(event) => {
    event.preventDefault();
    const frameError = projectFrameError({ startDate, dueDate }, !project);
    if (frameError) { setFormError(frameError); return; }
    setFormError("");
    const hours = timeBudgetHours.trim() ? Number(timeBudgetHours.replace(",", ".")) : 0;
    const input: ProjectFormInput = { id: project?.id, name, description, startDate, dueDate, ...fields, customerId: customerId || null, facilityId: customerId && facilityId ? facilityId : null, responsibleUserId: responsibleUserId || null, responsibleName, timeBudgetMinutes: Number.isFinite(hours) ? Math.round(hours * 60) : -1 };
    const frame = { startDate, dueDate };
    if (project && hasProjectFrame(frame) && (project.startDate !== startDate || project.dueDate !== dueDate)) {
      const outside = [
        ...tasks.filter((task) => task.status !== "COMPLETED" && taskDueDateError(task.dueDate ?? "", frame)).map((task) => `${taskTypeLabel(task)}: ${task.title} (Klart senast ${task.dueDate})`),
        ...activities.filter((activity) => !activity.deletedAt && ["PLANNED", "IN_PROGRESS"].includes(activity.status) && planningFrameError(activity, frame)).map((activity) => `Planering: ${activity.title} (${formatDateTime(activity.startsAt)})`),
      ];
      if (outside.length) { setPreview({ input, outside, shiftDays: frameShiftDays(project, frame) }); return; }
    }
    void onSave(input);
  }}>
    {preview ? <div data-testid="project-frame-preview" role="alertdialog" aria-label="Utanför den nya tidsramen" className={cn("space-y-3 rounded-xl border p-4 text-sm", indicatorBadge("warning"))}>
      <p className="font-semibold">{preview.outside.length} {preview.outside.length === 1 ? "sak hamnar" : "saker hamnar"} utanför den nya tidsramen</p>
      <ul className="max-h-40 list-disc space-y-0.5 overflow-y-auto pl-5 text-xs">{preview.outside.map((item) => <li key={item}>{item}</li>)}</ul>
      <p className="text-xs">Flytta öppna uppgifters Klart senast och aktiv planering lika mycket som tidsramen, eller spara ändå och justera själv. Planeringar du inte får ändra flyttas inte.</p>
      <div className="flex flex-wrap justify-end gap-2"><Button type="button" variant="ghost" onClick={() => setPreview(null)}>Tillbaka</Button><Button type="button" variant="outline" disabled={busy} onClick={() => { const next = preview.input; setPreview(null); void onSave({ ...next, shiftDays: 0 }); }}>Spara ändå</Button>{preview.shiftDays ? <Button type="button" disabled={busy} onClick={() => { const next = preview; setPreview(null); void onSave({ ...next.input, shiftDays: next.shiftDays }); }}>Flytta allt {Math.abs(preview.shiftDays)} {Math.abs(preview.shiftDays) === 1 ? "dag" : "dagar"} {preview.shiftDays > 0 ? "framåt" : "bakåt"}</Button> : null}</div>
    </div> : null}
    <label className="block space-y-2 text-xs font-medium text-muted-foreground">Projektnamn<Input value={name} onChange={(event) => setName(event.target.value)} maxLength={160} required autoFocus /></label>
    <fieldset className="rounded-xl border p-4"><legend className="px-1 text-xs font-medium text-muted-foreground">Tidsram</legend>
      <div className="grid gap-4 sm:grid-cols-2"><label className="block space-y-2 text-xs font-medium text-muted-foreground">Startdatum<Input type="date" value={startDate} onChange={(event) => setStartDate(event.target.value)} required={frameRequired} disabled={!canEditFrame} /></label><label className="block space-y-2 text-xs font-medium text-muted-foreground">Slutdatum<Input type="date" value={dueDate} min={startDate || undefined} onChange={(event) => setDueDate(event.target.value)} required={frameRequired} disabled={!canEditFrame} /></label></div>
      <p className="mt-2 text-xs text-muted-foreground">{canEditFrame ? "Uppgifter och planering i projektet ska hålla sig inom tidsramen." : "Bara projektansvarig eller en företagsadministratör kan ändra tidsramen."}</p>
    </fieldset>
    <div className="grid gap-5 sm:grid-cols-2"><label className="block space-y-2 text-xs font-medium text-muted-foreground">Kund (valfri)<select className="form-select" value={customerId} onChange={(event) => { setCustomerId(event.target.value); setFacilityId(""); }}><option value="">Ingen kund</option>{customers.filter((customer) => !customer.deletedAt).map((customer) => <option key={customer.id} value={customer.id}>{customer.name}{customer.company ? ` · ${customer.company}` : ""}</option>)}</select></label>
    <CustomerSearchBox onPick={(customer) => { setCustomerId(customer.id); setFacilityId(""); }} /><label className="block space-y-2 text-xs font-medium text-muted-foreground">Projektansvarig (valfri)<select className="form-select" value={responsibleUserId} onChange={(event) => setResponsibleUserId(event.target.value)}><option value="">Ingen ansvarig</option>{members.map((member) => <option key={member.id} value={member.id}>{member.name}</option>)}</select></label></div>
    {customerId ? <label className="block space-y-2 text-xs font-medium text-muted-foreground">Kundens anläggning (valfri)<select className="form-select" value={facilityId} onChange={(event) => setFacilityId(event.target.value)}><option value="">Ingen anläggning</option>{facilities.map((facility) => <option key={facility.id} value={facility.id}>{facilityLabel(facility)}{facility.isActive ? "" : " (pausad)"}</option>)}</select>{!facilities.length && <span className="block text-xs font-normal">Kunden har inga anläggningar. Lägg till dem på kundkortet.</span>}</label> : null}
    <div className="grid gap-5 sm:grid-cols-2">{field("client", "Beställare", 200)}{field("contactPerson", "Kontaktperson", 200)}{field("reference", "Referens / ordernummer", 120)}{field("workSite", "Arbetsplats / anläggning", 300)}</div>
    <div className="space-y-2"><label htmlFor="project-time-budget" className="block text-xs font-medium text-muted-foreground">Tidsbudget (timmar)</label><Input id="project-time-budget" type="number" min="0" max="166666" step="0.25" inputMode="decimal" value={timeBudgetHours} onChange={(event) => setTimeBudgetHours(event.target.value)} placeholder="Exempel: 7,5" aria-describedby="project-time-budget-help" className="sm:max-w-xs" /><span id="project-time-budget-help" className="block text-xs font-normal text-muted-foreground">Budgeten är separat från planerad och rapporterad tid.</span></div>
    <label className="block space-y-2 text-xs font-medium text-muted-foreground">Arbetsbeskrivning<textarea className="form-textarea" value={description} onChange={(event) => setDescription(event.target.value)} maxLength={2000} /></label>
    <p className="text-xs text-muted-foreground">Beställare, kontaktperson, referens, arbetsplats och arbetsbeskrivning visas i alla projektets uppgifter och i rapporterna.</p>
    {formError || error ? <p role="alert" className="text-sm text-destructive">{formError || error}</p> : null}<div className="flex flex-wrap justify-end gap-2">{onCancel && <Button type="button" variant="outline" onClick={onCancel}>Avbryt</Button>}<Button type="submit" disabled={busy || !name.trim()}>{project ? "Spara ändringar" : "Skapa projekt"}</Button></div></form>;
}
