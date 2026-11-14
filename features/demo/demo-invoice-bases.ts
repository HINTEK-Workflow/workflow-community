import { z } from "zod";
import { QUOTE_VAT_PERCENT, parseShare, type QuoteCustomerType } from "@/lib/quotes/model";
import { blankInvoiceBasisView, invoiceBasisRot, invoiceTaxFromInput, NO_INVOICE_TAX, type InvoiceBasisTax } from "@/lib/invoice-basis/model";
import { workflowSubjectForTask, type WorkflowPermissionAction, type WorkflowPermissionSubject } from "@/lib/workflow/permissions";
import {
  INVOICE_BASIS_LIST_LIMIT, INVOICE_BASIS_PAGE_SIZE, invoiceBasisInputSchema, invoiceBasisListQuery, invoiceBasisNumberSearch, invoiceBasisLabel, invoiceBasisTotals, invoiceProposalKey, invoiceReadyProblem, invoiceSourceKeys, linesFromWork, materialsFromData,
  mergeLineSources, newBasisReason, notCompletedText, quoteLabelsOf, quoteNoteText,
  type InvoiceBasisLine, type InvoiceBasisListItem, type InvoiceBasisPage, type InvoiceBasisRow, type InvoiceBasisStatus, type InvoiceBasisSummary, type InvoiceBasisView, type InvoicePriceDefaults, type InvoiceSourceJob,
} from "@/lib/invoice-basis/model";
import { DEMO_ADMIN_ID, type DemoDatabase, type DemoTask } from "./demo-data";
import { demoHourlyRate, demoMarkupPercent } from "./demo-quotes";
import { customerTitle } from "@/lib/kfid/customer-name";
import { quoteCustomerDetails } from "@/lib/quotes/customer-details";
import { demoTimeBilling } from "./demo-time-types";

/**
 * Fakturaunderlag i demon (2026-10-10): /api/invoice-bases answered from memory for the public demo, in the same
 * shapes as lib/invoice-basis/server.ts and with the same pure rules (lib/invoice-basis/model.ts), so a basis on one of
 * the demo's finished jobs reads exactly as in Cloud: the reported time × the demo company's hourly rate (Priser och
 * offert in the demo), the material and the expenses, taken once. Nytt fakturaunderlag is a proposal until Skapa
 * underlaget, Markera som fakturerat needs a price on every line and a number is never given twice (QA 2026-10-10).
 * CSV, SIE and Fortnox are not made in the demo, like the quotes' export. Nothing leaves the browser; a reload starts over.
 */
export class DemoInvoiceBasisError extends Error {
  constructor(readonly status: number, message: string) { super(message); }
}

export type DemoInvoiceContext = {
  db: DemoDatabase; user: { id: string; name: string }; admin: boolean; now: Date;
  can: (subject: WorkflowPermissionSubject, action: WorkflowPermissionAction) => boolean;
};
type DemoRequest = { method: string; url: URL; body: unknown };

export type DemoBasis = {
  id: string; number: number; taskId: string | null; projectId: string | null; customerId: string | null; facilityId?: string | null; title: string; status: InvoiceBasisStatus;
  createdById?: string; vatPercent: number; note: string; tax?: InvoiceBasisTax; lines: InvoiceBasisLine[]; invoicedAt: string | null; invoicedByName: string; revision: number; createdAt: string; updatedAt: string;
};
/** Ny faktura in the demo: a basis without a job or project. */
export function createDemoStandaloneBasis(ctx: DemoInvoiceContext, input: { customerId?: string | null; title: string }): { id: string; label: string } {
  const store = storeOf(ctx.db);
  const stamp = ctx.now.toISOString();
  const number = Math.max(store.issued, ...store.bases.map((basis) => basis.number)) + 1;
  store.issued = number;
  const basis: DemoBasis = { id: `demo-invoice-basis-${++store.sequence}`, number, taskId: null, projectId: null, customerId: input.customerId ?? null, createdById: ctx.user.id, title: input.title.trim() || "Faktura", status: "DRAFT", vatPercent: QUOTE_VAT_PERCENT, note: "", tax: NO_INVOICE_TAX, lines: [], invoicedAt: null, invoicedByName: "", revision: 1, createdAt: stamp, updatedAt: stamp };
  store.bases.push(basis);
  return { id: basis.id, label: invoiceBasisLabel(number) };
}

/** `issued`: the highest number ever given, so a deleted draft's number never comes back. */
type Store = { bases: DemoBasis[]; sources: Map<string, string>; sequence: number; issued: number; seeded?: boolean; invoiceSeeds?: DemoInvoiceSeed[] };
/** A seeded basis that the demo's Fakturor shows as an invoice of its own (kundresa 2026-11-07, M11): obetald, betald or krediterad. */
export type DemoInvoiceSeed = { basisId: string; state: "unpaid" | "paid" | "credited"; daysBack: number };
const stores = new WeakMap<DemoDatabase, Store>();
const storeOf = (db: DemoDatabase) => { let store = stores.get(db); if (!store) { store = { bases: [], sources: new Map(), sequence: 0, issued: 0 }; stores.set(db, store); } return store; };

const customerTypeIn = (ctx: DemoInvoiceContext, customerId: string | null): QuoteCustomerType => ctx.db.customers.find((item) => item.id === customerId)?.customerType === "PRIVATE" ? "PRIVATE" : "COMPANY";
const NOT_IN_DEMO = "Rapporter och filer skapas inte i demon. I Workflow laddas underlaget ned som CSV, och som SIE när det är fakturerat.";
const PROPOSAL_CHANGED = "Det som kan faktureras har ändrats sedan förslaget visades (ny tid, nytt material eller ett annat underlag). Förslaget har lästs in igen – granska det och skapa underlaget.";

// ---------- the same rules as the server ----------

const access = (ctx: DemoInvoiceContext) => ({ read: ctx.admin || ctx.can("quotes", "read"), edit: ctx.admin || ctx.can("quotes", "edit") });
function requireAccess(ctx: DemoInvoiceContext, need: "read" | "edit") {
  if (!access(ctx)[need]) throw new DemoInvoiceBasisError(403, need === "edit" ? "Du saknar behörighet att ändra fakturaunderlag (Offerter – redigera)." : "Du saknar behörighet att se fakturaunderlag (Offerter – läsa).");
}
const readable = (ctx: DemoInvoiceContext, task: DemoTask) => ctx.can(workflowSubjectForTask(task.kind, (task as { formArea?: string | null }).formArea), "read");
const priceDefaults = (ctx: DemoInvoiceContext): InvoicePriceDefaults => ({ hourlyRate: demoHourlyRate(ctx), markupPercent: demoMarkupPercent(ctx) });

type Subject = { kind: "task"; task: DemoTask } | { kind: "project"; project: DemoDatabase["projects"][number] };
function subjectOf(ctx: DemoInvoiceContext, ref: { taskId?: string | null; projectId?: string | null }): Subject {
  if (ref.taskId) {
    const task = ctx.db.tasks.find((item) => item.id === ref.taskId);
    if (!task || !readable(ctx, task)) throw new DemoInvoiceBasisError(404, "Jobbet hittades inte.");
    if (task.workOrderId) throw new DemoInvoiceBasisError(409, "Uppgiften hör till en arbetsorder. Tid och material faktureras på arbetsordern.");
    return { kind: "task", task };
  }
  if (ref.projectId) {
    if (!ctx.can("projects", "read")) throw new DemoInvoiceBasisError(403, "Du saknar behörighet att läsa projekt.");
    const project = ctx.db.projects.find((item) => item.id === ref.projectId);
    if (!project) throw new DemoInvoiceBasisError(404, "Projektet hittades inte.");
    return { kind: "project", project };
  }
  throw new DemoInvoiceBasisError(400, "Ange ett jobb eller ett projekt.");
}

function workOf(ctx: DemoInvoiceContext, subject: Subject) {
  const billing = demoTimeBilling(ctx.db);
  // The project's work orders and its own time (Arbetsordern styr, 2026-10-26), as the server.
  const tasks = subject.kind === "task" ? [subject.task] : ctx.db.tasks.filter((task) => task.projectId === subject.project.id && task.kind === "WORK_ORDER" && readable(ctx, task));
  const all = tasks.map((task): InvoiceSourceJob & { status: string } => ({
    id: task.id, title: task.title, status: task.status,
    entries: ctx.db.timeEntries.filter((entry) => entry.taskId === task.id && entry.endedAt && entry.durationSec > 0 && billing(entry.timeTypeId).billing !== "none").map((entry) => ({ id: entry.id, durationSec: entry.durationSec, timeTypeId: entry.timeTypeId })),
    materials: task.kind === "WORK_ORDER" ? materialsFromData(task.data) : [],
  }));
  if (subject.kind === "project") {
    const own = ctx.db.timeEntries.filter((entry) => entry.projectId === subject.project.id && entry.endedAt && entry.durationSec > 0 && billing(entry.timeTypeId).billing !== "none").map((entry) => ({ id: entry.id, durationSec: entry.durationSec, timeTypeId: entry.timeTypeId }));
    if (own.length) all.push({ id: `project:${subject.project.id}`, title: "Projekttid", status: "COMPLETED", entries: own, materials: [] });
  }
  const completed = all.filter((job) => job.status === "COMPLETED");
  return { all, completed, notCompleted: all.filter((job) => job.status !== "COMPLETED" && job.status !== "CANCELLED").length };
}

const basisById = (store: Store, id: string) => store.bases.find((basis) => basis.id === id);
const takenBasis = (store: Store, key: string) => { const id = store.sources.get(key); return id ? basisById(store, id) ?? null : null; };
const customerName = (ctx: DemoInvoiceContext, id: string | null) => { const customer = ctx.db.customers.find((item) => item.id === id); return customer ? customerTitle(customer) : ""; };
/** The customer as the server's view has it: the heading, contact person and address (PDF review 2026-11-03, finding 10). */
const customerOf = (ctx: DemoInvoiceContext, id: string) => {
  const details = quoteCustomerDetails(ctx.db.customers.find((item) => item.id === id));
  return { id, name: customerName(ctx, id), contactName: details.contactName, address: details.address };
};

function readableBasis(ctx: DemoInvoiceContext, store: Store, id: string): DemoBasis {
  const basis = basisById(store, id);
  const task = basis?.taskId ? ctx.db.tasks.find((item) => item.id === basis.taskId) : null;
  if (!basis || (task && !readable(ctx, task)) || (basis.projectId && !ctx.can("projects", "read"))) throw new DemoInvoiceBasisError(404, "Fakturaunderlaget hittades inte.");
  return basis;
}

function summary(ctx: DemoInvoiceContext, store: Store, ref: { taskId?: string | null; projectId?: string | null }): InvoiceBasisSummary {
  requireAccess(ctx, "read");
  const subject = subjectOf(ctx, ref);
  const work = workOf(ctx, subject);
  const allKeys = invoiceSourceKeys(work.all);
  const completedKeys = invoiceSourceKeys(work.completed);
  const available = completedKeys.filter((key) => !store.sources.has(key)).length;
  const takenBy = [...new Set(completedKeys.flatMap((key) => { const basis = takenBasis(store, key); return basis ? [invoiceBasisLabel(basis.number)] : []; }))];
  const takenIds = new Set(allKeys.flatMap((key) => { const id = store.sources.get(key); return id ? [id] : []; }));
  const jobIds = new Set(work.all.map((job) => job.id));
  const mine = (basis: DemoBasis) => takenIds.has(basis.id) || (subject.kind === "task" ? basis.taskId === subject.task.id : basis.projectId === subject.project.id || Boolean(basis.taskId && jobIds.has(basis.taskId)));
  const bases = store.bases.filter(mine).sort((left, right) => right.number - left.number).slice(0, INVOICE_BASIS_LIST_LIMIT).map((basis): InvoiceBasisListItem => {
    const totals = invoiceBasisTotals(basis.lines, basis.vatPercent);
    return {
      id: basis.id, number: basis.number, label: invoiceBasisLabel(basis.number), title: basis.title, status: basis.status, net: totals.net, unpriced: totals.unpriced, invoicedAt: basis.invoicedAt,
      scope: basis.projectId ? "project" : "task", subjectTitle: basis.projectId ? ctx.db.projects.find((item) => item.id === basis.projectId)?.name ?? "" : ctx.db.tasks.find((item) => item.id === basis.taskId)?.title ?? "",
    };
  });
  const marked = { invoiced: [] as string[], draft: [] as string[] };
  for (const id of takenIds) { const basis = basisById(store, id); if (basis) (basis.status === "INVOICED" ? marked.invoiced : marked.draft).push(invoiceBasisLabel(basis.number)); }
  marked.invoiced.sort(); marked.draft.sort();
  const project = subject.kind === "project";
  return {
    bases, canEdit: access(ctx).edit, available, marked,
    newReason: newBasisReason({ project, completedJobs: work.completed.length, candidates: completedKeys.length, available, takenBy }),
    notCompleted: project ? notCompletedText(work.notCompleted) : "",
    quoteNote: quoteNoteText(quoteLabelsOf(work.all), project),
  };
}

const placeOf = (ctx: DemoInvoiceContext, id: string | null) => { const place = id ? (ctx.db.facilities ?? []).find((item) => item.id === id) : null; return place ? { id: place.id, name: place.name } : null; };

function view(ctx: DemoInvoiceContext, basis: DemoBasis): InvoiceBasisView {
  const task = basis.taskId ? ctx.db.tasks.find((item) => item.id === basis.taskId) ?? null : null;
  const project = basis.projectId ? ctx.db.projects.find((item) => item.id === basis.projectId) ?? null : null;
  const orders = task ? [task] : project ? ctx.db.tasks.filter((item) => item.projectId === project.id && item.kind === "WORK_ORDER") : [];
  return {
    id: basis.id, number: basis.number, label: invoiceBasisLabel(basis.number), revision: basis.revision, title: basis.title, status: basis.status, vatPercent: basis.vatPercent, note: basis.note,
    tax: basis.tax ?? NO_INVOICE_TAX, customerType: customerTypeIn(ctx, basis.customerId),
    lines: basis.lines, totals: invoiceBasisTotals(basis.lines, basis.vatPercent, invoiceBasisRot(basis.tax ?? NO_INVOICE_TAX, customerTypeIn(ctx, basis.customerId))), invoicedAt: basis.invoicedAt, invoicedByName: basis.invoicedByName, createdAt: basis.createdAt, updatedAt: basis.updatedAt,
    task: task ? { id: task.id, title: task.title } : null, project: project ? { id: project.id, name: project.name } : null,
    customer: basis.customerId ? customerOf(ctx, basis.customerId) : null,
    facility: placeOf(ctx, basis.facilityId ?? null),
    projectLocked: Boolean(basis.taskId) || [...storeOf(ctx.db).sources.values()].includes(basis.id),
    canEdit: access(ctx).edit && basis.status === "DRAFT",
    quoteNote: quoteNoteText(quoteLabelsOf(orders.map((order) => ({ materials: materialsFromData(order.data) }))), Boolean(project)),
    priceDefaults: priceDefaults(ctx),
  };
}

/** What a new basis would take now, or 409 with the reason none can be made (the server's buildNew). */
function buildNew(ctx: DemoInvoiceContext, store: Store, ref: { taskId?: string | null; projectId?: string | null }) {
  const subject = subjectOf(ctx, ref);
  const work = workOf(ctx, subject);
  const built = linesFromWork(work.completed, { taken: new Set(store.sources.keys()), hourlyRate: demoHourlyRate(ctx), perJob: subject.kind === "project", timeBilling: demoTimeBilling(ctx.db) });
  if (!built.lines.length) {
    const takenBy = [...new Set(invoiceSourceKeys(work.completed).flatMap((key) => { const basis = takenBasis(store, key); return basis ? [invoiceBasisLabel(basis.number)] : []; }))];
    throw new DemoInvoiceBasisError(409, newBasisReason({ project: subject.kind === "project", completedJobs: work.completed.length, candidates: built.candidates, available: 0, takenBy }));
  }
  return { subject, work, built };
}

/** Nytt fakturaunderlag: the proposal, nothing saved and nothing taken. */
function proposal(ctx: DemoInvoiceContext, store: Store, ref: { taskId?: string | null; projectId?: string | null }): InvoiceBasisView {
  requireAccess(ctx, "edit");
  const { subject, work, built } = buildNew(ctx, store, ref);
  const customerId = subject.kind === "task" ? subject.task.customerId : subject.project.customerId ?? null;
  const stamp = ctx.now.toISOString();
  return {
    id: "", number: 0, label: "", revision: 0, title: (subject.kind === "task" ? subject.task.title : subject.project.name).slice(0, 200) || "Fakturaunderlag",
    status: "DRAFT", vatPercent: QUOTE_VAT_PERCENT, note: "", lines: built.lines, totals: invoiceBasisTotals(built.lines), invoicedAt: null, invoicedByName: "", createdAt: stamp, updatedAt: stamp,
    task: subject.kind === "task" ? { id: subject.task.id, title: subject.task.title } : null, project: subject.kind === "project" ? { id: subject.project.id, name: subject.project.name } : null,
    customer: customerId ? customerOf(ctx, customerId) : null,
    canEdit: true, quoteNote: quoteNoteText(quoteLabelsOf(work.all), subject.kind === "project"), priceDefaults: priceDefaults(ctx), proposal: invoiceProposalKey(built.sources),
  };
}

const id = z.string().trim().min(1).max(100);
const bodySchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("create"), taskId: id.optional(), projectId: id.optional(), proposal: z.string().trim().min(1).max(100), basis: z.unknown() }),
  z.object({ action: z.literal("save"), id, revision: z.number().int().min(1), basis: z.unknown() }),
  z.object({ action: z.literal("invoice"), id, revision: z.number().int().min(1) }),
  z.object({ action: z.literal("delete"), id }),
]);

function write(ctx: DemoInvoiceContext, store: Store, raw: unknown) {
  const input = bodySchema.parse(raw);
  requireAccess(ctx, "edit");
  const stamp = ctx.now.toISOString();
  if (input.action === "create") {
    const values = invoiceBasisInputSchema.parse(input.basis);
    const { subject, built } = buildNew(ctx, store, input);
    if (invoiceProposalKey(built.sources) !== input.proposal) throw new DemoInvoiceBasisError(409, PROPOSAL_CHANGED);
    const number = Math.max(store.issued, ...store.bases.map((basis) => basis.number)) + 1;
    store.issued = number;
    const basis: DemoBasis = {
      id: `demo-invoice-basis-${++store.sequence}`, number,
      taskId: subject.kind === "task" ? subject.task.id : null, projectId: subject.kind === "project" ? subject.project.id : null,
      customerId: subject.kind === "task" ? subject.task.customerId : subject.project.customerId ?? null,
      createdById: ctx.user.id, title: values.title, status: "DRAFT", vatPercent: values.tax?.reverseVat ? 0 : parseShare(values.vatPercent) ?? QUOTE_VAT_PERCENT, note: values.note, tax: values.tax ? invoiceTaxFromInput(values.tax) : NO_INVOICE_TAX,
      lines: mergeLineSources(built.lines, values.lines), invoicedAt: null, invoicedByName: "", revision: 1, createdAt: stamp, updatedAt: stamp,
    };
    store.bases.push(basis);
    for (const key of built.sources) store.sources.set(key, basis.id);
    return { id: basis.id, label: invoiceBasisLabel(number) };
  }
  const basis = readableBasis(ctx, store, input.id);
  if (basis.status !== "DRAFT") throw new DemoInvoiceBasisError(409, "Underlaget är fakturerat och låst.");
  if (input.action === "delete") {
    store.bases = store.bases.filter((item) => item.id !== basis.id);
    for (const [key, owner] of [...store.sources]) if (owner === basis.id) store.sources.delete(key);
    return { ok: true };
  }
  if (input.revision !== basis.revision) throw new DemoInvoiceBasisError(409, "Underlaget har ändrats av någon annan. Läs in det igen.");
  if (input.action === "save") {
    const values = invoiceBasisInputSchema.parse(input.basis);
    // Kund, plats och projekt (2026-11-14): absent keeps what the basis has.
    const customerId = values.customerId === undefined ? basis.customerId : values.customerId;
    const facilityId = !customerId ? null : values.facilityId === undefined ? (customerId === basis.customerId ? basis.facilityId ?? null : null) : values.facilityId;
    Object.assign(basis, { customerId, facilityId, ...(values.projectId !== undefined && !basis.taskId ? { projectId: values.projectId } : {}), title: values.title, note: values.note, vatPercent: values.tax?.reverseVat ? 0 : parseShare(values.vatPercent) ?? QUOTE_VAT_PERCENT, tax: values.tax ? invoiceTaxFromInput(values.tax) : basis.tax, lines: mergeLineSources(basis.lines, values.lines), revision: basis.revision + 1, updatedAt: stamp });
    return { id: basis.id, revision: basis.revision };
  }
  const problem = invoiceReadyProblem(basis.lines, basis.tax ?? NO_INVOICE_TAX);
  if (problem) throw new DemoInvoiceBasisError(422, invoiceReadyProblem(basis.lines) ? `${problem} Sätt pris på alla rader innan underlaget markeras som fakturerat.` : problem);
  Object.assign(basis, { status: "INVOICED", invoicedAt: stamp, invoicedByName: ctx.user.name, revision: basis.revision + 1, updatedAt: stamp });
  return { id: basis.id, revision: basis.revision };
}

/**
 * Översikten i demon (2026-10-29): the bases and the source keys already taken (a time entry is billed when
 * timeSourceKey(id) is among them), for Ekonomi and Kunder. The caller checks the rights.
 */
export function demoInvoiceBasisRecords(db: DemoDatabase): { bases: readonly DemoBasis[]; taken: ReadonlySet<string> } {
  const store = storeOf(db);
  return { bases: store.bases, taken: new Set(store.sources.keys()) };
}

/**
 * Two bases to read when the page is first opened (2026-11-04): one marked as invoiced and one draft, made from the demo's
 * invented rows. The dates follow today (days back), so they read the same on
 * every weekday. Made once per page load, in memory.
 */
function ensureSeed(ctx: DemoInvoiceContext, store: Store) {
  if (store.seeded) return;
  store.seeded = true;
  const day = 86_400_000;
  const customerId = ctx.db.customers.find((customer) => customer.customerType !== "PRIVATE" && !customer.deletedAt)?.id ?? null;
  const line = (id: string, kind: "LABOUR" | "MATERIAL", name: string, quantity: string, unit: string, unitPrice: string): InvoiceBasisLine => ({ id, kind, name, quantity, unit, unitPrice, markupPercent: "", sources: [] });
  // Invented rows of their own, on no job: the demo's finished jobs stay free for a visitor to make an underlag of.
  // Kundresa 2026-11-07 (M11): the list Fakturor starts with three invoices – betald, obetald and krediterad – made from bases of their own.
  const seeds: { title: string; invoiced: boolean; daysBack: number; lines: InvoiceBasisLine[]; invoice?: DemoInvoiceSeed["state"] }[] = [
    { title: "Serviceavtal, kvartal 3", invoiced: true, daysBack: 16, lines: [line("s1", "LABOUR", "Arbete – Service av centraler", "6", "h", "695"), line("s2", "MATERIAL", "Säkringar, sats", "2", "st", "240")] },
    { title: "Felsökning av belysning", invoiced: false, daysBack: 5, lines: [line("s3", "LABOUR", "Arbete – Felsökning", "3,5", "h", "695")] },
    { title: "Byte av armaturer, trapphus", invoiced: true, daysBack: 40, invoice: "paid", lines: [line("s4", "LABOUR", "Arbete – Byte av armaturer", "5", "h", "695"), line("s5", "MATERIAL", "LED-armatur, trapphus", "6", "st", "890")] },
    { title: "Ny jordfelsbrytare, tvättstuga", invoiced: true, daysBack: 12, invoice: "unpaid", lines: [line("s6", "LABOUR", "Arbete – Installation", "2", "h", "695"), line("s7", "MATERIAL", "Jordfelsbrytare 4-pol", "1", "st", "1450")] },
    { title: "Kontroll av elcentral", invoiced: true, daysBack: 25, invoice: "credited", lines: [line("s8", "LABOUR", "Arbete – Kontroll", "1,5", "h", "695")] },
  ];
  store.invoiceSeeds = [];
  for (const seed of seeds) {
    const created = new Date(ctx.now.getTime() - seed.daysBack * day).toISOString();
    store.issued += 1;
    store.bases.push({
      id: `demo-invoice-basis-${++store.sequence}`, number: store.issued, taskId: null, projectId: null, customerId, createdById: DEMO_ADMIN_ID, title: seed.title,
      status: seed.invoiced ? "INVOICED" : "DRAFT", vatPercent: QUOTE_VAT_PERCENT, note: "", tax: NO_INVOICE_TAX, lines: seed.lines,
      invoicedAt: seed.invoiced ? new Date(ctx.now.getTime() - (seed.invoice ? seed.daysBack : 9) * day).toISOString() : null, invoicedByName: seed.invoiced ? ctx.user.name : "", revision: 1, createdAt: created, updatedAt: created,
    });
    if (seed.invoice) store.invoiceSeeds.push({ basisId: `demo-invoice-basis-${store.sequence}`, state: seed.invoice, daysBack: seed.daysBack });
  }
}

/** The seeded bases the demo's Fakturor makes invoices of, once per page load (features/demo/demo-customer-invoices.ts). */
export function demoInvoiceSeeds(ctx: DemoInvoiceContext): (DemoInvoiceSeed & { basis: DemoBasis })[] {
  const store = storeOf(ctx.db);
  ensureSeed(ctx, store);
  return (store.invoiceSeeds ?? []).flatMap((seed) => { const basis = store.bases.find((item) => item.id === seed.basisId); return basis ? [{ ...seed, basis }] : []; });
}

/** The company's list (Fakturaunderlag): the same query, filters, sorting and page size as Cloud. */
function list(ctx: DemoInvoiceContext, store: Store, params: URLSearchParams): InvoiceBasisPage {
  requireAccess(ctx, "read");
  const options = invoiceBasisListQuery(params);
  const readableHere = (basis: DemoBasis) => { const task = basis.taskId ? ctx.db.tasks.find((item) => item.id === basis.taskId) : null; return !(task && !readable(ctx, task)) && !(basis.projectId && !ctx.can("projects", "read")); };
  const words = options.q ? options.q.toLocaleLowerCase("sv-SE").split(" ").slice(0, 5) : [];
  const number = invoiceBasisNumberSearch(options.q);
  const rowOf = (basis: DemoBasis): InvoiceBasisRow => {
    const totals = invoiceBasisTotals(basis.lines, basis.vatPercent);
    const subjectTitle = basis.projectId ? ctx.db.projects.find((item) => item.id === basis.projectId)?.name ?? "" : ctx.db.tasks.find((item) => item.id === basis.taskId)?.title ?? "";
    return { id: basis.id, number: basis.number, label: invoiceBasisLabel(basis.number), title: basis.title, status: basis.status, net: totals.net, unpriced: totals.unpriced, invoicedAt: basis.invoicedAt, scope: basis.projectId ? "project" : "task", subjectTitle, customerName: customerName(ctx, basis.customerId), taskId: basis.taskId, projectId: basis.projectId, createdAt: basis.createdAt };
  };
  const visible = store.bases.filter(readableHere).map((basis) => ({ basis, row: rowOf(basis) }))
    .filter(({ basis }) => !options.mine || basis.createdById === ctx.user.id)
    .filter(({ row }) => number !== null ? row.number === number : words.every((word) => `${row.title} ${row.customerName} ${row.subjectTitle}`.toLocaleLowerCase("sv-SE").includes(word)));
  const forFilter = (filter: string) => visible.filter(({ row }) => filter === "all" || row.status === filter);
  const sorted = [...forFilter(options.filter)].sort((left, right) => options.sort === "updated" ? right.basis.updatedAt.localeCompare(left.basis.updatedAt) : options.sort === "title" ? left.row.title.localeCompare(right.row.title, "sv") : right.row.number - left.row.number);
  const from = (options.page - 1) * INVOICE_BASIS_PAGE_SIZE;
  const counts = options.counts ? { all: forFilter("all").length, DRAFT: forFilter("DRAFT").length, INVOICED: forFilter("INVOICED").length } : null;
  return { items: sorted.slice(from, from + INVOICE_BASIS_PAGE_SIZE).map(({ row }) => row), total: sorted.length, page: options.page, pageSize: INVOICE_BASIS_PAGE_SIZE, hasMore: sorted.length > from + INVOICE_BASIS_PAGE_SIZE, canEdit: access(ctx).edit, counts };
}

/** /api/invoice-bases and /api/invoice-bases/export in the demo. */
export function demoInvoiceBases(ctx: DemoInvoiceContext, request: DemoRequest, path: string): unknown {
  const store = storeOf(ctx.db);
  const get = request.method === "GET";
  if (path === "/api/invoice-bases/export") {
    // The Fortnox window asks first what would stop a send (no key here, nothing leaves the demo).
    const body = request.body as { action?: string } | null;
    if (!get && body?.action === "fortnox_preview") return { payload: null, issues: [], keyName: null, blocked: "Inget skickas till Fortnox från demon." };
    throw new DemoInvoiceBasisError(403, get ? NOT_IN_DEMO : "Export och Fortnox går inte att prova i demon.");
  }
  ensureSeed(ctx, store);
  if (!get) return write(ctx, store, request.body ?? {});
  const params = request.url.searchParams;
  if (params.get("list") === "1") return list(ctx, store, params);
  const one = params.get("id");
  if (one !== null) { requireAccess(ctx, "read"); return { basis: view(ctx, readableBasis(ctx, store, one)) }; }
  const ref = { taskId: params.get("taskId"), projectId: params.get("projectId") };
  if (params.get("proposal") === "1") return { basis: proposal(ctx, store, ref) };
  if (params.get("blank") === "1") { requireAccess(ctx, "edit"); return { basis: blankInvoiceBasisView(priceDefaults(ctx), ctx.now.toISOString()) }; }
  return summary(ctx, store, ref);
}
