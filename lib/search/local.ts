import { placeName, PLACE_SEPARATOR, PLACE_MAX_DEPTH } from "@/lib/workflow/customer-facility";
import type { WorkflowPermissionSubject } from "@/lib/workflow/permissions";
import { workflowSubjectForTask } from "@/lib/workflow/permissions";
import { tempPlaceLabel, tempPlaceOf } from "@/lib/workflow/temp-place";
import { swedishDayKey } from "@/lib/swedish-time";
import { roundOrderForDay } from "@/lib/workflow/form-schedule";
import { roundOrderRef } from "@/lib/workflow/round-work-orders";
import { customerCandidate, placeCandidate, projectCandidate, quoteCandidate, reportCandidate, roundCandidate, taskCandidate, type QuoteSearchInput, type ReportSearchInput } from "./candidates";
import { parseSearchQuery, type ParsedSearch } from "./query";
import { indexCandidate, mayMatch, rankCandidates, type IndexedCandidate } from "./score";
import type { SearchCandidate, SearchResponse } from "./types";
import { customerTitle } from "@/lib/kfid/customer-name";

type Stamp = string | Date | null | undefined;
/** The parts of a Local workspace (.hwf) and the demo's data that Sök reads; both have these shapes. */
export type LocalSearchData = {
  customers: { id: string; name: string; company?: string; customerType?: string; address?: string; postalCode?: string; city?: string; email?: string; phone?: string; mobile?: string; notes?: string; deletedAt?: Stamp; updatedAt?: Stamp }[];
  customerFacilities: { id: string; customerId: string; parentId?: string | null; kind?: string; name: string; description?: string; isActive: boolean; address?: string; city?: string; updatedAt?: Stamp }[];
  projects: { id: string; name: string; description?: string; client?: string; reference?: string; workSite?: string; contactPerson?: string; responsibleName?: string; responsibleUserId?: string | null; customerId?: string | null; facilityId?: string | null; archivedAt?: Stamp; closedAt?: Stamp; updatedAt?: Stamp }[];
  workflowTasks: { id: string; kind: string; title: string; description?: string; status: string; assignedToName?: string; assignedToUserId?: string | null; createdBy?: string | null; projectId?: string | null; customerId?: string | null; facilityId?: string | null; formArea?: string | null; workOrderId?: string | null; updatedAt?: Stamp; data?: unknown;
    /** A work order that holds a round (2026-10-27): the round and its period, so a round is found by its work order's place. */ roundScheduleId?: string | null; roundOccurrence?: string | null; plannedStartDate?: string | null; dueDate?: string | null }[];
  /** Offerter: the demo has them in memory (a Local file has none); found by title, number and customer as in Cloud. */
  quotes?: QuoteSearchInput[];
  /** Sparade rapporter: the demo has them (a Local file has no archive); `subject` is the permission area of what they report. */
  reports?: (ReportSearchInput & { subject: WorkflowPermissionSubject })[];
  /** The rounds; what an older round stored of its own customer and place is not searched (2026-10-27 kväll). */
  formSchedules?: { id: string; title: string; templateName?: string; assignedToName?: string; assignedToUserId?: string | null; active: boolean; deletedAt?: Stamp; updatedAt?: Stamp }[];
};
export type LocalSearchOptions = { me?: string | null; can?: (subject: WorkflowPermissionSubject) => boolean; local?: boolean; perGroup?: number; now?: number };

/** The text answers of a task, without the form's own document; at most `limit` characters. */
export function searchableLeaves(value: unknown, limit = 4000): string {
  const parts: string[] = [];
  let length = 0;
  const visit = (node: unknown, depth: number) => {
    if (length >= limit || depth > 8 || node == null) return;
    if (typeof node === "string") { if (node.trim()) { parts.push(node); length += node.length + 1; } return; }
    if (Array.isArray(node)) { for (const item of node) visit(item, depth + 1); return; }
    if (typeof node === "object") for (const [key, item] of Object.entries(node)) if (key !== "document" && key !== "id" && !key.endsWith("Id")) visit(item, depth + 1);
  };
  visit(value, 0);
  return parts.join(" ").slice(0, limit);
}

const templateNameOf = (data: unknown) => {
  const details = (data as { details?: { templateName?: unknown } } | null)?.details;
  return typeof details?.templateName === "string" ? details.templateName : "";
};

/** Every record the person may see, described once per file version and set of rights. */
function buildCandidates(data: LocalSearchData, options: LocalSearchOptions): SearchCandidate[] {
  const can = options.can ?? (() => true);
  const me = options.me ?? null;
  const local = options.local ?? true;
  const customers = new Map(data.customers.map((customer) => [customer.id, customer]));
  const customerName = (id: string | null | undefined) => id ? customerTitle(customers.get(id)) : "";
  const places = new Map(data.customerFacilities.map((place) => [place.id, place]));
  const paths = new Map<string, string>();
  // The whole way of a place, "Kund › Anläggning › Byggnad › Objekt", worked out once per place.
  const pathOf = (facilityId: string | null | undefined): string => {
    if (!facilityId) return "";
    const known = paths.get(facilityId);
    if (known !== undefined) return known;
    const names: string[] = [];
    const seen = new Set<string>();
    let current = places.get(facilityId);
    const owner = current?.customerId;
    while (current && names.length < PLACE_MAX_DEPTH && !seen.has(current.id)) {
      seen.add(current.id);
      names.unshift(placeName({ name: current.name }));
      current = current.parentId ? places.get(current.parentId) : undefined;
    }
    const path = names.length ? [customerName(owner), ...names].filter(Boolean).join(PLACE_SEPARATOR) : "";
    paths.set(facilityId, path);
    return path;
  };
  const projectName = new Map(data.projects.map((project) => [project.id, project.name]));
  // Hör till arbetsorder (Fas 2, Fas 4B): a task is also found by the title of its work order, when the person may read work orders.
  const workOrderTitle = new Map(can("work-order") ? data.workflowTasks.filter((task) => task.kind === "WORK_ORDER").map((task) => [task.id, task.title]) : []);
  const candidates: SearchCandidate[] = [];
  const today = swedishDayKey(new Date(options.now ?? Date.now()));
  const roundOrders = data.workflowTasks.flatMap((task) => { const ref = task.kind === "WORK_ORDER" ? roundOrderRef(task) : null; return ref ? [ref] : []; });
  if (can("projects")) for (const project of data.projects) candidates.push(projectCandidate({ ...project, customerName: customerName(project.customerId), placePath: pathOf(project.facilityId) }, me));
  for (const task of data.workflowTasks) {
    if (!can(workflowSubjectForTask(task.kind, task.formArea))) continue;
    candidates.push(taskCandidate({ ...task, templateName: templateNameOf(task.data), projectName: task.projectId ? projectName.get(task.projectId) : "", customerName: customerName(task.customerId), placePath: pathOf(task.facilityId), tempPlace: tempPlaceLabel(tempPlaceOf(task.data)), workOrderTitle: task.workOrderId ? workOrderTitle.get(task.workOrderId) ?? "" : "", bodyText: searchableLeaves((task.data as { details?: unknown } | undefined)?.details) }, me));
  }
  for (const customer of data.customers) if (!customer.deletedAt) candidates.push(customerCandidate(customer));
  for (const place of data.customerFacilities) {
    candidates.push(placeCandidate({ ...place, customerName: customerName(place.customerId), parentPath: place.parentId ? pathOf(place.parentId) : customerName(place.customerId) }, local));
  }
  for (const report of data.reports ?? []) if (can(report.subject)) candidates.push(reportCandidate(report));
  if (can("quotes")) for (const quote of data.quotes ?? []) candidates.push(quoteCandidate(quote, me));
  if ((["kfid", "work-order", "risk-assessment", "forms"] as const).some((subject) => can(subject))) for (const round of data.formSchedules ?? []) {
    if (round.deletedAt) continue;
    // Where the round is done is the work order's that holds it today (2026-10-27 kväll).
    const holder = roundOrderForDay(roundOrders, round.id, today);
    candidates.push(roundCandidate({ ...round, customerName: customerName(holder?.customerId), placePath: pathOf(holder?.facilityId), projectName: holder?.projectId ? projectName.get(holder.projectId) : "" }, me));
  }
  return candidates;
}

// The folded records of the last file version searched, so typing does not fold the whole file on every key.
const indexCache = new WeakMap<object, { key: string; items: IndexedCandidate[] }>();

/**
 * Sök over the open .hwf file (2026-10-05: Local and Cloud search alike): the same records, fields and ranking
 * as the server, in memory. `can` follows the person's rights where the data has them (the demo); a Local file's
 * owner may read everything in it. Each key press is one pass over the folded records: O(records × query words).
 */
export function searchLocalWorkspace(data: LocalSearchData, query: string | ParsedSearch, options: LocalSearchOptions = {}): SearchResponse {
  const parsed = typeof query === "string" ? parseSearchQuery(query) : query;
  if (!parsed.active) return { groups: [], fuzzy: false };
  const can = options.can ?? (() => true);
  const key = [options.me ?? "", options.local ?? true, ...(["projects", "kfid", "work-order", "risk-assessment", "forms", "customers", "quotes"] as const).map((subject) => can(subject))].join("|");
  let cached = indexCache.get(data);
  if (!cached || cached.key !== key) {
    cached = { key, items: buildCandidates(data, options).map(indexCandidate) };
    indexCache.set(data, cached);
  }
  const ids = new Set(parsed.ids);
  const selected = cached.items
    .map((item) => (ids.has(item.candidate.id) ? { ...item, candidate: { ...item.candidate, exactId: true } } : item))
    .filter((item) => (!parsed.filters.types || parsed.filters.types.includes(item.candidate.type)) && mayMatch(parsed, item))
    .map((item) => item.candidate);
  return rankCandidates(parsed, selected, { perGroup: options.perGroup, now: options.now });
}
