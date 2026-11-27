import * as invoiceBasesRoute from "@/app/api/invoice-bases/route";
import * as maintenanceRoute from "@/app/api/maintenance/route";
import * as overviewRoute from "@/app/api/overview/route";
import { callRoute, pick, ToolError } from "@/lib/tools/call-route";
import { context } from "@/lib/kfid/server";
import { searchHelp, helpSourceLabel, type HelpAnswer } from "@/lib/help/search-help";
import { helpAccessFor, helpFilmsPage } from "@/lib/help/help-access";
import { addSwedishDays, swedishDayKey } from "@/lib/swedish-time";
import type { KNOWLEDGE_TOOL_CATALOG } from "@/lib/tools/catalog-knowledge";

/**
 * The runners of lib/tools/catalog-knowledge.ts (2026-11-21), spread into the registry's runners. Each runs the app's own route in
 * the person's session – the session, company, membership, role, module and Cloud checks are the route's – and answers with what
 * a client needs, with the link to the page in Workflow (`url`). The help search reads no company data at all.
 */
type Input = Record<string, unknown>;
type Row = Record<string, unknown>;
const q = (value: unknown) => encodeURIComponent(String(value ?? ""));
const rows = (value: unknown) => (Array.isArray(value) ? (value as Row[]) : []);

/** The help search's answer as the tools give it: the source in words, the excerpt, the page and the film. */
export function helpToolAnswer(answer: HelpAnswer) {
  return {
    query: answer.query, confident: answer.confident,
    hits: answer.hits.map((hit) => ({ source: helpSourceLabel(hit.source), title: hit.title, text: hit.text, url: hit.href, ...(hit.film ? { film: { title: hit.film.title, url: hit.film.href } } : {}) })),
    ...(answer.filmsPage ? { filmsPage: answer.filmsPage } : {}),
  };
}

const partUrl = (id: unknown) => `/?view=maintenance&part=${encodeURIComponent(String(id))}`;
const taskUrl = (id: unknown) => `/?view=workflow_task&taskId=${encodeURIComponent(String(id))}&taskType=WORK_ORDER`;
const LATE_FIRST: Record<string, number> = { late: 0, due: 1, started: 2, dormant: 3, done: 4, cancelled: 5 };

export const knowledgeRunners: Record<keyof typeof KNOWLEDGE_TOOL_CATALOG, (input: Input) => Promise<unknown>> = {
  search_help: async ({ query, limit }) => {
    const ctx = await context();
    return helpToolAnswer(searchHelp(String(query), { access: helpAccessFor(ctx), filmsPage: helpFilmsPage(), limit: typeof limit === "number" ? limit : 5 }));
  },

  list_company_invoice_bases: async ({ status, query, page = 1 }) => {
    const result = await callRoute(invoiceBasesRoute.GET, "GET", `/api/invoice-bases?list=1&status=${q(status ?? "all")}&page=${q(page)}${query ? `&q=${q(query)}` : ""}`);
    return {
      total: result.total, page: result.page, hasMore: result.hasMore,
      bases: rows(result.items).map((item) => ({ ...pick(item, ["id", "label", "title", "status", "net", "unpriced", "invoicedAt", "customerName", "scope", "subjectTitle", "taskId", "projectId", "createdAt"]), url: "/?view=invoice_bases" })),
      url: "/?view=invoice_bases",
    };
  },
  get_invoicing_overview: async () => {
    const answer = await callRoute(overviewRoute.GET, "GET", "/api/overview?tab=economy");
    const data = (answer.data ?? {}) as Row;
    const unbilled = data.unbilled as Row | null | undefined;
    const quotes = data.quotes as Row | null | undefined;
    return {
      today: data.today, prices: (data.access as Row | undefined)?.prices ?? false,
      drafts: data.drafts ?? null,
      unbilled: unbilled ? {
        totalSeconds: unbilled.totalSeconds, totalEstimate: unbilled.totalEstimate, groups: unbilled.groups, materialRows: unbilled.totalMaterialRows ?? 0, hidden: unbilled.hidden, more: unbilled.more, partial: unbilled.partial ?? false,
        rows: rows(unbilled.rows).map((row) => ({ ...pick(row, ["kind", "id", "title", "customer", "seconds", "invoicedSeconds", "materialRows", "estimate", "oldestDays"]), url: row.href })),
      } : null,
      quotes: quotes ? {
        awaiting: quotes.awaiting, acceptedThisMonth: quotes.acceptedThisMonth,
        expiring: rows((quotes.expiring as Row | undefined)?.rows).map((row) => ({ ...pick(row, ["id", "label", "title", "customer", "validUntil", "days", "net"]), url: `/?view=quote&quoteId=${encodeURIComponent(String(row.id))}` })),
        withoutWorkOrder: rows((quotes.withoutWorkOrder as Row | undefined)?.rows).map((row) => ({ ...pick(row, ["id", "label", "title", "customerName", "decidedOn", "net"]), url: row.href })),
      } : null,
      url: "/?view=stats&tab=economy",
    };
  },

  list_maintenance_parts: async ({ query, limit = 25 }) => {
    const tree = await callRoute(maintenanceRoute.GET, "GET", "/api/maintenance?part=tree");
    const parts = rows(tree.parts);
    const byId = new Map(parts.map((part) => [String(part.id), part]));
    const pathOf = (part: Row) => { const names: string[] = []; let at = part.parentId ? byId.get(String(part.parentId)) : undefined; const seen = new Set<string>(); while (at && !seen.has(String(at.id))) { seen.add(String(at.id)); names.unshift(String(at.name)); at = at.parentId ? byId.get(String(at.parentId)) : undefined; } return names.join(" › "); };
    const words = String(query ?? "").toLocaleLowerCase("sv").split(/\s+/).filter(Boolean);
    const matching = parts.filter((part) => words.every((word) => `${part.name} ${part.partType} ${part.marking} ${part.ownerName}`.toLocaleLowerCase("sv").includes(word)));
    // What needs attention first: fault reports, open items, then by name.
    matching.sort((a, b) => Number(b.reported ?? 0) - Number(a.reported ?? 0) || Number(b.openItems ?? 0) - Number(a.openItems ?? 0) || String(a.name).localeCompare(String(b.name), "sv"));
    const shown = matching.slice(0, Number(limit));
    return { total: matching.length, truncated: Boolean(tree.truncated), parts: shown.map((part) => ({ ...pick(part, ["id", "name", "partType", "marking", "status", "isActive", "openItems", "reported", "ownerName", "parentId"]), path: pathOf(part), url: partUrl(part.id) })) };
  },
  get_maintenance_part: async ({ partId }) => {
    const [detail, plans] = await Promise.all([
      callRoute(maintenanceRoute.GET, "GET", `/api/maintenance?part=detail&id=${q(partId)}`),
      callRoute(maintenanceRoute.GET, "GET", `/api/maintenance?part=plans&id=${q(partId)}`).catch((error) => { if (error instanceof ToolError && (error.status === 403 || error.status === 404)) return { plans: [] }; throw error; }),
    ]);
    const part = (detail.part ?? {}) as Row;
    return {
      part: { ...pick(part, ["id", "name", "partType", "marking", "status", "notes", "runHours", "runHoursAt", "isActive", "ownerName", "depth"]), path: Array.isArray(part.path) ? (part.path as string[]).join(" › ") : "", place: Array.isArray(part.placePath) ? (part.placePath as unknown[]).map((place) => (place && typeof place === "object" ? String((place as Row).name ?? "") : String(place))).join(" › ") : "", url: partUrl(part.id) },
      plans: rows(plans.plans).map((plan) => ({ ...pick(plan, ["id", "name", "description", "intervalText", "startDate", "nextRunHours", "assignedToName", "estimatedMinutes", "isActive"]),
        coming: rows(plan.coming).slice(0, 5).map((item) => ({ ...pick(item, ["id", "title", "due", "state", "assignedToName"]), url: taskUrl(item.id) })),
        last: plan.last ? { ...pick(plan.last as Row, ["id", "title", "due", "state"]), url: taskUrl((plan.last as Row).id) } : null })),
      openWorkOrders: rows(detail.workOrders).slice(0, 20).map((order) => ({ ...pick(order, ["id", "title", "status", "dueDate", "assignedToName"]), url: taskUrl(order.id) })),
      history: rows(detail.items).map((item) => ({ ...pick(item, ["id", "partName", "status", "type", "priority", "fault", "reportedAt", "stoppedAt", "restoredAt", "downtimeMinutes", "createdAt"]),
        workOrder: item.workOrder ? { ...pick(item.workOrder as Row, ["id", "title", "status"]), url: taskUrl((item.workOrder as Row).id) } : null })),
      spareParts: rows(detail.spares).slice(0, 20).map((spare) => pick(spare, ["name", "unit", "quantity", "total", "low"])),
    };
  },
  list_maintenance_due: async ({ from, to }) => {
    const today = swedishDayKey(new Date());
    const start = typeof from === "string" ? from : today;
    const end = typeof to === "string" ? to : swedishDayKey(addSwedishDays(new Date(), 30));
    if (end < start) throw new ToolError(400, "Slutdatumet ligger före startdatumet.");
    const result = await callRoute(maintenanceRoute.GET, "GET", `/api/maintenance?part=planning&from=${q(start)}&to=${q(end)}`);
    const occurrences = rows(result.occurrences).sort((a, b) => (LATE_FIRST[String(a.state)] ?? 9) - (LATE_FIRST[String(b.state)] ?? 9) || String(a.date).localeCompare(String(b.date)));
    return { from: start, to: end, total: occurrences.length, truncated: Boolean(result.truncated),
      occurrences: occurrences.slice(0, 100).map((item) => ({ ...pick(item, ["id", "title", "partName", "date", "state", "assignedToName", "projectId"]), url: taskUrl(item.id) })) };
  },

  list_machine_alarms: async ({ partId, days }) => {
    const result = await callRoute(maintenanceRoute.GET, "GET", `/api/maintenance?part=alarms${partId ? `&id=${q(partId)}` : ""}${days ? `&days=${q(days)}` : ""}`);
    const withUrl = (row: Row) => ({ ...row, ...(row.partId ? { url: partUrl(row.partId) } : {}) });
    return { days: result.days, total: result.total, raised: rows(result.raised).map(withUrl), recent: rows(result.recent).map(withUrl), observations: rows(result.observations).map(withUrl), url: partId ? partUrl(partId) : "/?view=maintenance" };
  },
};
