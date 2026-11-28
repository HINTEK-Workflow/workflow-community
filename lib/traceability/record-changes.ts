import { JOB_STATUS_LABELS } from "@/lib/workflow/job-state";
import { DEVIATION_CATEGORIES, DEVIATION_KINDS, DEVIATION_STATUSES } from "@/lib/self-inspection/model";
import { DEVIATION_SEVERITIES, DEVIATION_TYPES } from "@/lib/self-inspection/incidents";
import { INTERVAL_MODE_LABELS, PLAN_UNIT_LABELS } from "@/lib/maintenance/plan-model";
import { PART_STATUS_LABELS } from "@/lib/maintenance/model";

/**
 * Ändringshistorik (K3.2, 2026-11-27): who changed what on a work order or protocol, a deviation, a maintenance plan or
 * a machine, when, and from what to what. The server's write paths take the record before and after the change and keep the
 * fields that differ (diffRecord) in the same transaction (lib/traceability/record-changes-server.ts); the record's page shows
 * them in Ändringshistorik. Pure, so the page, the server and the tests read the same rules.
 *
 * Privacy first: a value is a short text, a day, a fixed choice or an id. People, customers, places and records are stored as
 * ids and named when read – a person who is erased is "Borttagen användare" everywhere at once. Free text that may hold
 * personal data about an incident (a deviation's title, description, action and investigation) and a protocol's content are
 * recorded as changed, never with the text; the content is in the record's own version history.
 */
export const CHANGE_ENTITY_TYPES = ["TASK", "DEVIATION", "MAINTENANCE_PLAN", "MACHINE"] as const;
export type ChangeEntityType = (typeof CHANGE_ENTITY_TYPES)[number];
export const isChangeEntityType = (value: unknown): value is ChangeEntityType => CHANGE_ENTITY_TYPES.includes(value as ChangeEntityType);

export const CHANGE_ACTIONS = { CREATED: "Skapades", UPDATED: "Ändrades", DELETED: "Togs bort" } as const;
export type ChangeAction = keyof typeof CHANGE_ACTIONS;

/** How a value is stored and named. `hidden`: only that it changed. */
export type ChangeValueKind = "text" | "longText" | "date" | "enum" | "bool" | "number" | "minutes" | "hours" | "list" | "hidden"
  | "user" | "person" | "customer" | "facility" | "project" | "task" | "machinePart" | "place" | "round";
export type ChangeField = { label: string; kind: ChangeValueKind; labels?: Readonly<Record<string, string>> };

const ACTIVE = { true: "Aktiv", false: "Pausad" } as const;

export const CHANGE_FIELDS: Record<ChangeEntityType, Readonly<Record<string, ChangeField>>> = {
  TASK: {
    title: { label: "Rubrik", kind: "text" },
    description: { label: "Beskrivning", kind: "longText" },
    status: { label: "Status", kind: "enum", labels: JOB_STATUS_LABELS },
    assignee: { label: "Ansvarig", kind: "person" },
    plannedStartDate: { label: "Start", kind: "date" },
    dueDate: { label: "Klart senast", kind: "date" },
    estimatedMinutes: { label: "Uppskattad tid", kind: "minutes" },
    stage: { label: "Etapp", kind: "text" },
    customerId: { label: "Kund", kind: "customer" },
    facilityId: { label: "Plats", kind: "facility" },
    projectId: { label: "Projekt", kind: "project" },
    workOrderId: { label: "Arbetsorder", kind: "task" },
    machinePartId: { label: "Maskin", kind: "machinePart" },
    cancelReason: { label: "Skäl till Utgår", kind: "text" },
    content: { label: "Innehållet", kind: "hidden" },
  },
  DEVIATION: {
    kind: { label: "Sort", kind: "enum", labels: DEVIATION_KINDS },
    type: { label: "Typ", kind: "enum", labels: DEVIATION_TYPES },
    status: { label: "Status", kind: "enum", labels: DEVIATION_STATUSES },
    severity: { label: "Allvarlighetsgrad", kind: "enum", labels: DEVIATION_SEVERITIES },
    category: { label: "Klass", kind: "enum", labels: DEVIATION_CATEGORIES },
    systematic: { label: "Kan vara ett systematiskt fel", kind: "bool" },
    responsibleUserId: { label: "Ansvarig", kind: "user" },
    dueDate: { label: "Klart senast", kind: "date" },
    workOrderId: { label: "Arbetsorder", kind: "task" },
    reportedToAuthority: { label: "Anmäld till myndigheten", kind: "bool" },
    retentionHold: { label: "Sparas tills vidare", kind: "bool" },
    title: { label: "Rubrik", kind: "hidden" },
    description: { label: "Beskrivning", kind: "hidden" },
    action: { label: "Åtgärd", kind: "hidden" },
    followUp: { label: "Uppföljning", kind: "hidden" },
    investigation: { label: "Utredningen", kind: "hidden" },
    doneNote: { label: "Kommentar när den blev klar", kind: "hidden" },
  },
  MAINTENANCE_PLAN: {
    name: { label: "Namn", kind: "text" },
    description: { label: "Vad som görs", kind: "longText" },
    unit: { label: "Räknas i", kind: "enum", labels: PLAN_UNIT_LABELS },
    every: { label: "Intervall", kind: "number" },
    intervalMode: { label: "Intervallet", kind: "enum", labels: INTERVAL_MODE_LABELS },
    startDate: { label: "Första tillfället", kind: "date" },
    nextRunHours: { label: "Nästa vid drifttimmar", kind: "hours" },
    assignee: { label: "Ansvarig", kind: "person" },
    estimatedMinutes: { label: "Uppskattad tid", kind: "minutes" },
    checklist: { label: "Checklista", kind: "list" },
    roundScheduleId: { label: "Görs i driftronden", kind: "round" },
    isActive: { label: "Läge", kind: "bool", labels: ACTIVE },
  },
  MACHINE: {
    name: { label: "Namn", kind: "text" },
    partType: { label: "Typ", kind: "text" },
    marking: { label: "Märkning", kind: "text" },
    status: { label: "Status", kind: "enum", labels: PART_STATUS_LABELS },
    notes: { label: "Anteckningar", kind: "longText" },
    runHours: { label: "Drifttimmar", kind: "hours" },
    parentId: { label: "Ligger under", kind: "machinePart" },
    placeId: { label: "Plats", kind: "place" },
    customerId: { label: "Kund", kind: "customer" },
    isActive: { label: "Läge", kind: "bool", labels: ACTIVE },
  },
};

/** One stored change: the field and its values before and after (absent for a hidden field). */
export type StoredChange = { field: string; from?: string | null; to?: string | null };

export const CHANGE_VALUE_MAX = 300;
/** At most this many fields per entry (the field lists are shorter; a guard for the stored text). */
export const CHANGE_FIELDS_MAX = 40;
/** A page of the history. */
export const CHANGE_PAGE_SIZE = 20;

function stable(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stable).join(",")}]`;
  if (value && typeof value === "object" && !(value instanceof Date)) {
    const entries = Object.entries(value as Record<string, unknown>).filter(([, item]) => item !== undefined).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
    return `{${entries.map(([key, item]) => `${JSON.stringify(key)}:${stable(item)}`).join(",")}}`;
  }
  return value instanceof Date ? JSON.stringify(value.toISOString()) : JSON.stringify(value ?? null);
}

const clip = (text: string) => text.length > CHANGE_VALUE_MAX ? `${text.slice(0, CHANGE_VALUE_MAX - 1)}…` : text;

/** A value as it is stored: null for nothing, otherwise a short text. */
export function storedValue(kind: ChangeValueKind, value: unknown): string | null {
  if (value === null || value === undefined) return null;
  if (kind === "hidden") return stable(value);
  if (value instanceof Date) return value.toISOString();
  if (typeof value === "boolean") return value ? "true" : "false";
  if (typeof value === "number") return Number.isFinite(value) ? String(value) : null;
  if (kind === "list") {
    const items = Array.isArray(value) ? value.map((item) => String(item ?? "").trim()).filter(Boolean) : [];
    return items.length ? clip(items.join("\n")) : null;
  }
  if (typeof value === "string") return value.trim() === "" ? null : clip(value);
  return clip(stable(value));
}

/**
 * The fields that differ between the record before and after (both in the shape of CHANGE_FIELDS, see the snapshots below).
 * A created or removed record has no field list: the entry's action says it.
 */
export function diffRecord(type: ChangeEntityType, before: Record<string, unknown> | null, after: Record<string, unknown> | null): StoredChange[] {
  if (!before || !after) return [];
  const changes: StoredChange[] = [];
  for (const [field, spec] of Object.entries(CHANGE_FIELDS[type])) {
    const from = storedValue(spec.kind, before[field]);
    const to = storedValue(spec.kind, after[field]);
    if (from === to) continue;
    changes.push(spec.kind === "hidden" ? { field } : { field, from, to });
    if (changes.length >= CHANGE_FIELDS_MAX) break;
  }
  return changes;
}

/** Reads the stored JSON text back; anything unreadable is left out. */
export function parseChanges(text: string): StoredChange[] {
  try {
    const parsed = JSON.parse(text) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((item): item is StoredChange => Boolean(item) && typeof item === "object" && typeof (item as StoredChange).field === "string").slice(0, CHANGE_FIELDS_MAX)
      .map((item) => ({ field: item.field, ...("from" in item ? { from: typeof item.from === "string" ? item.from : null } : {}), ...("to" in item ? { to: typeof item.to === "string" ? item.to : null } : {}) }));
  } catch {
    return [];
  }
}

// ---------- the records as the history compares them ----------

/** A responsible person: a member by id ("u:"), or a name typed in ("t:"). */
export const personValue = (userId: string | null | undefined, name: string | null | undefined) => userId ? `u:${userId}` : name?.trim() ? `t:${name.trim()}` : null;

type TaskRow = { title: string; description: string; status: string; assignedToUserId: string | null; assignedToName: string; plannedStartDate: string; dueDate: string; estimatedMinutes: number | null;
  stage: string; customerId: string | null; facilityId: string | null; projectId: string | null; workOrderId: string | null; machinePartId: string | null; cancelReason: string; data: unknown };
export const taskSnapshot = (row: TaskRow) => ({
  title: row.title, description: row.description, status: row.status, assignee: personValue(row.assignedToUserId, row.assignedToName), plannedStartDate: row.plannedStartDate,
  dueDate: row.dueDate, estimatedMinutes: row.estimatedMinutes, stage: row.stage, customerId: row.customerId, facilityId: row.facilityId, projectId: row.projectId,
  workOrderId: row.workOrderId, machinePartId: row.machinePartId, cancelReason: row.cancelReason, content: row.data,
});

type DeviationRow = { kind: string; type: string | null; status: string; severity: string | null; category: string | null; systematic: boolean; responsibleUserId: string | null; dueDate: string;
  workOrderId: string | null; reportedToAuthorityAt: Date | null; retentionHoldAt: Date | null; title: string; description: string; action: string; followUp: string; doneNote?: string | null } & Record<string, unknown>;
/** The incident's investigation: every column the type adds, compared as one. */
const INVESTIGATION_COLUMNS = ["occurredAt", "whatHappened", "cause", "serious", "personalInjury", "electrical"] as const;
export const deviationSnapshot = (row: DeviationRow) => ({
  kind: row.kind, type: row.kind === "IMPROVEMENT" ? null : row.type, status: row.status, severity: row.kind === "IMPROVEMENT" ? null : row.severity, category: row.category, systematic: row.systematic,
  responsibleUserId: row.responsibleUserId, dueDate: row.dueDate, workOrderId: row.workOrderId, reportedToAuthority: Boolean(row.reportedToAuthorityAt), retentionHold: Boolean(row.retentionHoldAt),
  title: row.title, description: row.description, action: row.action, followUp: row.followUp, doneNote: row.doneNote ?? null,
  investigation: Object.fromEntries(INVESTIGATION_COLUMNS.filter((column) => column in row).map((column) => [column, row[column] ?? null])),
});

type PlanRow = { name: string; description: string; unit: string; every: number; intervalMode: string; startDate: string; nextRunHours: number | null; assignedToUserId: string | null; assignedToName: string;
  estimatedMinutes: number | null; checklist: unknown; roundScheduleId: string | null; isActive: boolean };
export const planSnapshot = (row: PlanRow) => ({
  name: row.name, description: row.description, unit: row.unit, every: row.every, intervalMode: row.unit === "RUN_HOURS" ? null : row.intervalMode, startDate: row.unit === "RUN_HOURS" ? null : row.startDate,
  nextRunHours: row.nextRunHours, assignee: personValue(row.assignedToUserId, row.assignedToName), estimatedMinutes: row.estimatedMinutes,
  checklist: Array.isArray(row.checklist) ? row.checklist.map((item) => typeof item === "string" ? item : (item as { text?: unknown } | null)?.text ?? "") : [], roundScheduleId: row.roundScheduleId, isActive: row.isActive,
});

type PartRow = { name: string; partType: string; marking: string; status: string; notes: string; runHours: number | null; parentId: string | null; placeId: string | null; customerId: string | null; isActive: boolean };
export const partSnapshot = (row: PartRow) => ({
  name: row.name, partType: row.partType, marking: row.marking, status: row.status, notes: row.notes, runHours: row.runHours, parentId: row.parentId, placeId: row.placeId, customerId: row.customerId, isActive: row.isActive,
});

// ---------- the page ----------

/** The names the server found for the ids in a page, by kind. Missing: removed (or not the viewer's to see). */
export type ChangeNames = Partial<Record<"user" | "customer" | "facility" | "project" | "task" | "machinePart" | "place" | "round", Record<string, string>>>;

const REMOVED: Partial<Record<ChangeValueKind, string>> = {
  user: "Borttagen användare", customer: "Borttagen kund", facility: "Borttagen plats", project: "Borttaget projekt", task: "Borttagen arbetsorder",
  machinePart: "Borttagen maskin", place: "Borttagen plats", round: "Borttagen rond",
};
const NAMED_KINDS = ["user", "customer", "facility", "project", "task", "machinePart", "place", "round"] as const;
type NamedKind = (typeof NAMED_KINDS)[number];
const isNamed = (kind: ChangeValueKind): kind is NamedKind => (NAMED_KINDS as readonly string[]).includes(kind);

function minutesText(value: string) {
  const minutes = Math.round(Number(value));
  if (!Number.isFinite(minutes)) return value;
  const hours = Math.floor(minutes / 60);
  return hours ? `${hours} h${minutes % 60 ? ` ${minutes % 60} min` : ""}` : `${minutes} min`;
}

/** One value in words; null means nothing was set ("–" on the page). */
export function valueText(spec: ChangeField, value: string | null | undefined, names: ChangeNames): string | null {
  if (value === null || value === undefined) return null;
  if (spec.labels) return spec.labels[value] ?? value;
  switch (spec.kind) {
    case "bool": return value === "true" ? "Ja" : "Nej";
    case "minutes": return minutesText(value);
    case "hours": return `${Number(value).toLocaleString("sv-SE", { maximumFractionDigits: 1 })} h`;
    case "date": return /^\d{4}-\d{2}-\d{2}/.test(value) ? value.slice(0, 10) : value;
    case "list": return value.split("\n").join(" · ");
    case "person": return value.startsWith("u:") ? names.user?.[value.slice(2)] ?? REMOVED.user! : value.startsWith("t:") ? value.slice(2) : value;
    default: return isNamed(spec.kind) ? names[spec.kind]?.[value] ?? REMOVED[spec.kind]! : value;
  }
}

/** The ids in a page's changes that need a name, by kind (the server reads them within the company). */
export function idsToName(type: ChangeEntityType, changes: StoredChange[]): Record<NamedKind, Set<string>> {
  const out = Object.fromEntries(NAMED_KINDS.map((kind) => [kind, new Set<string>()])) as Record<NamedKind, Set<string>>;
  for (const change of changes) {
    const spec = CHANGE_FIELDS[type][change.field];
    if (!spec) continue;
    for (const value of [change.from, change.to]) {
      if (!value) continue;
      if (spec.kind === "person") { if (value.startsWith("u:")) out.user.add(value.slice(2)); }
      else if (isNamed(spec.kind)) out[spec.kind].add(value);
    }
  }
  return out;
}

export type ChangeLineView = { field: string; label: string; hidden: boolean; from: string | null; to: string | null };
export type ChangeEntryView = { id: string; at: string; action: ChangeAction; actionLabel: string; actor: string; changes: ChangeLineView[] };

/** The lines of one entry in words; a field the list no longer knows is left out. */
export function changeLines(type: ChangeEntityType, changes: StoredChange[], names: ChangeNames): ChangeLineView[] {
  return changes.flatMap((change) => {
    const spec = CHANGE_FIELDS[type][change.field];
    if (!spec) return [];
    const hidden = spec.kind === "hidden";
    return [{ field: change.field, label: spec.label, hidden, from: hidden ? null : valueText(spec, change.from, names), to: hidden ? null : valueText(spec, change.to, names) }];
  });
}

/** Who did it: a person's name, "Systemet" for a job, "Borttagen användare" for someone no longer known. */
export const actorText = (actorId: string | null, names: ChangeNames) => !actorId ? "Systemet" : actorId.startsWith("system:") ? "Systemet" : names.user?.[actorId] ?? "Borttagen användare";

/** The record's kind in the panel's text. */
export const CHANGE_ENTITY_WORD: Record<ChangeEntityType, string> = { TASK: "uppgiften", DEVIATION: "avvikelsen", MAINTENANCE_PLAN: "planen", MACHINE: "maskinen" };
