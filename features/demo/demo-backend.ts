import { optedOutHere } from "@/lib/analytics/exclusion";
import { emptyPlaceRegisterFilter, listPlaceRegister, objectTypeOptions, placeRegisterCounts, placeRegisterFilterSchema } from "@/lib/workflow/place-register";
import { listPlaceLabel, tempPlaceOf } from "@/lib/workflow/temp-place";
import { isUrgentOpen, maintenanceListFilterSchema, maintenanceMatches, withoutStaleWaiting } from "@/lib/workflow/maintenance";
import { savedStatusForTask } from "@/lib/workflow/task-status-rule";
import { assigneeReadRefusal, memberMayReadJob } from "@/lib/workflow/assignee-access";
import { customerFacilityInputSchema, facilityLinkError, normalizeFacilityInput, placeAddress, placeChain, placeInUseMessage, placeKindOf, placeName, placeParentError, placePath, placePosition, placeSummary, placeWithDescendants } from "@/lib/workflow/customer-facility";
import { placeObjectOf } from "@/lib/workflow/maintenance";
import { parseSearchQuery, searchTooShort } from "@/lib/search/query";
import { searchLocalWorkspace } from "@/lib/search/local";
import { SEARCH_TYPES, type SearchType } from "@/lib/search/types";
import { z } from "zod";
import { addSwedishDays, swedishClock, swedishDayKey } from "@/lib/swedish-time";
import { projectCompletion } from "@/lib/workflow/project-progress";
import { PROJECT_STATISTICS_LIST_FILTERS, summarizeProjectStatistics } from "@/lib/workflow/project-statistics";
import { canViewEconomy, canViewTeam, FORM_PERMISSION_AREAS, formPermissionArea, hasWorkflowPermission, readableTaskScope, workflowSubjectForTask, type WorkflowPermissionAction, type WorkflowPermissionSubject } from "@/lib/workflow/permissions";
import { isCalculatorKey } from "@/lib/calculators/company-data";
import { resetWorkflowTaskApproval, stampCustomerAndJudgements, stampWorkflowTaskApproval, workflowTaskCompletion, workflowTaskHasDocumentation, workflowTaskInputSchema, workflowTaskProgress } from "@/lib/workflow/task-model";
import { plannedActivityAssignments, plannedActivityInputSchema, plannedActivitySummary } from "@/lib/workflow/planned-activity";
import { canReadPlannedActivity, plannedActivityWriteRefusal, workToBookScope } from "@/lib/workflow/planned-activity-access";
import { customerDisplayName, movedJobPlace, projectCustomerChange, projectCustomerFields } from "@/lib/workflow/project-customer";
import { capacityWeek } from "@/lib/workflow/capacity-summary";
import { summarizeOverviewKpis, type OverviewKpiTask } from "@/lib/workflow/overview-kpis";
import { canArchiveProject, canManageProjectLifecycle, summarizeProjectStatus } from "@/lib/workflow/project-status";
import { bookedTaskIdsForUser, bookedUserIds, bookingChangeRefusal, canHandOverPlanning, planningDelegateSummary } from "@/lib/workflow/bookings";
import { planningFrameError, projectDecisionInputSchema, projectFrameError, taskDueDateError } from "@/lib/workflow/project-frame";
import { notificationToday, taskNotifications } from "@/lib/workflow/task-notifications";
import { demoComments, demoNotifications } from "./demo-comments";
import { countTaskStatistics, hasRoundMarker, summarizeTaskStatistics, summarizeWorkOrderGoal, taskStatisticsBucket, TASK_STATISTICS_TYPES } from "@/lib/workflow/task-statistics";
import { companyGoalsOf, companyGoalsSchema, visibleCompanyGoals } from "@/lib/workflow/company-goals";
import { assertTimeCorrection, TimeCorrectionError } from "@/lib/workflow/time-correction";
import { DemoConnectionsError, demoIntegrationKeys, demoMachineSources } from "./demo-connections";
import { claimClosedText, claimDecision, claimTakenText } from "@/lib/machine/alarm-notice";
import { DEMO_MACHINE_CREATORS, demoMachineNotices } from "./machine/orders";
import { isDemoBrowserKey } from "@/lib/analytics/catalog";
import { DemoMaintenanceError, demoMaintenance, seedDemoMaintenance } from "./demo-maintenance";
import { DemoPurchaseError, demoPurchases } from "./demo-purchases";
import { WORK_ITEM_FILTERS, workItemKindsForQuery, type WorkItemFilter } from "@/lib/workflow/work-items";
import { linkedTaskFormName, taskIsSigned, workOrderRemovalRefusal, workOrderRemovalSummary } from "@/lib/workflow/work-order-link";
import { roundHolderSaveError, roundOfProtocolValues, roundOrderRef, roundOrderSummary, roundProtocolOrder, withRoundOrderTempPlace } from "@/lib/workflow/round-work-orders";
import { localOrderRoundSafetyRefusal, localRoundSafetyRefusal, localStampRoundSafety, roundSafetyRequired, roundSafetyRiskFrom, roundSafetyWorkGate } from "@/lib/workflow/round-safety";
import { projectTimeState } from "@/lib/workflow/time-owner";
import { parseWorkOrderOrigin, workOrderOriginMatches } from "@/lib/workflow/work-items";
import { duplicateRiskAssessmentError, inheritFromWorkOrder, PROJECT_LINK_WORK_ORDER_ONLY, sharedBasicsChanged, tasksFollowingWorkOrder, WORK_ORDER_REQUIRED, workOrderLinkError, workOrderRequiredError, WORK_ORDER_LINK_LIST_LIMIT, WORK_ORDER_OPTION_LIMIT } from "@/lib/workflow/work-order-link";
import { listWorkOrders, nextPlannedAt } from "@/lib/workflow/work-orders";
import { completedFrom, listWork, projectListTab, PROJECT_LIST_FILTERS, resolveWorkListScope, WORK_LIST_SCOPES, WORK_LIST_SORTS, workListCountsAllowed, workStateMatches, workStateOf, type WorkListSort } from "@/lib/workflow/work-list";
import { isMineProject, PROJECT_ATTENTION, projectAttention } from "@/lib/workflow/project-filters";
import { allowedFilter, filterDay } from "@/lib/url-filters";
import { selectFormHistory } from "@/lib/workflow/form-history";
import { planningRoundPeriod, planningRounds } from "@/lib/workflow/planning-rounds";
import { formScheduleInputSchema, scheduleViews } from "@/lib/workflow/form-schedule";
import { canPlanRounds, roundChangeRefusal, roundPlanRefusal, type RoundPlanActor, type RoundPlanState } from "@/lib/workflow/round-planning";
import { companyValueCatalog, companyValuesSaveSchema, mergeCompanyValues } from "@/lib/workflow/company-values";
import { mergePreferences, preferencesSchema } from "@/lib/kfid/preferences";
import { currentAppVersion } from "@/lib/release-notes";
import { buildOverviewWork, OVERVIEW_WORK_FILTERS, OVERVIEW_WORK_SORTS, selectOverviewWork } from "@/lib/workflow/overview-work";
import { projectPeople } from "@/lib/workflow/project-people";
import { isRiskAssessmentTask, riskCheckOf, riskExceptionRefusal, riskStepExempt, riskStepState, stampRiskStep } from "@/lib/workflow/risk-step";
import { localJobStep, localRiskStepContext, localRiskStepRefusal } from "@/lib/workflow/risk-step-local";
import { summarizeProjectMaterials, workOrderMaterialSources } from "@/lib/workflow/project-materials";
import { summarizePortfolio } from "@/lib/workflow/project-portfolio";
import { bookingMoveRefusal, bookingShiftWorkdays, movableBooking, planFollowerMoves, predecessorError, scheduleBookingOf, scheduleChangeSummary, scheduleInputSchema, schedulePeriodError, shiftBookingTimes, taskScheduleError } from "@/lib/workflow/schedule";
import { datesOnProjectLink, effectiveStartDate, normalizeStage, projectShift, stageSuggestions, startForNewJob } from "@/lib/workflow/job-planning";
import { TO_BOOK_LIMIT, workToBook } from "@/lib/overview/team-followup";
import { jobObstacle, obstacleBlocked, obstacleInputSchema, OBSTACLE_REASON_LABELS, reportObstacle, resolveObstacle } from "@/lib/workflow/obstacles";
import { demoDeviationPhotoAdd, demoDeviationPhotoRemove, demoDeviationPhotoUrl } from "./demo-self-inspection";
import { demoActionRefusal, demoCardHistory, demoSavedRefusal, demoSelfInspection, demoSelfInspectionLevels, demoSelfInspectionReminders, demoSelfInspectionWork, demoWorkOrderDeleted, demoWorkOrderSaved, ensureDemoSelfInspection } from "./demo-self-inspection";
import { SelfInspectionError } from "@/lib/self-inspection/model";
import { EMPTY_STAFF_REGISTER, staffRegisterInputSchema, staffRegisterOf } from "@/lib/workflow/staff-register";
import { CANCELLED_STATUS, cancelTaskError, isTaskCancelled, isTaskOpen, restoreTaskError, restoredTaskStatus } from "@/lib/workflow/task-cancel";
import { MIN_TIME_ENTRY_SECONDS, type StoppedTimer } from "@/lib/workflow/running-timer";
import { createDemoDatabase, DEMO_ADMIN_ID, DEMO_COMPANY_DETAILS, demoItemsOf, demoOrderSummary, type DemoActivity, type DemoDatabase, type DemoProject, type DemoTask, type DemoUserId } from "./demo-data";
import { demoCustomerQuotes, demoQuotedMinutes, demoQuoteSearchItems, demoQuotes, DemoQuoteError } from "./demo-quotes";
import { searchDemoCatalogue } from "./demo-catalogue";
import { demoReportArchive, demoReportSearchItems } from "./demo-reports";
import { demoInvoiceBases, DemoInvoiceBasisError } from "./demo-invoice-bases";
import { demoCustomerInvoices } from "./demo-customer-invoices";
import { demoOverview, DemoOverviewError } from "./demo-overview";
import { demoBoards, DemoBoardsError } from "./demo-boards";
import { demoNews, DemoNewsError } from "./demo-news";
import { demoDocuments, DemoDocumentsError } from "./demo-documents";
import { demoAgents, DemoAgentsError } from "./demo-agents";
import { DEMO_CHAT_QUESTIONS, demoChatAnswer } from "./demo-ai";
import { demoAbsence, DemoAbsenceError } from "./demo-absence";
import { demoOperatorAdminAction, demoOperatorAdminView, DemoOperatorError } from "./demo-operator";
import { demoPayroll, DemoPayrollError } from "./demo-payroll";
import { demoCheckedTimeTypeId, demoTimeTypeAction, demoTimeTypes, demoTimeTypesWithPolicy, DemoTimeTypeError } from "./demo-time-types";
import { demoAssertTimeOpen, demoTimePeriods, DemoTimePeriodError } from "./demo-time-periods";
import { resolveTimeType } from "@/lib/workflow/time-types";
import { absenceLabel, countsInPlanning } from "@/lib/workflow/absence";
import { expectedWeeklyWorkMinutes, workdaySchema } from "@/lib/workflow/work-schedule";
import { customerTitle } from "@/lib/kfid/customer-name";
import { CUSTOMER_FILTERS, customerMatchesFilter } from "@/lib/kfid/customer-list";
import { countByFilter } from "@/lib/list-filter";
import { protocolNumberOf, workflowReportSectionKeys, type WorkflowReportOptions, type WorkflowReportTask } from "@/lib/workflow/report";
import { canSeePrices } from "@/lib/workflow/material-prices";
import { projectFieldRows } from "@/lib/workflow/project-frame";
import { facilityLabel } from "@/lib/workflow/customer-facility";
import { announce } from "@/lib/workflow/toast";
import { DEMO_REPORT_PDF_ONLY } from "@/features/workflow/report-options";
import { demoFileName, demoPdfResponse, demoReportIdentity, stampDemoPdf } from "./demo-pdf";

/**
 * In-browser backend for the public demo (2026-09-26, path A). It answers the same /api requests as the
 * server with the same response shapes, from memory only: nothing reaches the server, nothing is stored and a reload
 * starts over. It reuses the shared pure domain rules (task completion, planning, time correction, key figures,
 * notifications, statistics) and applies the demo user's role and permission profile like the server does.
 */
class DemoError extends Error {
  /** `details` travel in the answer like the server's (the project's customer change carries its choice). */
  constructor(readonly status: number, message: string, readonly details?: Record<string, unknown>) { super(message); }
}
type Json = Record<string, unknown>;
type Request = { method: string; url: URL; body: unknown };

export const DEMO_UNAVAILABLE = "Den här funktionen går inte att prova i demon.";
let db: DemoDatabase | null = null;
let currentUserId: DemoUserId = DEMO_ADMIN_ID;
const listeners = new Set<() => void>();

export function demoDatabase() { return (db ??= createDemoDatabase()); }
export function demoCurrentUser() { return demoDatabase().users.find((user) => user.id === currentUserId)!; }
export function setDemoUser(id: DemoUserId) { currentUserId = id; listeners.forEach((listener) => listener()); }
export function onDemoUserChange(listener: () => void) { listeners.add(listener); return () => { listeners.delete(listener); }; }

function context() {
  const database = demoDatabase();
  const user = demoCurrentUser();
  const admin = user.role === "ADMIN";
  const can = (subject: WorkflowPermissionSubject, action: WorkflowPermissionAction) => admin || hasWorkflowPermission(user.permissions, subject, action);
  const require = (subject: WorkflowPermissionSubject, action: WorkflowPermissionAction) => { if (!can(subject, action)) throw new DemoError(403, "Du saknar behörighet för den här åtgärden."); };
  return { db: database, user, admin, can, require, now: new Date() };
}
type Context = ReturnType<typeof context>;
const nextId = (ctx: Context, prefix: string) => `demo-${prefix}-${++ctx.db.sequence}`;
const userName = (ctx: Context, id: string | null | undefined) => ctx.db.users.find((user) => user.id === id)?.name ?? "";
const requireAdmin = (ctx: Context) => { if (!ctx.admin) throw new DemoError(403, "Bara en företagsadministratör kan göra det."); };
/** Teamet (2026-10-28): the same rule as Cloud, admins or team:read. */
const seesTeam = (ctx: Context) => canViewTeam({ admin: ctx.admin, workflowPermissions: ctx.user.permissions });
const isMine = (ctx: Context, task: DemoTask) => task.assignedToUserId === ctx.user.id || (!task.assignedToUserId && task.createdBy === ctx.user.id);
const readableTasks = (ctx: Context) => ctx.db.tasks.filter((task) => ctx.can(workflowSubjectForTask(task.kind), "read"));
const durationSec = (entries: { durationSec: number; endedAt: string | null; startedAt: string }[], now: Date) =>
  entries.reduce((sum, entry) => sum + entry.durationSec + (!entry.endedAt ? Math.max(0, Math.floor((now.getTime() - Date.parse(entry.startedAt)) / 1000)) : 0), 0);
const entriesFor = (ctx: Context, taskId: string) => ctx.db.timeEntries.filter((entry) => entry.taskId === taskId);
/** Tidsperiod (2026-10-30): time in a sent-in or approved month is not created, changed or removed – as Cloud. */
const requireTimeOpen = (ctx: Context, touches: { userId: string; startedAt: string }[]) => {
  try { demoAssertTimeOpen(ctx.db, touches, ctx.user.id); } catch (error) { throw error instanceof DemoTimePeriodError ? new DemoError(error.status, error.message) : error; }
};
const projectArchived = (ctx: Context, projectId: string | null) => Boolean(projectId && ctx.db.projects.find((project) => project.id === projectId)?.archivedAt);
const projectClosed = (ctx: Context, projectId: string | null) => Boolean(projectId && ctx.db.projects.find((project) => project.id === projectId)?.closedAt);
/** A work order (or, Projekttid since 2026-10-26, a project: kind PROJECT) by id, as the time report, planning and history use it. */
type Source = { id: string; title: string; kind: DemoTask["kind"] | "PROJECT"; status: string; projectId: string | null; project?: boolean };
const sourceOf = (ctx: Context, id: unknown): Source | null => {
  const task = ctx.db.tasks.find((item) => item.id === id);
  if (task) return { id: task.id, title: task.title, kind: task.kind, status: task.status, projectId: task.projectId };
  const project = ctx.db.projects.find((item) => item.id === id);
  return project ? { id: project.id, title: project.name, kind: "PROJECT", status: projectTimeState(project).status, projectId: project.id, project: true } : null;
};
/** An entry's owner: its work order or its project. */
const entryOwnerId = (entry: { taskId: string | null; projectId?: string | null }) => entry.taskId ?? entry.projectId ?? "";
// Tid på arbetsordern (2026-10-26): time on a task is recorded on its work order, like the server.
const timeOwner = (ctx: Context, task: DemoTask) => {
  if (task.kind === "WORK_ORDER") return task;
  if (!task.workOrderId) throw new DemoError(409, WORK_ORDER_REQUIRED);
  if (!ctx.can("work-order", "read")) throw new DemoError(403, "Tiden räknas på arbetsordern som uppgiften hör till, och du saknar behörighet att läsa arbetsordrar.");
  const order = ctx.db.tasks.find((item) => item.id === task.workOrderId && item.kind === "WORK_ORDER");
  if (!order) throw new DemoError(404, "Arbetsordern hittades inte.");
  return order;
};
// Same status as the server: every linked task and all planning, whatever the viewer may read.
const projectStatus = (ctx: Context, project: DemoDatabase["projects"][number]) => summarizeProjectStatus({
  archivedAt: project.archivedAt, closedAt: project.closedAt, startDate: project.startDate, dueDate: project.dueDate, now: ctx.now,
  tasks: ctx.db.tasks.filter((task) => task.projectId === project.id),
  activities: ctx.db.activities.filter((activity) => !activity.deletedAt && activity.projectId === project.id),
});
// Ansvarig (simulation 2026-10-10): with the job's area, whether each person may read it – the same rule as Cloud.
const members = (ctx: Context, subject?: WorkflowPermissionSubject | null) => ctx.db.users.map((user) => ({ id: user.id, name: user.name, ...(subject ? { canRead: memberMayReadJob({ role: user.role, workflowPermissions: user.permissions }, subject) } : {}) }));
// The place with its whole way and the facility's address, as the server gives it (Platser, 2026-10-04).
const facilitySummary = (ctx: Context, id: string | null | undefined) => {
  return placeSummary(ctx.db.facilities, id);
};
const customerWithFacilities = (ctx: Context, customer: DemoDatabase["customers"][number]) => ({ ...customer, facilities: ctx.db.facilities.filter((facility) => facility.customerId === customer.id) });
// Reported time outside the project's frame (decision 6), in Swedish calendar days.
const outsideFrameMinutes = (ctx: Context, project: DemoDatabase["projects"][number]) => {
  if (!project.startDate || !project.dueDate) return 0;
  const seconds = ctx.db.timeEntries.filter((entry) => entry.endedAt && sourceOf(ctx, entryOwnerId(entry))?.projectId === project.id)
    .filter((entry) => { const day = swedishDayKey(entry.startedAt); return day < project.startDate! || day > project.dueDate; })
    .reduce((sum, entry) => sum + entry.durationSec, 0);
  return Math.round(seconds / 60);
};

function taskSummary(ctx: Context, task: DemoTask) {
  return {
    id: task.id, title: task.title, kind: task.kind, status: task.status, progress: workflowTaskProgress(task), dueDate: task.dueDate, updatedAt: task.updatedAt, projectId: task.projectId,
    assignedToUserId: task.assignedToUserId, assignedToName: task.assignedToName, totalDurationSec: durationSec(entriesFor(ctx, task.id), ctx.now), isMine: isMine(ctx, task),
    // Tidplan (steg 2): the project's Uppskattat and the weighted completion read them.
    plannedStartDate: task.plannedStartDate ?? "", estimatedMinutes: task.estimatedMinutes ?? null, stage: task.stage ?? "", createdAt: task.createdAt, obstacle: jobObstacle(task),
  };
}
function taskSnapshot(task: DemoTask) {
  const { revisions, ...rest } = task;
  void revisions;
  return { ...rest, progress: workflowTaskProgress(task) };
}
function addRevision(ctx: Context, task: DemoTask) {
  task.revisions.unshift({ id: nextId(ctx, "revision"), version: task.version, snapshot: taskSnapshot(task), createdAt: task.updatedAt });
}

// ---------- /api/workspace ----------
function workspace(ctx: Context, request: Request) {
  if (request.method === "GET") {
    const action = request.url.searchParams.get("action") || "overview";
    if (action === "customer") {
      const customer = ctx.db.customers.find((item) => item.id === request.url.searchParams.get("id") && !item.deletedAt);
      if (!customer) throw new DemoError(404, "Kunden hittades inte.");
      return customer;
    }
    if (action === "customers") return { customers: [...ctx.db.customers].sort((a, b) => a.name.localeCompare(b.name, "sv")).map((customer) => customerWithFacilities(ctx, customer)) };
    if (action !== "overview") throw new DemoError(404, "Finns inte i demon.");
    return {
      // Like the server: no task or customer lists.
      projects: ctx.can("projects", "read") ? ctx.db.projects.map(({ id, name, description, startDate, dueDate, customerId, facilityId, updatedAt, archivedAt, closedAt, responsibleUserId, responsibleName, client, contactPerson, reference, workSite, staffRegister }) => ({
        id, name, description, startDate: startDate ?? "", dueDate, customerId, facilityId: facilityId ?? null, facility: facilitySummary(ctx, facilityId), updatedAt, archivedAt, closedAt: closedAt ?? null, responsibleUserId, responsibleName,
        client: client ?? "", contactPerson: contactPerson ?? "", reference: reference ?? "", workSite: workSite ?? "", staffRegister: staffRegisterOf(staffRegister) })) : [],
      wallet: { balance: 0, testMode: false },
      entries: [], entryCount: 0,
      settings: ctx.db.settings,
      // The demo asks for no setup and announces no update (2026-10-07: four layers at once on /demo).
      preferences: preferencesSchema.parse(ctx.db.preferences[ctx.user.id] ?? { tours: { setup: "demo", releaseNotes: currentAppVersion() } }),
      organization: ctx.db.organization,
      admin: ctx.admin, canDeleteControls: ctx.admin, workflowPermissions: ctx.user.permissions,
      testAdmin: false, aiEnabled: false, aiConfigured: false, paymentsEnabled: false, paymentSandbox: false, legalRequired: false,
    };
  }
  const input = request.body as Json;
  // Merged like the server's (a save carries only what changed).
  if (input.action === "preferences") { ctx.db.preferences[ctx.user.id] = mergePreferences(ctx.db.preferences[ctx.user.id] ?? { tours: { setup: "demo", releaseNotes: currentAppVersion() } }, input.data); return { ok: true }; }
  // What the company works with has no effect of its own in the demo; the guide's save is simply taken.
  if (input.action === "work_areas") { requireAdmin(ctx); return { ok: true }; }
  if (input.action === "settings") {
    requireAdmin(ctx);
    const data = input.data as { companyName?: string; contactEmail?: string; reportBranding?: { primary: string; accent: string; soft: string } };
    Object.assign(ctx.db.settings, { companyName: data.companyName ?? ctx.db.settings.companyName, contactEmail: data.contactEmail ?? ctx.db.settings.contactEmail },
      data.reportBranding ? { reportPrimary: data.reportBranding.primary, reportAccent: data.reportBranding.accent, reportSoft: data.reportBranding.soft } : {});
    return { ok: true };
  }
  if (input.action === "risk_exception") {
    requireAdmin(ctx);
    ctx.db.settings.riskException = (input.data as { on?: unknown })?.on !== false;
    return { ok: true };
  }
  if (input.action === "maintenance") {
    requireAdmin(ctx);
    ctx.db.settings.maintenance = (input.data as { on?: unknown })?.on === true;
    return { ok: true };
  }
  if (input.action === "customer_save") {
    const data = input.data as Record<string, string>;
    const values = { name: data.name?.trim() || "", company: data.company ?? "", address: data.address ?? "", postalCode: data.postalCode ?? "", city: data.city ?? "", email: data.email ?? "", phone: data.phone ?? "", mobile: data.mobile ?? "", notes: data.notes ?? "", lat: data.lat ? Number(data.lat) : null, lng: data.lng ? Number(data.lng) : null,
      // Särskilda krav (2026-10-07): left as it is when the page does not send it, like the server.
      ...(data.specialRequirements !== undefined ? { specialRequirements: data.specialRequirements } : {}),
      // Kundtyp (2026-10-10): likewise kept when not sent; a new customer is a company.
      ...(data.customerType === "PRIVATE" || data.customerType === "COMPANY" ? { customerType: data.customerType as "PRIVATE" | "COMPANY" } : {}),
      // Kundnummer i bokföringen (plan 1L, 2026-10-11): kept when not sent, like the server.
      ...(data.accountingCustomerNumber !== undefined ? { accountingCustomerNumber: data.accountingCustomerNumber.trim().slice(0, 60) } : {}) };
    if (!values.name) throw new DemoError(422, "Ange kundens namn.");
    const current = typeof input.id === "string" ? ctx.db.customers.find((item) => item.id === input.id) : undefined;
    if (current) { Object.assign(current, values, { version: current.version + 1 }); return { ok: true, id: current.id }; }
    // The new customer's id, like Cloud's reply, so the page can read it back and give it its first place.
    const id = nextId(ctx, "customer");
    ctx.db.customers.push({ id, customerType: "COMPANY", ...values, version: 1, deletedAt: null });
    return { ok: true, id };
  }
  throw new DemoError(403, "Rapporter och krediter går inte att prova i demon.");
}

// ---------- /api/records ----------
function records(ctx: Context, request: Request) {
  const params = request.url.searchParams;
  const limit = Math.min(100, Math.max(1, Number(params.get("limit")) || 25));
  if (request.method !== "GET") {
    const input = request.body as { kind: string; action: string; ids: string[] };
    if (input.kind !== "customers") throw new DemoError(403, DEMO_UNAVAILABLE);
    requireAdmin(ctx);
    for (const customer of ctx.db.customers.filter((item) => input.ids.includes(item.id))) customer.deletedAt = input.action === "delete" ? ctx.now.toISOString() : null;
    if (input.action === "purge") ctx.db.customers = ctx.db.customers.filter((item) => !input.ids.includes(item.id));
    return { ok: true, count: input.ids.length };
  }
  const q = (params.get("q") ?? "").trim().toLowerCase();
  const trash = params.get("trash") === "true";
  const direction = params.get("direction") === "asc" ? 1 : -1;
  const sort = params.get("sort") ?? "updated";
  const key = (item: DemoDatabase["customers"][number]) => sort === "email" ? item.email : sort === "address" ? item.address : sort === "updated" ? String((item as { updatedAt?: string }).updatedAt ?? "") : customerTitle(item);
  const type = allowedFilter(params.get("type"), CUSTOMER_FILTERS) ?? "all";
  const searched = ctx.db.customers
    .filter((item) => Boolean(item.deletedAt) === trash)
    .filter((item) => !q || [item.name, item.company, item.address, item.postalCode, item.city, item.email, item.phone, item.notes].join(" ").toLowerCase().includes(q));
  const rows = searched.filter((item) => customerMatchesFilter(item, type))
    .sort((a, b) => direction * key(a).localeCompare(key(b), "sv"));
  const pages = Math.max(1, Math.ceil(rows.length / limit));
  const page = Math.min(pages, Math.max(1, Number(params.get("page")) || 1));
  const count = (customerId: string, kind: DemoTask["kind"]) => ctx.can(workflowSubjectForTask(kind), "read") ? ctx.db.tasks.filter((task) => task.customerId === customerId && task.kind === kind).length : null;
  return { items: rows.slice((page - 1) * limit, page * limit).map((item) => ({ ...item,
    work: { projects: ctx.can("projects", "read") ? ctx.db.projects.filter((project) => project.customerId === item.id).length : null, workOrders: count(item.id, "WORK_ORDER"), riskAssessments: count(item.id, "RISK_ASSESSMENT") } })), ...(params.get("counts") === "1" ? { counts: countByFilter(searched, CUSTOMER_FILTERS, customerMatchesFilter) } : {}), total: rows.length, page, pages, limit };
}

// ---------- /api/customer-card (decision 12B) ----------
function customerCard(ctx: Context, request: Request) {
  const facilities = (ctx.db.facilities ??= []);
  if (request.method === "GET") {
    const params = request.url.searchParams;
    const customer = ctx.db.customers.find((item) => item.id === params.get("id"));
    if (!customer) throw new DemoError(404, "Kunden hittades inte.");
    const kind = (params.get("kind") ?? "all") as "all" | "WORK_ORDER" | "RISK_ASSESSMENT" | "FORM";
    const page = Math.max(1, Number(params.get("page") ?? 1) || 1);
    const own = facilities.filter((facility) => facility.customerId === customer.id);
    const projectName = (id: string | null) => ctx.db.projects.find((project) => project.id === id)?.name ?? "";
    const tasks = readableTasks(ctx).filter((task) => task.customerId === customer.id).map((task) => ({ id: task.id, kind: task.kind, title: task.title, status: task.status, progress: workflowTaskProgress(task), updatedAt: task.updatedAt, facilityId: task.facilityId ?? null, projectName: projectName(task.projectId) }))
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
    const filtered = kind === "all" ? tasks : tasks.filter((task) => task.kind === kind);
    return {
      customer,
      facilities: own.map((facility) => ({ ...facility, links: ctx.db.projects.filter((project) => project.facilityId === facility.id).length + ctx.db.tasks.filter((task) => task.facilityId === facility.id).length,
        openWorkOrders: ctx.can("work-order", "read") ? readableTasks(ctx).filter((task) => task.kind === "WORK_ORDER" && isTaskOpen(task.status) && task.facilityId === facility.id).length : null })),
      maintenance: ctx.db.settings.maintenance === true,
      projects: ctx.can("projects", "read") ? ctx.db.projects.filter((project) => project.customerId === customer.id).map((project) => ({ id: project.id, name: project.name, startDate: project.startDate ?? "", dueDate: project.dueDate, facilityId: project.facilityId ?? null, status: projectStatus(ctx, project) })) : [],
      canReadProjects: ctx.can("projects", "read"),
      // Kundkortets offerter (2026-10-10): the count and Ny offert, for those who may read quotes.
      quotes: demoCustomerQuotes(ctx, customer.id),
      tasks: {
        items: filtered.slice((page - 1) * 12, page * 12),
        total: filtered.length, page, pages: Math.max(1, Math.ceil(filtered.length / 12)),
        counts: { all: tasks.length, WORK_ORDER: tasks.filter((task) => task.kind === "WORK_ORDER").length, RISK_ASSESSMENT: tasks.filter((task) => task.kind === "RISK_ASSESSMENT").length, FORM: tasks.filter((task) => task.kind === "FORM").length },
      },
      canManageFacilities: ctx.admin,
    };
  }
  const input = request.body as Json;
  if (input.action === "facility_status") {
    requireAdmin(ctx);
    const facility = facilities.find((item) => item.id === input.id);
    if (!facility) throw new DemoError(404, "Platsen hittades inte.");
    Object.assign(facility, { isActive: Boolean(input.isActive), version: facility.version + 1 });
    return { ok: true };
  }
  // Ta bort (2026-10-14), as in Cloud: only a place nothing points to.
  if (input.action === "facility_delete") {
    const facility = facilities.find((item) => item.id === input.id);
    if (!facility) throw new DemoError(404, "Platsen hittades inte.");
    const message = placeInUseMessage({
      children: facilities.filter((item) => item.parentId === facility.id).length,
      projects: ctx.db.projects.filter((project) => project.facilityId === facility.id).length,
      workflowTasks: ctx.db.tasks.filter((task) => task.facilityId === facility.id).length,
      // A round from before 2026-10-27 (kväll) still points at its stored place, as in Cloud.
      formSchedules: ctx.db.schedules.filter((schedule) => schedule.legacyPlace?.facilityId === facility.id).length,
    });
    if (message) throw new DemoError(409, message);
    facilities.splice(facilities.indexOf(facility), 1);
    return { ok: true };
  }
  const parsed = customerFacilityInputSchema.safeParse(input.facility);
  if (!parsed.success) throw new DemoError(400, parsed.error.issues[0]?.message ?? "Platsen är ofullständig.");
  if (!ctx.db.customers.some((item) => item.id === input.customerId && !item.deletedAt)) throw new DemoError(404, "Kunden hittades inte.");
  const place = normalizeFacilityInput(parsed.data);
  const parentError = placeParentError(facilities, { id: input.id ? String(input.id) : undefined, customerId: String(input.customerId), parentId: place.parentId });
  if (parentError) throw new DemoError(400, parentError);
  const current = input.id ? facilities.find((item) => item.id === input.id && item.customerId === input.customerId) : undefined;
  if (input.id && !current) throw new DemoError(409, "Platsen har ändrats eller finns inte längre.");
  if (current) { Object.assign(current, place, { version: current.version + 1 }); return { id: current.id }; }
  const created = { ...place, id: nextId(ctx, "facility"), customerId: String(input.customerId), isActive: true, version: 1 };
  facilities.push(created);
  return { id: created.id };
}

// ---------- /api/form-schedules (Driftronder; planning in the demo since plan 1I, 2026-10-11) ----------
/**
 * The rounds as in Cloud (app/api/form-schedules): a member reads the rounds of forms they may read; who plans them follows
 * lib/workflow/round-planning.ts – the right to create the form's protocols, the project right for a project's round, and
 * others' rounds only by an admin or the project's responsible person or stand-in. The demo's forms carry no permission
 * area of their own, so every form counts as Formulär, as the demo's protocols do. Saved in memory for the session.
 */
function formSchedules(ctx: Context, request: Request) {
  const today = swedishDayKey(new Date());
  const actor: RoundPlanActor = { admin: ctx.admin, userId: ctx.user.id, permissions: ctx.user.permissions };
  // A round from before 2026-10-27 (kväll) may still have a project stored: it decides who may change it, as before.
  const stateOf = (round: { templateId: string; legacyPlace?: { projectId: string | null } | null; assignedToUserId: string | null }): RoundPlanState => {
    const projectId = round.legacyPlace?.projectId ?? null;
    return { formArea: formPermissionArea(null), projectId, assignedToUserId: round.assignedToUserId, project: projectId ? ctx.db.projects.find((project) => project.id === projectId) ?? undefined : undefined };
  };
  if (request.method === "GET") {
    const params = request.url.searchParams;
    // "Upprepa kontrollen" only asks whether the person may plan a round (of that form).
    if (params.get("canPlan") === "1") {
      const templateId = params.get("templateId");
      if (!templateId) return { canPlan: canPlanRounds(ctx.admin, ctx.user.permissions) };
      return { canPlan: !roundPlanRefusal(actor, stateOf({ templateId, assignedToUserId: ctx.user.id })) };
    }
    // As in Cloud: only the rounds of forms the person may read.
    const schedules = ctx.admin || ctx.can("forms", "read") ? ctx.db.schedules : [];
    // The round on its work order (2026-10-27, punkt 3): the round and period it holds, Starta ronden and the late occurrences.
    const roundOrder = params.get("roundOrder");
    if (roundOrder) return { round: demoRoundOfOrder(ctx, schedules, roundOrder, today) };
    // Driftrond i arbetsordern (2026-10-27): only read – the round's work orders are made by a person, as in Cloud.
    const orders = demoRoundOrders(ctx);
    if (params.get("planning") === "1") {
      const period = planningRoundPeriod(params.get("from"), params.get("to"), today);
      return { today, ...period, ...planningRounds(schedules, ctx.db.tasks, period, today, undefined, orders, swedishClock()) };
    }
    const views = scheduleViews(schedules, ctx.db.tasks, today, orders, swedishClock()).map((view) => ({ ...view, canEdit: ctx.admin || !roundPlanRefusal(actor, stateOf(view)) }));
    const hidden = !views.length && !ctx.admin && ctx.db.schedules.length > 0;
    return { canPlan: canPlanRounds(ctx.admin, ctx.user.permissions), canPlanOthers: ctx.admin, today, schedules: views, ...(hidden ? { hidden: true } : {}) };
  }
  // Ej utfört (2026-10-28) is Cloud only: the demo does not offer it (no canMarkNotDone) and refuses it if asked.
  const asked = (request.body as { action?: unknown } | null)?.action;
  if (asked === "mark_not_done" || asked === "revoke_not_done") throw new DemoError(409, "Ej utfört finns inte i demon.");
  const input = request.body as { action: "save"; schedule: unknown } | { action: "delete"; id: string };
  const currentId = input.action === "delete" ? input.id : (input.schedule as { id?: string } | null)?.id;
  const current = currentId ? ctx.db.schedules.find((schedule) => schedule.id === currentId) ?? null : null;
  if (currentId && !current) throw new DemoError(404, "Ronden hittades inte.");
  if (input.action === "delete") {
    if (!ctx.admin) { const refusal = roundChangeRefusal(actor, stateOf(current!), null); if (refusal) throw new DemoError(403, refusal); }
    ctx.db.schedules = ctx.db.schedules.filter((schedule) => schedule.id !== input.id);
    return { ok: true };
  }
  const parsed = formScheduleInputSchema.safeParse(input.schedule);
  if (!parsed.success) throw new DemoError(400, parsed.error.issues[0]?.message ?? "Kontrollera uppgifterna.");
  const schedule = parsed.data;
  if (!ctx.admin) {
    const refusal = roundChangeRefusal(actor, current ? stateOf(current) : null, stateOf({ ...schedule, legacyPlace: current?.legacyPlace }));
    if (refusal) throw new DemoError(403, refusal);
  }
  const form = ctx.db.forms.find((item) => item.id === schedule.templateId);
  if (!form) throw new DemoError(400, "Formuläret hittades inte.");
  const assignee = schedule.assignedToUserId ? ctx.db.users.find((user) => user.id === schedule.assignedToUserId) : null;
  if (schedule.assignedToUserId && !assignee) throw new DemoError(400, "Den ansvariga är inte medlem i företaget.");
  if (current && schedule.version !== undefined && current.version !== schedule.version) throw new DemoError(409, "Ronden har ändrats eller tagits bort. Läs in sidan på nytt.");
  // The round is the time rules (2026-10-27 kväll): what an older round stored of its place is kept, a new one has none.
  const saved = {
    ...schedule, id: current?.id ?? nextId(ctx, "schedule"), version: (current?.version ?? 0) + 1, templateName: form.name,
    assignedToName: assignee?.name ?? "", legacyPlace: current?.legacyPlace ?? null,
  };
  if (current) ctx.db.schedules = ctx.db.schedules.map((item) => item.id === current.id ? saved : item);
  else ctx.db.schedules = [...ctx.db.schedules, saved];
  return { id: saved.id };
}

/** The demo's round work orders (the ones holding a round for a period, and 0.24.0's per day), as the round views read them. */
// Where the round is done (2026-10-27 kväll): each work order's customer, place, temporary place and project with their names.
const demoRoundOrders = (ctx: Context) => ctx.db.tasks.flatMap((task) => {
  const ref = task.kind === "WORK_ORDER" ? roundOrderRef({ ...task, plannedStartDate: task.plannedStartDate ?? "" }) : null;
  if (!ref) return [];
  const customer = ref.customerId ? ctx.db.customers.find((item) => item.id === ref.customerId) : undefined;
  const place = ref.facilityId ? (ctx.db.facilities ?? []).find((item) => item.id === ref.facilityId) : undefined;
  return [{ ...ref, customerName: customer ? customerTitle(customer) : "", facilityName: place?.name ?? "", projectName: ref.projectId ? ctx.db.projects.find((item) => item.id === ref.projectId)?.name ?? "" : "",
    facilityPosition: typeof place?.latitude === "number" && typeof place.longitude === "number" ? { latitude: place.latitude, longitude: place.longitude } : null }];
});
/** The days registered in a work order (its protocols' `values.round`). */
const demoRegisteredOccurrences = (ctx: Context, workOrderId: string) => ctx.db.tasks.flatMap((task) => { const round = task.workOrderId === workOrderId ? roundOfProtocolValues(task.data) : null; return round && task.status !== "CANCELLED" ? [round.occurrence] : []; });
/** The round on its work order, as Cloud's lib/kfid/rounds-server.ts roundOfOrder. */
function demoRoundOfOrder(ctx: Context, schedules: DemoDatabase["schedules"], workOrderId: string, today: string) {
  const order = ctx.db.tasks.find((task) => task.id === workOrderId && task.kind === "WORK_ORDER");
  if (!order) throw new DemoError(404, "Arbetsordern hittades inte.");
  if (!order.roundScheduleId) return null;
  const round = schedules.find((item) => item.id === order.roundScheduleId);
  return roundOrderSummary(order, round ?? null, new Set(round ? demoRegisteredOccurrences(ctx, order.id) : []), today, swedishClock());
}

// ---------- /api/places?register=1 (Alla objekt, Underhåll 2026-10-06) ----------
function placeRegister(ctx: Context, request: Request) {
  const params = request.url.searchParams;
  const filter = placeRegisterFilterSchema.catch(emptyPlaceRegisterFilter()).parse(Object.fromEntries(["level", "objectType", "criticality", "state", "q", "sort"].map((key) => [key, params.get(key) ?? undefined])));
  const live = new Set(ctx.db.customers.filter((customer) => !customer.deletedAt).map((customer) => customer.id));
  const places = (ctx.db.facilities ?? []).filter((place) => live.has(place.customerId));
  const result = listPlaceRegister(places, filter, Math.max(1, Number(params.get("page")) || 1));
  const customerName = (id: string) => { const customer = ctx.db.customers.find((item) => item.id === id); return customer ? customerTitle(customer) : ""; };
  const open = (id: string) => ctx.can("work-order", "read") ? readableTasks(ctx).filter((task) => task.kind === "WORK_ORDER" && isTaskOpen(task.status) && task.facilityId === id).length : null;
  return { ...result, items: result.items.map((item) => ({ ...item, customerName: customerName(item.place.customerId), openWorkOrders: open(item.place.id) })), objectTypes: objectTypeOptions(ctx.db.facilities ?? []), counts: placeRegisterCounts(places, filter) };
}

// ---------- /api/places?id= (the place page, 2026-10-09) ----------
// Cloud's placeView (lib/kfid/place-server.ts) on the invented data: the place, its way, the places below and what was
// done there. Rounds and limit profiles are not invented, so those tabs are empty.
function placePage(ctx: Context, request: Request) {
  const params = request.url.searchParams;
  const facilities = ctx.db.facilities ?? [];
  const place = facilities.find((item) => item.id === params.get("id"));
  if (!place) throw new DemoError(404, "Platsen finns inte i ditt företag.");
  const customer = ctx.db.customers.find((item) => item.id === place.customerId);
  const places = facilities.filter((item) => item.customerId === place.customerId);
  const ids = placeWithDescendants(places, place.id);
  const depth = placeChain(places, place.id).length;
  const at = (facilityId: string | null | undefined) => facilityId && facilityId !== place.id ? placePath(places, facilityId).split(" › ").slice(depth).join(" › ") : "";
  const page = Math.max(1, Number(params.get("page")) || 1);
  const tasks = readableTasks(ctx).filter((task) => task.facilityId && ids.has(task.facilityId)).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  const open = (id: string) => ctx.can("work-order", "read") ? readableTasks(ctx).filter((task) => task.kind === "WORK_ORDER" && isTaskOpen(task.status) && task.facilityId === id).length : null;
  const position = placePosition(places, place.id);
  const positionFrom = position && !position.own ? [...placeChain(places, place.id)].reverse().find((item) => typeof item.latitude === "number" && typeof item.longitude === "number") : undefined;
  const canEdit = (ctx.admin || ctx.can("customers", "edit")) && !customer?.deletedAt;
  return {
    place: { ...place, ...placeObjectOf(place), kind: placeKindOf(place), path: placePath(places, place.id), ...placeAddress(places, place.id), ownAddress: { address: place.address, postalCode: place.postalCode, city: place.city }, position,
      positionFrom: positionFrom ? { id: positionFrom.id, name: placeName(positionFrom) } : null, openWorkOrders: open(place.id) },
    pins: places.filter((item) => item.id !== place.id && item.isActive && ids.has(item.id) && typeof item.latitude === "number" && typeof item.longitude === "number")
      .map((item) => ({ id: item.id, latitude: item.latitude as number, longitude: item.longitude as number, label: at(item.id) || placeName(item) })),
    customer: customer ? { id: customer.id, name: customerTitle(customer), deleted: Boolean(customer.deletedAt) } : null,
    chain: placeChain(places, place.id).map((item) => ({ id: item.id, name: item.name })),
    children: places.filter((item) => item.parentId === place.id && item.isActive).map((item) => ({ id: item.id, name: item.name, kind: placeKindOf(item), ...placeObjectOf(item), children: places.filter((child) => child.parentId === item.id).length, openWorkOrders: open(item.id) })),
    history: { items: tasks.slice(0, page * 20).map((task) => ({ id: task.id, kind: task.kind, title: task.title, status: task.status, progress: workflowTaskProgress(task), updatedAt: task.updatedAt, below: at(task.facilityId), assignedToName: task.assignedToName ?? "",
      href: `/?view=workflow_task&taskId=${encodeURIComponent(task.id)}&taskType=${task.kind}` })), total: tasks.length, page },
    projects: ctx.can("projects", "read") ? ctx.db.projects.filter((project) => project.facilityId && ids.has(project.facilityId)).map((project) => ({ id: project.id, name: project.name, startDate: project.startDate ?? "", dueDate: project.dueDate, closedAt: null, archivedAt: null, below: at(project.facilityId) })) : [],
    rounds: [], limits: [],
    maintenance: ctx.db.settings.maintenance === true,
    places: canEdit ? places.map((item) => ({ ...item, ...placeObjectOf(item) })) : [],
    canCreate: { workOrder: ctx.admin || ctx.can("work-order", "create") },
    canEdit,
  };
}

// ---------- /api/projects ----------
const projectInput = z.object({
  id: z.string().optional(), name: z.string().trim().min(1).max(160), description: z.string().trim().max(2000).default(""), startDate: z.union([z.literal(""), z.iso.date()]).default(""), dueDate: z.union([z.literal(""), z.iso.date()]).default(""),
  client: z.string().trim().max(200).default(""), contactPerson: z.string().trim().max(200).default(""), reference: z.string().trim().max(120).default(""), workSite: z.string().trim().max(300).default(""),
  staffRegister: staffRegisterInputSchema.optional(),
  customerChange: z.enum(["move_jobs"]).optional(),
  customerId: z.string().nullable().default(null), facilityId: z.string().nullable().default(null), responsibleUserId: z.string().nullable().default(null), timeBudgetMinutes: z.number().int().min(0).optional(),
  shiftDays: z.number().int().min(-3650).max(3650).default(0),
  taskTypes: z.array(z.enum(["WORK_ORDER", "RISK_ASSESSMENT", "COMMISSIONING_CONTROL"])).default([]), workMoments: z.array(z.enum(["START_TIME", "EXECUTION", "SIGN_REPORT", "CLOSE_ORDER"])).default([]),
});
function projects(ctx: Context, request: Request) {
  if (request.method === "GET") {
    const eventsFor = request.url.searchParams.get("eventsFor");
    if (eventsFor) {
      ctx.require("projects", "read");
      const before = Date.parse(request.url.searchParams.get("before") ?? "");
      const project = ctx.db.projects.find((item) => item.id === eventsFor);
      if (!project) throw new DemoError(404, "Projektet hittades inte.");
      return { events: [...project.events].sort((a, b) => b.createdAt.localeCompare(a.createdAt)).filter((event) => Number.isNaN(before) || Date.parse(event.createdAt) < before).slice(0, 20) };
    }
    const decisionsFor = request.url.searchParams.get("decisionsFor");
    if (decisionsFor) {
      ctx.require("projects", "read");
      const before = Date.parse(request.url.searchParams.get("before") ?? "");
      const project = ctx.db.projects.find((item) => item.id === decisionsFor);
      return { decisions: [...(project?.decisions ?? [])].sort((a, b) => b.createdAt.localeCompare(a.createdAt)).filter((decision) => Number.isNaN(before) || Date.parse(decision.createdAt) < before).slice(0, 20) };
    }
    const params = request.url.searchParams;
    const tasks = readableTasks(ctx);
    const byUpdated = <T extends { updatedAt: string }>(a: T, b: T) => b.updatedAt.localeCompare(a.updatedAt);
    // Koppla befintlig uppgift (decision 7): standalone work and work in other projects that accept it.
    const candidatesFor = params.get("candidatesFor");
    if (candidatesFor) {
      ctx.require("projects", "read");
      const open = (projectId: string | null) => !projectId || (projectId !== candidatesFor && !projectArchived(ctx, projectId) && !projectClosed(ctx, projectId));
      const projectName = (projectId: string | null) => ctx.db.projects.find((item) => item.id === projectId)?.name;
      const plannedCount = (id: string) => ctx.db.activities.filter((activity) => !activity.deletedAt && activity.workflowTaskId === id).length;
      return { tasks: tasks.filter((task) => open(task.projectId)).map((task) => ({ ...taskSummary(ctx, task), customerId: task.customerId, roundScheduleId: task.roundScheduleId, fromProject: projectName(task.projectId), plannedCount: plannedCount(task.id) })).sort(byUpdated) };
    }
    const listTab = PROJECT_LIST_FILTERS.find((tab) => tab === params.get("list"));
    const onlyId = params.get("id");
    const readable = ctx.can("projects", "read") ? [...ctx.db.projects].sort(byUpdated) : [];
    // The same bounded modes as the server: a page of one tab (Mina / Alla, sorted), one project, or everything for planning.
    const page = Math.max(1, Number(params.get("page")) || 1);
    const scope = resolveWorkListScope(params.get("scope") ?? "all", WORK_LIST_SCOPES);
    // Status (dashboard etapp 3): the ongoing projects that need attention, by the key figure's rule.
    const attention = allowedFilter(params.get("status"), PROJECT_ATTENTION);
    const booked = bookedForMe(ctx);
    const listed = listTab ? listWork(readable.filter((project) => !attention || projectListTab(project) !== "ongoing" || projectAttention(projectAttentionOf(ctx, project), attention)).map((project) => ({
      project, id: project.id, title: project.name, updatedAt: project.updatedAt, date: project.dueDate,
      mine: isMyDemoProject(ctx, project, booked),
      search: [project.name, project.description, project.responsibleName, ctx.db.customers.find((item) => item.id === project.customerId)?.name ?? "", ctx.db.customers.find((item) => item.id === project.customerId)?.company ?? ""],
    })), {
      filters: PROJECT_LIST_FILTERS, matches: (entry, tab) => projectListTab(entry.project) === tab, filter: listTab, scope, page, limit: 12, q: params.get("q") ?? "",
      sort: (WORK_LIST_SORTS as readonly string[]).includes(params.get("sort") ?? "") ? params.get("sort") as WorkListSort : "updated", counts: workListCountsAllowed(scope, ctx.admin),
    }) : null;
    const shown = listed ? listed.items.map((entry) => entry.project) : onlyId ? readable.filter((project) => project.id === onlyId) : readable;
    return {
      ...(listed ? { total: listed.total, page, pages: listed.pages, counts: listed.counts } : {}),
      projects: shown.map((project) => {
        const events = [...project.events].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
        const decisions = [...(project.decisions ?? [])].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
        const customer = ctx.db.customers.find((item) => item.id === project.customerId);
        return {
          ...project, staffRegister: staffRegisterOf(project.staffRegister), startDate: project.startDate ?? "", closedAt: project.closedAt ?? null, facilityId: project.facilityId ?? null, facility: facilitySummary(ctx, project.facilityId),
          status: projectStatus(ctx, project), outsideFrameMinutes: outsideFrameMinutes(ctx, project),
          // Projekttid (2026-10-26): the project's own time, as the server.
          projectTimeSec: durationSec(ctx.db.timeEntries.filter((entry) => entry.projectId === project.id), ctx.now),
          events: listTab ? [] : events.slice(0, 10), eventCount: events.length, decisions: listTab ? [] : decisions.slice(0, 10), decisionCount: decisions.length,
          customer: customer ? { id: customer.id, name: customer.name, company: customer.company } : null,
          // Material i projektet (2026-10-09): as Cloud, for the one project shown and only with work-order:read.
          ...(onlyId && ctx.can("work-order", "read") ? { materials: summarizeProjectMaterials(workOrderMaterialSources(tasks.filter((task) => task.projectId === project.id).sort(byUpdated)), undefined, { prices: ctx.can("catalogue", "read") || ctx.can("quotes", "read") }) } : {}),
          // Samlad bild (Fas 4B): the work order each task belongs to and the job's current step, as in Cloud's project view.
          workflowTasks: tasks.filter((task) => task.projectId === project.id).sort(byUpdated).map((task) => ({ ...taskSummary(ctx, task), workOrderId: task.workOrderId ?? null,
            ...(onlyId ? { step: localJobStep(ctx.db.tasks, task) } : {}) })),
        };
      }),
      workflowTasks: listTab || onlyId ? [] : tasks.filter((task) => !task.projectId).sort(byUpdated).map((task) => taskSummary(ctx, task)),
      members: members(ctx),
      currentUserId: ctx.user.id,
    };
  }
  const input = request.body as Json;
  const actor = ctx.user.name;
  const find = (id: unknown) => { const project = ctx.db.projects.find((item) => item.id === id); if (!project) throw new DemoError(404, "Projektet hittades inte."); return project; };
  const event = (project: DemoDatabase["projects"][number], kind: string, summary: string, taskId: string | null = null) => {
    project.events.push({ id: nextId(ctx, "event"), kind, summary, taskId, actorName: actor, createdAt: ctx.now.toISOString() });
    project.updatedAt = ctx.now.toISOString();
  };
  // Ställföreträdare (2026-10-09): the same rule and history as the server's planning_delegate action.
  if (input.action === "planning_delegate") {
    ctx.require("projects", "read");
    const project = find(input.id);
    if (!canHandOverPlanning({ admin: ctx.admin, userId: ctx.user.id, responsibleUserId: project.responsibleUserId, canEditProjects: ctx.can("projects", "edit") }))
      throw new DemoError(403, "Bara projektansvarig eller en företagsadministratör kan lämna över eller ta tillbaka rätten att ändra andras bokningar.");
    if (project.archivedAt) throw new DemoError(409, "Återställ projektet från arkivet först.");
    const userId = typeof input.userId === "string" && input.userId ? input.userId : null;
    if (userId && userId === project.responsibleUserId) throw new DemoError(400, "Projektansvarig har redan rätten. Välj en annan person som ställföreträdare.");
    if (userId && !ctx.db.users.some((user) => user.id === userId)) throw new DemoError(400, "Ställföreträdaren måste vara en aktiv medlem i företaget.");
    const previous = project.planningDelegateUserId ?? null;
    if (previous !== userId) {
      project.planningDelegateUserId = userId;
      event(project, userId ? "PLANNING_DELEGATED" : "PLANNING_DELEGATE_REVOKED", planningDelegateSummary(previous ? userName(ctx, previous) : "", userId ? userName(ctx, userId) : ""));
    }
    return { ok: true, planningDelegateUserId: userId };
  }
  if (input.action === "decision") {
    ctx.require("projects", "edit");
    const project = find(input.projectId);
    if (project.archivedAt) throw new DemoError(409, "Återställ projektet innan du lägger till ett beslut.");
    const parsed = projectDecisionInputSchema.safeParse(input.decision);
    if (!parsed.success) throw new DemoError(400, parsed.error.issues[0]?.message ?? "Beslutet är ofullständigt.");
    const decision = { ...parsed.data, id: nextId(ctx, "decision"), actorName: actor, createdAt: ctx.now.toISOString() };
    project.decisions = [...(project.decisions ?? []), decision];
    return { id: decision.id };
  }
  if (input.action === "link") {
    ctx.require("projects", "edit");
    const project = find(input.projectId);
    if (project.archivedAt) throw new DemoError(409, "Återställ projektet innan du kopplar en uppgift.");
    if (project.closedAt) throw new DemoError(409, "Projektet är avslutat. Återöppna projektet innan du kopplar en uppgift.");
    const apply = { customer: true, responsible: false, dueDate: "", ...(input.apply as object | undefined) } as { customer: boolean; responsible: boolean; dueDate: string };
    const task = ctx.db.tasks.find((item) => item.id === input.taskId);
    if (!task) throw new DemoError(404, "Uppgiften hittades inte.");
    // Arbetsordern styr (2026-10-26): only a work order moves to a project; its tasks follow, like the server.
    if (task.kind !== "WORK_ORDER") throw new DemoError(409, PROJECT_LINK_WORK_ORDER_ONLY);
    ctx.require(workflowSubjectForTask(task.kind), "edit");
    // The link guide's choices (decision 7); a completed task keeps its content.
    const dueError = apply.dueDate ? taskDueDateError(apply.dueDate, { startDate: project.startDate ?? "", dueDate: project.dueDate }) : null;
    if (dueError) throw new DemoError(400, dueError);
    const open = isTaskOpen(task.status);
    const from = task.projectId ? ctx.db.projects.find((item) => item.id === task.projectId) : undefined;
    Object.assign(task, {
      projectId: project.id,
      customerId: open && apply.customer && project.customerId ? project.customerId : task.customerId,
      assignedToUserId: open && apply.responsible && project.responsibleUserId ? project.responsibleUserId : task.assignedToUserId,
      assignedToName: open && apply.responsible && project.responsibleUserId ? project.responsibleName : task.assignedToName,
      ...datesOnProjectLink(task, { open, chosenDue: apply.dueDate, today: swedishDayKey(ctx.now), frame: { startDate: project.startDate ?? "", dueDate: project.dueDate } }),
      version: task.version + 1, updatedAt: ctx.now.toISOString(), updatedBy: ctx.user.id,
    });
    addRevision(ctx, task);
    if (from && from.id !== project.id) event(from, "TASK_MOVED", `Uppgiften ${task.title} flyttades till projektet ${project.name}`, task.id);
    event(project, from ? "TASK_MOVED" : "TASK_LINKED", from ? `Uppgiften ${task.title} flyttades hit från ett annat projekt` : `Uppgiften ${task.title} kopplades till projektet`, task.id);
    for (const activity of ctx.db.activities.filter((item) => !item.deletedAt && item.workflowTaskId === task.id)) activity.projectId = project.id;
    followDemoWorkOrder(ctx.db.tasks, task, ctx.now.toISOString());
    return { ok: true };
  }
  if (input.action === "archive" || input.action === "restore") {
    const project = find(input.id);
    if (!canArchiveProject({ admin: ctx.admin, userId: ctx.user.id, responsibleUserId: project.responsibleUserId, canEditProjects: ctx.can("projects", "edit"), canArchiveProjects: ctx.can("projects", "archive") }))
      throw new DemoError(403, "Bara projektansvarig, en företagsadministratör eller den som fått rätten kan arkivera projektet.");
    const archive = input.action === "archive";
    if (Boolean(project.archivedAt) !== archive) { project.archivedAt = archive ? ctx.now.toISOString() : null; event(project, archive ? "ARCHIVED" : "RESTORED", archive ? "Projektet arkiverades" : "Projektet återställdes"); }
    return { ok: true };
  }
  if (input.action === "close" || input.action === "reopen_project") {
    const project = find(input.id);
    if (!canManageProjectLifecycle({ admin: ctx.admin, userId: ctx.user.id, responsibleUserId: project.responsibleUserId, canEditProjects: ctx.can("projects", "edit") }))
      throw new DemoError(403, "Bara projektansvarig eller en företagsadministratör kan avsluta eller återöppna projektet.");
    if (project.archivedAt) throw new DemoError(409, "Återställ projektet från arkivet först.");
    const close = input.action === "close";
    if (close && !project.closedAt && projectStatus(ctx, project).state !== "READY_TO_CLOSE")
      throw new DemoError(409, "Projektet kan avslutas först när alla uppgifter är slutförda och ingen planering är aktiv.");
    if (Boolean(project.closedAt) !== close) { project.closedAt = close ? ctx.now.toISOString() : null; event(project, close ? "CLOSED" : "REOPENED", close ? "Projektet avslutades" : "Projektet återöppnades"); }
    return { ok: true };
  }
  if (input.action === "delete") {
    ctx.require("projects", "archive");
    requireAdmin(ctx);
    const project = find(input.id);
    for (const task of ctx.db.tasks.filter((item) => item.projectId === project.id)) task.projectId = null;
    for (const activity of ctx.db.activities.filter((item) => item.projectId === project.id)) activity.projectId = null;
    ctx.db.projects = ctx.db.projects.filter((item) => item.id !== project.id);
    return { ok: true };
  }
  const data = projectInput.parse(input.project);
  ctx.require("projects", data.id ? "edit" : "create");
  if (data.customerId && !ctx.db.customers.some((item) => item.id === data.customerId && !item.deletedAt)) throw new DemoError(400, "Kunden hittades inte.");
  if (data.responsibleUserId && !ctx.db.users.some((user) => user.id === data.responsibleUserId)) throw new DemoError(400, "Projektansvarig tillhör inte arbetsytan.");
  const frameError = projectFrameError({ startDate: data.startDate, dueDate: data.dueDate }, !data.id);
  if (frameError) throw new DemoError(400, frameError);
  if (data.id) {
    const existing = find(data.id);
    if ((existing.startDate ?? "") !== data.startDate || existing.dueDate !== data.dueDate) {
      if (!canManageProjectLifecycle({ admin: ctx.admin, userId: ctx.user.id, responsibleUserId: existing.responsibleUserId, canEditProjects: ctx.can("projects", "edit") }))
        throw new DemoError(403, "Bara projektansvarig eller en företagsadministratör kan ändra projektets tidsram.");
    }
  }
  if (data.facilityId) {
    const facilityError = facilityLinkError((ctx.db.facilities ?? []).find((facility) => facility.id === data.facilityId), { customerId: data.customerId, facilityId: data.facilityId, previousFacilityId: data.id ? find(data.id).facilityId : null });
    if (facilityError) throw new DemoError(400, facilityError);
  }
  const values = { name: data.name, description: data.description, startDate: data.startDate, dueDate: data.dueDate, client: data.client, contactPerson: data.contactPerson, reference: data.reference, workSite: data.workSite, customerId: data.customerId, facilityId: data.facilityId, responsibleUserId: data.responsibleUserId, responsibleName: userName(ctx, data.responsibleUserId), taskTypes: data.taskTypes, workMoments: data.workMoments };
  // Personalliggare (steg 0): an older caller without the field keeps the stored value, as on the server.
  // Workflow's own register (steg 1) keeps identity numbers on the server only, so the demo never turns it on.
  const staffRegister = { ...(data.staffRegister ?? (data.id ? staffRegisterOf(find(data.id).staffRegister) : EMPTY_STAFF_REGISTER)), inWorkflow: false };
  // Beställare and Kontaktperson follow the customer (2026-10-10), as on the server.
  const customerOf = (id: string | null | undefined) => id ? ctx.db.customers.find((item) => item.id === id) : undefined;
  Object.assign(values, projectCustomerFields({ customer: customerOf(data.customerId), previousCustomer: data.id ? customerOf(find(data.id).customerId) : null, client: values.client, contactPerson: values.contactPerson }));
  if (data.id) {
    const project = find(data.id);
    if (project.archivedAt) throw new DemoError(409, "Återställ projektet innan du redigerar det.");
    // Kundbyte (2026-10-10): the same rule as the server – an explicit choice moves the open jobs, completed work blocks it.
    const toCustomerId = data.customerId;
    const jobs = toCustomerId && toCustomerId !== project.customerId ? ctx.db.tasks.filter((task) => task.projectId === project.id && task.customerId && task.customerId !== toCustomerId) : [];
    const customerChange = toCustomerId ? projectCustomerChange({ fromCustomerId: project.customerId, toCustomerId, fromName: customerDisplayName(customerOf(project.customerId)), toName: customerDisplayName(customerOf(toCustomerId)), jobs }) : null;
    if (customerChange && (customerChange.blocked || data.customerChange !== "move_jobs")) throw new DemoError(409, customerChange.message, { customerChange });
    if (customerChange && toCustomerId) for (const task of jobs.filter((item) => item.status !== "COMPLETED")) {
      const owner = (ctx.db.facilities ?? []).find((facility) => facility.id === task.facilityId)?.customerId ?? null;
      Object.assign(task, { customerId: toCustomerId, facilityId: movedJobPlace({ facilityId: task.facilityId ?? null, facilityCustomerId: owner }, toCustomerId, data.facilityId ?? null), version: task.version + 1, updatedAt: ctx.now.toISOString() });
    }
    const budget = data.timeBudgetMinutes ?? project.timeBudgetMinutes;
    const budgetChanged = budget !== project.timeBudgetMinutes;
    // "Flytta allt lika mycket" (decision 5), as on the server: open tasks' dates and active planning move with the frame.
    const frameChanged = (project.startDate ?? "") !== data.startDate || project.dueDate !== data.dueDate;
    if (frameChanged && data.shiftDays) {
      const move = (value: string) => addSwedishDays(value, data.shiftDays).toISOString();
      const jobs = ctx.db.tasks.filter((item) => item.projectId === project.id);
      const shift = projectShift(jobs, data.shiftDays);
      for (const { job, plannedStartDate, dueDate } of shift.moves) Object.assign(job, { plannedStartDate, dueDate, version: job.version + 1, updatedAt: ctx.now.toISOString() });
      const onProject = (activity: DemoActivity) => activity.projectId === project.id || jobs.some((job) => job.id === activity.workflowTaskId);
      for (const activity of ctx.db.activities.filter((item) => onProject(item) && !(item.workflowTaskId && shift.kept.has(item.workflowTaskId)) && !item.deletedAt && ["PLANNED", "IN_PROGRESS"].includes(item.status))) {
        Object.assign(activity, { startsAt: move(activity.startsAt), endsAt: move(activity.endsAt), version: activity.version + 1 });
        activity.assignments = activity.assignments.map((assignment) => assignment.startsAt && assignment.endsAt ? { ...assignment, startsAt: move(assignment.startsAt), endsAt: move(assignment.endsAt) } : assignment);
      }
    }
    Object.assign(project, values, { staffRegister, timeBudgetMinutes: budget });
    event(project, budgetChanged ? "BUDGET_UPDATED" : "UPDATED", budgetChanged ? `Projektets tidsbudget ändrades till ${budget} minuter` : "Projektets grunduppgifter uppdaterades");
    return { id: project.id };
  }
  const created: DemoDatabase["projects"][number] = { ...values, staffRegister, id: nextId(ctx, "project"), timeBudgetMinutes: data.timeBudgetMinutes ?? 0, archivedAt: null, closedAt: null, createdAt: ctx.now.toISOString(), updatedAt: ctx.now.toISOString(), events: [], decisions: [] };
  ctx.db.projects.push(created);
  event(created, "CREATED", "Projektet skapades");
  return { id: created.id };
}

// ---------- /api/workflow-tasks ----------
function revisionView(task: DemoTask, revisions: DemoTask["revisions"]) {
  return revisions.map((revision) => ({ id: revision.id, version: revision.version, createdAt: revision.createdAt, snapshot: {
    title: revision.snapshot.title, description: revision.snapshot.description, status: revision.snapshot.status, progress: revision.snapshot.progress,
    data: revision.snapshot.data, completedAt: revision.snapshot.completedAt ?? null,
  } }));
}
function workflowTasks(ctx: Context, request: Request) {
  if (request.method === "GET") {
    const revisionsFor = request.url.searchParams.get("revisionsFor");
    if (revisionsFor) {
      const task = readableTasks(ctx).find((item) => item.id === revisionsFor);
      if (!task) throw new DemoError(404, "Uppgiften hittades inte.");
      const before = Number(request.url.searchParams.get("before"));
      return { revisions: revisionView(task, task.revisions.filter((revision) => !(before > 0) || revision.version < before).slice(0, 20)) };
    }
    const historyTemplate = request.url.searchParams.get("formHistory");
    if (historyTemplate) return { items: selectFormHistory(readableTasks(ctx), { taskId: request.url.searchParams.get("exclude") ?? undefined, templateId: historyTemplate, customerId: request.url.searchParams.get("customerId"), facilityId: request.url.searchParams.get("facilityId") }) };
    // The state of linked tasks (a protocol row's work order), as Cloud gives it: title and status within what the viewer
    // may read (simulation 2026-10-10: the demo's row said "Öppna arbetsorder" without its status).
    const links = request.url.searchParams.get("links");
    if (links) {
      const ids = new Set(links.split(",").filter(Boolean).slice(0, 50));
      return { links: readableTasks(ctx).filter((task) => ids.has(task.id)).map((task) => ({ id: task.id, title: task.title, status: task.status, kind: task.kind, dueDate: task.dueDate })) };
    }
    // Ta bort arbetsorder (svar 2b): what the confirmation shows, as the server.
    const removalFor = request.url.searchParams.get("removalFor");
    if (removalFor) {
      const order = ctx.db.tasks.find((item) => item.id === removalFor);
      if (!order) throw new DemoError(404, "Uppgiften hittades inte.");
      const tasks = ctx.db.tasks.filter((item) => item.workOrderId === order.id).map((item) => ({ id: item.id, kind: item.kind, title: item.title, status: item.status, signed: taskIsSigned(item.data) }));
      return { tasks, refusal: workOrderRemovalRefusal(tasks), summary: workOrderRemovalSummary(tasks) };
    }
    const onlyId = request.url.searchParams.get("id");
    const membersOnly = request.url.searchParams.get("members") === "only";
    const subjectParam = request.url.searchParams.get("subject");
    const onlyTask = onlyId ? ctx.db.tasks.find((task) => task.id === onlyId) : undefined;
    const memberSubject = onlyTask ? workflowSubjectForTask(onlyTask.kind) : subjectParam && (["work-order", "risk-assessment", ...FORM_PERMISSION_AREAS] as string[]).includes(subjectParam) ? subjectParam as WorkflowPermissionSubject : null;
    return {
      tasks: (membersOnly ? [] : readableTasks(ctx).filter((task) => !onlyId || task.id === onlyId)).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)).map((task) => {
        const project = ctx.db.projects.find((item) => item.id === task.projectId);
        const customer = ctx.db.customers.find((item) => item.id === task.customerId);
        const entries = entriesFor(ctx, task.id).sort((a, b) => b.startedAt.localeCompare(a.startedAt));
        const order = task.workOrderId ? ctx.db.tasks.find((item) => item.id === task.workOrderId) : undefined;
        const canReadOrders = ctx.can("work-order", "read");
        return {
          ...task, workOrderId: task.workOrderId ?? null,
          workOrder: order ? { id: order.id, status: order.status, title: canReadOrders ? order.title : "", readable: canReadOrders } : null,
          revisions: revisionView(task, task.revisions.slice(0, 10)), revisionCount: task.revisions.length, progress: workflowTaskProgress(task),
          project: project ? { id: project.id, name: project.name } : null, customer: customer ? { id: customer.id, name: customer.name, company: customer.company } : null,
          ...(task.kind !== "WORK_ORDER" && order ? { ownDurationSec: durationSec(entriesFor(ctx, order.id).filter((entry) => entry.sourceTaskId === task.id), ctx.now) } : {}),
          timeEntries: entries, attachments: [], totalDurationSec: durationSec(task.kind !== "WORK_ORDER" && order ? entriesFor(ctx, order.id) : entries, ctx.now), timerRunning: entries.some((entry) => !entry.endedAt && entry.userId === ctx.user.id) || Boolean(order && entriesFor(ctx, order.id).some((entry) => !entry.endedAt && entry.userId === ctx.user.id)),
        };
      }),
      members: members(ctx, memberSubject),
    };
  }
  if (request.method === "DELETE") {
    requireAdmin(ctx);
    const id = request.url.searchParams.get("id");
    const task = ctx.db.tasks.find((item) => item.id === id);
    if (!task) throw new DemoError(404, "Uppgiften hittades inte.");
    // Ta bort arbetsorder (svar 2b): the tasks go with it; refused while one is completed or signed – as the server.
    const inside = ctx.db.tasks.filter((item) => item.workOrderId === id);
    const refusal = workOrderRemovalRefusal(inside.map((item) => ({ id: item.id, kind: item.kind, title: item.title, status: item.status, signed: taskIsSigned(item.data) })));
    if (refusal) throw new DemoError(409, refusal);
    const ids = new Set([task.id, ...inside.map((item) => item.id)]);
    requireTimeOpen(ctx, ctx.db.timeEntries.filter((entry) => entry.taskId && ids.has(entry.taskId)));
    ctx.db.tasks = ctx.db.tasks.filter((item) => !ids.has(item.id));
    demoWorkOrderDeleted(task.id);
    ctx.db.timeEntries = ctx.db.timeEntries.filter((entry) => !entry.taskId || !ids.has(entry.taskId));
    for (const activity of ctx.db.activities.filter((item) => item.workflowTaskId && ids.has(item.workflowTaskId))) activity.workflowTaskId = null;
    return { ok: true, removed: inside.length };
  }
  const input = request.body as Json;
  const now = ctx.now.toISOString();
  // Per-person timers like the server: `onlyMine` closes just the caller's entry. An entry under a minute is discarded
  // like in Cloud (MIN_TIME_ENTRY_SECONDS) unless the person answered "Spara ändå" (`keepShort`, 2026-10-12).
  const closeRunning = (task: DemoTask, onlyMine = false, keepShort = false) => {
    const stopped: { entryId: string; taskId: string; taskTitle: string; startedAt: string; endedAt: string; durationSec: number }[] = [];
    for (const entry of entriesFor(ctx, task.id).filter((item) => !item.endedAt && (!onlyMine || item.userId === ctx.user.id))) {
      const elapsedSec = Math.max(0, Math.floor((ctx.now.getTime() - Date.parse(entry.startedAt)) / 1000));
      const durationSec = keepShort ? Math.max(MIN_TIME_ENTRY_SECONDS, elapsedSec) : elapsedSec;
      if (durationSec < MIN_TIME_ENTRY_SECONDS) { ctx.db.timeEntries = ctx.db.timeEntries.filter((item) => item.id !== entry.id); continue; }
      Object.assign(entry, { endedAt: now, durationSec, updatedAt: now });
      ctx.db.timeEvents.push({ id: nextId(ctx, "time-event"), entryId: entry.id, userId: entry.userId, action: "CREATED", previous: null, reason: "", actorUserId: ctx.user.id, actorName: ctx.user.name,
        next: { taskId: task.id, taskTitle: task.title, startedAt: entry.startedAt, endedAt: now, durationSec: entry.durationSec, note: entry.note }, createdAt: now });
      if (entry.userId === ctx.user.id) stopped.push({ entryId: entry.id, taskId: task.id, taskTitle: task.title, startedAt: entry.startedAt, endedAt: now, durationSec: entry.durationSec });
    }
    return stopped;
  };
  const find = (id: unknown) => { const task = ctx.db.tasks.find((item) => item.id === id); if (!task) throw new DemoError(404, "Uppgiften hittades inte."); return task; };
  // Maskinlarm (S4): "Jag tar den" on a Demokoppling order, by the product's own decision and words.
  if (input.action === "claim_machine_alarm") {
    ctx.require("work-order", "edit");
    const task = ctx.db.tasks.find((item) => item.id === input.id && DEMO_MACHINE_CREATORS.includes(item.createdBy));
    if (!task) throw new DemoError(404, "Arbetsordern hittades inte.");
    const decision = claimDecision({ status: task.status, assignedToUserId: task.assignedToUserId, assignedToName: task.assignedToName }, ctx.user.id);
    if (decision.result === "closed") throw new DemoError(409, claimClosedText);
    if (decision.result === "taken") return { ok: false, taken: true, by: decision.by, message: claimTakenText(decision.by) };
    if (decision.result === "claim") { task.assignedToUserId = ctx.user.id; task.assignedToName = ctx.user.name; task.updatedBy = ctx.user.id; task.updatedAt = ctx.now.toISOString(); task.version += 1; }
    return { ok: true, id: task.id, version: task.version, status: task.status, mine: true };
  }
  if (input.action === "reopen") {
    const task = find(input.id);
    ctx.require(workflowSubjectForTask(task.kind), "reopen");
    if (task.status !== "COMPLETED") return { ok: true };
    const reopenRefusal = demoActionRefusal(ctx.db, ctx.user, task, "reopen");
    if (reopenRefusal) throw new DemoError(403, reopenRefusal);
    if (projectArchived(ctx, task.projectId)) throw new DemoError(409, "Återställ projektet innan du återöppnar uppgiften.");
    if (projectClosed(ctx, task.projectId)) throw new DemoError(409, "Projektet är avslutat. Återöppna projektet innan du återöppnar uppgiften.");
    Object.assign(task, { data: resetWorkflowTaskApproval(task.data as never), status: "NEEDS_ACTION", completedAt: null, version: task.version + 1, updatedAt: now, updatedBy: ctx.user.id });
    addRevision(ctx, task);
    const project = ctx.db.projects.find((item) => item.id === task.projectId);
    project?.events.push({ id: nextId(ctx, "event"), kind: "TASK_REOPENED", summary: `Uppgiften ${task.title} återöppnades`, taskId: task.id, actorName: ctx.user.name, createdAt: now });
    return { ok: true };
  }
  // Utgår and Återuppta (2026-10-09): the same rules as the server (lib/workflow/task-cancel.ts).
  if (input.action === "cancel" || input.action === "restore") {
    const task = find(input.id);
    ctx.require(workflowSubjectForTask(task.kind), "edit");
    const cancel = input.action === "cancel";
    const reason = typeof input.reason === "string" ? input.reason.trim() : "";
    const refusal = cancel ? cancelTaskError(task, reason) : restoreTaskError(task);
    if (refusal) throw new DemoError(409, refusal);
    if (projectArchived(ctx, task.projectId)) throw new DemoError(409, "Återställ projektet först.");
    if (projectClosed(ctx, task.projectId)) throw new DemoError(409, "Projektet är avslutat. Återöppna projektet först.");
    const status = cancel ? CANCELLED_STATUS : restoredTaskStatus(task.cancelledFromStatus);
    const stopped = cancel ? closeRunning(task, false, input.keepShort === true) : [];
    Object.assign(task, cancel
      ? { status, cancelledAt: now, cancelledBy: ctx.user.id, cancelReason: reason, cancelledFromStatus: task.status }
      : { status, cancelledAt: null, cancelledBy: null, cancelReason: "", cancelledFromStatus: null },
    { version: task.version + 1, updatedAt: now, updatedBy: ctx.user.id });
    addRevision(ctx, task);
    const project = ctx.db.projects.find((item) => item.id === task.projectId);
    project?.events.push({ id: nextId(ctx, "event"), kind: "UPDATED", summary: (cancel ? `Jobbet ${task.title} utgår: ${reason}` : `Jobbet ${task.title} återupptogs`).slice(0, 500), taskId: task.id, actorName: ctx.user.name, createdAt: now });
    return { ok: true, status, stopped };
  }
  // Rapportera hinder (plan 1M): the same rules as the server (lib/workflow/obstacles.ts); the demo has one person, so no notice.
  if (input.action === "obstacle" || input.action === "resolve_obstacle") {
    const task = find(input.id);
    ctx.require(workflowSubjectForTask(task.kind), "edit");
    if (input.action === "obstacle" && task.kind !== "WORK_ORDER" && !task.workOrderId) throw new DemoError(409, WORK_ORDER_REQUIRED);
    const blocked = obstacleBlocked(task);
    if (blocked) throw new DemoError(409, blocked);
    if (input.version !== undefined && input.version !== task.version) throw new DemoError(409, "Uppgiften har ändrats. Läs in den senaste versionen.");
    if (projectArchived(ctx, task.projectId)) throw new DemoError(409, "Återställ projektet först.");
    if (projectClosed(ctx, task.projectId)) throw new DemoError(409, "Projektet är avslutat. Återöppna projektet först.");
    const report = input.action === "obstacle";
    const parsed = report ? obstacleInputSchema.safeParse(input.obstacle) : null;
    if (parsed && !parsed.success) throw new DemoError(400, parsed.error.issues[0]?.message ?? "Hindret är inte giltigt.");
    const running = entriesFor(ctx, task.id).some((entry) => !entry.endedAt);
    const applied = parsed?.success ? reportObstacle({ kind: task.kind, status: task.status, data: task.data, hasRunningTime: running }, parsed.data, ctx.now, ctx.user.name) : resolveObstacle({ kind: task.kind, status: task.status, data: task.data });
    Object.assign(task, { status: applied.status, data: applied.data, version: task.version + 1, updatedAt: now, updatedBy: ctx.user.id });
    addRevision(ctx, task);
    const project = ctx.db.projects.find((item) => item.id === task.projectId);
    project?.events.push({ id: nextId(ctx, "event"), kind: "UPDATED", summary: (parsed?.success ? `Hinder på ${task.title}: ${OBSTACLE_REASON_LABELS[parsed.data.reason]}${parsed.data.text ? ` – ${parsed.data.text}` : ""}` : `Hindret på ${task.title} är löst`).slice(0, 500), taskId: task.id, actorName: ctx.user.name, createdAt: now });
    return { ok: true, id: task.id, version: task.version, status: task.status };
  }
  if (input.action === "timer") {
    const clicked = find(input.id);
    ctx.require(workflowSubjectForTask(clicked.kind), "edit");
    const task = timeOwner(ctx, clicked);
    if (isTaskCancelled(task.status)) throw new DemoError(409, task === clicked ? "Jobbet har utgått. Återuppta det för att skriva tid." : "Tiden räknas på arbetsordern " + task.title + ", som har utgått.");
    if (task.status === "COMPLETED") throw new DemoError(409, task === clicked ? "En slutförd uppgift kan inte tidrapporteras." : "Tiden räknas på arbetsordern " + task.title + ", som är färdigställd. Återöppna den för att skriva tid.");
    const start = input.command === "START";
    const startRefusal = start ? demoActionRefusal(ctx.db, ctx.user, task, "start") : null;
    if (startRefusal) throw new DemoError(403, startRefusal);
    // Riskbedömning som steg (2026-10-08): the same gate as Cloud.
    const riskRefusal = start ? localRiskStepRefusal(ctx.db.tasks, task, "start") : null;
    if (riskRefusal) throw new DemoError(409, riskRefusal);
    // Säkerhetsavstämning (2026-10-27, punkt 4): a round occurrence's check, as Cloud.
    const safetyRefusal = !start ? null : clicked !== task ? localRoundSafetyRefusal(ctx.db.tasks, clicked, "start") : localOrderRoundSafetyRefusal(ctx.db.tasks, task.id);
    if (safetyRefusal) throw new DemoError(409, safetyRefusal);
    const keepShort = input.keepShort === true;
    // Tidsperiod (2026-10-30): a new timer is refused in a sent-in or approved month, before anything changes.
    if (start && !entriesFor(ctx, task.id).some((entry) => !entry.endedAt && entry.userId === ctx.user.id)) requireTimeOpen(ctx, [{ userId: ctx.user.id, startedAt: now }]);
    const stopped = start ? [] : closeRunning(task, true, keepShort);
    const othersRunning = entriesFor(ctx, task.id).some((entry) => !entry.endedAt && entry.userId !== ctx.user.id);
    const nextStatus = start || othersRunning ? "IN_PROGRESS" : "PAUSED";
    Object.assign(task, { data: withoutStaleWaiting(nextStatus, task.data), status: nextStatus, startedAt: start ? task.startedAt ?? now : task.startedAt, version: task.version + 1, updatedAt: now, updatedBy: ctx.user.id });
    if (start) {
      if (!entriesFor(ctx, task.id).some((entry) => !entry.endedAt && entry.userId === ctx.user.id)) ctx.db.timeEntries.push({ id: nextId(ctx, "time"), taskId: task.id, sourceTaskId: clicked !== task ? clicked.id : null, userId: ctx.user.id, startedAt: now, endedAt: null, durationSec: 0, note: "", createdAt: now, updatedAt: now });
      // Starting a timer pauses the caller's timer on any other work order and on a project (one timer per person).
      for (const other of ctx.db.tasks.filter((item) => item.id !== task.id && entriesFor(ctx, item.id).some((entry) => !entry.endedAt && entry.userId === ctx.user.id))) {
        stopped.push(...closeRunning(other, true, keepShort));
        if (other.status === "IN_PROGRESS" && !entriesFor(ctx, other.id).some((entry) => !entry.endedAt)) Object.assign(other, { status: "PAUSED", version: other.version + 1, updatedAt: now });
      }
      stopped.push(...closeDemoProjectTime(ctx, null, keepShort));
    }
    return { ok: true, stopped };
  }
  const data = workflowTaskInputSchema.parse(input.task);
  ctx.require(workflowSubjectForTask(data.kind), data.id ? "edit" : "create");
  // Driftrond i arbetsordern (2026-10-27, punkt 3): a protocol started from a round registers the occurrence in the round's
  // work order for the day, as the server; nothing is made here.
  if (!data.id && data.kind === "FORM") {
    const round = roundOfProtocolValues(data.data);
    if (round) {
      if (!ctx.db.schedules.some((item) => item.id === round.scheduleId)) throw new DemoError(404, "Ronden hittades inte.");
      const result = roundProtocolOrder(round, data.workOrderId, demoRoundOrders(ctx));
      if (result.error !== undefined) throw new DemoError(409, result.error);
      data.workOrderId = result.id;
      // Where the occurrence is done is the work order's (2026-10-27 kväll): its temporary place too, as its customer and place.
      data.data = withRoundOrderTempPlace(data.data, ctx.db.tasks.find((item) => item.id === result.id)?.data);
    }
  }
  // A protocol always uses its form version from the catalog, like the server (never a document from the client).
  if (data.data.kind === "FORM") {
    const details = data.data.details;
    const existing = data.id ? ctx.db.tasks.find((item) => item.id === data.id) : undefined;
    const bound = existing?.data.kind === "FORM" ? existing.data.details : null;
    const form = ctx.db.forms.find((item) => item.id === (bound?.templateId ?? details.templateId) && item.version === (bound?.templateVersion ?? details.templateVersion));
    if (!form) throw new DemoError(409, "Formuläret finns inte längre i den här versionen.");
    data.data.details = { ...details, templateId: form.id, templateVersion: form.version, templateName: form.name, document: form.document };
  }
  if (data.projectId) {
    if (!ctx.db.projects.some((item) => item.id === data.projectId)) throw new DemoError(400, "Projektet hittades inte.");
    if (projectArchived(ctx, data.projectId)) throw new DemoError(409, "Återställ projektet innan du sparar en uppgift i det.");
    if (projectClosed(ctx, data.projectId)) throw new DemoError(409, "Projektet är avslutat. Återöppna projektet innan du lägger till eller ändrar uppgifter i det.");
    const project = ctx.db.projects.find((item) => item.id === data.projectId)!;
    if (project.customerId && data.customerId !== project.customerId) throw new DemoError(400, "En uppgift i projektet har projektets kund.");
    const previous = data.id ? ctx.db.tasks.find((item) => item.id === data.id) : undefined;
    const dueError = !previous || previous.dueDate !== data.dueDate || previous.projectId !== data.projectId ? taskDueDateError(data.dueDate, { startDate: project.startDate ?? "", dueDate: project.dueDate }) : null;
    if (dueError) throw new DemoError(400, dueError);
  }
  const assignee = data.assignedToUserId ? ctx.db.users.find((user) => user.id === data.assignedToUserId) : undefined;
  if (data.assignedToUserId && !assignee) throw new DemoError(400, "Ansvarig användare tillhör inte arbetsytan.");
  // Ansvarig must be able to read the job, checked when chosen (simulation 2026-10-10; lib/workflow/assignee-access.ts).
  // A linked task's responsible person is its work order's (2026-10-30), chosen and checked there.
  if (assignee && (data.kind === "WORK_ORDER" || !data.workOrderId) && !memberMayReadJob({ role: assignee.role, workflowPermissions: assignee.permissions }, workflowSubjectForTask(data.kind)) && (data.id ? ctx.db.tasks.find((item) => item.id === data.id)?.assignedToUserId : null) !== assignee.id)
    throw new DemoError(400, assigneeReadRefusal(assignee.name, workflowSubjectForTask(data.kind)));
  // Arbetsordern styr (2026-10-26/27): the same rules as the server – a linked task has its work order's customer and project
  // and is never let go; a draft may have none yet; a work order holds one risk assessment.
  if (data.kind !== "WORK_ORDER") {
    const found = data.workOrderId ? ctx.db.tasks.find((item) => item.id === data.workOrderId) : undefined;
    const order = found ? { ...found, facilityId: found.facilityId ?? null } : null;
    const previous = data.id ? ctx.db.tasks.find((item) => item.id === data.id) : undefined;
    const changed = (previous?.workOrderId ?? null) !== (data.workOrderId ?? null);
    // Fråga 8a: without the right to read work orders, one the person is responsible for or booked on.
    if (changed && data.workOrderId && !ctx.can("work-order", "read") && !(found?.assignedToUserId === ctx.user.id || ctx.db.activities.some((activity) => activity.workflowTaskId === found?.id && activity.assignments.some((item) => item.userId === ctx.user.id))))
      throw new DemoError(403, "Du kan bara lägga uppgiften i en arbetsorder som du är ansvarig för eller tilldelad.");
    Object.assign(data, inheritFromWorkOrder(data, order, { isNew: !data.id }));
    const linkError = workOrderLinkError(data, order, { changed, previousWorkOrderId: previous?.workOrderId ?? null });
    if (linkError) throw new DemoError(order?.status === "COMPLETED" || previous?.workOrderId ? 409 : 400, linkError);
    if (changed && order && isRiskAssessmentTask(data)) {
      const duplicate = duplicateRiskAssessmentError(ctx.db.tasks.filter((item) => item.workOrderId === order.id && item.id !== data.id && isRiskAssessmentTask(item)));
      if (duplicate) throw new DemoError(409, duplicate);
    }
  }
  // Plats (QA 2026-10-10): the chosen place is kept, checked like Cloud (the customer's own place, not a paused new one).
  if (data.facilityId) {
    const facilityError = facilityLinkError((ctx.db.facilities ?? []).find((facility) => facility.id === data.facilityId), { customerId: data.customerId, facilityId: data.facilityId, previousFacilityId: data.id ? ctx.db.tasks.find((item) => item.id === data.id)?.facilityId ?? null : null });
    if (facilityError) throw new DemoError(400, facilityError);
  }
  // Roller med nivå (2026-10-07): the same rule as Cloud's route, with the invented programme.
  const levelRefusal = demoSavedRefusal(ctx.db, ctx.user, { task: data, current: data.id ? ctx.db.tasks.find((item) => item.id === data.id) ?? null : null, documented: workflowTaskHasDocumentation(data) });
  if (levelRefusal) throw new DemoError(403, levelRefusal);
  // Riskbedömning som steg (2026-10-08): the same stamp and completion gate as Cloud.
  const stored = data.id ? ctx.db.tasks.find((item) => item.id === data.id) : undefined;
  const riskExceptionRefused = riskExceptionRefusal(data.data, stored?.data ?? null, ctx.db.settings.riskException !== false);
  if (riskExceptionRefused) throw new DemoError(409, riskExceptionRefused);
  data.data = stampRiskStep(data.data, { created: !data.id, stored: stored?.data ?? null, exempt: riskStepExempt(data), actor: { id: ctx.user.id, name: ctx.user.name }, now });
  const linkedRisk = riskCheckOf(data.data)?.extendedTaskId;
  if (linkedRisk && !ctx.db.tasks.some((item) => item.id === linkedRisk && isRiskAssessmentTask(item))) throw new DemoError(400, "Den kopplade riskbedömningen hittades inte.");
  // Säkerhetsavstämning (2026-10-27, punkt 4): the same stamp as Cloud.
  data.data = localStampRoundSafety(ctx.db.tasks, data, { created: !data.id, stored: stored?.data ?? null, actor: { id: ctx.user.id, name: ctx.user.name }, now, inRound: Boolean(roundOfProtocolValues(data.data)) });
  // Before the completion check, as Cloud: a judgement or verdict that no longer holds must not count.
  data.data = stampCustomerAndJudgements(data.data, stored?.data ?? null, ctx.user.name, now);
  if (data.status === "COMPLETED") {
    ctx.require(workflowSubjectForTask(data.kind), "complete");
    const completion = workflowTaskCompletion(data);
    if (!completion.ready) throw new DemoError(422, completion.issues.map((issue) => issue.message).join(" "));
    const riskRefusal = localRiskStepRefusal(ctx.db.tasks, { ...data, status: stored?.status ?? "PLANNED" }, "complete");
    if (riskRefusal) throw new DemoError(409, riskRefusal);
    const safetyRefusal = localRoundSafetyRefusal(ctx.db.tasks, { ...data, status: stored?.status ?? "PLANNED" }, "complete");
    if (safetyRefusal) throw new DemoError(409, safetyRefusal);
  }
  // Same as Cloud: Pågår and Pausad follow the time (2026-10-08).
  const chosen = savedStatusForTask(data, data.id ? ctx.db.tasks.find((item) => item.id === data.id)?.status : null);
  // Säkerhetsavstämning: the check comes before the work, as the server.
  const safetyGate = roundSafetyWorkGate(data, roundSafetyRiskFrom(ctx.db.tasks, data.workOrderId), { chosen, documented: workflowTaskHasDocumentation(data), stored: stored ? { status: stored.status, data: stored.data } : null });
  if (safetyGate.refusal) throw new DemoError(409, safetyGate.refusal);
  const status = safetyGate.status as typeof chosen;
  // Uppgifter får skapas först (2026-10-27): without a work order only a draft is saved, as the server.
  const unlinked = workOrderRequiredError({ kind: data.kind, workOrderId: data.workOrderId, status });
  if (unlinked) throw new DemoError(409, unlinked);
  // Driftrond i arbetsordern (punkt 3): the round a work order holds and its period, checked as the server.
  const holderBefore = data.id ? ctx.db.tasks.find((item) => item.id === data.id) : undefined;
  const roundScheduleId = data.kind !== "WORK_ORDER" ? null : data.roundScheduleId === undefined ? holderBefore?.roundScheduleId ?? null : data.roundScheduleId;
  if (data.kind === "WORK_ORDER" && (roundScheduleId || holderBefore?.roundScheduleId)) {
    const holderError = roundHolderSaveError({ roundScheduleId, from: data.plannedStartDate ?? holderBefore?.plannedStartDate ?? "", to: data.dueDate, status },
      holderBefore ? { roundScheduleId: holderBefore.roundScheduleId ?? null, roundOccurrence: holderBefore.roundOccurrence ?? null } : null,
      { scheduleExists: Boolean(roundScheduleId && ctx.db.schedules.some((item) => item.id === roundScheduleId)), others: demoRoundOrders(ctx).filter((order) => order.scheduleId === roundScheduleId && order.id !== data.id), occurrences: data.id ? demoRegisteredOccurrences(ctx, data.id) : [] });
    if (holderError) throw new DemoError(409, holderError);
  }
  const taskData = withoutStaleWaiting(status, stampWorkflowTaskApproval(data.data, now));
  // Start and Uppskattad tid (projektförslaget steg 2): the same rules as Cloud (lib/workflow/schedule.ts); left out = unchanged.
  const scheduled = data.id ? ctx.db.tasks.find((item) => item.id === data.id) : undefined;
  const scheduleFrame = ctx.db.projects.find((item) => item.id === data.projectId);
  // Start på alla jobb (plan 1M): the same as the server – a new job starts today inside the project's frame; a saved Start is never cleared.
  if (!scheduled) data.plannedStartDate = startForNewJob({ chosen: data.plannedStartDate, today: swedishDayKey(ctx.now), dueDate: data.dueDate, frame: scheduleFrame ? { startDate: scheduleFrame.startDate ?? "", dueDate: scheduleFrame.dueDate } : null });
  else if (data.plannedStartDate === "" && scheduled.plannedStartDate) data.plannedStartDate = scheduled.plannedStartDate;
  const scheduleError = taskScheduleError(data, scheduled ? { plannedStartDate: scheduled.plannedStartDate ?? "", dueDate: scheduled.dueDate, projectId: scheduled.projectId } : null, scheduleFrame ? { startDate: scheduleFrame.startDate ?? "", dueDate: scheduleFrame.dueDate } : null);
  if (scheduleError) throw new DemoError(400, scheduleError);
  const schedule = { ...(data.plannedStartDate !== undefined ? { plannedStartDate: data.plannedStartDate } : {}), ...(data.estimatedMinutes !== undefined ? { estimatedMinutes: data.estimatedMinutes } : {}), ...(data.stage !== undefined ? { stage: normalizeStage(data.stage) } : {}) };
  const values = { projectId: data.projectId, customerId: data.customerId, facilityId: data.facilityId ?? null, workOrderId: data.workOrderId, ...(holderBefore?.roundOccurrence ? {} : { roundScheduleId }), title: data.title, description: data.description, status, assignedToUserId: data.assignedToUserId, assignedToName: data.assignedToUserId ? userName(ctx, data.assignedToUserId) : data.assignedToName, dueDate: data.dueDate, data: taskData as DemoTask["data"], completedAt: status === "COMPLETED" ? now : null, updatedAt: now, updatedBy: ctx.user.id };
  if (data.id) {
    const task = find(data.id);
    if (task.kind !== data.kind) throw new DemoError(409, "Uppgiftstypen kan inte ändras.");
    if (task.status === "COMPLETED") throw new DemoError(409, "Återöppna uppgiften innan du ändrar den.");
    if (isTaskCancelled(task.status)) throw new DemoError(409, "Jobbet har utgått. Återuppta det innan du ändrar det.");
    if (task.kind === "WORK_ORDER" && task.projectId !== data.projectId) throw new DemoError(409, "Flytta arbetsordern via projektet, så att bytet hamnar i historiken.");
    const before = { ...task };
    if (task.version !== data.version) throw new DemoError(409, "Uppgiften har ändrats. Läs in den senaste versionen.");
    const previousStatus = task.status;
    Object.assign(task, values, schedule, { version: task.version + 1 });
    // The tasks of a work order follow its Grunduppgifter (Arbetsordern som hållare, 2026-10-30), as the server.
    if (task.kind === "WORK_ORDER" && sharedBasicsChanged(before, task)) followDemoWorkOrder(ctx.db.tasks, task, now);
    if (status === "COMPLETED") closeRunning(task);
    // As the server (2026-11-06): the order's open maintenance items are done with it.
    // A plan's occurrence in a round (2026-11-27) is not: a person marks it Klart.
    if (status === "COMPLETED" && task.kind === "WORK_ORDER") for (const item of ctx.db.maintenanceItems ?? []) if (item.workOrderId === task.id && item.status === "OPEN" && !item.planId) item.status = "DONE";
    addRevision(ctx, task);
    demoWorkOrderSaved(ctx.db, { taskId: task.id, previousStatus, by: { id: ctx.user.id, name: ctx.user.name } });
    return { id: task.id, version: task.version };
  }
  const task: DemoTask = { ...values, ...schedule, id: nextId(ctx, "task"), kind: data.kind, version: 1, startedAt: status === "IN_PROGRESS" ? now : null, createdBy: ctx.user.id, createdAt: now, revisions: [] };
  ctx.db.tasks.push(task);
  addRevision(ctx, task);
  demoWorkOrderSaved(ctx.db, { taskId: task.id, previousStatus: null, by: { id: ctx.user.id, name: ctx.user.name } });
  return { id: task.id, version: 1 };
}

// ---------- /api/planned-activities and /api/planning-capacity ----------
const activityTask = (ctx: Context, activity: DemoActivity) => {
  const task = ctx.db.tasks.find((item) => item.id === activity.workflowTaskId);
  return task ? { id: task.id, title: task.title, kind: task.kind, projectId: task.projectId, status: task.status } : null;
};
const visibleActivities = (ctx: Context) => ctx.db.activities.filter((activity) => !activity.deletedAt && canReadPlannedActivity(ctx.user.permissions, ctx.admin, { projectId: activity.projectId, workflowTask: activityTask(ctx, activity) }));
const capacityActivity = (activity: DemoActivity) => ({ id: activity.id, title: activity.title, startsAt: activity.startsAt, endsAt: activity.endsAt, assignedToUserId: activity.assignments[0]?.userId ?? null, assignedToUserIds: activity.assignments.map((item) => item.userId), assignments: activity.assignments, status: activity.status, projectId: activity.projectId, workflowTaskId: activity.workflowTaskId });
/** Att boka (2026-11-02), as the server: the rule of lib/overview/team-followup.ts, for the work orders this person may book. */
function workToBookAnswer(ctx: Context) {
  const scope = workToBookScope(ctx.user.permissions, ctx.admin, seesTeam(ctx));
  if (!scope.any) return { total: 0, rows: [] };
  const booked = new Set(ctx.db.activities.filter((activity) => !activity.deletedAt && activity.status !== "CANCELED" && activity.workflowTaskId).map((activity) => activity.workflowTaskId!));
  const { total, rows } = workToBook({ today: swedishDayKey(ctx.now), workOrders: ctx.db.tasks.flatMap((task) => {
    if (task.kind !== "WORK_ORDER") return [];
    const project = task.projectId ? ctx.db.projects.find((item) => item.id === task.projectId) : null;
    if (task.projectId && (!scope.inProjects || !project || project.archivedAt || project.closedAt)) return [];
    const mine = task.assignedToUserId === ctx.user.id || (!task.assignedToUserId && task.createdBy === ctx.user.id) || Boolean(project && (project.responsibleUserId === ctx.user.id || project.planningDelegateUserId === ctx.user.id));
    if (!scope.everyone && !mine) return [];
    const customer = ctx.db.customers.find((item) => item.id === task.customerId);
    return [{ id: task.id, title: task.title, status: task.status, progress: workflowTaskProgress(task), startedAt: task.startedAt, roundScheduleId: task.roundScheduleId ?? null, booked: booked.has(task.id), plannedStartDate: task.plannedStartDate ?? "", dueDate: task.dueDate,
      assignedToUserId: task.assignedToUserId, assignedToName: task.assignedToName, customerName: customer ? customerDisplayName(customer) : "", projectId: task.projectId, projectName: project?.name ?? "" }];
  }) });
  return { total, rows: rows.slice(0, TO_BOOK_LIMIT) };
}
function plannedActivities(ctx: Context, request: Request) {
  if (request.method === "GET" && request.url.searchParams.get("toBook") === "1") return workToBookAnswer(ctx);
  // Planning's totals (`?summary=1`) in the same shape as the server sends them.
  if (request.method === "GET" && request.url.searchParams.get("summary") === "1") {
    const readable = visibleActivities(ctx);
    return {
      total: readable.length,
      inProgress: readable.filter((activity) => activity.status === "IN_PROGRESS").length,
      taskIds: [...new Set(readable.flatMap((activity) => activity.workflowTaskId ? [activity.workflowTaskId] : []))],
    };
  }
  const forTask = request.url.searchParams.get("forTask");
  const upcomingOnly = Boolean(forTask) && request.url.searchParams.get("upcoming") === "1";
  if (request.method === "GET") return {
    activities: visibleActivities(ctx).filter((activity) => !forTask || (activity.workflowTaskId === forTask && (!upcomingOnly || activity.endsAt > ctx.now.toISOString()))).sort((a, b) => a.startsAt.localeCompare(b.startsAt)).map((activity) => {
      const project = ctx.db.projects.find((item) => item.id === activity.projectId);
      const events = [...activity.events].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
      return { ...activity, project: project ? { id: project.id, name: project.name, timeBudgetMinutes: project.timeBudgetMinutes } : null, workflowTask: activityTask(ctx, activity),
        assignedToUserId: activity.assignments[0]?.userId ?? null, assignedToUserIds: activity.assignments.map((item) => item.userId), events: events.slice(0, 10), eventCount: events.length };
    }),
  };
  const input = request.body as Json;
  const now = ctx.now.toISOString();
  // Others' bookings (2026-10-09): the same rule as the server's requireBookingRight.
  const requireBookingRight = (before: string[], after: string[], projectIds: (string | null)[]) => {
    for (const projectId of new Set(projectIds)) {
      const refusal = bookingChangeRefusal({ admin: ctx.admin, userId: ctx.user.id, before, after, project: projectId ? ctx.db.projects.find((item) => item.id === projectId) ?? null : null });
      if (refusal) throw new DemoError(403, refusal);
    }
  };
  // Booking follows the job (2026-10-10): the same rule as the server (planned-activity-access.ts).
  const requireBooking = (projectId: string | null, task: { kind: string; projectId: string | null } | null | undefined, isNew: boolean) => {
    const refusal = plannedActivityWriteRefusal(ctx.user.permissions, ctx.admin, { projectId, workflowTask: task ? { kind: task.kind, projectId: task.projectId } : null }, isNew);
    if (refusal) throw new DemoError(403, refusal);
  };
  const requireEdit = (activity: DemoActivity) => requireBooking(activity.projectId, activityTask(ctx, activity), false);
  if (input.action === "delete") {
    const activity = ctx.db.activities.find((item) => item.id === input.id && !item.deletedAt);
    if (!activity) throw new DemoError(404, "Den planerade aktiviteten hittades inte.");
    requireEdit(activity);
    requireBookingRight(bookedUserIds(activity), [], [activity.projectId ?? activityTask(ctx, activity)?.projectId ?? null]);
    if (activity.version !== input.version) throw new DemoError(409, "Planeringen har ändrats. Läs in den senaste versionen.");
    Object.assign(activity, { deletedAt: now, version: activity.version + 1 });
    activity.events.push({ id: nextId(ctx, "activity-event"), kind: "DELETED", summary: plannedActivitySummary("DELETED", activity.title), actorName: ctx.user.name, createdAt: now });
    return { ok: true };
  }
  const data = plannedActivityInputSchema.parse(input.activity);
  if (data.projectId && !ctx.db.projects.some((item) => item.id === data.projectId)) throw new DemoError(400, "Projektet hittades inte.");
  if (projectArchived(ctx, data.projectId)) throw new DemoError(409, "Återställ projektet innan du planerar arbete i det.");
  if (projectClosed(ctx, data.projectId) && !["COMPLETED", "CANCELED"].includes(data.status)) throw new DemoError(409, "Projektet är avslutat. Återöppna projektet innan du planerar arbete i det.");
  const task = ctx.db.tasks.find((item) => item.id === data.workflowTaskId);
  if (data.workflowTaskId && !task) throw new DemoError(400, "Uppgiften hittades inte.");
  requireBooking(data.projectId, task, !data.id);
  const linkedProjectId = task?.projectId ?? null;
  if (data.projectId && linkedProjectId && data.projectId !== linkedProjectId) throw new DemoError(400, "Den valda uppgiften tillhör ett annat projekt.");
  {
    // Same frame rules as the server (2026-09-26, decision 4).
    const previous = data.id ? ctx.db.activities.find((item) => item.id === data.id) : undefined;
    const active = !["COMPLETED", "CANCELED"].includes(data.status);
    const changed = !previous || previous.startsAt !== data.startsAt || previous.endsAt !== data.endsAt || previous.projectId !== data.projectId || previous.workflowTaskId !== data.workflowTaskId;
    if (active && changed && task?.status === "COMPLETED") throw new DemoError(409, "Uppgiften är slutförd. Återöppna den innan du planerar mer arbete på den.");
    if (active && changed && task?.status === "CANCELLED") throw new DemoError(409, "Jobbet har utgått. Återuppta det innan du planerar arbete på det.");
    const frameProject = ctx.db.projects.find((item) => item.id === (data.projectId ?? linkedProjectId));
    const frameError = active && changed && frameProject ? planningFrameError(data, { startDate: frameProject.startDate ?? "", dueDate: frameProject.dueDate }) : null;
    if (frameError && !data.frameExceptionReason) throw new DemoError(409, `${frameError} Projektansvarig eller en företagsadministratör kan göra ett undantag med en motivering.`);
    if (frameError && !canManageProjectLifecycle({ admin: ctx.admin, userId: ctx.user.id, responsibleUserId: frameProject!.responsibleUserId, canEditProjects: ctx.can("projects", "edit") })
      && !(ctx.can("projects", "edit") && frameProject!.planningDelegateUserId === ctx.user.id))
      throw new DemoError(403, "Bara projektansvarig eller en företagsadministratör kan göra undantag från projektets tidsram.");
    if (frameError) frameProject!.events.push({ id: nextId(ctx, "event"), kind: "PLANNING_EXCEPTION", summary: `Planeringen ${data.title} fick undantag från projektets tidsram: ${data.frameExceptionReason}`, taskId: null, actorName: ctx.user.name, createdAt: ctx.now.toISOString() });
  }
  const assignments = plannedActivityAssignments(data);
  if (assignments.some((assignment) => !ctx.db.users.some((user) => user.id === assignment.userId))) throw new DemoError(400, "Varje ansvarig måste vara en aktiv medlem i arbetsytan.");
  {
    const previous = data.id ? ctx.db.activities.find((item) => item.id === data.id && !item.deletedAt) : undefined;
    requireBookingRight(previous ? bookedUserIds(previous) : [], assignments.map((assignment) => assignment.userId),
      [data.projectId ?? linkedProjectId, ...(previous ? [previous.projectId ?? activityTask(ctx, previous)?.projectId ?? null] : [])]);
  }
  const values = { title: data.title, description: data.description, kind: data.kind, status: data.status, startsAt: data.startsAt, endsAt: data.endsAt, projectId: data.projectId ?? linkedProjectId, workflowTaskId: data.workflowTaskId,
    assignments, assignedToName: assignments.length ? assignments.map((assignment) => userName(ctx, assignment.userId)).join(", ") : data.assignedToName };
  if (data.id) {
    const current = ctx.db.activities.find((item) => item.id === data.id && !item.deletedAt);
    if (!current) throw new DemoError(404, "Den planerade aktiviteten hittades inte.");
    requireEdit(current);
    if (current.version !== data.version) throw new DemoError(409, "Planeringen har ändrats. Läs in den senaste versionen.");
    Object.assign(current, values, { version: current.version + 1 });
    current.events.push({ id: nextId(ctx, "activity-event"), kind: "UPDATED", summary: plannedActivitySummary("UPDATED", data.title), actorName: ctx.user.name, createdAt: now });
    return { id: current.id, version: current.version };
  }
  const created: DemoActivity = { ...values, id: nextId(ctx, "activity"), version: 1, deletedAt: null, events: [{ id: nextId(ctx, "activity-event"), kind: "CREATED", summary: plannedActivitySummary("CREATED", data.title), actorName: ctx.user.name, createdAt: now }] };
  ctx.db.activities.push(created);
  return { id: created.id, version: 1 };
}
function planningCapacity(ctx: Context) {
  // As the server: Teamet, the project right or a job right opens it; the bookings follow their own read rule.
  if (!seesTeam(ctx) && !ctx.can("projects", "read") && !readableTaskScope((subject) => ctx.can(subject, "read")).any) throw new DemoError(403, "Du saknar behörighet att läsa planering.");
  const people = seesTeam(ctx) ? ctx.db.users : [ctx.user];
  return {
    canViewTeam: seesTeam(ctx),
    organizationWeeklyWorkMinutes: ctx.db.organization.weeklyWorkMinutes,
    members: people.map((user) => ({ id: user.id, name: user.name, weeklyWorkMinutes: user.weeklyWorkMinutes ?? ctx.db.organization.weeklyWorkMinutes, memberWeeklyWorkMinutes: user.weeklyWorkMinutes, noFixedHours: Boolean(user.noFixedHours), events: [] })),
    activities: visibleActivities(ctx).map((activity) => ({ ...capacityActivity(activity), workflowTask: activityTask(ctx, activity) })),
    // Frånvaro (2026-10-29): as Cloud's route – the people shown, only the words this person may see.
    absences: ctx.db.absences.filter((absence) => people.some((user) => user.id === absence.userId) && countsInPlanning(absence)).map((absence) => ({
      userId: absence.userId, name: people.find((user) => user.id === absence.userId)?.name ?? "", label: absenceLabel({ id: ctx.user.id, admin: ctx.admin, team: seesTeam(ctx) }, absence), from: absence.from, to: absence.to, hours: absence.hours })),
  };
}

// ---------- /api/project-schedule (Tidplan, Gantt v1, 2026-10-09) ----------
/** The project's time plan and the change of one job's period, with the same rules as the server's route. */
function projectSchedule(ctx: Context, request: Request) {
  const finished = (status: string) => status === "COMPLETED" || status === "CANCELLED";
  if (request.method === "GET") {
    ctx.require("projects", "read");
    const project = ctx.db.projects.find((item) => item.id === request.url.searchParams.get("projectId"));
    if (!project) throw new DemoError(404, "Projektet hittades inte.");
    const locked = Boolean(project.archivedAt || project.closedAt);
    const jobs = readableTasks(ctx).filter((task) => task.projectId === project.id);
    if (request.url.searchParams.get("stages") === "1") return { stages: stageSuggestions(jobs) };
    const ids = new Set(jobs.map((task) => task.id));
    return {
      today: swedishDayKey(ctx.now),
      project: { id: project.id, startDate: project.startDate ?? "", dueDate: project.dueDate, locked,
        canFrameException: canManageProjectLifecycle({ admin: ctx.admin, userId: ctx.user.id, responsibleUserId: project.responsibleUserId, canEditProjects: ctx.can("projects", "edit") }) },
      jobs: jobs.map((task) => ({ id: task.id, title: task.title, kind: task.kind, status: task.status, progress: workflowTaskProgress(task), workOrderId: task.workOrderId ?? null,
        plannedStartDate: task.plannedStartDate ?? "", effectiveStart: effectiveStartDate({ plannedStartDate: task.plannedStartDate ?? "", createdAt: task.createdAt }), stage: task.stage ?? "", obstacle: jobObstacle(task),
        dueDate: task.dueDate, estimatedMinutes: task.estimatedMinutes ?? null, predecessorIds: (task.predecessorIds ?? []).filter((id) => ids.has(id)),
        completedDay: task.status === "COMPLETED" && task.completedAt ? swedishDayKey(task.completedAt) : "",
        assignedToName: task.assignedToName, version: task.version,
        canEdit: !locked && !finished(task.status) && ctx.can(workflowSubjectForTask(task.kind), "edit") })),
      bookings: visibleActivities(ctx).filter((activity) => activity.status !== "CANCELED" && (activity.projectId === project.id || (activity.workflowTaskId && ids.has(activity.workflowTaskId)))).map((activity) => {
        const people = bookedUserIds(activity);
        const canMove = Boolean(activity.workflowTaskId) && movableBooking(activity) && ctx.can("projects", "edit")
          && !bookingChangeRefusal({ admin: ctx.admin, userId: ctx.user.id, before: people, after: people, project });
        return { ...scheduleBookingOf({ ...activity, assignedToName: activity.assignments.length ? activity.assignments.map((item) => userName(ctx, item.userId)).join(", ") : activity.assignedToName }), status: activity.status, canMove };
      }),
    };
  }
  const input = scheduleInputSchema.parse(request.body);
  const task = ctx.db.tasks.find((item) => item.id === input.taskId);
  if (!task) throw new DemoError(404, "Jobbet hittades inte.");
  ctx.require(workflowSubjectForTask(task.kind), "edit");
  if (task.status === "COMPLETED") throw new DemoError(409, "Jobbet är färdigställt. Återöppna det innan du ändrar tidplanen.");
  if (task.status === "CANCELLED") throw new DemoError(409, "Jobbet har utgått. Återuppta det innan du ändrar tidplanen.");
  if (task.version !== input.version) throw new DemoError(409, "Jobbet har ändrats. Läs in den senaste versionen.");
  const project = ctx.db.projects.find((item) => item.id === task.projectId) ?? null;
  if (project?.archivedAt) throw new DemoError(409, "Återställ projektet innan du ändrar tidplanen.");
  if (project?.closedAt) throw new DemoError(409, "Projektet är avslutat. Återöppna projektet innan du ändrar tidplanen.");
  const frame = project ? { startDate: project.startDate ?? "", dueDate: project.dueDate } : null;
  const canEditProjects = ctx.can("projects", "edit");
  // Start på alla jobb (plan 1M): an older job without a Start counts from the day it was created; nothing is written for it
  // unless its Start is really changed, and a Start is never cleared.
  const effective = effectiveStartDate({ plannedStartDate: task.plannedStartDate ?? "", createdAt: task.createdAt });
  const previous = { plannedStartDate: effective, dueDate: task.dueDate };
  const previousEstimate = task.estimatedMinutes ?? null;
  const next = { plannedStartDate: input.plannedStartDate || effective, dueDate: input.dueDate, estimatedMinutes: input.estimatedMinutes };
  const writeStart = Boolean(task.plannedStartDate) || next.plannedStartDate !== effective;
  const periodChanged = next.plannedStartDate !== effective || next.dueDate !== previous.dueDate;
  const periodError = periodChanged ? schedulePeriodError(next, frame) : null;
  if (periodError && !periodError.frame) throw new DemoError(400, periodError.message);
  if (periodError) {
    if (!input.frameExceptionReason) throw new DemoError(409, `${periodError.message} Projektansvarig eller en företagsadministratör kan göra ett undantag med en motivering.`);
    if (!canManageProjectLifecycle({ admin: ctx.admin, userId: ctx.user.id, responsibleUserId: project?.responsibleUserId, canEditProjects }))
      throw new DemoError(403, "Bara projektansvarig eller en företagsadministratör kan göra undantag från projektets tidsram.");
  }
  // Börjar efter (steg 4): the same checks as the server.
  const previousPredecessors = task.predecessorIds ?? [];
  let predecessorIds = previousPredecessors;
  let predecessorTitles: string[] = [];
  if (input.predecessorIds) {
    const wanted = [...new Set(input.predecessorIds)];
    if (!project && wanted.length) throw new DemoError(400, "Börjar efter finns bara för jobb i ett projekt.");
    const projectJobs = project ? ctx.db.tasks.filter((item) => item.projectId === project.id) : [];
    const readableIds = new Set(readableTasks(ctx).filter((item) => item.projectId === project?.id).map((item) => item.id));
    if (wanted.some((id) => !readableIds.has(id))) throw new DemoError(400, "Börjar efter kan bara peka på jobb i samma projekt.");
    predecessorIds = [...wanted, ...previousPredecessors.filter((id) => projectJobs.some((item) => item.id === id) && !readableIds.has(id) && !wanted.includes(id))];
    const problem = predecessorError(task.id, predecessorIds, projectJobs);
    if (problem) throw new DemoError(400, problem);
    predecessorTitles = wanted.map((id) => projectJobs.find((item) => item.id === id)?.title ?? "").filter(Boolean);
  }
  const predecessorsChanged = predecessorIds.length !== previousPredecessors.length || predecessorIds.some((id, index) => id !== previousPredecessors[index]);
  // Flytta även bokningarna: the same all-or-nothing rule as the server.
  const shift = input.moveBookings && periodChanged ? bookingShiftWorkdays({ plannedStartDate: task.plannedStartDate ?? "", effectiveStart: effective }, next) : 0;
  const bookings = shift ? ctx.db.activities.filter((activity) => activity.workflowTaskId === task.id && !activity.deletedAt && movableBooking(activity)) : [];
  if (shift) {
    ctx.require("projects", "edit");
    const blocked = bookings.filter((activity) => bookingChangeRefusal({ admin: ctx.admin, userId: ctx.user.id, before: bookedUserIds(activity), after: bookedUserIds(activity), project }));
    const refusal = bookingMoveRefusal(blocked.map(scheduleBookingOf));
    if (refusal) throw new DemoError(403, refusal);
  }
  const moved = bookings.map((activity) => ({ activity, to: shiftBookingTimes(activity, shift) }));
  const outside = frame ? moved.filter((move) => planningFrameError(move.to, frame)) : [];
  if (outside.length && !input.frameExceptionReason) throw new DemoError(409, `${outside.length === 1 ? "En bokning hamnar" : `${outside.length} bokningar hamnar`} utanför projektets tidsram (${frame!.startDate}–${frame!.dueDate}). Projektansvarig eller en företagsadministratör kan göra ett undantag med en motivering.`);
  if (outside.length && !canManageProjectLifecycle({ admin: ctx.admin, userId: ctx.user.id, responsibleUserId: project?.responsibleUserId, canEditProjects }) && !(canEditProjects && project?.planningDelegateUserId === ctx.user.id))
    throw new DemoError(403, "Bara projektansvarig eller en företagsadministratör kan göra undantag från projektets tidsram.");
  // Flytta efterföljande jobb (plan 1M): the same plan and checks as the server.
  const followerPlan = input.moveFollowers && periodChanged && project
    ? planFollowerMoves({ jobId: task.id, previous, next, frame, jobs: ctx.db.tasks.filter((item) => item.projectId === project.id).map((item) => ({ ...item, plannedStartDate: effectiveStartDate({ plannedStartDate: item.plannedStartDate ?? "", createdAt: item.createdAt }) })), canEdit: (job) => ctx.can(workflowSubjectForTask(job.kind), "edit") })
    : null;
  if (followerPlan?.locked.length) throw new DemoError(403, `Efterföljande jobb kan inte flyttas med: ${followerPlan.locked.map((job) => job.title || "Utan rubrik").join(", ")}. Du får inte ändra dem. Välj Flytta bara jobbet, eller be någon med rätt behörighet flytta dem.`);
  if (followerPlan?.invalid) throw new DemoError(400, followerPlan.invalid);
  if (followerPlan?.outsideFrame.length) {
    if (!input.frameExceptionReason) throw new DemoError(409, `${followerPlan.outsideFrame.length === 1 ? "Ett efterföljande jobb hamnar" : `${followerPlan.outsideFrame.length} efterföljande jobb hamnar`} utanför projektets tidsram (${frame!.startDate}–${frame!.dueDate}). Projektansvarig eller en företagsadministratör kan göra ett undantag med en motivering.`);
    if (!canManageProjectLifecycle({ admin: ctx.admin, userId: ctx.user.id, responsibleUserId: project?.responsibleUserId, canEditProjects }))
      throw new DemoError(403, "Bara projektansvarig eller en företagsadministratör kan göra undantag från projektets tidsram.");
  }
  if (!periodChanged && next.estimatedMinutes === previousEstimate && !predecessorsChanged) return { id: task.id, version: task.version };
  Object.assign(task, { dueDate: next.dueDate, estimatedMinutes: next.estimatedMinutes, ...(writeStart ? { plannedStartDate: next.plannedStartDate } : {}) }, { predecessorIds, version: task.version + 1, updatedBy: ctx.user.id, updatedAt: ctx.now.toISOString() });
  addRevision(ctx, task);
  const now = ctx.now.toISOString();
  for (const move of followerPlan?.moves ?? []) {
    const follower = ctx.db.tasks.find((item) => item.id === move.job.id);
    if (!follower) continue;
    Object.assign(follower, { plannedStartDate: move.to.plannedStartDate, dueDate: move.to.dueDate, version: follower.version + 1, updatedBy: ctx.user.id, updatedAt: ctx.now.toISOString() });
    addRevision(ctx, follower);
    project?.events.push({ id: nextId(ctx, "event"), kind: "TASK_SCHEDULED", summary: `Tidplanen för ${follower.title || "jobbet"} ändrades: start ${move.to.plannedStartDate}${move.to.dueDate ? `, klart senast ${move.to.dueDate}` : ""} (flyttades efter ${task.title})`.slice(0, 500), taskId: follower.id, actorName: ctx.user.name, createdAt: ctx.now.toISOString() });
  }
  for (const { activity, to } of moved) {
    Object.assign(activity, { startsAt: to.startsAt.toISOString(), endsAt: to.endsAt.toISOString(), version: activity.version + 1,
      assignments: activity.assignments.map((item) => item.startsAt && item.endsAt ? { ...item, ...Object.fromEntries(Object.entries(shiftBookingTimes({ startsAt: item.startsAt, endsAt: item.endsAt }, shift)).map(([key, value]) => [key, value.toISOString()])) } : item) });
    activity.events.push({ id: nextId(ctx, "activity-event"), kind: "UPDATED", summary: `Bokningen ${activity.title} flyttades ${Math.abs(shift)} arbetsdagar ${shift > 0 ? "framåt" : "bakåt"} med jobbet ${task.title}`, actorName: ctx.user.name, createdAt: now });
  }
  if (project && (periodChanged || next.estimatedMinutes !== previousEstimate))
    project.events.push({ id: nextId(ctx, "event"), kind: "TASK_SCHEDULED", summary: `${scheduleChangeSummary(task.title, next)}${moved.length ? `; ${moved.length === 1 ? "1 bokning flyttades med" : `${moved.length} bokningar flyttades med`}` : ""}`, taskId: task.id, actorName: ctx.user.name, createdAt: now });
  if (project && predecessorsChanged) project.events.push({ id: nextId(ctx, "event"), kind: "TASK_SCHEDULED", summary: predecessorTitles.length ? `${task.title} börjar efter ${predecessorTitles.join(", ")}` : `${task.title} börjar inte längre efter något annat jobb`, taskId: task.id, actorName: ctx.user.name, createdAt: now });
  if (project && (periodError || outside.length || followerPlan?.outsideFrame.length)) project.events.push({ id: nextId(ctx, "event"), kind: "SCHEDULE_EXCEPTION", summary: `Tidplanen för ${task.title} fick undantag från projektets tidsram: ${input.frameExceptionReason}`, taskId: task.id, actorName: ctx.user.name, createdAt: now });
  return { id: task.id, version: task.version, movedBookings: moved.length, movedFollowers: followerPlan?.moves.length ?? 0 };
}

// ---------- /api/project-portfolio (Planering och Projektstatistik, plan 1M) ----------
/** The portfolio over the demo's projects, with the same rules and figures as the server's route. */
function projectPortfolio(ctx: Context, request: Request) {
  if (request.method !== "GET") throw new DemoError(405, "Metoden stöds inte.");
  ctx.require("projects", "read");
  const state = request.url.searchParams.get("state") ?? "ongoing";
  const readable = new Set(readableTasks(ctx).map((task) => task.id));
  const shown = ctx.db.projects.filter((project) => !project.archivedAt && (state === "all" || (state === "closed" ? Boolean(project.closedAt) : !project.closedAt)));
  return summarizePortfolio({
    now: ctx.now,
    projects: shown.map((project) => {
      const tasks = ctx.db.tasks.filter((task) => task.projectId === project.id);
      const jobIds = new Set(tasks.map((task) => task.id));
      return {
        id: project.id, name: project.name, customerName: customerDisplayName(ctx.db.customers.find((customer) => customer.id === project.customerId)), responsibleName: project.responsibleName ?? "",
        startDate: project.startDate ?? "", dueDate: project.dueDate ?? "", timeBudgetMinutes: project.timeBudgetMinutes ?? 0, quotedMinutes: demoQuotedMinutes(ctx, project.id),
        status: projectStatus(ctx, project), projectTimeSec: durationSec(ctx.db.timeEntries.filter((entry) => entry.projectId === project.id), ctx.now),
        jobs: tasks.filter((task) => readable.has(task.id)).map((task) => ({
          id: task.id, title: task.title, kind: task.kind, status: task.status, progress: workflowTaskProgress(task), dueDate: task.dueDate, plannedStartDate: task.plannedStartDate ?? "", createdAt: task.createdAt,
          estimatedMinutes: task.estimatedMinutes ?? null, totalDurationSec: durationSec(entriesFor(ctx, task.id), ctx.now), obstacle: jobObstacle(task),
        })),
        bookings: visibleActivities(ctx).filter((activity) => activity.status !== "CANCELED" && (activity.projectId === project.id || (activity.workflowTaskId && jobIds.has(activity.workflowTaskId)))).map((activity) => ({
          ...capacityActivity(activity), id: activity.id, title: activity.title, kind: activity.kind, workflowTaskId: activity.workflowTaskId, workflowTask: activityTask(ctx, activity),
        })),
      };
    }),
  });
}

// ---------- /api/workflow-tasks/work-order-links (Fas 2) ----------
/** The editor's choice of work order and a work order's Kopplade uppgifter, like the server's route. */
function workOrderLinks(ctx: Context, request: Request) {
  const params = request.url.searchParams;
  const linked = params.get("linked");
  if (linked) {
    ctx.require("work-order", "read");
    if (!ctx.db.tasks.some((item) => item.id === linked && item.kind === "WORK_ORDER")) throw new DemoError(404, "Arbetsordern hittades inte.");
    const rows = readableTasks(ctx).filter((task) => task.workOrderId === linked).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
    return { tasks: rows.slice(0, WORK_ORDER_LINK_LIST_LIMIT).map((task) => ({ id: task.id, kind: task.kind, title: task.title, status: task.status, progress: workflowTaskProgress(task), dueDate: task.dueDate, assignedToName: task.assignedToName,
      durationSec: durationSec(entriesFor(ctx, linked).filter((entry) => entry.sourceTaskId === task.id), ctx.now), ...(roundOfProtocolValues(task.data) ? { occurrence: roundOfProtocolValues(task.data)!.occurrence } : {}), ...(linkedTaskFormName(task.data) ? { formName: linkedTaskFormName(task.data) } : {}) })), hasMore: rows.length > WORK_ORDER_LINK_LIST_LIMIT };
  }
  // Fråga 8a (2026-10-27): without the right to read work orders, the ones the person is responsible for or booked on.
  const ownOnly = !ctx.can("work-order", "read");
  const own = (task: DemoTask) => task.assignedToUserId === ctx.user.id || ctx.db.activities.some((activity) => activity.workflowTaskId === task.id && activity.assignments.some((item) => item.userId === ctx.user.id));
  const q = (params.get("q") ?? "").trim().toLocaleLowerCase("sv-SE");
  const projectId = params.get("projectId");
  const customerId = params.get("customerId");
  const standalone = params.get("standalone") === "1";
  const include = params.get("include");
  const view = (task: DemoTask) => ({ id: task.id, kind: task.kind, title: task.title, status: task.status, projectId: task.projectId, customerId: task.customerId, facilityId: task.facilityId ?? null,
    assignedToUserId: task.assignedToUserId ?? null, assignedToName: task.assignedToName ?? "", plannedStartDate: task.plannedStartDate ?? "", dueDate: task.dueDate ?? "", roundScheduleId: task.roundScheduleId ?? null,
    projectName: ctx.db.projects.find((project) => project.id === task.projectId)?.name ?? "", customerName: ctx.db.customers.find((customer) => customer.id === task.customerId)?.name ?? "" });
  const open = ctx.db.tasks.filter((task) => task.kind === "WORK_ORDER" && isTaskOpen(task.status) && (!ownOnly || own(task)) && (!q || task.title.toLocaleLowerCase("sv-SE").includes(q))
    && (projectId ? !task.projectId || task.projectId === projectId : standalone ? !task.projectId : true) && (!customerId || !task.customerId || task.customerId === customerId)
    && !projectArchived(ctx, task.projectId) && !projectClosed(ctx, task.projectId))
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)).slice(0, WORK_ORDER_OPTION_LIMIT);
  const current = include ? ctx.db.tasks.find((task) => task.id === include && task.kind === "WORK_ORDER" && (!ownOnly || own(task))) : undefined;
  return { options: [...(current && !open.includes(current) ? [current] : []), ...open].map(view) };
}

// ---------- /api/workflow-time ----------
const timeEntryInput = z.object({ id: z.string().optional(), taskId: z.string().optional(), projectId: z.string().optional(), userId: z.string().optional(), startedAt: z.iso.datetime(), endedAt: z.iso.datetime(), note: z.string().trim().max(1000).default(""), timeTypeId: z.string().max(100).nullable().optional() })
  .refine((entry) => Boolean(entry.taskId) !== Boolean(entry.projectId), { message: "Välj arbetsorder eller projekt för tiden." });
/** Closes the caller's running project time (one project, or all but one); the entry enters the time history, as the server. */
function closeDemoProjectTime(ctx: Context, projectId: string | null, keepShort: boolean, onlyThis = false, except?: string) {
  const now = ctx.now.toISOString();
  const stopped: { entryId: string; taskId: string; taskTitle: string; projectId: string; startedAt: string; endedAt: string; durationSec: number }[] = [];
  for (const entry of ctx.db.timeEntries.filter((item) => item.projectId && !item.endedAt && item.userId === ctx.user.id && (onlyThis ? item.projectId === projectId : item.projectId !== except))) {
    const project = ctx.db.projects.find((item) => item.id === entry.projectId);
    const elapsedSec = Math.max(0, Math.floor((ctx.now.getTime() - Date.parse(entry.startedAt)) / 1000));
    const seconds = keepShort ? Math.max(MIN_TIME_ENTRY_SECONDS, elapsedSec) : elapsedSec;
    if (seconds < MIN_TIME_ENTRY_SECONDS) { ctx.db.timeEntries = ctx.db.timeEntries.filter((item) => item.id !== entry.id); continue; }
    Object.assign(entry, { endedAt: now, durationSec: seconds, updatedAt: now });
    ctx.db.timeEvents.push({ id: nextId(ctx, "time-event"), entryId: entry.id, userId: entry.userId, action: "CREATED", previous: null, reason: "", actorUserId: ctx.user.id, actorName: ctx.user.name,
      next: { taskId: entry.projectId, taskTitle: project?.name ?? "", projectId: entry.projectId, startedAt: entry.startedAt, endedAt: now, durationSec: seconds, note: entry.note }, createdAt: now });
    stopped.push({ entryId: entry.id, taskId: entry.projectId!, taskTitle: project?.name ?? "", projectId: entry.projectId!, startedAt: entry.startedAt, endedAt: now, durationSec: seconds });
  }
  return stopped;
}
/** Closes the caller's running time on one work order (a project timer started), pausing it like the server. */
function closeDemoTaskTime(ctx: Context, task: DemoTask, keepShort: boolean) {
  const now = ctx.now.toISOString();
  const stopped: { entryId: string; taskId: string; taskTitle: string; startedAt: string; endedAt: string; durationSec: number }[] = [];
  for (const entry of entriesFor(ctx, task.id).filter((item) => !item.endedAt && item.userId === ctx.user.id)) {
    const elapsedSec = Math.max(0, Math.floor((ctx.now.getTime() - Date.parse(entry.startedAt)) / 1000));
    const seconds = keepShort ? Math.max(MIN_TIME_ENTRY_SECONDS, elapsedSec) : elapsedSec;
    if (seconds < MIN_TIME_ENTRY_SECONDS) { ctx.db.timeEntries = ctx.db.timeEntries.filter((item) => item.id !== entry.id); continue; }
    Object.assign(entry, { endedAt: now, durationSec: seconds, updatedAt: now });
    ctx.db.timeEvents.push({ id: nextId(ctx, "time-event"), entryId: entry.id, userId: entry.userId, action: "CREATED", previous: null, reason: "", actorUserId: ctx.user.id, actorName: ctx.user.name,
      next: { taskId: task.id, taskTitle: task.title, startedAt: entry.startedAt, endedAt: now, durationSec: seconds, note: entry.note }, createdAt: now });
    stopped.push({ entryId: entry.id, taskId: task.id, taskTitle: task.title, startedAt: entry.startedAt, endedAt: now, durationSec: seconds });
  }
  if (task.status === "IN_PROGRESS" && !entriesFor(ctx, task.id).some((entry) => !entry.endedAt)) Object.assign(task, { status: "PAUSED", version: task.version + 1, updatedAt: now });
  return stopped;
}
function workflowTime(ctx: Context, request: Request) {
  if (request.method === "GET") {
    if (request.url.searchParams.get("running") === "mine") {
      const running = ctx.db.timeEntries.filter((entry) => !entry.endedAt && entry.userId === ctx.user.id).map((entry) => ({ entry, task: ctx.db.tasks.find((task) => task.id === entry.taskId) }))
        .filter((item): item is { entry: typeof item.entry; task: DemoTask } => Boolean(item.task) && ctx.can(workflowSubjectForTask(item.task!.kind), "read"));
      // Projekttid (2026-10-26): a running timer on a project, as the server.
      const projectRunning = ctx.can("projects", "read") ? ctx.db.timeEntries.filter((entry) => !entry.endedAt && entry.userId === ctx.user.id && entry.projectId).flatMap((entry) => { const project = ctx.db.projects.find((item) => item.id === entry.projectId); return project ? [{ entryId: entry.id, taskId: project.id, taskTitle: project.name, kind: "PROJECT", projectId: project.id, projectName: project.name, startedAt: entry.startedAt }] : []; }) : [];
      return { now: ctx.now.toISOString(), running: [...running.map(({ entry, task }) => ({ entryId: entry.id, taskId: task.id, taskTitle: task.title, kind: task.kind, projectName: ctx.db.projects.find((project) => project.id === task.projectId)?.name ?? null, startedAt: entry.startedAt })), ...projectRunning] };
    }
    if (request.url.searchParams.get("capacity") === "week") {
      const week = capacityWeek(ctx.now);
      return { currentUserId: ctx.user.id, schedule: { organizationWeeklyWorkMinutes: ctx.db.organization.weeklyWorkMinutes, memberWeeklyWorkMinutes: ctx.user.weeklyWorkMinutes, noFixedHours: Boolean(ctx.user.noFixedHours) },
        timeEntries: ctx.db.timeEntries.filter((entry) => entry.userId === ctx.user.id && sourceOf(ctx, entryOwnerId(entry)) && Date.parse(entry.startedAt) >= week.startsAt.getTime() && Date.parse(entry.startedAt) < week.endsAt.getTime())
          .map((entry) => ({ startedAt: entry.startedAt, durationSec: entry.durationSec })) };
    }
    // Tidstyper (2026-10-29): the list for the settings page, as Cloud.
    if (request.url.searchParams.get("types") === "1") return { timeTypes: demoTimeTypesWithPolicy(ctx.db, ctx.admin), canEdit: ctx.admin };
    const history = request.url.searchParams.get("history");
    if (history) return { events: ctx.db.timeEvents.filter((event) => event.entryId === history && (ctx.admin || event.userId === ctx.user.id)).sort((a, b) => b.createdAt.localeCompare(a.createdAt)) };
    const corrected = new Set(ctx.db.timeEvents.filter((event) => event.actorUserId !== event.userId).map((event) => event.entryId));
    const mark = <T extends { id: string }>(entry: T) => ({ ...entry, corrected: corrected.has(entry.id) });
    // Arbetsordern styr (2026-10-26): time is on work orders and on projects themselves, as the server sends them.
    const tasks = [...readableTasks(ctx)].filter((task) => task.kind === "WORK_ORDER").sort((a, b) => a.title.localeCompare(b.title, "sv"));
    const projects = ctx.can("projects", "read") ? [...ctx.db.projects].sort((a, b) => a.name.localeCompare(b.name, "sv")) : [];
    const bare = ({ id, userId, startedAt, endedAt, durationSec: seconds, note, createdAt, updatedAt, timeTypeId }: DemoDatabase["timeEntries"][number]) => ({ id, userId, startedAt, endedAt, durationSec: seconds, note, timeTypeId: timeTypeId ?? null, createdAt, updatedAt });
    const projectEntries = (projectId: string) => ctx.db.timeEntries.filter((entry) => entry.projectId === projectId);
    const focus = request.url.searchParams.get("taskId");
    return {
      currentUserId: ctx.user.id,
      focusTaskId: focus ? ctx.db.tasks.find((task) => task.id === focus)?.workOrderId ?? focus : null,
      tasks: [...tasks.map((task) => {
        const project = ctx.db.projects.find((item) => item.id === task.projectId);
        return { id: task.id, title: task.title, kind: task.kind, status: task.status, projectId: task.projectId, project: project ? { name: project.name } : null, archived: Boolean(project?.archivedAt),
          timeEntries: entriesFor(ctx, task.id).filter((entry) => entry.userId === ctx.user.id).sort((a, b) => b.startedAt.localeCompare(a.startedAt)).map((entry) => mark(bare(entry))) };
      }), ...projects.map((project) => ({ id: project.id, title: project.name, kind: "PROJECT", status: projectTimeState(project).status, projectId: project.id, project: { name: project.name }, archived: Boolean(project.archivedAt),
        timeEntries: projectEntries(project.id).filter((entry) => entry.userId === ctx.user.id).sort((a, b) => b.startedAt.localeCompare(a.startedAt)).map((entry) => mark(bare(entry))) }))],
      team: seesTeam(ctx) ? { canEdit: ctx.admin, members: members(ctx), entries: [...tasks.flatMap((task) => entriesFor(ctx, task.id).map((entry) => ({ ...mark(bare(entry)), taskId: task.id }))), ...projects.flatMap((project) => projectEntries(project.id).map((entry) => ({ ...mark(bare(entry)), taskId: project.id })))] } : null,
      schedule: { organizationWeeklyWorkMinutes: ctx.db.organization.weeklyWorkMinutes, memberWeeklyWorkMinutes: ctx.user.weeklyWorkMinutes, canEditOrganization: ctx.admin, events: [],
        workdayStartMinutes: ctx.db.organization.workdayStartMinutes, workdayEndMinutes: ctx.db.organization.workdayEndMinutes, noFixedHours: Boolean(ctx.user.noFixedHours) },
      timeTypes: demoTimeTypes(ctx.db), canEditTimeTypes: ctx.admin,
    };
  }
  const input = request.body as Json;
  const now = ctx.now.toISOString();
  const state = (task: Source) => ({ status: task.status, archived: projectArchived(ctx, task.projectId) });
  const check = (...args: Parameters<typeof assertTimeCorrection>) => {
    try { return assertTimeCorrection(...args); } catch (error) { if (error instanceof TimeCorrectionError) throw new DemoError(error.status, error.message); throw error; }
  };
  const snapshot = (entry: { startedAt: string; endedAt: string | null; durationSec: number; note: string; timeTypeId?: string | null }, task: Source) => ({ taskId: task.id, taskTitle: task.title, ...(task.project ? { projectId: task.id } : {}), startedAt: entry.startedAt, endedAt: entry.endedAt, durationSec: entry.durationSec, note: entry.note, timeType: resolveTimeType(demoTimeTypes(ctx.db), entry.timeTypeId)?.name });
  // Tidstyper (2026-10-29): the list is changed by admins, with the same rules as Cloud.
  if (input.action === "time_type_save" || input.action === "time_type_move" || input.action === "time_type_remove") {
    try { return demoTimeTypeAction(ctx.db, ctx.admin, input); } catch (error) { throw error instanceof DemoTimeTypeError ? new DemoError(error.status, error.message) : error; }
  }
  const checkedType = (chosen: unknown, current?: string | null) => { try { return demoCheckedTimeTypeId(ctx.db, chosen, current); } catch (error) { throw error instanceof DemoTimeTypeError ? new DemoError(error.status, error.message) : error; } };
  const reason = typeof input.reason === "string" ? input.reason : "";
  const requireSource = (source: Source) => { if (source.project) ctx.require("projects", "read"); else ctx.require(workflowSubjectForTask(source.kind as DemoTask["kind"]), "edit"); };
  // Projekttid med timer (svar 5a): start and stop on a project, one running timer per person, as the server.
  if (input.action === "project_timer") {
    ctx.require("projects", "read");
    const project = ctx.db.projects.find((item) => item.id === input.projectId);
    if (!project) throw new DemoError(404, "Projektet hittades inte.");
    const start = input.command === "START";
    if (start && project.archivedAt) throw new DemoError(409, "Återställ projektet innan du skriver tid på det.");
    if (start && project.closedAt) throw new DemoError(409, "Projektet är avslutat. Återöppna det för att skriva tid.");
    const keepShort = input.keepShort === true;
    if (!start) return { ok: true, stopped: closeDemoProjectTime(ctx, project.id, keepShort, true) };
    if (!ctx.db.timeEntries.some((entry) => entry.projectId === project.id && !entry.endedAt && entry.userId === ctx.user.id)) requireTimeOpen(ctx, [{ userId: ctx.user.id, startedAt: now }]);
    const stopped: StoppedTimer[] = [...closeDemoProjectTime(ctx, null, keepShort, false, project.id)];
    for (const other of ctx.db.tasks.filter((item) => entriesFor(ctx, item.id).some((entry) => !entry.endedAt && entry.userId === ctx.user.id))) stopped.push(...closeDemoTaskTime(ctx, other, keepShort));
    if (!ctx.db.timeEntries.some((entry) => entry.projectId === project.id && !entry.endedAt && entry.userId === ctx.user.id))
      ctx.db.timeEntries.push({ id: nextId(ctx, "time"), taskId: null, projectId: project.id, userId: ctx.user.id, startedAt: now, endedAt: null, durationSec: 0, note: "", createdAt: now, updatedAt: now });
    return { ok: true, stopped };
  }
  const findEntry = (id: unknown) => {
    const entry = ctx.db.timeEntries.find((item) => item.id === id && (ctx.admin || item.userId === ctx.user.id));
    const task = entry ? sourceOf(ctx, entryOwnerId(entry)) : null;
    if (!entry || !task) throw new DemoError(404, "Tidposten hittades inte.");
    return { entry, task };
  };
  if (input.action === "schedule_save") {
    if (input.scope === "ORGANIZATION") { requireAdmin(ctx); ctx.db.organization.weeklyWorkMinutes = Number(input.minutes); }
    else {
      ctx.user.weeklyWorkMinutes = input.minutes === null ? null : Number(input.minutes);
      if (typeof input.noFixedHours === "boolean") ctx.user.noFixedHours = input.noFixedHours;
    }
    return { ok: true };
  }
  // Företagets arbetsdag (2026-10-30): admins, the same check as Cloud.
  if (input.action === "workday_save") {
    requireAdmin(ctx);
    const parsed = workdaySchema.safeParse({ startMinutes: input.startMinutes, endMinutes: input.endMinutes });
    if (!parsed.success) throw new DemoError(422, parsed.error.issues[0]?.message ?? "Kontrollera arbetsdagen.");
    Object.assign(ctx.db.organization, { workdayStartMinutes: parsed.data.startMinutes, workdayEndMinutes: parsed.data.endMinutes });
    return { ok: true };
  }
  if (input.action === "delete") {
    const { entry, task } = findEntry(input.id);
    requireSource(task);
    const normalized = check({ actorIsAdmin: ctx.admin, actorOwnsEntry: entry.userId === ctx.user.id, source: state(task) }, reason);
    requireTimeOpen(ctx, [entry]);
    ctx.db.timeEntries = ctx.db.timeEntries.filter((item) => item.id !== entry.id);
    ctx.db.timeEvents.push({ id: nextId(ctx, "time-event"), entryId: entry.id, userId: entry.userId, action: "DELETED", previous: snapshot(entry, task), next: null, reason: normalized, actorUserId: ctx.user.id, actorName: ctx.user.name, createdAt: now });
    return { ok: true };
  }
  const data = timeEntryInput.parse(input.entry);
  if (Date.parse(data.endedAt) <= Date.parse(data.startedAt)) throw new DemoError(422, "Sluttiden måste vara efter starttiden.");
  const seconds = Math.floor((Date.parse(data.endedAt) - Date.parse(data.startedAt)) / 1000);
  if (seconds > 24 * 3600) throw new DemoError(422, "En enskild tidpost får vara högst 24 timmar.");
  // A project's own time (projectId), or a work order's – a task's time lands on its work order, as the server, and
  // remembers the task it was written in (2026-10-27).
  let task: Source;
  let sourceTaskId: string | null = null;
  if (data.projectId) {
    const source = sourceOf(ctx, data.projectId);
    if (!source?.project) throw new DemoError(404, "Projektet hittades inte.");
    requireSource(source);
    task = source;
  } else {
    const picked = ctx.db.tasks.find((item) => item.id === data.taskId);
    if (!picked) throw new DemoError(404, "Uppgiften hittades inte.");
    ctx.require(workflowSubjectForTask(picked.kind), "edit");
    task = sourceOf(ctx, timeOwner(ctx, picked).id)!;
    if (task.id !== picked.id) sourceTaskId = picked.id;
  }
  const owner = task.project ? { taskId: null, projectId: task.id } : { taskId: task.id, projectId: null };
  const next = { startedAt: data.startedAt, endedAt: data.endedAt, durationSec: seconds, note: data.note };
  if (data.id) {
    const { entry, task: source } = findEntry(data.id);
    const normalized = check({ actorIsAdmin: ctx.admin, actorOwnsEntry: entry.userId === ctx.user.id, source: state(source), target: state(task) }, reason);
    requireTimeOpen(ctx, [entry, { userId: entry.userId, startedAt: data.startedAt }]);
    const previous = snapshot(entry, source);
    const timeTypeId = checkedType(data.timeTypeId, entry.timeTypeId);
    if (timeTypeId !== undefined) entry.timeTypeId = timeTypeId;
    Object.assign(entry, next, owner, sourceTaskId ? { sourceTaskId } : source.id === task.id ? {} : { sourceTaskId: null }, { updatedAt: now });
    ctx.db.timeEvents.push({ id: nextId(ctx, "time-event"), entryId: entry.id, userId: entry.userId, action: "UPDATED", previous, next: snapshot({ ...next, timeTypeId: entry.timeTypeId }, task), reason: normalized, actorUserId: ctx.user.id, actorName: ctx.user.name, createdAt: now });
    return { id: entry.id };
  }
  const ownerId = data.userId ?? ctx.user.id;
  if (ownerId !== ctx.user.id) { requireAdmin(ctx); if (!ctx.db.users.some((user) => user.id === ownerId)) throw new DemoError(400, "Medarbetaren tillhör inte arbetsytan."); }
  const normalized = check({ actorIsAdmin: ctx.admin, actorOwnsEntry: ownerId === ctx.user.id, target: state(task) }, reason);
  requireTimeOpen(ctx, [{ userId: ownerId, startedAt: data.startedAt }]);
  const entry = { id: nextId(ctx, "time"), ...owner, sourceTaskId, userId: ownerId, ...next, timeTypeId: checkedType(data.timeTypeId) ?? null, createdAt: now, updatedAt: now };
  ctx.db.timeEntries.push(entry);
  ctx.db.timeEvents.push({ id: nextId(ctx, "time-event"), entryId: entry.id, userId: ownerId, action: "CREATED", previous: null, next: snapshot(entry, task), reason: normalized, actorUserId: ctx.user.id, actorName: ctx.user.name, createdAt: now });
  return { id: entry.id };
}

// ---------- read-only aggregates ----------
/** The jobs booked on the signed-in person (Mina jobb, 2026-10-09). */
const bookedForMe = (ctx: Context) => bookedTaskIdsForUser(ctx.db.activities.map((activity) => ({ ...activity, assignedToUserIds: activity.assignments.map((item) => item.userId) })), ctx.user.id);
/** Mina projekt by the shared rule (lib/workflow/project-filters.ts), for the list and the key figure alike (dashboard etapp 3). */
const isMyDemoProject = (ctx: Context, project: DemoProject, booked: ReadonlySet<string>) =>
  isMineProject(project, ctx.user.id, ctx.db.tasks.filter((task) => task.projectId === project.id).map((task) => ({ assignedToUserId: task.assignedToUserId, createdBy: task.createdBy, booked: booked.has(task.id) })));
/** What the project attention rule needs: status, budget and reported time (work orders' and the project's own). */
function projectAttentionOf(ctx: Context, project: DemoProject) {
  const reported = ctx.db.timeEntries.filter((entry) => sourceOf(ctx, entryOwnerId(entry))?.projectId === project.id).reduce((sum, entry) => sum + entry.durationSec, 0);
  return { status: projectStatus(ctx, project), timeBudgetMinutes: project.timeBudgetMinutes, reportedMinutes: Math.round(reported / 60) };
}
function overviewKpis(ctx: Context) {
  const week = capacityWeek(ctx.now);
  const booked = bookedForMe(ctx);
  const tasks = readableTasks(ctx).map((task): OverviewKpiTask & { projectId: string | null } => ({ kind: task.kind, status: task.status, dueDate: task.dueDate, completedAt: task.completedAt, progress: workflowTaskProgress(task), isMine: isMine(ctx, task) || booked.has(task.id), projectId: task.projectId }));
  const team = seesTeam(ctx);
  const people = team ? ctx.db.users : [ctx.user];
  const input = {
    currentUserId: ctx.user.id,
    now: ctx.now,
    members: people.map((user) => ({ id: user.id, weeklyWorkMinutes: expectedWeeklyWorkMinutes(ctx.db.organization.weeklyWorkMinutes, user) })),
    tasks,
    projects: ctx.can("projects", "read") ? ctx.db.projects.map((project) => ({ ...projectAttentionOf(ctx, project), isMine: isMyDemoProject(ctx, project, booked) })) : [],
    timeEntries: ctx.db.timeEntries.filter((entry) => Date.parse(entry.startedAt) >= week.startsAt.getTime() && Date.parse(entry.startedAt) < week.endsAt.getTime() && (team || entry.userId === ctx.user.id))
      .map((entry) => ({ userId: entry.userId, startedAt: entry.startedAt, durationSec: durationSec([entry], ctx.now) })),
    activities: visibleActivities(ctx).map((activity) => ({ ...capacityActivity(activity), workflowTask: activityTask(ctx, activity) })),
  };
  return { canViewTeam: team, team: team ? summarizeOverviewKpis({ ...input, scope: "team" }) : null, mine: summarizeOverviewKpis({ ...input, scope: "mine" }) };
}
function overviewWork(ctx: Context, request: Request) {
  const params = request.url.searchParams;
  const projectName = (projectId: string | null) => projectId ? ctx.db.projects.find((project) => project.id === projectId)?.name : undefined;
  const items = buildOverviewWork({
    today: swedishDayKey(ctx.now),
    projects: ctx.can("projects", "read") ? ctx.db.projects.map((project) => ({
      id: project.id, name: project.name, updatedAt: project.updatedAt, dueDate: project.dueDate, status: projectStatus(ctx, project),
      tasks: readableTasks(ctx).filter((task) => task.projectId === project.id).map((task) => ({ status: task.status as string, progress: workflowTaskProgress(task) })),
      people: projectPeople(project, readableTasks(ctx).filter((task) => task.projectId === project.id)),
    })) : [],
    tasks: readableTasks(ctx).map((task) => ({ id: task.id, title: task.title, kind: task.kind, status: task.status, progress: workflowTaskProgress(task), dueDate: task.dueDate, updatedAt: task.updatedAt, projectName: projectName(task.projectId) })),
  });
  return selectOverviewWork(items, { filter: z.enum(OVERVIEW_WORK_FILTERS).catch("all").parse(params.get("filter")), sort: z.enum(OVERVIEW_WORK_SORTS).catch("updated").parse(params.get("sort")), page: Number(params.get("page")) || 1 });
}
function notifications(ctx: Context, request: Request) {
  const readable = readableTasks(ctx).filter((task) => isTaskOpen(task.status) && !projectArchived(ctx, task.projectId) && (ctx.admin || seesTeam(ctx) || isMine(ctx, task)));
  const teamIds = new Set(readable.filter((task) => !isMine(ctx, task)).map((task) => `${task.kind}:${task.id}`));
  const sources = readable
    .map((task) => ({ id: task.id, title: task.title, kind: task.kind, status: task.status, dueDate: task.dueDate, urgent: task.kind === "WORK_ORDER" && isUrgentOpen(task.status, demoOrderSummary(ctx.db, task)) }));
  const today = notificationToday(ctx.now);
  const machineNotices = ctx.can("work-order", "read") && (ctx.admin || ctx.can("maintenance", "read")) ? demoMachineNotices(ctx.db, ctx.can("work-order", "edit")) : [];
  const items = [...machineNotices, ...demoSelfInspectionReminders(ctx.user, ctx.admin), ...taskNotifications(sources, today).map((item) => teamIds.has(item.id) ? { ...item, audience: "team" as const } : item)];
  return demoNotifications(items, request, { canTeam: seesTeam(ctx), today, scope: ctx.admin ? "team" : "mine" });
}
function taskStatistics(ctx: Context, request: Request) {
  const params = request.url.searchParams;
  // Jag (2026-10-29): mine=1 counts only the viewer's own tasks and is for everyone, as Cloud.
  const mine = params.get("mine") === "1";
  if (!mine && !seesTeam(ctx)) throw new DemoError(403, "Du saknar behörighet att se teamets statistik.");
  const today = swedishDayKey(ctx.now);
  const from = params.get("from") || `${Number(today.slice(0, 4)) - 1}-${today.slice(5, 7)}-01`;
  const to = params.get("to") || today;
  const days = (Date.parse(to) - Date.parse(from)) / 86400000;
  if (!(days >= 0 && days <= 1826)) throw new DemoError(400, "Välj ett datumintervall på högst fem år, med start före slut.");
  const bucket = taskStatisticsBucket(from, to, (params.get("bucket") || "auto") as "auto");
  const type = z.enum(TASK_STATISTICS_TYPES).parse(params.get("type") || "ALL");
  const page = Math.max(1, Number(params.get("page")) || 1);
  // The same rules as Cloud (lib/workflow/task-statistics.ts, 2026-10-28): one measure per task, drafts nowhere,
  // Utgått never completed, performers by user id, and the company's own goal (none in the demo until an admin sets one).
  const counted = countTaskStatistics({
    rows: (ctx.admin ? ctx.db.tasks : readableTasks(ctx)).filter((task) => !mine || task.assignedToUserId === ctx.user.id).map((task) => ({
      id: task.id, kind: task.kind, status: task.status, workOrderId: task.workOrderId ?? null, round: hasRoundMarker(task.kind, task.data), title: task.title,
      assignedToUserId: task.assignedToUserId, assignedToName: task.assignedToName, createdAt: task.createdAt, completedAt: task.completedAt,
    })),
    from, to, type, names: new Map(ctx.db.users.map((user) => [user.id, user.name])),
  });
  const goalPerMonth = mine ? null : ctx.db.settings.goals?.completedWorkOrdersPerMonth ?? null;
  const summary = summarizeTaskStatistics({ created: counted.created, completed: counted.completed, from, to, bucket, monthlyTarget: type === "WORK_ORDER" ? goalPerMonth ?? 0 : 0 });
  const items = counted.items.map((item) => ({ id: item.id, kind: item.kind, taskKind: item.taskKind, measure: item.measure, title: item.title, status: item.status, performer: item.performer, createdDay: item.createdDay, completedDay: item.completedDay }));
  return { from, to, bucket, type, ...summary, kpis: { ...summary.kpis, cancelled: counted.cancelled, members: mine ? 1 : ctx.db.users.length }, measures: counted.measures,
    goal: summarizeWorkOrderGoal({ completed: counted.workOrdersCompleted, from, to, perMonth: goalPerMonth }), performers: mine ? [] : counted.performers,
    recent: { items: items.slice((page - 1) * 10, page * 10), page, pages: Math.max(1, Math.ceil(items.length / 10)), total: items.length } };
}
/** Teamets projektstatistik (2026-10-29): the same rules as /api/project-statistics, in memory. */
function projectStatistics(ctx: Context, request: Request) {
  if (!seesTeam(ctx)) throw new DemoError(403, "Du saknar behörighet att se teamets statistik.");
  if (!ctx.admin && !ctx.can("projects", "read")) throw new DemoError(403, "Du saknar behörighet att läsa projekt.");
  const params = request.url.searchParams;
  const today = swedishDayKey(ctx.now);
  const from = params.get("from") || `${Number(today.slice(0, 4)) - 1}-${today.slice(5, 7)}-01`;
  const to = params.get("to") || today;
  const days = (Date.parse(to) - Date.parse(from)) / 86400000;
  if (!(days >= 0 && days <= 1826)) throw new DemoError(400, "Välj ett datumintervall på högst fem år, med start före slut.");
  const bucket = taskStatisticsBucket(from, to, z.enum(["auto", "day", "week", "month"]).catch("auto").parse(params.get("bucket") || "auto"));
  const filter = z.enum(PROJECT_STATISTICS_LIST_FILTERS).catch("period").parse(params.get("filter") || "period");
  const page = Math.max(1, Number(params.get("page")) || 1);
  const day = (value: string | Date | null | undefined) => value ? swedishDayKey(new Date(value)) : null;
  const tasksOf = (id: string) => ctx.db.tasks.filter((task) => task.projectId === id);
  const summary = summarizeProjectStatistics({ from, to, bucket, filter, page, projects: ctx.db.projects.map((project) => {
    const tasks = tasksOf(project.id);
    return { id: project.id, name: project.name, responsibleName: project.responsibleName, startDate: project.startDate ?? '', dueDate: project.dueDate,
      createdDay: day(project.createdAt)!, closedDay: day(project.closedAt), archivedDay: day(project.archivedAt), status: projectStatus(ctx, project),
      tasksTotal: tasks.filter((task) => task.status !== "CANCELLED").length, tasksDone: tasks.filter((task) => task.status === "COMPLETED").length };
  }) });
  return { from, to, bucket, filter, ...summary, list: { ...summary.list, items: summary.list.items.map((item) => ({ ...item, progress: projectCompletion(tasksOf(item.id).map((task) => ({ status: task.status, progress: workflowTaskProgress(task), estimatedMinutes: task.estimatedMinutes }))) })) } };
}
/** Företagets mål (2026-10-28): the same rules as /api/company-goals, in memory. */
function companyGoals(ctx: Context, request: Request) {
  const economy = canViewEconomy({ admin: ctx.admin, workflowPermissions: ctx.user.permissions });
  if (request.method === "GET") {
    if (!economy && !seesTeam(ctx)) throw new DemoError(403, "Du saknar behörighet att se företagets mål.");
    return { goals: visibleCompanyGoals(companyGoalsOf(ctx.db.settings.goals), { economy }), canEdit: ctx.admin };
  }
  requireAdmin(ctx);
  const parsed = companyGoalsSchema.safeParse((request.body as { goals?: unknown } | null)?.goals);
  if (!parsed.success) throw new DemoError(400, parsed.error.issues[0]?.message ?? "Målen kunde inte läsas.");
  ctx.db.settings.goals = parsed.data;
  return { goals: parsed.data };
}
/** Mina uppgifter and Arbetsorder: the same scopes, filters, counts, sorting and pages as /api/work-items. */
function workItems(ctx: Context, request: Request) {
  const params = request.url.searchParams;
  const filter = (WORK_ITEM_FILTERS as readonly string[]).includes(params.get("filter") ?? "") ? params.get("filter") as WorkItemFilter : "open";
  const scope = resolveWorkListScope(params.get("scope") ?? "mine", WORK_LIST_SCOPES);
  const sort = (WORK_LIST_SORTS as readonly string[]).includes(params.get("sort") ?? "") ? params.get("sort") as WorkListSort : "updated";
  const onlyWorkOrders = params.get("kind") === "WORK_ORDER";
  // The Jobb tab's type filter (B3): TASK is every kind that is not a work order.
  const onlyTasks = params.get("kind") === "TASK";
  if (onlyWorkOrders) ctx.require("work-order", "read");
  const upkeep = maintenanceListFilterSchema.catch({ mtype: "", priority: "" }).parse({ mtype: params.get("mtype") ?? "", priority: params.get("priority") ?? "" });
  // Rondordrar (2026-10-26): the work orders of rounds, the others, or one round's.
  const origin = parseWorkOrderOrigin(params.get("origin") ?? "");
  const round = params.get("round");
  const from = filterDay(params.get("from"));
  const limit = Math.min(48, Math.max(1, Number(params.get("limit")) || 12));
  const page = Math.max(1, Number(params.get("page")) || 1);
  const q = (params.get("q") ?? "").trim();
  const kinds = workItemKindsForQuery(q) as string[];
  const projectName = (projectId: string | null) => ctx.db.projects.find((project) => project.id === projectId)?.name ?? "";
  const customerName = (customerId: string | null) => { const customer = ctx.db.customers.find((item) => item.id === customerId); return customer ? customerTitle(customer) : ""; };
  const placeName = (facilityId: string | null | undefined) => facilitySummary(ctx, facilityId)?.name ?? "";
  const booked = bookedForMe(ctx);
  const entries = [
    ...readableTasks(ctx).filter((task) => (onlyTasks ? task.kind !== "WORK_ORDER" : !onlyWorkOrders || (task.kind === "WORK_ORDER" && maintenanceMatches(itemsOf(ctx, task.id), upkeep))) && workOrderOriginMatches(task, origin, round) && completedFrom(task, from)).map((task) => {
      const item = { id: task.id, kind: task.kind, title: task.title, status: task.status, updatedAt: task.updatedAt, projectId: task.projectId, projectName: projectName(task.projectId), progress: workflowTaskProgress(task),
        customerName: customerName(task.customerId), placeName: listPlaceLabel(placeName(task.facilityId), tempPlaceOf(task.data)), responsibleName: task.assignedToName, assignedToName: task.assignedToName, dueDate: task.dueDate,
        plannedAt: nextPlannedAt(ctx.db.activities.filter((activity) => activity.workflowTaskId === task.id), new Date(ctx.now)), isMine: isMine(ctx, task) || booked.has(task.id),
        workOrderId: task.workOrderId ?? null, workOrderTitle: task.workOrderId && ctx.can("work-order", "read") ? ctx.db.tasks.find((other) => other.id === task.workOrderId)?.title ?? "" : "", roundScheduleId: task.roundScheduleId ?? null,
        ...(task.kind === "WORK_ORDER" ? { maintenance: demoOrderSummary(ctx.db, task) } : {}) };
      const urgent = task.kind === "WORK_ORDER" && isUrgentOpen(task.status, item.maintenance);
      return { item, id: task.id, title: task.title, updatedAt: task.updatedAt, date: task.dueDate, dueDate: task.dueDate, plannedStartDate: task.plannedStartDate, startedAt: task.startedAt, progress: item.progress, waitingOn: (task.data as { details?: { waitingOn?: string } } | null)?.details?.waitingOn, status: task.status, mine: item.isMine, urgent,
        state: workStateOf({ status: task.status, progress: item.progress }),
        search: [task.title, item.projectName, item.customerName, task.assignedToName, item.workOrderTitle, ...(kinds.includes(task.kind) ? [q] : [])] };
    }),
  ];
  // Förfallna on the demo's own day, as its key figures (dashboard etapp 3).
  const today = swedishDayKey(ctx.now);
  const result = listWork(entries, { filters: WORK_ITEM_FILTERS, matches: (entry, value) => workStateMatches(entry, value, today), filter, scope, sort, q, page, limit, counts: workListCountsAllowed(scope, ctx.admin) });
  return { ...result, items: result.items.map((entry) => entry.item) };
}
function search(ctx: Context, request: Request) {
  const q = (request.url.searchParams.get("q") ?? "").trim().toLowerCase();
  if (q.length < 2) throw new DemoError(400, "Skriv minst två tecken.");
  const match = (...values: (string | null | undefined)[]) => values.some((value) => value?.toLowerCase().includes(q));
  return {
    projects: ctx.can("projects", "read") ? ctx.db.projects.filter((project) => match(project.name, project.description, project.responsibleName)).slice(0, 6).map(({ id, name, description, responsibleName, archivedAt }) => ({ id, name, description, responsibleName, archivedAt })) : [],
    tasks: readableTasks(ctx).filter((task) => match(task.title, task.description, task.assignedToName, ctx.db.projects.find((item) => item.id === task.projectId)?.name)).slice(0, 6)
      .map(({ id, title, description, kind, status, projectId, assignedToName }) => ({ id, title, description, kind, status, projectId, assignedToName })),
    customers: ctx.db.customers.filter((customer) => !customer.deletedAt && match(customer.name, customer.company, customer.city, customer.email)).slice(0, 6),
  };
}
/** Sök (2026-10-05): the same matching and ranking as Cloud and Local, over the demo's data and the demo user's rights. */
function workspaceSearch(ctx: Context, request: Request) {
  const parsed = parseSearchQuery(request.url.searchParams.get("q") ?? "");
  const type = request.url.searchParams.get("type");
  const expand = (SEARCH_TYPES as readonly string[]).includes(type ?? "") ? type as SearchType : null;
  if (!parsed.active || searchTooShort(parsed)) return { groups: [], fuzzy: false };
  const scoped = expand ? { ...parsed, filters: { ...parsed.filters, types: [expand] } } : parsed;
  // The demo's data as it is now, also what was made in this visit (customers, quotes: 2026-10-10).
  const data = { customers: ctx.db.customers, customerFacilities: ctx.db.facilities ?? [], projects: ctx.db.projects, workflowTasks: ctx.db.tasks, formSchedules: [], quotes: demoQuoteSearchItems(ctx), reports: demoReportSearchItems(ctx) };
  return searchLocalWorkspace(data, scoped, { me: ctx.user.id, can: (subject) => ctx.can(subject, "read"), local: true, perGroup: expand ? 30 : 6 });
}
function administration(ctx: Context, request: Request) {
  requireAdmin(ctx);
  if (request.method !== "GET") throw new DemoError(403, "Användare och företagsuppgifter kan inte ändras i demon. Här ser du hur det ser ut för en företagsadministratör.");
  if (request.url.searchParams.get("events") === "older") return { events: [] };
  const organization = ctx.db.organization;
  return {
    organizations: [{
      id: organization.id, name: organization.name, isActive: true, storageMode: organization.storageMode,
      profile: DEMO_COMPANY_DETAILS, wallet: null,
      _count: { customers: ctx.db.customers.filter((customer) => !customer.deletedAt).length, workflowTasks: ctx.db.tasks.length },
      members: ctx.db.users.map((user) => ({ id: `member-${user.id}`, role: user.role, canDeleteControls: user.role === "ADMIN", workflowPermissions: user.permissions, isActive: true, user: { id: user.id, name: user.name, email: user.email, isActive: true } })),
      invitations: [],
    }],
    activeOrganizationId: organization.id, superadmin: false, invitationDeliveryEnabled: false, events: ctx.db.adminEvents, eventCount: ctx.db.adminEvents.length,
  };
}
const aiPolicy = { enabled: false, shareChatContent: false, shareCustomers: false, shareControls: false, shareDocuments: false, shareConversationHistory: false, allowedModules: [] as "KFID"[] };
/** One example answer in the chat's own form; the work is what this person may read, as on the lists. */
function demoChat(ctx: Context, body: unknown) {
  const input = (body ?? {}) as { content?: unknown; conversationId?: unknown; mode?: unknown };
  const question = typeof input.content === "string" ? input.content.trim().slice(0, 8_000) : "";
  if (!question) throw new DemoError(400, "Skriv en fråga.");
  const team = seesTeam(ctx);
  const tasks = readableTasks(ctx).filter((task) => team || isMine(ctx, task)).map((task) => ({
    id: task.id, kind: task.kind, title: task.title, status: task.status, dueDate: task.dueDate, plannedStartDate: task.plannedStartDate, assignedToUserId: task.assignedToUserId,
    customerName: customerTitle(ctx.db.customers.find((customer) => customer.id === task.customerId)) || "",
  }));
  const activities = ctx.db.activities.map((activity) => ({ title: activity.title, startsAt: activity.startsAt, endsAt: activity.endsAt, status: activity.status, userIds: activity.assignments.map((item) => item.userId), deleted: Boolean(activity.deletedAt) }));
  const answer = demoChatAnswer({ question, mode: input.mode === "auto" ? "auto" : "manual", now: ctx.now, userId: ctx.user.id, tasks, activities });
  const at = ctx.now.toISOString();
  const id = nextId(ctx, "chat");
  const conversationId = typeof input.conversationId === "string" && input.conversationId.startsWith("demo-") ? input.conversationId : `demo-conversation-${id}`;
  return {
    conversation: { id: conversationId, title: question.slice(0, 60) },
    userMessage: { id: `${id}-question`, role: "USER", content: question, model: null, citations: [], createdAt: at },
    message: { id: `${id}-answer`, role: "ASSISTANT", content: answer.content, model: null, citations: answer.citations, createdAt: at },
    mode: "RULES",
  };
}
const demoLegalNote = "I demon visas inte dokumenttexten. Gällande versioner finns under Villkor, Integritet och DPA längst ned på sidan.";

// ---------- /api/quotes and /api/quotes/export (Offerter, 2026-10-09) ----------
// Invented quotes in memory with the same rules as Cloud (features/demo/demo-quotes.ts); a work order made from an
// accepted quote is saved through this backend's own work order rules.
function quotes(ctx: Context, request: Request, path: string) {
  try {
    return demoQuotes({ ...ctx, createWorkOrder: (task) => workflowTasks(ctx, { method: "POST", url: request.url, body: { task } }) as { id: string } }, request, path);
  } catch (error) {
    throw error instanceof DemoQuoteError ? new DemoError(error.status, error.message) : error;
  }
}

// ---------- Underhåll (2026-10-30): the work orders' maintenance items ----------
// The demo has no machine tree or store: only a work order's list of its items (read-only), and the priority and what a
// paused order waits for in the work lists, as Cloud reads them.
const itemsOf = (ctx: Context, workOrderId: string) => demoItemsOf(ctx.db, workOrderId);
function maintenance(ctx: Context, request: Request) {
  const params = request.url.searchParams;
  // Maskinkortet (beslut 10): the demo has no machine tree, so the card holds the items on the part and no spare parts.
  if (request.method === "GET" && params.get("part") === "job_card") {
    const partId = params.get("id") ?? "";
    const items = readableTasks(ctx).filter((task) => task.kind === "WORK_ORDER").flatMap((task) => itemsOf(ctx, task.id)).filter((item) => item.partId === partId);
    if (!items.length) throw new DemoError(403, "Du har inget jobb på maskinen och saknar rätten Underhåll.");
    return { part: { id: partId, name: items[0].partName, partType: "", marking: "", status: "IN_SERVICE", ownerName: "", path: [] }, history: items.map((item) => ({ id: item.id, status: item.status, type: item.type, fault: item.fault, createdAt: item.createdAt, restoredAt: item.restoredAt })), spares: [] };
  }
  if (params.get("part") !== "work_order") {
    // Underhåll (2026-11-04): the machine tree, plans, store and cost live in features/demo/demo-maintenance.ts.
    try { return demoMaintenance(ctx, request); } catch (error) { throw error instanceof DemoMaintenanceError ? new DemoError(error.status, error.message) : error; }
  }
  if (request.method !== "GET") throw new DemoError(404, "Underhåll visas inte i demon.");
  ctx.require("work-order", "read");
  const workOrderId = params.get("id") ?? "";
  if (!readableTasks(ctx).some((task) => task.id === workOrderId && task.kind === "WORK_ORDER")) throw new DemoError(404, "Arbetsordern hittades inte.");
  // The plans make their items first (a round's work order holds the occurrence done in the round, 2026-11-27).
  try { seedDemoMaintenance(ctx); } catch { /* the demo's tree is not needed to list the items */ }
  const items = itemsOf(ctx, workOrderId).map((item) => ({ ...item, downtimeMinutes: null, workOrder: null }));
  return { items, machinePartId: null, canCreate: false };
}

function route(request: Request): Json | unknown {
  const ctx = context();
  const path = request.url.pathname.replace(/\/+$/, "");
  const get = request.method === "GET";
  switch (path) {
    case "/api/workspace": return workspace(ctx, request);
    case "/api/records": return records(ctx, request);
    case "/api/projects": return projects(ctx, request);
    case "/api/customer-card": return customerCard(ctx, request);
    case "/api/places": if (get && request.url.searchParams.get("register") === "1") return placeRegister(ctx, request);
      if (get && request.url.searchParams.get("id")) return placePage(ctx, request); break;
    case "/api/workflow-tasks": return workflowTasks(ctx, request);
    case "/api/maintenance": return maintenance(ctx, request);
    case "/api/workflow-tasks/work-order-links": return workOrderLinks(ctx, request);
    // Riskbedömning som steg: the same answer as Cloud's /api/workflow-tasks/risk-step.
    case "/api/workflow-tasks/risk-step": if (get) {
      // A new task opened in a work order: the order's context, as in Cloud (2026-10-29).
      const exceptionAllowed = ctx.db.settings.riskException !== false;
      if (request.url.searchParams.get("setting") === "1") return { exceptionAllowed };
      const orderId = request.url.searchParams.get("taskId") ? null : request.url.searchParams.get("workOrderId");
      if (orderId) {
        if (!ctx.db.tasks.some((item) => item.id === orderId && item.kind === "WORK_ORDER")) throw new DemoError(404, "Arbetsordern hittades inte.");
        const riskContext = localRiskStepContext(ctx.db.tasks, { kind: "FORM", status: "PLANNED", data: {}, workOrderId: orderId });
        return { exceptionAllowed, context: { extended: null, workOrder: riskContext.workOrder }, roundRisk: roundSafetyRiskFrom(ctx.db.tasks, orderId) };
      }
      const task = ctx.db.tasks.find((item) => item.id === request.url.searchParams.get("taskId"));
      if (!task) throw new DemoError(404, "Uppgiften hittades inte.");
      const riskContext = localRiskStepContext(ctx.db.tasks, task);
      return { exceptionAllowed, context: riskContext, state: riskStepState(task, riskContext), roundRisk: roundSafetyRequired(task) ? roundSafetyRiskFrom(ctx.db.tasks, task.workOrderId) : null };
    } break;
    case "/api/planned-activities": return plannedActivities(ctx, request);
    case "/api/project-schedule": return projectSchedule(ctx, request);
    case "/api/project-portfolio": return projectPortfolio(ctx, request);
    case "/api/planning-capacity": return planningCapacity(ctx);
    case "/api/workflow-time": return workflowTime(ctx, request);
    case "/api/overview-kpis": return overviewKpis(ctx);
    // Frånvaro (2026-10-29): features/demo/demo-absence.ts, the rules of lib/workflow/absence.ts in memory.
    case "/api/absence": try { return demoAbsence(ctx, request); } catch (error) { throw error instanceof DemoAbsenceError ? new DemoError(error.status, error.message) : error; }
    // Lön och frånvaro (2026-10-29): features/demo/demo-payroll.ts, the shared export engine in memory.
    // Tidsperiod (2026-10-30): features/demo/demo-time-periods.ts, the rules of lib/workflow/time-periods.ts in memory.
    case "/api/time-periods": try { return demoTimePeriods(ctx, request); } catch (error) { throw error instanceof DemoTimePeriodError ? new DemoError(error.status, error.message) : error; }
    case "/api/payroll": try { return demoPayroll(ctx, request); } catch (error) { throw error instanceof DemoPayrollError ? new DemoError(error.status, error.message) : error; }
    // Översikten (0.29.0) in the demo too (2026-10-29): features/demo/demo-overview.ts, the same answer and rules as Cloud.
    case "/api/overview": if (get) return demoOverview({
      db: ctx.db, user: ctx.user, admin: ctx.admin, now: ctx.now, can: ctx.can, booked: bookedForMe(ctx), attention: (project) => projectAttentionOf(ctx, project),
      roundViews: () => scheduleViews(ctx.admin || ctx.can("forms", "read") ? ctx.db.schedules : [], ctx.db.tasks, swedishDayKey(ctx.now), demoRoundOrders(ctx), swedishClock()),
      planningRounds: (period) => planningRounds(ctx.admin || ctx.can("forms", "read") ? ctx.db.schedules : [], ctx.db.tasks, period, swedishDayKey(ctx.now), undefined, demoRoundOrders(ctx), swedishClock()).rounds,
    }, request.url).catch((error) => { throw error instanceof DemoOverviewError ? new DemoError(error.status, error.message) : error; }); break;
    case "/api/task-notifications": return notifications(ctx, request);
    case "/api/comments": return demoComments(ctx.user, request, ctx.admin || ctx.can("work-order", "edit"));
    // Ändringshistorik (K3.2, 2026-11-27): the demo keeps no log; the card says that nothing is saved yet.
    case "/api/record-changes": if (get) return { entries: [], total: 0, next: null }; break;
    // Egenkontroll (2026-10-06): an invented programme in memory, the same rules as Cloud. The instrument register is
    // read on its own (2026-10-07), as in Cloud.
    case "/api/self-inspection": if (get && request.url.searchParams.get("part") === "card-history") return demoCardHistory(ctx.db, ctx.user, ctx.admin, request.url.searchParams.get("personId") ?? "");
      // Avvikelse ↔ arbetsorder (2026-10-10): the log's work orders, and Skapa arbetsorder through the demo's own order save.
      return demoSelfInspection(ctx.db, ctx.user, ctx.admin, request.method, request.body, { read: ctx.can("work-order", "read"), create: ctx.can("work-order", "create"),
        createWorkOrder: (task) => workflowTasks(ctx, { method: "POST", url: request.url, body: { action: "save", task } }) as { id: string } })
      .then((view) => get && request.url.searchParams.get("part") === "instruments" ? { canEdit: view.canEdit, instruments: view.instruments } : view)
      .catch((error) => { throw error instanceof SelfInspectionError ? new DemoError(error.status, error.message) : error; });
    case "/api/self-inspection/work": if (get) {
      const taskId = request.url.searchParams.get("taskId");
      const task = taskId ? ctx.db.tasks.find((item) => item.id === taskId) : undefined;
      const projectId = task?.projectId ?? request.url.searchParams.get("projectId");
      const project = projectId ? ctx.db.projects.find((item) => item.id === projectId) : undefined;
      return demoSelfInspectionWork(ctx.db, ctx.user, { taskId, projectId: project?.id ?? null, customerId: task?.customerId ?? project?.customerId ?? null,
        formId: request.url.searchParams.get("formId"), kind: request.url.searchParams.get("kind") });
    } break;
    // Roller med nivå (2026-10-07): the levels and the risk classes for the cards.
    case "/api/self-inspection/levels": if (get) return demoSelfInspectionLevels(ctx.db, ctx.user); break;
    case "/api/overview-work": return overviewWork(ctx, request);
    case "/api/forms": if (get) {
      const formId = request.url.searchParams.get("id");
      const form = formId ? ctx.db.forms.find((item) => item.id === formId) : null;
      if (formId && !form) throw new DemoError(404, "Formuläret är inte publicerat.");
      return form ? { templateId: form.id, id: form.id, version: form.version, name: form.name, description: form.description, color: form.color, icon: form.icon, category: form.category, allowStandalone: form.allowStandalone, allowInProject: form.allowInProject, document: form.document }
        : { forms: ctx.db.forms.map((form) => ({ id: form.id, version: form.version, name: form.name, description: form.description, color: form.color, icon: form.icon, category: form.category, allowStandalone: form.allowStandalone, allowInProject: form.allowInProject, hintek: true, source: "HINTEK", author: "HINTEK", publisher: "HINTEK" })) };
    } break;
    // Driftronder (2026-09-28): invented rounds in memory; since plan 1I (2026-10-11) they are planned too – Ny rond,
    // Ändra, Ta bort and Starta nu – with the same rules as Cloud (app/api/form-schedules). Planering (2026-10-06) reads
    // the rounds of its period, computed from the schedules exactly as in Cloud.
    case "/api/form-schedules": return formSchedules(ctx, request);
    // Limit profiles (2026-09-28): read-only and empty in the demo.
    case "/api/form-limits": if (get) return { family: request.url.searchParams.get("templateId") ?? "", canEdit: false, profiles: [], company: ctx.db.companyValues }; break;
    // Värden och referenser (2026-10-06): the invented company's values in memory, the same rules as Cloud.
    case "/api/company-values":
      if (!ctx.admin) throw new DemoError(403, "Bara en företagsadministratör kan göra det.");
      if (get) return { canEdit: true, catalog: companyValueCatalog(ctx.db.forms.map((form) => ({ id: form.id, name: form.name, document: form.document }))), values: ctx.db.companyValues };
      try { ctx.db.companyValues = mergeCompanyValues(ctx.db.companyValues, companyValuesSaveSchema.parse(request.body).values, ctx.user.name); }
      catch (error) { throw new DemoError(409, (error as Error).message); }
      return { values: ctx.db.companyValues };
    // Räkneverktyg (2026-10-07): the invented company's values the calculators read, under the same rule as Cloud.
    case "/api/calculator-values":
      if (!ctx.admin && !FORM_PERMISSION_AREAS.some((area) => ctx.can(area, "read"))) throw new DemoError(403, "Du saknar behörighet att läsa företagets värden.");
      if (get) return { canEdit: ctx.admin, values: ctx.db.companyValues.filter((item) => isCalculatorKey(item.key)) };
      break;
    case "/api/task-statistics": return taskStatistics(ctx, request);
    case "/api/project-statistics": return projectStatistics(ctx, request);
    case "/api/company-goals": return companyGoals(ctx, request);
    case "/api/workflow-search": return search(ctx, request);
    case "/api/search": return workspaceSearch(ctx, request);
    // Rapportarkiv (2026-10-12): the list is invented from the finished jobs; the files are not made in the demo.
    case "/api/report-archive": if (get) return demoReportArchive(ctx, request.url.searchParams); break;
    case "/api/work-items": return workItems(ctx, request);
    case "/api/work-orders": if (get) {
      // Mina arbetsordrar: the same list, filters and pages as the server (lib/workflow/work-orders.ts).
      if (!ctx.can("work-order", "read")) throw new DemoError(403, "Du saknar behörighet att visa den här delen av Workflow.");
      const params = request.url.searchParams;
      return listWorkOrders(ctx.db.tasks.map((task) => ({
        ...task, progress: workflowTaskProgress(task), customerName: customerTitle(ctx.db.customers.find((customer) => customer.id === task.customerId)) || "",
        projectName: ctx.db.projects.find((project) => project.id === task.projectId)?.name ?? "",
        plannedAt: nextPlannedAt(ctx.db.activities.filter((activity) => activity.workflowTaskId === task.id), new Date(ctx.now)),
      })), {
        scope: params.get("scope") === "all" ? "all" : "mine", q: params.get("q") ?? "", page: Math.max(1, Number(params.get("page")) || 1), userId: ctx.user.id,
        filter: (WORK_ITEM_FILTERS as readonly string[]).includes(params.get("filter") ?? "") ? params.get("filter") as WorkItemFilter : "open",
      });
    } break;
    case "/api/administration": return administration(ctx, request);
    case "/api/legal": if (get) return { documents: [
      { id: "demo-terms", type: "TERMS", scope: "ORGANIZATION", version: "demo", title: "Tjänstevillkor", content: demoLegalNote, contentHash: "", validFrom: null, acceptedAt: "2026-01-01T09:00:00.000Z", canAccept: false, acceptHelp: null, required: true },
      { id: "demo-privacy", type: "PRIVACY", scope: "INDIVIDUAL", version: "demo", title: "Integritetspolicy", content: demoLegalNote, contentHash: "", validFrom: null, acceptedAt: "2026-01-01T09:00:00.000Z", canAccept: false, acceptHelp: null, required: true },
      { id: "demo-dpa", type: "DPA", scope: "ORGANIZATION", version: "demo", title: "Personuppgiftsbiträdesavtal", content: demoLegalNote, contentHash: "", validFrom: null, acceptedAt: "2026-01-01T09:00:00.000Z", canAccept: false, acceptHelp: null, required: true },
    ] }; break;
    case "/api/ai/policy": if (get) return { policy: aiPolicy, canManage: false }; break;
    // Reading never fails in the demo (2026-11-04): no AI digest, no AI profiles to choose among (the card stays away), no saved
    // import files, no price-file overview and no form draft to resume. Changing any of it says it cannot be tried here.
    case "/api/ai/digest": if (get) return { digest: null }; break;
    case "/api/ai/profiles": if (get) return { profiles: [], chosen: "standard", requireEu: false, canManage: false }; break;
    // Användning (2026-11-21): an empty week, no credits; the switch is never offered (canManage false).
    case "/api/ai/usage": if (get) return { canManage: false, usage: { week: { usedPercent: 0, warn: false, full: false, opensAt: new Date(Date.now() + 7 * 86_400_000).toISOString() }, continueOnCredits: false, weeks: [], credits: { system: false, balance: 0, usedThisWeek: 0 }, people: [], askers: 0, payers: { included: 0, credits: 0, company: 0 } } }; break;
    case "/api/import": if (get) return { files: [] }; break;
    case "/api/forms/admin": if (get && request.url.searchParams.has("resume")) return { id: null }; break;
    // Historik och lagring is a part of Företaget since 2026-10-15: the demo reads "Tills vidare" quietly; saving and
    // deleting are refused like the other server settings.
    case "/api/history-retention": if (get) return { months: null, label: "Tills vidare", pending: null, recent: [] }; break;
    // Workflow AI i demon (2026-11-22): the real chat with Manuellt | Auto, answered with ready examples from the invented company
    // (features/demo/demo-ai.ts). No AI provider is called, nothing is saved, and Auto does nothing.
    case "/api/ai/status": if (get) return { lifecycle: "EXECUTION_LOCKED", available: false, chatAvailable: true, demo: true, suggestions: [...DEMO_CHAT_QUESTIONS], role: ctx.user.role, historyLocation: "WORKFLOW", sharingPolicy: aiPolicy,
      conditions: { provider: { ready: false, configured: false, evaluationApproved: false }, sharingPolicy: { ready: false }, creditLedger: { healthy: true, walletBalanceMatchesLots: true, purchasedBalanceMatchesLots: true, walletBalanceMatchesLedger: true }, availableCredits: { available: false, balance: 0 } } }; break;
    case "/api/ai/chat": if (request.method === "POST") return demoChat(ctx, request.body); break;
    case "/api/ai/conversations": if (get) return { conversations: [] }; break;
    case "/api/profile": if (get) return { name: ctx.user.name, email: ctx.user.email, hasPassword: false, google: false }; break;
    // Reading a settings page never says "not in the demo" (2026-10-10: Mina inställningar and Användare showed that toast
    // on open): Säkerhet, the company's security and Kopplade appar answer as an account without any of it. Changing
    // them is an action of the person and still says it cannot be tried here.
    case "/api/security": if (get) return { twoFactor: { enabled: false, enabledAt: null, backupCodesLeft: 0, hasPassword: false }, required: false, method: "demo", google: false, fresh: true, sessionTracked: false, sessions: [], log: { events: [], next: null } }; break;
    // Operatörskonton (2026-10-30): invented accounts in this browser only (features/demo/demo-operator.ts).
    case "/api/operator-accounts": if (!ctx.admin) throw new DemoError(403, "Bara en företagsadministratör kan göra det."); try { return get ? demoOperatorAdminView() : demoOperatorAdminAction((request.body ?? {}) as Record<string, unknown>); } catch (error) { throw error instanceof DemoOperatorError ? new DemoError(error.status, error.message) : error; }
    case "/api/security/company": if (get && ctx.admin) return { required: false, me: ctx.user.id, members: [], log: { events: [], next: null } }; break;
    // Supportåtkomst och Granska behörigheter (K2, 2026-11-28) need a server: the demo shows them empty and closed.
    case "/api/security/support-access": if (get && ctx.admin) return { open: null, grants: [], reads: [], choices: [1, 24, 168], defaultHours: 24 }; if (!get) throw new DemoError(409, "Supportåtkomst finns inte i demon."); break;
    case "/api/security/access-review": if (get && ctx.admin) return { rows: [], review: { reminderOn: false, lastReviewedAt: null, reviewedBy: "", dueAt: new Date().toISOString(), due: false } }; if (!get) throw new DemoError(409, "Granskningen sparas inte i demon."); break;
    case "/api/oauth/connections": if (get) return { connections: [] }; break;
    case "/api/passkeys": if (get) return { passkeys: [] }; break;
    // Notiser per e-post och push (2026-10-07) need a server and an account: the demo only says so.
    case "/api/notice-settings": if (get) return { demo: true }; break;
    // Kalenderlänken (2026-11-01) needs a server for a calendar program to fetch from: the demo only says so.
    case "/api/calendar-link": if (get) return { demo: true, link: null }; break;
    // Sök i prisfilen (2026-10-11): a few invented articles for the material line's search.
    case "/api/catalogue": if (get && request.url.searchParams.has("search")) return searchDemoCatalogue(request.url.searchParams.get("search") ?? "");
      // Import's overview of the price files: none are read in the demo (reading a file needs an upload).
      if (get && request.url.searchParams.get("page") === "1") return { gateReasons: {}, suppliers: [], imports: [], articles: [], articleCount: 0, page: 1, pageSize: 50, access: { read: true, pick: true, edit: false }, today: swedishDayKey(new Date()) };
      break;
    // Favoriter och artikellistor (2026-10-16) need the Cloud register: the demo shows them empty, and marking says it cannot be tried here.
    case "/api/catalogue-lists": if (get) return request.url.searchParams.get("part") === "favorites" ? { favorites: [] } : { lists: [] }; break;
    // Kopplingar (2026-11-04): API och MCP and Maskiner, features/demo/demo-connections.ts.
    case "/api/integration-keys": try { return demoIntegrationKeys(ctx, request); } catch (error) { throw error instanceof DemoConnectionsError ? new DemoError(error.status, error.message) : error; }
    // Webb och sociala medier (2026-11-10): nothing is connected in the demo; WordPress and Meta need a server and real keys.
    case "/api/website": if (get && request.url.searchParams.get("part") === "connection") return { connection: { siteUrl: "", baseUrl: "", username: null, configured: false, passwordUnreadable: false, passwordStored: false, updatedAt: null, extras: null } }; break;
    case "/api/meta": if (get && request.url.searchParams.get("part") === "status") return { status: "missing", page: null, instagram: null }; break;
    case "/api/linkedin": if (get && request.url.searchParams.get("part") === "status") return { status: "missing", author: null, publishingApproved: false, message: null }; break;
    // YouTube (2026-11-20): the status line of Kopplingar's list, like LinkedIn – nothing connected in the demo.
    case "/api/youtube": if (get && request.url.searchParams.get("part") === "status") return { status: "missing", channel: null, publishingApproved: false, privateLocked: false, message: null }; break;
    case "/api/machine-sources": try { return demoMachineSources(ctx, request); } catch (error) { throw error instanceof DemoConnectionsError ? new DemoError(error.status, error.message) : error; }
    // Tavlor (2026-11-19, issue #4): features/demo/demo-boards.ts, the example boards with their figures counted in this browser.
    case "/api/boards": return demoBoards(ctx, request).catch((error) => { throw error instanceof DemoBoardsError ? new DemoError(error.status, error.message) : error; });
    // Nyheter (2026-11-21): features/demo/demo-news.ts, a few invented posts of Kopplingsbyrån AB in memory.
    case "/api/news": try { return demoNews(ctx, request); } catch (error) { throw error instanceof DemoNewsError ? new DemoError(error.status, error.message) : error; }
    // Dokument (0.87.0): features/demo/demo-documents.ts, a few invented documents in memory; nothing is uploaded or downloaded.
    case "/api/documents": try { return demoDocuments(ctx, request); } catch (error) { throw error instanceof DemoDocumentsError ? new DemoError(error.status, error.message) : error; }
    // Agenter (2026-11-21): features/demo/demo-agents.ts – the templates and invented runs; nothing runs in the demo.
    case "/api/agents": try { return demoAgents(ctx, request); } catch (error) { throw error instanceof DemoAgentsError ? new DemoError(error.status, error.message) : error; }
    // Offerter (2026-10-09): see quotes() above.
    case "/api/quotes": case "/api/quotes/export": return quotes(ctx, request, path);
    // Inköp och Artiklar (2026-11-04): features/demo/demo-purchases.ts.
    case "/api/purchases": try { return demoPurchases({ ...ctx, user: { id: ctx.user.id, name: ctx.user.name, permissions: ctx.user.permissions } }, request); } catch (error) { throw error instanceof DemoPurchaseError ? new DemoError(error.status, error.message) : error; }
    // Fakturaunderlag från utfört arbete (2026-10-10): features/demo/demo-invoice-bases.ts.
    case "/api/customer-invoices": try { return demoCustomerInvoices(ctx, request); } catch (error) { throw error instanceof DemoInvoiceBasisError ? new DemoError(error.status, error.message) : error; }
    case "/api/invoice-bases": case "/api/invoice-bases/export": try { return demoInvoiceBases(ctx, request, path); } catch (error) { throw error instanceof DemoInvoiceBasisError ? new DemoError(error.status, error.message) : error; }
  }
  // Bilder på avvikelser (2026-10-30): removing one; adding one is a form, see handleDemoRequest.
  if (path.startsWith("/api/self-inspection/deviation-photos/") && request.method === "DELETE")
    return demoDeviationPhotoRemove(ctx.db, ctx.user, ctx.admin, decodeURIComponent(path.slice("/api/self-inspection/deviation-photos/".length)))
      .catch((error) => { throw error instanceof SelfInspectionError ? new DemoError(error.status, error.message) : error; });
  if (path.startsWith("/api/documents/")) try { return demoDocuments(ctx, request); } catch (error) { throw error instanceof DemoDocumentsError ? new DemoError(error.status, error.message) : error; }
  if (path.startsWith("/api/billing")) throw new DemoError(403, "Krediter och betalning visas inte i demon. Se Priser för Local, Cloud och AI-krediter.");
  throw new DemoError(get ? 404 : 403, DEMO_UNAVAILABLE);
}

/** Answers one /api request from memory. Errors use the same `{ error }` body as the server. */
export async function handleDemoRequest(method: string, url: URL, body: BodyInit | null | undefined): Promise<Response> {
  let parsed: unknown = null;
  if (typeof body === "string" && body) {
    try { parsed = JSON.parse(body); } catch { parsed = null; }
  } else if (body) {
    // PDF på kontroller (2026-11-06): the report of what is on screen is drawn in this browser, stamped Demo.
    if (url.pathname === SNAPSHOT_REPORT_PATH && method.toUpperCase() === "POST" && body instanceof FormData) return demoSnapshotReport(body);
    // A report sent as a form (the PDF of what is on screen) is a report, not an upload.
    if (isReportPath(url.pathname)) return Response.json({ error: DEMO_REPORTS_UNAVAILABLE }, { status: 403 });
    // Bilder på avvikelser (2026-10-30): the one upload the demo takes, kept in this browser's memory only.
    if (url.pathname === "/api/self-inspection/deviation-photos" && method.toUpperCase() === "POST" && body instanceof FormData) {
      const file = body.get("file");
      if (!(file instanceof File)) return Response.json({ error: "Välj en bild." }, { status: 400 });
      try {
        const ctx = context();
        return Response.json(await demoDeviationPhotoAdd(ctx.db, ctx.user, ctx.admin, { deviationId: String(body.get("deviationId") ?? ""), phase: body.get("phase") === "AFTER" ? "AFTER" : "BEFORE", file }));
      } catch (error) {
        return Response.json({ error: (error as Error).message }, { status: error instanceof SelfInspectionError ? error.status : 500 });
      }
    }
    return Response.json({ error: "Filer och bilder kan inte laddas upp i demon." }, { status: 403 });
  }
  try {
    // The bell counts Egenkontroll's reminders too, so they are read before it answers: the Demo page said 5 and every other page 14 (kundresa 2026-11-07, M2).
    const seeding = ensureDemoSelfInspection(demoDatabase());
    if (url.pathname === "/api/task-notifications") await seeding;
    const result = await route({ method: method.toUpperCase(), url, body: parsed });
    // A document drawn in the browser (the demo invoice's PDF) is answered as the file itself, like the server's.
    if (result instanceof Response) return result;
    // Structured clone so that the UI can never mutate the demo database through a response object.
    return Response.json(JSON.parse(JSON.stringify(result ?? { ok: true })));
  } catch (error) {
    if (error instanceof DemoError) return Response.json({ ...(error.details ?? {}), error: error.message }, { status: error.status });
    if (error instanceof z.ZodError) return Response.json({ error: error.issues[0]?.message ?? "Kontrollera uppgifterna." }, { status: 400 });
    return Response.json({ error: (error as Error).message || "Något gick fel i demon." }, { status: 500 });
  }
}

/**
 * Reports and their files are made by the server; the demo has none (2026-10-10: Förhandsgranska opened raw JSON). The one
 * exception is the PDF of a job or a control (2026-11-06), which the demo draws itself: see demoSnapshotReport.
 */
export const DEMO_REPORTS_UNAVAILABLE = "Rapporter och filer skapas inte i demon. I Workflow öppnas de som PDF.";
const SNAPSHOT_REPORT_PATH = "/api/workflow-tasks/snapshot-report";
/** The demo's own answer to a report (the PDF of a job or a control): no toast that it cannot be made. */
const madeInDemo = (path: string) => path === SNAPSHOT_REPORT_PATH;

/**
 * PDF på kontroller (2026-11-06): the same snapshot as app/api/workflow-tasks/snapshot-report, drawn in this browser from the
 * invented company and stamped Demo on every page. Nothing is kept: "Spara i rapportarkivet" answers that the demo keeps nothing.
 */
async function demoSnapshotReport(form: FormData): Promise<Response> {
  try {
    const ctx = context();
    const payload = JSON.parse(String(form.get("payload") ?? "{}")) as { task?: unknown; format?: string; inline?: boolean; sections?: string; archive?: boolean };
    if (payload.format && payload.format !== "pdf") throw new DemoError(403, DEMO_REPORT_PDF_ONLY);
    const task = workflowTaskInputSchema.parse(payload.task);
    ctx.require(workflowSubjectForTask(task.kind), "report");
    const saved = task.id ? ctx.db.tasks.find((item) => item.id === task.id) : undefined;
    if (task.id && !saved) throw new DemoError(404, "Uppgiften hittades inte.");
    const project = task.projectId ? ctx.db.projects.find((item) => item.id === task.projectId) : undefined;
    const customer = task.customerId ? ctx.db.customers.find((item) => item.id === task.customerId && !item.deletedAt) : undefined;
    const place = facilitySummary(ctx, task.facilityId);
    const workOrder = task.workOrderId ? ctx.db.tasks.find((item) => item.id === task.workOrderId && item.kind === "WORK_ORDER") : undefined;
    const named = payload.sections?.split(",").filter(Boolean);
    const allowPrices = canSeePrices({ admin: ctx.admin, permissions: ctx.user.permissions });
    const selected = new Set<string>(named ?? workflowReportSectionKeys.filter((key) => key !== "prices"));
    const options = Object.fromEntries(workflowReportSectionKeys.map((key) => [key, key === "prices" ? allowPrices && selected.has(key) : selected.has(key)])) as WorkflowReportOptions;
    const report: WorkflowReportTask = {
      id: task.id ?? "ogonblicksbild", kind: task.kind, title: task.title, description: task.description, status: task.status, progress: workflowTaskProgress(task),
      projectId: project?.id ?? null, projectName: project?.name, workOrderTitle: workOrder?.title || undefined,
      protocolNumber: saved && saved.kind === "FORM" ? protocolNumberOf(saved.id) : undefined, completedAt: saved?.completedAt ?? null,
      projectFields: project ? projectFieldRows({ ...project, facility: facilitySummary(ctx, project.facilityId) ?? null } as Parameters<typeof projectFieldRows>[0]) : undefined,
      customerName: customer ? customerTitle(customer) : undefined, facilityName: place ? facilityLabel(place) : undefined,
      assignedToName: task.assignedToName, dueDate: task.dueDate,
      totalDurationSec: saved ? ctx.db.timeEntries.filter((entry) => entryOwnerId(entry) === saved.id).reduce((sum, entry) => sum + entry.durationSec, 0) : 0,
      data: task.data, attachments: [],
    };
    const [{ createWorkflowPdfReport }, { fetchReportFonts }] = await Promise.all([import("@/lib/workflow/report"), import("@/lib/workflow/report-fonts")]);
    const bytes = await stampDemoPdf(await createWorkflowPdfReport({ ...demoReportIdentity(), blank: false, tasks: [report], options, fontBytes: await fetchReportFonts(realFetch ?? fetch) }));
    // The archive keeps nothing in the demo; the page says so the way it says why a copy was not kept.
    const kept: Record<string, string> = payload.archive && !payload.inline ? { "X-Report-Archive-Error": encodeURIComponent("demon sparar inget.") } : {};
    return demoPdfResponse(bytes, demoFileName(`${task.title}-rapport.pdf`), payload.inline, kept);
  } catch (error) {
    if (error instanceof DemoError) return Response.json({ error: error.message }, { status: error.status });
    if (error instanceof z.ZodError) return Response.json({ error: error.issues[0]?.message ?? "Kontrollera uppgifterna." }, { status: 400 });
    return Response.json({ error: (error as Error).message || "Rapporten kunde inte skapas i demon." }, { status: 500 });
  }
}

/** Opens the demo's PDF in a new tab; the tab is opened at once (a later one is stopped by the browser) and filled when the file is drawn. */
async function openDemoPreview(form: FormData) {
  const tab = window.open("about:blank", "_blank");
  const response = await demoSnapshotReport(form);
  if (!response.ok) {
    tab?.close();
    announce(((await response.json().catch(() => null)) as { error?: string } | null)?.error || "Rapporten kunde inte skapas i demon.", true);
    return;
  }
  const address = URL.createObjectURL(await response.blob());
  if (tab) tab.location.href = address; else window.location.assign(address);
  setTimeout(() => URL.revokeObjectURL(address), 60_000);
}
const isReportPath = (path: string) => /^\/api\/(workflow-tasks\/(snapshot-report|[^/]+\/report)|projects\/[^/]+\/report|forms\/blank|quotes\/[^/]+\/pdf|self-inspection\/report|staff-register\/export|report-archive\/)/.test(path);

let installed = false;
let realFetch: typeof fetch | null = null;
let reporting = false;
/** Whether the demo reports its anonymous visit events (Beteendeanalys); false where the installation has nowhere to count them. */
export function setDemoReporting(on: boolean) { reporting = on; }
/**
 * The one request that leaves the browser (2026-11-04, Beteendeanalys): a fixed key from lib/analytics/catalog.ts, counted
 * as one anonymous number per day on the server. No cookie, no identifier and nothing the visitor typed. Everything else the
 * demo asks for is answered in the browser.
 */
export function sendDemoEvent(key: string | null) {
  // A browser the owner switched off under Beteendeanalys (wf-no-stats, 2026-11-16) sends nothing.
  if (!reporting || !key || !realFetch || !isDemoBrowserKey(key) || optedOutHere()) return;
  void realFetch("/api/analytics/event", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ type: "demo", key }), keepalive: true, credentials: "omit" }).catch(() => undefined);
}
/**
 * Routes every same-origin /api request in this tab to the demo backend and blocks direct /api links (reports,
 * files), so a demo visitor never reaches the server's API. Other requests, such as page navigation, pass through.
 */
export function installDemoBackend(onBlockedLink?: () => void) {
  if (installed || typeof window === "undefined") return;
  installed = true;
  // Live sync streams straight from the server (EventSource is not fetch); the demo has no server, so it stays off.
  (window as typeof window & { __workflowDemo?: boolean }).__workflowDemo = true;
  // A deviation's photo is shown from this browser's memory (features/self-inspection/deviation-photos.tsx).
  (window as typeof window & { __workflowDemoPhoto?: (photoId: string) => string }).__workflowDemoPhoto = demoDeviationPhotoUrl;
  const original = window.fetch.bind(window);
  realFetch = original;
  const isApi = (url: URL) => url.origin === window.location.origin && url.pathname.startsWith("/api/");
  window.fetch = (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(input instanceof Request ? input.url : String(input), window.location.href);
    if (!isApi(url)) return original(input, init);
    const method = init?.method ?? (input instanceof Request ? input.method : "GET");
    // A report the person asked for (PDF, Excel) says so where they are, as a toast, and the page gets the same error.
    if (isReportPath(url.pathname) && !madeInDemo(url.pathname)) onBlockedLink?.();
    return handleDemoRequest(method, url, init?.body);
  };
  const blocked = (href: string | null) => { try { return Boolean(href && isApi(new URL(href, window.location.href))); } catch { return false; } };
  // Förhandsgranska posts a form to a new tab, and some reports open with window.open: neither reaches the server.
  const submit = HTMLFormElement.prototype.submit;
  HTMLFormElement.prototype.submit = function demoSubmit(this: HTMLFormElement) {
    // Förhandsgranska of a job or a control: the demo's PDF opens in a new tab, drawn here (2026-11-06).
    if (madeInDemo(new URL(this.getAttribute("action") ?? "", window.location.href).pathname)) { void openDemoPreview(new FormData(this)); return; }
    if (blocked(this.getAttribute("action"))) { onBlockedLink?.(); return; }
    submit.call(this);
  };
  const open = window.open.bind(window);
  window.open = (target?: string | URL, ...rest: [string?, string?]) => {
    if (target !== undefined && blocked(String(target))) { onBlockedLink?.(); return null; }
    return open(target, ...rest);
  };
  const click = HTMLAnchorElement.prototype.click;
  HTMLAnchorElement.prototype.click = function demoClick(this: HTMLAnchorElement) {
    if (blocked(this.getAttribute("href"))) { onBlockedLink?.(); return; }
    click.call(this);
  };
  document.addEventListener("click", (event) => {
    const anchor = (event.target as Element | null)?.closest?.("a");
    if (anchor && blocked(anchor.getAttribute("href"))) { event.preventDefault(); event.stopPropagation(); onBlockedLink?.(); }
  }, true);
}

/**
 * Grunduppgifter är gemensamma (2026-10-30), as the server: a work order's open tasks take its project, customer, place,
 * responsible person and dates; finished ones only the project, customer and place they must match.
 */
function followDemoWorkOrder(tasks: DemoTask[], order: DemoTask, now: string) {
  const target = { ...order, facilityId: order.facilityId ?? null };
  const open = tasks.filter((item) => isTaskOpen(item.status));
  const closed = tasks.filter((item) => !isTaskOpen(item.status));
  const following = [...tasksFollowingWorkOrder(target, open), ...tasksFollowingWorkOrder({ ...target, assignedToUserId: undefined, assignedToName: undefined, plannedStartDate: undefined, dueDate: undefined }, closed)];
  for (const next of following) {
    const item = tasks.find((candidate) => candidate.id === next.id);
    if (item) Object.assign(item, { projectId: next.projectId, customerId: next.customerId, facilityId: next.facilityId ?? null, assignedToUserId: next.assignedToUserId ?? null, assignedToName: next.assignedToName ?? "", plannedStartDate: next.plannedStartDate ?? "", dueDate: next.dueDate ?? "", version: item.version + 1, updatedAt: now });
  }
}
