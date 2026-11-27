import { z } from "zod";
import { swedishDayKey } from "@/lib/swedish-time";
import { maintenanceFromDeviation, type MaintenanceFacts } from "@/lib/workflow/maintenance";
import { JOB_STATUS_LABELS } from "@/lib/workflow/job-state";
import { DEVIATION_TYPES, deviationCloseRefusal, deviationType, isIncidentType } from "./incidents";
import { DEVIATION_KINDS, DEVIATION_STATUSES, type DeviationCategory, type DeviationOrderView, type DeviationStatus, type ProgramDeviation, type SelfInspectionDocument, type SelfInspectionView } from "./model";

/**
 * Avvikelse ↔ arbetsorder ↔ egenkontrollens avvikelselogg (2026-10-10, kartläggningen 5.8): "länk åt båda håll, och
 * när arbetsordern färdigställs blir loggposten Åtgärdad med datum och vem. Så användbart som möjligt men smidigt."
 *
 * The rules as pure functions, so Cloud (lib/self-inspection/deviation-link-server.ts and the work order route), Local
 * (the .hwf file) and the demo decide alike:
 * 1. The same protocol row links them: a work order made from a row (its source taskId + rowId) takes the row's log entries
 *    that have no order yet (Öppen becomes Pågår); an entry logged from a row that already has an order gets that order
 *    (Pågår, or Åtgärdad when the order is finished – with the order's date and whoever finished it).
 * 2. From the log: an entry without an order gets "Skapa arbetsorder" (the right to create work orders) – "Åtgärda: …",
 *    a maintenance item with the priority from the entry's class when the protocol is on a machine part (Omedelbar
 *    åtgärd → Hög, Rutinöversyn → Normal; simulation 2026-10-10; on the item since 2026-10-30), the entry's
 *    responsible person as Ansvarig when that person may work with work orders, the protocol's customer, project and
 *    place, linked at once; the entry becomes Pågår.
 * 3. Finishing the order closes every linked entry that is not Åtgärdad: now, by whoever finished it, and an empty Åtgärd
 *    says "Åtgärdad genom arbetsorder <rubrik>" (without the order's "Åtgärda: "). Reopening the order changes nothing
 *    (an admin edits the entry by hand).
 * 4. Closing an entry by hand records who did it. Deleting the order only drops the link (the database, and the helpers below).
 * No new settings, rights or statuses.
 */

export type DeviationActor = { id: string; name: string };
/** A protocol row: the task the entry or the order was taken from, and the row's id within it. */
export type DeviationRow = { taskId: string; rowId: string };
/** What the rules need of a work order. `completedBy`: who finished it, when that can be read. */
export type DeviationOrderFacts = { id: string; title: string; status: string; completedAt: string | null; completedBy?: DeviationActor | null };
/** The fields of a log entry the rules read. */
export type DeviationLinkEntry = Pick<ProgramDeviation, "status" | "action" | "closedAt"> & Partial<Pick<ProgramDeviation, "workOrderId" | "closedById" | "closedByName">>
  /** Tillbud och olycksfall (2026-10-30): a near miss or an accident closes only with its investigation (./incidents.ts). */
  & { type?: string | null; occurredAt?: string | null; whatHappened?: string | null; cause?: string | null };
/** What the rules change on a log entry. */
export type DeviationPatch = Partial<{ status: DeviationStatus; action: string; closedAt: string | null; workOrderId: string; closedById: string | null; closedByName: string }>;

/** POST /api/self-inspection: make a work order from a log entry (Cloud and the demo; Local calls its backend directly). */
export const deviationWorkOrderActionSchema = z.object({ action: z.literal("create_work_order"), deviationId: z.string().min(1).max(120) });
/** Rule 2: the order's priority follows the entry's class – Omedelbar åtgärd is Hög, Rutinöversyn Normal (simulation 2026-10-10). */
export const deviationOrderPriority = (category: DeviationCategory | null | undefined): "HIGH" | "NORMAL" => category === "IMMEDIATE" ? "HIGH" : "NORMAL";

/**
 * Who reads a log entry – the same rule as the log itself: an admin every entry, anyone else what they reported or are
 * responsible for; a near miss or an accident only its reporter, admins and the Teamet right (./incidents.ts, 2026-10-30).
 */
export { mayReadDeviation } from "./incidents";

/** Whether a source (an entry's, or a work order's data.details.source) is this protocol row. A row without id never matches. */
export const sameRow = (source: { taskId: string; rowId?: string | null } | null | undefined, row: DeviationRow | null | undefined) =>
  Boolean(source && row?.rowId && source.rowId && source.taskId === row.taskId && source.rowId === row.rowId);

/** Rule 1: an entry of the row a new work order was made from gets the order, unless it has one; Öppen becomes Pågår. */
export function linkPatch(entry: DeviationLinkEntry, orderId: string): DeviationPatch | null {
  if (entry.workOrderId) return null;
  return { workOrderId: orderId, ...(entry.status === "OPEN" ? { status: "IN_PROGRESS" as const } : {}) };
}

/** Rule 3: what finishing the order does to a linked entry (null when it is already Åtgärdad). */
export function closePatch(entry: DeviationLinkEntry, order: { title: string }, by: DeviationActor, now: string): DeviationPatch | null {
  if (entry.status === "DONE") return null;
  const action = entry.action.trim() ? entry.action : closedByOrderText(order.title);
  // A near miss or an accident without its investigation stays open (Pågår) when the order is finished (2026-10-30).
  if (deviationCloseRefusal({ ...entry, action })) return null;
  return { status: "DONE", closedAt: now, closedById: by.id, closedByName: by.name.slice(0, 160), ...(entry.action.trim() ? {} : { action }) };
}
/** "Åtgärdad genom arbetsorder <rubrik>": the order's title without the "Åtgärda: " a deviation's order starts with (simulation 2026-10-10). */
export const closedByOrderText = (title: string) => `Åtgärdad genom arbetsorder ${title.trim().replace(/^Åtgärda:\s*/i, "").trim() || "(utan rubrik)"}`.slice(0, 4000);

/**
 * A deviation logged from a protocol keeps its way back as its source, shown as the link "Från <protokollet>" (simulation
 * 2026-10-10: the card said it twice). A closing "Från <protokollet>." in the description, which a protocol adds to the text
 * it sends, is left out, so the card says it once.
 */
export function withoutSourceNote(description: string, source: { title: string } | null | undefined): string {
  const title = source?.title?.trim();
  if (!title) return description;
  const note = `Från ${title}.`;
  const text = description.trimEnd();
  return text.endsWith(note) ? text.slice(0, -note.length).trimEnd() : description;
}

/**
 * Rule 1, the other way: an entry logged from a row whose work order exists starts linked – Pågår, or Åtgärdad when the
 * order is finished (the order's date, whoever finished it or else the person logging). A cancelled order (Utgått) is
 * linked but changes nothing.
 */
export function newEntryPatch(entry: DeviationLinkEntry, order: DeviationOrderFacts, actor: DeviationActor, now: string): DeviationPatch {
  if (order.status === "COMPLETED" && !deviationCloseRefusal({ ...entry, action: entry.action.trim() ? entry.action : closedByOrderText(order.title) })) {
    const by = order.completedBy ?? actor;
    return { workOrderId: order.id, status: "DONE", closedAt: order.completedAt ?? now, closedById: by.id, closedByName: by.name.slice(0, 160), ...(entry.action.trim() ? {} : { action: closedByOrderText(order.title) }) };
  }
  if (order.status === "CANCELLED" || order.status === "COMPLETED") return { workOrderId: order.id, ...(order.status === "COMPLETED" && entry.status === "OPEN" ? { status: "IN_PROGRESS" as const } : {}) };
  return { workOrderId: order.id, ...(entry.status === "OPEN" ? { status: "IN_PROGRESS" as const } : {}) };
}

/** Rule 4: a status set by hand. Åtgärdad keeps the first closing (when and who); leaving Åtgärdad clears it. */
export function manualStatusPatch(current: DeviationLinkEntry, next: DeviationStatus, actor: DeviationActor, now: string): { closedAt: string | null; closedById: string | null; closedByName: string } {
  if (next !== "DONE") return { closedAt: null, closedById: null, closedByName: "" };
  if (current.status === "DONE" && current.closedAt) return { closedAt: current.closedAt, closedById: current.closedById ?? null, closedByName: current.closedByName ?? "" };
  return { closedAt: now, closedById: actor.id, closedByName: actor.name.slice(0, 160) };
}

/**
 * Rule 2: the entry's responsible person becomes the order's Ansvarig when the person may work with work orders – an active
 * member who is an admin, or who may read and edit work orders. Anyone else leaves the order without Ansvarig.
 */
export function deviationOrderAssignee(person: { id: string; name: string; active: boolean; admin: boolean; readOrders: boolean; editOrders: boolean } | null | undefined): { id: string; name: string } | null {
  if (!person?.active || !(person.admin || (person.readOrders && person.editOrders))) return null;
  return { id: person.id, name: person.name };
}

/** Why "Skapa arbetsorder" cannot be used on an entry (null = it can). */
export function createOrderRefusal(entry: Pick<ProgramDeviation, "status"> & { workOrderId?: string | null }, canCreate: boolean): string | null {
  if (!canCreate) return "Du saknar behörighet att skapa arbetsordrar.";
  if (entry.workOrderId) return "Avvikelsen har redan en arbetsorder.";
  if (entry.status === "DONE") return "Avvikelsen är redan åtgärdad.";
  return null;
}

type OrderEntry = Pick<ProgramDeviation, "number" | "kind" | "title" | "description" | "source"> & { category?: DeviationCategory; type?: string | null; action?: string };
/** The order's words for an entry: a near miss or an accident gets a neutral title and its Åtgärd text only. */
function orderWords(entry: OrderEntry) {
  const incident = isIncidentType(entry.type);
  const name = incident ? DEVIATION_TYPES[deviationType(entry.type)].toLowerCase() : DEVIATION_KINDS[entry.kind].toLowerCase();
  const description = incident ? (entry.action ?? "").trim() : withoutSourceNote(entry.description, entry.source).trim();
  const title = incident ? `Åtgärd efter ${name} ${entry.number}` : `Åtgärda: ${entry.title}`;
  return { name, description, title, fault: (description || (incident ? title : entry.title)).slice(0, 2000) };
}

/**
 * The maintenance item's facts when the order's protocol is on a machine part (Underhåll, 2026-10-30; the server's
 * lib/maintenance/server.ts deviationItem): avhjälpande, the entry as the fault, the priority from its class, Felanmäld now.
 */
export const deviationItemFacts = (entry: OrderEntry, now = new Date()): MaintenanceFacts =>
  maintenanceFromDeviation({ fault: orderWords(entry).fault, priority: deviationOrderPriority(entry.category), now });

/**
 * Rule 2: the new work order for an entry, as the input every new work order is checked with. `protocol`: the task the entry
 * was taken from, when it still exists (its customer, open project and place, and its kind for the link back).
 */
export function workOrderFromDeviation(entry: OrderEntry,
  protocol: { kind: "FORM" | "WORK_ORDER" | "RISK_ASSESSMENT"; projectId: string | null; customerId: string | null; facilityId: string | null } | null,
  /** The entry's responsible person, once the caller has checked that the person may work with work orders (null: Ingen ansvarig). */
  assignee: { id: string | null; name: string } | null = null) {
  // Tillbud och olycksfall (2026-10-30, privacy first): the order gets a neutral title and the Åtgärd text only –
  // never the description, Vad hände, Varför or the photos, since everyone who reads work orders reads the order.
  const { name, description, title } = orderWords(entry);
  const from = `Från ${name} ${entry.number} i avvikelseloggen.`;
  return {
    kind: "WORK_ORDER" as const, title: title.slice(0, 200), description: [description, from].filter(Boolean).join("\n\n").slice(0, 5000), status: "PLANNED" as const,
    projectId: protocol?.projectId ?? null, customerId: protocol?.customerId ?? null, facilityId: protocol?.facilityId ?? null,
    assignedToUserId: assignee?.id ?? null, assignedToName: (assignee?.name ?? "").trim().slice(0, 160),
    data: { kind: "WORK_ORDER" as const, details: {
      ...(protocol && entry.source ? { source: { taskId: entry.source.taskId, title: entry.source.title.slice(0, 200), kind: protocol.kind, ...(entry.source.rowId ? { rowId: entry.source.rowId } : {}) } } : {}),
    } },
  };
}

// ---------- words and links ----------

export { deviationHref } from "./model";
export const deviationOrderHref = (id: string) => `/?view=workflow_task&taskId=${encodeURIComponent(id)}&taskType=WORK_ORDER`;
/** "Åtgärdad 2026-10-10 av Elna Strömtång" on a closed entry ("" otherwise). */
export function deviationClosedText(entry: Pick<DeviationLinkEntry, "status" | "closedAt" | "closedByName">) {
  if (entry.status !== "DONE" || !entry.closedAt) return "";
  const day = /^\d{4}-\d{2}-\d{2}$/.test(entry.closedAt) ? entry.closedAt : swedishDayKey(entry.closedAt);
  return `Åtgärdad ${day}${entry.closedByName?.trim() ? ` av ${entry.closedByName.trim()}` : ""}`;
}
export const orderStatusLabel = (status: string) => JOB_STATUS_LABELS[status] ?? status;
/** "Arbetsorder: <rubrik> · <status>", or "Arbetsorder kopplad" for a reader who may not read work orders. */
export const deviationOrderText = (order: DeviationOrderView) => order.readable ? `Arbetsorder: ${order.title || "(utan rubrik)"} · ${orderStatusLabel(order.status)}` : "Arbetsorder kopplad";
/** On the work order's page: "Avvikelse 3 i avvikelseloggen · Pågår". */
export const deviationLinkText = (entry: { kind?: ProgramDeviation["kind"]; number: number; status: DeviationStatus }) =>
  `${DEVIATION_KINDS[entry.kind ?? "DEVIATION"]} ${entry.number} i avvikelseloggen · ${DEVIATION_STATUSES[entry.status]}`;

/**
 * The log as its reader sees it, with each entry's work order: `orders` are the linked orders that exist (id → title and
 * status); the title and status only for a reader who may read work orders. An order that no longer exists reads as no link.
 */
export function withDeviationOrders(view: SelfInspectionView, orders: ReadonlyMap<string, { title: string; status: string }>, rights: { read: boolean; create: boolean }): SelfInspectionView {
  return {
    ...view, canCreateWorkOrder: rights.create && view.hasProgram,
    deviations: view.deviations.map((item) => {
      const order = item.workOrderId ? orders.get(item.workOrderId) : undefined;
      return { ...item, workOrder: order && item.workOrderId ? { id: item.workOrderId, title: rights.read ? order.title : "", status: rights.read ? order.status : "", readable: rights.read } : null };
    }),
  };
}

// ---------- the same rules on the document (Local's .hwf file and the demo) ----------

type DocumentEntry = SelfInspectionDocument["deviations"][number];
const patched = (entry: DocumentEntry, patch: DeviationPatch | null, now: string): DocumentEntry => patch ? { ...entry, ...patch, updatedAt: now } : entry;

/** A task kept in a file or in the demo, as far as the rules read it. */
export type StoredOrder = { id: string; kind: string; title: string; status: string; completedAt?: string | null; createdAt?: string; updatedAt?: string; updatedBy?: string | null; data?: unknown };
export const sourceOfOrder = (order: Pick<StoredOrder, "data">): { taskId: string; rowId?: string } | null => {
  const source = (order.data as { details?: { source?: { taskId?: unknown; rowId?: unknown } } } | undefined)?.details?.source;
  return source && typeof source.taskId === "string" ? { taskId: source.taskId, ...(typeof source.rowId === "string" ? { rowId: source.rowId } : {}) } : null;
};
/** The work order made from a protocol row (the latest, if several were made). */
export function orderForRow<T extends StoredOrder>(tasks: readonly T[], row: DeviationRow | null | undefined): T | null {
  if (!row?.rowId) return null;
  return tasks.filter((task) => task.kind === "WORK_ORDER" && sameRow(sourceOfOrder(task), row)).sort((a, b) => (b.createdAt ?? "").localeCompare(a.createdAt ?? ""))[0] ?? null;
}

/** A stored order as the rules read it; `finisher` names who finished it (the file's owner, or the demo's last saver). */
export function storedOrderFacts(order: StoredOrder | null, finisher?: (order: StoredOrder) => DeviationActor | null): DeviationOrderFacts | null {
  return order ? { id: order.id, title: order.title, status: order.status, completedAt: order.completedAt ?? null, completedBy: order.status === "COMPLETED" ? finisher?.(order) ?? null : null } : null;
}

/**
 * After a work order is saved (rules 1 and 3): a new order made from a row takes the row's entries, and an order that has
 * just been finished closes its entries. `previousStatus`: the order's status before the save (null for a new order).
 */
export function documentAfterOrderSave(doc: SelfInspectionDocument, input: { order: StoredOrder; previousStatus: string | null; by: DeviationActor; now: string }): SelfInspectionDocument {
  const { order, now } = input;
  if (order.kind !== "WORK_ORDER" || !doc.deviations.length) return doc;
  const row = input.previousStatus === null ? sourceOfOrder(order) : null;
  const finished = order.status === "COMPLETED" && input.previousStatus !== "COMPLETED";
  let changed = false;
  const deviations = doc.deviations.map((entry) => {
    let next = entry;
    if (row?.rowId && sameRow(entry.source, { taskId: row.taskId, rowId: row.rowId })) next = patched(next, linkPatch(next, order.id), now);
    if (finished && next.workOrderId === order.id) next = patched(next, closePatch(next, order, input.by, now), now);
    if (next !== entry) changed = true;
    return next;
  });
  return changed ? { ...doc, deviations } : doc;
}

/** Rule 2 in the document: the entry made a work order of gets it (and so does any other entry of the same row without one). */
export function documentWithEntryOrder(doc: SelfInspectionDocument, entryId: string, orderId: string, now: string): SelfInspectionDocument {
  const entry = doc.deviations.find((item) => item.id === entryId);
  if (!entry) return doc;
  const row = entry.source?.rowId ? { taskId: entry.source.taskId, rowId: entry.source.rowId } : null;
  return { ...doc, deviations: doc.deviations.map((item) => item.id === entryId || (row && sameRow(item.source, row)) ? patched(item, linkPatch(item, orderId), now) : item) };
}

/** Rule 1 for a new entry in the document: the order of its row, if one exists (`orderOf` reads it from the file or the demo). */
export function newEntryInDocument(entry: DocumentEntry, order: DeviationOrderFacts | null, actor: DeviationActor, now: string): DocumentEntry {
  return order ? patched(entry, newEntryPatch(entry, order, actor, now), now) : entry;
}

/** A deleted work order lets go of its entries (Cloud's database does the same with ON DELETE SET NULL). */
export function documentWithoutOrder(doc: SelfInspectionDocument, orderId: string): SelfInspectionDocument {
  if (!doc.deviations.some((item) => item.workOrderId === orderId)) return doc;
  return { ...doc, deviations: doc.deviations.map((item) => item.workOrderId === orderId ? { ...item, workOrderId: null } : item) };
}

/** The linked work orders of a document that exist among `tasks`, for withDeviationOrders. */
export function documentOrders(doc: Pick<SelfInspectionDocument, "deviations">, tasks: readonly StoredOrder[]) {
  const wanted = new Set(doc.deviations.flatMap((item) => item.workOrderId ? [item.workOrderId] : []));
  return new Map(tasks.filter((task) => task.kind === "WORK_ORDER" && wanted.has(task.id)).map((task) => [task.id, { title: task.title, status: task.status }]));
}
