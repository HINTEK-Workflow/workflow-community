import * as customerCardRoute from "@/app/api/customer-card/route";
import * as formsRoute from "@/app/api/forms/route";
import * as notificationsRoute from "@/app/api/task-notifications/route";
import * as planningRoute from "@/app/api/planned-activities/route";
import * as projectsRoute from "@/app/api/projects/route";
import * as searchRoute from "@/app/api/workflow-search/route";
import * as tasksRoute from "@/app/api/workflow-tasks/route";
import * as timeRoute from "@/app/api/workflow-time/route";
import * as workItemsRoute from "@/app/api/work-items/route";
import * as workspaceRoute from "@/app/api/workspace/route";
import { callRoute, pick, ToolError } from "@/lib/tools/call-route";
import { TOOL_CATALOG, type ToolName } from "@/lib/tools/catalog";

/**
 * The tools behind the API, the MCP server and Workflow's own AI (2026-09-30: one core, no separate
 * implementations). Each tool is small and bounded and runs the ordinary route handler, so tenant isolation, the
 * member's permissions, the legal gate, Cloud write access and every validation are exactly those of the app.
 * The answers are trimmed to what a client needs.
 */
type Input = Record<string, unknown>;
type Runner = (input: Input) => Promise<unknown>;

const q = (value: unknown) => encodeURIComponent(String(value ?? ""));
const TASK_FIELDS = ["id", "kind", "title", "description", "status", "progress", "dueDate", "projectId", "customerId", "facilityId", "assignedToUserId", "assignedToName", "version", "createdAt", "updatedAt", "completedAt", "totalDurationSec"];
const PROJECT_FIELDS = ["id", "name", "description", "startDate", "dueDate", "status", "customerId", "facilityId", "client", "contactPerson", "reference", "workSite", "responsibleUserId", "responsibleName", "timeBudgetMinutes", "closedAt", "archivedAt", "updatedAt"];
const CUSTOMER_FIELDS = ["id", "name", "company", "address", "postalCode", "city", "email", "phone", "mobile", "notes", "version", "deletedAt"];
const ACTIVITY_FIELDS = ["id", "title", "description", "kind", "status", "startsAt", "endsAt", "projectId", "workflowTaskId", "controlId", "assignedToUserId", "assignedToName", "version"];

const emptyWorkOrder = (details: Input = {}) => ({ kind: "WORK_ORDER", details: { executionNotes: "", deviations: "", materials: [], signature: { name: "", confirmed: false, signedAt: null }, closeNotes: "", ...details } });

async function readTask(taskId: string) {
  const result = await callRoute(tasksRoute.GET, "GET", `/api/workflow-tasks?id=${q(taskId)}`);
  const task = (result.tasks as Input[] | undefined)?.[0];
  if (!task) throw new ToolError(404, "Uppgiften hittades inte.");
  return task;
}
function taskView(task: Input) {
  const data = task.data as { kind?: string; details?: Input } | undefined;
  const details = { ...(data?.details ?? {}) };
  delete details.document; // a protocol's copy of its form: large and the same for every protocol of that version
  return {
    ...pick(task, TASK_FIELDS),
    project: task.project ?? null, customer: task.customer ?? null,
    details,
    attachments: ((task.attachments as Input[] | undefined) ?? []).map((item) => pick(item, ["id", "filename", "mimeType", "size", "createdAt"])),
    revisionCount: task.revisionCount ?? null,
    url: `/?view=workflow_task&taskId=${encodeURIComponent(String(task.id))}&taskType=${String(task.kind)}`,
  };
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
      controls: ((result.controls as Input[]) ?? []).map((item) => pick(item, ["id", "number", "title", "status", "project", "performer", "date", "projectId", "customerId"])),
      customers: ((result.customers as Input[]) ?? []).map((item) => pick(item, ["id", "name", "company", "city", "email", "phone"])),
      files: ((result.files as Input[]) ?? []).map((item) => pick(item, ["id", "filename", "ownerTitle", "href"])),
    };
  },
  list_my_work: async ({ filter = "open", query = "", page = 1 }) => callRoute(workItemsRoute.GET, "GET", `/api/work-items?filter=${q(filter)}&q=${q(query)}&page=${q(page)}&limit=24`),
  list_projects: async ({ state = "ongoing", query = "", page = 1 }) => {
    const result = await callRoute(projectsRoute.GET, "GET", `/api/projects?list=${q(state)}&q=${q(query)}&page=${q(page)}`);
    return { total: result.total, page: result.page, pages: result.pages, counts: result.counts, projects: ((result.projects as Input[]) ?? []).map((project) => pick(project, PROJECT_FIELDS)) };
  },
  get_project: async ({ projectId }) => {
    const project = await readProject(String(projectId));
    return {
      ...pick(project, PROJECT_FIELDS), customer: project.customer ?? null,
      tasks: [...((project.workflowTasks as Input[]) ?? []), ...((project.controls as Input[]) ?? []).map((control) => ({ ...control, kind: "COMMISSIONING_CONTROL" }))]
        .map((task) => pick(task, ["id", "kind", "title", "status", "progress", "completion", "dueDate", "assignedToName", "totalDurationSec"])),
      decisionCount: project.decisionCount, eventCount: project.eventCount,
      url: `/?view=project&projectId=${encodeURIComponent(String(project.id))}`,
    };
  },
  get_task: async ({ taskId }) => taskView(await readTask(String(taskId))),
  list_customers: async ({ query = "", limit = 25 }) => {
    const result = await callRoute(workspaceRoute.GET, "GET", `/api/workspace?action=customers&q=${q(query)}&limit=${q(limit)}`);
    return { customers: ((result.customers as Input[]) ?? []).filter((item) => !item.deletedAt).map((item) => ({ ...pick(item, CUSTOMER_FIELDS), facilities: ((item.facilities as Input[]) ?? []).map((facility) => pick(facility, ["id", "name", "city", "isActive"])) })) };
  },
  get_customer: async ({ customerId, page = 1 }) => callRoute(customerCardRoute.GET, "GET", `/api/customer-card?id=${q(customerId)}&page=${q(page)}`),
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
    const result = await callRoute(timeRoute.GET, "GET", "/api/workflow-time");
    const me = result.currentUserId;
    const start = from ? Date.parse(`${from}T00:00:00Z`) : -Infinity;
    const end = to ? Date.parse(`${to}T23:59:59Z`) : Infinity;
    const entries = ((result.tasks as Input[]) ?? []).flatMap((task) => ((task.timeEntries as Input[]) ?? [])
      .filter((entry) => entry.userId === me && Date.parse(String(entry.startedAt)) >= start && Date.parse(String(entry.startedAt)) <= end)
      .map((entry) => ({ ...pick(entry, ["id", "startedAt", "endedAt", "note"]), durationSec: Number(entry.durationSec ?? 0), taskId: task.id, taskTitle: task.title })));
    return { entries: entries.slice(0, 500), totalDurationSec: entries.reduce((sum, entry) => sum + entry.durationSec, 0) };
  },
  list_notifications: async () => callRoute(notificationsRoute.GET, "GET", "/api/task-notifications"),
  list_task_types: async () => {
    const result = await callRoute(formsRoute.GET, "GET", "/api/forms");
    return { taskTypes: [{ id: "WORK_ORDER", name: "Arbetsorder", kind: "WORK_ORDER" }, ...((result.forms as Input[]) ?? []).map((form) => ({ ...pick(form, ["id", "name", "description", "category", "allowInProject", "allowStandalone"]), kind: "FORM" }))] };
  },

  // ---------- create ----------
  create_work_order: async (input) => {
    // The task it follows up is read first: the same permission as opening it, and its real title for the link.
    const from = input.sourceTaskId ? await readTask(String(input.sourceTaskId)) : null;
    const created = await callRoute(tasksRoute.POST, "POST", "/api/workflow-tasks", { action: "save", task: {
      version: 0, kind: "WORK_ORDER", title: input.title, description: input.description ?? "", status: "PLANNED",
      projectId: input.projectId ?? null, customerId: input.customerId ?? null, facilityId: input.facilityId ?? null, siteId: null, departmentId: null,
      assignedToUserId: input.assignedToUserId ?? null, assignedToName: "", dueDate: input.dueDate ?? "",
      data: emptyWorkOrder({ executionNotes: input.executionNotes ?? "", ...(from ? { source: { taskId: String(from.id), title: String(from.title ?? "").slice(0, 200), kind: from.kind } } : {}) }),
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
  create_customer: async (input) => callRoute(workspaceRoute.POST, "POST", "/api/workspace", { action: "customer_save", data: {
    name: input.name, company: input.company ?? "", email: input.email ?? "", phone: input.phone ?? "", mobile: input.mobile ?? "",
    address: input.address ?? "", postalCode: input.postalCode ?? "", city: input.city ?? "", notes: input.notes ?? "",
  } }),
  create_planned_activity: async (input) => callRoute(planningRoute.POST, "POST", "/api/planned-activities", { action: "save", activity: {
    title: input.title, description: input.description ?? "", kind: input.kind ?? "TASK", status: "PLANNED",
    startsAt: input.startsAt, endsAt: input.endsAt, projectId: input.projectId ?? null, workflowTaskId: input.taskId ?? null, controlId: null,
    assignedToUserId: input.assignedToUserId ?? null, assignedToUserIds: input.assignedToUserId ? [input.assignedToUserId] : [], assignedToName: "",
  } }),
  add_project_decision: async (input) => callRoute(projectsRoute.POST, "POST", "/api/projects", { action: "decision", projectId: input.projectId, decision: { decidedOn: input.decidedOn, text: input.text, decidedBy: input.decidedBy } }),
  report_time: async (input) => callRoute(timeRoute.POST, "POST", "/api/workflow-time", { action: "save", entry: { taskId: input.taskId, startedAt: input.startedAt, endedAt: input.endedAt, note: input.note ?? "" }, reason: "" }),

  // ---------- update ----------
  update_task: async (input) => {
    const task = await readTask(String(input.taskId));
    if (task.status === "COMPLETED") throw new ToolError(409, "En slutförd uppgift ändras inte via nyckel. Återöppna den i Workflow först.");
    const data = task.data as { kind: string; details: Input };
    const details = data.kind === "WORK_ORDER" && typeof input.executionNotes === "string" ? { ...data.details, executionNotes: input.executionNotes } : data.details;
    const saved = await callRoute(tasksRoute.POST, "POST", "/api/workflow-tasks", { action: "save", task: {
      id: task.id, version: task.version, kind: task.kind, title: input.title ?? task.title, description: input.description ?? task.description,
      status: input.status ?? task.status, projectId: task.projectId, customerId: task.customerId, facilityId: task.facilityId ?? null,
      siteId: task.siteId ?? null, departmentId: task.departmentId ?? null,
      assignedToUserId: input.assignedToUserId === undefined ? task.assignedToUserId : input.assignedToUserId, assignedToName: task.assignedToName ?? "",
      dueDate: input.dueDate ?? task.dueDate, data: { ...data, details },
    } });
    return { id: saved.id, version: saved.version };
  },
  update_project: async (input) => {
    const project = await readProject(String(input.projectId));
    return callRoute(projectsRoute.POST, "POST", "/api/projects", { action: "save", project: {
      ...pick(project, ["id", "name", "description", "startDate", "dueDate", "client", "contactPerson", "reference", "workSite", "customerId", "facilityId", "responsibleUserId", "responsibleName", "timeBudgetMinutes"]),
      ...Object.fromEntries(["name", "description", "startDate", "dueDate", "reference", "workSite", "responsibleUserId"].filter((key) => input[key] !== undefined).map((key) => [key, input[key]])),
      shiftDays: 0,
    } });
  },
  update_customer: async (input) => {
    const result = await callRoute(workspaceRoute.GET, "GET", `/api/workspace?action=customer&id=${q(input.customerId)}`);
    const current = pick(result, ["name", "company", "address", "postalCode", "city", "email", "phone", "mobile", "notes", "lat", "lng"]) ?? {};
    const changes = Object.fromEntries(["name", "company", "address", "postalCode", "city", "email", "phone", "mobile", "notes"].filter((key) => input[key] !== undefined).map((key) => [key, input[key]]));
    return callRoute(workspaceRoute.POST, "POST", "/api/workspace", { action: "customer_save", id: input.customerId, version: result.version, data: { ...current, ...changes } });
  },

  // ---------- remove (reversible) ----------
  archive_project: async ({ projectId }) => callRoute(projectsRoute.POST, "POST", "/api/projects", { action: "archive", id: projectId }),
  delete_planned_activity: async ({ activityId }) => {
    const result = await callRoute(planningRoute.GET, "GET", "/api/planned-activities");
    const activity = ((result.activities as Input[]) ?? []).find((item) => item.id === activityId && !item.deletedAt);
    if (!activity) throw new ToolError(404, "Planeringen hittades inte.");
    return callRoute(planningRoute.POST, "POST", "/api/planned-activities", { action: "delete", id: activityId, version: activity.version });
  },
};

/** Runs a tool's own input check, then the route. */
export async function runTool(name: ToolName, rawInput: unknown) {
  const definition = TOOL_CATALOG[name];
  const parsed = definition.input.safeParse(rawInput ?? {});
  if (!parsed.success) throw new ToolError(400, parsed.error.issues[0]?.message ?? "Ogiltiga uppgifter till verktyget.");
  return runners[name](parsed.data as Input);
}

