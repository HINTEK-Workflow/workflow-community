import { customerFacilityInputSchema, facilityLinkError } from "@/lib/workflow/customer-facility";
import { z } from "zod";
import { addSwedishDays, swedishDayKey } from "@/lib/swedish-time";
import { hasWorkflowPermission, workflowSubjectForTask, type WorkflowPermissionAction, type WorkflowPermissionSubject } from "@/lib/workflow/permissions";
import { resetWorkflowTaskApproval, stampWorkflowTaskApproval, workflowTaskCompletion, workflowTaskHasDocumentation, workflowTaskInputSchema, workflowTaskProgress } from "@/lib/workflow/task-model";
import { plannedActivityAssignments, plannedActivityInputSchema, plannedActivitySummary } from "@/lib/workflow/planned-activity";
import { canReadPlannedActivity } from "@/lib/workflow/planned-activity-access";
import { capacityWeek } from "@/lib/workflow/capacity-summary";
import { summarizeOverviewKpis, type OverviewKpiTask } from "@/lib/workflow/overview-kpis";
import { canManageProjectLifecycle, summarizeProjectStatus } from "@/lib/workflow/project-status";
import { planningFrameError, projectDecisionInputSchema, projectFrameError, shiftDay, taskDueDateError } from "@/lib/workflow/project-frame";
import { notificationToday, taskNotifications } from "@/lib/workflow/task-notifications";
import { summarizeTaskStatistics, taskStatisticsBucket, TASK_STATISTICS_TYPES } from "@/lib/workflow/task-statistics";
import { assertTimeCorrection, TimeCorrectionError } from "@/lib/workflow/time-correction";
import { WORK_ITEM_FILTERS, workItemKindsForQuery, type WorkItemFilter } from "@/lib/workflow/work-items";
import { listWorkOrders, nextPlannedAt } from "@/lib/workflow/work-orders";
import { selectFormHistory } from "@/lib/workflow/form-history";
import { preferencesSchema } from "@/lib/kfid/preferences";
import { normalizeControl, validateForCompletion } from "@/lib/kfid/model";
import { controlProgress } from "@/lib/workflow/project-progress";
import { buildOverviewWork, OVERVIEW_WORK_FILTERS, OVERVIEW_WORK_SORTS, selectOverviewWork } from "@/lib/workflow/overview-work";
import { createDemoDatabase, DEMO_ADMIN_ID, type DemoActivity, type DemoControl, type DemoDatabase, type DemoTask, type DemoUserId } from "./demo-data";

/**
 * In-browser backend for the public demo (Daniel 2026-09-26, path A). It answers the same /api requests as the
 * server with the same response shapes, from memory only: nothing reaches the server, nothing is stored and a reload
 * starts over. It reuses the shared pure domain rules (task completion, planning, time correction, key figures,
 * notifications, statistics) and applies the demo user's role and permission profile like the server does.
 */
class DemoError extends Error {
  constructor(readonly status: number, message: string) { super(message); }
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
const requireAdmin = (ctx: Context) => { if (!ctx.admin) throw new DemoError(403, "Företagsadministratör krävs."); };
const isMine = (ctx: Context, task: DemoTask) => task.assignedToUserId === ctx.user.id || (!task.assignedToUserId && task.createdBy === ctx.user.id);
const readableTasks = (ctx: Context) => ctx.db.tasks.filter((task) => ctx.can(workflowSubjectForTask(task.kind), "read"));
const durationSec = (entries: { durationSec: number; endedAt: string | null; startedAt: string }[], now: Date) =>
  entries.reduce((sum, entry) => sum + entry.durationSec + (!entry.endedAt ? Math.max(0, Math.floor((now.getTime() - Date.parse(entry.startedAt)) / 1000)) : 0), 0);
const entriesFor = (ctx: Context, taskId: string) => ctx.db.timeEntries.filter((entry) => entry.taskId === taskId);
const projectArchived = (ctx: Context, projectId: string | null) => Boolean(projectId && ctx.db.projects.find((project) => project.id === projectId)?.archivedAt);
const projectClosed = (ctx: Context, projectId: string | null) => Boolean(projectId && ctx.db.projects.find((project) => project.id === projectId)?.closedAt);
// Controls before commissioning (steg 7): the same completion rules and 95 % cap as Cloud.
const liveControls = (ctx: Context) => ctx.db.controls.filter((control) => !control.deletedAt);
const readableControls = (ctx: Context) => ctx.can("kfid", "read") ? liveControls(ctx) : [];
const controlCompletion = (control: DemoControl) => validateForCompletion(control.data, { attachmentCount: 0 });
const controlPercent = (control: DemoControl) => controlProgress(control.status, controlCompletion(control).progress.percent);
const isMyControl = (ctx: Context, control: DemoControl) => control.createdBy === ctx.user.id || control.performer === ctx.user.name || control.performer === ctx.user.email;
/** A task or a control by id, in the shape the time report, planning and project history use. */
type Source = { id: string; title: string; kind: DemoTask["kind"] | "COMMISSIONING_CONTROL"; status: string; projectId: string | null; control: boolean };
const sourceOf = (ctx: Context, id: unknown): Source | null => {
  const task = ctx.db.tasks.find((item) => item.id === id);
  if (task) return { id: task.id, title: task.title, kind: task.kind, status: task.status, projectId: task.projectId, control: false };
  const control = liveControls(ctx).find((item) => item.id === id);
  return control ? { id: control.id, title: control.title, kind: "COMMISSIONING_CONTROL", status: control.status, projectId: control.projectId, control: true } : null;
};
// Same status as the server: every linked task and control and all planning, whatever the viewer may read.
const projectStatus = (ctx: Context, project: DemoDatabase["projects"][number]) => summarizeProjectStatus({
  archivedAt: project.archivedAt, closedAt: project.closedAt, startDate: project.startDate, dueDate: project.dueDate, now: ctx.now,
  tasks: [...ctx.db.tasks.filter((task) => task.projectId === project.id), ...liveControls(ctx).filter((control) => control.projectId === project.id)],
  activities: ctx.db.activities.filter((activity) => !activity.deletedAt && activity.projectId === project.id),
});
const members = (ctx: Context) => ctx.db.users.map((user) => ({ id: user.id, name: user.name }));
const facilitySummary = (ctx: Context, id: string | null | undefined) => {
  const facility = ctx.db.facilities.find((item) => item.id === id);
  return facility ? { id: facility.id, name: facility.name, address: facility.address, postalCode: facility.postalCode, city: facility.city } : null;
};
const customerWithFacilities = (ctx: Context, customer: DemoDatabase["customers"][number]) => ({ ...customer, facilities: ctx.db.facilities.filter((facility) => facility.customerId === customer.id) });
const controlSummary = (ctx: Context, control: DemoControl) => ({
  id: control.id, number: control.number, title: control.title, project: control.project, performer: control.performer, date: control.date, status: control.status, version: control.version,
  deletedAt: control.deletedAt, updatedAt: control.updatedAt, postedAt: null, customerId: control.customerId, projectId: control.projectId, siteId: control.siteId, departmentId: control.departmentId,
  lastOpenedAt: control.lastOpenedAt, facilityId: control.facilityId,
});
// Reported time outside the project's frame (decision 6), in Swedish calendar days.
const outsideFrameMinutes = (ctx: Context, project: DemoDatabase["projects"][number]) => {
  if (!project.startDate || !project.dueDate) return 0;
  const seconds = ctx.db.timeEntries.filter((entry) => entry.endedAt && sourceOf(ctx, entry.taskId)?.projectId === project.id)
    .filter((entry) => { const day = swedishDayKey(entry.startedAt); return day < project.startDate! || day > project.dueDate; })
    .reduce((sum, entry) => sum + entry.durationSec, 0);
  return Math.round(seconds / 60);
};

function taskSummary(ctx: Context, task: DemoTask) {
  return {
    id: task.id, title: task.title, kind: task.kind, status: task.status, progress: workflowTaskProgress(task), dueDate: task.dueDate, updatedAt: task.updatedAt, projectId: task.projectId,
    assignedToUserId: task.assignedToUserId, assignedToName: task.assignedToName, totalDurationSec: durationSec(entriesFor(ctx, task.id), ctx.now), isMine: isMine(ctx, task),
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
    if (action === "latest") {
      ctx.require("kfid", "read");
      const current = request.url.searchParams.get("currentId");
      const latest = liveControls(ctx).filter((control) => control.id !== current).sort((a, b) => (b.lastOpenedAt ?? b.updatedAt).localeCompare(a.lastOpenedAt ?? a.updatedAt))[0];
      return { id: latest?.id ?? null };
    }
    if (action === "control" || action === "revision") {
      ctx.require("kfid", "read");
      const control = liveControls(ctx).find((item) => item.id === request.url.searchParams.get("id"));
      if (!control) throw new DemoError(404, "Kontrollen hittades inte.");
      if (action === "revision") {
        const revision = control.revisions.find((item) => item.version === Number(request.url.searchParams.get("version")));
        if (!revision) throw new DemoError(404, "Versionen hittades inte.");
        return { ...revision, controlId: control.id };
      }
      control.lastOpenedAt = ctx.now.toISOString();
      const { revisions, ...rest } = control;
      return { ...rest, attachments: [], revisions: [...revisions].sort((a, b) => b.version - a.version).slice(0, 25).map(({ id, version, createdAt, createdBy }) => ({ id, version, createdAt, createdBy })) };
    }
    if (action !== "overview") throw new DemoError(404, "Kontrollen hittades inte i demon.");
    return {
      // Like the server: only the latest control, no control or customer lists.
      controls: readableControls(ctx).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)).slice(0, 1).map((control) => controlSummary(ctx, control)),
      projects: ctx.can("projects", "read") ? ctx.db.projects.map(({ id, name, description, startDate, dueDate, customerId, facilityId, updatedAt, archivedAt, closedAt, responsibleUserId, responsibleName, client, contactPerson, reference, workSite }) => ({
        id, name, description, startDate: startDate ?? "", dueDate, customerId, facilityId: facilityId ?? null, facility: facilitySummary(ctx, facilityId), updatedAt, archivedAt, closedAt: closedAt ?? null, responsibleUserId, responsibleName,
        client: client ?? "", contactPerson: contactPerson ?? "", reference: reference ?? "", workSite: workSite ?? "" })) : [],
      wallet: { balance: 0, testMode: false },
      entries: [], entryCount: 0, reports: [],
      settings: ctx.db.settings,
      preferences: preferencesSchema.parse(ctx.db.preferences[ctx.user.id] ?? {}),
      globalSuggestions: {},
      organization: ctx.db.organization,
      admin: ctx.admin, canDeleteControls: ctx.admin, workflowPermissions: ctx.user.permissions,
      testAdmin: false, aiEnabled: false, aiConfigured: false, paymentsEnabled: false, paymentSandbox: false, legalRequired: false,
    };
  }
  const input = request.body as Json;
  if (input.action === "preferences") { ctx.db.preferences[ctx.user.id] = preferencesSchema.parse(input.data ?? {}); return { ok: true }; }
  if (input.action === "settings") {
    requireAdmin(ctx);
    const data = input.data as { companyName?: string; contactEmail?: string; reportBranding?: { primary: string; accent: string; soft: string } };
    Object.assign(ctx.db.settings, { companyName: data.companyName ?? ctx.db.settings.companyName, contactEmail: data.contactEmail ?? ctx.db.settings.contactEmail },
      data.reportBranding ? { reportPrimary: data.reportBranding.primary, reportAccent: data.reportBranding.accent, reportSoft: data.reportBranding.soft } : {});
    return { ok: true };
  }
  if (input.action === "customer_save") {
    const data = input.data as Record<string, string>;
    const values = { name: data.name?.trim() || "", company: data.company ?? "", address: data.address ?? "", postalCode: data.postalCode ?? "", city: data.city ?? "", email: data.email ?? "", phone: data.phone ?? "", mobile: data.mobile ?? "", notes: data.notes ?? "", lat: data.lat ? Number(data.lat) : null, lng: data.lng ? Number(data.lng) : null };
    if (!values.name) throw new DemoError(422, "Ange kundens namn.");
    const current = typeof input.id === "string" ? ctx.db.customers.find((item) => item.id === input.id) : undefined;
    if (current) Object.assign(current, values, { version: current.version + 1 });
    else ctx.db.customers.push({ id: nextId(ctx, "customer"), ...values, version: 1, deletedAt: null });
    return { ok: true };
  }
  if (input.action === "lock" || input.action === "release") { if (input.action === "lock") ctx.require("kfid", "edit"); return { ok: true }; }
  if (input.action === "save" || input.action === "duplicate") return saveControl(ctx, input);
  if (input.action === "delete" || input.action === "restore" || input.action === "purge") {
    ctx.require("kfid", "edit");
    requireAdmin(ctx);
    return controlTrash(ctx, input.action, [String(input.id)]);
  }
  throw new DemoError(403, "Rapporter och krediter går inte att prova i demon.");
}

/** Saves a control like Cloud's workspace "save": versioned, locked when completed, project rules and revisions. */
function saveControl(ctx: Context, input: Json) {
  const id = z.string().min(1).max(100).parse(input.id);
  const version = z.number().int().nonnegative().parse(input.version);
  const data = normalizeControl(input.data);
  if (!data.meta.proj.trim()) throw new DemoError(400, "Ange projekt eller anläggning innan du sparar.");
  const status = z.enum(["DRAFT", "COMPLETED"]).parse(input.status ?? "DRAFT");
  // "Spara som" copies without attachments in the demo (there are none), so a duplicate is a new control.
  const existing = input.action === "duplicate" ? undefined : ctx.db.controls.find((item) => item.id === id);
  ctx.require("kfid", existing ? "edit" : "create");
  if (status === "COMPLETED" && existing?.status !== "COMPLETED") ctx.require("kfid", "complete");
  if (status === "COMPLETED") {
    const completion = validateForCompletion(data, { attachmentCount: 0 });
    if (!completion.complete) throw new DemoError(422, `Kontrollen kan inte färdigställas. ${completion.errors[0].message}`);
  }
  const optional = (value: unknown) => typeof value === "string" && value ? value : null;
  const customerId = optional(input.customerId), projectId = optional(input.projectId), siteId = optional(input.siteId), departmentId = optional(input.departmentId);
  if (departmentId && !siteId) throw new DemoError(400, "Välj plats före avdelning.");
  if (existing && existing.projectId !== projectId) throw new DemoError(409, "Byt projekt via projektets Koppla befintlig uppgift, så att bytet hamnar i historiken.");
  if (customerId && !ctx.db.customers.some((item) => item.id === customerId && !item.deletedAt)) throw new DemoError(400, "Kunden hittades inte.");
  let facilityId = existing && existing.customerId === customerId ? existing.facilityId : null;
  if (projectId) {
    const project = ctx.db.projects.find((item) => item.id === projectId);
    if (!project) throw new DemoError(400, "Projektet hittades inte.");
    if (project.archivedAt) throw new DemoError(409, "Återställ projektet innan du sparar kontrollen.");
    if (project.closedAt) throw new DemoError(409, "Projektet är avslutat. Återöppna projektet innan du sparar en kontroll i det.");
    const changed = !existing || existing.customerId !== customerId;
    if (project.customerId && customerId !== project.customerId && changed) throw new DemoError(400, "En kontroll i projektet har projektets kund.");
    if (!existing && project.facilityId && project.customerId === customerId) facilityId = project.facilityId;
  }
  const now = ctx.now.toISOString();
  const values = { title: data.meta.name?.trim() || data.meta.proj, project: data.meta.proj, performer: data.meta.perf, date: data.meta.date, data, status, customerId, facilityId, projectId, siteId, departmentId, updatedBy: ctx.user.id, updatedAt: now, lastOpenedAt: now };
  if (existing) {
    if (existing.deletedAt) throw new DemoError(404, "Kontrollen hittades inte.");
    if (existing.status === "COMPLETED") throw new DemoError(409, "Kontrollen är färdigställd. Skapa en kopia för att ändra.");
    if (existing.version !== version) throw new DemoError(409, "En nyare version finns. Dina ändringar finns kvar i formuläret; öppna senaste versionen innan du sparar igen.");
    Object.assign(existing, values, { version: existing.version + 1 });
    existing.revisions.push({ id: nextId(ctx, "control-revision"), version: existing.version, createdAt: now, createdBy: ctx.user.id, data: structuredClone(data) });
    return { id: existing.id, version: existing.version, status };
  }
  if (ctx.db.controls.some((item) => item.id === id)) throw new DemoError(409, "Kontrollen finns redan.");
  const created: DemoControl = { ...values, id, number: Math.max(0, ...ctx.db.controls.map((item) => item.number)) + 1, version: 1, deletedAt: null, postedAt: null, createdBy: ctx.user.id, createdAt: now,
    revisions: [{ id: nextId(ctx, "control-revision"), version: 1, createdAt: now, createdBy: ctx.user.id, data: structuredClone(data) }] };
  ctx.db.controls.push(created);
  return { id, version: 1, status };
}

function controlTrash(ctx: Context, action: "delete" | "restore" | "purge", ids: string[]) {
  const found = ctx.db.controls.filter((item) => ids.includes(item.id));
  if (found.length !== ids.length) throw new DemoError(404, "En eller flera kontroller saknas.");
  if (action === "purge") {
    if (found.some((item) => !item.deletedAt)) throw new DemoError(409, "Flytta alla valda kontroller till papperskorgen först.");
    ctx.db.controls = ctx.db.controls.filter((item) => !ids.includes(item.id));
    ctx.db.timeEntries = ctx.db.timeEntries.filter((entry) => !ids.includes(entry.taskId));
  } else for (const item of found) item.deletedAt = action === "delete" ? ctx.now.toISOString() : null;
  return { ok: true, count: ids.length };
}

// ---------- /api/records ----------
function records(ctx: Context, request: Request) {
  const params = request.url.searchParams;
  const limit = Math.min(100, Math.max(1, Number(params.get("limit")) || 25));
  if (request.method !== "GET") {
    const input = request.body as { kind: string; action: string; ids: string[] };
    if (input.kind === "controls") {
      ctx.require("kfid", "edit");
      requireAdmin(ctx);
      return controlTrash(ctx, z.enum(["delete", "restore", "purge"]).parse(input.action), [...new Set(input.ids)]);
    }
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
  if (params.get("kind") !== "customers") {
    ctx.require("kfid", "read");
    const status = params.get("status") ?? "ALL";
    const controlKey = (item: DemoControl) => sort === "number" ? String(item.number).padStart(6, "0") : sort === "name" ? item.title : sort === "date" ? item.date : sort === "performer" ? item.performer : item.updatedAt;
    const controlRows = ctx.db.controls
      .filter((item) => Boolean(item.deletedAt) === trash)
      .filter((item) => status === "ALL" || (status !== "POSTED" && item.status === status))
      .filter((item) => !params.get("customerId") || item.customerId === params.get("customerId"))
      .filter((item) => params.get("creator") !== "MINE" || item.createdBy === ctx.user.id)
      .filter((item) => (!params.get("from") || item.date >= params.get("from")!) && (!params.get("to") || item.date <= params.get("to")!))
      .filter((item) => !q || [item.number, item.title, item.project, item.performer, item.date].join(" ").toLowerCase().includes(q))
      .sort((a, b) => direction * controlKey(a).localeCompare(controlKey(b), "sv"));
    const controlPages = Math.max(1, Math.ceil(controlRows.length / limit));
    const controlPage = Math.min(controlPages, Math.max(1, Number(params.get("page")) || 1));
    const site = (item: DemoControl) => ctx.db.sites.find((entry) => entry.id === item.siteId);
    return { items: controlRows.slice((controlPage - 1) * limit, controlPage * limit).map((item) => {
      const completion = controlCompletion(item);
      return { ...controlSummary(ctx, item), createdByName: userName(ctx, item.createdBy) || "Okänd användare", updatedByName: userName(ctx, item.updatedBy) || "Okänd användare",
        siteName: site(item)?.name ?? null, departmentName: site(item)?.departments.find((entry) => entry.id === item.departmentId)?.name ?? null,
        completion: { complete: completion.complete, errors: completion.errors.length, warnings: completion.warnings.length, percent: completion.progress.percent } };
    }), total: controlRows.length, page: controlPage, pages: controlPages, limit };
  }
  const key = (item: DemoDatabase["customers"][number]) => sort === "email" ? item.email : sort === "address" ? item.address : item.name;
  const rows = ctx.db.customers
    .filter((item) => Boolean(item.deletedAt) === trash)
    .filter((item) => !q || [item.name, item.company, item.address, item.postalCode, item.city, item.email, item.phone, item.notes].join(" ").toLowerCase().includes(q))
    .sort((a, b) => direction * key(a).localeCompare(key(b), "sv"));
  const pages = Math.max(1, Math.ceil(rows.length / limit));
  const page = Math.min(pages, Math.max(1, Number(params.get("page")) || 1));
  const count = (customerId: string, kind: DemoTask["kind"]) => ctx.can(workflowSubjectForTask(kind), "read") ? ctx.db.tasks.filter((task) => task.customerId === customerId && task.kind === kind).length : null;
  const controlCount = (customerId: string) => liveControls(ctx).filter((control) => control.customerId === customerId).length;
  return { items: rows.slice((page - 1) * limit, page * limit).map((item) => ({ ...item, _count: { controls: controlCount(item.id) },
    work: { projects: ctx.can("projects", "read") ? ctx.db.projects.filter((project) => project.customerId === item.id).length : null, workOrders: count(item.id, "WORK_ORDER"), riskAssessments: count(item.id, "RISK_ASSESSMENT"), controls: ctx.can("kfid", "read") ? controlCount(item.id) : null } })), total: rows.length, page, pages, limit };
}

// ---------- /api/customer-card (decision 12B) ----------
function customerCard(ctx: Context, request: Request) {
  const facilities = (ctx.db.facilities ??= []);
  if (request.method === "GET") {
    const params = request.url.searchParams;
    const customer = ctx.db.customers.find((item) => item.id === params.get("id"));
    if (!customer) throw new DemoError(404, "Kunden hittades inte.");
    const kind = (params.get("kind") ?? "all") as "all" | "WORK_ORDER" | "RISK_ASSESSMENT" | "FORM" | "COMMISSIONING_CONTROL";
    const page = Math.max(1, Number(params.get("page") ?? 1) || 1);
    const own = facilities.filter((facility) => facility.customerId === customer.id);
    const projectName = (id: string | null) => ctx.db.projects.find((project) => project.id === id)?.name ?? "";
    const tasks = [
      ...readableTasks(ctx).filter((task) => task.customerId === customer.id).map((task) => ({ id: task.id, kind: task.kind, title: task.title, status: task.status, progress: workflowTaskProgress(task), updatedAt: task.updatedAt, facilityId: task.facilityId ?? null, projectName: projectName(task.projectId) })),
      ...readableControls(ctx).filter((control) => control.customerId === customer.id).map((control) => ({ id: control.id, kind: "COMMISSIONING_CONTROL" as const, title: control.title, status: control.status, progress: controlPercent(control), updatedAt: control.updatedAt, facilityId: control.facilityId, projectName: projectName(control.projectId) })),
    ].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
    const filtered = kind === "all" ? tasks : tasks.filter((task) => task.kind === kind);
    return {
      customer,
      facilities: own.map((facility) => ({ ...facility, links: ctx.db.projects.filter((project) => project.facilityId === facility.id).length + ctx.db.tasks.filter((task) => task.facilityId === facility.id).length + liveControls(ctx).filter((control) => control.facilityId === facility.id).length })),
      projects: ctx.can("projects", "read") ? ctx.db.projects.filter((project) => project.customerId === customer.id).map((project) => ({ id: project.id, name: project.name, startDate: project.startDate ?? "", dueDate: project.dueDate, facilityId: project.facilityId ?? null, status: projectStatus(ctx, project) })) : [],
      canReadProjects: ctx.can("projects", "read"),
      tasks: {
        items: filtered.slice((page - 1) * 12, page * 12),
        total: filtered.length, page, pages: Math.max(1, Math.ceil(filtered.length / 12)),
        counts: { all: tasks.length, WORK_ORDER: tasks.filter((task) => task.kind === "WORK_ORDER").length, RISK_ASSESSMENT: tasks.filter((task) => task.kind === "RISK_ASSESSMENT").length, FORM: tasks.filter((task) => task.kind === "FORM").length, COMMISSIONING_CONTROL: tasks.filter((task) => task.kind === "COMMISSIONING_CONTROL").length },
      },
      canManageFacilities: ctx.admin,
    };
  }
  const input = request.body as Json;
  if (input.action === "facility_status") {
    requireAdmin(ctx);
    const facility = facilities.find((item) => item.id === input.id);
    if (!facility) throw new DemoError(404, "Anläggningen hittades inte.");
    Object.assign(facility, { isActive: Boolean(input.isActive), version: facility.version + 1 });
    return { ok: true };
  }
  const parsed = customerFacilityInputSchema.safeParse(input.facility);
  if (!parsed.success) throw new DemoError(400, parsed.error.issues[0]?.message ?? "Anläggningen är ofullständig.");
  if (!ctx.db.customers.some((item) => item.id === input.customerId && !item.deletedAt)) throw new DemoError(404, "Kunden hittades inte.");
  const current = input.id ? facilities.find((item) => item.id === input.id && item.customerId === input.customerId) : undefined;
  if (input.id && !current) throw new DemoError(409, "Anläggningen har ändrats eller finns inte längre.");
  if (current) { Object.assign(current, parsed.data, { version: current.version + 1 }); return { id: current.id }; }
  const created = { ...parsed.data, id: nextId(ctx, "facility"), customerId: String(input.customerId), isActive: true, version: 1 };
  facilities.push(created);
  return { id: created.id };
}

// ---------- /api/projects ----------
const projectInput = z.object({
  id: z.string().optional(), name: z.string().trim().min(1).max(160), description: z.string().trim().max(2000).default(""), startDate: z.union([z.literal(""), z.iso.date()]).default(""), dueDate: z.union([z.literal(""), z.iso.date()]).default(""),
  client: z.string().trim().max(200).default(""), contactPerson: z.string().trim().max(200).default(""), reference: z.string().trim().max(120).default(""), workSite: z.string().trim().max(300).default(""),
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
    const controls = readableControls(ctx);
    const byUpdated = <T extends { updatedAt: string }>(a: T, b: T) => b.updatedAt.localeCompare(a.updatedAt);
    const controlCard = (control: DemoControl) => ({ ...controlSummary(ctx, control), completion: controlPercent(control), totalDurationSec: durationSec(entriesFor(ctx, control.id), ctx.now), isMine: isMyControl(ctx, control) });
    // Koppla befintlig uppgift (decision 7): standalone work and work in other projects that accept it.
    const candidatesFor = params.get("candidatesFor");
    if (candidatesFor) {
      ctx.require("projects", "read");
      const open = (projectId: string | null) => !projectId || (projectId !== candidatesFor && !projectArchived(ctx, projectId) && !projectClosed(ctx, projectId));
      const projectName = (projectId: string | null) => ctx.db.projects.find((item) => item.id === projectId)?.name;
      return { tasks: [
        ...tasks.filter((task) => open(task.projectId)).map((task) => ({ ...taskSummary(ctx, task), customerId: task.customerId, fromProject: projectName(task.projectId) })),
        ...controls.filter((control) => open(control.projectId)).map((control) => ({ ...controlCard(control), fromProject: projectName(control.projectId) })),
      ].sort(byUpdated) };
    }
    const tabOf = (project: DemoDatabase["projects"][number]) => project.archivedAt ? "archived" : project.closedAt ? "closed" : "ongoing";
    const listTab = params.get("list");
    const onlyId = params.get("id");
    const query = (params.get("q") ?? "").trim().toLowerCase();
    const matches = (project: DemoDatabase["projects"][number]) => !query || [project.name, project.description, ctx.db.customers.find((item) => item.id === project.customerId)?.name ?? ""].join(" ").toLowerCase().includes(query);
    const readable = ctx.can("projects", "read") ? [...ctx.db.projects].sort(byUpdated) : [];
    // The same bounded modes as the server: a page of one tab, one project, or everything for planning.
    const page = Math.max(1, Number(params.get("page")) || 1);
    const selected = listTab ? readable.filter((project) => tabOf(project) === listTab && matches(project)) : onlyId ? readable.filter((project) => project.id === onlyId) : readable;
    const shown = listTab ? selected.slice((page - 1) * 12, page * 12) : selected;
    return {
      ...(listTab ? { total: selected.length, page, pages: Math.max(1, Math.ceil(selected.length / 12)), counts: Object.fromEntries((["ongoing", "closed", "archived"] as const).map((tab) => [tab, readable.filter((project) => tabOf(project) === tab && matches(project)).length])) } : {}),
      projects: shown.map((project) => {
        const events = [...project.events].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
        const decisions = [...(project.decisions ?? [])].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
        const customer = ctx.db.customers.find((item) => item.id === project.customerId);
        return {
          ...project, startDate: project.startDate ?? "", closedAt: project.closedAt ?? null, facilityId: project.facilityId ?? null, facility: facilitySummary(ctx, project.facilityId),
          status: projectStatus(ctx, project), outsideFrameMinutes: outsideFrameMinutes(ctx, project),
          events: listTab ? [] : events.slice(0, 10), eventCount: events.length, decisions: listTab ? [] : decisions.slice(0, 10), decisionCount: decisions.length,
          customer: customer ? { id: customer.id, name: customer.name, company: customer.company } : null,
          controls: controls.filter((control) => control.projectId === project.id).sort(byUpdated).map(controlCard),
          workflowTasks: tasks.filter((task) => task.projectId === project.id).sort(byUpdated).map((task) => taskSummary(ctx, task)),
        };
      }),
      workflowTasks: listTab || onlyId ? [] : tasks.filter((task) => !task.projectId).sort(byUpdated).map((task) => taskSummary(ctx, task)),
      controls: listTab || onlyId ? [] : controls.filter((control) => !control.projectId).sort(byUpdated).map(controlCard),
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
    const control = liveControls(ctx).find((item) => item.id === input.taskId);
    if (control) {
      // A control keeps its protocol; it takes the project's customer and facility like on the server.
      ctx.require("kfid", "edit");
      const from = control.projectId ? ctx.db.projects.find((item) => item.id === control.projectId) : undefined;
      const takesCustomer = apply.customer && Boolean(project.customerId);
      Object.assign(control, { projectId: project.id, customerId: takesCustomer ? project.customerId : control.customerId, facilityId: takesCustomer ? project.facilityId ?? null : control.facilityId, version: control.version + 1, updatedAt: ctx.now.toISOString(), updatedBy: ctx.user.id });
      control.revisions.push({ id: nextId(ctx, "control-revision"), version: control.version, createdAt: control.updatedAt, createdBy: ctx.user.id, data: structuredClone(control.data) });
      if (from && from.id !== project.id) event(from, "TASK_MOVED", `Kontrollen ${control.title} flyttades till projektet ${project.name}`, control.id);
      event(project, from ? "TASK_MOVED" : "TASK_LINKED", from ? `Kontrollen ${control.title} flyttades hit från ett annat projekt` : `Kontrollen ${control.title} kopplades till projektet`, control.id);
      for (const activity of ctx.db.activities.filter((item) => !item.deletedAt && item.controlId === control.id)) activity.projectId = project.id;
      return { ok: true };
    }
    const task = ctx.db.tasks.find((item) => item.id === input.taskId);
    if (!task) throw new DemoError(404, "Uppgiften hittades inte.");
    ctx.require(workflowSubjectForTask(task.kind), "edit");
    // The link guide's choices (decision 7); a completed task keeps its content.
    const dueError = apply.dueDate ? taskDueDateError(apply.dueDate, { startDate: project.startDate ?? "", dueDate: project.dueDate }) : null;
    if (dueError) throw new DemoError(400, dueError);
    const open = task.status !== "COMPLETED";
    const from = task.projectId ? ctx.db.projects.find((item) => item.id === task.projectId) : undefined;
    Object.assign(task, {
      projectId: project.id,
      customerId: open && apply.customer && project.customerId ? project.customerId : task.customerId,
      assignedToUserId: open && apply.responsible && project.responsibleUserId ? project.responsibleUserId : task.assignedToUserId,
      assignedToName: open && apply.responsible && project.responsibleUserId ? project.responsibleName : task.assignedToName,
      dueDate: open && apply.dueDate ? apply.dueDate : task.dueDate,
      version: task.version + 1, updatedAt: ctx.now.toISOString(), updatedBy: ctx.user.id,
    });
    addRevision(ctx, task);
    if (from && from.id !== project.id) event(from, "TASK_MOVED", `Uppgiften ${task.title} flyttades till projektet ${project.name}`, task.id);
    event(project, from ? "TASK_MOVED" : "TASK_LINKED", from ? `Uppgiften ${task.title} flyttades hit från ett annat projekt` : `Uppgiften ${task.title} kopplades till projektet`, task.id);
    for (const activity of ctx.db.activities.filter((item) => !item.deletedAt && item.workflowTaskId === task.id)) activity.projectId = project.id;
    return { ok: true };
  }
  if (input.action === "archive" || input.action === "restore") {
    ctx.require("projects", "archive");
    const project = find(input.id);
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
    for (const control of ctx.db.controls.filter((item) => item.projectId === project.id)) control.projectId = null;
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
  if (data.id) {
    const project = find(data.id);
    if (project.archivedAt) throw new DemoError(409, "Återställ projektet innan du redigerar det.");
    const budget = data.timeBudgetMinutes ?? project.timeBudgetMinutes;
    const budgetChanged = budget !== project.timeBudgetMinutes;
    // "Flytta allt lika mycket" (decision 5), as on the server: open tasks' dates and active planning move with the frame.
    const frameChanged = (project.startDate ?? "") !== data.startDate || project.dueDate !== data.dueDate;
    if (frameChanged && data.shiftDays) {
      const move = (value: string) => addSwedishDays(value, data.shiftDays).toISOString();
      for (const task of ctx.db.tasks.filter((item) => item.projectId === project.id && item.status !== "COMPLETED" && item.dueDate)) task.dueDate = shiftDay(task.dueDate, data.shiftDays);
      for (const activity of ctx.db.activities.filter((item) => item.projectId === project.id && !item.deletedAt && ["PLANNED", "IN_PROGRESS"].includes(item.status))) {
        Object.assign(activity, { startsAt: move(activity.startsAt), endsAt: move(activity.endsAt), version: activity.version + 1 });
        activity.assignments = activity.assignments.map((assignment) => assignment.startsAt && assignment.endsAt ? { ...assignment, startsAt: move(assignment.startsAt), endsAt: move(assignment.endsAt) } : assignment);
      }
    }
    Object.assign(project, values, { timeBudgetMinutes: budget });
    event(project, budgetChanged ? "BUDGET_UPDATED" : "UPDATED", budgetChanged ? `Projektets tidsbudget ändrades till ${budget} minuter` : "Projektets grunduppgifter uppdaterades");
    return { id: project.id };
  }
  const created: DemoDatabase["projects"][number] = { ...values, id: nextId(ctx, "project"), timeBudgetMinutes: data.timeBudgetMinutes ?? 0, archivedAt: null, closedAt: null, createdAt: ctx.now.toISOString(), updatedAt: ctx.now.toISOString(), events: [], decisions: [] };
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
    const onlyId = request.url.searchParams.get("id");
    const membersOnly = request.url.searchParams.get("members") === "only";
    return {
      tasks: (membersOnly ? [] : readableTasks(ctx).filter((task) => !onlyId || task.id === onlyId)).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)).map((task) => {
        const project = ctx.db.projects.find((item) => item.id === task.projectId);
        const customer = ctx.db.customers.find((item) => item.id === task.customerId);
        const site = ctx.db.sites.find((item) => item.id === task.siteId);
        const entries = entriesFor(ctx, task.id).sort((a, b) => b.startedAt.localeCompare(a.startedAt));
        return {
          ...task, revisions: revisionView(task, task.revisions.slice(0, 10)), revisionCount: task.revisions.length, progress: workflowTaskProgress(task),
          project: project ? { id: project.id, name: project.name } : null, customer: customer ? { id: customer.id, name: customer.name, company: customer.company } : null,
          site: site ? { id: site.id, name: site.name } : null, department: site?.departments.find((item) => item.id === task.departmentId) ?? null,
          timeEntries: entries, attachments: [], totalDurationSec: durationSec(entries, ctx.now), timerRunning: entries.some((entry) => !entry.endedAt && entry.userId === ctx.user.id),
        };
      }),
      members: members(ctx),
    };
  }
  if (request.method === "DELETE") {
    requireAdmin(ctx);
    const id = request.url.searchParams.get("id");
    const task = ctx.db.tasks.find((item) => item.id === id);
    if (!task) throw new DemoError(404, "Uppgiften hittades inte.");
    ctx.db.tasks = ctx.db.tasks.filter((item) => item.id !== id);
    ctx.db.timeEntries = ctx.db.timeEntries.filter((entry) => entry.taskId !== id);
    for (const activity of ctx.db.activities.filter((item) => item.workflowTaskId === id)) activity.workflowTaskId = null;
    return { ok: true };
  }
  const input = request.body as Json;
  const now = ctx.now.toISOString();
  // Per-person timers like the server: `onlyMine` closes just the caller's entry.
  const closeRunning = (task: DemoTask, onlyMine = false) => {
    const stopped: { entryId: string; taskId: string; taskTitle: string; startedAt: string; endedAt: string; durationSec: number }[] = [];
    for (const entry of entriesFor(ctx, task.id).filter((item) => !item.endedAt && (!onlyMine || item.userId === ctx.user.id))) {
      Object.assign(entry, { endedAt: now, durationSec: Math.max(0, Math.floor((ctx.now.getTime() - Date.parse(entry.startedAt)) / 1000)), updatedAt: now });
      ctx.db.timeEvents.push({ id: nextId(ctx, "time-event"), entryId: entry.id, userId: entry.userId, action: "CREATED", previous: null, reason: "", actorUserId: ctx.user.id, actorName: ctx.user.name,
        next: { taskId: task.id, taskTitle: task.title, startedAt: entry.startedAt, endedAt: now, durationSec: entry.durationSec, note: entry.note }, createdAt: now });
      if (entry.userId === ctx.user.id) stopped.push({ entryId: entry.id, taskId: task.id, taskTitle: task.title, startedAt: entry.startedAt, endedAt: now, durationSec: entry.durationSec });
    }
    return stopped;
  };
  const find = (id: unknown) => { const task = ctx.db.tasks.find((item) => item.id === id); if (!task) throw new DemoError(404, "Uppgiften hittades inte."); return task; };
  if (input.action === "reopen") {
    const task = find(input.id);
    ctx.require(workflowSubjectForTask(task.kind), "reopen");
    if (task.status !== "COMPLETED") return { ok: true };
    if (projectArchived(ctx, task.projectId)) throw new DemoError(409, "Återställ projektet innan du återöppnar uppgiften.");
    if (projectClosed(ctx, task.projectId)) throw new DemoError(409, "Projektet är avslutat. Återöppna projektet innan du återöppnar uppgiften.");
    Object.assign(task, { data: resetWorkflowTaskApproval(task.data as never), status: "NEEDS_ACTION", completedAt: null, version: task.version + 1, updatedAt: now, updatedBy: ctx.user.id });
    addRevision(ctx, task);
    const project = ctx.db.projects.find((item) => item.id === task.projectId);
    project?.events.push({ id: nextId(ctx, "event"), kind: "TASK_REOPENED", summary: `Uppgiften ${task.title} återöppnades`, taskId: task.id, actorName: ctx.user.name, createdAt: now });
    return { ok: true };
  }
  if (input.action === "timer") {
    const task = find(input.id);
    ctx.require(workflowSubjectForTask(task.kind), "edit");
    if (task.status === "COMPLETED") throw new DemoError(409, "En slutförd uppgift kan inte tidrapporteras.");
    const start = input.command === "START";
    const stopped = start ? [] : closeRunning(task, true);
    const othersRunning = entriesFor(ctx, task.id).some((entry) => !entry.endedAt && entry.userId !== ctx.user.id);
    Object.assign(task, { status: start || othersRunning ? "IN_PROGRESS" : "PAUSED", startedAt: start ? task.startedAt ?? now : task.startedAt, version: task.version + 1, updatedAt: now, updatedBy: ctx.user.id });
    if (start) {
      if (!entriesFor(ctx, task.id).some((entry) => !entry.endedAt && entry.userId === ctx.user.id)) ctx.db.timeEntries.push({ id: nextId(ctx, "time"), taskId: task.id, userId: ctx.user.id, startedAt: now, endedAt: null, durationSec: 0, note: "", createdAt: now, updatedAt: now });
      // Starting a timer pauses the caller's timer on any other task.
      for (const other of ctx.db.tasks.filter((item) => item.id !== task.id && entriesFor(ctx, item.id).some((entry) => !entry.endedAt && entry.userId === ctx.user.id))) {
        stopped.push(...closeRunning(other, true));
        if (other.status === "IN_PROGRESS" && !entriesFor(ctx, other.id).some((entry) => !entry.endedAt)) Object.assign(other, { status: "PAUSED", version: other.version + 1, updatedAt: now });
      }
    }
    return { ok: true, stopped };
  }
  const data = workflowTaskInputSchema.parse(input.task);
  ctx.require(workflowSubjectForTask(data.kind), data.id ? "edit" : "create");
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
  if (data.assignedToUserId && !ctx.db.users.some((user) => user.id === data.assignedToUserId)) throw new DemoError(400, "Ansvarig användare tillhör inte arbetsytan.");
  if (data.status === "COMPLETED") {
    ctx.require(workflowSubjectForTask(data.kind), "complete");
    const completion = workflowTaskCompletion(data);
    if (!completion.ready) throw new DemoError(422, completion.issues.map((issue) => issue.message).join(" "));
  }
  const taskData = stampWorkflowTaskApproval(data.data, now);
  const status = data.status === "PLANNED" && workflowTaskHasDocumentation(data) ? "IN_PROGRESS" : data.status;
  const values = { projectId: data.projectId, customerId: data.customerId, siteId: data.siteId, departmentId: data.departmentId, title: data.title, description: data.description, status, assignedToUserId: data.assignedToUserId, assignedToName: data.assignedToUserId ? userName(ctx, data.assignedToUserId) : data.assignedToName, dueDate: data.dueDate, data: taskData as DemoTask["data"], completedAt: status === "COMPLETED" ? now : null, updatedAt: now, updatedBy: ctx.user.id };
  if (data.id) {
    const task = find(data.id);
    if (task.kind !== data.kind) throw new DemoError(409, "Uppgiftstypen kan inte ändras.");
    if (task.status === "COMPLETED") throw new DemoError(409, "Återöppna uppgiften innan du ändrar den.");
    if (task.projectId !== data.projectId) throw new DemoError(409, "Byt projekt via projektets Koppla befintlig uppgift, så att bytet hamnar i historiken.");
    if (task.version !== data.version) throw new DemoError(409, "Uppgiften har ändrats. Läs in den senaste versionen.");
    Object.assign(task, values, { version: task.version + 1 });
    if (status === "COMPLETED") closeRunning(task);
    addRevision(ctx, task);
    return { id: task.id, version: task.version };
  }
  const task: DemoTask = { ...values, id: nextId(ctx, "task"), kind: data.kind, version: 1, startedAt: status === "IN_PROGRESS" ? now : null, createdBy: ctx.user.id, createdAt: now, revisions: [] };
  ctx.db.tasks.push(task);
  addRevision(ctx, task);
  return { id: task.id, version: 1 };
}

// ---------- /api/planned-activities and /api/planning-capacity ----------
const activityTask = (ctx: Context, activity: DemoActivity) => {
  const task = ctx.db.tasks.find((item) => item.id === activity.workflowTaskId);
  return task ? { id: task.id, title: task.title, kind: task.kind, projectId: task.projectId } : null;
};
const activityControl = (ctx: Context, activity: DemoActivity) => {
  const control = liveControls(ctx).find((item) => item.id === activity.controlId);
  return control ? { id: control.id, title: control.title, projectId: control.projectId } : null;
};
const visibleActivities = (ctx: Context) => ctx.db.activities.filter((activity) => !activity.deletedAt && canReadPlannedActivity(ctx.user.permissions, ctx.admin, { workflowTask: activityTask(ctx, activity), controlId: activity.controlId }));
const capacityActivity = (activity: DemoActivity) => ({ startsAt: activity.startsAt, endsAt: activity.endsAt, assignedToUserId: activity.assignments[0]?.userId ?? null, assignedToUserIds: activity.assignments.map((item) => item.userId), assignments: activity.assignments, status: activity.status, projectId: activity.projectId });
function plannedActivities(ctx: Context, request: Request) {
  if (request.method === "GET") return {
    activities: visibleActivities(ctx).sort((a, b) => a.startsAt.localeCompare(b.startsAt)).map((activity) => {
      const project = ctx.db.projects.find((item) => item.id === activity.projectId);
      const events = [...activity.events].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
      return { ...activity, project: project ? { id: project.id, name: project.name, timeBudgetMinutes: project.timeBudgetMinutes } : null, workflowTask: activityTask(ctx, activity), control: activityControl(ctx, activity),
        assignedToUserId: activity.assignments[0]?.userId ?? null, assignedToUserIds: activity.assignments.map((item) => item.userId), events: events.slice(0, 10), eventCount: events.length };
    }),
  };
  const input = request.body as Json;
  const now = ctx.now.toISOString();
  const requireEdit = (activity: DemoActivity) => {
    ctx.require("projects", "edit");
    const task = activityTask(ctx, activity);
    if (task) ctx.require(workflowSubjectForTask(task.kind), "edit");
    if (activity.controlId) ctx.require("kfid", "edit");
  };
  if (input.action === "delete") {
    const activity = ctx.db.activities.find((item) => item.id === input.id && !item.deletedAt);
    if (!activity) throw new DemoError(404, "Den planerade aktiviteten hittades inte.");
    requireEdit(activity);
    if (activity.version !== input.version) throw new DemoError(409, "Planeringen har ändrats. Läs in den senaste versionen.");
    Object.assign(activity, { deletedAt: now, version: activity.version + 1 });
    activity.events.push({ id: nextId(ctx, "activity-event"), kind: "DELETED", summary: plannedActivitySummary("DELETED", activity.title), actorName: ctx.user.name, createdAt: now });
    return { ok: true };
  }
  const data = plannedActivityInputSchema.parse(input.activity);
  ctx.require("projects", data.id ? "edit" : "create");
  if (data.projectId && !ctx.db.projects.some((item) => item.id === data.projectId)) throw new DemoError(400, "Projektet hittades inte.");
  if (projectArchived(ctx, data.projectId)) throw new DemoError(409, "Återställ projektet innan du planerar arbete i det.");
  if (projectClosed(ctx, data.projectId) && !["COMPLETED", "CANCELED"].includes(data.status)) throw new DemoError(409, "Projektet är avslutat. Återöppna projektet innan du planerar arbete i det.");
  const task = ctx.db.tasks.find((item) => item.id === data.workflowTaskId);
  if (data.workflowTaskId && !task) throw new DemoError(400, "Uppgiften hittades inte.");
  if (task) ctx.require(workflowSubjectForTask(task.kind), "edit");
  const control = data.controlId ? liveControls(ctx).find((item) => item.id === data.controlId) : undefined;
  if (data.controlId && !control) throw new DemoError(400, "Kontrollen hittades inte.");
  if (control) ctx.require("kfid", "edit");
  const linkedProjectId = task?.projectId ?? control?.projectId ?? null;
  if (data.projectId && linkedProjectId && data.projectId !== linkedProjectId) throw new DemoError(400, "Den valda uppgiften tillhör ett annat projekt.");
  {
    // Same frame rules as the server (Daniel 2026-09-26, decision 4).
    const previous = data.id ? ctx.db.activities.find((item) => item.id === data.id) : undefined;
    const active = !["COMPLETED", "CANCELED"].includes(data.status);
    const changed = !previous || previous.startsAt !== data.startsAt || previous.endsAt !== data.endsAt || previous.projectId !== data.projectId || previous.workflowTaskId !== data.workflowTaskId || previous.controlId !== data.controlId;
    if (active && changed && (task?.status === "COMPLETED" || control?.status === "COMPLETED")) throw new DemoError(409, "Uppgiften är slutförd. Återöppna den innan du planerar mer arbete på den.");
    const frameProject = ctx.db.projects.find((item) => item.id === (data.projectId ?? linkedProjectId));
    const frameError = active && changed && frameProject ? planningFrameError(data, { startDate: frameProject.startDate ?? "", dueDate: frameProject.dueDate }) : null;
    if (frameError && !data.frameExceptionReason) throw new DemoError(409, `${frameError} Projektansvarig eller en företagsadministratör kan göra ett undantag med en motivering.`);
    if (frameError && !canManageProjectLifecycle({ admin: ctx.admin, userId: ctx.user.id, responsibleUserId: frameProject!.responsibleUserId, canEditProjects: ctx.can("projects", "edit") }))
      throw new DemoError(403, "Bara projektansvarig eller en företagsadministratör kan göra undantag från projektets tidsram.");
    if (frameError) frameProject!.events.push({ id: nextId(ctx, "event"), kind: "PLANNING_EXCEPTION", summary: `Planeringen ${data.title} fick undantag från projektets tidsram: ${data.frameExceptionReason}`, taskId: null, actorName: ctx.user.name, createdAt: ctx.now.toISOString() });
  }
  const assignments = plannedActivityAssignments(data);
  if (assignments.some((assignment) => !ctx.db.users.some((user) => user.id === assignment.userId))) throw new DemoError(400, "Varje ansvarig måste vara en aktiv medlem i arbetsytan.");
  const values = { title: data.title, description: data.description, kind: data.kind, status: data.status, startsAt: data.startsAt, endsAt: data.endsAt, projectId: data.projectId ?? linkedProjectId, workflowTaskId: data.workflowTaskId, controlId: data.controlId ?? null,
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
  ctx.require("projects", "read");
  const people = ctx.admin ? ctx.db.users : [ctx.user];
  return {
    canViewTeam: ctx.admin,
    organizationWeeklyWorkMinutes: ctx.db.organization.weeklyWorkMinutes,
    members: people.map((user) => ({ id: user.id, name: user.name, weeklyWorkMinutes: user.weeklyWorkMinutes ?? ctx.db.organization.weeklyWorkMinutes, memberWeeklyWorkMinutes: user.weeklyWorkMinutes, events: [] })),
    activities: visibleActivities(ctx).map(capacityActivity),
  };
}

// ---------- /api/workflow-time ----------
const timeEntryInput = z.object({ id: z.string().optional(), taskId: z.string(), userId: z.string().optional(), startedAt: z.iso.datetime(), endedAt: z.iso.datetime(), note: z.string().trim().max(1000).default("") });
function workflowTime(ctx: Context, request: Request) {
  if (request.method === "GET") {
    if (request.url.searchParams.get("running") === "mine") {
      const running = ctx.db.timeEntries.filter((entry) => !entry.endedAt && entry.userId === ctx.user.id).map((entry) => ({ entry, task: ctx.db.tasks.find((task) => task.id === entry.taskId) }))
        .filter((item): item is { entry: typeof item.entry; task: DemoTask } => Boolean(item.task) && ctx.can(workflowSubjectForTask(item.task!.kind), "read"));
      return { now: ctx.now.toISOString(), running: running.map(({ entry, task }) => ({ entryId: entry.id, taskId: task.id, taskTitle: task.title, kind: task.kind, projectName: ctx.db.projects.find((project) => project.id === task.projectId)?.name ?? null, startedAt: entry.startedAt })) };
    }
    if (request.url.searchParams.get("capacity") === "week") {
      const week = capacityWeek(ctx.now);
      return { currentUserId: ctx.user.id, schedule: { organizationWeeklyWorkMinutes: ctx.db.organization.weeklyWorkMinutes, memberWeeklyWorkMinutes: ctx.user.weeklyWorkMinutes },
        timeEntries: ctx.db.timeEntries.filter((entry) => entry.userId === ctx.user.id && sourceOf(ctx, entry.taskId) && Date.parse(entry.startedAt) >= week.startsAt.getTime() && Date.parse(entry.startedAt) < week.endsAt.getTime())
          .map((entry) => ({ startedAt: entry.startedAt, durationSec: entry.durationSec })) };
    }
    const history = request.url.searchParams.get("history");
    if (history) return { events: ctx.db.timeEvents.filter((event) => event.entryId === history && (ctx.admin || event.userId === ctx.user.id)).sort((a, b) => b.createdAt.localeCompare(a.createdAt)) };
    const corrected = new Set(ctx.db.timeEvents.filter((event) => event.actorUserId !== event.userId).map((event) => event.entryId));
    const mark = <T extends { id: string }>(entry: T) => ({ ...entry, corrected: corrected.has(entry.id) });
    // Controls take manual time (decision 13) and are listed like tasks with the kind COMMISSIONING_CONTROL.
    const tasks = [...readableTasks(ctx), ...readableControls(ctx).map((control) => sourceOf(ctx, control.id)!)].sort((a, b) => a.title.localeCompare(b.title, "sv"));
    const bare = ({ id, userId, startedAt, endedAt, durationSec: seconds, note, createdAt, updatedAt }: DemoDatabase["timeEntries"][number]) => ({ id, userId, startedAt, endedAt, durationSec: seconds, note, createdAt, updatedAt });
    return {
      currentUserId: ctx.user.id,
      tasks: tasks.map((task) => {
        const project = ctx.db.projects.find((item) => item.id === task.projectId);
        return { id: task.id, title: task.title, kind: task.kind, status: task.status, projectId: task.projectId, project: project ? { name: project.name } : null, archived: Boolean(project?.archivedAt),
          timeEntries: entriesFor(ctx, task.id).filter((entry) => entry.userId === ctx.user.id).sort((a, b) => b.startedAt.localeCompare(a.startedAt)).map((entry) => mark(bare(entry))) };
      }),
      team: ctx.admin ? { members: members(ctx), entries: tasks.flatMap((task) => entriesFor(ctx, task.id).map((entry) => ({ ...mark(bare(entry)), taskId: task.id }))) } : null,
      schedule: { organizationWeeklyWorkMinutes: ctx.db.organization.weeklyWorkMinutes, memberWeeklyWorkMinutes: ctx.user.weeklyWorkMinutes, canEditOrganization: ctx.admin, events: [] },
    };
  }
  const input = request.body as Json;
  const now = ctx.now.toISOString();
  const state = (task: Source) => ({ status: task.status, archived: projectArchived(ctx, task.projectId) });
  const check = (...args: Parameters<typeof assertTimeCorrection>) => {
    try { return assertTimeCorrection(...args); } catch (error) { if (error instanceof TimeCorrectionError) throw new DemoError(error.status, error.message); throw error; }
  };
  const snapshot = (entry: { startedAt: string; endedAt: string | null; durationSec: number; note: string }, task: Source) => ({ taskId: task.id, taskTitle: task.title, startedAt: entry.startedAt, endedAt: entry.endedAt, durationSec: entry.durationSec, note: entry.note });
  const reason = typeof input.reason === "string" ? input.reason : "";
  const findEntry = (id: unknown) => {
    const entry = ctx.db.timeEntries.find((item) => item.id === id && (ctx.admin || item.userId === ctx.user.id));
    const task = entry ? sourceOf(ctx, entry.taskId) : null;
    if (!entry || !task) throw new DemoError(404, "Tidposten hittades inte.");
    return { entry, task };
  };
  if (input.action === "schedule_save") {
    if (input.scope === "ORGANIZATION") { requireAdmin(ctx); ctx.db.organization.weeklyWorkMinutes = Number(input.minutes); }
    else ctx.user.weeklyWorkMinutes = input.minutes === null ? null : Number(input.minutes);
    return { ok: true };
  }
  if (input.action === "delete") {
    const { entry, task } = findEntry(input.id);
    ctx.require(workflowSubjectForTask(task.kind), "edit");
    const normalized = check({ actorIsAdmin: ctx.admin, actorOwnsEntry: entry.userId === ctx.user.id, source: state(task) }, reason);
    ctx.db.timeEntries = ctx.db.timeEntries.filter((item) => item.id !== entry.id);
    ctx.db.timeEvents.push({ id: nextId(ctx, "time-event"), entryId: entry.id, userId: entry.userId, action: "DELETED", previous: snapshot(entry, task), next: null, reason: normalized, actorUserId: ctx.user.id, actorName: ctx.user.name, createdAt: now });
    return { ok: true };
  }
  const data = timeEntryInput.parse(input.entry);
  if (Date.parse(data.endedAt) <= Date.parse(data.startedAt)) throw new DemoError(422, "Sluttiden måste vara efter starttiden.");
  const seconds = Math.floor((Date.parse(data.endedAt) - Date.parse(data.startedAt)) / 1000);
  if (seconds > 24 * 3600) throw new DemoError(422, "En enskild tidpost får vara högst 24 timmar.");
  const task = sourceOf(ctx, data.taskId);
  if (!task) throw new DemoError(404, "Uppgiften hittades inte.");
  ctx.require(workflowSubjectForTask(task.kind), "edit");
  const next = { startedAt: data.startedAt, endedAt: data.endedAt, durationSec: seconds, note: data.note };
  if (data.id) {
    const { entry, task: source } = findEntry(data.id);
    const normalized = check({ actorIsAdmin: ctx.admin, actorOwnsEntry: entry.userId === ctx.user.id, source: state(source), target: state(task) }, reason);
    const previous = snapshot(entry, source);
    Object.assign(entry, next, { taskId: task.id, updatedAt: now });
    ctx.db.timeEvents.push({ id: nextId(ctx, "time-event"), entryId: entry.id, userId: entry.userId, action: "UPDATED", previous, next: snapshot(next, task), reason: normalized, actorUserId: ctx.user.id, actorName: ctx.user.name, createdAt: now });
    return { id: entry.id };
  }
  const ownerId = data.userId ?? ctx.user.id;
  if (ownerId !== ctx.user.id) { requireAdmin(ctx); if (!ctx.db.users.some((user) => user.id === ownerId)) throw new DemoError(400, "Medarbetaren tillhör inte arbetsytan."); }
  const normalized = check({ actorIsAdmin: ctx.admin, actorOwnsEntry: ownerId === ctx.user.id, target: state(task) }, reason);
  const entry = { id: nextId(ctx, "time"), taskId: task.id, userId: ownerId, ...next, createdAt: now, updatedAt: now };
  ctx.db.timeEntries.push(entry);
  ctx.db.timeEvents.push({ id: nextId(ctx, "time-event"), entryId: entry.id, userId: ownerId, action: "CREATED", previous: null, next: snapshot(next, task), reason: normalized, actorUserId: ctx.user.id, actorName: ctx.user.name, createdAt: now });
  return { id: entry.id };
}

// ---------- read-only aggregates ----------
function overviewKpis(ctx: Context) {
  const week = capacityWeek(ctx.now);
  const tasks = [
    ...readableTasks(ctx).map((task): OverviewKpiTask & { projectId: string | null } => ({ kind: task.kind, status: task.status, dueDate: task.dueDate, completedAt: task.completedAt, isMine: isMine(ctx, task), projectId: task.projectId })),
    // An open control with remaining mandatory points needs action, as on the server; a control's date is no due date.
    ...readableControls(ctx).map((control): OverviewKpiTask & { projectId: string | null } => ({ kind: "CONTROL", status: control.status === "COMPLETED" ? "COMPLETED" : controlCompletion(control).errors.length ? "NEEDS_ACTION" : "IN_PROGRESS",
      dueDate: "", completedAt: control.status === "COMPLETED" ? control.updatedAt : null, isMine: isMyControl(ctx, control), projectId: control.projectId })),
  ];
  const people = ctx.admin ? ctx.db.users : [ctx.user];
  const input = {
    currentUserId: ctx.user.id,
    now: ctx.now,
    members: people.map((user) => ({ id: user.id, weeklyWorkMinutes: user.weeklyWorkMinutes ?? ctx.db.organization.weeklyWorkMinutes })),
    tasks,
    projects: ctx.can("projects", "read") ? ctx.db.projects.map((project) => {
      const own = tasks.filter((task) => task.projectId === project.id);
      const reported = ctx.db.timeEntries.filter((entry) => sourceOf(ctx, entry.taskId)?.projectId === project.id).reduce((sum, entry) => sum + entry.durationSec, 0);
      return { status: projectStatus(ctx, project), timeBudgetMinutes: project.timeBudgetMinutes, reportedMinutes: Math.round(reported / 60), isMine: project.responsibleUserId === ctx.user.id || own.some((task) => task.isMine) };
    }) : [],
    timeEntries: ctx.db.timeEntries.filter((entry) => Date.parse(entry.startedAt) >= week.startsAt.getTime() && Date.parse(entry.startedAt) < week.endsAt.getTime() && (ctx.admin || entry.userId === ctx.user.id))
      .map((entry) => ({ userId: entry.userId, startedAt: entry.startedAt, durationSec: durationSec([entry], ctx.now) })),
    activities: visibleActivities(ctx).map(capacityActivity),
  };
  return { canViewTeam: ctx.admin, team: ctx.admin ? summarizeOverviewKpis({ ...input, scope: "team" }) : null, mine: summarizeOverviewKpis({ ...input, scope: "mine" }) };
}
function overviewWork(ctx: Context, request: Request) {
  const params = request.url.searchParams;
  const projectName = (projectId: string | null) => projectId ? ctx.db.projects.find((project) => project.id === projectId)?.name : undefined;
  const controls = readableControls(ctx);
  const items = buildOverviewWork({
    today: swedishDayKey(ctx.now),
    projects: ctx.can("projects", "read") ? ctx.db.projects.map((project) => ({
      id: project.id, name: project.name, updatedAt: project.updatedAt, dueDate: project.dueDate, status: projectStatus(ctx, project),
      tasks: [...readableTasks(ctx).filter((task) => task.projectId === project.id).map((task) => ({ status: task.status as string, progress: workflowTaskProgress(task) })),
        ...controls.filter((control) => control.projectId === project.id).map((control) => ({ status: control.status as string, progress: controlPercent(control) }))],
    })) : [],
    controls: controls.map((control) => ({ id: control.id, title: control.title, status: control.status, updatedAt: control.updatedAt, lastOpenedAt: control.lastOpenedAt, projectName: projectName(control.projectId),
      percent: controlPercent(control), errors: control.status === "COMPLETED" ? 0 : controlCompletion(control).errors.length })),
    tasks: readableTasks(ctx).map((task) => ({ id: task.id, title: task.title, kind: task.kind, status: task.status, progress: workflowTaskProgress(task), dueDate: task.dueDate, updatedAt: task.updatedAt, projectName: projectName(task.projectId) })),
  });
  return selectOverviewWork(items, { filter: z.enum(OVERVIEW_WORK_FILTERS).catch("all").parse(params.get("filter")), sort: z.enum(OVERVIEW_WORK_SORTS).catch("updated").parse(params.get("sort")), page: Number(params.get("page")) || 1 });
}
function notifications(ctx: Context) {
  const sources = [
    ...readableTasks(ctx).filter((task) => task.status !== "COMPLETED" && !projectArchived(ctx, task.projectId) && (ctx.admin || isMine(ctx, task)))
      .map((task) => ({ id: task.id, title: task.title, kind: task.kind, status: task.status, dueDate: task.dueDate })),
    ...readableControls(ctx).filter((control) => control.status !== "COMPLETED" && !projectArchived(ctx, control.projectId) && (ctx.admin || isMyControl(ctx, control)))
      .map((control) => ({ id: control.id, title: control.title, status: control.status, kind: "COMMISSIONING_CONTROL" as const, completionErrors: controlCompletion(control).errors.length })),
  ];
  const today = notificationToday(ctx.now);
  return { items: taskNotifications(sources, today), today, scope: ctx.admin ? "team" : "mine" };
}
function taskStatistics(ctx: Context, request: Request) {
  requireAdmin(ctx);
  const params = request.url.searchParams;
  const today = swedishDayKey(ctx.now);
  const from = params.get("from") || `${Number(today.slice(0, 4)) - 1}-${today.slice(5, 7)}-01`;
  const to = params.get("to") || today;
  const days = (Date.parse(to) - Date.parse(from)) / 86400000;
  if (!(days >= 0 && days <= 1826)) throw new DemoError(400, "Välj ett datumintervall på högst fem år, med start före slut.");
  const bucket = taskStatisticsBucket(from, to, (params.get("bucket") || "auto") as "auto");
  const type = z.enum(TASK_STATISTICS_TYPES).parse(params.get("type") || "ALL");
  const page = Math.max(1, Number(params.get("page")) || 1);
  const rows = [
    ...ctx.db.tasks.map((task) => ({
      id: task.id, kind: task.kind as string, title: task.title, status: task.status as string, performer: task.assignedToName || "Ej tilldelad", createdAt: task.createdAt,
      createdDay: swedishDayKey(task.createdAt), completedDay: task.status === "COMPLETED" && task.completedAt ? swedishDayKey(task.completedAt) : null,
    })),
    // A control's completion day is its last change once completed (completed controls are immutable).
    ...liveControls(ctx).map((control) => ({
      id: control.id, kind: "KFID", title: control.title, status: control.status as string, performer: control.performer || "Ej angivet", createdAt: control.createdAt,
      createdDay: swedishDayKey(control.createdAt), completedDay: control.status === "COMPLETED" ? swedishDayKey(control.updatedAt) : null,
    })),
  ].filter((row) => type === "ALL" || row.kind === type);
  const inPeriod = (day: string | null) => Boolean(day && day >= from && day <= to);
  const count = (key: "createdDay" | "completedDay") => [...rows.filter((row) => inPeriod(row[key])).reduce((map, row) => map.set(row[key]!, (map.get(row[key]!) ?? 0) + 1), new Map<string, number>())].map(([date, value]) => ({ date, count: value }));
  const summary = summarizeTaskStatistics({ created: count("createdDay"), completed: count("completedDay"), from, to, bucket, monthlyTarget: ctx.db.users.length * 2 });
  const performers = [...rows.filter((row) => inPeriod(row.createdDay) || inPeriod(row.completedDay)).reduce((map, row) => {
    const current = map.get(row.performer) ?? { name: row.performer, created: 0, completed: 0 };
    current.created += Number(inPeriod(row.createdDay)); current.completed += Number(inPeriod(row.completedDay));
    return map.set(row.performer, current);
  }, new Map<string, { name: string; created: number; completed: number }>()).values()].sort((a, b) => b.completed - a.completed || b.created - a.created);
  const created = rows.filter((row) => inPeriod(row.createdDay)).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  return { from, to, bucket, type, ...summary, kpis: { ...summary.kpis, members: ctx.db.users.length }, performers,
    recent: { items: created.slice((page - 1) * 10, page * 10), page, pages: Math.max(1, Math.ceil(created.length / 10)), total: created.length } };
}
function workItems(ctx: Context, request: Request) {
  const params = request.url.searchParams;
  const filter = (WORK_ITEM_FILTERS as readonly string[]).includes(params.get("filter") ?? "") ? params.get("filter") as WorkItemFilter : "open";
  const limit = Math.min(48, Math.max(1, Number(params.get("limit")) || 12));
  const page = Math.max(1, Number(params.get("page")) || 1);
  const q = (params.get("q") ?? "").trim().toLocaleLowerCase("sv-SE");
  const kinds = workItemKindsForQuery(q);
  const projectName = (projectId: string | null) => ctx.db.projects.find((project) => project.id === projectId)?.name ?? "";
  type Row = { task: { id: string; kind: string; title: string; status: string; updatedAt: string; projectId: string | null }; projectName: string; state: string; item: Record<string, unknown> };
  const rows: Row[] = [
    ...readableTasks(ctx).filter((task) => isMine(ctx, task)).map((task) => ({
      task, projectName: projectName(task.projectId),
      state: task.status === "COMPLETED" ? "done" : ["IN_PROGRESS", "PAUSED", "NEEDS_ACTION"].includes(task.status) || workflowTaskProgress(task) > 0 ? "active" : "planned",
      item: { id: task.id, kind: task.kind, title: task.title, status: task.status, updatedAt: task.updatedAt, projectId: task.projectId, projectName: projectName(task.projectId), progress: workflowTaskProgress(task), isMine: true },
    })),
    // Controls I created or perform; "pågår" once opened or saved more than once, as on the server.
    ...readableControls(ctx).filter((control) => isMyControl(ctx, control)).map((control) => ({
      task: { ...control, kind: "COMMISSIONING_CONTROL" }, projectName: projectName(control.projectId),
      state: control.status === "COMPLETED" ? "done" : control.lastOpenedAt || control.version > 1 ? "active" : "planned",
      item: { id: control.id, number: control.number, kind: "COMMISSIONING_CONTROL", title: control.title, status: control.status, updatedAt: control.updatedAt, projectId: control.projectId, projectName: projectName(control.projectId), lastOpenedAt: control.lastOpenedAt, completion: controlPercent(control), isMine: true },
    })),
  ].filter((row) => !q || row.task.title.toLocaleLowerCase("sv-SE").includes(q) || row.projectName.toLocaleLowerCase("sv-SE").includes(q) || (kinds as string[]).includes(row.task.kind));
  const matches = (row: (typeof rows)[number], value: WorkItemFilter) => value === "all" || (value === "open" && row.state !== "done") || (value === "done" && row.state === "done")
    || (value === "planned" && row.state === "planned") || (value === "action" && row.state !== "done" && row.task.status === "NEEDS_ACTION") || (value === "active" && row.state === "active" && row.task.status !== "NEEDS_ACTION");
  const selected = rows.filter((row) => matches(row, filter)).sort((a, b) => b.task.updatedAt.localeCompare(a.task.updatedAt));
  return {
    items: selected.slice((page - 1) * limit, page * limit).map((row) => row.item),
    total: selected.length, page, pages: Math.max(1, Math.ceil(selected.length / limit)),
    counts: Object.fromEntries(WORK_ITEM_FILTERS.map((value) => [value, rows.filter((row) => matches(row, value)).length])),
  };
}
function search(ctx: Context, request: Request) {
  const q = (request.url.searchParams.get("q") ?? "").trim().toLowerCase();
  if (q.length < 2) throw new DemoError(400, "Skriv minst två tecken.");
  const match = (...values: (string | null | undefined)[]) => values.some((value) => value?.toLowerCase().includes(q));
  return {
    projects: ctx.can("projects", "read") ? ctx.db.projects.filter((project) => match(project.name, project.description, project.responsibleName)).slice(0, 6).map(({ id, name, description, responsibleName, archivedAt }) => ({ id, name, description, responsibleName, archivedAt })) : [],
    tasks: readableTasks(ctx).filter((task) => match(task.title, task.description, task.assignedToName, ctx.db.projects.find((item) => item.id === task.projectId)?.name)).slice(0, 6)
      .map(({ id, title, description, kind, status, projectId, assignedToName }) => ({ id, title, description, kind, status, projectId, assignedToName })),
    controls: readableControls(ctx).filter((control) => match(control.title, control.project, control.performer, String(control.number))).slice(0, 6).map((control) => ({ ...controlSummary(ctx, control), completion: { complete: controlCompletion(control).complete, errors: controlCompletion(control).errors.length, warnings: controlCompletion(control).warnings.length, percent: controlCompletion(control).progress.percent } })),
    customers: ctx.db.customers.filter((customer) => !customer.deletedAt && match(customer.name, customer.company, customer.city, customer.email)).slice(0, 6),
  };
}
function administration(ctx: Context, request: Request) {
  requireAdmin(ctx);
  if (request.method !== "GET") throw new DemoError(403, "Användare och företagsuppgifter kan inte ändras i demon. Här ser du hur det ser ut för en företagsadministratör.");
  if (request.url.searchParams.get("events") === "older") return { events: [] };
  const organization = ctx.db.organization;
  return {
    organizations: [{
      id: organization.id, name: organization.name, isActive: true, storageMode: organization.storageMode,
      profile: { email: ctx.db.settings.contactEmail, city: "Elstad" }, wallet: null,
      _count: { customers: ctx.db.customers.filter((customer) => !customer.deletedAt).length, controls: liveControls(ctx).length },
      members: ctx.db.users.map((user) => ({ id: `member-${user.id}`, role: user.role, canDeleteControls: user.role === "ADMIN", workflowPermissions: user.permissions, isActive: true, user: { id: user.id, name: user.name, email: user.email, isActive: true } })),
      invitations: [],
    }],
    activeOrganizationId: organization.id, superadmin: false, invitationDeliveryEnabled: false, events: ctx.db.adminEvents, eventCount: ctx.db.adminEvents.length,
  };
}
function organizationStructure(ctx: Context, request: Request) {
  if (request.method === "GET") return { sites: ctx.db.sites };
  requireAdmin(ctx);
  const input = request.body as { action: string; id?: string; siteId?: string; name?: string; isActive?: boolean };
  if (input.action === "site_save") {
    const site = ctx.db.sites.find((item) => item.id === input.id);
    if (site) site.name = input.name ?? site.name; else ctx.db.sites.push({ id: nextId(ctx, "site"), name: input.name ?? "", isActive: true, departments: [] });
  } else if (input.action === "department_save") {
    const site = ctx.db.sites.find((item) => item.id === input.siteId);
    if (!site) throw new DemoError(404, "Platsen hittades inte.");
    const department = site.departments.find((item) => item.id === input.id);
    if (department) department.name = input.name ?? department.name; else site.departments.push({ id: nextId(ctx, "department"), name: input.name ?? "", isActive: true });
  } else if (input.action === "site_status") {
    const site = ctx.db.sites.find((item) => item.id === input.id); if (site) site.isActive = Boolean(input.isActive);
  } else if (input.action === "department_status") {
    const department = ctx.db.sites.flatMap((item) => item.departments).find((item) => item.id === input.id); if (department) department.isActive = Boolean(input.isActive);
  }
  return { ok: true };
}

const aiPolicy = { enabled: false, shareChatContent: false, shareCustomers: false, shareControls: false, shareDocuments: false, shareConversationHistory: false, allowedModules: [] as "KFID"[] };
const demoLegalNote = "I demon visas inte dokumenttexten. Gällande versioner finns under Villkor, Integritet och DPA längst ned på sidan.";

function route(request: Request): Json | unknown {
  const ctx = context();
  const path = request.url.pathname.replace(/\/+$/, "");
  const get = request.method === "GET";
  switch (path) {
    case "/api/workspace": return workspace(ctx, request);
    case "/api/records": return records(ctx, request);
    case "/api/projects": return projects(ctx, request);
    case "/api/customer-card": return customerCard(ctx, request);
    case "/api/workflow-tasks": return workflowTasks(ctx, request);
    case "/api/planned-activities": return plannedActivities(ctx, request);
    case "/api/planning-capacity": return planningCapacity(ctx);
    case "/api/workflow-time": return workflowTime(ctx, request);
    case "/api/overview-kpis": return overviewKpis(ctx);
    case "/api/task-notifications": return notifications(ctx);
    case "/api/overview-work": return overviewWork(ctx, request);
    case "/api/forms": if (get) {
      const formId = request.url.searchParams.get("id");
      const form = formId ? ctx.db.forms.find((item) => item.id === formId) : null;
      if (formId && !form) throw new DemoError(404, "Formuläret är inte publicerat.");
      return form ? { templateId: form.id, id: form.id, version: form.version, name: form.name, description: form.description, color: form.color, icon: form.icon, category: form.category, allowStandalone: form.allowStandalone, allowInProject: form.allowInProject, document: form.document }
        : { forms: ctx.db.forms.map((form) => ({ id: form.id, version: form.version, name: form.name, description: form.description, color: form.color, icon: form.icon, category: form.category, allowStandalone: form.allowStandalone, allowInProject: form.allowInProject, hintek: true, source: "HINTEK", author: "HINTEK", publisher: "HINTEK" })) };
    } break;
    // Driftronder and limit profiles (2026-09-28): read-only and empty in the demo; nothing is planned or stored.
    case "/api/form-schedules": if (get) return { canPlan: false, today: swedishDayKey(new Date()), schedules: [] }; break;
    case "/api/form-limits": if (get) return { family: request.url.searchParams.get("templateId") ?? "", canEdit: false, profiles: [] }; break;
    case "/api/task-statistics": return taskStatistics(ctx, request);
    case "/api/workflow-search": return search(ctx, request);
    case "/api/work-items": return workItems(ctx, request);
    case "/api/work-orders": if (get) {
      // Mina arbetsordrar: the same list, filters and pages as the server (lib/workflow/work-orders.ts).
      if (!ctx.can("work-order", "read")) throw new DemoError(403, "Du saknar behörighet att visa den här delen av Workflow.");
      const params = request.url.searchParams;
      return listWorkOrders(ctx.db.tasks.map((task) => ({
        ...task, progress: workflowTaskProgress(task), customerName: ctx.db.customers.find((customer) => customer.id === task.customerId)?.company || ctx.db.customers.find((customer) => customer.id === task.customerId)?.name || "",
        projectName: ctx.db.projects.find((project) => project.id === task.projectId)?.name ?? "",
        plannedAt: nextPlannedAt(ctx.db.activities.filter((activity) => activity.workflowTaskId === task.id), new Date(ctx.now)),
      })), {
        scope: params.get("scope") === "all" ? "all" : "mine", q: params.get("q") ?? "", page: Math.max(1, Number(params.get("page")) || 1), userId: ctx.user.id,
        filter: (WORK_ITEM_FILTERS as readonly string[]).includes(params.get("filter") ?? "") ? params.get("filter") as WorkItemFilter : "open",
      });
    } break;
    case "/api/administration": return administration(ctx, request);
    case "/api/organization-structure": return organizationStructure(ctx, request);
    case "/api/legal": if (get) return { documents: [
      { id: "demo-terms", type: "TERMS", scope: "ORGANIZATION", version: "demo", title: "Tjänstevillkor", content: demoLegalNote, contentHash: "", validFrom: null, acceptedAt: "2026-01-01T09:00:00.000Z", canAccept: false, acceptHelp: null, required: true },
      { id: "demo-privacy", type: "PRIVACY", scope: "INDIVIDUAL", version: "demo", title: "Integritetspolicy", content: demoLegalNote, contentHash: "", validFrom: null, acceptedAt: "2026-01-01T09:00:00.000Z", canAccept: false, acceptHelp: null, required: true },
      { id: "demo-dpa", type: "DPA", scope: "ORGANIZATION", version: "demo", title: "Personuppgiftsbiträdesavtal", content: demoLegalNote, contentHash: "", validFrom: null, acceptedAt: "2026-01-01T09:00:00.000Z", canAccept: false, acceptHelp: null, required: true },
    ] }; break;
    case "/api/ai/policy": if (get) return { policy: aiPolicy, canManage: false }; break;
    case "/api/ai/status": if (get) return { lifecycle: "EXECUTION_LOCKED", available: false, role: ctx.user.role, historyLocation: "WORKFLOW", sharingPolicy: aiPolicy,
      conditions: { provider: { ready: false, configured: false, evaluationApproved: false }, sharingPolicy: { ready: false }, creditLedger: { healthy: true, walletBalanceMatchesLots: true, purchasedBalanceMatchesLots: true, walletBalanceMatchesLedger: true }, availableCredits: { available: false, balance: 0 } } }; break;
    case "/api/ai/conversations": if (get) return { conversations: [] }; break;
    case "/api/profile": if (get) return { name: ctx.user.name, email: ctx.user.email, hasPassword: false, google: false }; break;
    case "/api/suggestions": if (get) return { personal: {}, company: {}, global: {}, builtin: {}, admin: ctx.admin, superadmin: false }; break;
  }
  if (path.startsWith("/api/billing")) throw new DemoError(403, "Krediter och betalning visas inte i demon. Se Priser för Local, Cloud och AI-krediter.");
  throw new DemoError(get ? 404 : 403, DEMO_UNAVAILABLE);
}

/** Answers one /api request from memory. Errors use the same `{ error }` body as the server. */
export async function handleDemoRequest(method: string, url: URL, body: BodyInit | null | undefined): Promise<Response> {
  let parsed: unknown = null;
  if (typeof body === "string" && body) {
    try { parsed = JSON.parse(body); } catch { parsed = null; }
  } else if (body) {
    return Response.json({ error: "Filer och bilder kan inte laddas upp i demon." }, { status: 403 });
  }
  try {
    const result = route({ method: method.toUpperCase(), url, body: parsed });
    // Structured clone so that the UI can never mutate the demo database through a response object.
    return Response.json(JSON.parse(JSON.stringify(result ?? { ok: true })));
  } catch (error) {
    if (error instanceof DemoError) return Response.json({ error: error.message }, { status: error.status });
    if (error instanceof z.ZodError) return Response.json({ error: error.issues[0]?.message ?? "Kontrollera uppgifterna." }, { status: 400 });
    return Response.json({ error: (error as Error).message || "Något gick fel i demon." }, { status: 500 });
  }
}

let installed = false;
/**
 * Routes every same-origin /api request in this tab to the demo backend and blocks direct /api links (reports,
 * files), so a demo visitor never reaches the server's API. Other requests, such as page navigation, pass through.
 */
export function installDemoBackend(onBlockedLink?: () => void) {
  if (installed || typeof window === "undefined") return;
  installed = true;
  const original = window.fetch.bind(window);
  const isApi = (url: URL) => url.origin === window.location.origin && url.pathname.startsWith("/api/");
  window.fetch = (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(input instanceof Request ? input.url : String(input), window.location.href);
    if (!isApi(url)) return original(input, init);
    const method = init?.method ?? (input instanceof Request ? input.method : "GET");
    return handleDemoRequest(method, url, init?.body);
  };
  const blocked = (href: string | null) => { try { return Boolean(href && isApi(new URL(href, window.location.href))); } catch { return false; } };
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
