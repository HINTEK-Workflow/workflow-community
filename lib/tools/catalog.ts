import { z } from "zod";

// The tool catalogue (Daniel 2026-09-30): names, descriptions, what kind of change each tool makes, which key scope it
// needs and its input. No database or route code here, so the page, the tests and the MCP listing can use it.

export type ToolEffect = "read" | "create" | "update" | "delete";

const id = z.string().min(1).max(100);
const day = z.iso.date();
const text = (max: number) => z.string().trim().max(max);
const page = z.number().int().min(1).max(1000).optional();

type Definition = {
  title: string;
  description: string;
  effect: ToolEffect;
  /** The API key scope; MCP keys use mcp:read / mcp:write / mcp:delete by effect. */
  apiScope: string;
  input: z.ZodObject;
};

const define = <T extends Record<string, Definition>>(tools: T) => tools;

export const TOOL_CATALOG = define({
  // ---------- read ----------
  search: { title: "Sök i Workflow", effect: "read", apiScope: "tasks:read",
    description: "Sök brett bland projekt, uppgifter, protokoll, kontroller och kunder som användaren får se. Börja här och hämta sedan detaljer med get_task, get_project eller get_customer.",
    input: z.object({ query: z.string().trim().min(2).max(100) }) },
  list_my_work: { title: "Mina uppgifter", effect: "read", apiScope: "tasks:read",
    description: "Lista användarens egna uppgifter och kontroller, sidvis. filter: open, active, planned, action, done eller all.",
    input: z.object({ filter: z.enum(["open", "active", "planned", "action", "done", "all"]).optional(), query: text(100).optional(), page }) },
  list_projects: { title: "Lista projekt", effect: "read", apiScope: "projects:read",
    description: "Lista projekt sidvis efter läge (ongoing, closed, archived), med valfri sökning på namn, beskrivning eller kund.",
    input: z.object({ state: z.enum(["ongoing", "closed", "archived"]).optional(), query: text(100).optional(), page }) },
  get_project: { title: "Hämta projekt", effect: "read", apiScope: "projects:read",
    description: "Hämta ett projekt med ram, status, kund och dess uppgifter.",
    input: z.object({ projectId: id }) },
  get_task: { title: "Hämta uppgift", effect: "read", apiScope: "tasks:read",
    description: "Hämta en uppgift eller ett protokoll med innehåll, status, tid och bilagor (namn).",
    input: z.object({ taskId: id }) },
  list_customers: { title: "Lista kunder", effect: "read", apiScope: "customers:read",
    description: "Sök kunder på namn, företag, e-post eller ort. Returnerar kunder med anläggningar.",
    input: z.object({ query: text(100).optional(), limit: z.number().int().min(1).max(100).optional() }) },
  get_customer: { title: "Hämta kund", effect: "read", apiScope: "customers:read",
    description: "Hämta en kund med anläggningar och kopplat arbete (sidvis).",
    input: z.object({ customerId: id, page }) },
  list_planned_activities: { title: "Lista planering", effect: "read", apiScope: "planning:read",
    description: "Lista planerade aktiviteter, valfritt inom ett datumintervall (ÅÅÅÅ-MM-DD) och för ett projekt.",
    input: z.object({ from: day.optional(), to: day.optional(), projectId: id.optional() }) },
  list_time_entries: { title: "Min rapporterade tid", effect: "read", apiScope: "time:read",
    description: "Lista användarens egna tidposter, valfritt inom ett datumintervall (ÅÅÅÅ-MM-DD).",
    input: z.object({ from: day.optional(), to: day.optional() }) },
  list_notifications: { title: "Notiser", effect: "read", apiScope: "tasks:read",
    description: "Aktuella påminnelser: förfallna och snart förfallande uppgifter, ronder och arbetsordrar att följa upp.",
    input: z.object({}) },
  list_task_types: { title: "Uppgiftstyper", effect: "read", apiScope: "tasks:read",
    description: "Lista de uppgiftstyper och publicerade formulär som företaget kan skapa.",
    input: z.object({}) },

  // ---------- create ----------
  create_work_order: { title: "Skapa arbetsorder", effect: "create", apiScope: "tasks:write",
    description: "Skapa en arbetsorder, valfritt i ett projekt och för en kund. Den skapas som planerad; slutförande och signering görs av en person i Workflow.",
    input: z.object({ title: z.string().trim().min(1).max(200), description: text(5000).optional(), projectId: id.optional(), customerId: id.optional(), facilityId: id.optional(),
      dueDate: day.optional(), assignedToUserId: id.optional(), executionNotes: text(10_000).optional() }) },
  create_project: { title: "Skapa projekt", effect: "create", apiScope: "projects:write",
    description: "Skapa ett projekt med start- och slutdatum (krävs), valfritt för en kund.",
    input: z.object({ name: z.string().trim().min(1).max(160), startDate: day, dueDate: day, description: text(2000).optional(), customerId: id.optional(),
      workSite: text(300).optional(), reference: text(120).optional(), responsibleUserId: id.optional() }) },
  create_customer: { title: "Skapa kund", effect: "create", apiScope: "customers:write",
    description: "Lägg till en kund i kundregistret.",
    input: z.object({ name: z.string().trim().min(1).max(200), company: text(200).optional(), email: text(254).optional(), phone: text(200).optional(), mobile: text(200).optional(),
      address: text(200).optional(), postalCode: text(200).optional(), city: text(200).optional(), notes: text(5000).optional() }) },
  create_planned_activity: { title: "Planera aktivitet", effect: "create", apiScope: "planning:write",
    description: "Planera en aktivitet med start och slut (ISO-tid), valfritt i ett projekt eller för en uppgift och en ansvarig. Planering är inte rapporterad tid.",
    input: z.object({ title: z.string().trim().min(1).max(200), startsAt: z.iso.datetime(), endsAt: z.iso.datetime(), description: text(2000).optional(),
      kind: z.enum(["TASK", "MEETING", "DEADLINE"]).optional(), projectId: id.optional(), taskId: id.optional(), assignedToUserId: id.optional() }) },
  add_project_decision: { title: "Lägg till beslut", effect: "create", apiScope: "projects:write",
    description: "Lägg till ett beslut i projektets beslutslogg (datum, text och vem som beslutade).",
    input: z.object({ projectId: id, decidedOn: day, text: z.string().trim().min(1).max(2000), decidedBy: z.string().trim().min(1).max(160) }) },
  report_time: { title: "Rapportera tid", effect: "create", apiScope: "time:write",
    description: "Rapportera användarens egen tid på en uppgift (start och slut som ISO-tid).",
    input: z.object({ taskId: id, startedAt: z.iso.datetime(), endedAt: z.iso.datetime(), note: text(1000).optional() }) },

  // ---------- update ----------
  update_task: { title: "Ändra uppgift", effect: "update", apiScope: "tasks:write",
    description: "Ändra rubrik, beskrivning, status (inte slutförd), klart senast, ansvarig eller en arbetsorders utförda arbete. Slutförda uppgifter ändras inte.",
    input: z.object({ taskId: id, title: z.string().trim().min(1).max(200).optional(), description: text(5000).optional(),
      status: z.enum(["PLANNED", "IN_PROGRESS", "PAUSED", "NEEDS_ACTION"]).optional(), dueDate: z.union([z.literal(""), day]).optional(),
      assignedToUserId: id.nullable().optional(), executionNotes: text(10_000).optional() }) },
  update_project: { title: "Ändra projekt", effect: "update", apiScope: "projects:write",
    description: "Ändra ett projekts namn, beskrivning, datum, arbetsplats, referens eller ansvarig.",
    input: z.object({ projectId: id, name: z.string().trim().min(1).max(160).optional(), description: text(2000).optional(), startDate: day.optional(), dueDate: day.optional(),
      workSite: text(300).optional(), reference: text(120).optional(), responsibleUserId: id.nullable().optional() }) },
  update_customer: { title: "Ändra kund", effect: "update", apiScope: "customers:write",
    description: "Ändra en kunds kontaktuppgifter.",
    input: z.object({ customerId: id, name: z.string().trim().min(1).max(200).optional(), company: text(200).optional(), email: text(254).optional(), phone: text(200).optional(),
      mobile: text(200).optional(), address: text(200).optional(), postalCode: text(200).optional(), city: text(200).optional(), notes: text(5000).optional() }) },

  // ---------- remove (reversible; permanent deletion is not offered) ----------
  archive_project: { title: "Arkivera projekt", effect: "delete", apiScope: "delete",
    description: "Arkivera ett projekt. Det går att återställa i Workflow.",
    input: z.object({ projectId: id }) },
  delete_planned_activity: { title: "Ta bort planering", effect: "delete", apiScope: "delete",
    description: "Ta bort en planerad aktivitet. Historiken sparas.",
    input: z.object({ activityId: id }) },
});

export type ToolName = keyof typeof TOOL_CATALOG;
export const TOOL_NAMES = Object.keys(TOOL_CATALOG) as ToolName[];
export const MCP_SCOPE_OF: Record<ToolEffect, string> = { read: "mcp:read", create: "mcp:write", update: "mcp:write", delete: "mcp:delete" };

/** Whether a key with these scopes may run the tool. */
export function keyMayRun(kind: "API" | "MCP", scopes: string[], name: ToolName) {
  const tool = TOOL_CATALOG[name];
  return scopes.includes(kind === "MCP" ? MCP_SCOPE_OF[tool.effect] : tool.apiScope);
}

/** The JSON Schema of a tool's input, for MCP tools/list and the API description. */
export function toolInputSchema(name: ToolName) {
  const schema = z.toJSONSchema(TOOL_CATALOG[name].input, { io: "input" }) as Record<string, unknown>;
  delete schema.$schema;
  return schema;
}

export const isToolName = (value: string): value is ToolName => Object.prototype.hasOwnProperty.call(TOOL_CATALOG, value);
