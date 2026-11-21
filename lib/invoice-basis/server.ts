import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { ApiError } from "@/lib/kfid/errors";
import { todayInSweden } from "@/lib/catalogue/snapshot";
import { hasWorkflowPermission, workflowSubjectForTask, type WorkflowPermissionSubject } from "@/lib/workflow/permissions";
import { readableTaskWhere } from "@/lib/workflow/task-access";
import { timeTypeRules } from "@/lib/workflow/time-types-server";
import { QUOTE_VAT_PERCENT, parseShare, quoteReverseVatOf, readLineCatalogue, type QuoteCustomerType } from "@/lib/quotes/model";
import { quoteAccess, readPriceSettings, type QuoteCaller } from "@/lib/quotes/server";
import type { AccountingQuote } from "@/lib/quotes/accounting";
import {
  invoiceBasisRot, invoiceBasisStored, invoiceBasisTaxOf, invoiceTaxFromInput, invoiceTaxFromQuote, invoiceTaxProblem, NO_INVOICE_TAX, type InvoiceBasisLine, type InvoiceBasisTax,
  INVOICE_BASIS_FILTERS, INVOICE_BASIS_LIST_LIMIT, INVOICE_BASIS_MAX_PAGE, INVOICE_BASIS_PAGE_SIZE, invoiceBasisNumberSearch, type InvoiceBasisFilter, type InvoiceBasisPage, type InvoiceBasisSort, type InvoiceBasisRow, invoiceBasisInputSchema, type InvoiceBasisInput, blankInvoiceBasisView, invoiceBasisLabel, invoiceBasisLinesOf, invoiceBasisTotals, invoiceProposalKey, invoiceReadyProblem, invoiceSourceKeys, linesFromWork,
  materialsFromData, mergeLineSources, newBasisReason, notCompletedText, quoteLabelsOf, quoteNoteText,
  type InvoiceBasisListItem, type InvoiceBasisStatus, type InvoiceBasisSummary, type InvoiceBasisView, type InvoicePriceDefaults, type InvoiceSourceJob,
} from "./model";
import { customerTitle } from "@/lib/kfid/customer-name";
import { quoteCustomerDetails } from "@/lib/quotes/customer-details";

/**
 * Fakturaunderlag från utfört arbete on the server (2026-10-10). Every query is bound to the caller's company.
 * Prices are business secrets: reading a basis needs admin or Offerter – läsa, changing it Offerter – redigera, and both
 * also need the right to read the job (its kind or the protocol's area) or the project. Cloud only.
 * What a basis takes is written to InvoiceBasisSource in the same transaction as the basis; the table's unique key is
 * what keeps a time entry or a row from ever being on two bases. An invoiced basis is locked here and by a trigger
 * (migration 20261012140000_invoice_basis).
 */
export type InvoiceBasisCaller = QuoteCaller & { userName?: string };
export type InvoiceBasisRef = { taskId?: string; projectId?: string };

type Db = Prisma.TransactionClient | typeof prisma;

export function invoiceBasisAccess(caller: Pick<QuoteCaller, "admin" | "permissions">) {
  return quoteAccess(caller);
}

export function requireInvoiceBasis(caller: Pick<QuoteCaller, "admin" | "permissions" | "storageMode">, need: "read" | "edit") {
  if (caller.storageMode !== "HINTEK_CLOUD") throw new ApiError(409, "Fakturaunderlag finns bara med serverlagring.");
  if (!invoiceBasisAccess(caller)[need]) throw new ApiError(403, need === "edit" ? "Du saknar behörighet att ändra fakturaunderlag (Offerter – redigera)." : "Du saknar behörighet att se fakturaunderlag (Offerter – läsa).");
}

const canRead = (caller: Pick<QuoteCaller, "admin" | "permissions">, subject: WorkflowPermissionSubject) => caller.admin || hasWorkflowPermission(caller.permissions, subject, "read");

// ---------- the job or project and its work ----------

const taskSelect = { id: true, title: true, kind: true, formArea: true, status: true, projectId: true, customerId: true, facilityId: true, workOrderId: true, data: true } as const;
type TaskRow = Prisma.WorkflowTaskGetPayload<{ select: typeof taskSelect }>;
type Subject =
  | { kind: "task"; task: TaskRow }
  | { kind: "project"; project: { id: string; name: string; customerId: string | null; facilityId: string | null } };

async function loadSubject(db: Db, caller: InvoiceBasisCaller, ref: InvoiceBasisRef): Promise<Subject> {
  if (ref.taskId) {
    const task = await db.workflowTask.findFirst({ where: { id: ref.taskId, organizationId: caller.organizationId }, select: taskSelect });
    // A job the person may not read is answered as one that does not exist, like the job's own page.
    if (!task || !canRead(caller, workflowSubjectForTask(task.kind, task.formArea))) throw new ApiError(404, "Jobbet hittades inte.");
    if (task.workOrderId) throw new ApiError(409, "Uppgiften hör till en arbetsorder. Tid och material faktureras på arbetsordern.");
    return { kind: "task", task };
  }
  if (ref.projectId) {
    if (!canRead(caller, "projects")) throw new ApiError(403, "Du saknar behörighet att läsa projekt.");
    const project = await db.project.findFirst({ where: { id: ref.projectId, organizationId: caller.organizationId }, select: { id: true, name: true, customerId: true, facilityId: true } });
    if (!project) throw new ApiError(404, "Projektet hittades inte.");
    return { kind: "project", project };
  }
  throw new ApiError(400, "Ange ett jobb eller ett projekt.");
}

const PROJECT_JOB_LIMIT = 500;
const CLOSED = ["COMPLETED", "CANCELLED"];

/**
 * The jobs whose work a basis can take: the work order itself, or the project's work orders and the project's own time
 * (Arbetsordern styr, 2026-10-26: time is only on work orders and projects; a task's time is on its work order).
 */
async function workOf(db: Db, caller: InvoiceBasisCaller, subject: Subject) {
  const rows: TaskRow[] = subject.kind === "task" ? [subject.task] : await db.workflowTask.findMany({
    where: { organizationId: caller.organizationId, projectId: subject.project.id, kind: "WORK_ORDER", AND: [readableTaskWhere((area) => canRead(caller, area))] },
    orderBy: [{ createdAt: "asc" }, { id: "asc" }], take: PROJECT_JOB_LIMIT, select: taskSelect,
  });
  const entries = rows.length ? await db.workflowTimeEntry.findMany({
    where: { taskId: { in: rows.map((row) => row.id) }, endedAt: { not: null }, durationSec: { gt: 0 }, task: { organizationId: caller.organizationId } },
    orderBy: [{ startedAt: "asc" }, { id: "asc" }], select: { id: true, taskId: true, durationSec: true, timeTypeId: true },
  }) : [];
  // Beslut 8 (2026-11-01): time of a type the company does not bill is never work a basis can take.
  const { billing } = await timeTypeRules(caller.organizationId);
  const billable = <T extends { timeTypeId: string | null }>(items: readonly T[]) => items.filter((entry) => billing(entry.timeTypeId).billing !== "none");
  const jobOf = (row: TaskRow): InvoiceSourceJob & { status: string } => ({
    id: row.id, title: row.title, status: row.status,
    entries: billable(entries.filter((entry) => entry.taskId === row.id)).map((entry) => ({ id: entry.id, durationSec: entry.durationSec, timeTypeId: entry.timeTypeId })),
    materials: row.kind === "WORK_ORDER" ? materialsFromData(row.data) : [],
  });
  const all = rows.map(jobOf);
  // Projekttid: the project's own finished time is one more source (time:<id>), taken like a finished job's.
  if (subject.kind === "project") {
    const own = await db.workflowTimeEntry.findMany({
      where: { projectId: subject.project.id, endedAt: { not: null }, durationSec: { gt: 0 }, project: { is: { organizationId: caller.organizationId } } },
      orderBy: [{ startedAt: "asc" }, { id: "asc" }], select: { id: true, durationSec: true, timeTypeId: true },
    });
    const ownBillable = billable(own);
    if (ownBillable.length) all.push({ id: `project:${subject.project.id}`, title: "Projekttid", status: "COMPLETED", entries: ownBillable, materials: [] });
  }
  const completed = all.filter((job) => job.status === "COMPLETED");
  return { all, completed, notCompleted: all.filter((job) => !CLOSED.includes(job.status)).length, timeBilling: billing };
}

type Taken = Map<string, { basisId: string; number: number; status: InvoiceBasisStatus }>;
/** Which of the keys are already on a basis of the company (in chunks, so a long project never makes one huge query). */
async function takenSources(db: Db, organizationId: string, keys: readonly string[]): Promise<Taken> {
  const taken: Taken = new Map();
  for (let start = 0; start < keys.length; start += 5000) {
    const rows = await db.invoiceBasisSource.findMany({
      where: { organizationId, sourceKey: { in: keys.slice(start, start + 5000) } },
      select: { sourceKey: true, basis: { select: { id: true, number: true, status: true } } },
    });
    for (const row of rows) taken.set(row.sourceKey, { basisId: row.basis.id, number: row.basis.number, status: row.basis.status });
  }
  return taken;
}

const decimal = (value: Prisma.Decimal | null) => value === null ? null : Number(value.toString());
const customerName = (customer: { name: string; company: string } | null) => customer ? customerTitle(customer) : "";
/** The view's customer: the heading, and the contact person and address as the quote prints them (PDF review 2026-11-03, finding 10). */
type ViewCustomer = { id: string; name: string; company: string; customerType: string; address: string; postalCode: string; city: string };
const customerOf = (customer: ViewCustomer) => {
  const details = quoteCustomerDetails(customer);
  return { id: customer.id, name: customerName(customer), contactName: details.contactName, address: details.address };
};
const customerTypeOf = (customer: { customerType?: string } | null | undefined): QuoteCustomerType => customer?.customerType === "PRIVATE" ? "PRIVATE" : "COMPANY";

/**
 * Omvänd byggmoms and ROT from the accepted quote the work comes from (2026-11-01), so the choice made on the quote
 * follows to the basis; the person can change it. The newest accepted quote of the job, its rows or the project. A choice
 * that no longer fits the customer is left out.
 */
async function taxFromQuote(db: Db, caller: InvoiceBasisCaller, subject: Subject, work: { all: readonly InvoiceSourceJob[] }, customerType: QuoteCustomerType): Promise<{ tax: InvoiceBasisTax; vatPercent: number | null }> {
  const quoteIds = [...new Set(work.all.flatMap((job) => job.materials.flatMap((row) => row.quoteRef?.quoteId ? [row.quoteRef.quoteId] : [])))];
  const orderIds = work.all.map((job) => job.id).filter((id) => !id.startsWith("project:"));
  const quote = await db.quote.findFirst({
    where: { organizationId: caller.organizationId, status: "ACCEPTED", OR: [{ workOrderId: { in: orderIds } }, { id: { in: quoteIds } }, ...(subject.kind === "project" ? [{ projectId: subject.project.id }] : [])] },
    orderBy: [{ number: "desc" }, { version: "desc" }],
    select: { vatPercent: true, rotEnabled: true, rotPercent: true, rotCap: true, lines: { take: 1, orderBy: [{ position: "asc" }, { id: "asc" }], select: { catalogue: true } } },
  });
  if (!quote) return { tax: NO_INVOICE_TAX, vatPercent: null };
  const reverse = quoteReverseVatOf(quote.lines.map((line) => readLineCatalogue(line.catalogue)));
  return invoiceTaxFromQuote({ vatPercent: decimal(quote.vatPercent), reverse, rotEnabled: quote.rotEnabled, rotPercent: decimal(quote.rotPercent), rotCap: decimal(quote.rotCap) }, customerType);
}

async function customerTypeFor(db: Db, organizationId: string, customerId: string | null | undefined): Promise<QuoteCustomerType> {
  if (!customerId) return "COMPANY";
  return customerTypeOf(await db.customer.findFirst({ where: { id: customerId, organizationId }, select: { customerType: true } }));
}

/** With ROT, a built list marks its Arbete lines as the ROT basis, as switching ROT on does on a quote. */
const withRotMarks = (lines: readonly InvoiceBasisLine[], tax: InvoiceBasisTax): InvoiceBasisLine[] => tax.rotEnabled ? lines.map((line) => line.kind === "LABOUR" ? { ...line, rotLabour: true } : line) : [...lines];
/** Without ROT no line keeps the mark. */
const withoutRotMarks = (lines: readonly InvoiceBasisLine[], tax: InvoiceBasisTax): InvoiceBasisLine[] => tax.rotEnabled ? [...lines] : lines.map(({ rotLabour: _mark, ...line }) => { void _mark; return line; });

// ---------- reading ----------

/**
 * The panel on a finished job or a project: its bases (the job's own and the project's that took from it; on a project
 * also its jobs' bases), what a new basis would take now or why none can be made, and what is already marked.
 */
export async function invoiceBasisSummary(caller: InvoiceBasisCaller, ref: InvoiceBasisRef): Promise<InvoiceBasisSummary> {
  requireInvoiceBasis(caller, "read");
  const subject = await loadSubject(prisma, caller, ref);
  const work = await workOf(prisma, caller, subject);
  const allKeys = invoiceSourceKeys(work.all);
  const taken = await takenSources(prisma, caller.organizationId, allKeys);
  const completedKeys = invoiceSourceKeys(work.completed);
  const available = completedKeys.filter((key) => !taken.has(key)).length;
  const takenBy = [...new Set(completedKeys.flatMap((key) => { const hit = taken.get(key); return hit ? [invoiceBasisLabel(hit.number)] : []; }))];
  const takenIds = [...new Set([...taken.values()].map((hit) => hit.basisId))];
  const own: Prisma.InvoiceBasisWhereInput = subject.kind === "task" ? { taskId: subject.task.id } : { OR: [{ projectId: subject.project.id }, { taskId: { in: work.all.map((job) => job.id) } }] };
  const rows = await prisma.invoiceBasis.findMany({
    where: { organizationId: caller.organizationId, OR: [own, ...(takenIds.length ? [{ id: { in: takenIds } }] : [])] },
    orderBy: [{ number: "desc" }], take: INVOICE_BASIS_LIST_LIMIT,
    select: { id: true, number: true, title: true, status: true, vatPercent: true, lines: true, invoicedAt: true, taskId: true, projectId: true, task: { select: { title: true } }, project: { select: { name: true } } },
  });
  const bases = rows.map((row): InvoiceBasisListItem => {
    const totals = invoiceBasisTotals(invoiceBasisLinesOf(row.lines), decimal(row.vatPercent) ?? QUOTE_VAT_PERCENT);
    return {
      id: row.id, number: row.number, label: invoiceBasisLabel(row.number), title: row.title, status: row.status, net: totals.net, unpriced: totals.unpriced,
      invoicedAt: row.invoicedAt?.toISOString() ?? null, scope: row.projectId ? "project" : "task", subjectTitle: row.project?.name ?? row.task?.title ?? "",
    };
  });
  const marked = { invoiced: [] as string[], draft: [] as string[] };
  for (const hit of new Map([...taken.values()].map((item) => [item.basisId, item])).values()) (hit.status === "INVOICED" ? marked.invoiced : marked.draft).push(invoiceBasisLabel(hit.number));
  marked.invoiced.sort(); marked.draft.sort();
  const project = subject.kind === "project";
  return {
    bases, canEdit: invoiceBasisAccess(caller).edit, available,
    newReason: newBasisReason({ project, completedJobs: work.completed.length, candidates: completedKeys.length, available, takenBy }),
    notCompleted: project ? notCompletedText(work.notCompleted) : "",
    quoteNote: quoteNoteText(quoteLabelsOf(work.all), project),
    marked,
  };
}

/** Timpris and Påslag under Priser och offert, for the lines the person adds or prices (filled in as the quote does). */
async function priceDefaultsOf(organizationId: string): Promise<InvoicePriceDefaults> {
  const { hourlyRate, markupPercent, rotPercent, rotCap } = await readPriceSettings(organizationId);
  return { hourlyRate, markupPercent, rotPercent, rotCap };
}

const basisInclude = {
  // The job's project, so a job's basis carries the project in its export too (QA 2026-10-10: the CSV column was empty).
  task: { select: { id: true, title: true, kind: true, formArea: true, data: true, project: { select: { name: true } } } },
  project: { select: { id: true, name: true } },
  customer: { select: { id: true, name: true, company: true, email: true, customerType: true, accountingCustomerNumber: true, address: true, postalCode: true, city: true } },
  facility: { select: { id: true, name: true, address: true, postalCode: true, city: true } },
  _count: { select: { sources: true } },
} satisfies Prisma.InvoiceBasisInclude;
type BasisRow = Prisma.InvoiceBasisGetPayload<{ include: typeof basisInclude }>;
/** The project follows the work order, or the work the basis took; only a basis that took nothing may choose one. */
const projectLockedOf = (row: Pick<BasisRow, "taskId" | "_count">) => Boolean(row.taskId) || row._count.sources > 0;

/** The basis of the caller's company, or 404 (another company's id, or a job/project the person may not read). */
async function readableBasis(db: Db, caller: InvoiceBasisCaller, id: string): Promise<BasisRow> {
  const row = await db.invoiceBasis.findFirst({ where: { id, organizationId: caller.organizationId }, include: basisInclude });
  if (!row) throw new ApiError(404, "Fakturaunderlaget hittades inte.");
  if (row.task && !canRead(caller, workflowSubjectForTask(row.task.kind, row.task.formArea))) throw new ApiError(404, "Fakturaunderlaget hittades inte.");
  if (row.project && !canRead(caller, "projects")) throw new ApiError(404, "Fakturaunderlaget hittades inte.");
  return row;
}

export async function getInvoiceBasis(caller: InvoiceBasisCaller, id: string): Promise<InvoiceBasisView> {
  requireInvoiceBasis(caller, "read");
  const row = await readableBasis(prisma, caller, id);
  // The neutral line about an accepted quote, from the work orders the basis is made on.
  const orders = row.task ? [{ materials: materialsFromData(row.task.data) }] : row.project ? (await prisma.workflowTask.findMany({
    where: { organizationId: caller.organizationId, projectId: row.project.id, kind: "WORK_ORDER" }, take: PROJECT_JOB_LIMIT, select: { data: true },
  })).map((order) => ({ materials: materialsFromData(order.data) })) : [];
  const lines = invoiceBasisLinesOf(row.lines);
  const vatPercent = decimal(row.vatPercent) ?? QUOTE_VAT_PERCENT;
  const tax = invoiceBasisTaxOf(row.lines);
  const customerType = customerTypeOf(row.customer);
  return {
    id: row.id, number: row.number, label: invoiceBasisLabel(row.number), revision: row.revision,
    title: row.title, status: row.status, vatPercent, note: row.note, tax, customerType, lines, totals: invoiceBasisTotals(lines, vatPercent, invoiceBasisRot(tax, customerType)),
    invoicedAt: row.invoicedAt?.toISOString() ?? null, invoicedByName: row.invoicedByName, createdAt: row.createdAt.toISOString(), updatedAt: row.updatedAt.toISOString(),
    task: row.task ? { id: row.task.id, title: row.task.title } : null, project: row.project ? { id: row.project.id, name: row.project.name } : null,
    facility: row.facility ? { id: row.facility.id, name: row.facility.name } : null, projectLocked: projectLockedOf(row),
    customer: row.customer ? customerOf(row.customer) : null,
    canEdit: invoiceBasisAccess(caller).edit && row.status === "DRAFT",
    quoteNote: quoteNoteText(quoteLabelsOf(orders), Boolean(row.project)),
    priceDefaults: await priceDefaultsOf(caller.organizationId),
  };
}

/** What a new basis would take now: the lines built from the untaken work, or 409 with the reason none can be made. */
async function buildNew(db: Db, caller: InvoiceBasisCaller, ref: InvoiceBasisRef, hourlyRate: string) {
  const subject = await loadSubject(db, caller, ref);
  const work = await workOf(db, caller, subject);
  const keys = invoiceSourceKeys(work.completed);
  const taken = await takenSources(db, caller.organizationId, keys);
  const built = linesFromWork(work.completed, { taken: new Set(taken.keys()), hourlyRate, perJob: subject.kind === "project", timeBilling: work.timeBilling });
  if (!built.lines.length) {
    const takenBy = [...new Set([...taken.values()].map((hit) => invoiceBasisLabel(hit.number)))];
    throw new ApiError(409, newBasisReason({ project: subject.kind === "project", completedJobs: work.completed.length, candidates: built.candidates, available: 0, takenBy }));
  }
  return { subject, work, built };
}

/**
 * Nytt fakturaunderlag (QA 2026-10-10): the proposal the person sees and changes before anything is saved – the lines a
 * new basis would take now, with the job's or project's facts. Nothing is written and nothing is taken; Avbryt leaves no
 * trace. `proposal` is the key Skapa underlaget sends back.
 */
export async function invoiceBasisProposal(caller: InvoiceBasisCaller, ref: InvoiceBasisRef): Promise<InvoiceBasisView> {
  requireInvoiceBasis(caller, "edit");
  const priceDefaults = await priceDefaultsOf(caller.organizationId);
  const { subject, work, built } = await buildNew(prisma, caller, ref, priceDefaults.hourlyRate);
  const customerId = subject.kind === "task" ? subject.task.customerId : subject.project.customerId;
  const facilityId = subject.kind === "task" ? subject.task.facilityId : subject.project.facilityId;
  const facility = facilityId ? await prisma.customerFacility.findFirst({ where: { id: facilityId, organizationId: caller.organizationId }, select: { id: true, name: true } }) : null;
  const customer = customerId ? await prisma.customer.findFirst({ where: { id: customerId, organizationId: caller.organizationId }, select: { id: true, name: true, company: true, customerType: true, address: true, postalCode: true, city: true } }) : null;
  const now = new Date().toISOString();
  const customerType = customerTypeOf(customer);
  const carried = await taxFromQuote(prisma, caller, subject, work, customerType);
  const lines = withRotMarks(built.lines, carried.tax);
  const vatPercent = carried.tax.reverseVat ? 0 : carried.vatPercent ?? QUOTE_VAT_PERCENT;
  return {
    id: "", number: 0, label: "", revision: 0,
    title: (subject.kind === "task" ? subject.task.title : subject.project.name).slice(0, 200) || "Fakturaunderlag", status: "DRAFT", vatPercent, note: "",
    tax: carried.tax, customerType,
    lines, totals: invoiceBasisTotals(lines, vatPercent, invoiceBasisRot(carried.tax, customerType)), invoicedAt: null, invoicedByName: "", createdAt: now, updatedAt: now,
    task: subject.kind === "task" ? { id: subject.task.id, title: subject.task.title } : null,
    project: subject.kind === "project" ? { id: subject.project.id, name: subject.project.name } : null,
    facility, projectLocked: true,
    customer: customer ? customerOf(customer) : null,
    canEdit: true, quoteNote: quoteNoteText(quoteLabelsOf(work.all), subject.kind === "project"), priceDefaults,
    proposal: invoiceProposalKey(built.sources),
  };
}

/** Nytt fakturaunderlag from the list (2026-11-14): the empty basis with the company's prices; nothing is saved. */
export async function invoiceBasisBlank(caller: InvoiceBasisCaller): Promise<InvoiceBasisView> {
  requireInvoiceBasis(caller, "edit");
  return blankInvoiceBasisView(await priceDefaultsOf(caller.organizationId));
}

// ---------- writing ----------

const isUniqueViolation = (error: unknown) => error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002";
const TAKEN_MEANWHILE = "Någon annan tog just med samma tid eller material i ett annat fakturaunderlag. Läs in sidan igen.";
const LOCKED = "Underlaget är fakturerat och låst.";
const STALE = "Underlaget har ändrats av någon annan. Läs in det igen.";

const PROPOSAL_CHANGED = "Det som kan faktureras har ändrats sedan förslaget visades (ny tid, nytt material eller ett annat underlag). Förslaget har lästs in igen – granska det och skapa underlaget.";

/**
 * A deleted draft's number stays used (QA 2026-10-10: F-0003 came back after its draft was deleted, and a CSV may already
 * carry it). The deletion is kept in the company's administration history as `invoice_basis_deleted:<number, 10 digits>`,
 * so the highest number ever given is max(the bases, the deleted ones) – read in the same transaction as the new basis.
 */
const DELETED_ACTION = "invoice_basis_deleted:";
const deletedAction = (number: number) => `${DELETED_ACTION}${String(Math.max(0, Math.trunc(number))).padStart(10, "0")}`;
async function nextNumber(db: Db, organizationId: string): Promise<number> {
  const [last, deleted] = await Promise.all([
    db.invoiceBasis.aggregate({ where: { organizationId }, _max: { number: true } }),
    db.administrationEvent.findFirst({ where: { organizationId, action: { startsWith: DELETED_ACTION } }, orderBy: { action: "desc" }, select: { action: true } }),
  ]);
  const deletedNumber = deleted ? Number.parseInt(deleted.action.slice(DELETED_ACTION.length), 10) : 0;
  return Math.max(last._max.number ?? 0, Number.isFinite(deletedNumber) ? deletedNumber : 0) + 1;
}

/**
 * Skapa underlaget: a draft with the company's next number that takes what is not yet taken (one transaction). With
 * `draft` (the page) the basis is the proposal as the person changed it, and it is made only when the work it takes is
 * still what the proposal showed (`proposal`, else 409). Without it (tests) the built lines are kept as they are.
 * Someone who took the same source a moment earlier makes this one stop with 409.
 */
export async function createInvoiceBasis(caller: InvoiceBasisCaller, ref: InvoiceBasisRef, draft?: { proposal: string; basis: unknown }): Promise<{ id: string; label: string }> {
  requireInvoiceBasis(caller, "edit");
  const input = draft ? invoiceBasisInputSchema.parse(draft.basis) : null;
  const { hourlyRate } = await readPriceSettings(caller.organizationId);
  for (let attempt = 0; ; attempt += 1) {
    try {
      return await prisma.$transaction(async (tx) => {
        const { subject, work, built } = await buildNew(tx, caller, ref, hourlyRate);
        if (draft && invoiceProposalKey(built.sources) !== draft.proposal) throw new ApiError(409, PROPOSAL_CHANGED);
        // Omvänd byggmoms and ROT: the person's choice, else what the accepted quote said; the customer decides what may be chosen.
        const customerType = await customerTypeFor(tx, caller.organizationId, subject.kind === "task" ? subject.task.customerId : subject.project.customerId);
        const carried = await taxFromQuote(tx, caller, subject, work, customerType);
        const tax = input?.tax ? invoiceTaxFromInput(input.tax) : carried.tax;
        const problem = invoiceTaxProblem(tax, customerType);
        if (problem) throw new ApiError(422, problem);
        // The person's list: every line keeps what its built line takes; a removed line's sources are taken all the same.
        const marked = withRotMarks(built.lines, tax);
        const lines = input ? withoutRotMarks(mergeLineSources(marked, input.lines), tax) : marked;
        const vatPercent = tax.reverseVat ? 0 : input ? parseShare(input.vatPercent) ?? QUOTE_VAT_PERCENT : carried.vatPercent ?? QUOTE_VAT_PERCENT;
        const number = await nextNumber(tx, caller.organizationId);
        const basis = await tx.invoiceBasis.create({ data: {
          organizationId: caller.organizationId, number,
          ...(subject.kind === "task" ? { taskId: subject.task.id, customerId: subject.task.customerId, facilityId: subject.task.facilityId } : { projectId: subject.project.id, customerId: subject.project.customerId, facilityId: subject.project.facilityId }),
          title: input?.title ?? ((subject.kind === "task" ? subject.task.title : subject.project.name).slice(0, 200) || "Fakturaunderlag"),
          note: input?.note ?? "",
          vatPercent: new Prisma.Decimal(vatPercent.toFixed(2)), lines: invoiceBasisStored(lines, tax) as unknown as Prisma.InputJsonValue,
          createdById: caller.userId, updatedById: caller.userId,
        }, select: { id: true } });
        // ON CONFLICT DO NOTHING: a source another basis took meanwhile is skipped – and then this basis is not made.
        const written = await tx.invoiceBasisSource.createMany({ data: built.sources.map((sourceKey) => ({ organizationId: caller.organizationId, basisId: basis.id, sourceKey })), skipDuplicates: true });
        if (written.count !== built.sources.length) throw new ApiError(409, TAKEN_MEANWHILE);
        return { id: basis.id, label: invoiceBasisLabel(number) };
      });
    } catch (error) {
      // Two bases made at the same moment got the same number: the second takes the next one.
      if (isUniqueViolation(error) && attempt < 3) continue;
      throw error;
    }
  }
}

async function draftRow(db: Db, caller: InvoiceBasisCaller, id: string) {
  const row = await readableBasis(db, caller, id);
  if (row.status !== "DRAFT") throw new ApiError(409, LOCKED);
  return row;
}

/**
 * Kund, plats och projekt on a draft (Grunduppgifter, 2026-11-14): absent keeps what it has. The customer and the place must be
 * the company's and the place the customer's; the project only on a basis that took nothing, and one the person may read.
 */
async function basisLinks(db: Db, caller: InvoiceBasisCaller, row: BasisRow, input: InvoiceBasisInput) {
  const customerId = input.customerId === undefined ? row.customerId : input.customerId;
  const customer = customerId === row.customerId ? row.customer : customerId ? await db.customer.findFirst({ where: { id: customerId, organizationId: caller.organizationId }, select: { id: true, customerType: true } }) : null;
  if (customerId && !customer) throw new ApiError(404, "Kunden hittades inte.");
  // A new customer never keeps the old customer's place.
  let facilityId = input.facilityId === undefined ? (customerId === row.customerId ? row.facilityId : null) : input.facilityId;
  if (!customerId) facilityId = null;
  if (facilityId && (facilityId !== row.facilityId || customerId !== row.customerId)) {
    const place = await db.customerFacility.findFirst({ where: { id: facilityId, organizationId: caller.organizationId }, select: { customerId: true } });
    if (!place || place.customerId !== customerId) throw new ApiError(422, "Platsen hör inte till kunden.");
  }
  let projectId = row.projectId;
  if (input.projectId !== undefined && input.projectId !== row.projectId) {
    if (projectLockedOf(row)) throw new ApiError(409, "Projektet följer arbetet i underlaget och ändras inte här.");
    if (input.projectId) {
      if (!canRead(caller, "projects")) throw new ApiError(403, "Du saknar behörighet att läsa projekt.");
      const project = await db.project.findFirst({ where: { id: input.projectId, organizationId: caller.organizationId }, select: { id: true } });
      if (!project) throw new ApiError(404, "Projektet hittades inte.");
    }
    projectId = input.projectId;
  }
  return { customerId, facilityId, projectId, customerType: customerTypeOf(customer) };
}

/** Spara: the draft's title, note, VAT and lines, replaced as a whole; `revision` is the one the person started from. */
export async function saveInvoiceBasis(caller: InvoiceBasisCaller, id: string, revision: number, raw: unknown): Promise<{ id: string; revision: number }> {
  requireInvoiceBasis(caller, "edit");
  const input = invoiceBasisInputSchema.parse(raw);
  return prisma.$transaction(async (tx) => {
    const row = await draftRow(tx, caller, id);
    const links = await basisLinks(tx, caller, row, input);
    // Omvänd byggmoms and ROT: absent keeps what the basis has (a tool that does not know them changes nothing).
    const tax = input.tax ? invoiceTaxFromInput(input.tax) : invoiceBasisTaxOf(row.lines);
    const problem = invoiceTaxProblem(tax, links.customerType);
    if (problem) throw new ApiError(422, problem);
    const lines = withoutRotMarks(mergeLineSources(invoiceBasisLinesOf(row.lines), input.lines), tax);
    const vatPercent = tax.reverseVat ? 0 : parseShare(input.vatPercent) ?? QUOTE_VAT_PERCENT;
    const changed = await tx.invoiceBasis.updateMany({
      where: { id, organizationId: caller.organizationId, revision, status: "DRAFT" },
      data: { title: input.title, note: input.note, customerId: links.customerId, facilityId: links.facilityId, projectId: links.projectId, vatPercent: new Prisma.Decimal(vatPercent.toFixed(2)), lines: invoiceBasisStored(lines, tax) as unknown as Prisma.InputJsonValue, updatedById: caller.userId, revision: { increment: 1 } },
    });
    if (!changed.count) throw new ApiError(409, STALE);
    return { id, revision: revision + 1 };
  });
}

/**
 * Markera som fakturerat: the draft becomes Fakturerat with the day and who, and is locked from then on (here and by the
 * database). Without `revision` (after a send to Fortnox) the latest saved version is marked.
 */
export async function markInvoiceBasisInvoiced(caller: InvoiceBasisCaller, id: string, revision: number | null, now = new Date()): Promise<{ id: string; revision: number }> {
  requireInvoiceBasis(caller, "edit");
  return prisma.$transaction(async (tx) => {
    const row = await draftRow(tx, caller, id);
    // Locked from now on: a line without a price (or no line at all) could never be invoiced afterwards (QA 2026-10-10).
    const tax = invoiceBasisTaxOf(row.lines);
    const lines = invoiceBasisLinesOf(row.lines);
    const problem = invoiceReadyProblem(lines, tax);
    if (problem) throw new ApiError(422, invoiceReadyProblem(lines) ? `${problem} Sätt pris på alla rader innan underlaget markeras som fakturerat.` : problem);
    const changed = await tx.invoiceBasis.updateMany({
      where: { id, organizationId: caller.organizationId, status: "DRAFT", ...(revision === null ? {} : { revision }) },
      data: { status: "INVOICED", invoicedAt: now, invoicedById: caller.userId, invoicedByName: (caller.userName ?? "").slice(0, 200), updatedById: caller.userId, revision: { increment: 1 } },
    });
    if (!changed.count) throw new ApiError(409, STALE);
    return { id, revision: row.revision + 1 };
  });
}

/**
 * Ta bort underlaget: only a draft; everything it took is free again (its sources go with it). Its number is never given
 * again: the deletion is written to the administration history in the same transaction.
 */
export async function deleteInvoiceBasis(caller: InvoiceBasisCaller, id: string): Promise<void> {
  requireInvoiceBasis(caller, "edit");
  await prisma.$transaction(async (tx) => {
    const row = await draftRow(tx, caller, id);
    const removed = await tx.invoiceBasis.deleteMany({ where: { id, organizationId: caller.organizationId, status: "DRAFT" } });
    if (!removed.count) throw new ApiError(409, LOCKED);
    await tx.administrationEvent.create({ data: {
      organizationId: caller.organizationId, actorId: caller.userId, action: deletedAction(row.number),
      detail: `Tog bort utkastet till fakturaunderlag ${invoiceBasisLabel(row.number)} (${row.title}). Numret används inte igen.`.slice(0, 500),
    } });
  });
}

/**
 * A basis without a job or project (2026-11-05: an invoice can be made from nothing). It takes no sources, so nothing can be
 * invoiced twice through it; the lines are written in the ordinary basis view. Refused for a customer in another company.
 */
export async function createStandaloneInvoiceBasis(caller: InvoiceBasisCaller, input: { customerId?: string | null; title: string }): Promise<{ id: string; label: string }> {
  requireInvoiceBasis(caller, "edit");
  for (let attempt = 0; ; attempt += 1) {
    try {
      return await prisma.$transaction(async (tx) => {
        // Nytt fakturaunderlag is saved at the first change (2026-11-14): the customer may come later; the invoice needs one.
        const customer = input.customerId ? await tx.customer.findFirst({ where: { id: input.customerId, organizationId: caller.organizationId }, select: { id: true } }) : null;
        if (input.customerId && !customer) throw new ApiError(404, "Kunden hittades inte.");
        const number = await nextNumber(tx, caller.organizationId);
        const basis = await tx.invoiceBasis.create({ data: {
          organizationId: caller.organizationId, number, customerId: customer?.id ?? null, title: input.title.trim().slice(0, 200) || "Faktura",
          vatPercent: new Prisma.Decimal(QUOTE_VAT_PERCENT.toFixed(2)), lines: invoiceBasisStored([], NO_INVOICE_TAX) as unknown as Prisma.InputJsonValue, createdById: caller.userId, updatedById: caller.userId,
        }, select: { id: true } });
        return { id: basis.id, label: invoiceBasisLabel(number) };
      });
    } catch (error) {
      if (isUniqueViolation(error) && attempt < 3) continue;
      throw error;
    }
  }
}

// ---------- the invoice made from a basis (2026-11-04, ee/customer-invoice) ----------

/** What an invoice takes from a basis: the same read as the page, with the buyer as it stands today and when the work ended. */
export async function readableBasisForInvoice(db: Db, caller: InvoiceBasisCaller, id: string) {
  const row = await readableBasis(db, caller, id);
  const details = quoteCustomerDetails(row.customer);
  const tasks = row.task ? await db.workflowTask.findMany({ where: { id: row.task.id, organizationId: caller.organizationId }, select: { startedAt: true, completedAt: true } })
    : row.project ? await db.workflowTask.findMany({ where: { organizationId: caller.organizationId, projectId: row.project.id, completedAt: { not: null } }, take: PROJECT_JOB_LIMIT, select: { startedAt: true, completedAt: true } }) : [];
  const day = (value: Date) => value.toLocaleDateString("sv-SE", { timeZone: "Europe/Stockholm" });
  const started = tasks.flatMap((task) => task.startedAt ? [day(task.startedAt)] : []).sort();
  const ended = tasks.flatMap((task) => task.completedAt ? [day(task.completedAt)] : []).sort();
  return {
    number: row.number, title: row.title, status: row.status, revision: row.revision, customerId: row.customerId, vatPercent: decimal(row.vatPercent) ?? QUOTE_VAT_PERCENT,
    lines: invoiceBasisLinesOf(row.lines), tax: invoiceBasisTaxOf(row.lines),
    buyer: { name: details.name, contactName: details.contactName, address: details.address, customerType: customerTypeOf(row.customer) },
    buyerEmail: row.customer?.email ?? "",
    /** Arbetsplatsen: the basis’s place when it names one (Plats, 2026-11-14), else the buyer’s address. */
    workPlace: row.facility ? [row.facility.name, row.facility.address, [row.facility.postalCode, row.facility.city].filter(Boolean).join(" ")].filter((part) => part.trim()).join(", ") : details.address,
    // Without a job or project nothing says when the work ended: today is the proposal, and the person changes it.
    performedFrom: started[0] ?? "", performedOn: ended.at(-1) ?? (row.task || row.project ? "" : todayInSweden()),
  };
}

/** The basis of an invoice just issued: Fakturerat and locked, in the invoice's transaction. */
export async function markBasisIssued(db: Prisma.TransactionClient, caller: InvoiceBasisCaller, id: string, revision: number, now = new Date()) {
  const changed = await db.invoiceBasis.updateMany({
    where: { id, organizationId: caller.organizationId, status: "DRAFT", revision },
    data: { status: "INVOICED", invoicedAt: now, invoicedById: caller.userId, invoicedByName: (caller.userName ?? "").slice(0, 200), updatedById: caller.userId, revision: { increment: 1 } },
  });
  if (!changed.count) throw new ApiError(409, STALE);
}

/**
 * A new draft with the lines of a basis whose invoice was credited, to correct and invoice again. It takes no sources: the first
 * basis keeps what it took, so nothing can be on two bases.
 */
export async function createCorrectionBasis(db: Prisma.TransactionClient, caller: InvoiceBasisCaller, fromId: string, invoiceLabel: string): Promise<string> {
  const from = await db.invoiceBasis.findFirst({ where: { id: fromId, organizationId: caller.organizationId } });
  if (!from) throw new ApiError(404, "Fakturaunderlaget hittades inte.");
  const lines = invoiceBasisLinesOf(from.lines).map((line) => ({ ...line, sources: [] as string[] }));
  const basis = await db.invoiceBasis.create({ data: {
    organizationId: caller.organizationId, number: await nextNumber(db, caller.organizationId), taskId: from.taskId, projectId: from.projectId, customerId: from.customerId,
    title: from.title, note: `Rättar den krediterade fakturan ${invoiceLabel}.`.slice(0, 2000), vatPercent: from.vatPercent,
    lines: invoiceBasisStored(lines, invoiceBasisTaxOf(from.lines)) as unknown as Prisma.InputJsonValue, createdById: caller.userId, updatedById: caller.userId,
  }, select: { id: true } });
  return basis.id;
}

// ---------- export ----------

/** The basis as the shared export builders read it (lib/quotes/accounting.ts): the date is the invoiced day, else today. */
export async function accountingInvoiceBasis(caller: InvoiceBasisCaller, id: string, today = todayInSweden()): Promise<AccountingQuote> {
  requireInvoiceBasis(caller, "read");
  const row = await readableBasis(prisma, caller, id);
  const tax = invoiceBasisTaxOf(row.lines);
  return {
    rot: invoiceBasisRot(tax, customerTypeOf(row.customer)),
    ...(tax.reverseVat ? { reverseVat: true, buyerVatNumber: tax.buyerVatNumber } : {}),
    document: "invoice_basis", id: row.id, label: invoiceBasisLabel(row.number), title: row.title, status: row.status === "INVOICED" ? "INVOICED" : "DRAFT",
    date: row.invoicedAt ? todayInSweden(row.invoicedAt) : today,
    customerName: customerName(row.customer), customerNumber: row.customer?.accountingCustomerNumber.trim() ?? "", projectName: row.project?.name ?? row.task?.project?.name ?? "", vatPercent: decimal(row.vatPercent) ?? QUOTE_VAT_PERCENT,
    lines: invoiceBasisLinesOf(row.lines).map((line) => ({ articleNo: line.articleNo ?? "", kind: line.kind, name: line.name, quantity: line.quantity, unit: line.unit, unitPrice: line.unitPrice, markupPercent: line.markupPercent, rotLabour: Boolean(line.rotLabour) })),
  };
}

// ---------- the company's list ----------

/**
 * Fakturaunderlag, the company's list (2026-10-28): the same right as the panel (admin or Offerter – läsa), and
 * only the bases whose job or project the person may read – the rule of `readableBasis`, as a query (a basis whose job
 * or project was deleted is read like that one). Bounded: one page of 25, newest number first. Toppvisningen (
 * 2026-10-31): `mine` = the bases I made, `sort` (INVOICE_BASIS_SORTS) and, with `counts`, the number per status filter.
 */
export async function listInvoiceBases(caller: InvoiceBasisCaller, options: { filter: InvoiceBasisFilter; page: number; q: string; mine?: boolean; sort?: InvoiceBasisSort; counts?: boolean }): Promise<InvoiceBasisPage> {
  requireInvoiceBasis(caller, "read");
  const page = Math.min(INVOICE_BASIS_MAX_PAGE, Math.max(1, Math.trunc(options.page) || 1));
  const readable: Prisma.InvoiceBasisWhereInput[] = [
    { taskId: null, projectId: null },
    { task: { is: readableTaskWhere((area) => canRead(caller, area)) } },
    ...(canRead(caller, "projects") ? [{ projectId: { not: null } }] : []),
  ];
  const number = invoiceBasisNumberSearch(options.q);
  const words = options.q && number === null ? options.q.split(/\s+/).slice(0, 5) : [];
  const contains = (word: string) => ({ contains: word, mode: "insensitive" as const });
  const whereFor = (filter: InvoiceBasisFilter): Prisma.InvoiceBasisWhereInput => ({
    organizationId: caller.organizationId,
    ...(filter === "all" ? {} : { status: filter }),
    ...(options.mine ? { createdById: caller.userId } : {}),
    AND: [
      { OR: readable },
      ...(number !== null ? [{ number }] : words.map((word) => ({ OR: [
        { title: contains(word) },
        { customer: { is: { OR: [{ name: contains(word) }, { company: contains(word) }] } } },
        { project: { is: { name: contains(word) } } },
        { task: { is: { title: contains(word) } } },
      ] }))),
    ],
  });
  const where = whereFor(options.filter);
  const orderBy: Prisma.InvoiceBasisOrderByWithRelationInput[] = options.sort === "updated" ? [{ updatedAt: "desc" }, { number: "desc" }] : options.sort === "title" ? [{ title: "asc" }, { number: "desc" }] : [{ number: "desc" }];
  const [rows, total, counts] = await Promise.all([
    prisma.invoiceBasis.findMany({
      where, orderBy, skip: (page - 1) * INVOICE_BASIS_PAGE_SIZE, take: INVOICE_BASIS_PAGE_SIZE + 1,
      select: { id: true, number: true, title: true, status: true, vatPercent: true, lines: true, invoicedAt: true, createdAt: true, taskId: true, projectId: true,
        task: { select: { title: true } }, project: { select: { name: true } }, customer: { select: { name: true, company: true, customerType: true } } },
    }),
    prisma.invoiceBasis.count({ where }),
    options.counts ? Promise.all(INVOICE_BASIS_FILTERS.map(async (filter) => [filter, await prisma.invoiceBasis.count({ where: whereFor(filter) })] as const)).then((pairs) => Object.fromEntries(pairs) as Record<InvoiceBasisFilter, number>) : Promise.resolve(null),
  ]);
  const items = rows.slice(0, INVOICE_BASIS_PAGE_SIZE).map((row): InvoiceBasisRow => {
    const totals = invoiceBasisTotals(invoiceBasisLinesOf(row.lines), decimal(row.vatPercent) ?? QUOTE_VAT_PERCENT);
    return {
      id: row.id, number: row.number, label: invoiceBasisLabel(row.number), title: row.title, status: row.status, net: totals.net, unpriced: totals.unpriced,
      invoicedAt: row.invoicedAt?.toISOString() ?? null, scope: row.projectId ? "project" : "task", subjectTitle: row.project?.name ?? row.task?.title ?? "",
      customerName: customerName(row.customer), taskId: row.taskId, projectId: row.projectId, createdAt: row.createdAt.toISOString(),
    };
  });
  return { items, total, page, pageSize: INVOICE_BASIS_PAGE_SIZE, hasMore: rows.length > INVOICE_BASIS_PAGE_SIZE, canEdit: invoiceBasisAccess(caller).edit, counts };
}
