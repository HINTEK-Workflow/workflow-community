"use client";
import { useSubPageHref } from "@/features/kfid/use-return-to";
import { ExtraFilterSelect, Segmented } from "@/components/list-filter-bar";
import { ListToolbar, PageHeader, usePageTrail } from "@/components/page-shell";
import { DisabledReason } from "@/components/ui/disabled-reason";
import { endFollowingStart, jobFill, jobPeople, jobPeriodLabel, jobStartDay, planningJobGroups, PLANNING_JOB_SEARCH_FROM } from "@/lib/workflow/planning-form";

import { clientExtensions } from "@ee/client";
import { useReturnDraft, useReturnDraftValues } from "./use-return-draft";
import { useConfirm } from "./confirm";
import { useCallback, useEffect, useId, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { placeAfterCustomerChange } from "@/lib/workflow/customer-place";
import { AlertTriangle, FileText, Archive, BarChart3, CalendarClock, CalendarDays, CalendarPlus, CheckCircle2, ChevronLeft, ChevronRight, ChevronsUpDown, Clock3, CornerDownRight, GanttChart, History, Link2, Pencil, Play, Plus, Repeat, RotateCcw, Search, SlidersHorizontal, Trash2, UserRound, Info, TrendingUp, ScrollText, CalendarCheck, Package, ListChecks, Wrench } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { addSwedishDays, formatSwedish, fromSwedishDateInput, fromSwedishDateTimeInput, isSameSwedishDay, startOfSwedishDay, SWEDISH_TIME_ZONE, swedishDayDifference, swedishDayKey, swedishParts, toSwedishDateTimeInput } from "@/lib/swedish-time";
import { api } from "./api";
import { PlanningDelegateRow } from "@/features/workflow/planning-delegate";
import { bookedUserIds, bookingChangeRefusal, bookJobHref, canChangeOthersBookings } from "@/lib/workflow/bookings";
import { parseBookPeople } from "@/lib/workflow/assign-work-order";
import { CollapsibleSection, Empty, DialogActions, FormPage, FormPanel, Modal, Panel, ShowMore, useFormPopup } from "./ui";
import { groupProjectJobs, JOB_LIST_PAGE, JOB_STEP_LABELS, type JobStep } from "@/lib/workflow/project-jobs";
import { datesOnProjectLink, groupByStage, projectShift, stageSummary } from "@/lib/workflow/job-planning";
import { jobObstacle, type Obstacle } from "@/lib/workflow/obstacles";
import { ObstacleChip } from "@/features/workflow/obstacle-dialog";
import { shortDay } from "@/lib/workflow/schedule";
import { ProjectSchedule } from "@/features/workflow/project-schedule";
import { ProjectEffortRow } from "@/features/workflow/project-effort-row";
import { PROJECT_MATERIAL_LIMIT, PROJECT_MATERIAL_PAGE, projectMaterialsCsv, type ProjectMaterialSummary } from "@/lib/workflow/project-materials";
import { WholesaleExport } from "@/features/wholesale/wholesale-export";
import { fromProjectMaterials } from "@/lib/wholesale/sources";
import { canSeePrices, unpricedText } from "@/lib/workflow/material-prices";
import { formatSek } from "@/lib/workflow/expenses";
import type { CustomerItem, ProjectItem } from "./types";
import type { WorkflowReportOptions } from "@/lib/workflow/report";
import { ReportOptionsButton, type ProjectReportChoice } from "@/features/workflow/report-options";
import { announce, announceWarning } from "@/lib/workflow/toast";
import { announceArchiveResult, downloadResponse } from "@/features/workflow/report-archive-client";
import { FlowGuide } from "@/features/workflow/flow-guide";
import { placeLabel } from "@/lib/workflow/customer-facility";
import { projectFlow } from "@/lib/workflow/task-flow";
import { canReadRounds as mayReadRounds, defaultWorkflowPermissionProfile, hasWorkflowPermission, workflowSubjectForTask, type WorkflowPermissionAction, type WorkflowPermissionProfile, type WorkflowPermissionSubject } from "@/lib/workflow/permissions";
import { summarizeProjectBudget } from "@/lib/workflow/project-budget";
import { canArchiveProject, canManageProjectLifecycle, isActivePlanning, summarizeProjectStatus, type ProjectStatus } from "@/lib/workflow/project-status";
import { formatFrame, frameMovedWhole, frameShiftDays, hasProjectFrame, planningAfterTaskDue, planningFrameError, projectAboutRows, projectFrameError, projectFrameIssues, taskDueDateError } from "@/lib/workflow/project-frame";
import { customerContactName, customerDisplayName, type ProjectCustomerChange } from "@/lib/workflow/project-customer";
import { canBookAnything, plannedActivityWriteRefusal } from "@/lib/workflow/planned-activity-access";
import { assignmentLoadMinutes, capacityInWindow, capacityWeek, plannedMinutesByTask, plannedMinutesForUserInWindow, type CapacityActivity, type CapacityPerson } from "@/lib/workflow/capacity-summary";
import type { ToBookRow } from "@/lib/overview/team-followup";
import { CapacityFoldedPanel } from "@/features/workflow/capacity-page";
import { cloudCapacityRead, type CapacityRead } from "@/features/workflow/capacity-read";
import { plannedActivityAssignments } from "@/lib/workflow/planned-activity";
import { projectCompletion, summarizeFrameAdherence, type FrameAdherence } from "@/lib/workflow/project-progress";
import { cloudSavePlace, type SavePlace } from "@/features/workflow/place-picker";
import { conflictInvolves, conflictLine, summarizeAvailability } from "@/lib/workflow/availability-summary";
import { dayViewAnchor, isInSwedishMonth, movePlannedActivityToDay, movePlanningCalendar, planningActivitiesForDay, planningCalendarDays, planningCalendarTitle, planningDefaultInterval, shortNames, type PlanningCalendarMode } from "@/lib/workflow/planning-calendar-summary";
import { personSolidTone, personSurfaceTone } from "@/features/workflow/person-tone";
import { projectPeople } from "@/lib/workflow/project-people";
import { budgetTone, indicatorBadge, indicatorBar, indicatorText, progressTone, statusTone, type IndicatorTone } from "@/features/workflow/indicator-tone";
import { ProjectStarter } from "@/features/workflow/project-starter";
import { NewChoiceMenu } from "@/features/workflow/new-choice-menu";
import { projectJobChoices } from "@/lib/workflow/new-choices";
import { ProjectTimePanel } from "@/features/workflow/project-time-panel";
import { CommentThread } from "@/features/workflow/comment-thread";
import type { StoppedTimer } from "@/lib/workflow/running-timer";
import { ProjectAssignment } from "@/features/self-inspection/work";
import { ProjectQuotes } from "@/features/quotes/project-quotes";
import { InvoiceBasisNativeRow, InvoiceBasisPanel } from "@/features/invoice-basis/invoice-basis-panel";
import { cloudReadCustomer, cloudSaveCustomer, type SaveCustomer } from "./customer-form-dialog";
import { useCustomerReference } from "./customer-options";
import type { CustomerQuickLinks } from "@/features/workflow/customer-field";
import { SharedBasicsFields } from "@/features/workflow/shared-basics";
import { TasksPage, WorkspaceEmptyState } from "./tasks-page";
import { WorkList, useWorkListPrefs, type WorkListExtraFilter, type WorkListItem } from "@/features/workflow/work-list";
import { useAddressEntryState } from "@/components/use-address-filter";
import { allowedFilter } from "@/lib/url-filters";
import { PROJECT_ATTENTION, PROJECT_ATTENTION_LABEL, projectAttention, type ProjectAttention } from "@/lib/workflow/project-filters";
import { listDate } from "@/features/workflow/work-list-items";
import { StaffRegisterFields } from "@/features/workflow/staff-register-fields";
import { EMPTY_STAFF_REGISTER, keepsWorkflowRegister, staffRegisterOf, type StaffRegister } from "@/lib/workflow/staff-register";
import { StaffRegisterPanel } from "@/features/workflow/staff-register-panel";
import { useModules } from "@/features/workflow/use-modules";
import { NativeScreen } from "@/components/native";
import { NativeNewProject, NativeProjectHead, NativeProjectRows, type NativeProjectProps } from "@/features/workflow/native-project";
import { NativePlanning } from "@/features/workflow/native-planning";
import { ListEmpty, ListGroup, ListRow, ListSkeleton, NativeActions } from "@/components/native";
import { groupByDate } from "@/lib/workflow/native-mode";
import { useDetailLevel, useNativeMode } from "@/features/workflow/use-detail-level";
import { nativeHidesView } from "@/lib/workflow/native-mode";
import { PROJECT_PAGE_SUBTITLE } from "@/lib/workflow/menu-items";
import { addDays } from "@/lib/workflow/form-schedule";
import { capacityLoads, PLANNING_ROUND_STATE_LABEL, planningRoundMatchesStatus, type PlanningRound, type RoundCapacityActivity } from "@/lib/workflow/planning-rounds";
import { PLAN_STATE_LABELS, planningMaintenanceMatchesStatus, type PlanningMaintenance } from "@/lib/maintenance/plan-model";
import { listWork, PROJECT_FILTER_LABEL, PROJECT_LIST_FILTERS, WORK_LIST_PAGE_SIZE, workListScopes, type WorkListScope, type WorkListSort, type WorkListView } from "@/lib/workflow/work-list";
import { useLoadEffect } from "@/lib/use-load-effect";
import { returnToWork, useEntryState } from "@/components/history-nav";
import { isTaskCancelled, isTaskOpen, TASK_CANCEL_LABEL, TASK_CANCELLED_LABEL } from "@/lib/workflow/task-cancel";
import { IconButton } from "@/components/ui/icon-button";
import { RemoveButton } from "@/components/ui/remove-button";
import { saveBlob } from "@/lib/download";
import { DownloadButton } from "@/components/ui/download-button";
import { customerTitle } from "@/lib/kfid/customer-name";

const { PlanningProposal } = clientExtensions;

export type WorkflowTask = {
  id: string;
  title: string;
  status: string;
  updatedAt: string;
  /** A protocol's permission area (forms, kfid or risk-assessment). */
  formArea?: string | null;
  projectId?: string | null;
  progress?: number;
  totalDurationSec?: number;
  kind: "WORK_ORDER" | "RISK_ASSESSMENT" | "FORM";
  dueDate?: string;
  /** When it was completed (Local's file has it): the job list's "Färdigställda från" (dashboard etapp 3). */
  completedAt?: string | null;
  /** Tidplan (steg 2): Uppskattad tid in minutes; weighs the project's completion (lib/workflow/project-effort.ts). */
  estimatedMinutes?: number | null;
  /** Start på alla jobb och Etapp (plan 1M): the job's Start ("" = counted from createdAt) and its stage label. */
  plannedStartDate?: string;
  /** A round's work order: it keeps its period when it joins a project. */
  roundScheduleId?: string | null;
  stage?: string;
  createdAt?: string;
  /** Rapportera hinder (plan 1M): what the job waits for, sent with the project view (Local reads it from the job's data). */
  obstacle?: Obstacle | null;
  customerId?: string | null;
  isMine?: boolean;
  assignedToUserId?: string | null;
  assignedToName?: string;
  /** Names for the lists (Local fills them from the open file). */
  customerName?: string;
  placeName?: string;
  /** A work order's priority and waiting reason for the lists (Local fills them from the open file). */
  maintenance?: { type?: string; priority?: string; waitingOn?: string } | null;
  /** Hör till arbetsorder (Fas 2): the work order the task belongs to, for "Hör till: …" in the lists. */
  workOrderId?: string | null;
  workOrderTitle?: string;
  /** Samlad bild (Fas 4B): the job's current step, sent with the project view (Cloud, Local and the demo). */
  step?: JobStep;
  /** A protocol's form name for the lists (the project view sends the job's data; the lean lists do not). */
  data?: { details?: { templateName?: string | null } | null } | null;
};
/** A project job's period text for a stage's summary row: "5 okt – 16 okt". */
const stagePeriodText = (summary: { start: string; end: string }) => !summary.start ? "" : !summary.end || summary.end === summary.start ? shortDay(summary.start) : `${shortDay(summary.start)} – ${shortDay(summary.end)}`;
export type WorkflowProject =ProjectItem & {
  customer?: { id: string; name: string; company: string } | null;
  workflowTasks?: WorkflowTask[];
  /** Material i projektet (2026-10-09): sent with the project view to those who may read work orders. */
  materials?: ProjectMaterialSummary;
};
type ProjectMember = { id: string; name: string };
type PlanningCapacity = { currentUserId: string; weeklyWorkMinutes: number;
  /** Ingen fast arbetstid (2026-10-30): no capacity to plan against; the weekly time only spreads bookings. */ noFixedHours?: boolean };
type TeamCapacityMember = { id: string; name: string; weeklyWorkMinutes: number; memberWeeklyWorkMinutes: number | null; noFixedHours?: boolean; events: { id: string; previousMinutes: number | null; nextMinutes: number | null; actorName: string; createdAt: string }[] };
type PlanningTeamCapacity = { canViewTeam: boolean; organizationWeeklyWorkMinutes: number; members: TeamCapacityMember[]; activities: (CapacityActivity & { id: string; title: string })[];
  /** Frånvaro (2026-10-29): approved absence in the window, with the words this person may see. */
  absences?: PlanningAbsence[] };
type PlanningAbsence = { userId: string; name: string; label: string; from: string; to: string; hours?: { start: string; end: string } | null };
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
  assignedToUserId: string | null;
  assignedToUserIds: string[];
  assignments: { userId: string; plannedMinutes: number | null; startsAt: string | null; endsAt: string | null }[];
  assignedToName: string;
  deletedAt?: string | null;
  project?: { id: string; name: string; timeBudgetMinutes: number } | null;
  /** The booked job's status (Cloud and Local): a booking on a job that has utgått never clashes (2026-10-09). */
  workflowTask?: { status?: string | null } | null;
  events?: { id: string; kind: string; summary: string; actorName: string; createdAt: string }[];
  eventCount?: number;
};
type PlannedActivityInput = Omit<PlannedActivity, "id" | "version" | "deletedAt" | "events" | "eventCount" | "workflowTask"> & { id?: string; version?: number; frameExceptionReason?: string };

/** The link guide's choices (decision 7): the project's value per field, or keep the task's own. */
type LinkChoices = { customer: boolean; responsible: boolean; dueDate: string };
type LocalProjectAdapter = {
  /** Projekttid (2026-10-26): the project's own timer in the open file. */
  projectTimer?: (projectId: string, command: "START" | "PAUSE", options?: { keepShort?: boolean }) => Promise<StoppedTimer[]>;
  /** Adds a place to the open file from the project's Plats field (2026-10-04). */
  savePlace?: SavePlace;
  /** Saves a customer in the open file from "Lägg till kund" / "Redigera kund" (2026-10-08). */
  saveCustomer?: SaveCustomer;
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
  /** Driftronder i Planeringen (2026-10-06): the rounds of the period, computed from the file's schedules. */
  rounds?: LoadPlanningRounds;
  /** Att boka (2026-11-02): the work orders in the file that wait for their first booking. */
  toBook?: () => { total: number; rows: ToBookRow[] };
  members: ProjectMember[];
  capacity: PlanningCapacity;
  teamCapacity: PlanningTeamCapacity;
  report?: (project: WorkflowProject, options: WorkflowReportOptions, selected: ProjectReportChoice[]) => Promise<void>;
};
type ProjectFormInput = { id?: string; name: string; description: string; startDate: string; dueDate: string; client: string; contactPerson: string; reference: string; workSite: string; staffRegister?: StaffRegister; customerId: string | null; facilityId?: string | null; responsibleUserId: string | null; responsibleName: string; timeBudgetMinutes?: number; shiftDays?: number;
  /** Kundbyte (2026-10-10): the explicit choice to move the project's open jobs to the new customer. */
  customerChange?: "move_jobs" };

function taskState(task: WorkflowTask) {
  if (task.status === "COMPLETED") return "done" as const;
  // Utgått (2026-10-09): neither done nor remaining; shown as Utgått and left out of what is left to do.
  if (isTaskCancelled(task.status)) return "cancelled" as const;
  if (["IN_PROGRESS", "PAUSED", "NEEDS_ACTION"].includes(task.status) || (task.progress ?? 0) > 0) return "active" as const;
  return "planned" as const;
}

const projectTasks = (project: WorkflowProject) => project.workflowTasks ?? [];

const taskProgress = (task: WorkflowTask) => task.status === "COMPLETED" ? 100 : task.progress ?? 0;

/** The job's type for the lists: a protocol says its form's name, not "Formulär" (plan 1C, 2026-10-11). */
const taskTypeLabel = (task: WorkflowTask) => task.kind === "WORK_ORDER" ? "Arbetsorder" : task.kind === "RISK_ASSESSMENT" ? "Riskbedömning" : task.data?.details?.templateName?.trim() || "Formulär";

const taskHref = (task: Pick<WorkflowTask, "id" | "kind">) => `/?view=workflow_task&taskId=${encodeURIComponent(task.id)}&taskType=${task.kind}`;

function projectProgress(project: WorkflowProject) {
  return projectCompletion(projectTasks(project).map((task) => ({ status: task.status, progress: taskProgress(task), estimatedMinutes: task.estimatedMinutes })));
}

/** Cloud sends the status computed on the server; Local computes it from the open file with the same function. */
type LoadPlanningRounds = (period: { from: string; to: string }) => Promise<{ rounds: PlanningRound[]; truncated: boolean }>;
/** Cloud and the demo: the rounds of the period from the server, computed from the schedules there. */
/** Återkommande underhåll (2026-10-30): the plans' work orders of the period (Cloud; an empty answer without the module). */
type LoadPlanningMaintenance = (period: { from: string; to: string }) => Promise<{ occurrences: PlanningMaintenance[]; truncated: boolean }>;
const cloudPlanningMaintenance: LoadPlanningMaintenance = (period) => api<{ occurrences: PlanningMaintenance[]; truncated: boolean }>(`/api/maintenance?part=planning&from=${period.from}&to=${period.to}`);
const cloudToBook = () => api<{ total: number; rows: ToBookRow[] }>("/api/planned-activities?toBook=1");
const cloudPlanningRounds: LoadPlanningRounds = (period) => api<{ rounds: PlanningRound[]; truncated: boolean }>(`/api/form-schedules?planning=1&from=${period.from}&to=${period.to}`);
/** Totals over every readable planned activity, from `/api/planned-activities?summary=1`. */
type PlanningSummary = { taskIds: string[] };
/** The period Planning reads first: seven weeks back (the month view and a week more) and three months ahead (Swedish days; "" = no bound). */
const PLANNING_WINDOW_DAYS = { before: 49, after: 92 } as const;
function defaultPlanningWindow() {
  const now = new Date();
  return { from: swedishDayKey(addSwedishDays(now, -PLANNING_WINDOW_DAYS.before)), to: swedishDayKey(addSwedishDays(now, PLANNING_WINDOW_DAYS.after)) };
}

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

type ProjectTab = "ongoing" | "closed" | "archived";
/** Tab counts are null where they would be team aggregates for an ordinary member ("Alla"). */
type ProjectListMeta = { total: number; page: number; pages: number; counts: Record<ProjectTab, number> | null };
type ProjectsResponse = { projects: WorkflowProject[]; workflowTasks: WorkflowTask[]; members: ProjectMember[]; currentUserId?: string } & Partial<ProjectListMeta>;

/** Planering's views (Tidplan = `planning`, Kalender = `calendar`, 2026-10-30) and Projektstatistik, reached from Projekt. */
type ProjectPages = { planning: boolean; summary: boolean; calendar?: boolean };
const NO_PROJECT_PAGES: ProjectPages = { planning: false, summary: false, calendar: false };
/** Planering's address from Projekt: Tidplan where there is one, else Kalender (Local, a job's right alone); null without either. */
const planningPageHref = (pages: ProjectPages) => pages.planning ? "/?view=project_planning" : pages.calendar ? "/?view=planning" : null;

export function WorkflowProjects({
  view,
  projectId,
  customers,
  local,
  permissions,
  admin = false,
  personId = "",
  onProjectSaved,
  projectPages = NO_PROJECT_PAGES,
}: {
  view: "projects" | "planning" | "project" | "tasks" | "new_project";
  /** The signed-in person, for list choices remembered on this device. */
  personId?: string;
  projectId?: string;
  customers: CustomerItem[];
  local?: LocalProjectAdapter;
  permissions?: WorkflowPermissionProfile;
  admin?: boolean;
  /** Called after a saved project in Cloud, so the workspace reads the projects again (a job opened next shows the new customer, not the old). */
  onProjectSaved?: () => void;
  /** Planering and Projektstatistik, reached from Projekt (2026-10-23); the workspace decides by the pages' own rules. */
  projectPages?: ProjectPages;
}) {
  // Samband (2026-10-26): a task started from the project comes back to it.
  const subPage = useSubPageHref();
  const [confirmCard, confirmElement] = useConfirm();
  const nativeLook = useNativeMode();
  const [currentUserId, setCurrentUserId] = useState("");
  const [cloudProjects, setCloudProjects] = useState<WorkflowProject[]>([]);
  const [cloudCandidates, setCloudCandidates] = useState<(WorkflowTask & { fromProject?: string; plannedCount?: number })[] | null>(null);
  // "Mina projekt" in Cloud: one tab at a time, a page of cards from the server (2026-09-26).
  // The tab and Status may come from the address (dashboard etapp 3, 2026-10-28: the project key figure opens
  // Pågående, and a late, over-budget or ready project the Status filter; lib/url-filters.ts).
  const [listTab, setListTab] = useAddressEntryState<ProjectTab>("projects.tab", "filter", (raw) => allowedFilter(raw, PROJECT_LIST_FILTERS), "ongoing");
  const [listStatus, setListStatus] = useAddressEntryState<ProjectAttention | "">("projects.status", "status", (raw) => allowedFilter(raw, PROJECT_ATTENTION), "");
  const [listMeta, setListMeta] = useState<ProjectListMeta | null>(null);
  const [listBusy, setListBusy] = useState(false);
  const [cloudWorkflowTasks, setCloudWorkflowTasks] = useState<WorkflowTask[]>([]);
  const [cloudMembers, setCloudMembers] = useState<ProjectMember[]>([]);
  const [cloudPlannedActivities, setCloudPlannedActivities] = useState<PlannedActivity[]>([]);
  const [cloudTeamCapacity, setCloudTeamCapacity] = useState<PlanningTeamCapacity | null>(null);
  // Planning in Cloud reads the period it shows (quality check 2026-10-05, F5): a window around today that grows when
  // the calendar or "Tidsperiod" goes outside it ("" = no bound), plus totals over every activity as numbers.
  const [planningWindow, setPlanningWindow] = useState(defaultPlanningWindow);
  const [planningSummary, setPlanningSummary] = useState<PlanningSummary | null>(null);
  /** The window the planned activities in hand were read for (null until the first read), so the calendar waits for it. */
  const [loadedPlanningWindow, setLoadedPlanningWindow] = useState<{ from: string; to: string } | null>(null);
  const widenPlanningWindow = useCallback((from: string, to: string) => setPlanningWindow((current) => {
    const nextFrom = current.from === "" || from === "" ? "" : from < current.from ? from : current.from;
    const nextTo = current.to === "" || to === "" ? "" : to > current.to ? to : current.to;
    return nextFrom === current.from && nextTo === current.to ? current : { from: nextFrom, to: nextTo };
  }), []);
  const router = useRouter();
  // Nytt projekt from a customer card (plan 1A, 2026-10-11): the customer in the address is filled in.
  const searchParams = useSearchParams();
  const newProjectCustomerId = searchParams.get("customerId");
  const [loading, setLoading] = useState(!local);
  const [error, setError] = useState("");
  // Forms as pages (plan 1O, 2026-10-11): Redigera projekt and Koppla befintlig uppgift have addresses of their own
  // (`&edit=1`, `&link=1`); Avbryt and Spara lead back to the project page.
  const projectHref = projectId ? `/?view=project&projectId=${encodeURIComponent(projectId)}` : "/?view=projects";
  const editing = view === "project" && searchParams.get("edit") === "1" && !searchParams.get("activityId");
  const linking = view === "project" && searchParams.get("link") === "1";
  const setEditing = (open: boolean) => { if (open) router.push(`${projectHref}&edit=1`); else returnToWork(projectHref, router.push); };
  const setLinking = (open: boolean) => { if (open) { setLinkTarget(null); router.push(`${projectHref}&link=1`); } else { setLinkTarget(null); setCloudCandidates(null); returnToWork(projectHref, router.push); } };
  const permissionProfile = permissions ?? defaultWorkflowPermissionProfile();
  const can = (subject: WorkflowPermissionSubject, action: WorkflowPermissionAction) => Boolean(local || admin || hasWorkflowPermission(permissionProfile, subject, action));
  // Företagets moduler (0.39.0): the project's panels of a module that is off are not drawn. Display only.
  const moduleIsOn = useModules();
  // Lägg till kund / Redigera kund beside the project's customer (2026-10-08); the server decides again.
  const customerQuick: CustomerQuickLinks | undefined = local ? (local.saveCustomer ? { save: local.saveCustomer, canCreate: true, canEdit: true } : undefined)
    : can("customers", "create") || can("customers", "edit") ? { save: cloudSaveCustomer, read: cloudReadCustomer, canCreate: can("customers", "create"), canEdit: can("customers", "edit"), returnable: true } : undefined;
  const canCreateTask = (["kfid", "work-order", "risk-assessment"] as const).some((subject) => can(subject, "create"));
  const canReadTask = (task: WorkflowTask) => can(workflowSubjectForTask(task.kind, task.formArea), "read");
  const canEditTask = (task: WorkflowTask) => can(workflowSubjectForTask(task.kind, task.formArea), "edit");
  const canReopenTask = (task: WorkflowTask) => can(workflowSubjectForTask(task.kind, task.formArea), "reopen");
  // Mina projekt on the shared list (2026-10-05): rows or cards, Mina / Alla and sorting, remembered per device.
  const canReadProjects = can("projects", "read");
  const projectScopes = useMemo(() => workListScopes({ canReadArea: canReadProjects }), [canReadProjects]);
  const projectPrefs = useWorkListPrefs("projects", personId, projectScopes);
  const [listQuery, setListQuery] = useEntryState("projects.query", "");
  const [listSearch, setListSearch] = useState(() => listQuery.trim());
  useEffect(() => { const timer = setTimeout(() => setListSearch(listQuery.trim()), 250); return () => clearTimeout(timer); }, [listQuery]);
  const listParams = `&scope=${projectPrefs.scope}&sort=${projectPrefs.sort}${listSearch ? `&q=${encodeURIComponent(listSearch)}` : ""}${listStatus && listTab === "ongoing" ? `&status=${listStatus}` : ""}`;
  const [reopening, setReopening] = useState(false);
  const [linkTarget, setLinkTarget] = useState<(WorkflowTask & { fromProject?: string; plannedCount?: number }) | null>(null);
  // Only the project's responsible (with project edit rights) or a company admin may plan outside its frame, with a logged reason.
  const canFrameException = (project: WorkflowProject) => Boolean(local) || canManageProjectLifecycle({ admin, userId: currentUserId, responsibleUserId: project.responsibleUserId, canEditProjects: can("projects", "edit") });
  const [busy, setBusy] = useState(false);
  const plannedActivities = local?.plannedActivities ?? cloudPlannedActivities;
  const sourceProjects = local?.projects ?? cloudProjects;
  const projects = useMemo(() => sourceProjects.map((project) => withProjectStatus(project, plannedActivities)), [plannedActivities, sourceProjects]);
  const generalTasks = local?.workflowTasks ?? cloudWorkflowTasks;
  const members = local?.members ?? cloudMembers;
  const teamCapacity = local?.teamCapacity ?? cloudTeamCapacity;
  // En räkning (2026-11-02): Planering reads the person's own row from the same read as everyone else's.
  const capacity = useMemo<PlanningCapacity | null>(() => {
    if (local) return local.capacity;
    if (!cloudTeamCapacity) return null;
    const own = cloudTeamCapacity.members.find((member) => member.id === currentUserId);
    return { currentUserId, weeklyWorkMinutes: own?.weeklyWorkMinutes ?? cloudTeamCapacity.organizationWeeklyWorkMinutes, noFixedHours: Boolean(own?.noFixedHours) };
  }, [cloudTeamCapacity, currentUserId, local]);
  const viewerId = local ? local.capacity.currentUserId : currentUserId;
  // The capacity count's read for Kapacitet in Local and the booking form's warnings: Cloud's two reads, or the open file.
  const roundsOn = moduleIsOn("rounds");
  const capacityRead = useMemo<CapacityRead>(() => local
    ? async (range) => ({ data: local.teamCapacity, rounds: roundsOn && local.rounds ? (await local.rounds(range)).rounds : [] })
    : cloudCapacityRead(roundsOn), [local, roundsOn]);
  const load = useCallback(async () => {
    if (local) return;
    // Mina uppgifter pages its own list from the server; the full project load is not needed there.
    if (view === "tasks") { setLoading(false); return; }
    // Bounded reads (2026-09-26): Mina projekt reads one page of one tab and the project view one project.
    if (view === "projects" || view === "new_project") {
      try {
        const result = await api<ProjectsResponse>(`/api/projects?list=${listTab}&page=1${listParams}`);
        setCloudProjects(result.projects);
        setCloudMembers(result.members);
        setCurrentUserId(result.currentUserId ?? "");
        setListMeta({ total: result.total ?? result.projects.length, page: result.page ?? 1, pages: result.pages ?? 1, counts: result.counts ?? null });
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
      const onProject = view === "project" && projectId;
      const windowQuery = new URLSearchParams(Object.entries(planningWindow).filter(([, value]) => value)).toString();
      const [result, planning, team, summary] = await Promise.all([
        api<ProjectsResponse>(onProject ? `/api/projects?id=${encodeURIComponent(projectId)}` : "/api/projects?scope=planning"),
        // The project view reads its own planning (and what overlaps it for clashes); Planning the shown period.
        api<{ activities: PlannedActivity[] }>(onProject ? `/api/planned-activities?forProject=${encodeURIComponent(projectId)}` : `/api/planned-activities${windowQuery ? `?${windowQuery}` : ""}`),
        view === "planning" ? api<PlanningTeamCapacity>(`/api/planning-capacity${windowQuery ? `?${windowQuery}` : ""}`) : Promise.resolve(null),
        view === "planning" ? api<PlanningSummary>("/api/planned-activities?summary=1") : Promise.resolve(null),
      ]);
      setPlanningSummary(summary);
      setCloudProjects(result.projects);
      setCloudWorkflowTasks(result.workflowTasks);
      setCloudCandidates(null);
      setCloudMembers(result.members);
      setCurrentUserId(result.currentUserId ?? "");
      setCloudPlannedActivities(planning.activities);
      if (!onProject) setLoadedPlanningWindow(planningWindow);
      setCloudTeamCapacity(team);
      setError("");
    } catch (issue) {
      setError((issue as Error).message);
      // A failed read shows its error; the calendar does not wait for it.
      if (view === "planning") setLoadedPlanningWindow(planningWindow);
    } finally {
      setLoading(false);
    }
  }, [local, view, projectId, listTab, listParams, planningWindow]);
  useLoadEffect(load);
  // Budgetraden (plan 1L, 2026-10-11): Offererat = the agreed quote versions' Arbete hours, read from the project's
  // quote summary (lib/quotes/flow-server.ts projectQuoteSummary, the same read as Offerter och utfall) in Cloud and the
  // demo for whoever may read quotes; null (shown as "–") elsewhere. Nothing is computed here.
  const [quoted, setQuoted] = useState<{ projectId: string; minutes: number | null } | null>(null);
  const quotesFor = view === "project" && projectId && !local && can("quotes", "read") ? projectId : "";
  useEffect(() => {
    if (!quotesFor) return;
    let alive = true;
    api<{ comparison?: { labour?: { quotedMinutes?: number | null } } | null }>(`/api/quotes?part=project&projectId=${encodeURIComponent(quotesFor)}`, { cache: "no-store" })
      .then((summary) => { if (alive) setQuoted({ projectId: quotesFor, minutes: summary.comparison?.labour?.quotedMinutes ?? null }); })
      .catch(() => { if (alive) setQuoted({ projectId: quotesFor, minutes: null }); });
    return () => { alive = false; };
  }, [quotesFor]);
  const quotedMinutes = quotesFor && quoted?.projectId === quotesFor ? quoted.minutes : null;
  async function loadMoreProjects() {
    if (!listMeta || listMeta.page >= listMeta.pages) return;
    setListBusy(true);
    try {
      const result = await api<ProjectsResponse>(`/api/projects?list=${listTab}&page=${listMeta.page + 1}${listParams}`);
      setCloudProjects((current) => [...current, ...result.projects.filter((project) => !current.some((item) => item.id === project.id))]);
      setListMeta({ total: result.total ?? listMeta.total, page: result.page ?? listMeta.page + 1, pages: result.pages ?? listMeta.pages, counts: result.counts === undefined ? listMeta.counts : result.counts });
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
    api<{ tasks: (WorkflowTask & { fromProject?: string; plannedCount?: number })[] }>(`/api/projects?candidatesFor=${encodeURIComponent(projectId)}`)
      .then((result) => { if (active) setCloudCandidates(result.tasks); })
      .catch((issue) => { if (active) { setCloudCandidates([]); setError((issue as Error).message); } });
    return () => { active = false; };
  }, [local, linking, projectId]);
  const current = projects.find((project) => project.id === projectId);
  useCustomerReference(current?.customerId, !local && view === "project");
  // The project's name in the breadcrumbs (2026-10-09: Översikt › Mina projekt › name).
  usePageTrail({ project: view === "project" ? current?.name : undefined });
  const projectTaskIds = useMemo(() => new Set(projects.flatMap((project) => projectTasks(project).map((task) => task.id))), [projects]);
  const tasks = useMemo(() => [
    ...projects.flatMap((project) => projectTasks(project).map((task) => ({ ...task, projectName: project.name }))),
    ...generalTasks.filter((task) => !projectTaskIds.has(task.id)).map((task) => ({ ...task, projectName: "" })),
  ].filter((task) => task.isMine !== false).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)), [generalTasks, projectTaskIds, projects]);
  // Flytta arbetsorder hit (decision 7; Arbetsordern styr 2026-10-26: only work orders move, their tasks follow): work
  // orders without a project, and work orders in other open projects.
  const linkCandidates = (targetProjectId: string) => (local ? [
    ...generalTasks.filter((task) => !task.projectId),
    ...projects.filter((project) => project.id !== targetProjectId && projectAcceptsWork(project)).flatMap((project) => projectTasks(project).map((task) => ({ ...task, projectId: project.id, fromProject: project.name }))),
  ] as (WorkflowTask & { fromProject?: string; plannedCount?: number })[] : (cloudCandidates ?? []).map((task) => ({ ...task, fromProject: task.projectId ? task.fromProject : undefined }))).filter((task) => task.kind === "WORK_ORDER" && canEditTask(task)).sort((a, b) => Number(Boolean(a.fromProject)) - Number(Boolean(b.fromProject)) || b.updatedAt.localeCompare(a.updatedAt));
  const planningTasksById = useMemo(() => new Map([
    ...projects.flatMap((project) => projectTasks(project)),
    ...generalTasks,
  ].map((task) => [task.id, task])), [generalTasks, projects]);
  const planningContextTasks = [...planningTasksById.values()].filter(canReadTask);
  // Others' bookings (2026-10-09): only an admin, the project's responsible person or its stand-in. The server
  // decides; this only keeps buttons and dragging away from bookings the person could not save.
  const mayChangeBooking = (activity: PlannedActivity) => Boolean(local) || !bookingChangeRefusal({ admin, userId: currentUserId, before: bookedUserIds(activity), after: bookedUserIds(activity),
    project: projects.find((project) => project.id === (activity.projectId ?? (activity.workflowTaskId ? planningTasksById.get(activity.workflowTaskId)?.projectId : null))) ?? null });
  // Booking follows the job (2026-10-10): the same rule as the server (planned-activity-access.ts).
  const bookingProfile = local ? defaultWorkflowPermissionProfile() : permissionProfile;
  const canEditPlannedActivity = (activity: PlannedActivity) => {
    if (activity.deletedAt || !mayChangeBooking(activity)) return false;
    const task = activity.workflowTaskId ? planningTasksById.get(activity.workflowTaskId) : undefined;
    if (activity.workflowTaskId && !task) return false;
    return !plannedActivityWriteRefusal(bookingProfile, Boolean(admin), { projectId: activity.projectId, workflowTask: task ? { kind: task.kind, formArea: task.formArea, projectId: task.projectId ?? null } : null }, false);
  };
  const canBookTask = (task: WorkflowTask) => !plannedActivityWriteRefusal(bookingProfile, Boolean(admin), { projectId: null, workflowTask: { kind: task.kind, formArea: task.formArea, projectId: task.projectId ?? null } }, true);
  // Boka (2026-11-02): whether this person may book others on a job of this project; otherwise the form fills in themself, since the server would refuse anyone else.
  const mayBookOthers = (bookProjectId?: string | null) => Boolean(local) || canChangeOthersBookings({ admin: Boolean(admin), userId: currentUserId, project: projects.find((project) => project.id === bookProjectId) ?? null });

  /** Saves the project; a customer change that needs a choice (409 with `customerChange`) is returned to the form. */
  async function saveProject(input: ProjectFormInput, after?: () => void): Promise<ProjectCustomerChange | void> {
    setBusy(true);
    try {
      const saved = local
        ? { id: await local.save(input) }
        : await api<{ id: string; shifted?: { skippedTasks?: number; skipped?: number } | null }>("/api/projects", { method: "POST", body: JSON.stringify({ action: "save", project: input }) });
      const { id } = saved;
      if (!local) { await load(); onProjectSaved?.(); }
      // Flytta allt leaves what the person may not change, and says so (2026-11-02).
      const shifted = "shifted" in saved ? saved.shifted : null;
      const left = [shifted?.skippedTasks ? `${shifted.skippedTasks} ${shifted.skippedTasks === 1 ? "uppgift" : "uppgifter"}` : "", shifted?.skipped ? `${shifted.skipped} ${shifted.skipped === 1 ? "bokning" : "bokningar"}` : ""].filter(Boolean).join(" och ");
      if (left) announce(`${left} flyttades inte: du saknar rätt att ändra dem.`, true);
      // Uppgifter om projektet on a phone at level 1 goes back to the project's menu instead.
      if (after) after(); else router.push(`/?view=project&projectId=${encodeURIComponent(id)}`);
    } catch (issue) {
      const change = (issue as { details?: { customerChange?: ProjectCustomerChange } }).details?.customerChange;
      if (change) { setError(""); return change; }
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
            taskKind: task.kind,
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

  async function setArchived(projectId: string, archived: boolean, openTasks = 0) {
    // Archiving freezes the project's work: unfinished tasks are named first (simulation 2026-10-02).
    if (archived && openTasks > 0 && !(await confirmCard({ title: "Arkivera projektet?", message: `${openTasks} ${openTasks === 1 ? "uppgift är" : "uppgifter är"} inte färdigställda. Arkiverat blir projektet skrivskyddat tills du återställer det.`, confirmLabel: "Arkivera ändå", tone: "danger" }))) return;
    setBusy(true); setError("");
    try {
      if (local) await local.archive(projectId, archived);
      else { await api("/api/projects", { method: "POST", body: JSON.stringify({ action: archived ? "archive" : "restore", id: projectId, ...(archived ? { confirmOpen: true } : {}) }) }); await load(); }
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

  async function savePlannedActivity(input: PlannedActivityInput): Promise<{ id: string; version: number; warning?: string }> {
    setBusy(true); setError("");
    try {
      const result = local
        ? await local.savePlannedActivity(input)
        : await api<{ id: string; version: number; warning?: string }>("/api/planned-activities", { method: "POST", body: JSON.stringify({ action: "save", activity: input }) });
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

  async function exportProjectReport(project: WorkflowProject, options: WorkflowReportOptions, selected: ProjectReportChoice[], keep = false) {
    if (local?.report) return local.report(project, options, selected);
    const sections = Object.entries(options).filter(([, included]) => included).map(([key]) => key).join(",");
    const taskIds = selected.map((choice) => choice.id).join(",");
    const address = `/api/projects/${encodeURIComponent(project.id)}/report?taskIds=${encodeURIComponent(taskIds)}&sections=${encodeURIComponent(sections)}`;
    if (keep) {
      // "Spara i rapportarkivet" (2026-10-07): fetched, so the answer can say whether the copy was kept.
      const response = await fetch(`${address}&archive=1`);
      if (!response.ok) throw new Error(((await response.json().catch(() => null)) as { error?: string } | null)?.error || "Rapporten kunde inte skapas.");
      await downloadResponse(response, `${project.name.replace(/[<>:"/\\|?*\u0000-\u001f]+/g, "-")}-projektrapport.pdf`);
      announceArchiveResult(response.headers, () => router.push("/?view=report_archive"));
      return;
    }
    const link = document.createElement("a");
    link.href = address;
    link.download = "";
    link.click();
  }

  // Level 1 keeps the page's shape while it loads (2026-10-15): grey rows instead of a line the content then pushes away.
  if (loading) return nativeLook ? <ListSkeleton rows={6} label="Läser projekt och uppgifter…" testId="native-projects-loading" />
    : <Panel title="Hämtar projekt"><p role="status" className="text-sm text-muted-foreground">Läser projekt och uppgifter…</p></Panel>;
  if (error && !projects.length && view !== "new_project") return <Panel title="Projekt kunde inte hämtas"><p role="alert" className="text-sm text-destructive">{error}</p></Panel>;
  if (view === "new_project" && !can("projects", "create")) return <Panel title="Behörighet saknas"><p className="text-sm text-muted-foreground">Du saknar behörighet att skapa projekt. Kontakta en företagsadministratör.</p></Panel>;
  const remoteList = local ? undefined : { tab: listTab, meta: listMeta, busy: listBusy, onTab: (tab: ProjectTab) => { if (tab !== listTab) { setListBusy(true); setListTab(tab); } }, onMore: () => void loadMoreProjects() };
  const listControls: ProjectListControls = {
    personId, scopes: projectScopes, scope: projectPrefs.scope, sort: projectPrefs.sort, view: projectPrefs.view, query: listQuery,
    onScope: (scope) => { if (!local && scope !== projectPrefs.scope) setListBusy(true); projectPrefs.update({ scope }); },
    onSort: (sort) => { if (!local && sort !== projectPrefs.sort) setListBusy(true); projectPrefs.update({ sort }); },
    onView: (value) => projectPrefs.update({ view: value }),
    onQuery: setListQuery,
    tab: listTab, onTab: setListTab,
    status: listStatus, onStatus: (status) => { if (!local && status !== listStatus) setListBusy(true); setListStatus(status); },
  };
  // The project list, also drawn behind the Nytt projekt popup (display 3, plan 1Q).
  const projectsPage = <ProjectsPage projects={projects} error={error} canCreate={can("projects", "create")} remote={remoteList} controls={listControls} pages={projectPages} />;
  if (view === "new_project") return <NativeNewProject busy={busy} form={(close) => <ProjectForm initialCustomerId={newProjectCustomerId} customers={customers} quick={customerQuick} search={!local} members={members} busy={busy} error={error} savePlace={local ? local.savePlace : can("customers", "create") ? cloudSavePlace : undefined} onCancel={close} onSave={saveProject} />}>
    {/* Nytt projekt is a page like Ny kund and Ny arbetsorder (plan 1O); level 1 draws NativeNewProject's own screen above. */}
    <FormPage title="Nytt projekt" size="form" back="/?view=projects" behind={projectsPage} testId="new-project-page"
      description="Skapa projektets grunduppgifter.">
      {(form) => <ProjectForm initialCustomerId={newProjectCustomerId} customers={customers} quick={customerQuick} search={!local} members={members} busy={busy} error={error} savePlace={local ? local.savePlace : can("customers", "create") ? cloudSavePlace : undefined} onCancel={form.cancel} onSave={saveProject} />}
    </FormPage>
  </NativeNewProject>;
  if (view === "planning") return <PlanningOverview initialProjectId={projectId} canReadProjects={canReadProjects} canReadRounds={moduleIsOn("rounds") && (Boolean(local) || mayReadRounds(Boolean(admin), permissionProfile))} loadRounds={local ? local.rounds : cloudPlanningRounds} loadMaintenance={local || !moduleIsOn("upkeep") ? undefined : cloudPlanningMaintenance} canCreateWorkOrder={can("work-order", "create")} capacityRead={capacityRead} localCapacity={local ? capacityRead : undefined} loadToBook={local?.toBook ? async () => local.toBook!() : cloudToBook} mayBookOthers={mayBookOthers} summary={local ? null : planningSummary} onWindow={local ? undefined : widenPlanningWindow} activitiesWindow={local ? undefined : loadedPlanningWindow} activities={plannedActivities} projects={projects} contextTasks={planningContextTasks} members={members} capacity={capacity} teamCapacity={teamCapacity} busy={busy} error={error} canCreate={Boolean(local) || canBookAnything(permissionProfile, Boolean(admin))} canPlanProjects={can("projects", "create") && moduleIsOn("projects")} canBookTask={canBookTask} canEdit={canEditPlannedActivity} canReadTask={canReadTask} canFrameException={canFrameException} onSave={savePlannedActivity} onRemove={removePlannedActivity} />;
  if (view === "tasks") {
    const customerName = (id?: string | null) => { const customer = id ? customers.find((item) => item.id === id) : undefined; return customer ? customerTitle(customer) : ""; };
    return <TasksPage personId={personId} permissions={permissionProfile} admin={admin}
      local={local ? { tasks: tasks.map((task) => ({ ...task, customerName: task.customerName || customerName(task.customerId), responsibleName: task.assignedToName, dueDate: task.dueDate })) } : undefined} />;
  }
  if (view === "project") {
    // The page keeps its heading (an h1) when the project is missing (the objective analysis 2026-10-24).
    if (!current) return <div className="space-y-6"><PageHeader title="Projekt" /><Empty title="Projektet hittades inte" description="Det kan ha tagits bort eller tillhöra en annan arbetsyta."></Empty></div>;
    const currentTasks = projectTasks(current);
    const groups = {
      planned: currentTasks.filter((task) => taskState(task) === "planned"),
      active: currentTasks.filter((task) => taskState(task) === "active"),
      done: currentTasks.filter((task) => taskState(task) === "done"),
      cancelled: currentTasks.filter((task) => taskState(task) === "cancelled"),
    };
    // The jobs that count for the project's flow and what remains: Utgått ones are left out (2026-10-09).
    const countedTasks = currentTasks.length - groups.cancelled.length;
    const progress = projectProgress(current);
    const status = projectStatusOf(current);
    const archived = status.state === "ARCHIVED";
    const closed = status.state === "CLOSED";
    const locked = archived || closed;
    const canManage = Boolean(local) || canManageProjectLifecycle({ admin, userId: currentUserId, responsibleUserId: current.responsibleUserId, canEditProjects: can("projects", "edit") });
    // Arkivera (beslut 9, 2026-11-01): admin, the responsible member, or the right given to more; the server decides again.
    const canArchive = canArchiveProject({ admin, userId: currentUserId, responsibleUserId: current.responsibleUserId, canEditProjects: can("projects", "edit"), canArchiveProjects: can("projects", "archive") });
    const frameIssues = projectFrameIssues(current, currentTasks);
    const readyToClose = status.state === "READY_TO_CLOSE";
    // READY_TO_CLOSE ignores bookings on finished jobs (2026-10-09), so a left-over booking is named instead of denied.
    const remainingBookings = readyToClose ? plannedActivities.filter((activity) => activity.projectId === current.id && isActivePlanning(activity, new Date())).length : 0;
    const today = swedishDayKey(new Date());
    const futureStart = current.startDate && current.startDate > today ? current.startDate : undefined;
    const duePassed = Boolean(current.dueDate && current.dueDate < today);
    const frameMissing = !current.startDate && !current.dueDate ? "start- och slutdatum" : !current.startDate ? "startdatum" : !current.dueDate ? "slutdatum" : null;
    const taskPlannedMinutes = plannedMinutesByTask(plannedActivities);
    // Nytt jobb (Fas 4A, 2026-10-08): one button instead of Skapa ny uppgift + Koppla befintlig uppgift.
    const jobChoices = closed ? [] : projectJobChoices(current, { workOrder: can("work-order", "create"), task: (["kfid", "risk-assessment", "forms"] as const).some((subject) => can(subject, "create")), link: can("projects", "edit") });
    const reportChoices: ProjectReportChoice[] = currentTasks.map((task) => ({ id: task.id, kind: task.kind, title: task.title, status: task.status }));
    const projectFormFor = (onCancel: () => void, after?: () => void) => <ProjectForm project={current} customers={customers} quick={customerQuick} search={!local} savePlace={local ? local.savePlace : can("customers", "create") ? cloudSavePlace : undefined} members={members} busy={busy} error={error} canEditFrame={canManage} tasks={currentTasks} activities={plannedActivities.filter((activity) => activity.projectId === current.id || currentTasks.some((task) => task.id === activity.workflowTaskId))} onCancel={onCancel} onSave={(input) => saveProject(input, after)} />;
    // Ett projekt på nivå 1 (2026-10-09): a menu of rows; each panel below is its own screen (`NativeScreen`).
    const nativeProject: NativeProjectProps = {
      name: current.name, place: [customerTitle(current.customer) || current.client, current.workSite].filter(Boolean).join(" · "),
      progress, statusLabel: status.label, statusTone: projectStatusTone(status), frame: hasProjectFrame(current) ? formatFrame(current) : current.dueDate ? `Klart senast ${current.dueDate}` : "",
      jobs: currentTasks.map((task) => ({ id: task.id, kind: task.kind, title: task.title, status: task.status, dueDate: task.dueDate, progress: taskProgress(task), step: task.step ?? null, assignedToName: task.assignedToName, totalDurationSec: task.totalDurationSec })),
      timeBudgetMinutes: current.timeBudgetMinutes, outsideFrameMinutes: current.outsideFrameMinutes,
      plannedCount: plannedActivities.filter((activity) => activity.projectId === current.id && !activity.deletedAt).length, materialRows: current.materials?.total ?? 0,
      about: projectAboutRows(current),
      rows: { kommentarer: !local, tidplan: !local && currentTasks.length > 0 && moduleIsOn("planning"), material: Boolean(current.materials && can("work-order", "read") && currentTasks.some((task) => task.kind === "WORK_ORDER")), offerter: !local && can("quotes", "read") && moduleIsOn("quotes"), personalliggare: !local && keepsWorkflowRegister(current), hantering: true },
      newJob: !archived && jobChoices.length > 0 ? <NewChoiceMenu label="Lägg till i projektet" choices={jobChoices} testId="native-project-new-job" onChoose={(choice) => { if (choice.key === "link") setLinking(true); }} trigger={<Button type="button" variant="ghost"><Plus />Nytt jobb</Button>} /> : null,
      form: can("projects", "edit") && !archived ? (close) => projectFormFor(close, close) : null,
      invoiceRow: !local && can("quotes", "read") && moduleIsOn("invoicing") ? <InvoiceBasisNativeRow key={`invoice-${current.id}`} projectId={current.id} /> : null,
      busy,
    };
    // .native-screen: at level 1 on a phone the panels of a screen read as grouped lists (app/globals.css); elsewhere nothing.
    const page = <div className="native-screen space-y-6">
      {confirmElement}
      <NativeProjectHead {...nativeProject} />
      {/* Avsluta projekt is always visible to whoever may close (2026-10-08): disabled with its reason until the
          project is ready, then the button in the "Klar att avsluta" banner takes over. The server rule is unchanged. */}
      <NativeScreen show={["hantering"]}><PageHeader nativeActions title={current.name} description={current.description || "Gemensam arbetsyta för projektets uppgifter."} actions={<>{!local && !nativeLook && <Button asChild variant="outline"><Link href={`/?view=project_planning&projectId=${encodeURIComponent(current.id)}`} data-testid="project-planning-link"><GanttChart />Planering</Link></Button>}{can("projects", "report") && currentTasks.length > 0 && (!local || local.report) && <ReportOptionsButton choices={reportChoices} archivable={!local} prices={Boolean(local) || canSeePrices({ admin, permissions: permissionProfile })} onExport={(options, selected, _variant, _show, archive) => exportProjectReport(current, options, selected, archive)} />}{archived ? canArchive && <Button variant="outline" disabled={busy} onClick={() => void setArchived(current.id, false)}><RotateCcw />Återställ projekt</Button> : <>{can("projects", "edit") && <Button variant="outline" onClick={() => setEditing(true)}><Pencil />Redigera</Button>}{canArchive && <Button variant="outline" disabled={busy} onClick={() => void setArchived(current.id, true, countedTasks - groups.done.length)}><Archive />Arkivera</Button>}{/* The reason stands under its own button, not between Arkivera and Avsluta where it read as Arkivera's label (plan 1A, 2026-10-11); on a wider screen it hangs below the row so the button stands level with the others (2026-10-24). */}{!closed && !readyToClose && canManage && <span data-testid="project-close-blocked" className="relative inline-flex flex-col items-start gap-1 sm:items-end"><Button variant="outline" disabled aria-describedby="project-close-reason"><CheckCircle2 />Avsluta projekt</Button><span id="project-close-reason" className="text-xs text-muted-foreground sm:absolute sm:right-0 sm:top-full sm:mt-1 sm:whitespace-nowrap">{status.closeBlocker || "Inte klart att avsluta"}</span></span>}{closed ? canManage && <Button disabled={busy} onClick={() => void setClosed(current.id, false)}><RotateCcw />Återöppna projekt</Button> : jobChoices.length > 0 && !nativeLook && <NewChoiceMenu label="Lägg till i projektet" choices={jobChoices} testId="project-new-job-choices" onChoose={(choice) => { if (choice.key === "link") setLinking(true); }} trigger={<Button><Plus />Nytt jobb</Button>} />}</>}</>} /></NativeScreen>
      {/* The project's flow (2026-10-01): the same progress line as the tasks, between the heading and the panels. */}
      <NativeScreen show={[]}><FlowGuide flow={projectFlow({ closed, archived, taskCount: countedTasks, startedCount: groups.active.length, completedCount: groups.done.length, startsOn: futureStart})} page={`project-${current.id}`} label="Projektets flöde" pageLabel="Projekt"
        advisor={{ kind: "PROJECT", saved: true, completed: locked, today, dueDate: current.dueDate || undefined, project: { taskCount: countedTasks, openCount: countedTasks - groups.done.length, closed: locked, readyToCloseShown: readyToClose, startsOn: futureStart, editHref: `${projectHref}&edit=1` } }} /></NativeScreen>
      <NativeScreen show={["menu"]}>{archived && <div className="notice">Projektet är arkiverat och skrivskyddat. Återställ det för att ändra eller lägga till arbete.</div>}
      {closed && <div data-testid="project-closed-notice" className="notice">Projektet är avslutat. Nya uppgifter och ny planering är spärrade. {canManage ? "Återöppna projektet om arbetet ska fortsätta." : "Projektansvarig eller en administratör kan återöppna det."}</div>}
      {readyToClose && <div data-testid="project-ready-to-close" className={cn("flex flex-wrap items-center justify-between gap-3 rounded-xl border p-4 text-sm", indicatorBadge("success"))}><span><strong>Klar att avsluta.</strong> Alla uppgifter är färdigställda{remainingBookings ? `, ${remainingBookings === 1 ? "en bokning" : `${remainingBookings} bokningar`} återstår men hindrar inte.` : "."}{duePassed ? ` Slutdatumet ${current.dueDate} har passerat.` : ""} {canManage ? "Avsluta projektet när arbetet är klart, eller återuppta arbetet." : "Projektansvarig eller en administratör kan avsluta det."}</span><div className="flex flex-wrap gap-2"><Button size="sm" variant="outline" onClick={() => setReopening(true)}><RotateCcw />Återuppta arbete</Button>{canManage && <Button id="project-close" size="sm" disabled={busy} onClick={() => void setClosed(current.id, true)}><CheckCircle2 />Avsluta projekt</Button>}</div></div>}
      {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
      {/* Hidden once the project is ready to close; otherwise it names exactly what is missing (2026-10-02). */}
      {!locked && !readyToClose && frameMissing && <div data-testid="project-frame-missing" className={cn("flex flex-wrap items-center justify-between gap-3 rounded-xl border p-4 text-sm", indicatorBadge("warning"))}><span><strong>Projektet saknar {frameMissing}.</strong> Ange {frameMissing === "start- och slutdatum" ? "dem" : "det"} så att uppgifter och planering kan följa projektets ram.</span>{canManage && can("projects", "edit") ? <Button size="sm" variant="outline" onClick={() => setEditing(true)}><CalendarDays />Ange tidsram</Button> : null}</div>}
      {frameIssues.length > 0 && <section data-testid="project-frame-issues" aria-label="Avvikelser mot projektets ramar" className={cn("rounded-xl border p-4 text-sm", indicatorBadge("warning"))}><p className="flex items-center gap-2 font-semibold"><AlertTriangle className="size-4" />Avvikelser mot projektets ramar</p><ul className="mt-2 space-y-1">{frameIssues.map((issue) => <li key={`${issue.taskId}-${issue.kind}`}><span className="font-medium">{issue.title}:</span> {issue.message}</li>)}</ul><p className="mt-2 text-xs opacity-80">Ändra uppgiften så att den följer projektet. Inget ändras automatiskt.</p></section>}</NativeScreen>
      <NativeProjectRows {...nativeProject} />
      {/* Personalliggare, steg 1 (2026-10-09): the big Checka in / Checka ut button high up on the project page. */}
      <NativeScreen show={["personalliggare"]} lead>{!local && keepsWorkflowRegister(current) ? <StaffRegisterPanel key={`register-${current.id}`} projectId={current.id} locked={archived} moduleOff={!moduleIsOn("staff_register")} /> : null}</NativeScreen>
      <NativeScreen show={[]}>{projectAboutRows(current).length > 0 && <Panel icon={Info} title="Om projektet" description="Gäller alla uppgifter i projektet och skrivs ut i rapporterna."><dl data-testid="project-fields" className="grid gap-3 text-sm sm:grid-cols-2 xl:grid-cols-4">{projectAboutRows(current).map(([label, value]) => <div key={label} className={label === "Arbetsbeskrivning" ? "sm:col-span-2 xl:col-span-4" : undefined}><dt className="text-xs text-muted-foreground">{label}</dt><dd className="mt-0.5 whitespace-pre-wrap break-words">{value}</dd></div>)}</dl></Panel>}</NativeScreen>
      {/* Projektprogression and the hand-over of the booking deputy are the desktop's measuring boxes (M2, 2026-10-12): the phone's Planering screen shows the bookings and the budget as rows. */}
      <NativeScreen show={[]}><Panel icon={TrendingUp} title="Projektprogression" description="Beräknas från uppgifternas verkliga status och innehåll – inga obligatoriska steg.">
        <div className="flex flex-wrap items-end justify-between gap-4"><div><p className="text-3xl font-semibold tracking-tight">{progress}%</p><p className="mt-1 text-sm text-muted-foreground">{status.label} · {currentTasks.length} {currentTasks.length === 1 ? "uppgift" : "uppgifter"}{groups.cancelled.length ? <span data-testid="project-cancelled-count"> · {groups.cancelled.length} {TASK_CANCELLED_LABEL.toLowerCase()}</span> : null}</p></div><div className="space-y-2 text-sm text-muted-foreground">{current.responsibleName && <p className="flex items-center gap-2"><UserRound className="size-4" />Ansvarig: {current.responsibleName}</p>}{!local ? <PlanningDelegateRow project={current} members={members} canHandOver={!archived && canManage} onChanged={() => void load()} /> : null}{hasProjectFrame(current) ? <p data-testid="project-frame" className="flex items-center gap-2"><CalendarDays className="size-4" />Tidsram {formatFrame(current)}</p> : current.dueDate ? <p className="flex items-center gap-2"><CalendarDays className="size-4" />Klart senast {current.dueDate}</p> : null}</div></div>
        <div className="mt-4 h-2 overflow-hidden rounded-full bg-muted" role="img" aria-label={`${progress} procent klart`}><div className={`h-full rounded-full transition-all ${indicatorBar(progressTone({ percent: progress }))}`} style={{ width: `${progress}%` }} /></div>
        <FrameAdherenceRow adherence={summarizeFrameAdherence({ startDate: current.startDate, dueDate: current.dueDate, completion: progress })} />
        <div className="mt-4 grid grid-cols-3 gap-2 text-center text-xs"><div className={cn("rounded-lg border p-2.5", indicatorBadge("neutral"))}><strong className="block text-lg text-foreground">{groups.planned.length}</strong>Planerade</div><div className={cn("rounded-lg border p-2.5", indicatorBadge("warning"))}><strong className="block text-lg">{groups.active.length}</strong>Pågående</div><div className={cn("rounded-lg border p-2.5", indicatorBadge("success"))}><strong className="block text-lg">{groups.done.length}</strong>Färdigställda</div></div>
        <ProjectEffortRow tasks={currentTasks} plannedMinutes={taskPlannedMinutes} budgetMinutes={current.timeBudgetMinutes} quotedMinutes={quotedMinutes} />
      </Panel></NativeScreen>
      <NativeScreen show={["planering"]} lead><PlanningPanel
        project={current}
        tasks={currentTasks}
        activities={plannedActivities.filter((activity) => activity.projectId === current.id && !activity.deletedAt)}
        members={members}
        busy={busy}
        error={error}
        canFrameException={canFrameException}
        canCreate={can("projects", "create") && !locked}
        canEdit={(activity) => !locked && can("projects", "edit") && (!activity.workflowTaskId || (() => { const task = currentTasks.find((candidate) => candidate.id === activity.workflowTaskId); return Boolean(task && canEditTask(task)); })()) && mayChangeBooking(activity)}
        onSave={savePlannedActivity}
        onRemove={removePlannedActivity}
        aiAction={PlanningProposal && !local && can("projects", "create") && !locked ? <PlanningProposal projectId={current.id} disabled={busy} onApplied={() => void load()} /> : undefined}
      /></NativeScreen>
      <NativeScreen show={["menu", "jobb"]}>{!currentTasks.length && !archived && !closed && canCreateTask ? <ProjectStarter projectId={current.id} customerId={current.customerId}
        canCreate={{ workOrder: can("work-order", "create"), risk: can("risk-assessment", "create"), control: can("kfid", "create") }} /> : null}</NativeScreen>
      {/* Samlad bild (2026-10-08, Fas 4B): the project's jobs – each work order with its tasks under it, then the
          standalone tasks – with the step each job is on, in aligned columns; replaces the status board. */}
      {/* Tidplan (Gantt v1, 2026-10-09): its own component and read (features/workflow/project-schedule.tsx). */}
      <NativeScreen show={["tidplan"]} lead>{!local && currentTasks.length && moduleIsOn("planning") ? <ProjectSchedule key={`schedule-${current.id}`} projectId={current.id} onChanged={() => void load()} /> : null}</NativeScreen>
      <div id="project-tasks" />
      <NativeScreen show={[]}><ProjectJobs tasks={currentTasks} plannedMinutes={taskPlannedMinutes} /></NativeScreen>
      {/* Projekttid (2026-10-26, svar 5a): time on the project without a work order, with timer and written time. */}
      <NativeScreen show={[]}>{can("projects", "read") && moduleIsOn("time") ? <ProjectTimePanel project={current} workOrderSeconds={currentTasks.reduce((sum, task) => sum + (task.totalDurationSec ?? 0), 0)} locked={archived || closed}
        local={local?.projectTimer ? { timer: local.projectTimer } : undefined} onChanged={() => void load()} /> : null}</NativeScreen>
      <NativeScreen show={["material"]} lead>{current.materials && can("work-order", "read") && currentTasks.some((task) => task.kind === "WORK_ORDER") ? <ProjectMaterials key={`materials-${current.id}`} project={current} summary={current.materials} /> : null}</NativeScreen>
      <NativeScreen show={["offerter"]} lead>{!local && can("quotes", "read") && moduleIsOn("quotes") ? <ProjectQuotes key={`quotes-${current.id}`} projectId={current.id} /> : null}</NativeScreen>
      {/* Fakturaunderlag (2026-10-10): at level 1 a row in the menu (invoiceRow above). */}
      <NativeScreen show={[]}>{!local && can("quotes", "read") && moduleIsOn("invoicing") ? <InvoiceBasisPanel key={`invoice-${current.id}`} projectId={current.id} /> : null}</NativeScreen>
      {/* Kommentarer (beslut 14, 2026-11-01): the project's thread, in Cloud. Local has one user. */}
      <NativeScreen show={["kommentarer"]} lead>{!local ? <CommentThread key={`comments-${current.id}`} parentType="PROJECT" parentId={current.id} disabled={archived} /> : null}</NativeScreen>

      <NativeScreen show={["hantering"]}><ProjectAssignment key={`self-inspection-${current.id}`} projectId={current.id} canEdit={!archived && can("projects", "edit")} /></NativeScreen>
      <NativeScreen show={["beslut"]} lead><ProjectDecisionLog key={`decisions-${current.id}`} project={current} local={Boolean(local)} canAdd={!archived && can("projects", "edit")} onAdd={(decision) => addDecision(current.id, decision)} /></NativeScreen>
      <NativeScreen show={["historik"]} lead><ProjectHistory key={current.id} project={current} local={Boolean(local)} /></NativeScreen>
      <Modal open={reopening} onOpenChange={setReopening} title="Återuppta arbete" className="max-w-lg">
        <p className="page-description mb-5">Välj hur arbetet ska fortsätta.</p>
        <div className="space-y-2">{groups.done.map((task) => <article key={task.id} className="flex items-center gap-3 rounded-xl border p-4"><div className="min-w-0 flex-1"><p className="font-medium">{task.title}</p><p className="text-xs text-muted-foreground">{taskTypeLabel(task)}</p></div>{task.kind ? canReopenTask(task) && <Button size="sm" variant="outline" disabled={busy} onClick={() => void reopenTask(task.id)}><RotateCcw />Återöppna</Button> : canEditTask(task) && <Button asChild size="sm" variant="outline"><Link href={taskHref(task)}>Öppna och välj Spara som</Link></Button>}</article>)}</div>
        {canCreateTask && <div className="mt-5 flex justify-end"><Button asChild><Link href={subPage(`/?view=new_task&projectId=${encodeURIComponent(current.id)}`)}><Plus />Skapa ny uppgift</Link></Button></div>}
      </Modal>
    </div>;
    // Forms as pages (plan 1O): Redigera projekt and Koppla befintlig uppgift replace the project page on levels 2–3;
    // level 1 keeps them as screens over it (FormPage draws `page` behind its Modal there).
    const planNew = searchParams.get("new") === "1";
    const planEditId = searchParams.get("edit") === "1" ? searchParams.get("activityId") : null;
    const planEditing = planEditId ? plannedActivities.find((activity) => activity.id === planEditId && !activity.deletedAt) : undefined;
    if (planNew || planEditId) return <FormPage title={planNew ? "Ny planering" : "Redigera planering"} back={projectHref} behind={page} testId="project-planning-form-page">
      {(form) => !planNew && !planEditing ? <p role="status" className="text-sm text-muted-foreground">Hämtar planeringen…</p>
        : <PlannedActivityForm project={current} tasks={currentTasks} members={members} capacityRead={capacityRead} currentUserId={viewerId} mayBookOthers={mayBookOthers} canFrameException={canFrameException}
          activity={planNew ? undefined : planEditing} busy={busy} error={error} onCancel={form.cancel} onSave={async (input) => { const result = await savePlannedActivity(input); if (result.warning) announce(`Planering sparad. ${result.warning}`); form.done(projectHref); }} />}
    </FormPage>;
    if (editing) return <FormPage title="Redigera projekt" size="form" back={projectHref} behind={page} testId="project-edit-page">
      {(form) => projectFormFor(form.cancel, () => form.done(projectHref))}
    </FormPage>;
    if (linking) return <FormPage title="Flytta arbetsorder hit" back={projectHref} behind={page} testId="project-link-page">
        {linkTarget ? <LinkGuide task={linkTarget} project={current} customers={customers} members={members} plannedCount={linkTarget.plannedCount ?? plannedActivities.filter((activity) => !activity.deletedAt && activity.workflowTaskId === linkTarget.id).length} busy={busy} error={error} onBack={() => setLinkTarget(null)} onConfirm={(apply) => void linkTask(linkTarget, current.id, apply)} /> : <>
          <p className="page-description mb-5">Välj en arbetsorder utan projekt eller flytta en från ett annat projekt. Uppgifterna i den följer med.</p>
          {error && <p role="alert" className="mb-4 text-sm text-destructive">{error}</p>}
          {!local && cloudCandidates === null ? <p role="status" className="text-sm text-muted-foreground">Hämtar arbetsordrar…</p> : linkCandidates(current.id).length ? <div className="max-h-[55vh] space-y-2 overflow-y-auto pr-1">{linkCandidates(current.id).map((task) => <article key={`${task.kind}-${task.id}`} className="flex items-center gap-3 rounded-xl border bg-card p-4"><span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary"><Link2 className="size-4" /></span><div className="min-w-0 flex-1"><p className="truncate text-sm font-semibold">{task.title}</p><p className="mt-1 text-xs text-muted-foreground">{taskTypeLabel(task)} · {task.fromProject ? `I projektet ${task.fromProject}` : task.status === "COMPLETED" ? "Färdigställd" : isTaskCancelled(task.status) ? TASK_CANCELLED_LABEL : "Utan projekt"}</p></div><Button size="sm" variant={task.fromProject ? "outline" : "default"} disabled={busy} onClick={() => setLinkTarget(task)}>{task.fromProject ? "Flytta hit" : "Lägg i projektet"}</Button></article>)}</div> : <Empty title="Inga arbetsordrar att flytta" description="Det finns ingen arbetsorder att flytta hit. Skapa en ny arbetsorder i stället." />}
        </>}
    </FormPage>;
    return page;
  }
  return projectsPage;
}

// Paged project history (2026-09-26): Cloud sends the newest ten events and a count; Local pages the open file.
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
  // History lists start folded (2026-10-22).
  return <Panel icon={History} foldKey="project-history" title="Projekthistorik" description={total ? `${total} ${total === 1 ? "händelse" : "händelser"}, senaste först.` : "Viktiga förändringar i projektets livscykel."} collapsible defaultCollapsed>
    {shown.length ? <ol className="divide-y">{shown.map((event) => <li key={event.id} className="flex items-center gap-3 py-2 first:pt-0 last:pb-0"><span className="flex size-7 shrink-0 items-center justify-center rounded-full bg-secondary text-primary"><History className="size-3.5" /></span><div className="flex min-w-0 flex-1 flex-wrap items-baseline justify-between gap-x-3"><p className="text-sm font-medium">{event.summary}</p><p className="text-xs text-muted-foreground">{formatDateTime(event.createdAt)}{event.actorName ? ` · ${event.actorName}` : ""}</p></div></li>)}</ol> : <p className="text-sm text-muted-foreground">Ingen historik har registrerats ännu.</p>}
    <ShowMore shown={shown.length} total={total} busy={busy} onMore={() => void loadMore()} />
  </Panel>;
}

type ProjectDecision = NonNullable<WorkflowProject["decisions"]>[number];
type ProjectDecisionInput = Pick<ProjectDecision, "decidedOn" | "text" | "decidedBy">;

// The project's decision log (2026-09-26): append-only, newest first, paged like the history.
function ProjectDecisionLog({ project, local, canAdd, onAdd }: { project: WorkflowProject; local: boolean; canAdd: boolean; onAdd: (decision: ProjectDecisionInput) => Promise<void> }) {
  const [older, setOlder] = useState<ProjectDecision[]>([]);
  const [limit, setLimit] = useState(10);
  const [busy, setBusy] = useState(false);
  const native = useNativeMode();
  const [adding, setAdding] = useState(false);
  const [added, setAdded] = useState(false);
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
  const open = () => { setForm({ decidedOn: swedishDayKey(new Date()), text: "", decidedBy: "" }); setFormError(""); setAdded(false); setAdding(true); };
  const save = async () => {
    setBusy(true); setFormError("");
    try { await onAdd({ decidedOn: form.decidedOn, text: form.text.trim(), decidedBy: form.decidedBy.trim() }); setAdding(false); setAdded(true); }
    catch (issue) { setFormError((issue as Error).message); }
    finally { setBusy(false); }
  };
  // Folded with its count (the fold rule, 2026-11-02), except on the phone's own Beslut screen, which is nothing else. A new decision opens it.
  return <><Panel icon={ScrollText} title="Beslutslogg" description={total ? `${total} beslut, senaste först.` : "Dokumentera beslut som påverkar projektet, t.ex. ändrad omfattning eller tidplan."}
    collapsible={!native} defaultCollapsed count={total} foldKey="project-decisions" openWhen={added}
    actions={canAdd ? <Button variant="outline" onClick={open}><Plus />Nytt beslut</Button> : undefined}>
    {shown.length ? <ol data-testid="project-decisions" className="divide-y">{shown.map((decision) => <li key={decision.id} className="flex gap-3 py-2.5 first:pt-0 last:pb-0"><span className="flex size-7 shrink-0 items-center justify-center rounded-full bg-secondary text-primary"><CheckCircle2 className="size-3.5" /></span><div className="min-w-0 flex-1"><p className="whitespace-pre-wrap text-sm">{decision.text}</p><p className="mt-0.5 text-xs text-muted-foreground">{decision.decidedOn} · Beslutat av {decision.decidedBy}{decision.actorName ? ` · Registrerat av ${decision.actorName}` : ""}</p></div></li>)}</ol> : <p className="text-sm text-muted-foreground">Inga beslut har registrerats ännu.</p>}
    <ShowMore shown={shown.length} total={total} busy={busy} onMore={() => void loadMore()} />
    </Panel>
    <Modal open={adding} onOpenChange={setAdding} title="Nytt beslut" className="max-w-lg">
      <form className="space-y-4" onSubmit={(event) => { event.preventDefault(); void save(); }}>
        <p className="page-description">Beslutet läggs till i projektets logg och kan inte ändras efteråt.</p>
        <div className="grid gap-4 sm:grid-cols-2">
          <label className="block space-y-2 text-xs font-medium text-muted-foreground">Datum<Input type="date" value={form.decidedOn} onChange={(event) => setForm({ ...form, decidedOn: event.target.value })} required /></label>
          <label className="block space-y-2 text-xs font-medium text-muted-foreground">Beslutat av<Input value={form.decidedBy} onChange={(event) => setForm({ ...form, decidedBy: event.target.value })} maxLength={160} required placeholder="Namn eller funktion" /></label>
        </div>
        <label className="block space-y-2 text-xs font-medium text-muted-foreground">Beslut<textarea className="form-textarea" value={form.text} onChange={(event) => setForm({ ...form, text: event.target.value })} maxLength={2000} required /></label>
        {formError && <p role="alert" className="text-sm text-destructive">{formError}</p>}
        <DialogActions cancel={{ onClick: () => setAdding(false) }} primary={{ label: "Spara beslut", type: "submit", busy, testId: "decision-save" }} />
      </form>
    </Modal>
  </>;
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
  return kind === "MEETING" ? "Möte" : kind === "DEADLINE" ? "Milstolpe" : kind === "OTHER" ? "Övrigt" : "Arbete";
}

function planningStatusLabel(status: PlannedActivity["status"]) {
  // Bokningar säger Genomförd; jobb och projekt behåller Färdigställd/Avslutat (projektförslaget 2026-10-09). A cancelled
  // booking says Utgår, the same word as a job that will not be done (plan 1C, 2026-10-11; was Inställd). The
  // stored status value CANCELED is unchanged.
  return status === "COMPLETED" ? "Genomförd" : status === "CANCELED" ? TASK_CANCEL_LABEL : status === "IN_PROGRESS" ? "Pågår" : "Planerad";
}

type PlanningCalendarColorBy = "status" | "project" | "assignee";

const planningCalendarPaletteTone = personSurfaceTone;

// Project responsible first, then assignees of linked tasks (lib/workflow/project-people.ts, shared with Översikt).
const projectPeopleOf = (project: WorkflowProject) => projectPeople(project, projectTasks(project));

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

/** Minutes into a Swedish day an instant starts at, for the order of a calendar day's rows; 0 when it began on an earlier day. */
const dayMinute = (startsAt: string, dayKey: string) => { const parts = swedishParts(startsAt); return swedishDayKey(startsAt) < dayKey ? 0 : parts.hour * 60 + parts.minute; };
const planningRoundTone = (state: PlanningRound["state"]): IndicatorTone => state === "done" ? "success" : state === "missed" ? "danger" : state === "started" || state === "due" ? "warning" : "neutral";
/** A maintenance plan's work order in the calendar: dashed with the wrench; vilande grey, late red, done green. */
const planningMaintenanceCalendarTone = (state: PlanningMaintenance["state"]) => state === "done"
  ? "border-emerald-500 bg-emerald-50/60 text-emerald-950 dark:bg-emerald-950/40 dark:text-emerald-100"
  : state === "late" ? "border-destructive/60 bg-destructive/5 text-[#9b1c1c] dark:text-destructive"
  : state === "dormant" || state === "cancelled" ? "border-muted-foreground/40 bg-muted/40 text-muted-foreground" : "border-primary/50 bg-card text-foreground";
/** A round in the calendar: dashed and marked with the round symbol, so it never looks like a planned activity. */
const planningRoundCalendarTone = (state: PlanningRound["state"]) => state === "done"
  ? "border-emerald-500 bg-emerald-50/60 text-emerald-950 dark:bg-emerald-950/40 dark:text-emerald-100"
  : state === "missed" ? "border-destructive/60 bg-destructive/5 text-[#9b1c1c] dark:text-destructive" : "border-primary/50 bg-card text-foreground";

/**
 * Starts the round now, continues it or opens its protocol – on any day (2026-10-07: "planering är bara en
 * planering"). The protocol is made from the round's form with its place, customer and responsible person and is
 * linked to this occurrence, so the occurrence counts as started or done and the round's next day is the next open one.
 */
function PlanningRoundAction({ round, size }: { round: PlanningRound; size?: "sm" }) {
  // 2026-10-24: a round whose form is not published shows the warning instead of Starta nu; a protocol still opens.
  if (round.formNotice && !round.taskId) return <span className={cn("self-center text-xs font-medium", indicatorText("warning"))} data-testid="round-form-missing">{round.formNotice}</span>;
  // The popup's buttons are one size, text only; only Starta rond keeps its Play (2026-10-24: "gillar inte pil").
  return <Button asChild size={size} variant={round.taskId || round.state === "done" ? "outline" : "default"}><Link href={round.href} data-testid="planning-round-start" data-start={round.taskId ? undefined : "now"}>{round.state === "done" ? "Öppna protokollet" : round.taskId ? "Fortsätt rond" : <><Play />Starta nu</>}</Link></Button>;
}

/** First page of the round list under the calendar (the activities start with 20 in a short scroll area). */
const PLANNING_FIRST_PAGE = 5;

function PlanningOverview({ initialProjectId = "", canReadProjects = true, canReadRounds = true, loadRounds, loadMaintenance, canCreateWorkOrder = false, capacityRead, localCapacity, loadToBook, mayBookOthers, summary = null, onWindow, activitiesWindow, activities, projects, contextTasks, members, capacity, teamCapacity, busy, error, canCreate, canEdit, canReadTask, canFrameException, canPlanProjects = true, canBookTask, onSave, onRemove }: { /** The project the Kalender opens filtered on (from Planering). */ initialProjectId?: string; canReadProjects?: boolean; /** Driftronder (the link in the phone's Mer) only for someone who may read rounds. */ canReadRounds?: boolean; loadRounds?: LoadPlanningRounds; /** The maintenance plans' work orders (Cloud). */ loadMaintenance?: LoadPlanningMaintenance; canCreateWorkOrder?: boolean; capacityRead: CapacityRead; /** Local has no tab Kapacitet: the same week as a folded card. */ localCapacity?: CapacityRead; loadToBook: () => Promise<{ total: number; rows: ToBookRow[] }>; mayBookOthers: (projectId?: string | null) => boolean;
  /** Booking follows the job (2026-10-10): without the project right only standalone jobs the person may edit are offered. */
  canPlanProjects?: boolean; canBookTask?: (task: WorkflowTask) => boolean; summary?: PlanningSummary | null; onWindow?: (from: string, to: string) => void; /** The window the activities were read for (Cloud); the calendar waits until it covers the shown days. */ activitiesWindow?: { from: string; to: string } | null; canFrameException?: (project: WorkflowProject) => boolean; activities: PlannedActivity[]; projects: WorkflowProject[]; contextTasks: WorkflowTask[]; members: ProjectMember[]; capacity: PlanningCapacity | null; teamCapacity: PlanningTeamCapacity | null; busy: boolean; error: string; canCreate: boolean; canEdit: (activity: PlannedActivity) => boolean; canReadTask: (task: WorkflowTask) => boolean; onSave: (input: PlannedActivityInput) => Promise<{ id: string; version: number; warning?: string }>; onRemove: (id: string, version: number) => Promise<void> }) {
  // Planering på nivå 1 (2026-10-09): a week list per person instead of the calendar (NativePlanning).
  const native = useNativeMode();
  // Planering links here with the project to show (?projectId=); an unknown or archived one is dropped below.
  const [projectChoice, setProjectId] = useState(initialProjectId || "all");
  const projectId = projectChoice !== "all" && projects.length && !projects.some((project) => project.id === projectChoice && !project.archivedAt) ? "all" : projectChoice;
  // Empty selection means every visible responsible; "unallocated" is a selectable pseudo-member.
  const [assignedTo, setAssignedTo] = useState<string[]>([]);
  const [taskId, setTaskId] = useState("all");
  const [audience, setAudience] = useState<"all" | "mine" | "team">("all");
  const [status, setStatus] = useState<"all" | PlannedActivity["status"]>("all");
  const [scope, setScope] = useState<"upcoming" | "all" | "past">("upcoming");
  const [calendarColorBy, setCalendarColorBy] = useState<PlanningCalendarColorBy>("status");
  // Ny planering and Redigera planering are pages of their own (plan 1O, 2026-10-11): `&new=1&start=…&end=…` and
  // `&activityId=…&edit=1`. Level 1 has its own screens (NativePlanning) and never reads them.
  const router = useRouter();
  const searchParams = useSearchParams();
  const calendarHref = initialProjectId ? `/?view=planning&projectId=${encodeURIComponent(initialProjectId)}` : "/?view=planning";
  const asDate = (value: string | null) => { const date = value ? new Date(value) : null; return date && !Number.isNaN(date.getTime()) ? date : null; };
  const calendarDefaults = !native && searchParams.get("new") === "1" ? (() => {
    const fresh = planningDefaultInterval(new Date());
    const startsAt = asDate(searchParams.get("start")) ?? fresh.startsAt;
    return { startsAt, endsAt: asDate(searchParams.get("end")) ?? (asDate(searchParams.get("start")) ? new Date(startsAt.getTime() + 3600_000) : fresh.endsAt) };
  })() : null;
  const editActivityId = !native && searchParams.get("edit") === "1" ? searchParams.get("activityId") : null;
  const calendarEditing = editActivityId ? activities.find((activity) => activity.id === editActivityId && !activity.deletedAt) ?? null : null;
  const setCalendarDefaults = (interval: { startsAt: Date; endsAt: Date }) => router.push(`${calendarHref}&new=1&start=${encodeURIComponent(interval.startsAt.toISOString())}&end=${encodeURIComponent(interval.endsAt.toISOString())}`);
  const setCalendarEditing = (activity: PlannedActivity) => router.push(`${calendarHref}&activityId=${encodeURIComponent(activity.id)}&edit=1`);
  // A direct link to an older booking: Cloud reads the shown period only, so ask for every date once.
  useEffect(() => { if (editActivityId && !calendarEditing && onWindow) onWindow("", ""); }, [editActivityId, calendarEditing, onWindow]);
  const [calendarDeleting, setCalendarDeleting] = useState<PlannedActivity | null>(null);
  const subPage = useSubPageHref();
  // Att boka is read with Planering and again after a booking is made or removed.
  const [toBookRead, setToBookRead] = useState(0);
  const toBookChanged = () => setToBookRead((value) => value + 1);
  // The day of a planning just created: the calendar opens on it and scrolls it into view (2026-10-18).
  const [createdDay, setCreatedDay] = useState<string | null>(null);
  // One message per event with Ångra (2026-10-18): a new planning is taken away again, a removed one is put back as a copy.
  async function createPlanned(input: PlannedActivityInput) {
    const result = await onSave(input);
    setCreatedDay(swedishDayKey(input.startsAt));
    toBookChanged();
    // Varning vid bokning (användartest 2026-10-31, F8): a clash with another booking or an absence is said at once.
    // A clash is said in the warning tone (kundresa 2026-11-07, L58: it had the green success mark).
    const undo = [{ label: "Ångra", run: () => { void onRemove(result.id, result.version).then(() => { toBookChanged(); announce("Planeringen är borttagen"); }).catch((issue) => announce((issue as Error).message, true)); } }];
    if (input.id) { if (result.warning) announceWarning(`Planering sparad. ${result.warning}`); else announce("Planering sparad"); }
    else if (result.warning) announceWarning(`Planering skapad. ${result.warning}`, undo);
    else announce("Planering skapad", false, undo);
    return result;
  }
  async function removePlanned(activity: PlannedActivity) {
    await onRemove(activity.id, activity.version);
    toBookChanged();
    const copy = Object.fromEntries(Object.entries(activity).filter(([key]) => !["id", "version", "deletedAt", "events", "eventCount", "workflowTask"].includes(key)));
    announce("Planering borttagen", false, [{ label: "Ångra", run: () => { void onSave(copy as PlannedActivityInput).then(() => { toBookChanged(); announce("Planeringen är tillbaka"); }).catch((issue) => announce((issue as Error).message, true)); } }]);
  }
  const [now] = useState(() => new Date());
  const projectById = useMemo(() => new Map(projects.map((project) => [project.id, project])), [projects]);
  const horizon = useMemo(() => new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000), [now]);
  // Cloud reads the shown period only; "Alla datum" and "Tidigare aktiviteter" ask for the earlier activities too.
  useEffect(() => {
    if (!onWindow || scope === "upcoming") return;
    onWindow("", scope === "all" ? "" : swedishDayKey(now));
  }, [onWindow, scope, now]);
  const projectName = (activity: PlannedActivity) => activity.project?.name ?? (activity.projectId ? projectById.get(activity.projectId)?.name : undefined) ?? "Utan projekt";
  // Clashes and figures on the one count (2026-11-02): each person's own weekly time and absence.
  const absences = useMemo(() => teamCapacity?.absences ?? [], [teamCapacity]);
  const weeklyWorkMinutesFor = useCallback((userId: string) => teamCapacity?.members.find((member) => member.id === userId)?.weeklyWorkMinutes
    ?? (userId === capacity?.currentUserId ? capacity?.weeklyWorkMinutes : undefined), [capacity, teamCapacity]);
  const clashOptions = useMemo(() => ({ weeklyWorkMinutesFor, noFixedHoursFor: (userId: string) => teamCapacity?.members.find((member) => member.id === userId)?.noFixedHours, absences }), [absences, teamCapacity, weeklyWorkMinutesFor]);
  const capacityBookings = useMemo(() => teamCapacity?.activities ?? [], [teamCapacity]);
  const moduleIsOn = useModules();
  const roundsOn = moduleIsOn("rounds");
  const [moveNotice, setMoveNotice] = useState<{ text: string; tone: "info" | "warning" | "error"; undo?: () => void } | null>(null);
  // The rounds' loads (below): a moved booking is checked against them too (2026-10-28).
  const roundLoadsNow = useRef<RoundCapacityActivity[]>([]);
  // Drag-and-drop only reschedules planned time through the ordinary versioned save; reported time is untouched.
  async function moveActivity(activity: PlannedActivity, day: Date) {
    if (!canEdit(activity)) return;
    const moved = movePlannedActivityToDay(activity, day);
    if (!moved) return;
    const dayText = formatSwedish(day, { weekday: "long", day: "numeric", month: "long" });
    try {
      const fields = { title: activity.title, description: activity.description, kind: activity.kind, status: activity.status, projectId: activity.projectId, workflowTaskId: activity.workflowTaskId,
        assignedToUserId: activity.assignedToUserId, assignedToUserIds: activity.assignedToUserIds, assignedToName: activity.assignedToName };
      const result = await onSave({ id: activity.id, version: activity.version, ...fields, startsAt: moved.startsAt, endsAt: moved.endsAt, assignments: moved.assignments });
      // Ångra puts the planning back where it was (R2-PRJ-07), like for create and remove.
      const undo = () => { void onSave({ id: activity.id, version: result.version, ...fields, startsAt: activity.startsAt, endsAt: activity.endsAt, assignments: activity.assignments })
        .then(() => setMoveNotice({ tone: "info", text: "Flytten är ångrad." })).catch((issue) => setMoveNotice({ tone: "error", text: (issue as Error).message })); };
      const conflicts = summarizeAvailability([...capacityBookings.map((item) => item.id === activity.id ? { ...item, ...moved } : item), ...roundLoadsNow.current], clashOptions).conflicts
        .filter((conflict) => conflictInvolves(conflict, activity.id) && (Boolean(teamCapacity?.canViewTeam) || conflict.userId === currentUserId));
      setMoveNotice(conflicts.length
        ? { tone: "warning", text: `${activity.title} flyttades till ${dayText}. Tidskrock: ${conflicts.map((conflict) => conflictLine(conflict, activity.id)).join("; ")}. Flytten är sparad; varningen är rådgivande.`, undo }
        : { tone: "info", text: `${activity.title} flyttades till ${dayText}.`, undo });
    } catch (issue) {
      setMoveNotice({ tone: "error", text: (issue as Error).message });
    }
  }
  // New planning only targets projects that still accept work (not closed, not archived).
  const planningProjects = useMemo(() => projects.filter(projectAcceptsWork), [projects]);
  const formProjects = canPlanProjects ? planningProjects : [];
  const planningTasks = useMemo(() => {
    const byId = new Map(contextTasks.map((task) => [task.id, task]));
    for (const project of planningProjects)
      for (const task of projectTasks(project))
        byId.set(task.id, { ...task, projectId: task.projectId ?? project.id });
    return [...byId.values()];
  }, [contextTasks, planningProjects]);
  const planningTaskById = useMemo(() => new Map(planningTasks.map((task) => [task.id, task])), [planningTasks]);
  const planningTaskOptions = useMemo(() => {
    const referencedTaskIds = new Set(summary ? summary.taskIds : activities.flatMap((activity) => activity.workflowTaskId ? [activity.workflowTaskId] : []));
    return planningTasks.filter((task) => referencedTaskIds.has(task.id));
  }, [activities, planningTasks, summary]);
  const currentUserId = capacity?.currentUserId ?? "";
  const canQuickFilterTeam = Boolean(teamCapacity?.canViewTeam && teamCapacity.members.some((member) => member.id !== currentUserId));
  // 2026-09-25: "Tidsperiod" narrows only the list; the calendar shows whatever period it is navigated to.
  const calendarVisible = useMemo(() => activities
    .filter((activity) => !activity.deletedAt)
    .filter((activity) => projectId === "all" || activity.projectId === projectId)
    .filter((activity) => taskId === "all" || activity.workflowTaskId === taskId)
    .filter((activity) => audience === "all" || (audience === "mine" ? Boolean(currentUserId) && activity.assignedToUserIds.includes(currentUserId) : activity.assignedToUserIds.length > 0))
    .filter((activity) => !assignedTo.length || (assignedTo.includes("unallocated") && !activity.assignedToUserIds.length && !activity.assignedToName) || activity.assignedToUserIds.some((userId) => assignedTo.includes(userId)))
    .filter((activity) => status === "all" || activity.status === status)
    .sort((left, right) => left.startsAt.localeCompare(right.startsAt)), [activities, assignedTo, audience, currentUserId, projectId, status, taskId]);
  const visible = useMemo(() => calendarVisible
    .filter((activity) => scope === "all" || (scope === "upcoming" ? new Date(activity.endsAt) >= now && new Date(activity.startsAt) <= horizon : new Date(activity.endsAt) < now)), [calendarVisible, horizon, now, scope]);
  // Driftronder (2026-10-06): the occurrences of the round schedules in the calendar's period and 30 days around today,
  // computed from the schedules every time (never stored as planned activities), with the same selection as the activities.
  const todayKey = useMemo(() => swedishDayKey(now), [now]);
  const [shownDays, setShownDays] = useState<{ from: string; to: string } | null>(null);
  const roundsPeriod = useMemo(() => {
    const from = addDays(todayKey, -30); const to = addDays(todayKey, 30);
    return { from: shownDays && shownDays.from < from ? shownDays.from : from, to: shownDays && shownDays.to > to ? shownDays.to : to };
  }, [shownDays, todayKey]);
  const [roundData, setRoundData] = useState<{ rounds: PlanningRound[]; truncated: boolean; error: string; period: { from: string; to: string } | null }>({ rounds: [], truncated: false, error: "", period: null });
  // Local builds its adapter on every render, so the loader is read through a ref and the period alone triggers a read.
  const roundsLoader = useRef(loadRounds);
  useEffect(() => { roundsLoader.current = loadRounds; });
  const hasRounds = Boolean(loadRounds);
  useEffect(() => {
    if (!hasRounds || !roundsLoader.current) return;
    let current = true;
    roundsLoader.current(roundsPeriod).then((result) => { if (current) setRoundData({ ...result, error: "", period: roundsPeriod }); })
      .catch((issue) => { if (current) setRoundData({ rounds: [], truncated: false, error: (issue as Error).message, period: roundsPeriod }); });
    return () => { current = false; };
  }, [hasRounds, roundsPeriod]);
  // Återkommande underhåll (2026-10-30): the plans' work orders on their day – vilande ones clearly marked – in the same period.
  const [maintenanceRead, setMaintenanceRead] = useState<{ occurrences: PlanningMaintenance[]; period: { from: string; to: string } | null }>({ occurrences: [], period: null });
  const maintenanceData = maintenanceRead.occurrences;
  const maintenanceLoader = useRef(loadMaintenance);
  useEffect(() => { maintenanceLoader.current = loadMaintenance; });
  const hasMaintenance = Boolean(loadMaintenance);
  useEffect(() => {
    if (!hasMaintenance || !maintenanceLoader.current) return;
    let current = true;
    // Without the module or the right the answer is empty; a failure only leaves them out of the calendar.
    maintenanceLoader.current(roundsPeriod).then((result) => { if (current) setMaintenanceRead({ occurrences: result.occurrences, period: roundsPeriod }); }, () => { if (current) setMaintenanceRead({ occurrences: [], period: roundsPeriod }); });
    return () => { current = false; };
  }, [hasMaintenance, roundsPeriod]);
  // Innehåll flyttar aldrig (2026-10-30): the week is drawn once its bookings, rounds and maintenance are all in
  // hand – rounds arriving a moment later used to push the bookings down (and a drag then grabbed a round).
  const calendarPending = useMemo(() => {
    const shown = shownDays ?? roundsPeriod;
    const covers = (period: { from: string; to: string } | null | undefined) => Boolean(period && (period.from === "" || period.from <= shown.from) && (period.to === "" || period.to >= shown.to));
    return (hasRounds && !covers(roundData.period)) || (hasMaintenance && !covers(maintenanceRead.period)) || (activitiesWindow !== undefined && !covers(activitiesWindow));
  }, [activitiesWindow, hasMaintenance, hasRounds, maintenanceRead.period, roundData.period, roundsPeriod, shownDays]);
  const calendarMaintenance = useMemo(() => maintenanceData
    .filter((occurrence) => projectId === "all" || occurrence.projectId === projectId)
    .filter((occurrence) => taskId === "all" || occurrence.id === taskId)
    .filter((occurrence) => audience === "all" || (audience === "mine" ? Boolean(currentUserId) && occurrence.assignedToUserId === currentUserId : Boolean(occurrence.assignedToUserId)))
    .filter((occurrence) => !assignedTo.length || (assignedTo.includes("unallocated") && !occurrence.assignedToUserId) || Boolean(occurrence.assignedToUserId && assignedTo.includes(occurrence.assignedToUserId)))
    .filter((occurrence) => planningMaintenanceMatchesStatus(occurrence, status)), [assignedTo, audience, currentUserId, maintenanceData, projectId, status, taskId]);
  // Beräknad tid i beläggningen (2026-10-28): a round occurrence with a beräknad tid and a responsible person loads
  // that person like a booking – not again when its work order is already booked for the person that day – through the same
  // capacity and clash rules as the planned activities (lib/workflow/planning-rounds.ts roundCapacityActivities).
  const calendarCapacity = useMemo(() => capacityLoads(capacityBookings, roundsOn ? roundData.rounds : []), [capacityBookings, roundData.rounds, roundsOn]);
  useEffect(() => { roundLoadsNow.current = calendarCapacity.slice(capacityBookings.length) as RoundCapacityActivity[]; }, [calendarCapacity, capacityBookings]);
  const availability = useMemo(() => summarizeAvailability(calendarCapacity, clashOptions), [calendarCapacity, clashOptions]);
  const ownCapacity = useMemo<CapacityPerson | null>(() => capacity?.currentUserId ? { id: capacity.currentUserId, weeklyWorkMinutes: capacity.weeklyWorkMinutes, noFixedHours: capacity.noFixedHours } : null, [capacity]);
  const teamPeople = useMemo<CapacityPerson[]>(() => canQuickFilterTeam ? teamCapacity!.members.filter((member) => !member.noFixedHours) : [], [canQuickFilterTeam, teamCapacity]);
  const calendarRounds = useMemo(() => roundData.rounds
    .filter((round) => projectId === "all" || round.projectId === projectId)
    // A round is not a planned activity of a task, so choosing one task shows only that task's planning.
    .filter(() => taskId === "all")
    .filter((round) => audience === "all" || (audience === "mine" ? Boolean(currentUserId) && round.assignedToUserId === currentUserId : Boolean(round.assignedToUserId)))
    .filter((round) => !assignedTo.length || (assignedTo.includes("unallocated") && !round.assignedToUserId) || Boolean(round.assignedToUserId && assignedTo.includes(round.assignedToUserId)))
    .filter((round) => planningRoundMatchesStatus(round, status)), [assignedTo, audience, currentUserId, projectId, roundData.rounds, status, taskId]);
  const listRounds = useMemo(() => calendarRounds.filter((round) => scope === "all" || (scope === "upcoming" ? round.date >= todayKey && round.date <= addDays(todayKey, 30) : round.date < todayKey && round.date >= addDays(todayKey, -30))), [calendarRounds, scope, todayKey]);
  // The lists under the calendar start short (2026-10-09, "Planering är mycket lång") and grow by 20 with Visa fler.
  const [activitiesShown, setActivitiesShown] = useState(20);
  const [roundsShown, setRoundsShown] = useState(PLANNING_FIRST_PAGE);
  const toggleAssignee = (id: string) => setAssignedTo((current) => current.includes(id) ? current.filter((item) => item !== id) : [...current, id]);
  const [moreFilters, setMoreFilters] = useState(false);
  const extraFilters = Number(taskId !== "all") + Number(status !== "all") + Number(calendarColorBy !== "status");
  const showRounds = Boolean(loadRounds && (roundData.rounds.length || roundData.error));
  const part = "space-y-6";
  const scopeFilter = <ExtraFilterSelect filter={{ key: "scope", id: "planning-scope", label: "Tidsperiod", value: scope, onChange: (value) => setScope(value as typeof scope), className: "sm:w-52 sm:flex-none", options: [{ value: "upcoming", label: "Kommande 30 dagar" }, { value: "all", label: "Alla datum" }, { value: "past", label: "Tidigare aktiviteter" }] }} />;
  // Att boka (2026-11-02): only for someone who can book, not at level 1, whose screen is the week per person. Local's adapter is read through a ref, as the rounds.
  const wantsToBook = canCreate && !native;
  const [toBook, setToBook] = useState<{ total: number; rows: ToBookRow[]; failed?: boolean } | null>(null);
  const [toBookShown, setToBookShown] = useState(PLANNING_FIRST_PAGE);
  const toBookLoader = useRef(loadToBook);
  useEffect(() => { toBookLoader.current = loadToBook; });
  useEffect(() => {
    if (!wantsToBook) return;
    let current = true;
    toBookLoader.current().then((result) => { if (current) setToBook(result); }, () => { if (current) setToBook({ total: 0, rows: [], failed: true }); });
    return () => { current = false; };
  }, [wantsToBook, toBookRead]);
  // It follows the filter bar, as the maintenance plans' work orders do. A job without a booking is only ever Planerad.
  const toBookRows = useMemo(() => (toBook?.rows ?? [])
    .filter((row) => projectId === "all" || row.projectId === projectId)
    .filter((row) => taskId === "all" || row.id === taskId)
    .filter((row) => audience === "all" || (audience === "mine" ? Boolean(currentUserId) && row.assignedToUserId === currentUserId : Boolean(row.assignedToUserId)))
    .filter((row) => !assignedTo.length || (assignedTo.includes("unallocated") && !row.assignedToUserId) || Boolean(row.assignedToUserId && assignedTo.includes(row.assignedToUserId)))
    .filter(() => status === "all" || status === "PLANNED"), [assignedTo, audience, currentUserId, projectId, status, taskId, toBook]);
  // Boka från jobbet (2026-11-02, `&bookTaskId=`, lib/workflow/bookings.ts): job, name, person and Start filled in. A job that is gone, finished or not this person's to book: the form opens without it and says so. The server remains the judge.
  const bookTaskId = searchParams.get("bookTaskId");
  const bookCandidate = bookTaskId ? planningTaskById.get(bookTaskId) : undefined;
  const bookJob = bookCandidate && bookCandidate.kind === "WORK_ORDER" && isTaskOpen(bookCandidate.status) && canBookTask?.(bookCandidate) && (!bookCandidate.projectId || formProjects.some((project) => project.id === bookCandidate.projectId)) ? bookCandidate : undefined;
  const bookInterval = bookJob ? planningDefaultInterval(fromSwedishDateInput(jobStartDay(bookJob, swedishDayKey(new Date()))) ?? new Date()) : null;
  const bookRefused = Boolean(bookTaskId && !bookJob);
  const bookPeople = bookJob ? parseBookPeople(searchParams.get("bookPeople")) : [];
  const dayChosen = Boolean(searchParams.get("start"));
  const deleteModal = <Modal open={Boolean(calendarDeleting)} onOpenChange={(open) => { if (!open) setCalendarDeleting(null); }} title="Ta bort planering" className="max-w-lg">
      {calendarDeleting ? <div className="space-y-5"><p className="text-sm text-muted-foreground">Ta bort <strong className="text-foreground">{calendarDeleting.title}</strong>? Planeringen tas bort från kalendern. Historiken bevaras.</p>{error ? <p role="alert" className="text-sm text-destructive">{error}</p> : null}<div className="flex flex-wrap justify-end gap-2"><Button type="button" variant="outline" onClick={() => setCalendarDeleting(null)}>Avbryt</Button><Button type="button" variant="destructive" disabled={busy} onClick={() => void removePlanned(calendarDeleting).then(() => setCalendarDeleting(null), () => undefined)}><Trash2 />Ta bort planering</Button></div></div> : null}
    </Modal>;
  if (native) return <>
    <NativePlanning canReadProjects={canReadProjects} canReadRounds={canReadRounds} activities={activities} rounds={roundData.rounds} members={members} currentUserId={currentUserId} canCreate={canCreate} canEdit={canEdit} projectName={projectName}
      jobHref={(activity) => { const task = activity.workflowTaskId ? planningTasks.find((item) => item.id === activity.workflowTaskId) : undefined; return task && canReadTask(task) ? `/?view=workflow_task&taskId=${encodeURIComponent(task.id)}&taskType=${task.kind}` : null; }}
      onRange={onWindow} onShownDays={loadRounds ? setShownDays : undefined} onDelete={(activity) => setCalendarDeleting(activity)}
      form={(activity, close) => { const fresh = bookInterval ?? planningDefaultInterval(new Date()); return <PlannedActivityForm projects={formProjects} projectRight={canPlanProjects} canBookTask={canBookTask} tasks={planningTasks} members={members} capacityRead={capacityRead} currentUserId={currentUserId} mayBookOthers={mayBookOthers} canFrameException={canFrameException}
        {...(activity ? { activity } : { defaultStartsAt: fresh.startsAt, defaultEndsAt: fresh.endsAt, bookJob, bookRefused, bookPeople })} busy={busy} error={error} onCancel={close} onSave={async (input) => { await createPlanned(input); close(); }} />; }} />
    {deleteModal}
  </>;
  if (calendarDefaults) return <FormPage title="Ny planering" back={calendarHref} testId="planning-new-page"
    description={bookJob ? "Uppgifterna är förifyllda. Granska och ändra innan du sparar." : "Tiden är förifylld. Granska och ändra innan du sparar."}>
    {(form) => <PlannedActivityForm projects={formProjects} projectRight={canPlanProjects} canBookTask={canBookTask} tasks={planningTasks} members={members} capacityRead={capacityRead} currentUserId={currentUserId} mayBookOthers={mayBookOthers} canFrameException={canFrameException} defaultStartsAt={(bookInterval ?? calendarDefaults).startsAt} defaultEndsAt={(bookInterval ?? calendarDefaults).endsAt} bookJob={bookJob} bookRefused={bookRefused} bookPeople={bookPeople} dayChosen={dayChosen} busy={busy} error={error} onCancel={form.cancel} onSave={async (input) => { await createPlanned(input); form.done(calendarHref); }} />}
  </FormPage>;
  if (editActivityId) return <FormPage title="Redigera planering" back={calendarHref} testId="planning-edit-page"
    description="Har någon annan ändrat under tiden visas en konflikt.">
    {(form) => calendarEditing && !canEdit(calendarEditing) ? <div className="space-y-3"><p role="status" data-testid="planning-edit-refused" className="text-sm text-muted-foreground">{calendarEditing.title}, {formatDateTime(calendarEditing.startsAt)}. Du får läsa men inte ändra den här bokningen.</p><Button type="button" variant="outline" onClick={form.cancel}>Tillbaka</Button></div> : calendarEditing ? <PlannedActivityForm projects={formProjects} projectRight={canPlanProjects} canBookTask={canBookTask} tasks={planningTasks} members={members} capacityRead={capacityRead} currentUserId={currentUserId} mayBookOthers={mayBookOthers} canFrameException={canFrameException} activity={calendarEditing} busy={busy} error={error} onCancel={form.cancel} onSave={async (input) => { await createPlanned(input); form.done(calendarHref); }} /> : <p role="status" className="text-sm text-muted-foreground">Hämtar planeringen…</p>}
  </FormPage>;
  return <div className="space-y-6">
    {/* Planering's view Kalender (2026-10-30): the page is Planering, its views are the tabs above (Tidplan ·
        Kalender), and there are no buttons to other pages – a booking is made by clicking a day in the calendar. */}
    <PageHeader title="Planering" description={canCreate ? "Teamets bokningar. Klicka på en dag för att planera." : "Teamets bokningar per dag och person."} />
    {/* One shared selection for calendar and list, in the shared filter bar (2026-11-02; the row of jumps is gone, the page is simply scrolled);
        it only narrows activities the user may already see. Below 1024 px Arbetsorder, Status and Kalenderfärg wait behind Fler filter, so the calendar comes up sooner. */}
    <ListToolbar label="Urval för planering">
      <div className="flex min-w-0 flex-wrap items-center gap-2" data-testid="planning-assignee-filter">
        <Segmented label="Planeringsurval" value={audience} onChange={setAudience} options={[{ value: "all", label: "Alla synliga" }, { value: "mine", label: "Mina aktiviteter" }, ...(canQuickFilterTeam ? [{ value: "team" as const, label: "Teamets synliga" }] : [])]} />
        <div role="group" aria-label="Ansvariga" className="flex flex-wrap gap-1.5">{[...members, { id: "unallocated", name: "Ingen ansvarig" }].map((member) => { const pressed = assignedTo.includes(member.id); return <button key={member.id} type="button" aria-pressed={pressed} onClick={() => toggleAssignee(member.id)} className={cn("inline-flex h-8 items-center gap-2 rounded-full border px-3 text-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring", pressed ? "border-primary bg-secondary font-medium text-secondary-foreground" : "bg-card hover:border-primary/40 hover:bg-secondary hover:text-secondary-foreground")}><span aria-hidden="true" className={cn("size-2.5 rounded-full", member.id === "unallocated" ? "bg-muted-foreground/50" : personSolidTone(member.id))} />{member.name}</button>; })}</div>
        {assignedTo.length ? <Button type="button" size="sm" variant="ghost" onClick={() => setAssignedTo([])}>Visa alla ansvariga</Button> : null}
      </div>
      <div className="flex min-w-0 flex-wrap items-center gap-2">
        <ExtraFilterSelect filter={{ key: "project", id: "planning-project", label: "Projekt", value: projectId, onChange: setProjectId, options: [{ value: "all", label: "Alla projekt" }, ...projects.filter((project) => !project.archivedAt).map((project) => ({ value: project.id, label: project.name }))] }} />
        <ExtraFilterSelect filter={{ key: "task", id: "planning-task", label: "Arbetsorder", value: taskId, onChange: setTaskId, className: !moreFilters ? "max-lg:hidden" : undefined, options: [{ value: "all", label: "Alla arbetsordrar" }, ...planningTaskOptions.map((task) => ({ value: task.id, label: task.title }))] }} />
        <ExtraFilterSelect filter={{ key: "status", id: "planning-status", label: "Status", value: status, onChange: (value) => setStatus(value as typeof status), className: !moreFilters ? "max-lg:hidden" : undefined, options: [{ value: "all", label: "Alla statusar" }, { value: "PLANNED", label: "Planerad" }, { value: "IN_PROGRESS", label: "Pågår" }, { value: "COMPLETED", label: "Slutförd" }, { value: "CANCELED", label: TASK_CANCEL_LABEL }] }} />
        <ExtraFilterSelect filter={{ key: "color", id: "planning-calendar-color", testId: "planning-calendar-color", label: "Kalenderfärg", value: calendarColorBy, onChange: (value) => setCalendarColorBy(value as PlanningCalendarColorBy), className: !moreFilters ? "max-lg:hidden" : undefined, options: [{ value: "status", label: "Färg efter status" }, { value: "project", label: "Färg efter projekt" }, { value: "assignee", label: "Färg efter ansvarig" }] }} />
        <Button type="button" variant="outline" className="w-fit lg:hidden" aria-expanded={moreFilters} onClick={() => setMoreFilters((value) => !value)}><SlidersHorizontal />{moreFilters ? "Färre filter" : `Fler filter${extraFilters ? ` (${extraFilters} valda)` : ""}`}</Button>
      </div>
    </ListToolbar>
    <div id="planning-part-calendar" className={part}>
      <PlanningCalendar pending={calendarPending} focusDay={createdDay} absences={absences} canCreateWorkOrder={canCreateWorkOrder} activities={calendarVisible} capacityActivities={calendarCapacity} currentUserId={currentUserId} ownCapacity={ownCapacity} teamPeople={teamPeople} weeklyWorkMinutesFor={weeklyWorkMinutesFor} members={members} conflicts={availability.conflicts} canViewTeamAvailability={Boolean(teamCapacity?.canViewTeam)} projects={projects} tasks={planningTasks} colorBy={calendarColorBy} canCreate={canCreate} canEdit={canEdit} canReadTask={canReadTask} onPlanDay={(day) => setCalendarDefaults(planningDefaultInterval(day))} onEdit={(activity) => setCalendarEditing(activity)} onDelete={(activity) => setCalendarDeleting(activity)} onMove={moveActivity} busy={busy} moveNotice={moveNotice} onRange={onWindow} rounds={loadRounds ? calendarRounds : []} maintenance={calendarMaintenance} onShownDays={loadRounds || loadMaintenance ? setShownDays : undefined} />
    </div>
    {/* Att boka (2026-11-02): folded under the calendar, always this same card, so nothing below moves when the list is read. */}
    {wantsToBook ? <PlanningToBook read={toBook} rows={toBookRows} href={(id) => subPage(bookJobHref(id))} shown={toBookShown} onMore={() => setToBookShown((value) => value + 20)} /> : null}
    {/* The work list (2026-10-08). An empty list is one line; a long one shows 20 at a time with Visa fler – one page scroll, no
        box that scrolls on its own (QA 2026-10-10). Tidsperiod stands here, on the list it governs (2026-11-02); the calendar shows the period it is stepped to. */}
    <div id="planning-part-list" className={part}>
      {visible.length ? <Panel icon={CalendarClock} title="Planerade aktiviteter" description={`Samma filter som kalendern. ${visible.length} ${visible.length === 1 ? "aktivitet" : "aktiviteter"}${visible.some((activity) => activity.status === "IN_PROGRESS") ? ` · ${visible.filter((activity) => activity.status === "IN_PROGRESS").length} pågår` : ""}`} actions={scopeFilter}>
        <ol data-testid="planning-overview-list" className="divide-y rounded-xl border">{visible.slice(0, activitiesShown).map((activity) => <li key={activity.id} className="p-4"><div className="flex flex-wrap items-start gap-3"><span className="mt-0.5 flex size-10 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary"><CalendarDays className="size-4" /></span><div className="min-w-0 flex-1 basis-48"><div className="flex flex-wrap items-center gap-2"><p className="text-sm font-semibold">{activity.title}</p><Badge variant="outline" className={indicatorBadge(activity.status === "PLANNED" ? "info" : statusTone(activity.status))}>{planningStatusLabel(activity.status)}</Badge><span className="text-xs text-muted-foreground">{planningKindLabel(activity.kind)}</span></div><p className="mt-1 text-sm text-muted-foreground">{formatDateTime(activity.startsAt)} – {formatDateTime(activity.endsAt)}</p><p className="mt-1 text-xs text-muted-foreground">{projectName(activity)}{activity.assignedToName ? ` · ${activity.assignedToName}` : ""}</p>{activity.description && <p className="mt-2 text-sm text-muted-foreground">{activity.description}</p>}</div>{/* A booking on a job opens the job (simulation 0.6.3: only Öppna projekt was offered), and the project beside it. */}
{(() => { const job = activity.workflowTaskId ? planningTaskById.get(activity.workflowTaskId) : undefined; return job && canReadTask(job) ? <Button asChild size="sm" variant="outline" data-testid="planning-open-job"><Link href={taskHref(job)}>Öppna arbetsordern</Link></Button> : null; })()}{activity.projectId && <Button asChild size="sm" variant="ghost"><Link href={`/?view=project&projectId=${encodeURIComponent(activity.projectId)}`}>Öppna projekt</Link></Button>}</div></li>)}</ol>
        <ShowMore shown={Math.min(activitiesShown, visible.length)} total={visible.length} onMore={() => setActivitiesShown((value) => value + 20)} />
      </Panel> : <EmptyPanelLine title="Planerade aktiviteter" text="Inga aktiviteter matchar urvalet. Ändra tidsperiod eller filter." action={scopeFilter} />}
    </div>
    {showRounds ? <div id="planning-part-rounds" className={part}>
      {roundData.error || listRounds.length ? <Panel title="Driftronder" description={`Följer listans filter och tidsperiod (${scope === "upcoming" ? "kommande 30 dagar" : scope === "past" ? "senaste 30 dagarna" : "den visade perioden"}). Tillfällena ändras under Driftronder.`}
        icon={Repeat} actions={<Button asChild size="sm" variant="outline"><Link href="/?view=rounds">Alla driftronder</Link></Button>}>
        {roundData.error ? <p role="alert" className="text-sm text-destructive">{roundData.error}</p> : <>
          <ol data-testid="planning-round-list" className="divide-y rounded-xl border">{listRounds.slice(0, roundsShown).map((round) => <li key={round.key} className="flex flex-wrap items-start gap-3 p-4" data-testid="planning-round-row">
            <span className="mt-0.5 flex size-10 shrink-0 items-center justify-center rounded-lg border border-dashed border-primary/50 text-primary"><Repeat className="size-4" /></span>
            <div className="min-w-0 flex-1"><div className="flex flex-wrap items-center gap-2"><p className="text-sm font-semibold">{round.title}</p><Badge variant="outline" className={indicatorBadge(planningRoundTone(round.state))}>{PLANNING_ROUND_STATE_LABEL[round.state]}</Badge><span className="text-xs text-muted-foreground">Driftrond</span></div>
              <p className="mt-1 text-sm text-muted-foreground">{formatSwedish(`${round.date}T12:00:00`, { weekday: "short", day: "numeric", month: "short", year: "numeric" })} · {round.ruleText}</p>
              <p className="mt-1 text-xs text-muted-foreground">{[round.templateName, round.facilityName, round.customerName, round.projectName, round.assignedToName].filter(Boolean).join(" · ")}</p></div>
            <PlanningRoundAction round={round} size="sm" /></li>)}</ol>
          <ShowMore shown={Math.min(roundsShown, listRounds.length)} total={listRounds.length} onMore={() => setRoundsShown((value) => value + 20)} />
          {roundData.truncated ? <p className="mt-2 text-xs text-muted-foreground">Perioden har fler tillfällen än som visas; välj en kortare period i kalendern.</p> : null}
        </>}
      </Panel> : <EmptyPanelLine title="Driftronder" text="Inga tillfällen matchar urvalet." icon={<Repeat className="size-4" />}
        action={<Button asChild size="sm" variant="outline"><Link href="/?view=rounds">Alla driftronder</Link></Button>} />}
    </div> : null}
    {localCapacity ? <CapacityFoldedPanel read={localCapacity} /> : null}
    {deleteModal}
  </div>;
}

function PlanningCalendar({ pending = false, focusDay = null, absences = [], rounds = [], maintenance = [], onShownDays, canCreateWorkOrder = false, activities, capacityActivities, currentUserId, ownCapacity, teamPeople, weeklyWorkMinutesFor, members, conflicts, canViewTeamAvailability, projects, tasks, colorBy, canCreate, canEdit, canReadTask, onPlanDay, onEdit, onDelete, onMove, busy = false, moveNotice = null, onRange }: { /** The shown days' bookings, rounds or maintenance are still being read: the days stay empty until all are in hand, so nothing moves. */ pending?: boolean; /** A day to open on and scroll into view (a planning just created). */ focusDay?: string | null; /** Who is away (approved absence), per day. */ absences?: PlanningAbsence[]; onRange?: (from: string, to: string) => void; rounds?: PlanningRound[]; /** The maintenance plans' work orders on their day. */ maintenance?: PlanningMaintenance[]; onShownDays?: (update: (current: { from: string; to: string } | null) => { from: string; to: string } | null) => void; canCreateWorkOrder?: boolean; activities: PlannedActivity[]; capacityActivities: CapacityActivity[]; currentUserId: string; ownCapacity: CapacityPerson | null; teamPeople: CapacityPerson[]; weeklyWorkMinutesFor: (userId: string) => number | undefined; members: ProjectMember[]; conflicts: ReturnType<typeof summarizeAvailability>["conflicts"]; canViewTeamAvailability: boolean; projects: WorkflowProject[]; tasks: WorkflowTask[]; colorBy: PlanningCalendarColorBy; canCreate: boolean; canEdit: (activity: PlannedActivity) => boolean; canReadTask: (task: WorkflowTask) => boolean; onPlanDay: (day: Date) => void; onEdit: (activity: PlannedActivity) => void; onDelete: (activity: PlannedActivity) => void; onMove?: (activity: PlannedActivity, startDay: Date) => void; busy?: boolean; moveNotice?: { text: string; tone: "info" | "warning" | "error"; undo?: () => void } | null }) {
  const subPage = useSubPageHref();
  // On a phone (under 640 px) the month is about 2700 px tall, so the calendar opens as a week there (2026-10-09); the
  // view the person picks is kept for this visit, also after a row and back.
  const [mode, setMode] = useEntryState<PlanningCalendarMode>("planning.calendarMode", typeof window !== "undefined" && window.innerWidth < 640 ? "week" : "month");
  const [anchor, setAnchor] = useState(() => focusDay ? new Date(`${focusDay}T12:00:00`) : new Date());
  useEffect(() => {
    if (!focusDay) return;
    const node = document.querySelector(`[data-testid="planning-calendar-day"][data-day="${focusDay}"]`);
    node?.scrollIntoView({ block: "center" });
  }, [focusDay]);
  const [selected, setSelected] = useState<PlannedActivity | null>(null);
  const [selectedRound, setSelectedRound] = useState<PlanningRound | null>(null);
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
  // The shown period ± one week must be loaded (Cloud reads Planning by period).
  useEffect(() => {
    if (!onRange || !days.length) return;
    onRange(swedishDayKey(addSwedishDays(days[0], -7)), swedishDayKey(addSwedishDays(days[days.length - 1], 7)));
  }, [days, onRange]);
  useEffect(() => {
    if (!onShownDays || !days.length) return;
    const from = swedishDayKey(days[0]); const to = swedishDayKey(days[days.length - 1]);
    onShownDays((current) => current?.from === from && current.to === to ? current : { from, to });
  }, [days, onShownDays]);
  const roundsByDay = useMemo(() => {
    const byDay = new Map<string, PlanningRound[]>();
    for (const round of rounds) byDay.set(round.date, [...(byDay.get(round.date) ?? []), round]);
    return byDay;
  }, [rounds]);
  const maintenanceByDay = useMemo(() => {
    const byDay = new Map<string, PlanningMaintenance[]>();
    for (const occurrence of maintenance) byDay.set(occurrence.date, [...(byDay.get(occurrence.date) ?? []), occurrence]);
    return byDay;
  }, [maintenance]);
  const conflictedActivityIds = useMemo(() => new Set(conflicts.flatMap((conflict) => conflict.activities.map((item) => item.activityId))), [conflicts]);
  const dayLabel = new Intl.DateTimeFormat("sv-SE", { weekday: "short", timeZone: SWEDISH_TIME_ZONE });
  const timeLabel = new Intl.DateTimeFormat("sv-SE", { hour: "2-digit", minute: "2-digit", timeZone: SWEDISH_TIME_ZONE });
  const today = new Date();
  const selectedProject = selected?.projectId ? projects.find((project) => project.id === selected.projectId) : undefined;
  const selectedProjectTasks = selectedProject ? projectTasks(selectedProject) : [];
  const selectedProjectBudget = selectedProject ? summarizeProjectBudget(selectedProject.timeBudgetMinutes, projectReportedSec(selectedProject, selectedProjectTasks)) : null;
  const selectedTaskId = selected?.workflowTaskId ?? null;
  const selectedTask = selectedTaskId ? tasks.find((task) => task.id === selectedTaskId) : undefined;
  const timeReportHref = selectedTask ? subPage(`/?view=time&timeTaskId=${encodeURIComponent(selectedTask.id)}`) : null;
  const memberNameById = useMemo(() => new Map(members.map((member) => [member.id, member.name])), [members]);
  const selectedAssignments = selected ? plannedActivityAssignments(selected) : [];
  const selectedConflictsByUserId = useMemo(() => {
    const byUserId = new Map<string, ReturnType<typeof summarizeAvailability>["conflicts"]>();
    if (!selected) return byUserId;
    for (const conflict of conflicts) {
      if (!canViewTeamAvailability && conflict.userId !== currentUserId) continue;
      if (!conflictInvolves(conflict, selected.id)) continue;
      byUserId.set(conflict.userId, [...(byUserId.get(conflict.userId) ?? []), conflict]);
    }
    return byUserId;
  }, [canViewTeamAvailability, conflicts, currentUserId, selected]);
  const shortName = useMemo(() => shortNames(members), [members]);
  // En räkning (2026-11-02): each person's own weekly time, the same people as the tab Kapacitet.
  const capacityByDay = useMemo(() => new Map(days.map((day) => {
    const startsAt = startOfSwedishDay(day);
    const endsAt = addSwedishDays(startsAt, 1);
    const ownMinutes = ownCapacity ? plannedMinutesForUserInWindow({ activities: capacityActivities, userId: ownCapacity.id, startsAt, endsAt, weeklyWorkMinutes: ownCapacity.weeklyWorkMinutes }) : 0;
    const teamMinutes = teamPeople.reduce((sum, person) => sum + plannedMinutesForUserInWindow({ activities: capacityActivities, userId: person.id, startsAt, endsAt, weeklyWorkMinutes: person.weeklyWorkMinutes }), 0);
    return [swedishDayKey(startsAt), { ownMinutes, teamMinutes }];
  })), [capacityActivities, days, ownCapacity, teamPeople]);
  const weeklyCalendarCapacity = useMemo(() => {
    if (mode !== "week" || !ownCapacity) return null;
    const summary = capacityInWindow({ person: ownCapacity, activities: capacityActivities, absences, ...capacityWeek(anchor) });
    return summary.availableMinutes === null ? null : { ...summary, availableMinutes: summary.availableMinutes };
  }, [absences, anchor, capacityActivities, mode, ownCapacity]);
  const weeklyTeamMinutes = useMemo(() => mode === "week" ? [...capacityByDay.values()].reduce((sum, day) => sum + day.teamMinutes, 0) : 0, [capacityByDay, mode]);
  return <Panel icon={CalendarDays} title="Planeringskalender" description={canCreate ? "Klicka på en dag för att planera, på en aktivitet för detaljer." : "Dag-, vecko- och månadsvy av planeringen."}
    actions={<div className="flex items-center gap-1 rounded-lg border bg-muted/40 p-1" aria-label="Kalenderintervall">{(["day", "week", "month"] as const).map((item) => <Button key={item} size="sm" className="h-7" variant={mode === item ? "default" : "ghost"} onClick={() => { if (item === "day") setAnchor((current) => dayViewAnchor(current, mode, new Date())); setMode(item); }}>{item === "day" ? "Dag" : item === "week" ? "Vecka" : "Månad"}</Button>)}</div>}>
    <div className="mb-3 flex flex-wrap items-center justify-between gap-3"><p className="text-lg font-semibold">{planningCalendarTitle(anchor, mode)}</p><div className="flex items-center gap-1"><IconButton label="Föregående period" onClick={() => setAnchor((current) => movePlanningCalendar(current, mode, -1))}><ChevronLeft /></IconButton><Button size="sm" variant="outline" onClick={() => setAnchor(new Date())}>Idag</Button><IconButton label="Nästa period" onClick={() => setAnchor((current) => movePlanningCalendar(current, mode, 1))}><ChevronRight /></IconButton></div></div>
    {weeklyCalendarCapacity ? <div data-testid="calendar-week-capacity" className={`mb-3 inline-flex rounded-full border px-3 py-1 text-xs ${weeklyCalendarCapacity.overplannedMinutes ? "border-amber-300 bg-amber-50 text-amber-900 dark:bg-amber-950 dark:text-amber-100" : "border-primary/20 bg-secondary text-secondary-foreground"}`}><span className="font-medium">Min planering: {formatMinutes(weeklyCalendarCapacity.plannedMinutes)} av {formatMinutes(weeklyCalendarCapacity.availableMinutes)}</span><span className="opacity-80">&nbsp;· {weeklyCalendarCapacity.plannedPercent}%</span>{teamPeople.length ?<span className="opacity-80">&nbsp;· Team: {formatMinutes(weeklyTeamMinutes)}</span> : null}</div> : null}
    {moveNotice ?<p data-testid="planning-move-notice" role={moveNotice.tone === "error" ? "alert" : "status"} className={cn("mb-3 flex items-start gap-2 rounded-lg border px-3 py-2 text-xs", moveNotice.tone === "warning" ? "border-amber-200 bg-amber-50/60 text-amber-950 dark:border-amber-900 dark:bg-amber-950/30 dark:text-amber-100" : moveNotice.tone === "error" ? "border-destructive/30 bg-destructive/5 text-destructive" : "border-primary/20 bg-primary/5 text-foreground")}>{moveNotice.tone === "warning" ? <AlertTriangle className="mt-0.5 size-4 shrink-0 text-amber-600 dark:text-amber-300" /> : null}<span className="min-w-0 flex-1">{moveNotice.text}</span>{moveNotice.undo ? <button type="button" className="shrink-0 font-medium underline underline-offset-2" data-testid="planning-move-undo" onClick={moveNotice.undo}>Ångra</button> : null}</p> : null}
    {/* One continuous grid: gap-px on a border-colored background draws single 1px lines between cells. */}
    <div className="overflow-hidden rounded-xl border bg-border">
      {mode !== "day" ? <div aria-hidden="true" className="hidden grid-cols-7 gap-px border-b sm:grid">{["Mån", "Tis", "Ons", "Tors", "Fre", "Lör", "Sön"].map((name) => <div key={name} className="bg-secondary px-2 py-2 text-xs font-semibold text-secondary-foreground">{name}</div>)}</div> : null}
      <div data-testid="planning-calendar" data-color-by={colorBy} aria-busy={pending || undefined} data-loading={pending ? "true" : undefined} className={`grid gap-px ${mode === "month" ? "grid-cols-2 sm:grid-cols-7" : mode === "week" ? "grid-cols-1 sm:grid-cols-7" : "grid-cols-1"}`}>{days.map((day) => {
      const items = pending ? [] : planningActivitiesForDay(activities, day); const currentMonth = isInSwedishMonth(day, anchor); const isToday = isSameSwedishDay(day, today);
      const dayNumber = swedishParts(day).day;
      const planLabel = `Planera på ${formatSwedish(day, { weekday: "long", day: "numeric", month: "long", year: "numeric" })}`;
      const dayKey = swedishDayKey(day);
      const dayCapacity = capacityByDay.get(dayKey);
      const shownItems = mode === "month" ? items.slice(0, 3) : items;
      const dayRounds = pending ? [] : roundsByDay.get(dayKey) ?? [];
      const away = absences.filter((absence) => absence.from <= dayKey && absence.to >= dayKey);
      const shownRounds = mode === "month" ? dayRounds.slice(0, Math.max(0, 3 - shownItems.length)) : dayRounds;
      const dayMaintenance = pending ? [] : maintenanceByDay.get(dayKey) ?? [];
      const shownMaintenance = mode === "month" ? dayMaintenance.slice(0, Math.max(0, 3 - shownItems.length - shownRounds.length)) : dayMaintenance;
      const hiddenCount = items.length - shownItems.length + dayRounds.length - shownRounds.length + dayMaintenance.length - shownMaintenance.length;
      const label = <>{mode === "day" ? <span className="mr-1.5 capitalize">{formatSwedish(day, { weekday: "long" })}</span> : <span className="mr-1 capitalize sm:hidden">{dayLabel.format(day)}</span>}<span className={isToday ? "inline-flex size-6 items-center justify-center rounded-full bg-primary font-semibold text-primary-foreground" : ""}>{dayNumber}</span>{mode === "day" ? <span className="ml-1.5 text-muted-foreground">{formatSwedish(day, { month: "long" })}</span> : null}</>;
      return <section key={day.toISOString()} data-testid="planning-calendar-day" data-day={dayKey}
        onDragOver={(event) => { if (!dragging) return; event.preventDefault(); event.dataTransfer.dropEffect = "move"; if (dropTarget !== dayKey) setDropTarget(dayKey); }}
        onDragLeave={(event) => { if (!event.currentTarget.contains(event.relatedTarget as Node | null) && dropTarget === dayKey) setDropTarget(null); }}
        onDrop={(event) => { if (!dragging) return; event.preventDefault(); dropOn(day); }}
        // The day's empty room plans too, as the text says (kundresa 2026-11-07, L54); the date button stays the keyboard's way.
        onClick={canCreate ? (event) => { const target = event.target as HTMLElement; if (target === event.currentTarget || target.tagName === "OL") onPlanDay(day); } : undefined}
        className={cn("min-h-28 p-2 transition-colors", canCreate && "cursor-pointer", mode === "week" && "sm:min-h-44", /* The month's day holds room for three entries and "+N till" from the start, so the grid does not shrink and grow while a month is read (kundresa 2026-11-07, M27). */ mode === "month" && "sm:min-h-[10.25rem]", mode === "month" && !currentMonth ? "bg-muted/60 text-muted-foreground" : "bg-card", dropTarget === dayKey && "bg-secondary ring-2 ring-inset ring-primary/40")}><div className="mb-1.5 flex items-center justify-between gap-2">{canCreate ? <button type="button" aria-label={planLabel} title={planLabel} onClick={() => onPlanDay(day)} className="flex items-center rounded-full px-1 text-left text-xs font-medium transition-colors hover:bg-secondary hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">{label}</button> : <p className="flex items-center px-1 text-xs font-medium">{label}</p>}</div>{away.length ? <p data-testid="calendar-day-absence" title={away.map((absence) => `${absence.name}: ${absence.label}`).join(", ")} className="mb-1 truncate px-1 text-[11px] text-amber-800 dark:text-amber-300">{mode === "month" ? `${away.length} borta` : `Borta: ${away.map((absence) => `${shortName.get(absence.userId) ?? absence.name} (${absence.label})`).join(", ")}`}</p> : null}{mode !== "month" && dayCapacity ? <div data-testid="calendar-day-capacity" className="mb-2 flex flex-wrap gap-x-2 px-1 text-[11px] text-muted-foreground"><span>Min planering: <span className="whitespace-nowrap">{formatMinutes(dayCapacity.ownMinutes)}</span></span>{teamPeople.length ? <span data-testid="calendar-team-capacity">Team: <span className="whitespace-nowrap">{formatMinutes(dayCapacity.teamMinutes)}</span></span> : null}</div> : null}<ol className="flex flex-col gap-1">{shownItems.map((activity) => <li key={activity.id} style={{ order: dayMinute(activity.startsAt, dayKey) }}><button type="button" onClick={() => setSelected(activity)} aria-label={`Visa planering ${activity.title}`} draggable={canDrag(activity)} onDragStart={(event) => { if (!canDrag(activity)) { event.preventDefault(); return; } event.dataTransfer.effectAllowed = "move"; event.dataTransfer.setData("text/plain", activity.id); setDragging({ id: activity.id, fromDay: day }); }} onDragEnd={() => { setDragging(null); setDropTarget(null); }} data-color-by={colorBy} className={cn("block w-full rounded-md px-2 py-1 max-lg:min-h-11 text-left text-[11px] leading-4 transition-[filter] hover:brightness-95 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring", mode === "week" ? "break-words" : mode === "month" ? "lg:truncate" : "truncate", conflictedActivityIds.has(activity.id) ? "border-amber-500 bg-amber-50 text-amber-900 dark:bg-amber-950 dark:text-amber-100" : planningCalendarActivityTone(activity, colorBy))} title={`${activity.title} · ${formatDateTime(activity.startsAt)}–${formatDateTime(activity.endsAt)}`}>{/* In a week's narrow day the time and up to two lines of the name (simulation 0.6.3: "07:00 Sl…" in a standing tablet). */}
{mode === "week" ? <><span className="block font-semibold">{timeLabel.format(new Date(activity.startsAt))}</span><span className="line-clamp-2">{activity.title}</span></> : <span className={mode === "month" ? "max-lg:line-clamp-2" : undefined}><span className="font-semibold">{timeLabel.format(new Date(activity.startsAt))}</span> {activity.title}</span>}</button></li>)}{/* A round with a klockslag takes its place among the day's bookings by time (2026-10-28); without one it is first. */}{shownRounds.map((round) => <li key={round.key} style={{ order: round.time ? Number(round.time.slice(0, 2)) * 60 + Number(round.time.slice(3, 5)) : 0 }}><button type="button" data-testid="planning-calendar-round" data-state={round.state} onClick={() => setSelectedRound(round)} aria-label={`Visa driftrond ${round.title}, ${PLANNING_ROUND_STATE_LABEL[round.state].toLowerCase()}`} title={`Driftrond · ${round.title} · ${PLANNING_ROUND_STATE_LABEL[round.state]}`} className={cn("flex w-full items-center gap-1 rounded-md border border-dashed px-2 py-1 max-lg:min-h-11 text-left text-[11px] leading-4 transition-[filter] hover:brightness-95 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring", planningRoundCalendarTone(round.state))}><Repeat aria-hidden="true" className={cn("size-3 shrink-0", mode === "month" && "max-lg:hidden")} />{round.time ? <span className="font-semibold" data-testid="planning-calendar-round-time">{round.time}</span> : null}{/* Two lines in a narrow month (resa 4, 2026-11-06: "QA an…" at 768 px); the dashed edge marks the round there. */}<span className={cn("min-w-0", mode === "month" ? "max-lg:line-clamp-2 lg:truncate" : "truncate")}>{round.title}</span></button></li>)}{/* A maintenance plan's work order (2026-10-30): dashed with the wrench; a vilande one says so and is greyed. */}{shownMaintenance.map((occurrence) => <li key={`maintenance-${occurrence.id}`} style={{ order: 0 }}><Link href={taskHref({ id: occurrence.id, kind: "WORK_ORDER" })} data-testid="planning-calendar-maintenance" data-state={occurrence.state} aria-label={`Öppna underhåll ${occurrence.title}, ${PLAN_STATE_LABELS[occurrence.state].toLowerCase()}`} title={`Underhåll · ${occurrence.title} · ${PLAN_STATE_LABELS[occurrence.state]}`} className={cn("flex w-full items-center gap-1 rounded-md border border-dashed px-2 py-1 max-lg:min-h-11 text-left text-[11px] leading-4 transition-[filter] hover:brightness-95 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring", planningMaintenanceCalendarTone(occurrence.state))}><Wrench aria-hidden="true" className="size-3 shrink-0" />{occurrence.state === "dormant" ? <span className="font-semibold">Vilande</span> : null}<span className="truncate">{occurrence.title}</span></Link></li>)}</ol>{hiddenCount > 0 ? <p className="mt-1 px-1 text-[11px] text-muted-foreground">+{hiddenCount} till</p> : null}{mode === "day" && !pending && !items.length && !dayRounds.length && !dayMaintenance.length ? <p className="px-1 text-xs text-muted-foreground">Inget planerat</p> : null}</section>;
    })}</div>
    </div>
    <p className="mt-3 text-xs text-muted-foreground" data-detail-min="3">Kalendern följer filtren ovan.{rounds.length ? " Streckade rader är driftronder; de ändras under Driftronder." : ""}{maintenance.length ? " Rader med skiftnyckel är underhåll från underhållsplaner; vilande blir aktiva på sin dag." : ""}{onMove && mode !== "day" && activities.some(canEdit) ? " Dra en aktivitet till en annan dag för att flytta den." : ""}</p>
    <Modal open={Boolean(selected)} onOpenChange={(open) => { if (!open) setSelected(null); }} title="Planeringsdetaljer" className="max-w-lg">
      {selected ? <div className="space-y-4"><div><div className="flex flex-wrap items-center gap-2"><p className="text-base font-semibold">{selected.title}</p><Badge variant="outline">{planningStatusLabel(selected.status)}</Badge></div><p data-testid="planning-shared-interval" className="mt-1 text-sm text-muted-foreground"><span className="font-medium text-foreground">Aktivitetens gemensamma intervall:</span> {formatDateTime(selected.startsAt)} – {formatDateTime(selected.endsAt)}</p></div><dl className="grid gap-3 rounded-xl border bg-muted/20 p-4 text-sm"><div><dt className="text-xs font-medium text-muted-foreground">Projekt</dt><dd className="mt-1">{selected.project?.name ?? selectedProject?.name ?? "Utan projekt"}</dd></div><div><dt className="text-xs font-medium text-muted-foreground">Ansvarig</dt><dd className="mt-1">{selected.assignedToName || "Ingen ansvarig"}</dd></div><div><dt className="text-xs font-medium text-muted-foreground">Typ</dt><dd className="mt-1">{planningKindLabel(selected.kind)}</dd></div></dl>{selectedAssignments.length ? <section data-testid="planning-assignment-details" className="rounded-xl border bg-muted/20 p-4"><p className="text-xs font-medium text-muted-foreground">Deltagare och kapacitet</p><p className="mt-1 text-xs text-muted-foreground">Personens tid visas skilt från aktivitetens tid.</p><ol className="mt-3 divide-y rounded-lg border bg-background/70">{selectedAssignments.map((assignment) => { const assignmentConflicts = selectedConflictsByUserId.get(assignment.userId) ?? []; return <li key={assignment.userId} className="p-3 text-sm"><div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-1"><div><p className="font-medium">{memberNameById.get(assignment.userId) ?? "Intern deltagare"}</p><p className="mt-1 text-xs text-muted-foreground">{assignment.startsAt && assignment.endsAt ? `Individuellt intervall: ${formatDateTime(assignment.startsAt)}–${formatDateTime(assignment.endsAt)}` : "Delar aktivitetens gemensamma intervall"}</p></div><p className="text-xs font-medium text-primary">Belastning: {assignmentLoadText(selected, assignment, weeklyWorkMinutesFor(assignment.userId))}{!assignment.startsAt && assignment.plannedMinutes !== null && swedishDayKey(selected.startsAt) !== swedishDayKey(new Date(new Date(selected.endsAt).getTime() - 1)) ? " fördelat på arbetsdagarna" : ""}</p></div>{assignmentConflicts.length ? <div data-testid="planning-assignment-conflict" className="mt-3 flex gap-2 rounded-lg border border-amber-200 bg-amber-50/60 p-2 text-xs text-amber-950 dark:border-amber-900 dark:bg-amber-950/30 dark:text-amber-100"><AlertTriangle className="mt-0.5 size-4 shrink-0 text-amber-600 dark:text-amber-300" /><div><p className="font-medium">Tidskrock i planeringen</p>{assignmentConflicts.map((conflict) => <p key={`${conflict.kind}-${conflict.first.activityId}-${conflict.second.activityId}-${conflict.startsAt}`} className="mt-1">{conflictLine(conflict, selected.id)}</p>)}</div></div> : null}</li>; })}</ol></section> : null}{selectedProject && selectedProjectBudget ? <section className="rounded-xl border bg-muted/20 p-4"><div className="flex flex-wrap items-start justify-between gap-3"><div><p className="text-xs font-medium text-muted-foreground">Projektkontext</p><p className="mt-1 text-sm font-semibold">{selectedProject.name}</p></div><Button asChild size="sm" variant="outline"><Link href={`/?view=project&projectId=${encodeURIComponent(selectedProject.id)}`}>Öppna projekt</Link></Button></div><div className="mt-3 grid grid-cols-3 gap-2 text-xs"><div className="rounded-lg bg-background/70 p-2"><p className="text-muted-foreground">Klart</p><p className="mt-1 font-semibold">{projectProgress(selectedProject)}%</p></div><div className="rounded-lg bg-background/70 p-2"><p className="text-muted-foreground">Budget</p><p className="mt-1 font-semibold">{selectedProjectBudget.hasBudget ? formatMinutes(selectedProjectBudget.budgetMinutes) : "—"}</p></div><div className="rounded-lg bg-background/70 p-2"><p className="text-muted-foreground">Rapporterat totalt</p><p className="mt-1 font-semibold">{formatMinutes(selectedProjectBudget.reportedMinutes)}</p></div></div></section> : null}{selectedTask ? <section className="rounded-xl border bg-muted/20 p-4"><div className="flex flex-wrap items-start justify-between gap-3"><div><p className="text-xs font-medium text-muted-foreground">{taskTypeLabel(selectedTask)}</p><p className="mt-1 text-sm font-semibold">{selectedTask.title}</p><p className="mt-1 text-xs text-muted-foreground">{taskProgress(selectedTask)}% verkligt klart</p></div>{canReadTask(selectedTask) ? <div className="flex flex-wrap gap-2"><Button asChild size="sm" variant="outline"><Link href={taskHref(selectedTask)}>{selectedTask.kind === "WORK_ORDER" ? "Öppna arbetsordern" : "Öppna"}</Link></Button>{timeReportHref ? <Button asChild size="sm"><Link href={timeReportHref}>Visa tidrapport<Clock3 /></Link></Button> : null}</div> : null}</div></section>
      : !selectedTaskId && canCreateWorkOrder && !selectedProject?.archivedAt && !selectedProject?.closedAt ? <section data-testid="planning-create-task" className="rounded-xl border border-dashed p-4"><div className="flex flex-wrap items-center justify-between gap-3"><div><p className="text-xs font-medium text-muted-foreground">Ingen arbetsorder</p><p className="mt-1 text-sm">{selected.projectId ? "Skapa arbetsordern direkt i projektet." : "Skapa en arbetsorder för arbetet."}</p></div><Button asChild size="sm"><Link href={subPage(`/?view=workflow_task&taskType=WORK_ORDER${selected.projectId ? `&projectId=${encodeURIComponent(selected.projectId)}` : ""}`)}><Plus />Ny arbetsorder</Link></Button></div></section> : null}{selected.description ? <div><p className="text-xs font-medium text-muted-foreground">Beskrivning</p><p className="mt-1 whitespace-pre-wrap text-sm">{selected.description}</p></div> : null}<details className="rounded-xl border bg-muted/20 p-3"><summary className="cursor-pointer text-xs font-medium">Historik ({selected.eventCount ?? selected.events?.length ?? 0})</summary>{(selected.eventCount ?? 0) > (selected.events?.length ?? 0) ? <p className="mt-2 text-xs text-muted-foreground">Visar de {selected.events?.length} senaste händelserna.</p> : null}{selected.events?.length ? <ol className="mt-3 space-y-2 text-xs">{selected.events.map((event) => <li key={event.id} className="flex flex-wrap justify-between gap-x-3 gap-y-1"><span>{event.summary}{event.actorName ? ` · ${event.actorName}` : ""}</span><span className="text-muted-foreground">{formatDateTime(event.createdAt)}</span></li>)}</ol> : <p className="mt-2 text-xs text-muted-foreground">Ingen historik är tillgänglig för den här aktiviteten.</p>}</details>{canEdit(selected) ? <div className="flex flex-wrap justify-end gap-2 border-t pt-4"><Button type="button" variant="outline" onClick={() => { onEdit(selected); setSelected(null); }}><Pencil />Redigera</Button><Button type="button" variant="destructive" onClick={() => { onDelete(selected); setSelected(null); }}><Trash2 />Ta bort</Button></div> : <p className="text-xs text-muted-foreground">Du har läsbehörighet till planeringen men saknar behörighet att ändra den.</p>}<p className="text-xs text-muted-foreground">Planerad tid är inte rapporterad tid.</p></div> : null}
    </Modal>
    <Modal open={Boolean(selectedRound)} onOpenChange={(open) => { if (!open) setSelectedRound(null); }} title="Driftrond" className="max-w-lg">
      {selectedRound ? <div className="space-y-4" data-testid="planning-round-details"><div><div className="flex flex-wrap items-center gap-2"><p className="text-base font-semibold">{selectedRound.title}</p><Badge variant="outline" className={indicatorBadge(planningRoundTone(selectedRound.state))}>{PLANNING_ROUND_STATE_LABEL[selectedRound.state]}</Badge></div>
        <p className="mt-1 text-sm text-muted-foreground">{formatSwedish(`${selectedRound.date}T12:00:00`, { weekday: "long", day: "numeric", month: "long", year: "numeric" })} · {selectedRound.ruleText}</p></div>
        <dl className="grid gap-3 rounded-xl border bg-muted/20 p-4 text-sm"><div><dt className="text-xs font-medium text-muted-foreground">Formulär</dt><dd className="mt-1">{selectedRound.templateName || "—"}</dd></div>{selectedRound.facilityName || selectedRound.customerName ? <div><dt className="text-xs font-medium text-muted-foreground">Plats</dt><dd className="mt-1">{[selectedRound.facilityName, selectedRound.customerName].filter(Boolean).join(" · ")}</dd></div> : null}{selectedRound.projectName ? <div><dt className="text-xs font-medium text-muted-foreground">Projekt</dt><dd className="mt-1">{selectedRound.projectName}</dd></div> : null}<div><dt className="text-xs font-medium text-muted-foreground">Ansvarig</dt><dd className="mt-1">{selectedRound.assignedToName || "Ingen vald"}</dd></div></dl>
        <p className="text-xs text-muted-foreground">Tillfället ändras bara under Driftronder.{selectedRound.state !== "done" && !selectedRound.taskId && !selectedRound.formNotice ? " Ronden kan startas redan nu." : ""}</p>
        <div className="flex flex-wrap justify-end gap-2 border-t pt-4"><Button asChild variant="outline"><Link href="/?view=rounds">Alla driftronder</Link></Button><PlanningRoundAction round={selectedRound} /></div></div> : null}
    </Modal>
  </Panel>;
}

/**
 * Att boka (2026-11-02): dated work orders nobody has booked yet (awaitsBooking, lib/overview/team-followup.ts), the soonest
 * first and each with Boka. Without it a work order of 17–19 Nov with no booking is in neither Kalender nor Kapacitet.
 */
/**
 * What a person's part of a booking counts as, in Planeringsdetaljer. A member is not sent a colleague's weekly time (2026-11-02),
 * so without it only given hours can be a number; a figure on 40 h would be wrong for a 32 h week.
 */
function assignmentLoadText(activity: PlannedActivity, assignment: { userId: string; plannedMinutes: number | null; startsAt: string | null }, weekly: number | null | undefined) {
  if (weekly !== null && weekly !== undefined) return formatMinutes(assignmentLoadMinutes(activity, assignment.userId, weekly));
  return assignment.plannedMinutes !== null && !assignment.startsAt ? formatMinutes(assignment.plannedMinutes) : "bokad tid, högst arbetstiden per dag";
}

function PlanningToBook({ read, rows, href, shown, onMore }: { read: { total: number; rows: ToBookRow[]; failed?: boolean } | null; rows: ToBookRow[]; href: (id: string) => string; shown: number; onMore: () => void }) {
  const description = !read ? "Hämtar…" : read.failed ? "Listan kunde inte hämtas." : !read.total ? "Inga arbetsordrar väntar på bokning."
    : rows.length ? `${rows.length} ${rows.length === 1 ? "arbetsorder" : "arbetsordrar"} utan bokning` : "Ingen arbetsorder utan bokning i urvalet.";
  return <div id="planning-part-to-book" className="space-y-6">
    <Panel icon={CalendarPlus} collapsible defaultCollapsed foldKey="planning-to-book" title="Att boka" description={description}>
      {rows.length ? <ol data-testid="planning-to-book-list" className="divide-y rounded-xl border">{rows.slice(0, shown).map((row) => <li key={row.id} data-testid="planning-to-book-row" className="flex flex-wrap items-center gap-3 p-4">
        <div className="min-w-0 flex-1 basis-48">
          <div className="flex flex-wrap items-center gap-2">
            <Link href={row.href} className="text-sm font-semibold [overflow-wrap:anywhere] hover:text-primary hover:underline">{row.title}</Link>
            {row.lateStart ? <Badge variant="outline" className={indicatorBadge("warning")}>Försenad start</Badge> : null}
            {!row.assignedToUserId ? <Badge variant="outline" className={indicatorBadge("neutral")}>Ingen ansvarig</Badge> : null}
          </div>
          <p className="mt-1 text-xs text-muted-foreground">{[jobPeriodLabel(row), row.assignedToName, row.customerName, row.projectName].filter(Boolean).join(" · ")}</p>
        </div>
        <Button asChild size="sm" variant="outline"><Link href={href(row.id)} data-testid="planning-to-book-action" aria-label={`Boka ${row.title}`}>Boka</Link></Button>
      </li>)}</ol> : <p className="text-sm text-muted-foreground">{description}</p>}
      {rows.length ? <ShowMore shown={Math.min(shown, rows.length)} total={rows.length} onMore={onMore} /> : null}
      {read && read.total > read.rows.length ? <p className="mt-2 text-xs text-muted-foreground">Visar de {read.rows.length} första av {read.total}.</p> : null}
    </Panel>
  </div>;
}

/**
 * A panel with nothing to show, folded to its header line (2026-10-08): the title, one short sentence and at most one
 * action, so the empty parts of a long page do not push the rest down. It keeps the panel's look and heading.
 */
function EmptyPanelLine({ title, text, icon, action, testId }: { title: string; text: string; icon?: React.ReactNode; action?: React.ReactNode; testId?: string }) {
  return <section aria-label={title} className="rounded-xl border bg-card shadow-xs">
    <div className="panel-header flex flex-wrap items-center gap-x-3 gap-y-2 rounded-xl px-5 py-3">
      {icon ? <span className="area-icon panel-icon" data-tone="solid" aria-hidden="true">{icon}</span> : null}
      <h2 className="section-title">{title}</h2>
      <p className="min-w-0 flex-1 basis-60 text-sm text-muted-foreground" data-testid={testId}>{text}</p>
      {action}
    </div>
  </section>;
}

/** Bookings shown at a time on the project page (levels 2–3). */
const BOOKING_PAGE = 5;

function PlanningPanel({ project, tasks, activities, busy, canCreate, canEdit, onRemove, aiAction }: {
  /** "Föreslå planering" from Workflow AI, where the company's AI is on. */
  aiAction?: React.ReactNode;
  canFrameException?: (project: WorkflowProject) => boolean;
  project: WorkflowProject;
  tasks: WorkflowTask[];
  activities: PlannedActivity[];
  members: ProjectMember[];
  busy: boolean;
  error: string;
  canCreate: boolean;
  canEdit: (activity: PlannedActivity) => boolean;
  onSave: (input: PlannedActivityInput) => Promise<{ id: string; version: number }>;
  onRemove: (id: string, version: number) => Promise<void>;
}) {
  // Ny planering / Redigera planering are pages of their own (plan 1O): the project page reads `&new=1` and `&activityId=…&edit=1`.
  const router = useRouter();
  const planHref = `/?view=project&projectId=${encodeURIComponent(project.id)}`;
  const [confirmCard, confirmElement] = useConfirm();
  const budgetSummary = summarizeProjectBudget(project.timeBudgetMinutes, projectReportedSec(project, tasks));
  const openCreate = () => router.push(`${planHref}&new=1`);
  const openEdit = (activity: PlannedActivity) => router.push(`${planHref}&activityId=${encodeURIComponent(activity.id)}&edit=1`);
  // Nivå 1 på mobil (2026-10-09): the bookings as the phone's grouped rows under the panel, by day (I dag, Denna
  // vecka, Senare; past ones last as Tidigare); a row opens the same form as the pencil (for whoever may change it).
  const native = useNativeMode();
  // A few bookings at a time with Visa fler (the fold rule, 2026-11-02).
  const [activityRows, setActivityRows] = useState(BOOKING_PAGE);
  const today = swedishDayKey(new Date());
  const nativeList = native ? <div className="pt-1" data-testid="planned-activity-list">
    {canCreate ? <NativeActions><Button type="button" variant="ghost" onClick={openCreate} data-testid="native-planning-new"><CalendarPlus />Ny planering</Button></NativeActions> : null}
    {activities.length ? groupByDate(activities.slice().sort((left, right) => left.startsAt.localeCompare(right.startsAt)), (activity) => swedishDayKey(activity.startsAt), today, () => false)
      .map((group) => <ListGroup key={group.key} title={group.label}>{group.items.map((activity) => <ListRow key={activity.id} type="time" icon={CalendarClock} title={activity.title} testId="native-planned-activity"
        subtitle={[`${formatSwedish(activity.startsAt, { weekday: "short", day: "numeric", month: "short" })} ${formatSwedish(activity.startsAt, { hour: "2-digit", minute: "2-digit" })}–${formatSwedish(activity.endsAt, { hour: "2-digit", minute: "2-digit" })}`, activity.assignedToName].filter(Boolean).join(" · ")}
        pill={activity.status === "PLANNED" ? null : { label: activity.status === "COMPLETED" ? "Slutförd" : activity.status === "CANCELED" ? TASK_CANCEL_LABEL : "Pågår", tone: statusTone(activity.status) }}
        onClick={canEdit(activity) ? () => openEdit(activity) : undefined} />)}</ListGroup>)
      : <ListGroup><ListEmpty>Inga aktiviteter är planerade ännu.</ListEmpty></ListGroup>}
  </div> : null;
  const panel = <Panel icon={CalendarCheck} title="Bokningar och tidsbudget" description="Planerad och rapporterad tid hålls isär." actions={aiAction}>
    {confirmElement}
    <div className="grid gap-3 sm:grid-cols-3">
      <div className="rounded-xl border bg-muted/40 p-4"><p className="text-xs font-medium text-muted-foreground">Tidsbudget</p><p className="mt-1 text-xl font-semibold">{budgetSummary.hasBudget ? formatMinutes(budgetSummary.budgetMinutes) : "Inte angiven"}</p></div>
      <div className="rounded-xl border bg-muted/40 p-4"><p className="text-xs font-medium text-muted-foreground">Rapporterad tid totalt</p><p className="mt-1 text-xl font-semibold">{formatMinutes(budgetSummary.reportedMinutes)}</p></div>
      <div className={`rounded-xl border p-4 ${budgetSummary.isOverBudget ? indicatorBadge("danger") : "bg-muted/40"}`}><p className="text-xs font-medium opacity-80">{budgetSummary.isOverBudget ? "Överskriden budget" : "Återstår"}</p><p className="mt-1 text-xl font-semibold">{budgetSummary.hasBudget ? formatMinutes(budgetSummary.isOverBudget ? budgetSummary.overBudgetMinutes : budgetSummary.remainingMinutes) : "—"}</p></div>
    </div>
    {project.outsideFrameMinutes ? <p data-testid="project-time-outside-frame" className={cn("mt-3 flex items-start gap-2 rounded-lg border p-2.5 text-xs", indicatorBadge("warning"))}><AlertTriangle className="mt-0.5 size-3.5 shrink-0" />{formatMinutes(project.outsideFrameMinutes)} är rapporterat utanför projektets tidsram. Tiden räknas men bör stämmas av.</p> : null}
    {budgetSummary.hasBudget && <div className="mt-4"><div className="flex items-center justify-between gap-3 text-xs text-muted-foreground"><span>Rapporterad tid av budget</span><span className={budgetSummary.isOverBudget || budgetSummary.isHighUsage ? `font-semibold ${indicatorText(budgetTone(budgetSummary))}` : "font-medium text-foreground"}>{budgetSummary.percentUsed}%</span></div><div className="mt-2 h-2 overflow-hidden rounded-full bg-muted"><div className={`h-full rounded-full ${indicatorBar(budgetTone(budgetSummary))}`} style={{ width: `${budgetSummary.percentUsed}%` }} /></div></div>}
    {native ? null : <><div className="mt-6 flex flex-wrap items-center justify-between gap-3"><div><h3 className="text-sm font-semibold">Planerade aktiviteter</h3><p className="mt-1 text-xs text-muted-foreground">Bokningar för arbete och möten i projektet.</p></div>{canCreate && <Button onClick={openCreate}><CalendarPlus />Ny planering</Button>}</div>
    {activities.length ? <><ol data-testid="planned-activity-list" className="mt-4 divide-y rounded-xl border">{activities.slice().sort((left, right) => left.startsAt.localeCompare(right.startsAt)).slice(0, activityRows).map((activity) => <li key={activity.id} className="p-4"><div className="flex flex-wrap items-start gap-3"><span className="mt-0.5 flex size-9 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary"><Clock3 className="size-4" /></span><div className="min-w-0 flex-1"><div className="flex flex-wrap items-center gap-2"><p className="text-sm font-semibold">{activity.title}</p><Badge variant="outline" className={indicatorBadge(activity.status === "PLANNED" ? "info" : statusTone(activity.status))}>{activity.status === "COMPLETED" ? "Slutförd" : activity.status === "CANCELED" ? TASK_CANCEL_LABEL : activity.status === "IN_PROGRESS" ? "Pågår" : "Planerad"}</Badge></div><p className="mt-1 text-xs text-muted-foreground">{formatDateTime(activity.startsAt)} – {formatDateTime(activity.endsAt)}{activity.assignedToName ? ` · ${activity.assignedToName}` : ""}</p>{activity.description && <p className="mt-2 text-sm text-muted-foreground">{activity.description}</p>}{activity.events?.length ? <details className="mt-3 text-xs text-muted-foreground"><summary className="cursor-pointer font-medium text-foreground">Historik ({activity.eventCount ?? activity.events.length})</summary><ol className="mt-2 space-y-1">{activity.events.map((event) => <li key={event.id}>{event.summary} · {formatDateTime(event.createdAt)}{event.actorName ? ` · ${event.actorName}` : ""}</li>)}</ol></details> : null}</div>{canEdit(activity) && <div className="flex gap-1"><IconButton label={`Redigera ${activity.title}`} onClick={() => openEdit(activity)}><Pencil /></IconButton><RemoveButton label={`Ta bort ${activity.title}`} disabled={busy} onClick={async () => { if (await confirmCard({ title: "Ta bort planeringen?", message: `”${activity.title}” tas bort. Rapporterad tid påverkas inte.`, confirmLabel: "Ta bort", tone: "danger" })) void onRemove(activity.id, activity.version); }} /></div>}</div></li>)}</ol><ShowMore shown={Math.min(activityRows, activities.length)} total={activities.length} onMore={() => setActivityRows((value) => value + BOOKING_PAGE)} testId="planned-activity-more" /></> : <p className="mt-4 rounded-xl border border-dashed p-4 text-sm text-muted-foreground">Inga aktiviteter är planerade ännu. Planering påverkar inte rapporterad tid.</p>}</>}
  </Panel>;
  // M2 (2026-10-12): the phone shows the budget as three rows, not the desktop's measuring boxes and bar.
  const nativeBudget = native ? <ListGroup title="Tid och budget" testId="native-planning-budget">
    <ListRow type="time" title="Tidsbudget" value={budgetSummary.hasBudget ? formatMinutes(budgetSummary.budgetMinutes) : "Inte angiven"} />
    <ListRow type="time" title="Rapporterad tid" value={formatMinutes(budgetSummary.reportedMinutes)} />
    {budgetSummary.hasBudget ? <ListRow type="time" title={budgetSummary.isOverBudget ? "Överskriden budget" : "Återstår"} value={formatMinutes(budgetSummary.isOverBudget ? budgetSummary.overBudgetMinutes : budgetSummary.remainingMinutes)}
      pill={budgetSummary.isOverBudget ? { label: "Över budget", tone: "danger" } : null} /> : null}
  </ListGroup> : null;
  return native ? <>{confirmElement}{nativeBudget}{nativeList}</> : panel;
}

function PlannedActivityForm({ project, projects = [], projectRight = true, canBookTask = () => true, tasks, members, capacityRead, currentUserId, mayBookOthers, canFrameException = () => false, activity, defaultStartsAt, defaultEndsAt, bookJob, bookRefused = false, bookPeople, dayChosen = false, busy, error, onCancel, onSave }: { project?: WorkflowProject; projects?: WorkflowProject[];
  /** Without the project right a booking must be on a standalone job (planned-activity-access.ts). */
  projectRight?: boolean; canBookTask?: (task: WorkflowTask) => boolean; tasks: WorkflowTask[]; members: ProjectMember[];
  /** The one capacity count's read: the warnings for the booking's own days, on Kalender, the project page and the phone alike. */
  capacityRead: CapacityRead; currentUserId: string; mayBookOthers: (projectId?: string | null) => boolean; canFrameException?: (project: WorkflowProject) => boolean; activity?: PlannedActivity; defaultStartsAt?: Date; defaultEndsAt?: Date;
  /** Boka från jobbet (2026-11-02): the job the form opens filled in from; `bookRefused`: the address named a job that cannot be booked. */
  bookJob?: WorkflowTask; bookRefused?: boolean;
  /** The people picked in the work order's Tilldela (`bookPeople`, 2026-11-07), ticked from the start. */
  bookPeople?: string[];
  /** Opened by a click on a day: picking a job then keeps that day. */ dayChosen?: boolean; busy: boolean; error: string; onCancel: () => void; onSave: (input: PlannedActivityInput) => Promise<void> }) {
  // Nivå 1 på mobil (QA 2026-10-10): the same form as a phone's form screen – one level of grouping, short help, the
  // people as rows with large tick boxes and the job as a picker field that shows the whole name.
  const native = useNativeMode();
  const [frameExceptionReason, setFrameExceptionReason] = useState("");
  const [title, setTitle] = useState(activity?.title ?? bookJob?.title.slice(0, 200) ?? "");
  const [description, setDescription] = useState(activity?.description ?? "");
  const [kind, setKind] = useState<PlannedActivity["kind"]>(activity?.kind ?? "TASK");
  const [status, setStatus] = useState<PlannedActivity["status"]>(activity?.status ?? "PLANNED");
  const [startsAt, setStartsAt] = useState(activity ? localDateTimeValue(activity.startsAt) : defaultStartsAt ? localDateTimeValue(defaultStartsAt.toISOString()) : "");
  const [endsAt, setEndsAt] = useState(activity ? localDateTimeValue(activity.endsAt) : defaultEndsAt ? localDateTimeValue(defaultEndsAt.toISOString()) : "");
  const [selectedProjectId, setSelectedProjectId] = useState(activity?.projectId ?? project?.id ?? bookJob?.projectId ?? "");
  const [assignedToUserIds, setAssignedToUserIds] = useState<string[]>(activity?.assignedToUserIds.length ? activity.assignedToUserIds : activity?.assignedToUserId ? [activity.assignedToUserId] : bookJob ? jobPeople(bookJob, { memberIds: members.map((member) => member.id), selfId: currentUserId, mayBookOthers: mayBookOthers(bookJob.projectId), chosen: bookPeople }) : []);
  const [plannedMinutesByUserId, setPlannedMinutesByUserId] = useState<Record<string, string>>(() => Object.fromEntries((activity?.assignments ?? []).map((assignment) => [assignment.userId, assignment.plannedMinutes === null ? "" : String(Math.round((assignment.plannedMinutes / 60) * 100) / 100)])));
  const initialIndividualTimes = Object.fromEntries((activity?.assignments ?? []).map((assignment) => [assignment.userId, { startsAt: assignment.startsAt ? localDateTimeValue(assignment.startsAt) : "", endsAt: assignment.endsAt ? localDateTimeValue(assignment.endsAt) : "" }]));
  const [individualTimesByUserId, setIndividualTimesByUserId] = useState<Record<string, { startsAt: string; endsAt: string }>>(() => initialIndividualTimes);
  const individualTimesRef = useRef<Record<string, { startsAt: string; endsAt: string }>>(initialIndividualTimes);
  const [formError, setFormError] = useState("");
  const [externalAssigneeName, setExternalAssigneeName] = useState(activity && !activity.assignedToUserIds.length && !activity.assignedToUserId ? activity.assignedToName : "");
  const existingTask = activity?.workflowTaskId ? `workflow:${activity.workflowTaskId}` : bookJob ? `workflow:${bookJob.id}` : "";
  const [taskReference, setTaskReference] = useState(existingTask);
  const [jobQuery, setJobQuery] = useState("");
  // Slut follows Start (simulation 0.6.3): the booking keeps its length when the start moves.
  const lengthRef = useRef<number | null>(null);
  // What the person changed by hand is never overwritten when a job is picked (2026-11-02, jobFill).
  const touched = useRef({ people: false, start: false });
  const lastJob = useRef<WorkflowTask | null>(bookJob ?? null);
  const changeStart = (value: string) => {
    const previous = { start: inputInstant(startsAt).getTime(), end: inputInstant(endsAt).getTime() };
    if (Number.isFinite(previous.start) && Number.isFinite(previous.end) && previous.end > previous.start) lengthRef.current = previous.end - previous.start;
    setStartsAt(value);
    const end = endFollowingStart(previous, inputInstant(value).getTime(), lengthRef.current);
    if (end !== null) setEndsAt(localDateTimeValue(new Date(end).toISOString()));
  };
  const selectedProject = project ?? projects.find((candidate) => candidate.id === selectedProjectId);
  // A standalone job (2026-10-10, kartläggningen 5.11) can be booked without a project: its own open jobs the person may
  // edit, plus the one already linked.
  // Since Arbetsordern styr (2026-10-26) a booking is on a work order or a project, so only work orders are offered (2026-11-02), plus the job an old booking already holds.
  const bookableKind = (task: WorkflowTask) => task.kind === "WORK_ORDER" || task.id === activity?.workflowTaskId;
  const availableTasks = (project ? tasks : selectedProjectId ? tasks.filter((task) => task.projectId === selectedProjectId)
    : tasks.filter((task) => !task.projectId && ((isTaskOpen(task.status) && canBookTask(task)) || task.id === activity?.workflowTaskId))).filter(bookableKind);
  const jobRequired = !project && !selectedProjectId && !projectRight;
  // The job list (simulation 0.6.3: ~200 jobs in no order without a search): open jobs grouped by kind and sorted, the linked one
  // kept, and a search above a long list. One word through the flow (docs/begreppslista.md): Arbetsorder on the computer, Jobb only on the phone at level 1.
  const selectedJobId = taskReference.startsWith("workflow:") ? taskReference.slice("workflow:".length) : null;
  const openJobCount = availableTasks.filter((task) => isTaskOpen(task.status)).length;
  const jobGroups = planningJobGroups(availableTasks, { kindLabel: taskTypeLabel, selectedId: selectedJobId, query: jobQuery });
  const jobLabel = native ? (jobRequired ? "Jobb" : "Jobb (valfritt)") : jobRequired ? "Arbetsorder" : "Arbetsorder (valfritt)";
  const noJobLabel = selectedProjectId || project ? "Endast projektet" : native ? (jobRequired ? "Välj jobb" : "Inget jobb") : jobRequired ? "Välj arbetsorder" : "Ingen arbetsorder";
  const jobOptions = jobGroups.map((group) => <optgroup key={group.label} label={group.label}>{group.options.map((option) => <option key={option.id} value={`workflow:${option.id}`}>{option.label}</option>)}</optgroup>);
  const jobSearch = openJobCount >= PLANNING_JOB_SEARCH_FROM ? <span className="relative block font-normal"><Search aria-hidden="true" className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" /><Input type="search" value={jobQuery} onChange={(event) => setJobQuery(event.target.value)} placeholder={native ? "Sök jobb" : "Sök arbetsorder"} aria-label={native ? "Sök jobb att koppla" : "Sök arbetsorder att koppla"} className="pl-9" data-testid="planning-task-search" /></span> : null;
  // The project is the frame (2026-09-26): planning outside it is blocked unless the project's responsible or
  // an admin records a reason; ending after the task's "Klart senast" is only a warning.
  const [linkedKind, linkedId] = taskReference.split(":");
  const linkedTask = linkedId ? tasks.find((task) => task.id === linkedId && linkedKind === "workflow") : undefined;
  const frameProject = selectedProject ?? (linkedTask?.projectId ? projects.find((candidate) => candidate.id === linkedTask.projectId) : undefined);
  const previewInterval = { startsAt: inputInstant(startsAt), endsAt: inputInstant(endsAt) };
  const intervalValid = !Number.isNaN(previewInterval.startsAt.getTime()) && !Number.isNaN(previewInterval.endsAt.getTime()) && previewInterval.endsAt > previewInterval.startsAt;
  const intervalChanged = !activity || !intervalValid || previewInterval.startsAt.toISOString() !== activity.startsAt || previewInterval.endsAt.toISOString() !== activity.endsAt || (activity.projectId ?? "") !== (selectedProject?.id ?? "");
  const frameError = intervalValid && intervalChanged && !["COMPLETED", "CANCELED"].includes(status) ? planningFrameError(previewInterval, frameProject) : null;
  const mayMakeException = Boolean(frameProject && canFrameException(frameProject));
  const afterTaskDue = intervalValid && planningAfterTaskDue(previewInterval, linkedTask?.dueDate);
  // Why Skapa/Spara planering cannot be used yet, said in text and as a toast (simulation 0.6.3: a dead button).
  const saveReason = !title.trim() ? "Ange ett namn på planeringen först." : !startsAt || !endsAt ? "Ange start och slut." : !intervalValid ? "Slut måste vara efter start."
    : jobRequired && !taskReference ? (native ? "Välj jobb först." : "Välj arbetsorder först.")
    : frameError && !mayMakeException ? "Tiden ligger utanför projektets tidsram." : frameError && !frameExceptionReason.trim() ? "Skriv en motivering för undantaget först." : null;
  const knownAssigneeIds = new Set(members.map((member) => member.id));
  const hasPreservedCloudAssignee = assignedToUserIds.some((id) => !knownAssigneeIds.has(id));
  function toggleAssignee(userId: string) {
    touched.current.people = true;
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
      setPlannedMinutesByUserId((minutes) => ({ ...minutes, [userId]: String(Math.round(((individualEndsAt.getTime() - individualStartsAt.getTime()) / 3_600_000) * 100) / 100) }));
  }
  function clearIndividualPlan(userId: string) {
    setFormError("");
    const next = { ...individualTimesRef.current, [userId]: { startsAt: "", endsAt: "" } };
    individualTimesRef.current = next;
    setIndividualTimesByUserId(next);
    setPlannedMinutesByUserId((current) => ({ ...current, [userId]: "" }));
  }
  // Warnings before saving (2026-11-02): the one count's read for the booking's own days, read again only when those days change. The last answer stays meanwhile, and a failure means no warning.
  const readFrom = intervalValid ? swedishDayKey(previewInterval.startsAt) : "";
  const readTo = intervalValid ? swedishDayKey(new Date(previewInterval.endsAt.getTime() - 1)) : "";
  const [capacityAnswer, setCapacityAnswer] = useState<Awaited<ReturnType<CapacityRead>> | null>(null);
  const capacityReader = useRef(capacityRead);
  useEffect(() => { capacityReader.current = capacityRead; });
  useEffect(() => {
    if (!readFrom) return;
    let current = true;
    capacityReader.current({ from: readFrom, to: readTo }).then((answer) => { if (current) setCapacityAnswer(answer); }, () => undefined);
    return () => { current = false; };
  }, [readFrom, readTo]);
  // The person's weekly time when it is known: a member's reply holds only their own row, and a figure on 40 h would be wrong for a colleague.
  const weeklyFor = (userId: string) => capacityAnswer?.data.members.find((member) => member.id === userId)?.weeklyWorkMinutes;
  const previewId = activity?.id ?? "planning-preview";
  const preview: (CapacityActivity & { id: string; title: string }) | null = intervalValid ? {
    id: previewId, title: title.trim() || "Den här planeringen", status,
    startsAt: inputInstant(startsAt).toISOString(), endsAt: inputInstant(endsAt).toISOString(), projectId: null,
    workflowTaskId: linkedTask?.id ?? null, workflowTask: linkedTask ? { status: linkedTask.status } : null,
    assignedToUserId: assignedToUserIds[0] ?? null, assignedToUserIds,
    assignments: assignedToUserIds.map((userId) => {
      const individual = individualTimesByUserId[userId];
      const individualStartsAt = individual?.startsAt ? inputInstant(individual.startsAt) : null;
      const individualEndsAt = individual?.endsAt ? inputInstant(individual.endsAt) : null;
      const hasValidIndividualInterval = Boolean(individualStartsAt && individualEndsAt && !Number.isNaN(individualStartsAt.getTime()) && !Number.isNaN(individualEndsAt.getTime()) && individualEndsAt > individualStartsAt);
      const typedHours = Number((plannedMinutesByUserId[userId] ?? "").trim().replace(",", "."));
      return { userId, plannedMinutes: !hasValidIndividualInterval && typedHours > 0 ? Math.round(typedHours * 60) : null, startsAt: hasValidIndividualInterval ? individualStartsAt!.toISOString() : null, endsAt: hasValidIndividualInterval ? individualEndsAt!.toISOString() : null };
    }),
  } : null;
  const previewConflictsByUserId = new Map<string, ReturnType<typeof summarizeAvailability>["conflicts"]>();
  if (preview && capacityAnswer) {
    const { data, rounds } = capacityAnswer;
    const person = (userId: string) => data.members.find((member) => member.id === userId);
    const loads = capacityLoads([...data.activities.filter((item) => item.id !== previewId), preview], rounds);
    for (const conflict of summarizeAvailability(loads, { weeklyWorkMinutesFor: (userId) => person(userId)?.weeklyWorkMinutes, noFixedHoursFor: (userId) => person(userId)?.noFixedHours, absences: data.absences }).conflicts) {
      if (!data.canViewTeam && conflict.userId !== currentUserId) continue;
      if (!conflictInvolves(conflict, previewId)) continue;
      previewConflictsByUserId.set(conflict.userId, [...(previewConflictsByUserId.get(conflict.userId) ?? []), conflict]);
    }
  }
  // What the fold holds, in a line while it is shut. It starts open on a booking that uses any of it.
  const showStatus = !linkedTask || (Boolean(activity) && activity?.status !== "PLANNED");
  const hasOwnHours = assignedToUserIds.some((userId) => plannedMinutesByUserId[userId]?.trim() || individualTimesByUserId[userId]?.startsAt || individualTimesByUserId[userId]?.endsAt);
  const [moreOpen, setMoreOpen] = useState(() => Boolean(hasOwnHours || kind !== "TASK" || description || externalAssigneeName || (activity && showStatus && activity.status !== "PLANNED")));
  const moreSummary = [hasOwnHours ? "Egna timmar" : "", kind !== "TASK" ? planningKindLabel(kind) : "", showStatus && status !== "PLANNED" ? planningStatusLabel(status) : "", description.trim() ? "Beskrivning" : "", !assignedToUserIds.length ? externalAssigneeName.trim() : ""].filter(Boolean).join(" · ");
  // Picking a job fills in what it knows, and what the person typed wins (2026-11-02). Only a new booking; Ingen arbetsorder leaves everything as it is.
  const pickJob = (reference: string) => {
    setTaskReference(reference);
    const job = reference.startsWith("workflow:") ? tasks.find((task) => task.id === reference.slice("workflow:".length)) : undefined;
    if (!job || activity) return;
    const fill = jobFill(job, { previous: lastJob.current, title, touched: touched.current, dayChosen, memberIds: members.map((member) => member.id), selfId: currentUserId, mayBookOthers: mayBookOthers(job.projectId ?? selectedProjectId), today: swedishDayKey(new Date()) });
    lastJob.current = job;
    setStatus("PLANNED");
    if (fill.title !== undefined) setTitle(fill.title);
    if (fill.assignedToUserIds) setAssignedToUserIds(fill.assignedToUserIds);
    if (fill.startDay) { const day = fromSwedishDateInput(fill.startDay); if (day) changeStart(localDateTimeValue(planningDefaultInterval(day).startsAt.toISOString())); }
  };
  const hoursPerPerson = <div className={native ? "space-y-2" : "rounded-xl border p-4"} data-testid="planning-hours-per-person">
    <p className="text-xs font-medium text-muted-foreground">Timmar per person{native ? null : <span className="font-normal"> (tomt = bokad tid, högst arbetstiden per arbetsdag)</span>}</p>
    <p className="mt-1 text-xs text-muted-foreground">{native ? "Valfritt. Tomt fält räknas som bokad tid, högst arbetstiden per arbetsdag." : "Valfritt: bokade timmar eller egna klockslag."}</p>
    <div className="mt-3 space-y-3">{members.filter((member) => assignedToUserIds.includes(member.id)).map((member) => { const individualTimes = individualTimesByUserId[member.id] ?? { startsAt: "", endsAt: "" }; const hasIndividualTimes = Boolean(individualTimes.startsAt || individualTimes.endsAt); return <div key={member.id} role="group" aria-label={member.name} className="field-group rounded-lg border p-3"><p className="mb-2 text-sm font-semibold text-foreground">{member.name}</p><div className="grid gap-3 sm:grid-cols-3"><label className="block text-xs font-medium text-muted-foreground">Bokade timmar<Input aria-label={`Bokade timmar för ${member.name}`} type="number" inputMode="decimal" min="0.25" step="0.25" value={plannedMinutesByUserId[member.id] ?? ""} onChange={(event) => setPlannedMinutesByUserId((current) => ({ ...current, [member.id]: event.target.value }))} placeholder={preview && weeklyFor(member.id) !== undefined ? formatMinutes(assignmentLoadMinutes({ ...preview, assignments: [{ userId: member.id, plannedMinutes: null, startsAt: null, endsAt: null }] }, member.id, weeklyFor(member.id))) : "Bokad tid"} disabled={hasIndividualTimes} className="mt-1" /></label><label className="block text-xs font-medium text-muted-foreground">Individuell start<Input aria-label={`Individuell start för ${member.name}`} type="datetime-local" min={startsAt} max={endsAt} value={individualTimes.startsAt} onChange={(event) => updateIndividualTime(member.id, "startsAt", event.target.value)} className="mt-1" /></label><label className="block text-xs font-medium text-muted-foreground">Individuellt slut<Input aria-label={`Individuellt slut för ${member.name}`} type="datetime-local" min={startsAt} max={endsAt} value={individualTimes.endsAt} onChange={(event) => updateIndividualTime(member.id, "endsAt", event.target.value)} className="mt-1" /></label></div><div className="mt-2 flex flex-wrap items-center justify-between gap-2"><p className="text-xs text-muted-foreground">{hasIndividualTimes ? "Individuell tid räknas som deltagarens planerade belastning." : preview ? `Räknas som ${weeklyFor(member.id) !== undefined || plannedMinutesByUserId[member.id]?.trim() ? formatMinutes(assignmentLoadMinutes(preview, member.id, weeklyFor(member.id))) : "bokad tid, högst arbetstiden per dag"}.` : ""}</p>{hasIndividualTimes || plannedMinutesByUserId[member.id] ? <Button type="button" size="sm" variant="ghost" onClick={() => clearIndividualPlan(member.id)}>Återställ full bokning</Button> : null}</div></div>; })}</div>
  </div>;
  return <form className="space-y-5" onSubmit={(event) => {
    event.preventDefault();
    setFormError("");
    const activityStartsAt = inputInstant(startsAt); const activityEndsAt = inputInstant(endsAt);
    if (Number.isNaN(activityStartsAt.getTime()) || Number.isNaN(activityEndsAt.getTime())) { setFormError("Ange giltig start och slut."); return; }
    const assignments = [] as PlannedActivityInput["assignments"];
    for (const userId of assignedToUserIds) {
      const existing = activity?.assignments.find((assignment) => assignment.userId === userId);
      const individualTimes = individualTimesByUserId[userId] ?? { startsAt: existing?.startsAt ? localDateTimeValue(existing.startsAt) : "", endsAt: existing?.endsAt ? localDateTimeValue(existing.endsAt) : "" };
      if (Boolean(individualTimes.startsAt) !== Boolean(individualTimes.endsAt)) { setMoreOpen(true); setFormError("Individuell start och slut måste anges tillsammans."); return; }
      if (individualTimes.startsAt && individualTimes.endsAt) {
        const individualStartsAt = inputInstant(individualTimes.startsAt); const individualEndsAt = inputInstant(individualTimes.endsAt);
        if (Number.isNaN(individualStartsAt.getTime()) || Number.isNaN(individualEndsAt.getTime()) || individualEndsAt <= individualStartsAt || individualStartsAt < activityStartsAt || individualEndsAt > activityEndsAt) { setMoreOpen(true); setFormError("Individuell tid måste ligga inom aktivitetens tidsintervall."); return; }
        assignments.push({ userId, plannedMinutes: Math.round((individualEndsAt.getTime() - individualStartsAt.getTime()) / 60_000), startsAt: individualStartsAt.toISOString(), endsAt: individualEndsAt.toISOString() });
      } else {
        // The form asks in hours (steg 1, 2026-10-09); the booking stores minutes.
        const rawHours = plannedMinutesByUserId[userId]?.trim().replace(",", ".") ?? "";
        const minutes = rawHours ? Math.round(Number(rawHours) * 60) : null;
        if (minutes !== null && (!Number.isFinite(minutes) || minutes <= 0)) { setMoreOpen(true); setFormError("Bokade timmar måste vara ett tal större än noll."); return; }
        assignments.push({ userId, plannedMinutes: minutes, startsAt: null, endsAt: null });
      }
    }
    const [referenceKind, referenceId] = taskReference.split(":");
    const internalNames = assignedToUserIds.map((id) => members.find((member) => member.id === id)?.name).filter(Boolean).join(", ");
    void onSave({ id: activity?.id, version: activity?.version, title, description, kind, status,
      startsAt: activityStartsAt.toISOString(), endsAt: activityEndsAt.toISOString(), projectId: selectedProject?.id ?? null,
      workflowTaskId: referenceKind === "workflow" ? referenceId : null,
      assignedToUserId: assignedToUserIds[0] ?? null, assignedToUserIds, assignedToName: internalNames || externalAssigneeName,
      assignments, frameExceptionReason: frameError ? frameExceptionReason.trim() : "",
    });
  }}>
    <FormPanel title="Planeringsuppgifter">
    {/* The order of the work (2026-11-02): job, name, time, people. The rest folds away. */}
    {bookRefused ? <p data-testid="planning-book-refused" className={cn("flex items-start gap-2 rounded-lg border p-3 text-xs", indicatorBadge("warning"))}><AlertTriangle className="mt-0.5 size-4 shrink-0" />Arbetsordern går inte att boka härifrån. Välj en annan.</p> : null}
    <div className="@container"><div className={cn("grid gap-4", !project && "@md:grid-cols-2")}>
    {!project ? <label className="block space-y-2 text-xs font-medium text-muted-foreground">Projekt (valfritt)<select aria-label="Projekt för planering" className="form-select" value={selectedProjectId} onChange={(event) => { setSelectedProjectId(event.target.value); setTaskReference(""); }}><option value="">Utan projekt</option>{projects.map((candidate) => <option key={candidate.id} value={candidate.id}>{candidate.name}</option>)}</select></label> : null}
    <label className="block space-y-2 text-xs font-medium text-muted-foreground">{jobLabel}{jobSearch}{native ? <span className="native-picker-field font-normal text-foreground">
      <span className="min-w-0 flex-1 text-[0.9375rem] [overflow-wrap:anywhere]">{linkedTask ? <>{linkedTask.title}<span className="block text-xs text-muted-foreground">{taskTypeLabel(linkedTask)}</span></> : noJobLabel}</span>
      <ChevronsUpDown aria-hidden="true" className="size-4 shrink-0 text-muted-foreground/70" />
      <select data-testid="planning-task-select" aria-label={jobLabel} value={taskReference} onChange={(event) => pickJob(event.target.value)} required={jobRequired}><option value="">{noJobLabel}</option>{jobOptions}</select>
    </span> : <select className="form-select" data-testid="planning-task-select" aria-label={jobLabel} value={taskReference} onChange={(event) => pickJob(event.target.value)} required={jobRequired}><option value="">{noJobLabel}</option>{jobOptions}</select>}{jobQuery && !jobGroups.length ? <span className="block font-normal text-muted-foreground">{native ? "Inget öppet jobb matchar sökningen." : "Ingen öppen arbetsorder matchar sökningen."}</span> : null}</label>
    </div></div>
    <label className="block space-y-2 text-xs font-medium text-muted-foreground">Namn<Input value={title} onChange={(event) => setTitle(event.target.value)} maxLength={200} required autoFocus={!bookJob} /></label>
    <div className="grid gap-4 sm:grid-cols-2"><label className="block space-y-2 text-xs font-medium text-muted-foreground">Start<Input type="datetime-local" value={startsAt} onChange={(event) => { touched.current.start = true; changeStart(event.target.value); }} required /></label><label className="block space-y-2 text-xs font-medium text-muted-foreground">Slut<Input type="datetime-local" value={endsAt} onChange={(event) => setEndsAt(event.target.value)} required /></label></div>
    {/* The job's own dates stay in view (2026-11-02): a booking is short by default, and the person should see the period it belongs to. */}
    {linkedTask && jobPeriodLabel(linkedTask) ? <p data-testid="planning-job-period" className="-mt-2 text-xs text-muted-foreground">{native ? "Jobbet" : "Arbetsordern"}: {jobPeriodLabel(linkedTask)}</p> : null}
    {native ? <div role="group" aria-labelledby="planning-people-label" data-testid="planning-people">
      <p id="planning-people-label" className="text-xs font-medium text-muted-foreground">Bokad personal</p>
      {/* The people as rows of a list with large tick boxes (44 px rows), not boxes in a box. */}
      <div className="mt-1.5 divide-y rounded-lg border">{members.map((member) => <label key={member.id} className="flex min-h-11 items-center gap-3 px-3 py-2 text-[0.9375rem]"><input type="checkbox" className="size-5 shrink-0 accent-[var(--primary)]" checked={assignedToUserIds.includes(member.id)} onChange={() => toggleAssignee(member.id)} />{member.name}</label>)}</div>
      <p className="mt-1.5 text-xs text-muted-foreground">Ingen markerad betyder att ingen är bokad än.</p>
      {hasPreservedCloudAssignee ? <p className="mt-1.5 text-xs text-muted-foreground">Kopplingen från Cloud saknar en lokal medlem och kan inte ändras här.</p> : null}
    </div> : <fieldset className="field-group rounded-xl border p-4"><legend className="px-1 text-xs font-medium text-muted-foreground">Bokad personal</legend><p className="mb-3 text-xs text-muted-foreground">Ingen markerad betyder att ingen är bokad än.</p><div className="grid gap-2 sm:grid-cols-2">{members.map((member) => <label key={member.id} className="flex items-center gap-2 rounded-lg border px-3 py-2 text-sm"><input type="checkbox" checked={assignedToUserIds.includes(member.id)} onChange={() => toggleAssignee(member.id)} />{member.name}</label>)}</div>{hasPreservedCloudAssignee ? <p className="mt-3 text-xs text-muted-foreground">Kopplingen från Cloud saknar en lokal medlem och kan inte ändras här.</p> : null}</fieldset>}
    {/* The warnings stand after the people, where the last thing changed is, with nothing important below them. */}
    {assignedToUserIds.length ? <div className="space-y-2">{members.filter((member) => assignedToUserIds.includes(member.id)).map((member) => {
      const conflicts = previewConflictsByUserId.get(member.id) ?? [];
      return conflicts.length ? <div key={member.id} data-testid="planning-preview-conflict" className="flex gap-2 rounded-lg border border-amber-200 bg-amber-50/60 p-3 text-xs text-amber-950 dark:border-amber-900 dark:bg-amber-950/30 dark:text-amber-100"><AlertTriangle className="mt-0.5 size-4 shrink-0 text-amber-600 dark:text-amber-300" /><div><p className="font-medium">Tidskrock i planeringen för {member.name}</p><p className="mt-1">Varningen stoppar inte sparandet.</p>{conflicts.map((conflict) => <p key={`${conflict.kind}-${conflict.first.activityId}-${conflict.second.activityId}-${conflict.startsAt}`} className="mt-1">{conflictLine(conflict, previewId)}</p>)}</div></div> : null;
    })}</div> : null}
    {frameError ? <div data-testid="planning-frame-error" className={cn("space-y-2 rounded-lg border p-3 text-xs", indicatorBadge(mayMakeException ? "warning" : "danger"))}><p className="flex items-start gap-2 font-medium"><AlertTriangle className="mt-0.5 size-4 shrink-0" />{frameError}</p>{mayMakeException ? <label className="block space-y-1 font-medium">Motivering för undantag (loggas)<textarea className="form-textarea min-h-16 bg-card text-foreground" value={frameExceptionReason} onChange={(event) => setFrameExceptionReason(event.target.value)} maxLength={500} required /></label> : <p>Ändra tiden så att den ligger inom projektets tidsram, eller be projektansvarig om undantag.</p>}</div> : null}
    {afterTaskDue ? <p data-testid="planning-after-task-due" className={cn("flex items-start gap-2 rounded-lg border p-3 text-xs", indicatorBadge("warning"))}><AlertTriangle className="mt-0.5 size-4 shrink-0" />Planeringen slutar efter arbetsorderns Klart senast ({linkedTask?.dueDate}). Det är tillåtet men bör stämmas av.</p> : null}
    <CollapsibleSection title="Timmar, typ och beskrivning" summary={moreSummary} open={moreOpen} onOpenChange={setMoreOpen} testId="planning-more" className="rounded-xl">
      <div className="space-y-4">
        {assignedToUserIds.length ? hoursPerPerson : null}
        <div className={cn("grid gap-4", showStatus && "sm:grid-cols-2")}><label className="block space-y-2 text-xs font-medium text-muted-foreground">Typ<select className="form-select" value={kind} onChange={(event) => setKind(event.target.value as PlannedActivity["kind"])}><option value="TASK">Arbete</option><option value="MEETING">Möte</option><option value="DEADLINE">Milstolpe</option><option value="OTHER">Övrigt</option></select></label>{showStatus ? <label className="block space-y-2 text-xs font-medium text-muted-foreground">Status<select className="form-select" value={status} onChange={(event) => setStatus(event.target.value as PlannedActivity["status"])}><option value="PLANNED">Planerad</option><option value="IN_PROGRESS">Pågår</option><option value="COMPLETED">Slutförd</option><option value="CANCELED">{TASK_CANCEL_LABEL}</option></select></label> : null}</div>
        <label className="block space-y-2 text-xs font-medium text-muted-foreground">Beskrivning<textarea className="form-textarea" value={description} onChange={(event) => setDescription(event.target.value)} maxLength={2000} /></label>
        {!assignedToUserIds.length && <label className="block space-y-2 text-xs font-medium text-muted-foreground">Namn på extern person (valfritt)<Input value={externalAssigneeName} onChange={(event) => setExternalAssigneeName(event.target.value)} maxLength={160} placeholder="Exempelvis extern entreprenör" /></label>}
      </div>
    </CollapsibleSection>
    </FormPanel>
    {formError || error ? <p role="alert" className="text-sm text-destructive">{formError || error}</p> : null}<DialogActions cancel={{ onClick: onCancel }} primary={{ label: activity ? "Spara planering" : "Skapa planering", type: "submit", disabledReason: saveReason, describedBy: saveReason ? "planning-save-reason" : undefined, busy }}><DisabledReason id="planning-save-reason" reason={saveReason} className="mr-auto self-center" /></DialogActions>
  </form>;
}

type ProjectListControls = {
  personId: string; scopes: readonly WorkListScope[]; scope: WorkListScope; sort: WorkListSort; view: WorkListView; query: string;
  onScope: (scope: WorkListScope) => void; onSort: (sort: WorkListSort) => void; onView: (view: WorkListView) => void; onQuery: (query: string) => void;
  /** Local's tab (Cloud's is `remote.tab`), and Status within Pågående ("" = all; dashboard etapp 3). */
  tab: ProjectTab; onTab: (tab: ProjectTab) => void;
  status: ProjectAttention | ""; onStatus: (status: ProjectAttention | "") => void;
};

/** "Följer tidsramen" only while the project is ongoing and has a frame that has started. */
function projectAdherence(project: WorkflowProject, progress: number) {
  if (!projectStatusOf(project).ongoing) return null;
  const adherence = summarizeFrameAdherence({ startDate: project.startDate, dueDate: project.dueDate, completion: progress });
  if (!["ON_TRACK", "BEHIND", "OVERDUE"].includes(adherence.state)) return null;
  const tone: IndicatorTone = adherence.state === "OVERDUE" ? "danger" : adherence.state === "BEHIND" ? "warning" : "success";
  return <span data-testid="project-card-adherence" className={cn("font-medium", indicatorText(tone))}>{adherence.label}</span>;
}

/** A project's reported time: its work orders' and its own (Projekttid, 2026-10-26) – each entry has one owner, so nothing twice. */
const projectReportedSec = (project: { projectTimeSec?: number }, tasks: readonly { totalDurationSec?: number }[]) => tasks.reduce((sum, task) => sum + (task.totalDurationSec ?? 0), 0) + (project.projectTimeSec ?? 0);

/** A project in the shared list: the same columns as tasks, with people and time budget on the card. */
function projectListItem(project: WorkflowProject): WorkListItem {
  const status = projectStatusOf(project);
  const progress = projectProgress(project);
  const tasks = projectTasks(project);
  const budget = summarizeProjectBudget(project.timeBudgetMinutes, projectReportedSec(project, tasks));
  return {
    key: `PROJECT-${project.id}`,
    href: `/?view=project&projectId=${encodeURIComponent(project.id)}`,
    title: project.name,
    icon: "project",
    kindLabel: "Projekt",
    context: `${tasks.length} ${tasks.length === 1 ? "uppgift" : "uppgifter"}`,
    customer: customerTitle(project.customer) || "",
    place: project.facility?.name ?? "",
    responsible: project.responsibleName ?? "",
    date: project.dueDate ? { label: "Slutdatum", value: listDate(project.dueDate), ...(status.overdue ? { tone: "danger" as const } : {}) } : null,
    status: { label: status.label, tone: projectStatusTone(status) },
    progress: { percent: progress, tone: progressTone({ percent: progress }), note: projectAdherence(project, progress) },
    action: "Öppna",
    day: project.dueDate ?? "", open: !project.closedAt && !project.archivedAt, type: "project",
    // Name badges on the card and in the row (2026-10-22).
    people: projectPeopleOf(project),
    cardExtra: <div className="space-y-2">
      {budget.hasBudget ? <div><div className="flex justify-between gap-2 text-xs text-muted-foreground"><span>Rapporterat totalt</span><span className={budget.isOverBudget || budget.isHighUsage ? `font-semibold ${indicatorText(budgetTone(budget))}` : "font-medium text-foreground"}>{formatMinutes(budget.reportedMinutes)} av {formatMinutes(budget.budgetMinutes)}</span></div><div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-muted"><div className={`h-full rounded-full ${indicatorBar(budgetTone(budget))}`} style={{ width: `${budget.percentUsed}%` }} /></div><p data-testid="project-budget-remaining" className={cn("mt-1 text-right text-[11px]", budget.isOverBudget || budget.isHighUsage ? `font-semibold ${indicatorText(budgetTone(budget))}` : "text-muted-foreground")}>{budget.isOverBudget ? `${formatMinutes(budget.overBudgetMinutes)} över budget` : `${budget.isHighUsage ? "Hög förbrukning · " : ""}Återstår ${formatMinutes(budget.remainingMinutes)}`}</p></div>
        : <div data-testid="project-reported-total" className="flex justify-between gap-2 text-xs text-muted-foreground"><span>Rapporterat totalt</span><span><span className="font-medium text-foreground">{formatMinutes(budget.reportedMinutes)}</span> · ingen tidsbudget</span></div>}
    </div>,
  };
}

/**
 * Mina projekt on the shared list (2026-10-05). Cloud: the server pages one tab at a time for the chosen scope
 * and sort and counts the tabs where allowed; Local filters the open file with the same rules (everything in a Local
 * file is the owner's).
 */
function ProjectsPage({ projects, error, canCreate, remote, controls, pages }: { projects: WorkflowProject[]; error: string; canCreate: boolean; controls: ProjectListControls;
  remote?: { tab: ProjectTab; meta: ProjectListMeta | null; busy: boolean; onTab: (tab: ProjectTab) => void; onMore: () => void };
  pages: ProjectPages }) {
  // In the app the Projekt screen leads on to Planering and Projektstatistik (a computer has buttons in the page's head);
  // a page for a larger screen stays out at level 1 (Projektstatistik), as in Mer before.
  const native = useNativeMode();
  const content = useDetailLevel();
  const summary = pages.summary && !nativeHidesView(native, content, "project_summary");
  const planningHref = planningPageHref(pages);
  const nativeLinks = planningHref || summary ? <ListGroup testId="native-project-pages">
    {planningHref ? <ListRow type="project" icon={GanttChart} title="Planering" subtitle={pages.planning ? PROJECT_PAGE_SUBTITLE.project_planning : "Teamets kalender"} href={planningHref} testId="native-project-planning" /> : null}
    {summary ? <ListRow type="project" icon={BarChart3} title="Projektstatistik" subtitle={PROJECT_PAGE_SUBTITLE.project_summary} href="/?view=project_summary" testId="native-project-summary" /> : null}
  </ListGroup> : null;
  // Same tabs as the "Pågående projekt" key figure (2026-09-26): one status function decides where a project belongs.
  const [localShown, setLocalShown] = useState(1);
  const tab = remote?.tab ?? controls.tab;
  const tabOf = (project: WorkflowProject): ProjectTab => { const state = projectStatusOf(project).state; return state === "ARCHIVED" ? "archived" : state === "CLOSED" ? "closed" : "ongoing"; };
  // Status within Pågående (dashboard etapp 3): the key figure's rule, projectAttention; Cloud's server applies the same.
  const status = tab === "ongoing" ? controls.status : "";
  const attends = (project: WorkflowProject) => !status || tabOf(project) !== "ongoing" || projectAttention({ status: projectStatusOf(project), timeBudgetMinutes: project.timeBudgetMinutes ?? 0,
    reportedMinutes: Math.round(projectReportedSec(project, projectTasks(project)) / 60) }, status);
  const localResult = remote ? null : listWork(projects.filter(attends).map((project) => ({
    project, id: project.id, title: project.name, updatedAt: project.updatedAt, date: project.dueDate, mine: true,
    search: [project.name, project.description, project.customer?.name ?? "", project.customer?.company ?? "", project.responsibleName ?? ""],
  })), { filters: PROJECT_LIST_FILTERS, matches: (entry, value) => tabOf(entry.project) === value, filter: tab, scope: controls.scope, sort: controls.sort, q: controls.query, page: 1, limit: WORK_LIST_PAGE_SIZE * localShown });
  const visible = remote ? projects : localResult!.items.map((entry) => entry.project);
  const counts = remote ? remote.meta?.counts ?? null : localResult!.counts;
  const isEmpty = Boolean(counts && !controls.query && !status && PROJECT_LIST_FILTERS.every((value) => counts[value] === 0));
  const statusFilters: WorkListExtraFilter[] = tab === "ongoing" ? [{ key: "status", label: "Status", testId: "project-attention", className: "sm:w-48 sm:flex-none", value: status,
    options: [{ value: "", label: "Alla" }, ...PROJECT_ATTENTION.map((value) => ({ value, label: PROJECT_ATTENTION_LABEL[value] }))],
    onChange: (value) => { setLocalShown(1); controls.onStatus(allowedFilter(value, PROJECT_ATTENTION) ?? ""); } }] : [];
  return <WorkList
    list="projects" testId="project" title="Projekt" nativeLinks={nativeLinks}
    description={controls.scope === "all" ? "Alla projekt du har behörighet att se." : "Projekt där du är ansvarig, som du skapat eller där du har uppgifter."}
    create={canCreate ? { href: "/?view=new_project", label: "Nytt projekt" } : null}
    // Planering and Projektstatistik as buttons in the head (2026-10-30: no tab row on the page Projekt); Planering
    // opens its Tidplan, or its Kalender where there is no Tidplan (Local).
    actions={planningHref || pages.summary ? <>
      {planningHref ? <Button asChild variant="outline"><Link href={planningHref} data-testid="projects-planning-link"><GanttChart />Planering</Link></Button> : null}
      {pages.summary ? <Button asChild variant="outline"><Link href="/?view=project_summary" data-testid="projects-summary-link"><BarChart3 />Projektstatistik</Link></Button> : null}
    </> : undefined}
    scopes={controls.scopes} scope={controls.scope} onScope={controls.onScope}
    filterLabel="Visa projekt" filter={tab} onFilter={(value) => { setLocalShown(1); if (remote) remote.onTab(value); else controls.onTab(value); }}
    filters={PROJECT_LIST_FILTERS.map((value) => ({ value, label: PROJECT_FILTER_LABEL[value], count: counts ? counts[value] ?? 0 : null }))}
    query={controls.query} onQuery={(value) => { setLocalShown(1); controls.onQuery(value); }}
    searchLabel="Sök bland projekt" searchPlaceholder="Sök projekt, kund eller ansvarig"
    sort={controls.sort} onSort={controls.onSort} view={controls.view} onView={controls.onView}
    items={remote?.busy && !remote.meta ? null : visible.map(projectListItem)}
    total={remote ? remote.meta?.total ?? visible.length : localResult!.total}
    busy={Boolean(remote?.busy)} error={error}
    onMore={() => { if (remote) remote.onMore(); else setLocalShown((value) => value + 1); }}
    isEmpty={isEmpty} empty={<WorkspaceEmptyState kind="projects" />}
    extraFilters={statusFilters.length ? statusFilters : undefined}
  />;
}

/**
 * The link guide (2026-09-26, decision 7): shows what differs from the project's frame, with the project's
 * value preselected. A completed task is only moved; its content is never changed.
 */
function LinkGuide({ task, project, customers, members, plannedCount, busy, error, onBack, onConfirm }: { task: WorkflowTask & { fromProject?: string; plannedCount?: number }; project: WorkflowProject; customers: CustomerItem[]; members: ProjectMember[]; plannedCount: number; busy: boolean; error: string; onBack: () => void; onConfirm: (apply: LinkChoices) => void }) {
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
  // The same rule as the server's, so the guide says what will happen. A round's work order keeps its period.
  const keepsPeriod = Boolean(task.roundScheduleId);
  const chosenDue = dueOutside && useDueDate && !keepsPeriod ? project.dueDate : "";
  const startAfterLink = !completed && task.plannedStartDate ? datesOnProjectLink({ plannedStartDate: task.plannedStartDate, dueDate: task.dueDate ?? "", roundScheduleId: task.roundScheduleId }, { open: true, chosenDue, today: "", frame: { startDate: project.startDate ?? "", dueDate: project.dueDate ?? "" } }).plannedStartDate : undefined;
  const row = (label: string, from: string, to: string, checked: boolean, onChange: (value: boolean) => void, choice: string) => <div className="rounded-lg border bg-card p-3"><p className="text-xs font-medium text-muted-foreground">{label}</p><p className="mt-1 text-sm">Uppgiften: <strong>{from}</strong> · Projektet: <strong>{to}</strong></p>{completed ? null : <label className="mt-2 flex items-center gap-2 text-sm"><input type="checkbox" checked={checked} onChange={(event) => onChange(event.target.checked)} />{choice}</label>}</div>;
  return <div data-testid="link-guide" className="space-y-3">
    <p className="text-sm"><strong>{task.title}</strong> · {taskTypeLabel(task)}{task.fromProject ? ` · flyttas från projektet ${task.fromProject}` : ""}</p>
    {completed ? <p className={cn("rounded-lg border p-3 text-xs", indicatorBadge("info"))}>Uppgiften är färdigställd. Bara projektkopplingen ändras.</p> : null}
    {customerDiffers ? row("Kund", customerName(task.customerId), customerName(project.customerId), useCustomer, setUseCustomer, "Använd projektets kund") : null}
    {responsibleDiffers ? row("Ansvarig", memberName(task.assignedToUserId, task.assignedToName), memberName(project.responsibleUserId, project.responsibleName), useResponsible, setUseResponsible, "Använd projektansvarig") : null}
    {dueOutside && !keepsPeriod ? row("Klart senast", task.dueDate || "Inte angivet", `tidsram ${formatFrame(project as ProjectFrameLike)}`, useDueDate, setUseDueDate, `Sätt Klart senast till projektets slutdatum (${project.dueDate})`) : null}
    <ul className="space-y-1 rounded-lg border bg-muted/30 p-3 text-xs text-muted-foreground">
      {task.kind ? <li>{reportedMinutes ? `${formatMinutes(reportedMinutes)} redan rapporterad tid räknas mot projektets tid och budget.` : "Ingen tid är rapporterad på uppgiften ännu."}</li> : null}
      <li>{plannedCount ? `${plannedCount} ${plannedCount === 1 ? "planering följer" : "planeringar följer"} med uppgiften till projektet.` : "Uppgiften har ingen planering."}</li>
      {keepsPeriod && !completed ? <li data-testid="link-keeps-period">Rondens period behålls{dueOutside ? ", även utanför projektets tidsram" : ""}. Den ändras i arbetsordern.</li> : null}
      {startAfterLink ? <li data-testid="link-start-follows">Start flyttas till {startAfterLink}, så att den ligger inom projektets tidsram och inte efter Klart senast.</li> : null}
      <li>Kopplingen skrivs i projektets historik{task.fromProject ? " och i det tidigare projektets historik" : ""}.</li>
    </ul>
    {error ? <p role="alert" className="text-sm text-destructive">{error}</p> : null}
    <div className="flex flex-wrap justify-end gap-2"><Button type="button" variant="outline" onClick={onBack}>Tillbaka</Button><Button type="button" disabled={busy} onClick={() => onConfirm({ customer: customerDiffers ? useCustomer : true, responsible: responsibleDiffers && useResponsible, dueDate: chosenDue })}>{task.fromProject ? "Flytta till projektet" : "Koppla till projektet"}</Button></div>
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

/**
 * Projektets jobb (2026-10-08, Fas 4B): the work orders with the tasks that belong to them nested under each, then
 * the standalone tasks. Every row has the same fixed columns – the job, its step, its progress, the action – so they line
 * up from row to row and between a work order and its tasks (aligned rows, 2026-09-29); each list shows a bounded number
 * with "Visa fler".
 */
// Material i projektet (2026-10-09): one grid for the header and the rows (class names written out for Tailwind).
const MATERIAL_GRID = "grid grid-cols-[minmax(0,1fr)_auto] items-baseline gap-x-3 gap-y-0.5 md:grid-cols-[minmax(0,1fr)_7rem_5rem_minmax(0,16rem)]";
// With prices (steg A): an amount column before the jobs – five columns only from 1280 px, so Benämning keeps room for
// whole words (simulation 0.6.3: "LED- / armat / ur" in a standing tablet); narrower, a row is the name, then its numbers.
const MATERIAL_PRICE_GRID = "grid grid-cols-[minmax(0,1fr)_auto] items-baseline gap-x-3 gap-y-0.5 xl:grid-cols-[minmax(0,1fr)_7rem_5rem_8rem_minmax(0,14rem)]";
// The classes that switch the table from stacked rows to columns, at the width the grid above uses.
const MATERIAL_COLUMNS = { md: { header: "md:grid", unitInline: "md:hidden", unitCell: "md:block", single: "md:col-span-1" }, xl: { header: "xl:grid", unitInline: "xl:hidden", unitCell: "xl:block", single: "xl:col-span-1" } } as const;

/**
 * The project's material, summed per Benämning and Enhet from its work orders' material rows (expenses are left out),
 * with the jobs each line comes from. Computed by the server (or Local/demo) with the same reading rights as the jobs;
 * shown 50 lines at a time. For someone who may see prices (steg A, 2026-10-09) the server adds each line's amount and
 * the project's sums: material at purchase price and with markup, expenses and the total excl. VAT.
 */
function ProjectMaterials({ project, summary }: { project: WorkflowProject; summary: ProjectMaterialSummary }) {
  const [shown, setShown] = useState(PROJECT_MATERIAL_PAGE);
  const lines = summary.lines;
  const rest = lines.length - shown;
  // Priser (steg A, 2026-10-09): sent by the server only to someone who may see prices.
  const prices = summary.prices;
  const grid = prices ? MATERIAL_PRICE_GRID : MATERIAL_GRID;
  const columns = MATERIAL_COLUMNS[prices ? "xl" : "md"];
  // The lines sum material only; with prices the sums below also show the expenses (simulation 0.6.3: "Utgifter ingår
  // inte" stood above a total with the expenses in it).
  const expensesNote = prices ? "Utgifterna står i summan nedan." : "Utgifter ingår inte.";
  const exportCsv = () => {
    saveBlob(["﻿", projectMaterialsCsv(summary)], `material-${(project.name || "projekt").replace(/[^\p{L}\p{N}]+/gu, "-").replace(/^-+|-+$/g, "").slice(0, 60) || "projekt"}.csv`, "text/csv;charset=utf-8");
  };
  const native = useNativeMode();
  // Grossistexport (2026-10-12): the summed lines to a wholesaler; a line carries an article number only when all its rows agree.
  const wholesale = (variant: "outline" | "ghost") => <WholesaleExport source={{ ...fromProjectMaterials(lines), ...(summary.truncated ? { blocked: `Materiallistan har fler än ${PROJECT_MATERIAL_LIMIT} rader och visas avkortad. Exportera från en arbetsorder.` } : {}) }}
    label={`Material ${project.name || "projektet"}`} variant={variant} testId="project-materials-wholesale" />;
  // Nivå 1 på mobil (2026-10-10): the lines as the phone's rows (no table with small links), the sums as rows and
  // Exportera CSV as a row; the same summary and prices as on the computer.
  if (native) return <div data-testid="project-materials">
    <ListGroup title="Material i projektet" footer={lines.length ? `${summary.total} ${summary.total === 1 ? "rad" : "rader"} från arbetsordrarnas material, summerat per benämning och enhet. ${expensesNote}` : undefined}>
      {lines.length ? lines.slice(0, shown).map((line) => <ListRow key={`${line.name}\u0000${line.unit}`} testId="project-material-line" title={line.name} twoLines
        value={`${line.quantity || "–"}${line.unit ? ` ${line.unit}` : ""}`}
        subtitle={[prices && line.price && line.price.unpriced < line.rows ? `${formatSek(line.price.sale)} kr` : "", line.price?.unpriced ? unpricedText(line.price.unpriced) : "",
          line.jobs.slice(0, 2).map((job) => job.title || "Utan rubrik").join(", ") + (line.jobs.length > 2 ? ` +${line.jobs.length - 2}` : "")].filter(Boolean).join(" · ")}
        href={line.jobs.length === 1 ? taskHref({ id: line.jobs[0]!.id, kind: "WORK_ORDER" }) : undefined} />)
        : <ListEmpty>Inga material är registrerade på projektets arbetsordrar än.</ListEmpty>}
      {rest > 0 ? <ListRow title={<span className="text-primary">Visa fler ({rest})</span>} chevron={false} onClick={() => setShown((current) => current + PROJECT_MATERIAL_PAGE)} testId="project-materials-more" /> : null}
    </ListGroup>
    {prices && lines.length ? <ListGroup title="Summa" testId="project-materials-totals" footer={prices.unpriced ? `${unpricedText(prices.unpriced)} och ingår inte i summan.` : undefined}>
      <ListRow title="Material, inköp" value={`${formatSek(prices.purchase)} kr`} />
      <ListRow title="Material med påslag" value={`${formatSek(prices.sale)} kr`} />
      <ListRow title="Utgifter" value={`${formatSek(prices.expenses)} kr`} />
      <ListRow title={<span className="font-semibold">Totalt exkl. moms</span>} value={`${formatSek(prices.total)} kr`} />
    </ListGroup> : null}
    {lines.length ? <NativeActions><DownloadButton variant="ghost" onClick={exportCsv} data-testid="project-materials-csv">Exportera CSV</DownloadButton>{wholesale("ghost")}</NativeActions> : null}
  </div>;
  return <Panel icon={Package} title="Material i projektet" collapsible defaultCollapsed count={summary.total} foldKey="project-materials" description={lines.length ? `${summary.total} ${summary.total === 1 ? "rad" : "rader"} från arbetsordrarnas material, summerat per benämning och enhet. ${expensesNote}` : "Summeras från arbetsordrarnas material. Utgifter ingår inte."}
    actions={lines.length ? <><DownloadButton onClick={exportCsv} data-testid="project-materials-csv">Exportera CSV</DownloadButton>{wholesale("outline")}</> : undefined}>
    <div data-testid="project-materials">
      {!lines.length ? <p className="rounded-lg border border-dashed p-3 text-sm text-muted-foreground">Inga material är registrerade på projektets arbetsordrar än.</p> : <div role="table" aria-label="Material i projektet" className="overflow-hidden rounded-xl border bg-card">
        <div role="row" className={cn(grid, "hidden border-b bg-muted/40 px-3.5 py-2 text-xs font-medium text-muted-foreground", columns.header)}>
          <span role="columnheader">Benämning</span><span role="columnheader" className="text-right">Antal</span><span role="columnheader">Enhet</span>{prices ? <span role="columnheader" className="text-right">Belopp (kr)</span> : null}<span role="columnheader">Från jobb</span>
        </div>
        <div className="divide-y">
          {lines.slice(0, shown).map((line) => <div key={`${line.name}\u0000${line.unit}`} role="row" data-testid="project-material-line" className={cn(grid, "px-3.5 py-2.5 text-sm")}>
            <span role="cell" className="min-w-0 break-words font-medium">{line.name}</span>
            <span role="cell" className="text-right tabular-nums">{line.quantity || "–"}<span className={cn("text-muted-foreground", columns.unitInline)}>{line.unit ? ` ${line.unit}` : ""}</span></span>
            <span role="cell" className={cn("hidden", columns.unitCell)}>{line.unit || "–"}</span>
            {prices ? <span role="cell" className={cn("col-span-2 text-right tabular-nums", columns.single)} data-testid="project-material-amount">
              {line.price && line.price.unpriced < line.rows ? `${formatSek(line.price.sale)}` : "–"}
              {line.price?.unpriced ? <span className="block text-xs text-muted-foreground">{unpricedText(line.price.unpriced)}</span> : null}
            </span> : null}
            <span role="cell" className={cn("col-span-2 min-w-0 truncate text-xs text-muted-foreground", columns.single)}>
              {line.jobs.slice(0, 3).map((job, index) => <span key={job.id}>{index ? ", " : ""}<Link className="hover:text-primary hover:underline" href={taskHref({ id: job.id, kind: "WORK_ORDER" })}>{job.title || "Utan rubrik"}</Link></span>)}
              {line.jobs.length > 3 ? ` +${line.jobs.length - 3}` : ""}
            </span>
          </div>)}
        </div>
        {rest > 0 ? <div className="border-t px-3.5 py-2"><Button type="button" size="sm" variant="ghost" onClick={() => setShown((current) => current + PROJECT_MATERIAL_PAGE)} data-testid="project-materials-more">Visa fler ({rest})</Button></div> : null}
      </div>}
      {summary.truncated ? <p className="mt-2 text-xs text-muted-foreground">Visar de första {lines.length} av {summary.total} raderna.</p> : null}
      {prices && lines.length ? <dl className="mt-3 grid gap-x-6 gap-y-1 text-sm sm:grid-cols-2" data-testid="project-materials-totals">
        <div className="flex justify-between gap-3"><dt className="text-muted-foreground">Material, inköp</dt><dd className="tabular-nums">{formatSek(prices.purchase)} kr</dd></div>
        <div className="flex justify-between gap-3"><dt className="text-muted-foreground">Material med påslag</dt><dd className="tabular-nums">{formatSek(prices.sale)} kr</dd></div>
        <div className="flex justify-between gap-3"><dt className="text-muted-foreground">Utgifter</dt><dd className="tabular-nums">{formatSek(prices.expenses)} kr</dd></div>
        <div className="flex justify-between gap-3 font-semibold"><dt>Totalt exkl. moms</dt><dd className="tabular-nums">{formatSek(prices.total)} kr</dd></div>
        {prices.unpriced ? <p className="text-xs text-muted-foreground sm:col-span-2">{unpricedText(prices.unpriced)} och ingår inte i summan.</p> : null}
      </dl> : null}
    </div>
  </Panel>;
}

function ProjectJobs({ tasks, plannedMinutes }: { tasks: WorkflowTask[]; plannedMinutes: Map<string, number> }) {
  // Etapper (plan 1M): with stages the jobs are grouped under a summary row per stage; without any, the list is as before.
  const { grouped, groups } = groupByStage(tasks);
  return <Panel icon={ListChecks} title="Projektets jobb" description="Arbetsordrarna med sina uppgifter under sig.">
    <div data-testid="project-jobs" className="space-y-5">
      {!tasks.length ? <p className="rounded-lg border border-dashed p-3 text-sm text-muted-foreground">Projektet har inga jobb än.</p> : null}
      {groups.map((group) => grouped
        ? <section key={group.stage || "none"} aria-label={group.label} data-testid="project-stage" data-stage={group.stage} className="space-y-3">
          <StageHeader label={group.label} jobs={group.jobs} />
          <div className="space-y-4 border-l-2 border-border pl-3"><JobGroups tasks={group.jobs} plannedMinutes={plannedMinutes} /></div>
        </section>
        : <JobGroups key="all" tasks={group.jobs} plannedMinutes={plannedMinutes} />)}
    </div>
  </Panel>;
}

/** A stage's summary row: its name, period (earliest Start → latest Klart senast), "x av y jobb" and the weighted completion. */
function StageHeader({ label, jobs }: { label: string; jobs: WorkflowTask[] }) {
  const summary = stageSummary(jobs.map((job) => ({ ...job, progress: taskProgress(job), estimatedMinutes: job.estimatedMinutes })));
  const period = stagePeriodText(summary);
  return <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5 rounded-lg bg-muted/50 px-3.5 py-2" data-testid="project-stage-summary">
    <h3 className="min-w-0 truncate text-sm font-semibold">{label}</h3>
    <p className="text-xs text-muted-foreground">{[period, `${summary.doneCount} av ${summary.jobCount} jobb`].filter(Boolean).join(" · ")}</p>
    <div className="ml-auto flex min-w-28 items-center gap-2" aria-label={`${summary.progress} procent klart`}>
      <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-muted"><div className={`h-full rounded-full ${indicatorBar(summary.progress >= 100 ? "success" : "info")}`} style={{ width: `${summary.progress}%` }} /></div>
      <span className="w-9 text-right text-xs font-semibold tabular-nums">{summary.progress}%</span>
    </div>
  </div>;
}

/** The work orders (with the tasks that belong to them) and the standalone tasks of a set of jobs. */
function JobGroups({ tasks, plannedMinutes }: { tasks: WorkflowTask[]; plannedMinutes: Map<string, number> }) {
  const { workOrders, standalone } = groupProjectJobs(tasks);
  return <>
    {workOrders.length ? <JobSection title="Arbetsordrar" count={workOrders.length} testId="project-jobs-work-orders">
      <Bounded items={workOrders} label="arbetsordrar" render={(group) => <div key={group.order.id} role="rowgroup" data-testid="project-job-group">
        <JobRow task={group.order} plannedMinutes={plannedMinutes} linkedCount={group.linked.length} />
        {group.linked.length ? <Bounded items={group.linked} label="kopplade uppgifter" nested render={(task) => <JobRow key={task.id} task={task} plannedMinutes={plannedMinutes} nested />} /> : null}
      </div>} />
    </JobSection> : null}
    {/* A task whose work order is not in the list (another project, or not readable) is never hidden. */}
    {standalone.length ? <JobSection title="Uppgifter i andra arbetsordrar" count={standalone.length} testId="project-jobs-standalone">
      <Bounded items={standalone} label="uppgifter" render={(task) => <JobRow key={task.id} task={task} plannedMinutes={plannedMinutes} />} />
    </JobSection> : null}
  </>;
}

// One grid for every row and the header, so the columns line up (class names written out for Tailwind).
const JOB_GRID = "grid grid-cols-[minmax(0,1fr)_6.5rem] items-center gap-x-3 gap-y-2 md:grid-cols-[minmax(0,1fr)_10rem_8.5rem_6.5rem]";

function JobSection({ title, count, testId, children }: { title: string; count: number; testId: string; children: React.ReactNode }) {
  return <section data-testid={testId} aria-label={title}>
    <h3 className="mb-2 flex items-center gap-2 text-sm font-semibold">{title}<span className="rounded-full bg-muted px-2 py-0.5 text-xs font-medium text-muted-foreground">{count}</span></h3>
    <div role="table" aria-label={title} className="overflow-hidden rounded-xl border bg-card">
      <div role="row" className={cn(JOB_GRID, "hidden border-b bg-muted/40 px-3.5 py-2 text-xs font-medium text-muted-foreground md:grid")}>
        <span role="columnheader">Jobb</span><span role="columnheader">Steg</span><span role="columnheader">Progression</span><span role="columnheader" className="text-right">Åtgärd</span>
      </div>
      <div className="divide-y">{children}</div>
    </div>
  </section>;
}

function Bounded<T>({ items, label, nested = false, render }: { items: T[]; label: string; nested?: boolean; render: (item: T) => React.ReactNode }) {
  const [shown, setShown] = useState(JOB_LIST_PAGE);
  const rest = items.length - shown;
  return <>
    {items.slice(0, shown).map(render)}
    {rest > 0 ? <div className={cn("px-3.5 py-2", nested && "pl-10")}><Button type="button" size="sm" variant="ghost" onClick={() => setShown((current) => current + JOB_LIST_PAGE)} data-testid="project-jobs-more">Visa fler {label} ({rest})</Button></div> : null}
  </>;
}

const stepTone = (task: WorkflowTask): IndicatorTone => task.status === "NEEDS_ACTION" ? "danger"
  : task.step?.key === "done" || task.step?.key === "complete" ? "success" : task.step?.key === "risk" ? "warning" : "neutral";

function JobRow({ task, plannedMinutes, nested = false, linkedCount = 0 }: { task: WorkflowTask; plannedMinutes: Map<string, number>; nested?: boolean; linkedCount?: number }) {
  const progress = taskProgress(task);
  const state = taskState(task);
  const action = state === "planned" ? "Starta" : state === "done" || state === "cancelled" ? "Visa" : "Fortsätt";
  const actionId = useId();
  const obstacle = task.obstacle ?? jobObstacle({ status: task.status, data: task.data, updatedAt: task.updatedAt });
  const step = task.step ?? (task.status === "COMPLETED" ? { key: "done" as const, label: JOB_STEP_LABELS.done } : state === "cancelled" ? { key: "cancelled" as const, label: JOB_STEP_LABELS.cancelled } : null);
  return <div role="row" data-testid={nested ? "project-job-linked" : "project-job-row"} data-task-id={task.id} data-step={step?.key}
    className={cn(JOB_GRID, "tap-card group px-3.5 py-3 transition-colors hover:bg-secondary/40", nested && "bg-muted/20")}>
    <div role="cell" className={cn("col-start-1 row-start-1 flex min-w-0 items-start gap-2", nested && "pl-5")}>
      {nested ? <CornerDownRight aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-muted-foreground" /> : null}
      <div className="min-w-0">
        <Link href={taskHref(task)} aria-describedby={actionId} className="stretched-link line-clamp-2 text-sm font-semibold group-hover:text-primary">{task.title || "Utan rubrik"}</Link>
        <p className="truncate text-xs text-muted-foreground">{[taskTypeLabel(task), task.assignedToName, !nested && linkedCount ? `${linkedCount} ${linkedCount === 1 ? "kopplad uppgift" : "kopplade uppgifter"}` : ""].filter(Boolean).join(" · ")}</p>
        <PlannedVersusReported planned={plannedMinutes.get(task.id) ?? 0} reportedSec={task.totalDurationSec} />
      </div>
    </div>
    <div role="cell" className="col-start-1 row-start-2 flex min-w-0 flex-wrap items-center gap-1.5 md:col-start-2 md:row-start-1">
      {step ? <Badge variant="outline" data-testid="project-job-step" className={cn("max-w-full", indicatorBadge(stepTone(task)))}>{step.label}</Badge> : <span className="text-xs text-muted-foreground">–</span>}
      {task.status === "NEEDS_ACTION" ? <span className={cn("text-xs font-medium", indicatorText("danger"))}>Behöver åtgärdas</span> : task.status === "PAUSED" ? <span className="text-xs text-muted-foreground">Pausad</span> : null}
      {obstacle ? <ObstacleChip obstacle={obstacle} /> : null}
    </div>
    <div role="cell" className="col-start-2 row-start-2 flex min-w-0 items-center gap-2 md:col-start-3 md:row-start-1" aria-label={`${progress} procent klart`}>
      <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-muted"><div className={`h-full rounded-full ${indicatorBar(progressTone({ percent: progress, completed: task.status === "COMPLETED", attention: task.status === "NEEDS_ACTION", cancelled: state === "cancelled" }))}`} style={{ width: `${progress}%` }} /></div>
      <span className="w-9 text-right text-xs font-semibold tabular-nums">{progress}%</span>
    </div>
    <div role="cell" className="col-start-2 row-start-1 flex min-w-0 justify-end md:col-start-4">
      <span id={actionId} className="inline-flex items-center gap-1 text-xs font-medium text-primary">{action}</span>
    </div>
  </div>;
}

type ProjectDraft = { name: string; description: string; customerId: string; responsibleUserId: string; timeBudgetHours: string; startDate: string; dueDate: string; facilityId: string; fields: { client: string; contactPerson: string; reference: string; workSite: string }; staffRegister: StaffRegister };
function ProjectForm({ project, initialCustomerId, customers, members, busy, error, canEditFrame = true, tasks = [], activities = [], savePlace, quick, search = false, onCancel, onSave }: { project?: WorkflowProject;
  /** A new project from a customer card (plan 1A, 2026-10-11): this customer, and its only place, start chosen. */
  initialCustomerId?: string | null; customers: CustomerItem[]; savePlace?: SavePlace; quick?: CustomerQuickLinks; search?: boolean; members: ProjectMember[]; busy: boolean; error: string; canEditFrame?: boolean; tasks?: WorkflowTask[]; activities?: PlannedActivity[]; onCancel?: () => void; onSave: (input: ProjectFormInput) => Promise<ProjectCustomerChange | void> }) {
  // Changing the frame shows what falls outside first (2026-09-26, decision 5).
  const [preview, setPreview] = useState<{ input: ProjectFormInput; outside: string[]; shiftDays: number; kept: boolean } | null>(null);
  // Kundbyte (2026-10-10): the server's reason and choice when the project's jobs or quotes have the old customer.
  const [customerChange, setCustomerChange] = useState<{ input: ProjectFormInput; change: ProjectCustomerChange } | null>(null);
  const save = async (input: ProjectFormInput) => {
    const change = await onSave(input);
    setCustomerChange(change ? { input, change } : null);
  };
  // The choice is brought into view, also when Spara sits in the phone's top bar (level 1).
  const customerChangeRef = useRef<HTMLDivElement>(null);
  useEffect(() => { if (customerChange) customerChangeRef.current?.scrollIntoView({ block: "center", behavior: "smooth" }); }, [customerChange]);
  // Values typed before a trip to the customer register (Ny kund on a tablet) come back with the person (plan 1O).
  const draft = useReturnDraft<ProjectDraft>("project");
  const [name, setName] = useState(draft?.name ?? project?.name ?? ""); const [description, setDescription] = useState(draft?.description ?? project?.description ?? ""); const [customerId, setCustomerId] = useState(draft?.customerId ?? project?.customerId ?? (!project && initialCustomerId ? initialCustomerId : "")); const [responsibleUserId, setResponsibleUserId] = useState(draft?.responsibleUserId ?? project?.responsibleUserId ?? ""); const [timeBudgetHours, setTimeBudgetHours] = useState(draft?.timeBudgetHours ?? (project?.timeBudgetMinutes ? String(project.timeBudgetMinutes / 60) : ""));
  const [startDate, setStartDate] = useState(draft?.startDate ?? project?.startDate ?? ""); const [dueDate, setDueDate] = useState(draft?.dueDate ?? project?.dueDate ?? "");
  // The project's place (Platser, 2026-10-04): one field that searches the whole way; a place of another customer
  // chooses that customer too.
  const [facilityId, setFacilityId] = useState(draft?.facilityId ?? project?.facilityId ?? "");
  const [fields, setFields] = useState(draft?.fields ?? { client: project?.client ?? "", contactPerson: project?.contactPerson ?? "", reference: project?.reference ?? "", workSite: project?.workSite ?? "" });
  // A new project from a customer card: the customer's only place is chosen once the customer list holds it (the list can
  // arrive after the form), and its contact person as on a change of customer; never again after that. Adjusted while
  // rendering (not in an effect), as the panels do.
  const [placedFor, setPlacedFor] = useState<string | null>(null);
  const initialOwner = !project && initialCustomerId ? customers.find((customer) => customer.id === initialCustomerId) : undefined;
  if (initialOwner && placedFor !== initialOwner.id) {
    setPlacedFor(initialOwner.id);
    setFacilityId((current) => current || placeAfterCustomerChange(initialOwner.facilities, initialOwner.id, null, { auto: true }) || "");
    setFields((current) => current.contactPerson.trim() ? current : { ...current, contactPerson: customerContactName(initialOwner) });
  }
  // Personalliggare, steg 0 (2026-10-08): folded unless the project already requires it.
  const staffRegisterOn = useModules()("staff_register");
  const [staffRegister, setStaffRegister] = useState<StaffRegister>(() => draft?.staffRegister ?? (project ? staffRegisterOf(project.staffRegister) : { ...EMPTY_STAFF_REGISTER }));
  useReturnDraftValues<ProjectDraft>("project", { name, description, customerId, responsibleUserId, timeBudgetHours, startDate, dueDate, facilityId, fields, staffRegister });
  const [formError, setFormError] = useState("");
  const inPopup = useFormPopup();
  const native = useNativeMode();
  const more = (content: React.ReactNode) => native ? <>{content}</> : <CollapsibleSection title="Fler uppgifter" summary={moreSummary || "Beskrivning, beställare, kontaktperson, referens, arbetsplats och personalliggare"} open={moreOpen} onOpenChange={setMoreOpen} testId="project-more">{content}</CollapsibleSection>;
  // Folded at first, also when editing: the line under the title lists what is entered, and the form keeps the size of a popup.
  const [moreOpen, setMoreOpen] = useState(false);
  const moreSummary = [fields.client, fields.contactPerson, fields.reference, fields.workSite].filter((item) => item.trim()).join(" · ");
  const responsibleName = members.find((member) => member.id === responsibleUserId)?.name ?? "";
  // New projects need a frame (2026-09-26); an existing project may stay without one until someone sets it.
  const frameRequired = !project || Boolean(project.startDate || project.dueDate);
  const field = (key: keyof typeof fields, label: string, max: number) => <label className="block space-y-2 text-xs font-medium text-muted-foreground">{label}<Input value={fields[key]} onChange={(event) => setFields((current) => ({ ...current, [key]: event.target.value }))} maxLength={max} /></label>;
  // Plats as the source (approved 2026-10-07): a chosen place fills "Arbetsplats / anläggning" with its whole way and the
  // facility's address, read-only with "Ändra plats"; without a place the field stays free text.
  const [placeOpenRequest, setPlaceOpenRequest] = useState(0);
  const placeOwner = customers.find((customer) => customer.id === customerId);
  const linkedWorkSite = customerId && facilityId && placeOwner?.facilities?.some((place) => place.id === facilityId) ? placeLabel(placeOwner.facilities, facilityId).slice(0, 300) : "";
  useEffect(() => {
    if (!linkedWorkSite) return;
    // eslint-disable-next-line react-hooks/set-state-in-effect -- the field follows the chosen place
    setFields((current) => current.workSite === linkedWorkSite ? current : { ...current, workSite: linkedWorkSite });
  }, [linkedWorkSite]);
  const workSiteField = linkedWorkSite
    ? <div className="block space-y-2 text-xs font-medium text-muted-foreground"><label htmlFor="project-work-site">Arbetsplats / anläggning</label><Input id="project-work-site" value={fields.workSite} readOnly aria-readonly="true" className="bg-muted/40" data-testid="project-work-site-locked" />
      <span className="block text-xs font-normal">Fylls i från platsen · <button type="button" className={cn("font-medium text-primary underline-offset-2 hover:underline", native && "inline-flex min-h-11 items-center px-1")} onClick={() => setPlaceOpenRequest((current) => current + 1)}>Ändra plats</button></span></div>
    : field("workSite", "Arbetsplats / anläggning", 300);
  // Beställare follows the customer (2026-10-10, kartläggningen 5.4) the way Arbetsplats follows the place: with a
  // customer it is the customer's name, read-only; without one it is free text. Text written earlier is named, not lost
  // silently. Kontaktperson is filled from the customer when it is empty or still the previous customer's contact.
  const chosenCustomer = customers.find((customer) => customer.id === customerId);
  const linkedClient = customerDisplayName(chosenCustomer);
  useEffect(() => {
    if (!linkedClient) return;
    // eslint-disable-next-line react-hooks/set-state-in-effect -- the field follows the chosen customer
    setFields((current) => current.client === linkedClient ? current : { ...current, client: linkedClient });
  }, [linkedClient]);
  const storedClient = project?.client?.trim() ?? "";
  const replacedClient = linkedClient && storedClient && storedClient !== linkedClient ? storedClient : "";
  const clientField = linkedClient
    ? <div className="block space-y-2 text-xs font-medium text-muted-foreground"><label htmlFor="project-client">Beställare</label><Input id="project-client" value={fields.client} readOnly aria-readonly="true" className="bg-muted/40" data-testid="project-client-locked" />
      <span className="block text-xs font-normal">Fylls i från kunden{replacedClient ? <> · <span data-testid="project-client-replaced">Tidigare text ”{replacedClient}” ersätts av kundens namn när du sparar.</span></> : null}</span></div>
    : field("client", "Beställare", 200);
  const chooseCustomer = (next: { customerId: string | null; facilityId: string | null }) => {
    const previous = customers.find((customer) => customer.id === customerId);
    const nextCustomer = customers.find((customer) => customer.id === next.customerId);
    if (next.customerId !== (customerId || null) && nextCustomer) setFields((current) => {
      const contact = current.contactPerson.trim();
      const follows = !contact || contact === customerContactName(previous);
      return follows ? { ...current, contactPerson: customerContactName(nextCustomer) } : current;
    });
    setCustomerId(next.customerId ?? ""); setFacilityId(next.facilityId ?? "");
  };
  const keepCustomer = () => {
    setCustomerId(project?.customerId ?? ""); setFacilityId(project?.facilityId ?? "");
    setFields((current) => ({ ...current, contactPerson: project?.contactPerson ?? current.contactPerson }));
    setCustomerChange(null);
  };
  // The app marks and explains a missing date itself (like the work order's "Skriv en rubrik så kan du spara."), never the browser's own bubble.
  const frameInvalid = Boolean(formError) && Boolean(projectFrameError({ startDate, dueDate }, !project));
  return <form className="space-y-5" noValidate onSubmit={(event) => {
    event.preventDefault();
    const frameError = projectFrameError({ startDate, dueDate }, !project);
    if (frameError) { setFormError(frameError); announce(frameError, true); document.getElementById(!startDate ? "project-start-date" : !dueDate || dueDate < startDate ? "project-due-date" : "project-start-date")?.focus(); return; }
    setFormError("");
    const hours = timeBudgetHours.trim() ? Number(timeBudgetHours.replace(",", ".")) : 0;
    const input: ProjectFormInput = { id: project?.id, name, description, startDate, dueDate, ...fields, staffRegister, customerId: customerId || null, facilityId: customerId && facilityId ? facilityId : null, responsibleUserId: responsibleUserId || null, responsibleName, timeBudgetMinutes: Number.isFinite(hours) ? Math.round(hours * 60) : -1 };
    const frame = { startDate, dueDate };
    if (project && hasProjectFrame(frame) && (project.startDate !== startDate || project.dueDate !== dueDate)) {
      // Flytta allt (2026-11-02): a Start outside the frame is named too; a job that keeps its period (a round's, a plan's) may lie outside by decision.
      const { kept } = projectShift(tasks.map((task) => ({ ...task, dueDate: task.dueDate ?? "", createdAt: task.createdAt ?? task.updatedAt })), frameShiftDays(project, frame));
      const open = tasks.filter((task) => isTaskOpen(task.status) && !kept.has(task.id));
      const bookings = activities.filter((activity) => !activity.deletedAt && ["PLANNED", "IN_PROGRESS"].includes(activity.status) && !(activity.workflowTaskId && kept.has(activity.workflowTaskId)));
      const startOutside = (start: string | undefined) => Boolean(start && (start < frame.startDate || start > frame.dueDate));
      const outside = [
        ...open.filter((task) => taskDueDateError(task.dueDate ?? "", frame)).map((task) => `${taskTypeLabel(task)}: ${task.title} (Klart senast ${task.dueDate})`),
        ...open.filter((task) => !taskDueDateError(task.dueDate ?? "", frame) && startOutside(task.plannedStartDate)).map((task) => `${taskTypeLabel(task)}: ${task.title} (Start ${task.plannedStartDate})`),
        ...bookings.filter((activity) => planningFrameError(activity, frame)).map((activity) => `Planering: ${activity.title} (${formatDateTime(activity.startsAt)})`),
      ];
      // The whole frame moved (2026-11-02): the work is offered along, also when it still lies inside.
      if (outside.length || (frameMovedWhole(project, frame) && (open.length || bookings.length))) { setPreview({ input, outside, shiftDays: frameShiftDays(project, frame), kept: open.length < tasks.filter((task) => isTaskOpen(task.status)).length }); return; }
    }
    void save(input);
  }}>
    {preview ? <div data-testid="project-frame-preview" role="alertdialog" aria-label="Utanför den nya tidsramen" className={cn("space-y-3 rounded-xl border p-4 text-sm", indicatorBadge("warning"))}>
      <p className="font-semibold">{preview.outside.length ? `${preview.outside.length} ${preview.outside.length === 1 ? "sak hamnar" : "saker hamnar"} utanför den nya tidsramen` : `Projektet flyttas ${Math.abs(preview.shiftDays)} ${Math.abs(preview.shiftDays) === 1 ? "dag" : "dagar"} ${preview.shiftDays > 0 ? "framåt" : "bakåt"}`}</p>
      {preview.outside.length ? <ul className="max-h-40 list-disc space-y-0.5 overflow-y-auto pl-5 text-xs">{preview.outside.map((item) => <li key={item}>{item}</li>)}</ul> : null}
      <p className="text-xs">Flytta Start, Klart senast och bokningar lika mycket, eller spara och justera själv.{preview.kept ? " Arbetsordrar från en driftrond eller underhållsplan behåller sina datum." : ""}</p>
      <div className="flex flex-wrap justify-end gap-2"><Button type="button" variant="ghost" onClick={() => setPreview(null)}>Tillbaka</Button><Button type="button" variant="outline" disabled={busy} onClick={() => { const next = preview.input; setPreview(null); void save({ ...next, shiftDays: 0 }); }}>Spara ändå</Button>{preview.shiftDays ? <Button type="button" disabled={busy} onClick={() => { const next = preview; setPreview(null); void save({ ...next.input, shiftDays: next.shiftDays }); }}>Flytta allt {Math.abs(preview.shiftDays)} {Math.abs(preview.shiftDays) === 1 ? "dag" : "dagar"} {preview.shiftDays > 0 ? "framåt" : "bakåt"}</Button> : null}</div>
    </div> : null}
    {/* Grunduppgifter, variant Jobb (Lika är rätt, 2026-11-14): the work order's card with the project's own fields – Rubrik,
        Kund och plats, Ansvarig, the time frame (Start, Klart senast) and Tidsbudget; no Projekt, since this is the project.
        Beskrivning stands first under Fler uppgifter, so the form still fits a popup (plan 1Q). */}
    <FormPanel title="Grunduppgifter" icon={FileText}>
    <SharedBasicsFields idPrefix="project" titleLabel="Rubrik *" title={{ maxLength: 160, required: true, autoFocus: true }} hideProject hideDescription
      value={{ title: name, description, projectId: null, customerId: customerId || null, facilityId: facilityId || null, assignedToUserId: responsibleUserId || null, assignedToName: responsibleName, dueDate }}
      customers={customers} projects={[]} members={members} assignee={{ label: "Ansvarig (valfritt)", empty: "Ingen ansvarig" }}
      customer={{ locked: false, savePlace, quick, search, placeOpenRequest, autoPlace: !(fields.workSite.trim() && !linkedWorkSite) }}
      schedule={<>
        <label className="space-y-2 text-xs font-medium text-muted-foreground">Start{frameRequired ? " *" : ""}<Input id="project-start-date" type="date" value={startDate} onChange={(event) => setStartDate(event.target.value)} aria-required={frameRequired || undefined} aria-invalid={frameInvalid && !startDate ? true : undefined} disabled={!canEditFrame} /></label>
        <label className="space-y-2 text-xs font-medium text-muted-foreground">Klart senast{frameRequired ? " *" : ""}<Input id="project-due-date" type="date" value={dueDate} min={startDate || undefined} onChange={(event) => setDueDate(event.target.value)} aria-required={frameRequired || undefined} aria-invalid={frameInvalid && (!dueDate || Boolean(startDate && dueDate < startDate)) ? true : undefined} disabled={!canEditFrame} /></label>
      </>}
      planningExtras={<label className="space-y-2 text-xs font-medium text-muted-foreground">Tidsbudget (h)<Input id="project-time-budget" type="number" min="0" max="166666" step="0.25" inputMode="decimal" value={timeBudgetHours} onChange={(event) => setTimeBudgetHours(event.target.value)} placeholder="Exempel: 7,5" aria-describedby="project-time-budget-help" />
        <span id="project-time-budget-help" className="block font-normal">Skild från planerad och rapporterad tid.</span></label>}
      afterGrid={inPopup && canEditFrame ? null : <p className="text-xs text-muted-foreground">{canEditFrame ? "Uppgifter och planering i projektet ska hålla sig inom tidsramen." : "Bara projektansvarig eller en företagsadministratör kan ändra tidsramen."}</p>}
      onTitle={setName} onDescription={setDescription} onCustomer={chooseCustomer} onResponsible={(id: string) => setResponsibleUserId(id)} onSchedule={() => undefined} onDueDate={setDueDate} />
    {/* The less common fields sit under Fler uppgifter (plan 1Q, 2026-10-11), so the form fits a popup. Level 1 (the
        phone's app look) is unchanged: all the fields stand in the screen's list, without the fold. */}
    {more(<>
    <label className="block space-y-2 text-xs font-medium text-muted-foreground">Beskrivning<textarea id="project-description" aria-label="Beskrivning" className="form-textarea" value={description} maxLength={2000} onChange={(event) => setDescription(event.target.value)} />
      <span className="block font-normal">Visas i alla projektets uppgifter och i rapporterna.</span></label>
    <div className="grid gap-5 sm:grid-cols-2">{clientField}{field("contactPerson", "Kontaktperson", 200)}{field("reference", "Referens / ordernummer", 120)}{workSiteField}</div>
    <StaffRegisterFields value={staffRegister} onChange={setStaffRegister} cloud={search} canActivate={canEditFrame && staffRegisterOn} />
    </>)}
    </FormPanel>
    {/* Where the person pressed Spara (important events are shown where the person is). */}
    {customerChange ? <div ref={customerChangeRef} data-testid="project-customer-change" role="alertdialog" aria-label="Byte av kund" className={cn("space-y-3 rounded-xl border p-4 text-sm", indicatorBadge(customerChange.change.blocked ? "danger" : "warning"))}>
      <p className="font-semibold">{customerChange.change.blocked ? "Kunden kan inte bytas" : `Byt kund till ${customerChange.change.toName}?`}</p>
      {/* The heading says it once; the server's sentence "Kunden kan inte bytas." is not repeated under it (QA 2026-10-10). */}
      <p className="text-xs">{customerChange.change.message.replace(/^Kunden kan inte bytas\.\s*/u, "")}</p>
      <div className="flex flex-wrap justify-end gap-2"><Button type="button" variant="ghost" onClick={() => setCustomerChange(null)}>Tillbaka</Button><Button type="button" variant={customerChange.change.blocked ? "default" : "outline"} disabled={busy} onClick={keepCustomer}>Behåll kunden</Button>{customerChange.change.blocked ? null : <Button type="button" disabled={busy} data-testid="project-customer-move" onClick={() => { const next = customerChange.input; void save({ ...next, customerChange: "move_jobs" }); }}>{customerChange.change.open ? `Flytta jobben till ${customerChange.change.toName}` : "Byt kund ändå"}</Button>}</div>
    </div> : null}
    {formError || error ? <p role="alert" className="text-sm text-destructive">{formError || error}</p> : null}
    {/* One row of buttons: while the customer choice is open its own buttons are the form's (Tillbaka returns to them). */}
    {/* Without a name the button says why, in text and as a toast when pressed (simulation 0.6.3: it was dead without a reason). */}
    {customerChange ? null : <DialogActions cancel={onCancel ? { onClick: onCancel } : null} primary={{ label: project ? "Spara ändringar" : "Skapa projekt", type: "submit", disabledReason: name.trim() ? null : "Ange projektets namn först.", describedBy: name.trim() ? undefined : "project-save-reason", busy, testId: "project-form-save" }}><DisabledReason id="project-save-reason" reason={name.trim() ? null : "Ange projektets namn först."} className="mr-auto self-center" /></DialogActions>}</form>;
}
