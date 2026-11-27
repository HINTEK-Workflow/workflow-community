import { describeIssue, type IssueLike } from "@/lib/tools/issue-text";
import * as customerCardRoute from "@/app/api/customer-card/route";
import * as documentsRoute from "@/app/api/documents/route";
import { copyTempPlace } from "@/lib/workflow/temp-place";
import { jobObstacle } from "@/lib/workflow/obstacles";
import * as formsRoute from "@/app/api/forms/route";
import * as notificationsRoute from "@/app/api/task-notifications/route";
import * as placesRoute from "@/app/api/places/route";
import * as planningRoute from "@/app/api/planned-activities/route";
import * as projectsRoute from "@/app/api/projects/route";
import * as selfInspectionRoute from "@/app/api/self-inspection/route";
import * as selfInspectionLevelsRoute from "@/app/api/self-inspection/levels/route";
import { effectiveRiskClass, type RiskSubject } from "@/lib/self-inspection/levels";
import { activityLabel, peopleOverview, type SelfInspectionView } from "@/lib/self-inspection/model";
import { limitationsOf, mayDo } from "@/lib/self-inspection/outline";
import * as searchRoute from "@/app/api/workflow-search/route";
import * as tasksRoute from "@/app/api/workflow-tasks/route";
import * as timeRoute from "@/app/api/workflow-time/route";
import * as workItemsRoute from "@/app/api/work-items/route";
import * as workspaceRoute from "@/app/api/workspace/route";
import { callRoute, pick, ToolError } from "@/lib/tools/call-route";
import { keyMayRun, TOOL_CATALOG, type ToolName } from "@/lib/tools/catalog";
import { currentPrincipal } from "@/lib/integrations/principal";
import { withoutMaterialPrices } from "@/lib/workflow/material-prices";
import type { MaterialRow } from "@/lib/workflow/expenses";
import { placePath, type FacilityItem } from "@/lib/workflow/customer-facility";
import { formResultsForReaders } from "@/lib/ai/task-results";
import type { FormDocument, FormValues } from "@/lib/workflow/form-document";
import { emptyPlaceObject, placeObjectOf } from "@/lib/workflow/maintenance";
import * as catalogueRoute from "@/app/api/catalogue/route";
import * as quotesRoute from "@/app/api/quotes/route";
import { context } from "@/lib/kfid/server";
import { aiMay, getAiSharingPolicy } from "@/lib/ai/sharing-policy";
import { teamWorkView, type TeamWorkFilter } from "@/lib/workflow/team-work";
import { swedishDayKey } from "@/lib/swedish-time";
import { appendMaterialRows } from "@/lib/ai/chat-proposals";
import { jobStateFor, linkedDeviationsFor, withJobState } from "@/lib/tools/task-state";
import * as invoiceBasesRoute from "@/app/api/invoice-bases/route";
import { invoiceBasisToolList, invoiceBasisToolView } from "@/lib/tools/invoice-basis-view";
import type { InvoiceBasisSummary, InvoiceBasisView } from "@/lib/invoice-basis/model";
import { knowledgeRunners } from "@/lib/tools/registry-knowledge";
import { marketingRunners } from "@/lib/tools/registry-marketing";

/**
 * The tools behind the API, the MCP server and Workflow's own AI (2026-09-30: one core, no separate
 * implementations). Each tool is small and bounded and runs the ordinary route handler, so tenant isolation, the
 * member's permissions, the legal gate, Cloud write access and every validation are exactly those of the app.
 * The answers are trimmed to what a client needs.
 */
type Input = Record<string, unknown>;
type Runner = (input: Input) => Promise<unknown>;

const q = (value: unknown) => encodeURIComponent(String(value ?? ""));
const TASK_FIELDS = ["id", "kind", "title", "description", "status", "progress", "dueDate", "plannedStartDate", "estimatedMinutes", "stage", "projectId", "customerId", "facilityId", "workOrderId", "assignedToUserId", "assignedToName", "version", "createdAt", "updatedAt", "completedAt", "totalDurationSec"];
const PROJECT_FIELDS = ["id", "name", "description", "startDate", "dueDate", "status", "customerId", "facilityId", "client", "contactPerson", "reference", "workSite", "responsibleUserId", "responsibleName", "timeBudgetMinutes", "closedAt", "archivedAt", "updatedAt"];
// accountingCustomerNumber (plan 1L, 2026-10-11): the customer's number in the company's accounting system (Fortnox).
const CUSTOMER_FIELDS = ["id", "name", "company", "address", "postalCode", "city", "email", "phone", "mobile", "notes", "specialRequirements", "customerType", "accountingCustomerNumber", "ownCompany", "version", "deletedAt"];
const ACTIVITY_FIELDS = ["id", "title", "description", "kind", "status", "startsAt", "endsAt", "projectId", "workflowTaskId", "assignedToUserId", "assignedToName", "version"];

/** The object data a tool was given; fields left out are not touched. */
const placeObjectChanges = (input: Input) => Object.fromEntries(Object.keys(emptyPlaceObject()).filter((key) => input[key] !== undefined).map((key) => [key, input[key]]));
const emptyWorkOrder = (details: Input = {}) => ({ kind: "WORK_ORDER", details: { executionNotes: "", deviations: "", materials: [], signature: { name: "", confirmed: false, signedAt: null }, closeNotes: "", ...details } });

async function readTask(taskId: string) {
  const result = await callRoute(tasksRoute.GET, "GET", `/api/workflow-tasks?id=${q(taskId)}`);
  const task = (result.tasks as Input[] | undefined)?.[0];
  if (!task) throw new ToolError(404, "Uppgiften hittades inte.");
  return task;
}
/** A read task as the tasks route saves it again, unchanged; the caller puts its own `data` on top. */
export function savedTaskShape(task: Input) {
  return {
    id: task.id, version: task.version, kind: task.kind, title: task.title, description: task.description, status: task.status,
    projectId: task.projectId ?? null, customerId: task.customerId ?? null, facilityId: task.facilityId ?? null, workOrderId: task.workOrderId ?? null,
    assignedToUserId: task.assignedToUserId ?? null, assignedToName: task.assignedToName ?? "",
    dueDate: task.dueDate ?? "", data: task.data,
  };
}
/** The whole task as the person may read it (the tools' own view leaves the form document out). */
export const readWholeTask = (taskId: string) => readTask(taskId);
function taskView(task: Input) {
  const data = task.data as { kind?: string; details?: Input } | undefined;
  const details = { ...(data?.details ?? {}) };
  // A protocol's results as a reader sees them (2026-10-05): the raw values are keyed by the form's internal
  // ids, so labels, units, the rules' judgement and what is missing go along – the same material as the reviewer's.
  let results: unknown = undefined;
  if (data?.kind === "FORM" && details.document && details.values) {
    try { results = formResultsForReaders(details.document as FormDocument, details.values as FormValues); } catch { results = undefined; }
  }
  delete details.document; // a protocol's copy of its form: large and the same for every protocol of that version
  return {
    ...pick(task, TASK_FIELDS),
    // Rapportera hinder (plan 1M): what the job waits for, or null.
    obstacle: jobObstacle({ status: String(task.status), data: task.data, updatedAt: task.updatedAt as string | undefined }),
    project: task.project ?? null, customer: task.customer ?? null,
    details,
    ...(results ? { results } : {}),
    attachments: ((task.attachments as Input[] | undefined) ?? []).map((item) => pick(item, ["id", "filename", "mimeType", "size", "createdAt"])),
    revisionCount: task.revisionCount ?? null,
    url: `/?view=workflow_task&taskId=${encodeURIComponent(String(task.id))}&taskType=${String(task.kind)}`,
  };
}
/**
 * Purchase prices and markup on a work order's material rows (2026-10-09) follow the member's price right in the
 * route, and also the key's own scope (Fas 2, 2026-10-11): a key that cannot read quotes gets the rows without prices
 * even when the member it acts for may see them.
 */
function withKeyPriceScope<T extends object>(view: T): T {
  const principal = currentPrincipal();
  const details = (view as { details?: { materials?: unknown } }).details;
  if (!principal || keyMayRun(principal.kind, principal.scopes, "get_quote") || !details || !Array.isArray(details.materials)) return view;
  return { ...view, details: { ...details, materials: withoutMaterialPrices(details.materials as MaterialRow[]) } };
}
async function readProject(projectId: string) {
  const result = await callRoute(projectsRoute.GET, "GET", `/api/projects?id=${q(projectId)}`);
  const project = (result.projects as Input[] | undefined)?.[0];
  if (!project) throw new ToolError(404, "Projektet hittades inte.");
  return project;
}

const runners: Record<ToolName, Runner> = {
  // ---------- read ----------
  search: async ({ query }) => {
    const result = await callRoute(searchRoute.GET, "GET", `/api/workflow-search?q=${q(query)}`);
    return {
      projects: ((result.projects as Input[]) ?? []).map((item) => pick(item, ["id", "name", "status", "dueDate", "customerId"])),
      tasks: ((result.tasks as Input[]) ?? []).map((item) => pick(item, ["id", "title", "kind", "status", "projectId", "assignedToName"])),
      customers: ((result.customers as Input[]) ?? []).map((item) => pick(item, ["id", "name", "company", "city", "email", "phone"])),
      files: ((result.files as Input[]) ?? []).map((item) => pick(item, ["id", "filename", "ownerTitle", "href"])),
    };
  },
  // scope all (2026-11-21): the list Alla – what the person may read in Workflow's lists, checked by the route as there.
  list_my_work: async ({ filter = "open", query = "", page = 1, scope = "mine" }) => callRoute(workItemsRoute.GET, "GET", `/api/work-items?filter=${q(filter)}&q=${q(query)}&page=${q(page)}&limit=24${scope === "all" ? "&scope=all" : ""}`),
  list_projects: async ({ state = "ongoing", query = "", page = 1 }) => {
    const result = await callRoute(projectsRoute.GET, "GET", `/api/projects?list=${q(state)}&q=${q(query)}&page=${q(page)}`);
    return { total: result.total, page: result.page, pages: result.pages, counts: result.counts, projects: ((result.projects as Input[]) ?? []).map((project) => pick(project, PROJECT_FIELDS)) };
  },
  get_project: async ({ projectId }) => {
    const project = await readProject(String(projectId));
    return {
      ...pick(project, PROJECT_FIELDS), customer: project.customer ?? null,
      tasks: ((project.workflowTasks as Input[]) ?? []).map((task) => pick(task, ["id", "kind", "title", "status", "progress", "dueDate", "assignedToName", "totalDurationSec"])),
      decisionCount: project.decisionCount, eventCount: project.eventCount,
      url: `/?view=project&projectId=${encodeURIComponent(String(project.id))}`,
    };
  },
  // Jobbets läge (AI-planen steg 3, 2026-10-09): the risk step, what stops Starta tid and Färdigställ, the next step, bookings, Utgår, schedule.
  // Avvikelselänken (plan 1J, 2026-10-11): a work order's linked deviation-log entries, only for a reader who may read them.
  get_task: async ({ taskId }) => {
    const task = await readTask(String(taskId));
    const [state, linkedDeviations] = await Promise.all([jobStateFor(task), linkedDeviationsFor(task)]);
    return { ...withKeyPriceScope(withJobState(taskView(task), state)), ...(linkedDeviations ? { linkedDeviations } : {}) };
  },
  list_customers: async ({ query = "", limit = 25 }) => {
    const result = await callRoute(workspaceRoute.GET, "GET", `/api/workspace?action=customers&active=1&q=${q(query)}&limit=${q(limit)}`);
    // Places with their whole way (2026-10-04); the key stays "facilities" for existing clients.
    return { customers: ((result.customers as Input[]) ?? []).filter((item) => !item.deletedAt).map((item) => {
      const places = ((item.facilities as FacilityItem[]) ?? []);
      return { ...pick(item, CUSTOMER_FIELDS), facilities: places.map((facility) => ({ ...pick(facility as unknown as Input, ["id", "name", "kind", "parentId", "city", "isActive", "objectType", "operatingState"]), path: placePath(places, facility.id) })) };
    }) };
  },
  get_customer: async ({ customerId, page = 1 }) => callRoute(customerCardRoute.GET, "GET", `/api/customer-card?id=${q(customerId)}&page=${q(page)}`),
  // Dokument (0.87.0): the route's own list in the person's session (the customers right, the company, Cloud), trimmed to the names:
  // no link to the bytes and nothing of the contents.
  list_documents: async ({ customerId, placeId, query = "", limit = 50 }) => {
    const search = new URLSearchParams({ q: String(query), limit: String(limit), sort: "newest" });
    if (customerId) search.set("customerId", String(customerId));
    if (placeId) search.set("placeId", String(placeId));
    const result = await callRoute(documentsRoute.GET, "GET", `/api/documents?${search}`);
    return {
      documents: ((result.items as Input[]) ?? []).map((item) => ({ ...pick(item, ["id", "name", "customerId", "customerName", "placeId", "placeName", "mimeType"]), status: item.scanLabel, uploadedAt: String(item.createdAt ?? "").slice(0, 10) })),
      total: result.total,
    };
  },
  list_planned_activities: async ({ from, to, projectId }) => {
    const window = [from ? `from=${q(from)}` : "", to ? `to=${q(to)}` : ""].filter(Boolean).join("&");
    const result = await callRoute(planningRoute.GET, "GET", `/api/planned-activities${window ? `?${window}` : ""}`);
    const start = from ? Date.parse(`${from}T00:00:00Z`) : -Infinity;
    const end = to ? Date.parse(`${to}T23:59:59Z`) : Infinity;
    const activities = ((result.activities as Input[]) ?? []).filter((item) => !item.deletedAt && (!projectId || item.projectId === projectId)
      && Date.parse(String(item.endsAt)) >= start && Date.parse(String(item.startsAt)) <= end);
    return { activities: activities.slice(0, 200).map((item) => pick(item, ACTIVITY_FIELDS)), total: activities.length };
  },
  list_time_entries: async ({ from, to }) => {
    // The route reads own time from a date (default the last 90 days); the tool asks from its own start date.
    const result = await callRoute(timeRoute.GET, "GET", `/api/workflow-time${from ? `?ownFrom=${q(from)}` : ""}`);
    const me = result.currentUserId;
    const start = from ? Date.parse(`${from}T00:00:00Z`) : -Infinity;
    const end = to ? Date.parse(`${to}T23:59:59Z`) : Infinity;
    const entries = ((result.tasks as Input[]) ?? []).flatMap((task) => ((task.timeEntries as Input[]) ?? [])
      .filter((entry) => entry.userId === me && Date.parse(String(entry.startedAt)) >= start && Date.parse(String(entry.startedAt)) <= end)
      .map((entry) => ({ ...pick(entry, ["id", "startedAt", "endedAt", "note", "timeTypeId"]), durationSec: Number(entry.durationSec ?? 0), taskId: task.id, taskTitle: task.title })));
    // The company's active time types (2026-10-30), for report_time's timeTypeId; the standard type is marked.
    const timeTypes = ((result.timeTypes as Input[]) ?? []).filter((type) => type.active).map((type) => pick(type, ["id", "name", "isDefault"]));
    return { entries: entries.slice(0, 500), totalDurationSec: entries.reduce((sum, entry) => sum + entry.durationSec, 0), timeTypes };
  },
  list_notifications: async () => callRoute(notificationsRoute.GET, "GET", "/api/task-notifications"),
  // Egenkontroll (2026-10-06): the current approved version only; the draft and approving stay in Workflow.
  get_self_inspection_program: async () => {
    const view = await callRoute(selfInspectionRoute.GET, "GET", "/api/self-inspection") as unknown as SelfInspectionView;
    const current = view.current;
    return {
      program: current ? {
        title: current.content.title, version: current.number, approvedAt: current.approvedAt, approvedBy: current.approvedByName, changeReason: current.changeReason,
        activityTypes: current.content.activityTypes.map(activityLabel), worksOnOthersInstallations: current.content.worksOnOthersInstallations,
        sections: current.content.sections.map((section) => ({ title: section.title, legalRef: section.legalRef, text: section.body })),
        roles: current.content.roles.map((role) => ({ name: role.name, isEre: role.isEre, level: role.level ?? null, description: role.description, people: role.members.map((member) => ({ name: member.name, authorizationLevel: member.authorizationLevel || null })) })),
        // Who may do what (2026-10-06), as the version froze it, with the person's level (1–3, 2026-10-07); the assessments stay in Workflow.
        people: peopleOverview(current.content).map((person) => ({ name: person.name, roles: person.roles, level: person.level || null, mayDo: mayDo(person), limitations: limitationsOf(person) })),
      } : null,
      readByMe: view.myConfirmation,
      review: view.canEdit ? view.review : undefined,
      url: "/?view=self_inspection",
    };
  },
  list_task_types: async () => {
    const [result, levels] = await Promise.all([callRoute(formsRoute.GET, "GET", "/api/forms"), callRoute(selfInspectionLevelsRoute.GET, "GET", "/api/self-inspection/levels")]);
    // The risk class of every type (2026-10-07): the company's own, else Workflow's proposal. A person cannot be assigned, start, fill in,
    // complete or sign a task above their level; the routes the tools run enforce it.
    const classes = (levels.riskClasses ?? {}) as Record<string, number>;
    const risk = (subject: RiskSubject) => { const found = effectiveRiskClass(subject, classes); return found ? { riskClass: found.value, riskClassIsProposal: found.suggested } : {}; };
    return { taskTypes: [{ id: "WORK_ORDER", name: "Arbetsorder", kind: "WORK_ORDER", ...risk({ kind: "WORK_ORDER" }) },
      ...((result.forms as Input[]) ?? []).map((form) => ({ ...pick(form, ["id", "name", "description", "category", "allowInProject", "allowStandalone"]), kind: "FORM",
        ...risk({ kind: "FORM", formId: String(form.baseId ?? form.id), category: String(form.category ?? "") }) }))] };
  },

  // Lagöversikt (AI-beslut 3, 2026-10-09): the list Alla in the person's own session – its read permission per kind –
  // sorted into late, due soon, needs action and waiting. The company admin's switch is checked here, so the chat, the
  // API and MCP are refused alike when it is off.
  list_team_work: async ({ filter = "open", query = "" }) => {
    const ctx = await context();
    if (!aiMay(await getAiSharingPolicy(ctx.organizationId), "teamOverview")) throw new ToolError(403, "Lagöversikten är avstängd av företagets admin (Inställningar → Arbetssätt → Workflow AI).");
    const result = await callRoute(workItemsRoute.GET, "GET", `/api/work-items?filter=open&scope=all&sort=due&limit=48&q=${q(query)}`);
    const items = (result.items as Input[] | undefined) ?? [];
    return teamWorkView(items, filter as TeamWorkFilter, swedishDayKey(new Date()), Number(result.total ?? 0) > items.length);
  },

  // ---------- create ----------
  create_work_order: async (input) => {
    // The task it follows up is read first: the same permission as opening it, and its real title for the link.
    const from = input.sourceTaskId ? await readTask(String(input.sourceTaskId)) : null;
    // An order that already waits for something starts as Pausad (Underhåll, 2026-10-06).
    const waiting = Boolean(input.waitingOn);
    const created = await callRoute(tasksRoute.POST, "POST", "/api/workflow-tasks", { action: "save", task: {
      version: 0, kind: "WORK_ORDER", title: input.title, description: input.description ?? "", status: waiting ? "PAUSED" : "PLANNED",
      projectId: input.projectId ?? null, customerId: input.customerId ?? null, facilityId: input.facilityId ?? null,
      assignedToUserId: input.assignedToUserId ?? null, assignedToName: "", dueDate: input.dueDate ?? "",
      // Start på alla jobb (plan 1M): left out = today; Etapp groups the project's jobs.
      ...(input.plannedStartDate !== undefined ? { plannedStartDate: input.plannedStartDate } : {}), ...(input.stage !== undefined ? { stage: input.stage } : {}),
      // A follow-up keeps the source's temporary place, like the follow-ups made in the editor (2026-10-08).
      data: copyTempPlace(emptyWorkOrder({ executionNotes: input.executionNotes ?? "", ...(from ? { source: { taskId: String(from.id), title: String(from.title ?? "").slice(0, 200), kind: from.kind } } : {}),
        ...(waiting ? { waitingOn: input.waitingOn } : {}) }), from?.data),
    } });
    return { id: created.id, version: created.version, url: `/?view=workflow_task&taskId=${encodeURIComponent(String(created.id))}&taskType=WORK_ORDER` };
  },
  create_project: async (input) => {
    const created = await callRoute(projectsRoute.POST, "POST", "/api/projects", { action: "save", project: {
      name: input.name, description: input.description ?? "", startDate: input.startDate, dueDate: input.dueDate,
      customerId: input.customerId ?? null, workSite: input.workSite ?? "", reference: input.reference ?? "",
      responsibleUserId: input.responsibleUserId ?? null,
    } });
    return { id: created.id, url: `/?view=project&projectId=${encodeURIComponent(String(created.id))}` };
  },
  create_place: async (input) => callRoute(customerCardRoute.POST, "POST", "/api/customer-card", { action: "facility_save", customerId: input.customerId, facility: {
    name: input.name, kind: input.kind ?? (input.parentId ? "OBJECT" : "FACILITY"), parentId: input.parentId ?? null,
    address: input.address ?? "", postalCode: input.postalCode ?? "", city: input.city ?? "", description: input.description ?? "",
    latitude: input.latitude ?? null, longitude: input.longitude ?? null,
    ...emptyPlaceObject(), ...placeObjectChanges(input),
  } }),
  create_customer: async (input) => callRoute(workspaceRoute.POST, "POST", "/api/workspace", { action: "customer_save", data: {
    name: input.name, company: input.company ?? "", email: input.email ?? "", phone: input.phone ?? "", mobile: input.mobile ?? "",
    address: input.address ?? "", postalCode: input.postalCode ?? "", city: input.city ?? "", notes: input.notes ?? "",
    ...(input.customerType ? { customerType: input.customerType } : {}),
    ...(input.accountingCustomerNumber !== undefined ? { accountingCustomerNumber: input.accountingCustomerNumber } : {}),
  } }),
  create_planned_activity: async (input) => callRoute(planningRoute.POST, "POST", "/api/planned-activities", { action: "save", activity: {
    title: input.title, description: input.description ?? "", kind: input.kind ?? "TASK", status: "PLANNED",
    startsAt: input.startsAt, endsAt: input.endsAt, projectId: input.projectId ?? null, workflowTaskId: input.taskId ?? null,
    assignedToUserId: input.assignedToUserId ?? null, assignedToUserIds: input.assignedToUserId ? [input.assignedToUserId] : [], assignedToName: "",
  } }),
  add_project_decision: async (input) => callRoute(projectsRoute.POST, "POST", "/api/projects", { action: "decision", projectId: input.projectId, decision: { decidedOn: input.decidedOn, text: input.text, decidedBy: input.decidedBy } }),
  // A task's time lands on its work order; the route says where (owner).
  report_time: async (input) => callRoute(timeRoute.POST, "POST", "/api/workflow-time", { action: "save", entry: {
    ...(input.projectId ? { projectId: input.projectId } : { taskId: input.workOrderId ?? input.taskId }), startedAt: input.startedAt, endedAt: input.endedAt, note: input.note ?? "",
    // Tidstyp (2026-10-30): the route checks it is an active type of the company; left out = the standard type.
    ...(input.timeTypeId ? { timeTypeId: input.timeTypeId } : {}) }, reason: "" }),
  // Materialrader (AI-beslut 1, 2026-10-09): appended to the work order's own rows through its ordinary save, so the
  // work order permission, the version and the price rules (a picked article is priced by the server) are the app's.
  add_material_rows: async (input) => {
    const task = await readTask(String(input.taskId));
    if (task.kind !== "WORK_ORDER") throw new ToolError(409, "Materialrader finns bara på arbetsordrar.");
    if (task.status === "COMPLETED" || task.status === "CANCELLED") throw new ToolError(409, "En slutförd eller utgången arbetsorder ändras inte via nyckel.");
    const data = task.data as { kind: string; details: Input };
    const added = appendMaterialRows((data.details.materials as Input[] | undefined) ?? [], input.rows as { name: string; quantity: string; unit: string }[]);
    const saved = await callRoute(tasksRoute.POST, "POST", "/api/workflow-tasks", { action: "save", task: { ...savedTaskShape(task), data: { ...data, details: { ...data.details, materials: added.materials } } } });
    return { id: saved.id, version: saved.version, rowIds: added.rowIds };
  },

  // ---------- update ----------
  update_task: async (input) => {
    const task = await readTask(String(input.taskId));
    if (task.status === "COMPLETED") throw new ToolError(409, "En slutförd uppgift ändras inte via nyckel. Återöppna den i Workflow först.");
    if (task.status === "CANCELLED") throw new ToolError(409, "Jobbet har utgått och ändras inte via nyckel. Återuppta det i Workflow först.");
    const data = task.data as { kind: string; details: Input };
    let details = data.kind === "WORK_ORDER" && typeof input.executionNotes === "string" ? { ...data.details, executionNotes: input.executionNotes } : data.details;
    // What the paused order waits for (Underhåll); left out keeps it.
    if (data.kind === "WORK_ORDER" && typeof input.waitingOn === "string") details = { ...details, waitingOn: input.waitingOn };
    const saved = await callRoute(tasksRoute.POST, "POST", "/api/workflow-tasks", { action: "save", task: {
      id: task.id, version: task.version, kind: task.kind, title: input.title ?? task.title, description: input.description ?? task.description,
      // A waiting reason without a status pauses the order; the route drops the reason for any other status.
      status: input.status ?? (input.waitingOn && data.kind === "WORK_ORDER" ? "PAUSED" : task.status), projectId: task.projectId, customerId: task.customerId, facilityId: task.facilityId ?? null,
      // Arbetsordern styr (2026-10-26): moved to another order; left out keeps it. A task is never let go; the route checks the rules.
      workOrderId: input.workOrderId === undefined ? task.workOrderId ?? null : input.workOrderId,
      assignedToUserId: input.assignedToUserId === undefined ? task.assignedToUserId : input.assignedToUserId, assignedToName: task.assignedToName ?? "",
      dueDate: input.dueDate ?? task.dueDate, data: { ...data, details },
      // Tidplan (steg 2): left out keeps what the task has; the route checks Start against Klart senast and the frame.
      ...(input.plannedStartDate !== undefined ? { plannedStartDate: input.plannedStartDate } : {}),
      ...(input.estimatedMinutes !== undefined ? { estimatedMinutes: input.estimatedMinutes } : {}),
      ...(input.stage !== undefined ? { stage: input.stage } : {}),
    } });
    return { id: saved.id, version: saved.version };
  },
  // Utgår och Återuppta (2026-10-09): the tasks route's own actions, so the permission (redigera jobbet), the tenant,
  // the project lock, the rules of lib/workflow/task-cancel.ts and the stopped time are exactly the buttons' in Workflow.
  cancel_task: async ({ taskId, reason }) => {
    const result = await callRoute(tasksRoute.POST, "POST", "/api/workflow-tasks", { action: "cancel", id: taskId, reason });
    return { id: taskId, status: result.status, stoppedTimers: Array.isArray(result.stopped) ? result.stopped.length : 0 };
  },
  // Rapportera hinder (plan 1M, 2026-10-11): the tasks route's own actions – the same permission (redigera jobbet), tenant,
  // project lock and notices as the buttons in Workflow.
  report_obstacle: async ({ taskId, reason, text }) => {
    const result = await callRoute(tasksRoute.POST, "POST", "/api/workflow-tasks", { action: "obstacle", id: taskId, obstacle: { reason, text: text ?? "" } });
    return { id: taskId, version: result.version, status: result.status };
  },
  resolve_obstacle: async ({ taskId }) => {
    const result = await callRoute(tasksRoute.POST, "POST", "/api/workflow-tasks", { action: "resolve_obstacle", id: taskId });
    return { id: taskId, version: result.version, status: result.status };
  },
  restore_task: async ({ taskId }) => {
    const result = await callRoute(tasksRoute.POST, "POST", "/api/workflow-tasks", { action: "restore", id: taskId });
    return { id: taskId, status: result.status };
  },
  update_project: async (input) => {
    const project = await readProject(String(input.projectId));
    return callRoute(projectsRoute.POST, "POST", "/api/projects", { action: "save", project: {
      ...pick(project, ["id", "name", "description", "startDate", "dueDate", "client", "contactPerson", "reference", "workSite", "customerId", "facilityId", "responsibleUserId", "responsibleName", "timeBudgetMinutes"]),
      ...Object.fromEntries(["name", "description", "startDate", "dueDate", "reference", "workSite", "responsibleUserId"].filter((key) => input[key] !== undefined).map((key) => [key, input[key]])),
      shiftDays: 0,
    } });
  },
  // Underhåll stage 2 (2026-10-06): a place's name, marking and object data, through the customer card's own save with
  // the place's version, so the customers permission, the tree and the tenant are checked exactly as in the app.
  update_place: async (input) => {
    const view = await callRoute(placesRoute.GET, "GET", `/api/places?id=${q(input.placeId)}`);
    const place = view.place as Input & { ownAddress?: Input };
    if (!place?.id) throw new ToolError(404, "Platsen hittades inte.");
    const facility = {
      name: input.name ?? place.name, kind: place.kind, parentId: place.parentId ?? null,
      address: place.ownAddress?.address ?? "", postalCode: place.ownAddress?.postalCode ?? "", city: place.ownAddress?.city ?? "",
      description: input.description ?? place.description ?? "", latitude: place.latitude ?? null, longitude: place.longitude ?? null,
      ...placeObjectOf(place), ...placeObjectChanges(input),
    };
    await callRoute(customerCardRoute.POST, "POST", "/api/customer-card", { action: "facility_save", customerId: place.customerId, id: place.id, version: place.version, facility });
    return { id: place.id, url: `/?view=place&placeId=${encodeURIComponent(String(place.id))}` };
  },
  update_customer: async (input) => {
    const result = await callRoute(workspaceRoute.GET, "GET", `/api/workspace?action=customer&id=${q(input.customerId)}`);
    const current = pick(result, ["name", "company", "address", "postalCode", "city", "email", "phone", "mobile", "notes", "lat", "lng", "accountingCustomerNumber"]) ?? {};
    const changes = Object.fromEntries(["name", "company", "address", "postalCode", "city", "email", "phone", "mobile", "notes", "customerType", "accountingCustomerNumber"].filter((key) => input[key] !== undefined).map((key) => [key, input[key]]));
    return callRoute(workspaceRoute.POST, "POST", "/api/workspace", { action: "customer_save", id: input.customerId, version: result.version, data: { ...current, ...changes } });
  },

  // ---------- remove (reversible) ----------
  archive_project: async ({ projectId }) => callRoute(projectsRoute.POST, "POST", "/api/projects", { action: "archive", id: projectId }),
  delete_planned_activity: async ({ activityId }) => {
    const result = await callRoute(planningRoute.GET, "GET", `/api/planned-activities?id=${q(activityId)}`);
    const activity = ((result.activities as Input[]) ?? []).find((item) => item.id === activityId && !item.deletedAt);
    if (!activity) throw new ToolError(404, "Planeringen hittades inte.");
    return callRoute(planningRoute.POST, "POST", "/api/planned-activities", { action: "delete", id: activityId, version: activity.version });
  },

  // ---------- Artiklar och priser (read, 2026-10-08) ----------
  // The catalogue route's own read check (catalogue:read, Cloud only) and company scope; the answers are bounded there.
  search_articles: async ({ query, supplier, limit }) => callRoute(catalogueRoute.GET, "GET", `/api/catalogue?articles=${q(query)}${supplier ? `&supplier=${q(supplier)}` : ""}${limit ? `&limit=${q(limit)}` : ""}`),
  get_article_price_history: async ({ articleId, limit }) => callRoute(catalogueRoute.GET, "GET", `/api/catalogue?history=${q(articleId)}${limit ? `&limit=${q(limit)}` : ""}`),

  // ---------- Offerter (read, 2026-10-09) ----------
  // The quotes route's own check (Offerter – läsa, Cloud only) and company scope; the list is 20 per page.
  list_quotes: async ({ query, status, page = 1 }) => callRoute(quotesRoute.GET, "GET", `/api/quotes?filter=${q(status ?? "open")}&page=${q(page)}${query ? `&q=${q(query)}` : ""}`),
  get_quote: async ({ quoteId }) => callRoute(quotesRoute.GET, "GET", `/api/quotes?id=${q(quoteId)}`),

  // ---------- Fakturaunderlag (plan 1J, 2026-10-11: läsa och skapa utkast) ----------
  // The invoice-bases route's own checks (Cloud, Offerter – läsa / redigera, the job's or project's read right) and
  // company scope; the answers are rebuilt field by field without purchase prices (lib/tools/invoice-basis-view.ts).
  list_invoice_bases: async (input) => invoiceBasisToolList(await callRoute(invoiceBasesRoute.GET, "GET", `/api/invoice-bases?${invoiceRef(input)}`) as unknown as InvoiceBasisSummary),
  get_invoice_basis: async ({ basisId }) => ({ basis: invoiceBasisToolView((await callRoute(invoiceBasesRoute.GET, "GET", `/api/invoice-bases?id=${q(basisId)}`)).basis as InvoiceBasisView) }),
  propose_invoice_basis: async (input) => ({ basis: invoiceBasisToolView(await invoiceProposal(input)) }),
  create_invoice_basis: async (input) => {
    // The proposal is built again: the draft is made only from what the person's proposal showed (the route's 409 says
    // when the work changed meanwhile or someone else took the same sources), with the proposal's own lines and prices.
    const proposal = await invoiceProposal(input);
    if (proposal.proposal !== input.proposal) throw new ToolError(409, "Det som kan faktureras har ändrats sedan förslaget. Hämta ett nytt förslag med propose_invoice_basis.");
    const basis = { title: input.title ?? proposal.title, note: input.note ?? "", vatPercent: String(proposal.vatPercent), lines: proposal.lines.map((line) => ({ id: line.id, kind: line.kind, name: line.name, quantity: line.quantity, unit: line.unit, unitPrice: line.unitPrice, markupPercent: line.markupPercent })) };
    const created = await callRoute(invoiceBasesRoute.POST, "POST", "/api/invoice-bases", { action: "create", ...(input.taskId ? { taskId: input.taskId } : { projectId: input.projectId }), proposal: input.proposal, basis });
    const url = input.taskId ? `/?view=workflow_task&taskId=${encodeURIComponent(String(input.taskId))}&taskType=WORK_ORDER` : `/?view=project&projectId=${encodeURIComponent(String(input.projectId))}`;
    return { id: created.id, label: created.label, status: "DRAFT", url };
  },

  // ---------- Hjälpen och läsverktygen för fakturering, underhåll och maskinlarm (2026-11-21, lib/tools/registry-knowledge.ts) ----------
  ...knowledgeRunners,

  // ---------- Inlägg, versionsnyheter och besöksstatistik för externa system (2026-11-25, lib/tools/registry-marketing.ts) ----------
  ...marketingRunners,
};

/** The job or the project a fakturaunderlag tool asks about, as the route's query. */
function invoiceRef(input: Input) {
  if (input.taskId) return `taskId=${q(input.taskId)}`;
  if (input.projectId) return `projectId=${q(input.projectId)}`;
  throw new ToolError(400, "Ange ett jobb (taskId) eller ett projekt (projectId).");
}
const invoiceProposal = async (input: Input) => (await callRoute(invoiceBasesRoute.GET, "GET", `/api/invoice-bases?${invoiceRef(input)}&proposal=1`)).basis as InvoiceBasisView;

/** Runs a tool's own input check, then the route. */
export async function runTool(name: ToolName, rawInput: unknown) {
  const definition = TOOL_CATALOG[name];
  const parsed = definition.input.safeParse(rawInput ?? {});
  if (!parsed.success) throw new ToolError(400, describeIssue(parsed.error.issues[0] as IssueLike));
  return runners[name](parsed.data as Input);
}

