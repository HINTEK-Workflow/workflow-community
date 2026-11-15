import { addSwedishDays, swedishDayKey } from "@/lib/swedish-time";
import type { QuoteSearchInput } from "@/lib/search/candidates";
import { accountingSettingsOf } from "@/lib/quotes/accounting";
import { agreedQuoteVersions, compareQuotedUsed, quotedWork, quoteLinesFromMaterials, workOrderPlanFromQuote, type QuoteComparison } from "@/lib/quotes/conversion";
import type { ProjectQuoteItem, ProjectQuoteSummary, QuoteWorkOrderSummary } from "@/lib/quotes/flow-server";
import {
  quoteReverseVatOf, effectiveQuoteStatus, parseKronor, parseShare, QUOTE_FILTERS, QUOTE_PAGE_SIZE, QUOTE_SORTS, QUOTE_VAT_PERCENT, quoteActionError, quoteActions, quoteInputSchema, quoteLabel, quoteRotOf, quoteSendIssues, quoteTotals, quoteVersionDiff,
  type QuoteAction, type QuoteCustomerType, type QuoteFilter, type QuoteInput, type QuoteLineKind, type QuoteLineView, type QuoteListItem, type QuoteStatus, type QuoteView,
} from "@/lib/quotes/model";
import { countByFilter, parseListSort, sortListItems } from "@/lib/list-filter";
import { workListCountsAllowed } from "@/lib/workflow/work-list";
import { addDays, priceSettingsSchema, type PriceSettings } from "@/lib/quotes/settings";
import { customerLinkSummaryState, sendQuoteLinkSchema, type QuoteCustomerLinkView, type QuoteCustomerResponseView } from "@/lib/quotes/customer-link";
import { quoteAcceptanceMethodLabel } from "@/lib/quotes/acceptance";
import { formatPrice, parseAmount, type MaterialRow } from "@/lib/workflow/expenses";
import { parsePercent } from "@/lib/workflow/material-prices";
import type { WorkflowPermissionAction, WorkflowPermissionSubject } from "@/lib/workflow/permissions";
import type { DemoDatabase } from "./demo-data";
import { quoteCustomerDetails, type QuoteCustomerDetails } from "@/lib/quotes/customer-details";
import { customerTitle } from "@/lib/kfid/customer-name";

/**
 * Offerter i demon (2026-10-09, "bygg klart allt som går att bygga"): /api/quotes and /api/quotes/export answered
 * from memory for the public demo, in the same shapes as lib/quotes/server.ts and flow-server.ts, with the same pure rules
 * (lib/quotes/model.ts and conversion.ts) so sums, VAT, ROT, ÄTA and Offererat mot använt read exactly as in Cloud. Three
 * invented quotes: an accepted one in the garage project with an ÄTA sent as version 2, a draft for the office building and
 * a sent one to the private customer with ROT (the share and cap are the demo company's own editable figures). PDF, CSV,
 * Fortnox is not made in the demo, like the other reports. Nothing leaves the browser; a reload starts over.
 */
export class DemoQuoteError extends Error {
  constructor(readonly status: number, message: string) { super(message); }
}

export type DemoQuote = {
  id: string; number: number; version: number; revision: number; title: string; description: string; status: QuoteStatus; validUntil: string; terms: string;
  vatPercent: number; customerType: QuoteCustomerType; rotEnabled: boolean; rotPercent: number | null; rotCap: number | null;
  customerId: string | null; facilityId: string | null; projectId: string | null; changeOfVersion: number | null; workOrderId: string | null; superseded: boolean;
  lines: QuoteLineView[]; sentAt: string | null; decidedAt: string | null; createdAt: string; updatedAt: string; createdBy: string;
  /** Offert per e-post (steg E): the demo's pretend link (nothing is mailed) and the simulated answer. */
  link?: { email: string; sentAt: string; validUntil: string; version: number; usedAt: string | null };
  response?: QuoteCustomerResponseView;
  /** Ögonblicksbild av kunden (plan 1D): the customer as it was when the quote was sent, as Cloud keeps it. */
  sentCustomer?: QuoteCustomerDetails;
};
type Store = { quotes: DemoQuote[]; settings: PriceSettings; sequence: number };

export type DemoQuoteContext = {
  db: DemoDatabase; user: { id: string; name: string }; admin: boolean; now: Date;
  can: (subject: WorkflowPermissionSubject, action: WorkflowPermissionAction) => boolean;
  /** The demo's own "new work order" (the same checks as a work order saved from its page). */
  createWorkOrder: (task: Record<string, unknown>) => { id: string };
};
type DemoQuoteRequest = { method: string; url: URL; body: unknown };

const stores = new WeakMap<DemoDatabase, Store>();
const NOT_IN_DEMO = "Rapporter och filer skapas inte i demon. I Workflow laddas offerten ned som PDF eller CSV.";

/** The invented quotes, dated relative to today like the rest of the demo. */
function seed(db: DemoDatabase, now: Date): Store {
  const day = (offset: number) => swedishDayKey(addSwedishDays(now, offset));
  const at = (offset: number) => addSwedishDays(now, offset).toISOString();
  let lineSequence = 0;
  const line = (kind: QuoteLineKind, name: string, quantity: string, unit: string, unitPrice: string, markupPercent = "", rotLabour = false): QuoteLineView =>
    ({ id: `demo-quote-line-${++lineSequence}`, kind, name, quantity, unit, unitPrice, markupPercent, ...(rotLabour ? { rotLabour: true } : {}) });
  const base = { revision: 1, terms: "", vatPercent: QUOTE_VAT_PERCENT, customerType: "COMPANY" as QuoteCustomerType, rotEnabled: false, rotPercent: null, rotCap: null, changeOfVersion: null, workOrderId: null, superseded: false, sentAt: null, decidedAt: null, createdBy: "demo-elin" };
  const has = (id: string) => db.tasks.some((task) => task.id === id);
  const garage = (laddboxar: string, kabel: string, hours: string) => [
    line("MATERIAL", "Laddbox 11 kW", laddboxar, "st", "7900", "15"),
    line("MATERIAL", "Kabel EQLQ 5G6", kabel, "m", "38", "15"),
    line("MATERIAL", "EKKJ 4x95/50", "64", "m", "310", "15"),
    line("MATERIAL", "Garagecentral med lastbalansering", "1", "st", "14500", "15"),
    line("LABOUR", "Elinstallation", hours, "h", "650"),
    line("LABOUR", "Driftsättning och överlämning", "1", "st", "2500"),
    line("OTHER", "Lift, hyra", "3", "dag", "1200"),
    line("OTHER", "Etablering och resor", "1", "st", "2500"),
  ];
  const quotes: DemoQuote[] = [
    { ...base, id: "demo-quote-garage-v1", number: 1, version: 1, title: "Laddplatser i garaget", status: "ACCEPTED", superseded: true,
      description: "Tolv laddplatser med lastbalansering, ny matarkabel och egen central i garaget.",
      customerId: "demo-customer-kopparlunden", facilityId: "demo-facility-garage", projectId: "demo-project-laddplatser", validUntil: day(-8),
      workOrderId: has("demo-task-garage-laddboxar") ? "demo-task-garage-laddboxar" : null,
      lines: garage("12", "168", "104"), sentAt: at(-26), decidedAt: at(-23), createdAt: at(-28), updatedAt: at(-23) },
    // ÄTA: two more places at the entrance, sent to the board and not answered yet.
    { ...base, id: "demo-quote-garage-v2", number: 1, version: 2, title: "Laddplatser i garaget", status: "SENT", changeOfVersion: 1,
      description: "Tolv laddplatser med lastbalansering, ny matarkabel och egen central i garaget. ÄTA: två platser till vid infarten (plats 13–14).",
      customerId: "demo-customer-kopparlunden", facilityId: "demo-facility-garage", projectId: "demo-project-laddplatser", validUntil: day(28),
      lines: garage("14", "196", "116"), sentAt: at(-2), createdAt: at(-3), updatedAt: at(-2) },
    { ...base, id: "demo-quote-narvaro", number: 2, version: 1, title: "Närvarostyrning plan 3", status: "DRAFT",
      description: "Byte till LED-armaturer med närvarostyrning i kontor och korridor på plan 3.",
      customerId: "demo-customer-stromkraft", facilityId: "demo-facility-kontorshuset", projectId: null, validUntil: day(30),
      lines: [
        line("MATERIAL", "LED-armatur 600x600", "40", "st", "1150", "15"),
        line("MATERIAL", "Närvarogivare", "18", "st", "690", "15"),
        line("LABOUR", "Elinstallation", "46", "h", "650"),
        line("OTHER", "Bortforsling av gamla armaturer", "1", "st", "1800"),
      ], createdAt: at(-1), updatedAt: at(-1) },
    // A private customer with ROT on the labour line; share and cap are the demo company's own settings below.
    { ...base, id: "demo-quote-voltberg", number: 3, version: 1, title: "Utebelysning och laddbox", status: "SENT", createdBy: "demo-elin",
      description: "Laddbox vid uppfarten och fyra utomhusarmaturer med skymningsrelä.", customerType: "PRIVATE", rotEnabled: true, rotPercent: 30, rotCap: 50000,
      customerId: "demo-customer-voltberg", facilityId: "demo-facility-villan", projectId: null, validUntil: day(20),
      lines: [
        line("MATERIAL", "Laddbox 11 kW", "1", "st", "7900", "15"),
        line("MATERIAL", "Utomhusarmatur med skymningsrelä", "4", "st", "890", "15"),
        line("MATERIAL", "Kabel EKKJ 3G2,5", "35", "m", "24", "15"),
        line("LABOUR", "Elinstallation", "14", "h", "650", "", true),
        line("OTHER", "Resa", "1", "st", "450"),
      ], sentAt: at(-3), createdAt: at(-4), updatedAt: at(-3) },
  ];
  return { quotes, settings: { markupPercent: "15", hourlyRate: "650", validDays: 30, terms: "", rotPercent: "30", rotCap: "50000", emailMessage: "" }, sequence: 0 };
}

const storeOf = (ctx: DemoQuoteContext) => {
  let store = stores.get(ctx.db);
  if (!store) { store = seed(ctx.db, ctx.now); stores.set(ctx.db, store); }
  return store;
};

// ---------- access, the same rules as lib/quotes/server.ts ----------

const access = (ctx: DemoQuoteContext) => ({ read: ctx.admin || ctx.can("quotes", "read"), edit: ctx.admin || ctx.can("quotes", "edit") });
const workOrders = (ctx: DemoQuoteContext) => ({ read: ctx.admin || ctx.can("work-order", "read"), create: ctx.admin || ctx.can("work-order", "create") });
function requireQuotes(ctx: DemoQuoteContext, need: "read" | "edit") {
  if (!access(ctx)[need]) throw new DemoQuoteError(403, need === "edit" ? "Du saknar behörighet att ändra offerter." : "Du saknar behörighet att se offerter.");
}
const canSeePrices = (ctx: DemoQuoteContext) => ctx.admin || ctx.can("catalogue", "read") || ctx.can("quotes", "read");
const today = (ctx: DemoQuoteContext) => swedishDayKey(ctx.now);

// ---------- views ----------

const customerName = (ctx: DemoQuoteContext, id: string | null) => {
  const customer = id ? ctx.db.customers.find((item) => item.id === id) : undefined;
  return customer ? customerTitle(customer) : "";
};
const rotOf = (quote: DemoQuote) => quoteRotOf({ customerType: quote.customerType, rotEnabled: quote.rotEnabled, rotPercent: quote.rotPercent, rotCap: quote.rotCap });
/** The customer's snapshot when a quote is sent (plan 1D), from the demo's register. */
const snapshotOf = (ctx: DemoQuoteContext, quote: DemoQuote): QuoteCustomerDetails => quoteCustomerDetails(quote.customerId ? ctx.db.customers.find((item) => item.id === quote.customerId) : null);
/** Every work order made from the quote (plan 1D): the rows' `quoteRef` and the quote's own link, newest first. */
const workOrdersOf = (ctx: DemoQuoteContext, quote: DemoQuote) => {
  const rows = ctx.db.tasks.filter((task) => task.data.kind === "WORK_ORDER" && (task.id === quote.workOrderId || task.data.details.materials.some((row) => row.quoteRef?.quoteId === quote.id)));
  return rows.sort((a, b) => b.createdAt.localeCompare(a.createdAt)).map((task) => ({ id: task.id, title: task.title, status: task.status }));
};
const versionsOf = (store: Store, number: number) => store.quotes.filter((item) => item.number === number).sort((a, b) => a.version - b.version);

function view(ctx: DemoQuoteContext, store: Store, quote: DemoQuote): QuoteView {
  const day = today(ctx);
  const status = effectiveQuoteStatus(quote, day);
  const canEdit = access(ctx).edit;
  const base = quote.changeOfVersion ? store.quotes.find((item) => item.number === quote.number && item.version === quote.changeOfVersion) : undefined;
  const customer = quote.customerId ? ctx.db.customers.find((item) => item.id === quote.customerId) : undefined;
  const facility = quote.facilityId ? ctx.db.facilities.find((item) => item.id === quote.facilityId) : undefined;
  const project = quote.projectId ? ctx.db.projects.find((item) => item.id === quote.projectId) : undefined;
  const order = quote.workOrderId ? ctx.db.tasks.find((item) => item.id === quote.workOrderId) : undefined;
  return {
    id: quote.id, number: quote.number, version: quote.version, label: quoteLabel(quote), revision: quote.revision,
    title: quote.title, description: quote.description, status, storedStatus: quote.status, validUntil: quote.validUntil, terms: quote.terms, vatPercent: quote.vatPercent,
    customer: customer ? { id: customer.id, ...(quote.sentCustomer ?? quoteCustomerDetails(customer)) } : quote.sentCustomer ? { id: "", ...quote.sentCustomer } : null,
    facility: facility ? { id: facility.id, name: facility.name } : null,
    project: project ? { id: project.id, name: project.name } : null,
    customerType: quote.customerType, rotEnabled: quote.rotEnabled, rotPercent: quote.rotPercent, rotCap: quote.rotCap,
    ...(quoteReverseVatOf(quote.lines) ? { reverseVat: true, buyerVatNumber: quoteReverseVatOf(quote.lines)!.buyerVatNumber } : {}),
    changeOfVersion: quote.changeOfVersion,
    change: base ? quoteVersionDiff(base.lines, quote.lines) : null,
    ...(base ? { changeBase: base.lines.map((line) => ({ ...line })) } : {}),
    workOrder: order && workOrders(ctx).read ? { id: order.id, title: order.title } : null,
    workOrders: workOrders(ctx).read ? workOrdersOf(ctx, quote) : [],
    canCreateWorkOrder: quote.status === "ACCEPTED" && workOrders(ctx).create,
    lines: quote.lines.map((line) => ({ ...line })),
    totals: quoteTotals(quote.lines, quote.vatPercent, rotOf(quote)),
    sentAt: quote.sentAt, decidedAt: quote.decidedAt, createdAt: quote.createdAt, updatedAt: quote.updatedAt, superseded: quote.superseded,
    versions: versionsOf(store, quote.number).map((item) => ({ id: item.id, version: item.version, status: effectiveQuoteStatus(item, day) })),
    actions: canEdit ? quoteActions({ status: quote.status, validUntil: quote.validUntil, superseded: quote.superseded }, day) : [],
    canEdit,
    customerLink: quote.link ? {
      email: quote.link.email, sentAt: quote.link.sentAt, validUntil: quote.link.validUntil, openedAt: null, demo: true,
      state: customerLinkSummaryState({ usedAt: quote.link.usedAt, revokedAt: null, validUntil: quote.link.validUntil, quoteVersion: quote.link.version }, { version: quote.version, superseded: quote.superseded }, day),
    } satisfies QuoteCustomerLinkView : null,
    customerResponse: quote.response ?? null,
  };
}

function statusMatches(quote: DemoQuote, filter: QuoteFilter, day: string) {
  const valid = !quote.validUntil || quote.validUntil >= day;
  if (filter === "all") return true;
  if (filter === "open") return quote.status === "DRAFT" || (quote.status === "SENT" && valid);
  if (filter === "SENT") return quote.status === "SENT" && valid;
  if (filter === "EXPIRED") return quote.status === "EXPIRED" || (quote.status === "SENT" && !valid);
  return quote.status === filter;
}

function list(ctx: DemoQuoteContext, store: Store, params: URLSearchParams) {
  requireQuotes(ctx, "read");
  const day = today(ctx);
  const filter = (QUOTE_FILTERS as readonly string[]).includes(params.get("filter") ?? "") ? params.get("filter") as QuoteFilter : "open";
  const page = Math.max(1, Math.min(1000, Math.trunc(Number(params.get("page")) || 1)));
  const q = (params.get("q") ?? "").trim().slice(0, 100);
  const numberMatch = /^o?-?0*(\d{1,9})$/i.exec(q.replace(/\s+/g, ""));
  const words = q ? q.toLocaleLowerCase("sv-SE").split(/\s+/).slice(0, 5) : [];
  const projectName = (id: string | null) => id ? ctx.db.projects.find((item) => item.id === id)?.name ?? "" : "";
  // Toppvisningen (2026-10-31): the same scope and search for the chips' counts, and the list's sort, as Cloud.
  const sort = parseListSort(params.get("sort"), QUOTE_SORTS);
  const scoped = store.quotes.filter((quote) => !quote.superseded
    && (params.get("mine") !== "1" || quote.createdBy === ctx.user.id)
    && (!params.get("projectId") || quote.projectId === params.get("projectId"))
    && (!params.get("customerId") || quote.customerId === params.get("customerId"))
    && (numberMatch ? quote.number === Number(numberMatch[1]) : words.every((word) => [quote.title, customerName(ctx, quote.customerId), projectName(quote.projectId)].some((text) => text.toLocaleLowerCase("sv-SE").includes(word)))));
  const counts = params.get("counts") === "1" && workListCountsAllowed(params.get("mine") === "1" ? "mine" : "all", ctx.admin) ? countByFilter(scoped, QUOTE_FILTERS, (quote, value) => statusMatches(quote, value, day)) : null;
  const newest = [{ value: (quote: DemoQuote) => quote.updatedAt, direction: "desc" as const }, { value: (quote: DemoQuote) => quote.id }];
  const matches = sortListItems(scoped.filter((quote) => statusMatches(quote, filter, day)), sort === "title" ? [{ value: (quote: DemoQuote) => quote.title }, ...newest]
    : sort === "number" ? [{ value: (quote: DemoQuote) => quote.number, direction: "desc" as const }, ...newest] : sort === "due" ? [{ value: (quote: DemoQuote) => quote.validUntil }, ...newest] : newest);
  const items: QuoteListItem[] = matches.slice((page - 1) * QUOTE_PAGE_SIZE, page * QUOTE_PAGE_SIZE).map((quote) => {
    const totals = quoteTotals(quote.lines, quote.vatPercent);
    return {
      id: quote.id, number: quote.number, version: quote.version, label: quoteLabel(quote), title: quote.title, status: effectiveQuoteStatus(quote, day), validUntil: quote.validUntil,
      customerName: customerName(ctx, quote.customerId), projectName: projectName(quote.projectId), net: totals.net, gross: totals.gross, unpriced: totals.unpriced, updatedAt: quote.updatedAt, changeOfVersion: quote.changeOfVersion,
    };
  });
  return { items, total: matches.length, page, pageSize: QUOTE_PAGE_SIZE, hasMore: matches.length > page * QUOTE_PAGE_SIZE, canEdit: access(ctx).edit, counts };
}

// ---------- steg C: material, project summary ----------

const workOrderMaterials = (ctx: DemoQuoteContext, filter: (task: DemoDatabase["tasks"][number]) => boolean): MaterialRow[] =>
  ctx.db.tasks.filter((task) => task.kind === "WORK_ORDER" && filter(task)).flatMap((task) => task.data.kind === "WORK_ORDER" ? task.data.details.materials : []);

function materialSource(ctx: DemoQuoteContext, store: Store, params: URLSearchParams) {
  requireQuotes(ctx, "edit");
  if (!workOrders(ctx).read) throw new DemoQuoteError(403, "Du saknar behörighet att läsa arbetsordrar.");
  const taskId = params.get("taskId"), projectId = params.get("projectId");
  let name: string, rows: MaterialRow[], links: { projectId: string | null; customerId: string | null; facilityId: string | null };
  if (taskId) {
    const order = ctx.db.tasks.find((task) => task.id === taskId && task.kind === "WORK_ORDER");
    if (!order) throw new DemoQuoteError(404, "Arbetsordern hittades inte.");
    name = order.title;
    rows = workOrderMaterials(ctx, (task) => task.id === order.id);
    links = { projectId: order.projectId, customerId: order.customerId, facilityId: order.facilityId ?? null };
  } else if (projectId) {
    const project = ctx.db.projects.find((item) => item.id === projectId);
    if (!project) throw new DemoQuoteError(404, "Projektet hittades inte.");
    name = project.name;
    rows = workOrderMaterials(ctx, (task) => task.projectId === project.id);
    links = { projectId: project.id, customerId: project.customerId, facilityId: project.facilityId ?? null };
  } else throw new DemoQuoteError(400, "Ange ett projekt eller en arbetsorder.");
  const result = quoteLinesFromMaterials(rows, { companyMarkup: store.settings.markupPercent, newId: () => crypto.randomUUID() });
  return { name, ...links, lines: result.lines, rows: result.rows, mixedPrices: result.mixedPrices };
}

function projectSummary(ctx: DemoQuoteContext, store: Store, projectId: string): ProjectQuoteSummary {
  requireQuotes(ctx, "read");
  if (!ctx.db.projects.some((item) => item.id === projectId)) throw new DemoQuoteError(404, "Projektet hittades inte.");
  const day = today(ctx);
  const rows = store.quotes.filter((quote) => quote.projectId === projectId).sort((a, b) => a.number - b.number || a.version - b.version);
  const quotes = rows.filter((quote) => !quote.superseded).map((quote): ProjectQuoteItem => ({
    id: quote.id, label: quoteLabel(quote), title: quote.title, status: effectiveQuoteStatus(quote, day), version: quote.version, changeOfVersion: quote.changeOfVersion,
    net: quoteTotals(quote.lines, quote.vatPercent).net,
  })).reverse();
  const agreed = agreedQuoteVersions(rows);
  let comparison: QuoteComparison | null = null;
  if (workOrders(ctx).read) {
    const orderIds = new Set(ctx.db.tasks.filter((task) => task.kind === "WORK_ORDER" && task.projectId === projectId).map((task) => task.id));
    // The project's work orders' time and its own (Projekttid, 2026-10-26), as the server.
    const seconds = ctx.db.timeEntries.filter((entry) => entry.endedAt && ((entry.taskId && orderIds.has(entry.taskId)) || entry.projectId === projectId)).reduce((sum, entry) => sum + entry.durationSec, 0);
    comparison = compareQuotedUsed(agreed.flatMap((quote) => quote.lines), workOrderMaterials(ctx, (task) => orderIds.has(task.id)), seconds);
  }
  return { quotes, comparison, agreed: agreed.map((quote) => ({ id: quote.id, label: quoteLabel(quote) })), canCreate: access(ctx).edit };
}

/** Plan 1D/1K: the quote's work orders and Offererat mot använt for them, as lib/quotes/flow-server.ts quoteWorkOrderSummary. */
function workOrderSummary(ctx: DemoQuoteContext, store: Store, quoteId: string): QuoteWorkOrderSummary {
  requireQuotes(ctx, "read");
  const quote = find(store, quoteId);
  const orders = workOrders(ctx).read ? workOrdersOf(ctx, quote) : [];
  if (!orders.length || quote.status !== "ACCEPTED") return { workOrders: orders, comparison: null };
  const ids = new Set(orders.map((order) => order.id));
  const seconds = ctx.db.timeEntries.filter((entry) => entry.endedAt && entry.taskId && ids.has(entry.taskId)).reduce((sum, entry) => sum + entry.durationSec, 0);
  return { workOrders: orders, comparison: compareQuotedUsed(quote.lines, workOrderMaterials(ctx, (task) => ids.has(task.id)), seconds) };
}

// ---------- writing, the same rules as lib/quotes/server.ts ----------

const STALE = "Offerten har ändrats av någon annan. Läs in den senaste versionen.";
function find(store: Store, id: unknown) {
  const quote = store.quotes.find((item) => item.id === id);
  if (!quote) throw new DemoQuoteError(404, "Offerten hittades inte.");
  return quote;
}
function requireAction(ctx: DemoQuoteContext, quote: DemoQuote, action: QuoteAction) {
  const error = quoteActionError({ status: quote.status, validUntil: quote.validUntil, superseded: quote.superseded }, action, today(ctx));
  if (error) throw new DemoQuoteError(409, error);
}

/** Customer, place and project in the demo company and consistent with each other, as checkReferences on the server. */
function references(ctx: DemoQuoteContext, input: QuoteInput) {
  let customerId = input.customerId;
  if (input.facilityId) {
    const place = ctx.db.facilities.find((item) => item.id === input.facilityId);
    if (!place) throw new DemoQuoteError(404, "Platsen hittades inte.");
    if (customerId && place.customerId !== customerId) throw new DemoQuoteError(422, "Platsen hör till en annan kund.");
    customerId = place.customerId;
  }
  if (customerId && !ctx.db.customers.some((item) => item.id === customerId && !item.deletedAt)) throw new DemoQuoteError(404, "Kunden hittades inte.");
  if (input.projectId) {
    const project = ctx.db.projects.find((item) => item.id === input.projectId);
    if (!project) throw new DemoQuoteError(404, "Projektet hittades inte.");
    if (customerId && project.customerId && project.customerId !== customerId) throw new DemoQuoteError(422, "Projektet hör till en annan kund.");
    customerId = customerId ?? project.customerId;
  }
  return { customerId, facilityId: input.facilityId, projectId: input.projectId };
}

/** The input as stored: numbers read like the database stores them (antal 4 decimals, påslag 2), ROT only for a private person. */
function contents(ctx: DemoQuoteContext, input: QuoteInput) {
  const rot = input.customerType === "PRIVATE" && input.rotEnabled;
  const share = parseShare(input.rotPercent), cap = parseKronor(input.rotCap);
  const number = (text: string) => { const value = parseAmount(text); return value === null ? "" : formatPrice(Math.round(value * 10000) / 10000); };
  const percent = (text: string) => { const value = parsePercent(text); return value === null ? "" : formatPrice(Math.round(value * 100) / 100); };
  return {
    ...references(ctx, input), title: input.title, description: input.description, terms: input.terms,
    customerType: input.customerType, vatPercent: input.reverseVat ? 0 : parseShare(input.vatPercent) ?? QUOTE_VAT_PERCENT,
    rotEnabled: rot, rotPercent: rot ? share : null, rotCap: rot ? cap : null,
    lines: input.lines.map((line): QuoteLineView => ({
      id: crypto.randomUUID(), kind: line.kind, name: line.name, quantity: number(line.quantity) || "0", unit: line.unit, unitPrice: number(line.unitPrice), markupPercent: percent(line.markupPercent),
      ...(line.catalogue ? { catalogue: line.catalogue as QuoteLineView["catalogue"] } : {}),
      ...(line.articleNo ? { articleNo: line.articleNo, ...(line.articleSource ? { articleSource: line.articleSource } : {}) } : {}), ...(line.manufacturerArticleNo ? { manufacturerArticleNo: line.manufacturerArticleNo } : {}),
      ...(line.wholesale ? { wholesale: line.wholesale as QuoteLineView["wholesale"] } : {}),
      ...(rot && line.rotLabour ? { rotLabour: true } : {}),
      ...(input.reverseVat ? { reverseVat: { buyerVatNumber: input.buyerVatNumber } } : {}),
    })),
  };
}

type Body = { action?: string; id?: string; revision?: number; quote?: unknown; to?: string; settings?: unknown; email?: string; message?: string; decision?: string };

function write(ctx: DemoQuoteContext, store: Store, body: Body) {
  const now = ctx.now.toISOString();
  const day = today(ctx);
  if (body.action === "settings") {
    if (!ctx.admin) throw new DemoQuoteError(403, "Bara en företagsadministratör kan göra det.");
    store.settings = priceSettingsSchema.parse(body.settings);
    return { settings: store.settings };
  }
  // Accepterad offert → arbetsorder: Offerter – läsa and Arbetsorder – skapa, as in Cloud.
  if (body.action === "work_order") {
    requireQuotes(ctx, "read");
    if (!workOrders(ctx).create) throw new DemoQuoteError(403, "Du saknar behörighet att skapa arbetsordrar.");
    const quote = find(store, body.id);
    if (quote.status !== "ACCEPTED") throw new DemoQuoteError(409, "Bara en accepterad offert kan bli en arbetsorder.");
    const plan = workOrderPlanFromQuote(quote, quote.lines, () => crypto.randomUUID());
    if (plan.rows.length > 200) throw new DemoQuoteError(422, "En arbetsorder har högst 200 rader för material och utgifter. Dela upp offerten.");
    const project = quote.projectId ? ctx.db.projects.find((item) => item.id === quote.projectId) : undefined;
    // Plan 1K: the order says which quote it follows, so its guided flow asks for Ansvarig and Klart senast first; the
    // quote's Giltig till never becomes a date on the job.
    const created = ctx.createWorkOrder({
      kind: "WORK_ORDER", title: quote.title.slice(0, 200), description: plan.description, status: "PLANNED",
      projectId: project?.id ?? null, customerId: project?.customerId ?? quote.customerId, facilityId: quote.facilityId,
      estimatedMinutes: plan.estimatedMinutes, data: { kind: "WORK_ORDER", details: { materials: plan.rows, quote: { quoteId: quote.id, label: quoteLabel(quote), version: quote.version } } },
    });
    const task = ctx.db.tasks.find((item) => item.id === created.id);
    if (task) task.estimatedMinutes = plan.estimatedMinutes;
    quote.workOrderId = created.id;
    project?.events.push({ id: `demo-quote-event-${++store.sequence}`, kind: "UPDATED", summary: `Arbetsordern ${quote.title} skapades från offert ${quoteLabel(quote)}`.slice(0, 500), taskId: created.id, actorName: ctx.user.name, createdAt: now });
    return { id: created.id, materials: plan.materials, expenses: plan.expenses, estimatedMinutes: plan.estimatedMinutes };
  }
  requireQuotes(ctx, "edit");
  if (body.action === "create") {
    const input = quoteInputSchema.parse(body.quote);
    const values = contents(ctx, input);
    const number = Math.max(0, ...store.quotes.map((item) => item.number)) + 1;
    const quote: DemoQuote = {
      ...values, id: `demo-quote-${++store.sequence}`, number, version: 1, revision: 1, status: "DRAFT", changeOfVersion: null, workOrderId: null, superseded: false,
      validUntil: input.validUntil || addDays(day, store.settings.validDays), terms: values.terms || store.settings.terms,
      sentAt: null, decidedAt: null, createdAt: now, updatedAt: now, createdBy: ctx.user.id,
    };
    store.quotes.push(quote);
    return { id: quote.id };
  }
  const quote = find(store, body.id);
  if (body.action === "save") {
    requireAction(ctx, quote, "edit");
    const input = quoteInputSchema.parse(body.quote);
    if (quote.revision !== body.revision) throw new DemoQuoteError(409, STALE);
    Object.assign(quote, contents(ctx, input), { validUntil: input.validUntil, revision: quote.revision + 1, updatedAt: now });
    return { id: quote.id, revision: quote.revision };
  }
  if (body.action === "status") {
    const action = body.to === "send" || body.to === "accept" || body.to === "decline" || body.to === "expire" ? body.to : null;
    if (!action) throw new DemoQuoteError(400, "Okänd åtgärd.");
    requireAction(ctx, quote, action);
    if (quote.revision !== body.revision) throw new DemoQuoteError(409, STALE);
    if (action === "send") {
      const issues = quoteSendIssues({ lines: quote.lines, validUntil: quote.validUntil, vatPercent: quote.vatPercent, customerType: quote.customerType, rotEnabled: quote.rotEnabled, rotPercent: quote.rotPercent, rotCap: quote.rotCap }, day);
      if (issues.length) throw new DemoQuoteError(422, issues.join(" "));
    }
    const status: QuoteStatus = action === "send" ? "SENT" : action === "accept" ? "ACCEPTED" : action === "decline" ? "DECLINED" : "EXPIRED";
    Object.assign(quote, { status, ...(action === "send" ? { sentAt: now, sentCustomer: snapshotOf(ctx, quote) } : { decidedAt: now }), revision: quote.revision + 1, updatedAt: now });
    return { id: quote.id, revision: quote.revision, status };
  }
  // Offert per e-post (steg E): the demo sends nothing; it marks a draft as sent and keeps a pretend link to answer.
  if (body.action === "send_link") {
    const input = sendQuoteLinkSchema.parse(body);
    if (quote.status === "DRAFT") {
      requireAction(ctx, quote, "send");
      const issues = quoteSendIssues({ lines: quote.lines, validUntil: quote.validUntil, vatPercent: quote.vatPercent, customerType: quote.customerType, rotEnabled: quote.rotEnabled, rotPercent: quote.rotPercent, rotCap: quote.rotCap }, day);
      if (issues.length) throw new DemoQuoteError(422, issues.join(" "));
      if (body.revision !== undefined && quote.revision !== body.revision) throw new DemoQuoteError(409, STALE);
      Object.assign(quote, { status: "SENT", sentAt: now, sentCustomer: snapshotOf(ctx, quote), revision: quote.revision + 1, updatedAt: now });
    } else requireAction(ctx, quote, "accept");
    quote.link = { email: input.email, sentAt: now, validUntil: quote.validUntil, version: quote.version, usedAt: null };
    return { ok: true, status: "SENT", email: input.email, sentAt: now, validUntil: quote.validUntil, demo: true };
  }
  if (body.action === "demo_answer") {
    const decision = body.decision === "ACCEPTED" || body.decision === "DECLINED" ? body.decision : null;
    if (!decision || !quote.link || quote.link.usedAt) throw new DemoQuoteError(409, "Skicka offerten till kunden först.");
    requireAction(ctx, quote, "accept");
    quote.link.usedAt = now;
    quote.response = { decision, name: "Demokund", reason: "", method: "simple", methodLabel: quoteAcceptanceMethodLabel("simple"), at: now };
    Object.assign(quote, { status: decision, decidedAt: now, revision: quote.revision + 1, updatedAt: now });
    return { ok: true };
  }
  if (body.action === "new_version") {
    requireAction(ctx, quote, "new_version");
    quote.superseded = true;
    const created: DemoQuote = {
      ...quote, id: `demo-quote-${++store.sequence}`, version: quote.version + 1, revision: 1, status: "DRAFT", superseded: false, workOrderId: null,
      changeOfVersion: quote.status === "ACCEPTED" ? quote.version : quote.changeOfVersion,
      validUntil: quote.validUntil && quote.validUntil >= day ? quote.validUntil : addDays(day, store.settings.validDays),
      lines: quote.lines.map((line) => ({ ...line, id: crypto.randomUUID() })), sentAt: null, decidedAt: null, createdAt: now, updatedAt: now, createdBy: ctx.user.id,
      link: undefined, response: undefined, sentCustomer: undefined,
    };
    store.quotes.push(created);
    return { id: created.id };
  }
  if (body.action === "delete") {
    requireAction(ctx, quote, "delete");
    store.quotes = store.quotes.filter((item) => item.id !== quote.id);
    const previous = store.quotes.find((item) => item.number === quote.number && item.version === quote.version - 1);
    if (previous) previous.superseded = false;
    return { ok: true };
  }
  throw new DemoQuoteError(400, "Okänd åtgärd.");
}

/** Fakturaunderlag (2026-10-10): the demo company's hourly rate (Priser och offert), as Cloud reads it for a new basis. */
export function demoHourlyRate(ctx: Omit<DemoQuoteContext, "createWorkOrder">): string {
  return storeOf({ ...ctx, createWorkOrder: () => ({ id: "" }) }).settings.hourlyRate;
}

/** Fakturaunderlag (QA 2026-10-10): the demo company's markup, filled in on a material line that gets its price. */
export function demoMarkupPercent(ctx: Omit<DemoQuoteContext, "createWorkOrder">): string {
  return storeOf({ ...ctx, createWorkOrder: () => ({ id: "" }) }).settings.markupPercent;
}

/**
 * Översikten i demon (2026-10-29): every quote version as it is now, for Teamet, Ekonomi and Kunder
 * (features/demo/demo-overview.ts). The caller checks the rights, as Cloud's tab loaders do.
 */
export function demoQuoteRecords(ctx: Omit<DemoQuoteContext, "createWorkOrder">): readonly DemoQuote[] {
  return storeOf({ ...ctx, createWorkOrder: () => ({ id: "" }) }).quotes;
}

/** /api/quotes and /api/quotes/export in the demo. */
/**
 * Kundkortets offerter (2026-10-10), as Cloud's /api/customer-card: the number of the customer's quotes (latest version of
 * each) and whether a new one may be made; null without the right to read quotes.
 */
export function demoCustomerQuotes(ctx: Omit<DemoQuoteContext, "createWorkOrder">, customerId: string): { total: number; canCreate: boolean } | null {
  const rights = access({ ...ctx, createWorkOrder: () => ({ id: "" }) });
  if (!rights.read) return null;
  const store = storeOf({ ...ctx, createWorkOrder: () => ({ id: "" }) });
  return { total: store.quotes.filter((quote) => !quote.superseded && quote.customerId === customerId).length, canCreate: rights.edit };
}

/**
 * Offererat in the project portfolio (plan 1M): the agreed versions' Arbete hours in minutes, as the project page reads it;
 * null without the rights to read quotes and work orders, or when no agreed version has hours.
 */
export function demoQuotedMinutes(ctx: Omit<DemoQuoteContext, "createWorkOrder">, projectId: string): number | null {
  const full = { ...ctx, createWorkOrder: () => ({ id: "" }) };
  if (!access(full).read || !workOrders(full).read) return null;
  const rows = storeOf(full).quotes.filter((quote) => quote.projectId === projectId);
  return quotedWork(agreedQuoteVersions(rows).flatMap((quote) => quote.lines)).minutes;
}

/**
 * Sök (2026-10-10): the demo's quotes as they are now – also those made in this visit – for the shared search, with the
 * names of their customer and project; none without the right to read quotes. Older versions of a quote are left out.
 */
export function demoQuoteSearchItems(ctx: Omit<DemoQuoteContext, "createWorkOrder">): QuoteSearchInput[] {
  if (!access({ ...ctx, createWorkOrder: () => ({ id: "" }) }).read) return [];
  const customer = (id: string | null) => ctx.db.customers.find((item) => item.id === id);
  return storeOf({ ...ctx, createWorkOrder: () => ({ id: "" }) }).quotes.filter((quote) => !quote.superseded).map((quote) => ({
    id: quote.id, number: quote.number, version: quote.version, title: quote.title, description: quote.description, status: quote.status, validUntil: quote.validUntil,
    customerName: customerTitle(customer(quote.customerId)), projectName: ctx.db.projects.find((item) => item.id === quote.projectId)?.name ?? "",
    createdBy: quote.createdBy, updatedAt: quote.updatedAt, guaranteed: true,
  }));
}

export function demoQuotes(ctx: DemoQuoteContext, request: DemoQuoteRequest, path: string): unknown {
  const store = storeOf(ctx);
  const params = request.url.searchParams;
  const get = request.method === "GET";
  if (path === "/api/quotes/export") {
    // The company's account mapping reads as empty; files and Fortnox are not made in the demo.
    if (get && params.get("part") === "accounting") return { settings: accountingSettingsOf({}), canEdit: false, fortnoxKey: null };
    // The Fortnox window asks first what would stop a send (QA 2026-10-10): here, that nothing leaves the demo.
    if (!get && (request.body as { action?: string } | null)?.action === "fortnox_preview") return { payload: null, issues: [], keyName: null, blocked: "Inget skickas till Fortnox från demon." };
    throw new DemoQuoteError(403, get ? NOT_IN_DEMO : "Export och Fortnox går inte att prova i demon.");
  }
  if (!get) return write(ctx, store, (request.body ?? {}) as Body);
  const part = params.get("part");
  if (part === "settings") {
    if (!canSeePrices(ctx)) throw new DemoQuoteError(403, "Du saknar behörighet att se priser.");
    return { settings: store.settings, canEdit: ctx.admin };
  }
  if (part === "materials") return materialSource(ctx, store, params);
  if (part === "project") return projectSummary(ctx, store, params.get("projectId") ?? "");
  if (part === "work_orders") return workOrderSummary(ctx, store, params.get("id") ?? "");
  const id = params.get("id");
  if (id !== null) { requireQuotes(ctx, "read"); return { quote: view(ctx, store, find(store, id)) }; }
  return list(ctx, store, params);
}
