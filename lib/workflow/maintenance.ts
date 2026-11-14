import { z } from "zod";
import { formatSwedish } from "@/lib/swedish-time";

/**
 * Underhåll (2026-10-06, decisions B1–B11). The maintenance facts – type, priority, criticality, marking, fault,
 * cause and the times – belong since 2026-10-30 to a maintenance item on a machine part (lib/maintenance), which
 * the work order holds like a task; the work order itself keeps only what it waits for while paused. The words are our
 * own generic Swedish maintenance terms; nothing here is taken from a standard. Shared by Cloud, Local, the demo and the
 * tools. The places' object data (stage 2) is at the end.
 */

// ---------- maintenance facts and the work order ----------

export const MAINTENANCE_TYPES = ["PREVENTIVE", "CORRECTIVE", "CONDITION", "IMPROVEMENT"] as const;
export type MaintenanceType = (typeof MAINTENANCE_TYPES)[number];
export const MAINTENANCE_TYPE_LABELS: Record<MaintenanceType, string> = {
  PREVENTIVE: "Förebyggande",
  CORRECTIVE: "Avhjälpande",
  CONDITION: "Tillståndsbaserat",
  IMPROVEMENT: "Förbättring",
};
export const MAINTENANCE_TYPE_HINTS: Record<MaintenanceType, string> = {
  PREVENTIVE: "Planerat arbete innan något går sönder",
  CORRECTIVE: "Ett fel som ska åtgärdas",
  CONDITION: "Utfört för att mätning eller tillsyn visade behov",
  IMPROVEMENT: "Gör anläggningen bättre än förut",
};

export const MAINTENANCE_PRIORITIES = ["URGENT", "HIGH", "NORMAL", "LOW"] as const;
export type MaintenancePriority = (typeof MAINTENANCE_PRIORITIES)[number];
export const MAINTENANCE_PRIORITY_LABELS: Record<MaintenancePriority, string> = { URGENT: "Akut", HIGH: "Hög", NORMAL: "Normal", LOW: "Låg" };

/** A short fixed list of causes and "Annan" with a text (decision B9). */
export const MAINTENANCE_CAUSES = ["WEAR", "HANDLING", "EXTERNAL", "INSTALLATION", "UNKNOWN", "OTHER"] as const;
export type MaintenanceCause = (typeof MAINTENANCE_CAUSES)[number];
export const MAINTENANCE_CAUSE_LABELS: Record<MaintenanceCause, string> = {
  WEAR: "Slitage eller ålder",
  HANDLING: "Handhavande",
  EXTERNAL: "Yttre påverkan",
  INSTALLATION: "Montage eller konstruktion",
  UNKNOWN: "Okänd",
  OTHER: "Annan",
};

/**
 * What a paused work order waits for (2026-10-06: "tydlig status … t.ex. väntar på material/kund"). Not a status
 * of its own: the order is Pausad (PAUSED) and this says why, so every list, filter, KPI and tool that knows the five
 * statuses keeps working. Only meaningful while the order is paused; saving with another status clears it.
 */
export const WAITING_REASONS = ["MATERIAL", "CUSTOMER", "SHUTDOWN"] as const;
export type WaitingReason = (typeof WAITING_REASONS)[number];
export const WAITING_REASON_LABELS: Record<WaitingReason, string> = { MATERIAL: "Väntar på material", CUSTOMER: "Väntar på kund", SHUTDOWN: "Väntar på avställning" };

/**
 * Criticality A/B/C with fixed short texts (decision B2). Since 2026-10-24 a fact of the work order beside the
 * priority, with the marking on site ("E12"): they belong to the order itself, no longer to the place.
 */
export const CRITICALITIES = ["A", "B", "C"] as const;
export type Criticality = (typeof CRITICALITIES)[number];
export const CRITICALITY_TEXTS: Record<Criticality, string> = {
  A: "Stopp får allvarliga följder för säkerhet, miljö eller drift",
  B: "Stopp stör men går att hantera",
  C: "Övrigt",
};
export const MARKING_MAX_LENGTH = 40;

const text = (max: number) => z.string().trim().max(max).default("");
const instant = z.iso.datetime().nullable().default(null);

/**
 * The maintenance facts of one maintenance item (lib/maintenance/model.ts itemFieldsSchema is this schema). The action is
 * the work order's Utfört arbete; nothing here is required to complete it (decision B7).
 */
export const maintenanceFactsSchema = z.object({
  type: z.union([z.literal(""), z.enum(MAINTENANCE_TYPES)]).default(""),
  priority: z.union([z.literal(""), z.enum(MAINTENANCE_PRIORITIES)]).default(""),
  /** Kritikalitet and Märkning (2026-10-24): facts of the job, not of the place. */
  criticality: z.union([z.literal(""), z.enum(CRITICALITIES)]).default(""),
  marking: text(MARKING_MAX_LENGTH),
  fault: text(2000),
  cause: z.union([z.literal(""), z.enum(MAINTENANCE_CAUSES)]).default(""),
  causeNote: text(500),
  /** When the fault was reported, and when the object stopped and was back in service (absolute times, shown in Swedish time). */
  reportedAt: instant,
  stoppedAt: instant,
  restoredAt: instant,
});
export type MaintenanceFacts = z.infer<typeof maintenanceFactsSchema>;
export const emptyMaintenance = (): MaintenanceFacts => ({ type: "", priority: "", criticality: "", marking: "", fault: "", cause: "", causeNote: "", reportedAt: null, stoppedAt: null, restoredAt: null });

/** What a paused work order waits for, kept on the order itself (`details.waitingOn`); "" when it waits for nothing in particular. */
export const waitingOnSchema = z.union([z.literal(""), z.enum(WAITING_REASONS)]);

/**
 * A work order as the lists read it (`maintenance` on a list row): the highest priority of the open maintenance items it
 * holds (Cloud reads them from the items; Local has none) and what the paused order waits for (from the order).
 */
export type WorkOrderSummary = { priority?: string | null; waitingOn?: string | null };

const PRIORITY_RANK: Record<MaintenancePriority, number> = { URGENT: 0, HIGH: 1, NORMAL: 2, LOW: 3 };
/** The highest of the items' priorities ("" when none has one). */
export function highestPriority(priorities: readonly (string | null | undefined)[]): MaintenancePriority | "" {
  const known = priorities.filter((value): value is MaintenancePriority => typeof value === "string" && value in PRIORITY_RANK);
  return known.sort((a, b) => PRIORITY_RANK[a] - PRIORITY_RANK[b])[0] ?? "";
}

/** The waiting reason only belongs to a paused order. `holder`: the order's details, or a list row's summary. */
export function waitingReasonOf(status: string, holder: unknown): WaitingReason | "" {
  const value = holder && typeof holder === "object" ? (holder as { waitingOn?: unknown }).waitingOn : undefined;
  return status === "PAUSED" && typeof value === "string" && (WAITING_REASONS as readonly string[]).includes(value) ? value as WaitingReason : "";
}

/** A work order's status in words: "Väntar på material" for a paused order that waits for something, else `fallback`. */
export function workOrderStatusLabel(status: string, holder: unknown, fallback: string) {
  const waiting = waitingReasonOf(status, holder);
  return waiting ? WAITING_REASON_LABELS[waiting] : fallback;
}

/**
 * Saving with any status but Pausad – or starting time, which resumes the work – drops the waiting reason, so a later
 * pause never brings back an old "Väntar på material". Returns the same object when nothing changes. Cloud, Local, demo.
 */
export function withoutStaleWaiting<T>(status: string, data: T): T {
  let value = data as { kind?: string; obstacle?: unknown; details?: { waitingOn?: string } } | null;
  // A reported obstacle (lib/workflow/obstacles.ts) only stands while the job needs action or is paused.
  if (value?.obstacle !== undefined && status !== "NEEDS_ACTION" && status !== "PAUSED") { const { obstacle: _gone, ...rest } = value; void _gone; value = rest; }
  if (value?.kind !== "WORK_ORDER" || status === "PAUSED" || !value.details?.waitingOn) return (value === (data as unknown) ? data : value) as T;
  return { ...value, details: { ...value.details, waitingOn: "" } } as T;
}

/** An open work order marked Akut (an open item it holds is Akut): first in the work lists, marked red, and a reminder in the bell. */
export const isUrgentOpen = (status: string, summary: unknown) =>
  status !== "COMPLETED" && status !== "CANCELLED" && Boolean(summary && typeof summary === "object" && (summary as { priority?: unknown }).priority === "URGENT");

export function maintenanceHasContent(value: Partial<MaintenanceFacts> | null | undefined) {
  if (!value) return false;
  return Boolean(value.type || value.priority || value.criticality || value.marking?.trim() || value.fault?.trim() || value.cause || value.causeNote?.trim() || value.reportedAt || value.stoppedAt || value.restoredAt);
}

/** Whole minutes the object was out of service; null until both times are given and in order. Never stored. */
export function maintenanceDowntimeMinutes(value: Pick<MaintenanceFacts, "stoppedAt" | "restoredAt"> | null | undefined) {
  if (!value?.stoppedAt || !value.restoredAt) return null;
  const minutes = Math.round((Date.parse(value.restoredAt) - Date.parse(value.stoppedAt)) / 60_000);
  return Number.isFinite(minutes) && minutes >= 0 ? minutes : null;
}

/** "2 d 3 h 15 min", "45 min". */
export function formatDowntime(minutes: number | null) {
  if (minutes === null) return "";
  const days = Math.floor(minutes / 1440);
  const hours = Math.floor((minutes % 1440) / 60);
  const rest = minutes % 60;
  return [days ? `${days} d` : "", hours ? `${hours} h` : "", rest || (!days && !hours) ? `${rest} min` : ""].filter(Boolean).join(" ");
}

/** An error to show when the times do not fit together; the server stores them anyway (nothing here is required). */
export function maintenanceTimeIssue(value: Pick<MaintenanceFacts, "stoppedAt" | "restoredAt">) {
  if (value.stoppedAt && value.restoredAt && Date.parse(value.restoredAt) < Date.parse(value.stoppedAt)) return "Åter i drift ligger före stoppet.";
  return "";
}

const when = (value: string | null) => value ? formatSwedish(value, { dateStyle: "short", timeStyle: "short" }) : "";
export const causeText = (value: Pick<MaintenanceFacts, "cause" | "causeNote">) =>
  value.cause ? `${MAINTENANCE_CAUSE_LABELS[value.cause]}${value.causeNote.trim() ? `: ${value.causeNote.trim()}` : ""}` : value.causeNote.trim();

/** An item's maintenance facts as label–value pairs for the PDF, filled ones only. */
export function maintenanceFacts(raw: unknown): [string, string][] {
  const parsed = maintenanceFactsSchema.safeParse(raw ?? {});
  if (!parsed.success || !maintenanceHasContent(parsed.data)) return [];
  const value = parsed.data;
  const downtime = maintenanceDowntimeMinutes(value);
  return ([
    ["Typ av underhåll", value.type ? MAINTENANCE_TYPE_LABELS[value.type] : ""],
    ["Prioritet", value.priority ? MAINTENANCE_PRIORITY_LABELS[value.priority] : ""],
    ["Kritikalitet", value.criticality ? `${value.criticality} – ${CRITICALITY_TEXTS[value.criticality]}` : ""],
    ["Märkning", value.marking],
    ["Felanmält", when(value.reportedAt)],
    ["Fel eller symptom", value.fault],
    ["Orsak", causeText(value)],
    ["Ur drift", when(value.stoppedAt)],
    ["Åter i drift", when(value.restoredAt)],
    ["Stilleståndstid", formatDowntime(downtime)],
  ] as [string, string][]).filter(([, text]) => text.trim());
}

/**
 * A work order made from a round's deviation (stage 1): avhjälpande, the deviation's description as the fault, now as
 * the reported time, and the priority from the row's severity – the form's highest choice is Akut, any other choice
 * that counts as a deviation is Hög, the rest Normal.
 */
export function maintenanceFromDeviation(input: { fault?: string; severity?: string; severityOptions?: readonly string[]; seriousOptions?: readonly string[]; priority?: MaintenancePriority; now?: Date }): MaintenanceFacts {
  const severity = input.severity?.trim() ?? "";
  const options = input.severityOptions ?? [];
  // A row the form itself judged (a failing measurement, a point that is not OK) brings the priority its caller gives.
  const priority: MaintenanceFacts["priority"] = !severity ? input.priority ?? "" : options.length > 1 && severity === options[options.length - 1] ? "URGENT" : input.seriousOptions?.includes(severity) ? "HIGH" : "NORMAL";
  return { ...emptyMaintenance(), type: "CORRECTIVE", priority, fault: (input.fault ?? "").trim().slice(0, 2000), reportedAt: (input.now ?? new Date()).toISOString() };
}

/** The work list's maintenance filters (Mina arbetsordrar): an order matches when an item it holds has the type, and one the priority. */
export const maintenanceListFilterSchema = z.object({
  mtype: z.union([z.literal(""), z.enum(MAINTENANCE_TYPES)]).default(""),
  priority: z.union([z.literal(""), z.enum(MAINTENANCE_PRIORITIES)]).default(""),
});
export type MaintenanceListFilter = z.infer<typeof maintenanceListFilterSchema>;
/** `items`: the maintenance items the work order holds (Cloud filters the same way in SQL, app/api/work-items). */
export function maintenanceMatches(items: readonly { type?: string | null; priority?: string | null }[], filter: Partial<MaintenanceListFilter>) {
  if (!filter.mtype && !filter.priority) return true;
  return (!filter.mtype || items.some((item) => item.type === filter.mtype)) && (!filter.priority || items.some((item) => item.priority === filter.priority));
}

// ---------- object data on places (stage 2) ----------

export const OPERATING_STATES = ["IN_SERVICE", "OUT_OF_SERVICE", "DECOMMISSIONED"] as const;
export type OperatingState = (typeof OPERATING_STATES)[number];
export const OPERATING_STATE_LABELS: Record<OperatingState, string> = { IN_SERVICE: "I drift", OUT_OF_SERVICE: "Ur drift", DECOMMISSIONED: "Avvecklad" };

export const PLACE_ATTRIBUTE_LIMIT = 30;
export const placeAttributeSchema = z.object({ label: z.string().trim().min(1, "Ange vad värdet gäller.").max(60), value: z.string().trim().max(200).default("") });

/**
 * A place's object data (B3; criticality moved to the work order 2026-10-24: the place is a fixed position; a replaced unit changes the nameplate here). Everything is
 * optional free text entered by the user; columns with defaults in Cloud, additive fields in .hwf.
 */
export const placeObjectFields = {
  objectType: z.string().trim().max(80).default(""),
  operatingState: z.union([z.literal(""), z.enum(OPERATING_STATES)]).default(""),
  manufacturer: z.string().trim().max(120).default(""),
  model: z.string().trim().max(120).default(""),
  serialNumber: z.string().trim().max(120).default(""),
  installedOn: z.union([z.literal(""), z.iso.date()]).default(""),
  // Rows left completely empty in the form are dropped rather than refused.
  attributes: z.preprocess((value) => Array.isArray(value) ? value.filter((item) => item && typeof item === "object" && (String((item as { label?: unknown }).label ?? "").trim() || String((item as { value?: unknown }).value ?? "").trim())) : value,
    z.array(placeAttributeSchema).max(PLACE_ATTRIBUTE_LIMIT)).default([]),
};
export type PlaceObjectData = { [K in keyof typeof placeObjectFields]: z.infer<(typeof placeObjectFields)[K]> };
export const emptyPlaceObject = (): PlaceObjectData => ({ objectType: "", operatingState: "", manufacturer: "", model: "", serialNumber: "", installedOn: "", attributes: [] });
/** Object data read from a stored row or an older file: anything unexpected falls back to empty. */
export function placeObjectOf(row: object): PlaceObjectData {
  const place = row as Partial<Record<keyof PlaceObjectData, unknown>>;
  const result = z.object(placeObjectFields).safeParse({
    objectType: place.objectType ?? "", operatingState: place.operatingState ?? "", manufacturer: place.manufacturer ?? "",
    model: place.model ?? "", serialNumber: place.serialNumber ?? "", installedOn: place.installedOn ?? "", attributes: Array.isArray(place.attributes) ? place.attributes : [],
  });
  return result.success ? result.data : emptyPlaceObject();
}
export function placeHasObjectData(place: Partial<PlaceObjectData>) {
  return Boolean(place.objectType || place.operatingState || place.manufacturer || place.model || place.serialNumber || place.installedOn || place.attributes?.length);
}
/** "Tillverkare · Modell · SN 1234": the nameplate on one line. */
export function nameplateText(place: Partial<PlaceObjectData>) {
  return [place.manufacturer, place.model, place.serialNumber ? `SN ${place.serialNumber}` : ""].filter(Boolean).join(" · ");
}
