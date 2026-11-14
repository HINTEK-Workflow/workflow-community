import { randomUUID } from "node:crypto";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { ApiError } from "@/lib/kfid/errors";
import { todayInSweden } from "@/lib/catalogue/snapshot";
import { fortnoxKeyName } from "@/lib/quotes/accounting-server";
import { markBasisIssued, readableBasisForInvoice, requireInvoiceBasis, createCorrectionBasis, createStandaloneInvoiceBasis, type InvoiceBasisCaller } from "@/lib/invoice-basis/server";
import { swedishDayKey } from "@/lib/swedish-time";
import { invoiceBasisLabel } from "@/lib/invoice-basis/model";
import { hasWorkflowPermission } from "@/lib/workflow/permissions";
import { openValue, sealValue } from "@/lib/security/key-ring";
import { pdfDocumentDef } from "@/lib/pdf-templates/catalog";
import { pdfTemplateOverrides } from "@/lib/pdf-templates/server";
import { resolvePdfDocument } from "@/lib/pdf-templates/model";
import { allocateInvoiceNumber, BLANK_INVOICE_SETTINGS, buildCredit, buildInvoice, freezeInvoiceTexts, invoiceContentOf, invoiceDetailsSchema, invoicePaymentState, sentToOf, standaloneInvoiceSchema, INVOICE_PAGE_SIZE, ocrNumber, sellerProblems, startNumberProblem, type InvoiceBasisState, type InvoiceContent, type InvoiceDetails, type InvoiceEventItem, type InvoiceListSort, type InvoiceListFilter, type InvoiceListItem, type InvoicePage, type InvoicePrepare, type InvoiceSettings, type InvoiceSettingsView, type InvoiceSource, type InvoiceView, type InvoiceKind } from "@/lib/customer-invoice/model";
import { invoiceSellerOf } from "@/lib/customer-invoice/seller";
import { z } from "zod";

/**
 * Fakturor on the server (owner's decision 2026-11-04, docs/beslut/faktura.md). Cloud only; every query is bound to the caller's
 * company. The tables are read with parameterised SQL. Reading needs admin or Fakturera – läsa; issuing, crediting, sending and
 * marking paid need Fakturera – redigera, and issuing also needs to read the basis and its job or project. While the company's
 * setting is off everything but the setting itself answers 404, so nothing can be reached.
 *
 * Numbering: `UPDATE ... nextNumber + 1 RETURNING` on the company's series row is the first statement of the transaction that
 * writes the invoice, so the row lock serialises issuing per company, a rollback gives the number back, and the unique key on
 * (organizationId, number) and the series trigger stand behind it.
 *
 * The identity number of a ROT buyer is sealed with the key ring, bound to the company, and opened only to draw the document or
 * to send it. It is in no log and no audit text; lists and views show it masked.
 */
export type InvoiceCaller = InvoiceBasisCaller;
type Db = Prisma.TransactionClient | typeof prisma;

const OFF = "Fakturering är inte påslagen för företaget.";
const can = (caller: InvoiceCaller, action: "read" | "edit") => caller.admin || hasWorkflowPermission(caller.permissions, "invoicing", action);
export const invoiceAccess = (caller: InvoiceCaller) => ({ read: can(caller, "read"), edit: can(caller, "edit") });

function requireCloud(caller: InvoiceCaller) {
  if (caller.storageMode !== "HINTEK_CLOUD") throw new ApiError(404, "Fakturor finns bara med serverlagring.");
}
function requireRight(caller: InvoiceCaller, need: "read" | "edit") {
  requireCloud(caller);
  if (!can(caller, need)) throw new ApiError(403, need === "edit" ? "Du saknar rätten Fakturera." : "Du saknar behörighet att se fakturor (Fakturera – läsa).");
}

type SeriesRow = { enabled: boolean; nextNumber: number; prefix: string; paymentDays: number | null; lateTerms: string; iban: string; bic: string; useOcr: boolean; vatExempt: boolean };
async function readSettings(db: Db, organizationId: string): Promise<InvoiceSettings> {
  const [row] = await db.$queryRaw<SeriesRow[]>`SELECT "enabled", "nextNumber", "prefix", "paymentDays", "lateTerms", "iban", "bic", "useOcr", "vatExempt" FROM "CustomerInvoiceSeries" WHERE "organizationId" = ${organizationId}`;
  const [{ issued }] = await db.$queryRaw<{ issued: number }[]>`SELECT COUNT(*)::int AS "issued" FROM "CustomerInvoice" WHERE "organizationId" = ${organizationId}`;
  // No row means on, unless invoices exist: issuing always makes the row, so invoices without it are a deleted company's, kept for retention, and stay shut.
  return { ...BLANK_INVOICE_SETTINGS, ...(row ?? {}), enabled: row ? row.enabled : issued === 0, issued };
}
/** What the menu reads for the signed-in company: no row means on (2026-11-05). A read that fails counts as off, so the off state stays clean. */
export async function customerInvoicesOn(organizationId: string): Promise<boolean> {
  try {
    return (await readSettings(prisma, organizationId)).enabled;
  } catch { return false; }
}

/** Off means off: the same answer as a route that is not there. */
async function requireOn(db: Db, organizationId: string): Promise<InvoiceSettings> {
  const settings = await readSettings(db, organizationId);
  if (!settings.enabled) throw new ApiError(404, OFF);
  return settings;
}

const decimal = (value: { toString(): string } | number) => Number(value.toString());
async function audit(db: Db, caller: InvoiceCaller, action: string, detail: string) {
  await db.administrationEvent.create({ data: { organizationId: caller.organizationId, actorId: caller.userId, action, detail: detail.slice(0, 500) } });
}
async function logEvent(db: Db, caller: InvoiceCaller, invoiceId: string, action: string, detail = "") {
  await db.$executeRaw`INSERT INTO "CustomerInvoiceEvent" ("id", "organizationId", "invoiceId", "action", "detail", "actorId", "actorName") VALUES (${randomUUID()}, ${caller.organizationId}, ${invoiceId}, ${action}, ${detail.slice(0, 500)}, ${caller.userId}, ${(caller.userName ?? "").slice(0, 200)})`;
}

// ---------- the setting ----------

/** What the company has connected that also makes invoices; "" when nothing. */
async function connectedSystem(organizationId: string): Promise<string> {
  return (await fortnoxKeyName(organizationId)) ? "Fortnox" : "";
}

export async function invoiceSettingsView(caller: InvoiceCaller): Promise<InvoiceSettingsView> {
  requireRight(caller, "read");
  const [settings, company] = await Promise.all([readSettings(prisma, caller.organizationId), companyRow(prisma, caller.organizationId)]);
  return { settings, connected: await connectedSystem(caller.organizationId), sellerProblems: sellerProblems(invoiceSellerOf(company.name, company.profile, settings)), canEdit: caller.admin };
}

const IBAN = /^[A-Z]{2}\d{2}[A-Z0-9]{10,30}$/;
const settingsInput = z.object({
  enabled: z.boolean(),
  /** The company has seen the warning about invoices in two places. */
  confirmOverlap: z.boolean().default(false),
  nextNumber: z.number().int(),
  prefix: z.string().trim().max(10).regex(/^[A-Za-z0-9-]*$/, "Prefixet får bara innehålla bokstäver, siffror och bindestreck."),
  paymentDays: z.number().int().min(0).max(365).nullable(),
  lateTerms: z.string().trim().max(300),
  iban: z.string().trim().max(40).transform((value) => value.replace(/\s+/g, "").toUpperCase()).refine((value) => !value || IBAN.test(value), "IBAN ser inte rätt ut."),
  bic: z.string().trim().max(20),
  useOcr: z.boolean(),
  vatExempt: z.boolean(),
});

/** Only the company's admin changes the setting. Turning it on with an accounting link needs the company's own choice. */
export async function saveInvoiceSettings(caller: InvoiceCaller, raw: unknown): Promise<InvoiceSettingsView> {
  requireCloud(caller);
  if (!caller.admin) throw new ApiError(403, "Företagsadministratör krävs.");
  const input = settingsInput.parse(raw);
  const connected = await connectedSystem(caller.organizationId);
  await prisma.$transaction(async (tx) => {
    await tx.$executeRaw`INSERT INTO "CustomerInvoiceSeries" ("organizationId") VALUES (${caller.organizationId}) ON CONFLICT ("organizationId") DO NOTHING`;
    await tx.$queryRaw`SELECT 1 FROM "CustomerInvoiceSeries" WHERE "organizationId" = ${caller.organizationId} FOR UPDATE`;
    const before = await readSettings(tx, caller.organizationId);
    const problem = startNumberProblem(before, input.nextNumber);
    if (problem) throw new ApiError(409, problem);
    if (input.enabled && !before.enabled && connected && !input.confirmOverlap) throw new ApiError(409, `Företaget är kopplat till ${connected}. Bekräfta att fakturor inte också ska skapas där.`);
    await tx.$executeRaw`UPDATE "CustomerInvoiceSeries" SET "enabled" = ${input.enabled}, "nextNumber" = ${input.nextNumber}, "prefix" = ${input.prefix}, "paymentDays" = ${input.paymentDays}, "lateTerms" = ${input.lateTerms}, "iban" = ${input.iban}, "bic" = ${input.bic}, "useOcr" = ${input.useOcr}, "vatExempt" = ${input.vatExempt}, "updatedById" = ${caller.userId}, "updatedAt" = NOW() WHERE "organizationId" = ${caller.organizationId}`;
    if (input.enabled !== before.enabled) await audit(tx, caller, "customer_invoice_setting", `${input.enabled ? "Slog på" : "Slog av"} fakturering i Workflow.${input.enabled && connected ? ` Kopplat till ${connected}: företaget bekräftade.` : ""}`);
    else await audit(tx, caller, "customer_invoice_setting", "Ändrade inställningarna för fakturering.");
  });
  return invoiceSettingsView(caller);
}

// ---------- from a basis ----------

async function companyRow(db: Db, organizationId: string) {
  const row = await db.workspaceSettings.findUnique({ where: { organizationId }, select: { companyName: true, profile: true } });
  const organization = row?.companyName ? null : await db.organization.findUnique({ where: { id: organizationId }, select: { name: true } });
  return { name: row?.companyName || organization?.name || "", profile: row?.profile ?? null };
}

async function currentTexts(type: "invoice" | "credit_invoice" | "common") {
  return freezeInvoiceTexts(resolvePdfDocument(pdfDocumentDef(type)!, await pdfTemplateOverrides()));
}

async function sourceOf(db: Db, caller: InvoiceCaller, basisId: string, settings: InvoiceSettings) {
  const basis = await readableBasisForInvoice(db, caller, basisId);
  const company = await companyRow(db, caller.organizationId);
  const source: InvoiceSource = {
    seller: invoiceSellerOf(company.name, company.profile, settings), buyer: basis.buyer, settings, today: todayInSweden(), texts: await currentTexts("invoice"), common: await currentTexts("common"),
    basis: { label: invoiceBasisLabel(basis.number), title: basis.title, vatPercent: basis.vatPercent, tax: basis.tax, lines: basis.lines },
  };
  return { basis, source };
}

/** What the basis's page shows: 404 while the setting is off or the person lacks the right, so it shows nothing at all. */
export async function invoiceBasisState(caller: InvoiceCaller, basisId: string): Promise<InvoiceBasisState> {
  requireCloud(caller);
  await requireOn(prisma, caller.organizationId);
  if (!can(caller, "read")) throw new ApiError(404, OFF);
  const basis = await readableBasisForInvoice(prisma, caller, basisId);
  const [invoice] = await prisma.$queryRaw<{ id: string; label: string; paidOn: string | null; dueOn: string | null; credited: boolean; sentAt: Date | null; sentDetail: string | null }[]>`SELECT i."id", i."label", i."paidOn", i."dueOn",
      EXISTS (SELECT 1 FROM "CustomerInvoice" c WHERE c."organizationId" = i."organizationId" AND c."creditOfId" = i."id") AS "credited",
      sent."createdAt" AS "sentAt", sent."detail" AS "sentDetail"
    FROM "CustomerInvoice" i
    LEFT JOIN LATERAL (SELECT e."createdAt", e."detail" FROM "CustomerInvoiceEvent" e WHERE e."organizationId" = i."organizationId" AND e."invoiceId" = i."id" AND e."action" = 'sent' ORDER BY e."createdAt" DESC LIMIT 1) sent ON TRUE
    WHERE i."organizationId" = ${caller.organizationId} AND i."basisId" = ${basisId} AND i."kind" = 'INVOICE'`;
  return {
    enabled: true, canIssue: can(caller, "edit"),
    invoice: invoice ? {
      id: invoice.id, label: invoice.label, state: invoicePaymentState({ kind: "INVOICE", paidOn: invoice.paidOn, dueOn: invoice.dueOn, credited: invoice.credited }, todayInSweden()),
      sentOn: invoice.sentAt ? swedishDayKey(invoice.sentAt) : null, sentTo: invoice.sentDetail ? sentToOf(invoice.sentDetail) : "",
    } : null,
    refusal: invoice ? "" : basis.status === "INVOICED" ? "Underlaget är redan markerat som fakturerat utanför Workflow, och blir ingen faktura här." : "",
  };
}

/** Whether someone can turn invoicing on from the list of bases: only the company's admin, and only while it is off. */
export async function invoiceOffer(caller: InvoiceCaller): Promise<{ canTurnOn: boolean }> {
  requireCloud(caller);
  return { canTurnOn: caller.admin && !(await customerInvoicesOn(caller.organizationId)) };
}

/** Ny faktura: a basis without a job or project, written in the basis view (2026-11-05). */
export async function createStandaloneInvoice(caller: InvoiceCaller, raw: unknown): Promise<{ id: string; label: string }> {
  requireRight(caller, "edit");
  requireInvoiceBasis(caller, "edit");
  await requireOn(prisma, caller.organizationId);
  return createStandaloneInvoiceBasis(caller, standaloneInvoiceSchema.parse(raw));
}

/** Whether the list has a way in: only with the setting on and the right. */
export async function invoiceWayIn(caller: InvoiceCaller): Promise<{ enabled: true; canEdit: boolean }> {
  requireCloud(caller);
  await requireOn(prisma, caller.organizationId);
  if (!can(caller, "read")) throw new ApiError(404, OFF);
  // canEdit: whether Nytt fakturaunderlag (the start of a standalone invoice) is offered on the list of bases.
  return { enabled: true, canEdit: can(caller, "edit") };
}

export async function prepareInvoice(caller: InvoiceCaller, basisId: string): Promise<InvoicePrepare> {
  requireRight(caller, "edit");
  requireInvoiceBasis(caller, "read");
  const settings = await requireOn(prisma, caller.organizationId);
  const { basis, source } = await sourceOf(prisma, caller, basisId, settings);
  return {
    source, revision: basis.revision, lineVatPercent: basis.vatPercent, connected: await connectedSystem(caller.organizationId), customerId: basis.customerId ?? null,
    defaults: { performedFrom: basis.performedFrom, performedOn: basis.performedOn, paymentDays: settings.paymentDays === null ? "" : String(settings.paymentDays), workPlace: basis.workPlace, email: basis.buyerEmail },
  };
}

/** The document before it is issued: nothing is written and no number is taken. */
export async function previewInvoiceContent(caller: InvoiceCaller, basisId: string, raw: unknown): Promise<{ content: InvoiceContent; personalNumber: string }> {
  requireRight(caller, "edit");
  requireInvoiceBasis(caller, "read");
  const details = invoiceDetailsSchema.parse(raw);
  const settings = await requireOn(prisma, caller.organizationId);
  const { source } = await sourceOf(prisma, caller, basisId, settings);
  const built = buildInvoice(source, details);
  return { content: built.content, personalNumber: built.identity ? formatIdentity(built.identity.digits) : "" };
}

/**
 * A proforma invoice (2026-11-05): the preview's content with no number from the series, nothing locked and no identity
 * number. It is no invoice and is not booked; the document is not kept, and only the audit log records that it was made.
 */
export const logProforma = (caller: InvoiceCaller, content: InvoiceContent, email: string) =>
  audit(prisma, caller, "customer_invoice_proforma", `Proformafaktura från underlag ${content.basisLabel}${email ? ` till ${email}` : ""}, ${content.toPay.toFixed(2)} kr.`);

const formatIdentity = (digits: string) => `${digits.slice(0, 8)}-${digits.slice(8)}`;
const seal = (organizationId: string, digits: string) => sealValue("invoice-identity", digits, organizationId);
const openIdentity = (organizationId: string, sealed: string | null) => openValue("invoice-identity", sealed, organizationId, "invoice-identity");

/** The series row under its lock: the first step of everything that gives a number. */
async function takeNumber(tx: Prisma.TransactionClient, organizationId: string) {
  // A company that never opened the setting has no row yet: it starts with the first number.
  if ((await readSettings(tx, organizationId)).enabled) await tx.$executeRaw`INSERT INTO "CustomerInvoiceSeries" ("organizationId") VALUES (${organizationId}) ON CONFLICT ("organizationId") DO NOTHING`;
  const [row] = await tx.$queryRaw<{ taken: number; prefix: string; useOcr: boolean }[]>`UPDATE "CustomerInvoiceSeries" SET "nextNumber" = "nextNumber" + 1, "updatedAt" = NOW() WHERE "organizationId" = ${organizationId} AND "enabled" = TRUE RETURNING "nextNumber" - 1 AS "taken", "prefix", "useOcr"`;
  if (!row) throw new ApiError(404, OFF);
  return allocateInvoiceNumber({ enabled: true, nextNumber: row.taken, prefix: row.prefix });
}

/**
 * Utfärda: one transaction – the number, the check of everything required, the invoice and the basis locked as invoiced, and
 * the audit event. Whatever fails gives the number back. A basis already marked as invoiced is refused: what has gone to
 * Fortnox or been invoiced elsewhere never becomes a second invoice, and an invoiced basis is never sent to Fortnox afterwards.
 */
export async function issueInvoice(caller: InvoiceCaller, basisId: string, revision: number, raw: unknown): Promise<{ id: string; label: string }> {
  requireRight(caller, "edit");
  requireInvoiceBasis(caller, "read");
  const details: InvoiceDetails = invoiceDetailsSchema.parse(raw);
  // The template's texts outside the transaction: they are cached and need no lock.
  return prisma.$transaction(async (tx) => {
    const allocated = await takeNumber(tx, caller.organizationId);
    const settings = await readSettings(tx, caller.organizationId);
    const { basis, source } = await sourceOf(tx, caller, basisId, settings);
    if (basis.status !== "DRAFT") throw new ApiError(409, "Underlaget är redan fakturerat och blir ingen ny faktura.");
    if (basis.revision !== revision) throw new ApiError(409, "Underlaget har ändrats sedan du öppnade det. Läs in det igen.");
    const built = buildInvoice(source, details, { ...allocated, reference: settings.useOcr ? ocrNumber(allocated.number) : allocated.label });
    if (built.problems.length) throw new ApiError(422, built.problems.map((problem) => problem.text).join(" "));
    const id = randomUUID();
    const sealed = built.identity ? seal(caller.organizationId, built.identity.digits) : null;
    await tx.$executeRaw`INSERT INTO "CustomerInvoice" ("id", "organizationId", "number", "label", "kind", "basisId", "customerId", "issuedOn", "dueOn", "title", "buyerName", "content", "toPay", "identitySealed", "identityMasked", "createdById", "createdByName")
      VALUES (${id}, ${caller.organizationId}, ${allocated.number}, ${allocated.label}, 'INVOICE', ${basisId}, ${basis.customerId}, ${built.content.issuedOn}, ${built.content.dueOn}, ${built.content.title}, ${built.content.buyer.name}, ${JSON.stringify(built.content)}::jsonb, ${new Prisma.Decimal(built.content.toPay.toFixed(2))}, ${sealed}, ${built.identity?.masked ?? ""}, ${caller.userId}, ${(caller.userName ?? "").slice(0, 200)})`;
    await markBasisIssued(tx, caller, basisId, revision);
    await logEvent(tx, caller, id, "issued");
    await audit(tx, caller, "customer_invoice_issue", `Utfärdade faktura ${allocated.label} från underlag ${invoiceBasisLabel(basis.number)}, ${built.content.toPay.toFixed(2)} kr.`);
    return { id, label: allocated.label };
  }, { timeout: 20_000 });
}

// ---------- an issued invoice ----------

type InvoiceRow = {
  id: string; kind: InvoiceKind; number: number; label: string; title: string; buyerName: string; issuedOn: string; dueOn: string | null; toPay: { toString(): string }; paidOn: string | null;
  content: unknown; identitySealed: string | null; identityMasked: string; createdByName: string; basisId: string | null; customerId: string | null; creditOfId: string | null; correctedByBasisId: string | null;
  creditId: string | null; creditLabel: string | null;
};
const ROW = Prisma.sql`i."id", i."kind"::text AS "kind", i."number", i."label", i."title", i."buyerName", i."issuedOn", i."dueOn", i."toPay", i."paidOn", i."content", i."identitySealed", i."identityMasked", i."createdByName", i."basisId", i."customerId", i."creditOfId", i."correctedByBasisId", c."id" AS "creditId", c."label" AS "creditLabel"`;
const FROM = Prisma.sql`FROM "CustomerInvoice" i LEFT JOIN "CustomerInvoice" c ON c."creditOfId" = i."id" AND c."organizationId" = i."organizationId"`;

const listItem = (row: InvoiceRow, today: string): InvoiceListItem => ({
  id: row.id, kind: row.kind, number: row.number, label: row.label, title: row.title, buyerName: row.buyerName, issuedOn: row.issuedOn, dueOn: row.dueOn, toPay: decimal(row.toPay), paidOn: row.paidOn,
  state: invoicePaymentState({ kind: row.kind, paidOn: row.paidOn, dueOn: row.dueOn, credited: Boolean(row.creditId) }, today),
});

async function readRow(db: Db, organizationId: string, id: string): Promise<InvoiceRow> {
  const [row] = await db.$queryRaw<InvoiceRow[]>`SELECT ${ROW} ${FROM} WHERE i."organizationId" = ${organizationId} AND i."id" = ${id}`;
  if (!row) throw new ApiError(404, "Fakturan hittades inte.");
  return row;
}
function contentOf(row: InvoiceRow): InvoiceContent {
  const content = invoiceContentOf(row.content);
  if (!content) throw new ApiError(500, "Fakturan kunde inte läsas.");
  return content;
}

export async function getInvoice(caller: InvoiceCaller, id: string, today = todayInSweden()): Promise<InvoiceView> {
  requireRight(caller, "read");
  await requireOn(prisma, caller.organizationId);
  const row = await readRow(prisma, caller.organizationId, id);
  const [buyer] = row.customerId ? await prisma.$queryRaw<{ email: string | null }[]>`SELECT "email" FROM "Customer" WHERE "organizationId" = ${caller.organizationId} AND "id" = ${row.customerId}` : [];
  const events = await prisma.$queryRaw<(Omit<InvoiceEventItem, "createdAt"> & { createdAt: Date })[]>`SELECT "id", "action", "detail", "actorName", "createdAt" FROM "CustomerInvoiceEvent" WHERE "organizationId" = ${caller.organizationId} AND "invoiceId" = ${id} ORDER BY "createdAt" DESC LIMIT 100`;
  return {
    ...listItem(row, today), content: contentOf(row), identityMasked: row.identityMasked, canEdit: can(caller, "edit"), createdByName: row.createdByName, basisId: row.basisId,
    creditId: row.creditId, creditLabel: row.creditLabel ?? "", correctedByBasisId: row.correctedByBasisId, buyerEmail: buyer?.email ?? "", events: events.map((event) => ({ ...event, createdAt: event.createdAt.toISOString() })),
  };
}

const whereFilter = (filter: InvoiceListFilter, today: string): Prisma.Sql => {
  switch (filter) {
    case "CREDIT": return Prisma.sql`AND i."kind" = 'CREDIT'`;
    case "PAID": return Prisma.sql`AND i."kind" = 'INVOICE' AND c."id" IS NULL AND i."paidOn" IS NOT NULL`;
    case "OVERDUE": return Prisma.sql`AND i."kind" = 'INVOICE' AND c."id" IS NULL AND i."paidOn" IS NULL AND i."dueOn" < ${today}`;
    case "UNPAID": return Prisma.sql`AND i."kind" = 'INVOICE' AND c."id" IS NULL AND i."paidOn" IS NULL AND (i."dueOn" IS NULL OR i."dueOn" >= ${today})`;
    default: return Prisma.empty;
  }
};

export async function listInvoices(caller: InvoiceCaller, options: { filter: InvoiceListFilter; page: number; q: string; counts: boolean; sort?: InvoiceListSort }, today = todayInSweden()): Promise<InvoicePage> {
  requireRight(caller, "read");
  await requireOn(prisma, caller.organizationId);
  const page = Math.min(1000, Math.max(1, Math.trunc(options.page) || 1));
  const like = `%${options.q.replace(/[\\%_]/g, "\\$&")}%`;
  const search = options.q ? Prisma.sql`AND (i."label" ILIKE ${like} OR i."title" ILIKE ${like} OR i."buyerName" ILIKE ${like})` : Prisma.empty;
  const base = Prisma.sql`${FROM} WHERE i."organizationId" = ${caller.organizationId} ${search}`;
  const rows = await prisma.$queryRaw<InvoiceRow[]>`SELECT ${ROW} ${base} ${whereFilter(options.filter, today)} ORDER BY ${options.sort === "due" ? Prisma.sql`i."dueOn" ASC NULLS LAST, i."number" DESC` : options.sort === "title" ? Prisma.sql`i."title" ASC, i."number" DESC` : Prisma.sql`i."number" DESC`} LIMIT ${INVOICE_PAGE_SIZE} OFFSET ${(page - 1) * INVOICE_PAGE_SIZE}`;
  const count = async (filter: InvoiceListFilter) => (await prisma.$queryRaw<{ total: number }[]>`SELECT COUNT(*)::int AS "total" ${base} ${whereFilter(filter, today)}`)[0]!.total;
  const [total, counts] = await Promise.all([count(options.filter), options.counts ? Promise.all((["all", "UNPAID", "OVERDUE", "PAID", "CREDIT"] as const).map(async (filter) => [filter, await count(filter)] as const)).then((pairs) => Object.fromEntries(pairs) as Record<InvoiceListFilter, number>) : null]);
  return { items: rows.map((row) => listItem(row, today)), total, page, pageSize: INVOICE_PAGE_SIZE, canEdit: can(caller, "edit"), counts };
}

/** The locked document: the snapshot, and the identity number only when the invoice has one. Opening it is written to the audit log, without the number. */
export async function invoiceDocument(caller: InvoiceCaller, id: string): Promise<{ content: InvoiceContent; personalNumber: string }> {
  requireRight(caller, "read");
  await requireOn(prisma, caller.organizationId);
  const row = await readRow(prisma, caller.organizationId, id);
  const digits = openIdentity(caller.organizationId, row.identitySealed);
  if (row.identitySealed) await audit(prisma, caller, "customer_invoice_identity_read", `Hämtade ${row.label} med köparens personnummer.`);
  return { content: contentOf(row), personalNumber: digits ? formatIdentity(digits) : "" };
}

/** Kreditera: the whole invoice, with its own number and a reference to the original. Other corrections go through a new basis afterwards. */
export async function creditInvoice(caller: InvoiceCaller, id: string, reason: string): Promise<{ id: string; label: string }> {
  requireRight(caller, "edit");
  const why = reason.trim();
  if (!why) throw new ApiError(422, "Skriv varför fakturan krediteras.");
  return prisma.$transaction(async (tx) => {
    const allocated = await takeNumber(tx, caller.organizationId);
    const row = await readRow(tx, caller.organizationId, id);
    if (row.kind !== "INVOICE") throw new ApiError(409, "En kreditfaktura kan inte krediteras.");
    if (row.creditId) throw new ApiError(409, `Fakturan är redan krediterad med ${row.creditLabel}.`);
    const content = buildCredit(contentOf(row), { id, number: allocated.number, label: allocated.label, today: todayInSweden(), reason: why.slice(0, 300), texts: await currentTexts("credit_invoice"), common: await currentTexts("common") });
    const creditId = randomUUID();
    await tx.$executeRaw`INSERT INTO "CustomerInvoice" ("id", "organizationId", "number", "label", "kind", "basisId", "creditOfId", "customerId", "issuedOn", "title", "buyerName", "content", "toPay", "identitySealed", "identityMasked", "createdById", "createdByName")
      SELECT ${creditId}, "organizationId", ${allocated.number}, ${allocated.label}, 'CREDIT', "basisId", "id", "customerId", ${content.issuedOn}, "title", "buyerName", ${JSON.stringify(content)}::jsonb, ${new Prisma.Decimal(content.toPay.toFixed(2))}, "identitySealed", "identityMasked", ${caller.userId}, ${(caller.userName ?? "").slice(0, 200)}
      FROM "CustomerInvoice" WHERE "organizationId" = ${caller.organizationId} AND "id" = ${id}`;
    // A credited invoice is no longer to be paid: its link stops working, and the credit gets its own when it is sent.
    await tx.$executeRaw`UPDATE "CustomerInvoiceLink" SET "revokedAt" = NOW() WHERE "organizationId" = ${caller.organizationId} AND "invoiceId" = ${id} AND "revokedAt" IS NULL`;
    await logEvent(tx, caller, id, "credited", `Kreditfaktura ${allocated.label}. ${why}`);
    await logEvent(tx, caller, creditId, "issued", `Krediterar ${row.label}. ${why}`);
    await audit(tx, caller, "customer_invoice_credit", `Krediterade faktura ${row.label} med ${allocated.label}, ${content.toPay.toFixed(2)} kr.`);
    return { id: creditId, label: allocated.label };
  }, { timeout: 20_000 });
}

/** After a credit: a new draft basis with the same lines to correct. It takes no sources, since the first basis keeps them; a second call opens the same draft. */
export async function correctCreditedInvoice(caller: InvoiceCaller, id: string): Promise<{ basisId: string }> {
  requireRight(caller, "edit");
  requireInvoiceBasis(caller, "edit");
  return prisma.$transaction(async (tx) => {
    await requireOn(tx, caller.organizationId);
    const [row] = await tx.$queryRaw<InvoiceRow[]>`SELECT ${ROW} ${FROM} WHERE i."organizationId" = ${caller.organizationId} AND i."id" = ${id} FOR UPDATE OF i`;
    if (!row) throw new ApiError(404, "Fakturan hittades inte.");
    if (row.kind !== "INVOICE" || !row.creditId) throw new ApiError(409, "Bara en krediterad faktura kan rättas med ett nytt underlag.");
    if (!row.basisId) throw new ApiError(409, "Underlaget finns inte längre.");
    if (row.correctedByBasisId && await tx.invoiceBasis.findFirst({ where: { id: row.correctedByBasisId, organizationId: caller.organizationId }, select: { id: true } })) return { basisId: row.correctedByBasisId };
    const basisId = await createCorrectionBasis(tx, caller, row.basisId, row.label);
    await tx.$executeRaw`UPDATE "CustomerInvoice" SET "correctedByBasisId" = ${basisId} WHERE "organizationId" = ${caller.organizationId} AND "id" = ${id}`;
    await logEvent(tx, caller, id, "corrected", "Nytt underlag för rättning.");
    return { basisId };
  });
}

const DAY = /^\d{4}-\d{2}-\d{2}$/;
/** Betald is marked by hand and can be undone; each step is a line in the log. */
export async function markInvoicePaid(caller: InvoiceCaller, id: string, paidOn: string | null, today = todayInSweden()): Promise<void> {
  requireRight(caller, "edit");
  await prisma.$transaction(async (tx) => {
    await requireOn(tx, caller.organizationId);
    const row = await readRow(tx, caller.organizationId, id);
    if (row.kind !== "INVOICE") throw new ApiError(409, "En kreditfaktura har ingen betalning att markera.");
    if (paidOn !== null) {
      if (!DAY.test(paidOn) || paidOn > today) throw new ApiError(422, "Skriv betaldagen som ÅÅÅÅ-MM-DD, senast i dag.");
      if (row.creditId) throw new ApiError(409, "Fakturan är krediterad.");
    } else if (!row.paidOn) throw new ApiError(409, "Fakturan är inte markerad som betald.");
    await tx.$executeRaw`UPDATE "CustomerInvoice" SET "paidOn" = ${paidOn} WHERE "organizationId" = ${caller.organizationId} AND "id" = ${id}`;
    await logEvent(tx, caller, id, paidOn ? "paid" : "unpaid", paidOn ? `Betald ${paidOn}.` : `Tidigare betald ${row.paidOn}.`);
    await audit(tx, caller, "customer_invoice_payment", paidOn ? `Markerade ${row.label} som betald ${paidOn}.` : `Ångrade betald på ${row.label}.`);
  });
}

export const logInvoiceSent = async (caller: InvoiceCaller, id: string, label: string, email: string) => {
  await logEvent(prisma, caller, id, "sent", `Till ${email}.`);
  await audit(prisma, caller, "customer_invoice_sent", `Skickade ${label} till ${email}.`);
};
