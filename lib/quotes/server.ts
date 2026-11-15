import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { ApiError } from "@/lib/kfid/errors";
import { todayInSweden } from "@/lib/catalogue/snapshot";
import { hasWorkflowPermission, type WorkflowPermissionProfile } from "@/lib/workflow/permissions";
import { parseAmount } from "@/lib/workflow/expenses";
import { parsePercent } from "@/lib/workflow/material-prices";
import { addDays, priceSettingsOf, priceSettingsSchema, type PriceSettings } from "./settings";
import { timeTypePoliciesOf } from "@/lib/workflow/time-types";
import { quoteAcceptanceMethodLabel } from "./acceptance";
import { customerLinkSummaryState } from "./customer-link";
import { quoteCustomerDetails } from "./customer-details";
import {
  quoteReverseVatOf, effectiveQuoteStatus, placeAddress, numberText, parseKronor, parseShare, QUOTE_PAGE_SIZE, lineCatalogueJson, readLineCatalogue, QUOTE_VAT_PERCENT, quoteActionError, quoteActions, quoteInputSchema, quoteLabel, quoteRotOf, quoteSendIssues, quoteTotals, quoteVersionDiff,
  QUOTE_FILTERS, type QuoteAction, type QuoteFilter, type QuoteInput, type QuoteLineKind, type QuoteLineView, type QuoteListItem, type QuoteSort, type QuoteStatus, type QuoteView,
} from "./model";
import { splitPage } from "@/lib/list-filter";
import { customerTitle } from "@/lib/kfid/customer-name";

/**
 * Offert (2026-10-09, steg B) on the server. Every query is bound to the caller's company; a quote's lines point
 * at it through [quoteId, organizationId], and triggers check that its customer, place and project are the company's
 * own (migration 20261011300000_quotes). The right "Offerter" decides: read = the list, a quote with its purchase
 * prices and markup, and its PDF; edit = everything that changes a quote. Cloud only – a Local company is told so.
 * A sent quote is locked here and in the database; a change is made as a new version with the same number.
 */
export type QuoteCaller = { organizationId: string; userId: string; admin: boolean; permissions: WorkflowPermissionProfile; storageMode: string };

export function quoteAccess(caller: Pick<QuoteCaller, "admin" | "permissions">) {
  const can = (action: "read" | "edit") => caller.admin || hasWorkflowPermission(caller.permissions, "quotes", action);
  return { read: can("read"), edit: can("edit") };
}

export function requireQuotes(caller: Pick<QuoteCaller, "admin" | "permissions" | "storageMode">, need: "read" | "edit") {
  if (caller.storageMode !== "HINTEK_CLOUD") throw new ApiError(409, "Offerter finns bara med serverlagring.");
  if (!quoteAccess(caller)[need]) throw new ApiError(403, need === "edit" ? "Du saknar behörighet att ändra offerter." : "Du saknar behörighet att se offerter.");
}

// ---------- price settings ----------

export async function readPriceSettings(organizationId: string): Promise<PriceSettings> {
  const row = await prisma.workspaceSettings.findUnique({ where: { organizationId }, select: { priceSettings: true } });
  return priceSettingsOf(row?.priceSettings);
}

/** Only the company's admin changes the settings (Inställningar → Priser och offert). */
export async function writePriceSettings(caller: Pick<QuoteCaller, "organizationId" | "admin">, input: unknown): Promise<PriceSettings> {
  if (!caller.admin) throw new ApiError(403, "Bara en företagsadministratör kan göra det.");
  const settings = priceSettingsSchema.parse(input);
  // What the company has decided per type of time lives in the same column (beslut 8) and is changed under Tid: it stays.
  const row = await prisma.workspaceSettings.findUnique({ where: { organizationId: caller.organizationId }, select: { priceSettings: true } });
  const priceSettings = { ...settings, timeTypePolicies: timeTypePoliciesOf(row?.priceSettings) };
  await prisma.workspaceSettings.upsert({
    where: { organizationId: caller.organizationId },
    create: { organizationId: caller.organizationId, priceSettings },
    update: { priceSettings },
  });
  return settings;
}

// ---------- reading ----------

const lineSelect = { id: true, kind: true, name: true, quantity: true, unit: true, unitPrice: true, markupPercent: true, catalogue: true, rotLabour: true, position: true } as const;
const quoteInclude = {
  customer: { select: { id: true, name: true, company: true, customerType: true, address: true, postalCode: true, city: true } },
  facility: { select: { id: true, name: true, address: true, postalCode: true, city: true } },
  project: { select: { id: true, name: true } },
  workOrder: { select: { id: true, title: true, status: true } },
  lines: { orderBy: [{ position: "asc" as const }, { id: "asc" as const }], select: lineSelect },
} satisfies Prisma.QuoteInclude;
type QuoteRow = Prisma.QuoteGetPayload<{ include: typeof quoteInclude }>;
type LineRow = QuoteRow["lines"][number];

const decimal = (value: Prisma.Decimal | null) => value === null ? null : Number(value.toString());
const lineNumbers = (line: Pick<LineRow, "kind" | "quantity" | "unitPrice" | "markupPercent"> & { rotLabour?: boolean }) => ({ kind: line.kind as QuoteLineKind, quantity: decimal(line.quantity) ?? 0, unitPrice: decimal(line.unitPrice), markupPercent: decimal(line.markupPercent), rotLabour: Boolean(line.rotLabour) });
/** The quote's ROT as stored (null unless a private person's quote with ROT and readable figures). */
const rotOfRow = (row: { customerType: string; rotEnabled: boolean; rotPercent: Prisma.Decimal | null; rotCap: Prisma.Decimal | null }) =>
  quoteRotOf({ customerType: row.customerType === "PRIVATE" ? "PRIVATE" : "COMPANY", rotEnabled: row.rotEnabled, rotPercent: decimal(row.rotPercent), rotCap: decimal(row.rotCap) });
/** Who may read and create work orders (Arbetsorder – läsa / skapa); the quote right alone never reaches work orders. */
export const workOrderAccess = (caller: Pick<QuoteCaller, "admin" | "permissions">) => ({
  read: caller.admin || hasWorkflowPermission(caller.permissions, "work-order", "read"),
  create: caller.admin || hasWorkflowPermission(caller.permissions, "work-order", "create"),
});
const customerName = (customer: { name: string; company: string } | null) => customer ? customerTitle(customer) : "";

/**
 * Ögonblicksbild av kunden (plan 1D, 2026-10-11): a sent quote keeps the customer's name, contact person and address as
 * they were when it was sent (`sentCustomer*`, migration 20261012150000), so the PDF, the quote page and the customer's
 * page never change afterwards. An older sent quote without the snapshot, and every draft, reads the register.
 */
type SnapshotRow = { sentCustomerName: string | null; sentCustomerContact: string | null; sentCustomerAddress: string | null };
export function sentCustomerDetails(row: SnapshotRow, customer: Parameters<typeof quoteCustomerDetails>[0]) {
  if (row.sentCustomerName !== null) return { name: row.sentCustomerName, contactName: row.sentCustomerContact ?? "", address: row.sentCustomerAddress ?? "" };
  return quoteCustomerDetails(customer);
}
/** The snapshot to write when a quote is sent: the customer as the register has it now (empty strings without a customer). */
export const customerSnapshotData = (customer: Parameters<typeof quoteCustomerDetails>[0]) => {
  const details = quoteCustomerDetails(customer);
  return { sentCustomerName: details.name, sentCustomerContact: details.contactName, sentCustomerAddress: details.address };
};

export const lineView = (line: LineRow): QuoteLineView => ({
  id: line.id, kind: line.kind as QuoteLineKind, name: line.name, quantity: numberText(line.quantity), unit: line.unit,
  unitPrice: numberText(line.unitPrice), markupPercent: numberText(line.markupPercent), ...readLineCatalogue(line.catalogue),
  ...(line.rotLabour ? { rotLabour: true } : {}),
});

async function versionsOf(organizationId: string, number: number) {
  return prisma.quote.findMany({ where: { organizationId, number }, orderBy: { version: "asc" }, select: { id: true, version: true, status: true, validUntil: true } });
}

const reverseVatFields = (lines: readonly QuoteLineView[]) => { const reverse = quoteReverseVatOf(lines); return reverse ? { reverseVat: true, buyerVatNumber: reverse.buyerVatNumber } : {}; };

function toView(row: QuoteRow, versions: { id: string; version: number; status: QuoteStatus; validUntil: string }[], caller: QuoteCaller, today: string, base: LineRow[] | null = null, workOrders: WorkOrderLink[] = []): QuoteView {
  const status = effectiveQuoteStatus({ status: row.status, validUntil: row.validUntil }, today);
  const superseded = Boolean(row.supersededAt);
  const canEdit = quoteAccess(caller).edit;
  return {
    id: row.id, number: row.number, version: row.version, label: quoteLabel(row), revision: row.revision,
    title: row.title, description: row.description, status, storedStatus: row.status, validUntil: row.validUntil, terms: row.terms, vatPercent: decimal(row.vatPercent) ?? QUOTE_VAT_PERCENT,
    customer: row.customer ? { id: row.customer.id, ...sentCustomerDetails(row, row.customer) } : row.sentCustomerName ? { id: "", ...sentCustomerDetails(row, null) } : null,
    facility: row.facility ? { id: row.facility.id, name: row.facility.name, address: placeAddress(row.facility) } : null,
    project: row.project ? { id: row.project.id, name: row.project.name } : null,
    customerType: row.customerType === "PRIVATE" ? "PRIVATE" : "COMPANY", rotEnabled: row.rotEnabled, rotPercent: decimal(row.rotPercent), rotCap: decimal(row.rotCap),
    changeOfVersion: row.changeOfVersion,
    change: base ? quoteVersionDiff(base.map((line) => ({ ...lineNumbers(line), name: line.name, unit: line.unit })), row.lines.map((line) => ({ ...lineNumbers(line), name: line.name, unit: line.unit }))) : null,
    ...(base ? { changeBase: base.map(lineView) } : {}),
    workOrder: row.workOrder && workOrderAccess(caller).read ? { id: row.workOrder.id, title: row.workOrder.title } : null,
    workOrders: workOrderAccess(caller).read ? workOrders.map((order) => ({ id: order.id, title: order.title, status: order.status })) : [],
    canCreateWorkOrder: row.status === "ACCEPTED" && workOrderAccess(caller).create && caller.storageMode === "HINTEK_CLOUD",
    lines: row.lines.map(lineView),
    ...reverseVatFields(row.lines.map(lineView)),
    totals: quoteTotals(row.lines.map(lineNumbers), decimal(row.vatPercent) ?? QUOTE_VAT_PERCENT, rotOfRow(row)),
    sentAt: row.sentAt?.toISOString() ?? null, decidedAt: row.decidedAt?.toISOString() ?? null, createdAt: row.createdAt.toISOString(), updatedAt: row.updatedAt.toISOString(), superseded,
    versions: versions.map((item) => ({ id: item.id, version: item.version, status: effectiveQuoteStatus(item, today) })),
    actions: canEdit ? quoteActions({ status: row.status, validUntil: row.validUntil, superseded }, today) : [],
    canEdit,
  };
}

export type WorkOrderLink = { id: string; title: string; status: string };
/**
 * Every work order made from the quote (plan 1D: not only the latest one the quote links to). They are found through
 * their material rows' `quoteRef.quoteId` (jsonb containment, no schema change) and the quote's own link, within the
 * company only; newest first, bounded.
 */
export async function workOrdersOfQuote(organizationId: string, quoteId: string, linked: WorkOrderLink | null): Promise<WorkOrderLink[]> {
  const rows = await prisma.workflowTask.findMany({
    where: { organizationId, kind: "WORK_ORDER", data: { path: ["details", "materials"], array_contains: [{ quoteRef: { quoteId } }] } },
    orderBy: [{ createdAt: "desc" }, { id: "asc" }], take: 100, select: { id: true, title: true, status: true },
  });
  const seen = new Set(rows.map((row) => row.id));
  return linked && !seen.has(linked.id) ? [linked, ...rows] : rows;
}

/** One quote of the caller's company, or 404 (also for another company's id). */
export async function getQuote(caller: QuoteCaller, id: string, today = todayInSweden()): Promise<QuoteView> {
  requireQuotes(caller, "read");
  const row = await prisma.quote.findFirst({ where: { id, organizationId: caller.organizationId }, include: quoteInclude });
  if (!row) throw new ApiError(404, "Offerten hittades inte.");
  const workOrders = workOrderAccess(caller).read ? await workOrdersOfQuote(caller.organizationId, row.id, row.workOrder) : [];
  // ÄTA: the accepted version it changes, to show what is changed.
  const base = row.changeOfVersion ? await prisma.quote.findFirst({ where: { organizationId: caller.organizationId, number: row.number, version: row.changeOfVersion }, select: { lines: { orderBy: [{ position: "asc" }, { id: "asc" }], select: lineSelect } } }) : null;
  // Offert per e-post (steg E): the latest link to the customer and the customer's answer, for the company's eyes.
  const [link, response] = await Promise.all([
    prisma.quoteLink.findFirst({ where: { organizationId: caller.organizationId, quoteId: row.id }, orderBy: [{ sentAt: "desc" }, { id: "desc" }], select: { email: true, sentAt: true, validUntil: true, openedAt: true, usedAt: true, revokedAt: true, quoteVersion: true } }),
    prisma.quoteResponse.findFirst({ where: { organizationId: caller.organizationId, quoteId: row.id }, select: { decision: true, signerName: true, reason: true, acceptanceMethod: true, createdAt: true } }),
  ]);
  return {
    ...toView(row, await versionsOf(caller.organizationId, row.number), caller, today, base?.lines ?? null, workOrders),
    customerLink: link ? {
      email: link.email, sentAt: link.sentAt.toISOString(), validUntil: link.validUntil, openedAt: link.openedAt?.toISOString() ?? null,
      state: customerLinkSummaryState(link, { version: row.version, superseded: Boolean(row.supersededAt) }, today),
    } : null,
    customerResponse: response ? {
      decision: response.decision, name: response.signerName, reason: response.reason, method: response.acceptanceMethod,
      methodLabel: quoteAcceptanceMethodLabel(response.acceptanceMethod), at: response.createdAt.toISOString(),
    } : null,
  };
}

/** The status filter as a query: "open" = drafts and sent quotes still valid; a status as the person reads it. */
function statusWhere(filter: QuoteFilter, today: string): Prisma.QuoteWhereInput {
  const valid: Prisma.QuoteWhereInput = { OR: [{ validUntil: "" }, { validUntil: { gte: today } }] };
  if (filter === "all") return {};
  if (filter === "open") return { OR: [{ status: "DRAFT" }, { status: "SENT", ...valid }] };
  if (filter === "SENT") return { status: "SENT", ...valid };
  if (filter === "EXPIRED") return { OR: [{ status: "EXPIRED" }, { status: "SENT", validUntil: { not: "", lt: today } }] };
  return { status: filter };
}

/**
 * The list (bounded, newest change first, "Visa fler"): the latest version of every quote, or every version with
 * `versions`. `mine` = quotes the caller created. The search looks in the title, the number and the customer's name.
 * Toppvisningen (2026-10-31): `sort` (QUOTE_SORTS) and, with `counts`, the number per status filter with the same
 * scope and search – the chips' counts (the caller decides when they are given, as workListCountsAllowed).
 */
export async function listQuotes(caller: QuoteCaller, options: { q?: string; filter?: QuoteFilter; page?: number; mine?: boolean; projectId?: string; customerId?: string; sort?: QuoteSort; counts?: boolean } = {}, today = todayInSweden()) {
  requireQuotes(caller, "read");
  const page = Math.max(1, Math.min(1000, Math.trunc(options.page ?? 1) || 1));
  const q = (options.q ?? "").trim().slice(0, 100);
  const numberMatch = /^o?-?0*(\d{1,9})$/i.exec(q.replace(/\s+/g, ""));
  const words = q ? q.split(/\s+/).slice(0, 5) : [];
  const search: Prisma.QuoteWhereInput[] = numberMatch ? [{ number: Number(numberMatch[1]) }] : words.map((word) => ({ OR: [
    { title: { contains: word, mode: "insensitive" as const } },
    { customer: { is: { OR: [{ name: { contains: word, mode: "insensitive" as const } }, { company: { contains: word, mode: "insensitive" as const } }] } } },
    { project: { is: { name: { contains: word, mode: "insensitive" as const } } } },
  ] }));
  const base: Prisma.QuoteWhereInput = {
    organizationId: caller.organizationId, supersededAt: null,
    ...(options.mine ? { createdById: caller.userId } : {}),
    ...(options.projectId ? { projectId: options.projectId } : {}),
    ...(options.customerId ? { customerId: options.customerId } : {}),
  };
  const whereFor = (filter: QuoteFilter, extra: Prisma.QuoteWhereInput[] = []): Prisma.QuoteWhereInput => ({ ...base, AND: [statusWhere(filter, today), ...search, ...extra] });
  const where = whereFor(options.filter ?? "open");
  const include = { customer: { select: { name: true, company: true, customerType: true } }, project: { select: { name: true } }, lines: { select: { kind: true, quantity: true, unitPrice: true, markupPercent: true } } } as const;
  const skip = (page - 1) * QUOTE_PAGE_SIZE, take = QUOTE_PAGE_SIZE + 1;
  const sort = options.sort ?? "updated";
  // Närmaste datum: the quotes with a Giltig till first, nearest first, then those without, newest change first – two
  // reads joined (an empty Giltig till is "" in the table, which an ORDER BY would put first).
  const readRows = async () => {
    if (sort !== "due") {
      const orderBy: Prisma.QuoteOrderByWithRelationInput[] = sort === "title" ? [{ title: "asc" }, { id: "asc" }] : sort === "number" ? [{ number: "desc" }, { id: "asc" }] : [{ updatedAt: "desc" }, { id: "asc" }];
      return prisma.quote.findMany({ where, orderBy, skip, take, include });
    }
    const datedWhere = whereFor(options.filter ?? "open", [{ validUntil: { not: "" } }]);
    const window = splitPage(await prisma.quote.count({ where: datedWhere }), skip, take);
    const [dated, undated] = await Promise.all([
      window.first.take ? prisma.quote.findMany({ where: datedWhere, orderBy: [{ validUntil: "asc" }, { updatedAt: "desc" }, { id: "asc" }], skip: window.first.skip, take: window.first.take, include }) : [],
      window.second.take ? prisma.quote.findMany({ where: whereFor(options.filter ?? "open", [{ validUntil: "" }]), orderBy: [{ updatedAt: "desc" }, { id: "asc" }], skip: window.second.skip, take: window.second.take, include }) : [],
    ]);
    return [...dated, ...undated];
  };
  const [rows, total, counts] = await Promise.all([
    readRows(),
    prisma.quote.count({ where }),
    options.counts ? Promise.all(QUOTE_FILTERS.map(async (filter) => [filter, await prisma.quote.count({ where: whereFor(filter) })] as const)).then((pairs) => Object.fromEntries(pairs) as Record<QuoteFilter, number>) : Promise.resolve(null),
  ]);
  const items: QuoteListItem[] = rows.slice(0, QUOTE_PAGE_SIZE).map((row) => {
    const totals = quoteTotals(row.lines.map(lineNumbers), decimal(row.vatPercent) ?? QUOTE_VAT_PERCENT);
    return {
      id: row.id, number: row.number, version: row.version, label: quoteLabel(row), title: row.title,
      status: effectiveQuoteStatus({ status: row.status, validUntil: row.validUntil }, today), validUntil: row.validUntil,
      customerName: customerName(row.customer), projectName: row.project?.name ?? "", net: totals.net, gross: totals.gross, unpriced: totals.unpriced, updatedAt: row.updatedAt.toISOString(),
      changeOfVersion: row.changeOfVersion,
    };
  });
  return { items, total, page, pageSize: QUOTE_PAGE_SIZE, hasMore: rows.length > QUOTE_PAGE_SIZE, canEdit: quoteAccess(caller).edit, counts };
}

// ---------- writing ----------

type Db = Prisma.TransactionClient | typeof prisma;

/**
 * Customer, place and project within the company, and consistent with each other (the place is the customer's). A quote
 * is never linked to an archived or closed project (plan 1K, 2026-10-11); `currentProjectId` is the project the quote
 * already has, so a draft on a project that was closed afterwards can still be saved as it is.
 */
async function checkReferences(db: Db, organizationId: string, input: Pick<QuoteInput, "customerId" | "facilityId" | "projectId">, currentProjectId: string | null = null) {
  let customerId = input.customerId;
  if (input.facilityId) {
    const place = await db.customerFacility.findFirst({ where: { id: input.facilityId, organizationId }, select: { customerId: true } });
    if (!place) throw new ApiError(404, "Platsen hittades inte.");
    if (customerId && place.customerId !== customerId) throw new ApiError(422, "Platsen hör till en annan kund.");
    customerId = place.customerId;
  }
  if (customerId) {
    const customer = await db.customer.findFirst({ where: { id: customerId, organizationId, deletedAt: null }, select: { id: true } });
    if (!customer) throw new ApiError(404, "Kunden hittades inte.");
  }
  if (input.projectId) {
    const project = await db.project.findFirst({ where: { id: input.projectId, organizationId }, select: { customerId: true, archivedAt: true, closedAt: true } });
    if (!project) throw new ApiError(404, "Projektet hittades inte.");
    if (input.projectId !== currentProjectId) {
      if (project.archivedAt) throw new ApiError(422, "Projektet är arkiverat. En offert kan inte kopplas till ett arkiverat projekt.");
      if (project.closedAt) throw new ApiError(422, "Projektet är avslutat. En offert kan inte kopplas till ett avslutat projekt.");
    }
    if (customerId && project.customerId && project.customerId !== customerId) throw new ApiError(422, "Projektet hör till en annan kund.");
    customerId = customerId ?? project.customerId;
  }
  return { customerId, facilityId: input.facilityId, projectId: input.projectId };
}

const numberOrNull = (text: string) => { const value = parseAmount(text); return value === null ? null : new Prisma.Decimal(value.toFixed(4)); };
const percentOrNull = (text: string) => { const value = parsePercent(text); return value === null ? null : new Prisma.Decimal(value.toFixed(2)); };
/** VAT, customer type and ROT as stored: ROT only on a private person's quote (the schema refuses it otherwise). */
function moneyFields(input: QuoteInput) {
  const rot = input.customerType === "PRIVATE" && input.rotEnabled;
  const share = parseShare(input.rotPercent), cap = parseKronor(input.rotCap);
  return {
    // Omvänd byggmoms (2026-11-01): the buyer accounts for the VAT, so the quote's own is 0 % and the sums follow by themselves.
    customerType: input.customerType, vatPercent: new Prisma.Decimal((input.reverseVat ? 0 : parseShare(input.vatPercent) ?? QUOTE_VAT_PERCENT).toFixed(2)),
    rotEnabled: rot, rotPercent: rot && share !== null ? new Prisma.Decimal(share.toFixed(2)) : null, rotCap: rot && cap !== null ? new Prisma.Decimal(cap.toFixed(2)) : null,
  };
}

function lineRows(organizationId: string, quoteId: string, input: QuoteInput) {
  const reverseVat = input.reverseVat ? { buyerVatNumber: input.buyerVatNumber } : undefined;
  return input.lines.map((line, position) => ({
    organizationId, quoteId, position, kind: line.kind, name: line.name, quantity: numberOrNull(line.quantity) ?? new Prisma.Decimal(0), unit: line.unit,
    unitPrice: numberOrNull(line.unitPrice), markupPercent: percentOrNull(line.markupPercent),
    catalogue: lineCatalogueJson({ ...line, reverseVat }) ? (lineCatalogueJson({ ...line, reverseVat }) as Prisma.InputJsonValue) : Prisma.DbNull,
    rotLabour: input.customerType === "PRIVATE" && input.rotEnabled ? line.rotLabour : false,
  }));
}

const isUniqueViolation = (error: unknown) => error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002";

/** A new draft with the company's next number; the valid-until date and terms start from the company's settings. */
export async function createQuote(caller: QuoteCaller, raw: unknown, today = todayInSweden()): Promise<{ id: string }> {
  requireQuotes(caller, "edit");
  const input = quoteInputSchema.parse(raw);
  const settings = await readPriceSettings(caller.organizationId);
  for (let attempt = 0; ; attempt += 1) {
    try {
      return await prisma.$transaction(async (tx) => {
        const links = await checkReferences(tx, caller.organizationId, input);
        const last = await tx.quote.aggregate({ where: { organizationId: caller.organizationId }, _max: { number: true } });
        const quote = await tx.quote.create({ data: {
          organizationId: caller.organizationId, number: (last._max.number ?? 0) + 1, version: 1, ...links,
          title: input.title, description: input.description, validUntil: input.validUntil || addDays(today, settings.validDays),
          terms: input.terms || settings.terms, ...moneyFields(input), createdById: caller.userId, updatedById: caller.userId,
        }, select: { id: true } });
        if (input.lines.length) await tx.quoteLine.createMany({ data: lineRows(caller.organizationId, quote.id, input) });
        return quote;
      });
    } catch (error) {
      // Two quotes created at the same moment got the same number: the second takes the next one.
      if (isUniqueViolation(error) && attempt < 3) continue;
      throw error;
    }
  }
}

async function lockedRow(db: Db, caller: QuoteCaller, id: string) {
  const row = await db.quote.findFirst({ where: { id, organizationId: caller.organizationId }, select: { id: true, number: true, version: true, status: true, validUntil: true, supersededAt: true, revision: true, projectId: true } });
  if (!row) throw new ApiError(404, "Offerten hittades inte.");
  return row;
}

function requireAction(row: { status: QuoteStatus; validUntil: string; supersededAt: Date | null }, action: QuoteAction, today: string) {
  const error = quoteActionError({ status: row.status, validUntil: row.validUntil, superseded: Boolean(row.supersededAt) }, action, today);
  if (error) throw new ApiError(409, error);
}

const STALE = "Offerten har ändrats av någon annan. Läs in den senaste versionen.";

/** A draft's contents and lines, replaced as a whole; `revision` is the one the person started from. */
export async function updateQuote(caller: QuoteCaller, id: string, revision: number, raw: unknown, today = todayInSweden()): Promise<{ id: string; revision: number }> {
  requireQuotes(caller, "edit");
  const input = quoteInputSchema.parse(raw);
  return prisma.$transaction(async (tx) => {
    const row = await lockedRow(tx, caller, id);
    requireAction(row, "edit", today);
    const links = await checkReferences(tx, caller.organizationId, input, row.projectId);
    const changed = await tx.quote.updateMany({
      where: { id, organizationId: caller.organizationId, revision, status: "DRAFT" },
      data: { ...links, title: input.title, description: input.description, validUntil: input.validUntil, terms: input.terms, ...moneyFields(input), updatedById: caller.userId, revision: { increment: 1 } },
    });
    if (!changed.count) throw new ApiError(409, STALE);
    await tx.quoteLine.deleteMany({ where: { quoteId: id, organizationId: caller.organizationId } });
    if (input.lines.length) await tx.quoteLine.createMany({ data: lineRows(caller.organizationId, id, input) });
    return { id, revision: revision + 1 };
  });
}

/** Skicka (locks the prices), Accepterad, Avböjd or Utgången. */
export async function changeQuoteStatus(caller: QuoteCaller, id: string, revision: number, action: "send" | "accept" | "decline" | "expire", today = todayInSweden(), now = new Date()) {
  requireQuotes(caller, "edit");
  return prisma.$transaction(async (tx) => {
    const row = await lockedRow(tx, caller, id);
    requireAction(row, action, today);
    if (action === "send") {
      const lines = await tx.quoteLine.findMany({ where: { quoteId: id, organizationId: caller.organizationId }, select: { kind: true, quantity: true, unitPrice: true, markupPercent: true, rotLabour: true } });
      const money = await tx.quote.findFirstOrThrow({ where: { id, organizationId: caller.organizationId }, select: { vatPercent: true, customerType: true, rotEnabled: true, rotPercent: true, rotCap: true } });
      const issues = quoteSendIssues({ lines: lines.map(lineNumbers), validUntil: row.validUntil, vatPercent: decimal(money.vatPercent) ?? QUOTE_VAT_PERCENT, customerType: money.customerType, rotEnabled: money.rotEnabled, rotPercent: decimal(money.rotPercent), rotCap: decimal(money.rotCap) }, today);
      if (issues.length) throw new ApiError(422, issues.join(" "));
    }
    const status: QuoteStatus = action === "send" ? "SENT" : action === "accept" ? "ACCEPTED" : action === "decline" ? "DECLINED" : "EXPIRED";
    // Sending takes the customer's snapshot (plan 1D): the quote shows the customer as it was when sent, for ever.
    const snapshot = action === "send" ? customerSnapshotData((await tx.quote.findFirstOrThrow({ where: { id, organizationId: caller.organizationId }, select: { customer: { select: { name: true, company: true, customerType: true, address: true, postalCode: true, city: true } } } })).customer) : {};
    const changed = await tx.quote.updateMany({
      where: { id, organizationId: caller.organizationId, revision, status: row.status },
      data: { status, ...(action === "send" ? { sentAt: now, sentById: caller.userId, ...snapshot } : { decidedAt: now, decidedById: caller.userId }), updatedById: caller.userId, revision: { increment: 1 } },
    });
    if (!changed.count) throw new ApiError(409, STALE);
    return { id, revision: revision + 1, status };
  });
}

/**
 * Ny version: a sent, declined or expired quote is copied to a new draft with the same number and the next version;
 * the earlier one stays as it was, read only and marked as replaced. Only the latest version can get a new one.
 * ÄTA (steg C): a new version of an accepted quote is an ÄTA naming that accepted version; a new version of an ÄTA keeps
 * the same accepted version, so its changes are always shown against the agreement.
 */
export async function newQuoteVersion(caller: QuoteCaller, id: string, today = todayInSweden()): Promise<{ id: string }> {
  requireQuotes(caller, "edit");
  const settings = await readPriceSettings(caller.organizationId);
  return prisma.$transaction(async (tx) => {
    const row = await lockedRow(tx, caller, id);
    requireAction(row, "new_version", today);
    const source = await tx.quote.findFirstOrThrow({ where: { id, organizationId: caller.organizationId }, include: { lines: { orderBy: { position: "asc" }, select: lineSelect } } });
    const marked = await tx.quote.updateMany({ where: { id, organizationId: caller.organizationId, supersededAt: null }, data: { supersededAt: new Date(), updatedById: caller.userId } });
    if (!marked.count) throw new ApiError(409, "Det finns redan en nyare version av offerten.");
    const created = await tx.quote.create({ data: {
      organizationId: caller.organizationId, number: source.number, version: source.version + 1,
      customerId: source.customerId, facilityId: source.facilityId, projectId: source.projectId,
      title: source.title, description: source.description, terms: source.terms, vatPercent: source.vatPercent,
      customerType: source.customerType, rotEnabled: source.rotEnabled, rotPercent: source.rotPercent, rotCap: source.rotCap,
      changeOfVersion: source.status === "ACCEPTED" ? source.version : source.changeOfVersion,
      // An expired date is moved forward by the company's validity; a date still ahead is kept.
      validUntil: source.validUntil && source.validUntil >= today ? source.validUntil : addDays(today, settings.validDays),
      createdById: caller.userId, updatedById: caller.userId,
    }, select: { id: true } });
    if (source.lines.length) await tx.quoteLine.createMany({ data: source.lines.map((line) => ({
      organizationId: caller.organizationId, quoteId: created.id, position: line.position, kind: line.kind, name: line.name, quantity: line.quantity, unit: line.unit,
      unitPrice: line.unitPrice, markupPercent: line.markupPercent, catalogue: line.catalogue === null ? Prisma.DbNull : line.catalogue as Prisma.InputJsonValue, rotLabour: line.rotLabour,
    })) });
    return created;
  });
}

/** Only a draft is deleted; a sent quote stays as it was sent. */
export async function deleteQuote(caller: QuoteCaller, id: string, today = todayInSweden()) {
  requireQuotes(caller, "edit");
  await prisma.$transaction(async (tx) => {
    const row = await lockedRow(tx, caller, id);
    requireAction(row, "delete", today);
    const removed = await tx.quote.deleteMany({ where: { id, organizationId: caller.organizationId, status: "DRAFT" } });
    if (!removed.count) throw new ApiError(409, STALE);
    // A draft made as a new version gives the earlier version back its place as the latest.
    if (row.version > 1) await tx.quote.updateMany({ where: { organizationId: caller.organizationId, number: row.number, version: row.version - 1 }, data: { supersededAt: null } });
  });
}
