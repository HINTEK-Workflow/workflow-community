import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { ApiError } from "@/lib/kfid/errors";
import { catalogueAccess } from "@/lib/catalogue/access";
import { articleHitById } from "@/lib/catalogue/server";
import { applyArticle } from "@/lib/catalogue/snapshot";
import { lineCatalogueJson, readLineCatalogue } from "@/lib/quotes/model";
import { readPriceSettings } from "@/lib/quotes/server";
import { canSeePrices } from "@/lib/workflow/material-prices";
import type { WorkflowPermissionProfile } from "@/lib/workflow/permissions";
import { formatPrice, parseAmount } from "@/lib/workflow/expenses";
import {
  lineSupplier, PURCHASE_MAX_LINES, PURCHASE_PAGE_SIZE, purchaseActions, purchaseEditable, purchaseInputSchema, purchaseLineInputSchema, purchaseNumberText, purchaseTotals, statusAfterDelivery,
  PURCHASE_FILTERS, type PurchaseAction, type PurchaseFilter, type PurchaseSort, type PurchaseInput, type PurchaseLineInput, type PurchaseLineView, type PurchaseListItem, type PurchaseSourceKind, type PurchaseStatus, type PurchaseView,
} from "./model";
import { z } from "zod";
import { customerTitle } from "@/lib/kfid/customer-name";

/**
 * Inköp (2026-10-16) on the server. Every query is bound to the caller's company; a line points at its purchase
 * through [purchaseId, organizationId], and triggers check that project, customer and work order are the company's own
 * (migration 20261016090000_purchases). Who may: everyone who may put material on a work order or a quote may make and
 * change purchases (catalogue "pick": "Alla som lägger material"); someone who may not see prices sees the
 * purchase without prices, and an article they pick is priced here from the company's own catalogue. Cloud only.
 */
export type PurchaseCaller = { organizationId: string; userId: string; admin: boolean; permissions: WorkflowPermissionProfile; storageMode: string };

export function purchaseAccess(caller: Pick<PurchaseCaller, "admin" | "permissions">) {
  return { use: catalogueAccess(caller).pick, prices: canSeePrices(caller) };
}

export function requirePurchases(caller: Pick<PurchaseCaller, "admin" | "permissions" | "storageMode">) {
  if (caller.storageMode !== "HINTEK_CLOUD") throw new ApiError(409, "Inköp finns bara med serverlagring.");
  if (!purchaseAccess(caller).use) throw new ApiError(403, "Du saknar behörighet att göra inköp.");
}

type Db = Prisma.TransactionClient | typeof prisma;
const decimal = (value: Prisma.Decimal | null) => value === null ? null : Number(value.toString());
const numberText = (value: Prisma.Decimal | null) => value === null ? "" : formatPrice(Number(value.toString()));
const isUniqueViolation = (error: unknown) => error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002";
const STALE = "Inköpet har ändrats av någon annan. Läs in det senaste.";

const lineSelect = { id: true, position: true, name: true, quantity: true, unit: true, unitPrice: true, supplierName: true, catalogue: true, deliveredAt: true, sourceKind: true, sourceId: true } as const;
const include = {
  project: { select: { id: true, name: true } },
  customer: { select: { id: true, name: true, company: true, customerType: true } },
  workOrder: { select: { id: true, title: true } },
  lines: { orderBy: [{ position: "asc" as const }, { id: "asc" as const }], select: lineSelect },
} satisfies Prisma.PurchaseInclude;
type Row = Prisma.PurchaseGetPayload<{ include: typeof include }>;
type LineRow = Row["lines"][number];

const sourceKindOf = (value: string | null): PurchaseSourceKind | null => value === "quote" || value === "work_order" ? value : null;

function lineView(line: LineRow, prices: boolean): PurchaseLineView {
  const stored = readLineCatalogue(line.catalogue);
  const { catalogue, ...article } = stored;
  return {
    id: line.id, name: line.name, quantity: numberText(line.quantity), unit: line.unit, unitPrice: prices ? numberText(line.unitPrice) : "", supplierName: line.supplierName,
    ...(catalogue && prices ? { catalogue } : catalogue ? { catalogue: { ...catalogue, unitPrice: "", rebate: undefined } } : {}), ...article,
    deliveredAt: line.deliveredAt?.toISOString() ?? null, sourceKind: sourceKindOf(line.sourceKind), sourceId: line.sourceId,
  };
}

async function names(ids: (string | null)[]) {
  const wanted = [...new Set(ids.filter((id): id is string => Boolean(id)))];
  if (!wanted.length) return new Map<string, string>();
  const users = await prisma.user.findMany({ where: { id: { in: wanted } }, select: { id: true, name: true, email: true } });
  return new Map(users.map((user) => [user.id, user.name || user.email || ""]));
}

function toView(row: Row, caller: PurchaseCaller, createdByName: string): PurchaseView {
  const prices = purchaseAccess(caller).prices;
  const lines = row.lines.map((line) => lineView(line, prices));
  const totals = purchaseTotals(lines.map((line) => ({ ...line, unitPrice: prices ? line.unitPrice : "" })));
  const status = row.status as PurchaseStatus;
  return {
    id: row.id, number: row.number, label: purchaseNumberText(row.number), title: row.title, notes: row.notes, status, revision: row.revision,
    project: row.project ? { id: row.project.id, name: row.project.name } : null,
    customer: row.customer ? { id: row.customer.id, name: customerTitle(row.customer) } : null,
    workOrder: row.workOrder ? { id: row.workOrder.id, title: row.workOrder.title } : null,
    orderedAt: row.orderedAt?.toISOString() ?? null, deliveredAt: row.deliveredAt?.toISOString() ?? null, createdAt: row.createdAt.toISOString(), updatedAt: row.updatedAt.toISOString(), createdByName,
    lines, totals: prices ? totals : { ...totals, amount: 0, bySupplier: totals.bySupplier.map((entry) => ({ ...entry, amount: 0 })) },
    canEdit: purchaseAccess(caller).use, pricesHidden: !prices, actions: purchaseAccess(caller).use ? purchaseActions(status, lines.length) : [],
  };
}

async function readRow(db: Db, caller: PurchaseCaller, id: string) {
  const row = await db.purchase.findFirst({ where: { id, organizationId: caller.organizationId }, include });
  if (!row) throw new ApiError(404, "Inköpet hittades inte.");
  return row;
}

export async function getPurchase(caller: PurchaseCaller, id: string): Promise<PurchaseView> {
  requirePurchases(caller);
  const row = await readRow(prisma, caller, id);
  return toView(row, caller, (await names([row.createdById])).get(row.createdById ?? "") ?? "");
}

/** The bounded list (Mina inköp): mine or everyone's, a status filter, a search in number, title and project. */
export async function listPurchases(caller: PurchaseCaller, options: { q?: string; filter?: PurchaseFilter; page?: number; mine?: boolean; projectId?: string; workOrderId?: string;
  /** Toppvisningen (2026-10-31): the order (PURCHASE_SORTS), and the number per status filter with the same scope and search. */
  sort?: PurchaseSort; counts?: boolean }) {
  requirePurchases(caller);
  const page = Math.max(1, Math.min(500, Math.trunc(options.page ?? 1)));
  const q = (options.q ?? "").trim().slice(0, 100);
  const number = /^i?-?0*(\d{1,6})$/i.exec(q)?.[1];
  const statuses: Record<PurchaseFilter, PurchaseStatus[] | null> = { open: ["DRAFT", "ORDERED"], draft: ["DRAFT"], ordered: ["ORDERED"], delivered: ["DELIVERED"], all: null };
  const whereFor = (filter: PurchaseFilter): Prisma.PurchaseWhereInput => {
    const wanted = statuses[filter];
    return {
      organizationId: caller.organizationId,
      ...(wanted ? { status: { in: wanted } } : {}),
      ...(options.mine ? { createdById: caller.userId } : {}),
      ...(options.projectId ? { projectId: options.projectId } : {}),
      ...(options.workOrderId ? { workOrderId: options.workOrderId } : {}),
      ...(q ? { OR: [{ title: { contains: q, mode: "insensitive" } }, { project: { name: { contains: q, mode: "insensitive" } } }, ...(number ? [{ number: Number(number) }] : [])] } : {}),
    };
  };
  const where = whereFor(options.filter ?? "open");
  const orderBy: Prisma.PurchaseOrderByWithRelationInput[] = options.sort === "title" ? [{ title: "asc" }, { number: "desc" }] : options.sort === "number" ? [{ number: "desc" }] : [{ updatedAt: "desc" }, { id: "asc" }];
  const [total, rows, counts] = await Promise.all([
    prisma.purchase.count({ where }),
    prisma.purchase.findMany({ where, orderBy, skip: (page - 1) * PURCHASE_PAGE_SIZE, take: PURCHASE_PAGE_SIZE, include }),
    options.counts ? Promise.all(PURCHASE_FILTERS.map(async (filter) => [filter, await prisma.purchase.count({ where: whereFor(filter) })] as const)).then((pairs) => Object.fromEntries(pairs) as Record<PurchaseFilter, number>) : Promise.resolve(null),
  ]);
  const prices = purchaseAccess(caller).prices;
  const items: PurchaseListItem[] = rows.map((row) => {
    const lines = row.lines.map((line) => lineView(line, prices));
    const totals = purchaseTotals(lines);
    return {
      id: row.id, label: purchaseNumberText(row.number), title: row.title, status: row.status as PurchaseStatus, suppliers: totals.bySupplier.map((entry) => entry.supplierName),
      lines: totals.lines, delivered: totals.delivered, amount: prices ? totals.amount : null,
      project: row.project ? { id: row.project.id, name: row.project.name } : null, workOrder: row.workOrder ? { id: row.workOrder.id, title: row.workOrder.title } : null,
      updatedAt: row.updatedAt.toISOString(), mine: row.createdById === caller.userId,
    };
  });
  return { items, total, hasMore: page * PURCHASE_PAGE_SIZE < total, page, canEdit: purchaseAccess(caller).use, counts };
}

/** The purchases a document may add its picked articles to (snabbvalet): open drafts, the document's project first. */
export async function openDrafts(caller: PurchaseCaller, options: { projectId?: string | null; workOrderId?: string | null }) {
  requirePurchases(caller);
  const rows = await prisma.purchase.findMany({
    where: { organizationId: caller.organizationId, status: "DRAFT" },
    orderBy: [{ updatedAt: "desc" }], take: 30,
    select: { id: true, number: true, title: true, projectId: true, workOrderId: true, createdById: true, project: { select: { name: true } } },
  });
  const score = (row: (typeof rows)[number]) => (options.workOrderId && row.workOrderId === options.workOrderId ? 4 : 0) + (options.projectId && row.projectId === options.projectId ? 2 : 0) + (row.createdById === caller.userId ? 1 : 0);
  return rows.sort((a, b) => score(b) - score(a)).slice(0, 15).map((row) => ({ id: row.id, label: purchaseNumberText(row.number), title: row.title, project: row.project?.name ?? "" }));
}

/** Where the linked purchases of a document stand: revision (for "Uppdatera") and status, only the company's own. */
export async function purchaseRefsStatus(caller: PurchaseCaller, ids: readonly string[]) {
  requirePurchases(caller);
  const wanted = [...new Set(ids)].slice(0, 20);
  if (!wanted.length) return [];
  const rows = await prisma.purchase.findMany({ where: { organizationId: caller.organizationId, id: { in: wanted } }, select: { id: true, number: true, title: true, revision: true, status: true } });
  return rows.map((row) => ({ id: row.id, label: purchaseNumberText(row.number), title: row.title, revision: row.revision, status: row.status as PurchaseStatus }));
}

// ---------- writing ----------

/** Project, customer and work order must be the company's own (the triggers say the same); a work order must be one. */
async function checkReferences(db: Db, organizationId: string, input: Pick<PurchaseInput, "projectId" | "customerId" | "workOrderId">) {
  const [project, customer, workOrder] = await Promise.all([
    input.projectId ? db.project.findFirst({ where: { id: input.projectId, organizationId }, select: { id: true, customerId: true } }) : null,
    input.customerId ? db.customer.findFirst({ where: { id: input.customerId, organizationId }, select: { id: true } }) : null,
    input.workOrderId ? db.workflowTask.findFirst({ where: { id: input.workOrderId, organizationId, kind: "WORK_ORDER" }, select: { id: true, projectId: true, customerId: true } }) : null,
  ]);
  if (input.projectId && !project) throw new ApiError(404, "Projektet hittades inte.");
  if (input.customerId && !customer) throw new ApiError(404, "Kunden hittades inte.");
  if (input.workOrderId && !workOrder) throw new ApiError(404, "Arbetsordern hittades inte.");
  // A work order or a project gives the purchase its project and customer when none was chosen.
  const projectId = input.projectId ?? workOrder?.projectId ?? null;
  const customerId = input.customerId ?? workOrder?.customerId ?? project?.customerId ?? null;
  return { projectId, customerId, workOrderId: input.workOrderId };
}

/**
 * The lines as they will be stored. Someone without the price right never sets a price: a line they keep keeps its
 * stored price, and an article they picked gets its price from the company's catalogue (as a work order's row does).
 */
async function priceLines(caller: PurchaseCaller, lines: readonly PurchaseLineInput[], stored: readonly LineRow[]) {
  const prices = purchaseAccess(caller).prices;
  const byId = new Map(stored.map((line) => [line.id, line]));
  return Promise.all(lines.map(async (raw) => {
    const line = purchaseLineInputSchema.parse(raw);
    const before = line.id ? byId.get(line.id) : undefined;
    let unitPrice = line.unitPrice;
    let catalogue = line.catalogue;
    if (line.pickedArticleId) {
      const hit = await articleHitById(caller.organizationId, line.pickedArticleId);
      const priced = hit ? applyArticle({ id: "x", name: line.name, quantity: line.quantity, unit: line.unit }, { ...hit, priceHidden: false }) : null;
      unitPrice = priced?.unitPrice ?? "";
      catalogue = priced?.catalogue ? { ...priced.catalogue } as typeof catalogue : undefined;
    } else if (!prices) {
      unitPrice = before ? numberText(before.unitPrice) : "";
      catalogue = before ? readLineCatalogue(before.catalogue).catalogue as typeof catalogue : undefined;
    }
    return { ...line, unitPrice, catalogue, before };
  }));
}

function lineData(organizationId: string, purchaseId: string, lines: Awaited<ReturnType<typeof priceLines>>, source?: { kind: PurchaseSourceKind; id: string } | null): Prisma.PurchaseLineCreateManyInput[] {
  return lines.map((line, index) => {
    const json = lineCatalogueJson({ catalogue: line.catalogue as never, articleNo: line.articleNo, articleSource: line.articleSource, manufacturerArticleNo: line.manufacturerArticleNo, wholesale: line.wholesale, product: line.product });
    const price = parseAmount(line.unitPrice);
    return {
      ...(line.id && line.before ? { id: line.id } : {}),
      organizationId, purchaseId, position: index, name: line.name, quantity: new Prisma.Decimal(parseAmount(line.quantity) ?? 0), unit: line.unit,
      unitPrice: line.unitPrice && price !== null ? new Prisma.Decimal(price) : null,
      supplierName: lineSupplier({ supplierName: line.supplierName || line.articleSource, catalogue: line.catalogue as never }).slice(0, 200),
      catalogue: json ? (json as Prisma.InputJsonValue) : Prisma.DbNull,
      deliveredAt: line.before?.deliveredAt ?? null,
      sourceKind: line.before?.sourceKind ?? source?.kind ?? null, sourceId: line.before?.sourceId ?? source?.id ?? null,
    };
  });
}

/** A new purchase (Nytt inköp), empty or with lines; the next number in the company. */
export async function createPurchase(caller: PurchaseCaller, raw: unknown, source?: { kind: PurchaseSourceKind; id: string } | null): Promise<{ id: string; label: string; revision: number; lineIds: string[] }> {
  requirePurchases(caller);
  const input = purchaseInputSchema.parse(raw);
  const lines = await priceLines(caller, input.lines.map((line) => ({ ...line, id: undefined })), []);
  for (let attempt = 0; ; attempt += 1) {
    try {
      return await prisma.$transaction(async (tx) => {
        const links = await checkReferences(tx, caller.organizationId, input);
        const last = await tx.purchase.aggregate({ where: { organizationId: caller.organizationId }, _max: { number: true } });
        const number = (last._max.number ?? 0) + 1;
        const row = await tx.purchase.create({ data: { organizationId: caller.organizationId, number, title: input.title, notes: input.notes, ...links, createdById: caller.userId, updatedById: caller.userId }, select: { id: true, revision: true } });
        const lineIds: string[] = [];
        for (const data of lineData(caller.organizationId, row.id, lines, source)) lineIds.push((await tx.purchaseLine.create({ data, select: { id: true } })).id);
        return { id: row.id, label: purchaseNumberText(number), revision: row.revision, lineIds };
      });
    } catch (error) {
      // Two purchases made at the same moment got the same number: the second takes the next one.
      if (isUniqueViolation(error) && attempt < 3) continue;
      throw error;
    }
  }
}

async function editableRow(db: Db, caller: PurchaseCaller, id: string) {
  const row = await readRow(db, caller, id);
  if (!purchaseEditable(row.status as PurchaseStatus)) throw new ApiError(409, "Inköpet är beställt och låst. Öppna det igen för att ändra raderna.");
  return row;
}

/** A draft's contents and lines, replaced as a whole; `revision` is the one the person started from. */
export async function updatePurchase(caller: PurchaseCaller, id: string, revision: number, raw: unknown): Promise<{ id: string; revision: number }> {
  requirePurchases(caller);
  const input = purchaseInputSchema.parse(raw);
  const current = await editableRow(prisma, caller, id);
  const lines = await priceLines(caller, input.lines, current.lines);
  return prisma.$transaction(async (tx) => {
    const links = await checkReferences(tx, caller.organizationId, input);
    const changed = await tx.purchase.updateMany({ where: { id, organizationId: caller.organizationId, revision, status: "DRAFT" }, data: { title: input.title, notes: input.notes, ...links, updatedById: caller.userId, revision: { increment: 1 } } });
    if (!changed.count) throw new ApiError(409, STALE);
    await tx.purchaseLine.deleteMany({ where: { purchaseId: id, organizationId: caller.organizationId } });
    if (lines.length) await tx.purchaseLine.createMany({ data: lineData(caller.organizationId, id, lines) });
    return { id, revision: revision + 1 };
  });
}

/**
 * Lägg till (Artiklar, and snabbvalet on a document): lines appended to a draft, or to a new purchase when none is
 * given. Returns the new lines' ids so a document's rows can point at them.
 */
export async function addPurchaseLines(caller: PurchaseCaller, target: { id?: string | null; create?: unknown }, rawLines: readonly unknown[], source?: { kind: PurchaseSourceKind; id: string } | null) {
  requirePurchases(caller);
  const parsed = z.array(purchaseLineInputSchema).min(1).max(50).parse(rawLines);
  if (!target.id) return createPurchase(caller, { ...(target.create && typeof target.create === "object" ? target.create : {}), lines: parsed }, source);
  const current = await editableRow(prisma, caller, target.id);
  if (current.lines.length + parsed.length > PURCHASE_MAX_LINES) throw new ApiError(422, `Ett inköp har högst ${PURCHASE_MAX_LINES} rader.`);
  const lines = await priceLines(caller, parsed.map((line) => ({ ...line, id: undefined })), []);
  return prisma.$transaction(async (tx) => {
    const bumped = await tx.purchase.updateMany({ where: { id: current.id, organizationId: caller.organizationId, status: "DRAFT" }, data: { updatedById: caller.userId, revision: { increment: 1 } } });
    if (!bumped.count) throw new ApiError(409, STALE);
    const lineIds: string[] = [];
    const data = lineData(caller.organizationId, current.id, lines, source).map((line, index) => ({ ...line, position: current.lines.length + index }));
    for (const line of data) lineIds.push((await tx.purchaseLine.create({ data: line, select: { id: true } })).id);
    const row = await tx.purchase.findFirstOrThrow({ where: { id: current.id, organizationId: caller.organizationId }, select: { number: true, revision: true } });
    return { id: current.id, label: purchaseNumberText(row.number), revision: row.revision, lineIds };
  });
}

/**
 * Snabbvalet after a document was saved: the rows it picked into the purchase follow it – benämning, antal and enhet of
 * each listed line, and the lines it picked earlier but no longer has are removed. Only a draft changes; an ordered
 * purchase keeps what was ordered. Lines from elsewhere are never touched.
 */
export async function syncDocumentLines(caller: PurchaseCaller, purchaseId: string, source: { kind: PurchaseSourceKind; id: string }, raw: readonly unknown[], forgetRaw: readonly unknown[] = []) {
  requirePurchases(caller);
  const rows = z.array(z.object({ lineId: z.string().trim().min(1).max(100), name: z.string().trim().max(300), quantity: z.string().trim().max(40), unit: z.string().trim().max(40) })).max(PURCHASE_MAX_LINES).parse(raw);
  // Lines the document added and then let go of before it was first saved (another article picked on the row, the row
  // removed): they never got the document as their source, so the document names them. Only a line without another source.
  const forget = new Set(z.array(z.string().trim().min(1).max(100)).max(PURCHASE_MAX_LINES).parse(forgetRaw));
  const current = await readRow(prisma, caller, purchaseId);
  if (current.status !== "DRAFT") return { id: current.id, revision: current.revision, changed: false };
  const listed = new Map(rows.map((row) => [row.lineId, row]));
  const ofDocument = (line: LineRow) => listed.has(line.id) || (line.sourceKind === source.kind && line.sourceId === source.id) || (forget.has(line.id) && (!line.sourceKind || (line.sourceKind === source.kind && line.sourceId === source.id)));
  type Update = { id: string; remove: true } | { id: string; remove: false; name: string; quantity: number; unit: string };
  const updates = current.lines.filter(ofDocument).flatMap((line): Update[] => {
    const row = listed.get(line.id);
    if (!row) return [{ id: line.id, remove: true }];
    const quantity = parseAmount(row.quantity);
    const same = line.name === (row.name || line.name) && decimal(line.quantity) === (quantity ?? decimal(line.quantity)) && line.unit === row.unit && line.sourceId === source.id;
    return same ? [] : [{ id: line.id, remove: false, name: (row.name || line.name).slice(0, 300), quantity: quantity ?? decimal(line.quantity) ?? 0, unit: row.unit }];
  });
  if (!updates.length) return { id: current.id, revision: current.revision, changed: false };
  return prisma.$transaction(async (tx) => {
    for (const update of updates) {
      if (update.remove) await tx.purchaseLine.deleteMany({ where: { id: update.id, organizationId: caller.organizationId, purchaseId } });
      else await tx.purchaseLine.updateMany({ where: { id: update.id, organizationId: caller.organizationId, purchaseId }, data: { name: update.name, quantity: new Prisma.Decimal(update.quantity), unit: update.unit, sourceKind: source.kind, sourceId: source.id } });
    }
    const bumped = await tx.purchase.updateMany({ where: { id: purchaseId, organizationId: caller.organizationId, status: "DRAFT" }, data: { updatedById: caller.userId, revision: { increment: 1 } } });
    if (!bumped.count) throw new ApiError(409, STALE);
    return { id: purchaseId, revision: current.revision + 1, changed: true };
  });
}

/** Beställd (after the order file went to the wholesaler), Öppna igen, Makulera. */
export async function changePurchaseStatus(caller: PurchaseCaller, id: string, action: Exclude<PurchaseAction, "delete">, now = new Date()) {
  requirePurchases(caller);
  const row = await readRow(prisma, caller, id);
  const status = row.status as PurchaseStatus;
  if (!purchaseActions(status, row.lines.length).includes(action)) throw new ApiError(409, action === "order" ? "Lägg till minst en rad innan inköpet markeras som beställt." : "Det går inte i inköpets nuvarande läge.");
  const data: Prisma.PurchaseUpdateManyMutationInput = action === "order" ? { status: "ORDERED", orderedAt: now, orderedById: caller.userId }
    : action === "cancel" ? { status: "CANCELLED" }
    // Öppna igen: back to a draft; what was ticked as delivered is kept on the lines.
    : { status: "DRAFT", orderedAt: null, orderedById: null, deliveredAt: null };
  const changed = await prisma.purchase.updateMany({ where: { id, organizationId: caller.organizationId, status: row.status }, data: { ...data, updatedById: caller.userId } });
  if (!changed.count) throw new ApiError(409, STALE);
  return { id, status: data.status as PurchaseStatus };
}

/** Levererad per rad (2026-10-16): a line is ticked when it has come; the purchase is Levererad when all have. */
export async function setLineDelivered(caller: PurchaseCaller, id: string, lineId: string, delivered: boolean, now = new Date()) {
  requirePurchases(caller);
  return prisma.$transaction(async (tx) => {
    const row = await readRow(tx, caller, id);
    if (row.status !== "ORDERED" && row.status !== "DELIVERED") throw new ApiError(409, "Markera inköpet som beställt innan raderna bockas av.");
    const line = row.lines.find((item) => item.id === lineId);
    if (!line) throw new ApiError(404, "Raden hittades inte.");
    await tx.purchaseLine.updateMany({ where: { id: lineId, organizationId: caller.organizationId, purchaseId: id }, data: delivered ? { deliveredAt: now, deliveredById: caller.userId } : { deliveredAt: null, deliveredById: null } });
    const lines = row.lines.map((item) => item.id === lineId ? { deliveredAt: delivered ? now : null } : { deliveredAt: item.deliveredAt });
    const status = statusAfterDelivery(row.status as PurchaseStatus, lines);
    await tx.purchase.updateMany({ where: { id, organizationId: caller.organizationId }, data: { status, deliveredAt: status === "DELIVERED" ? now : null, updatedById: caller.userId } });
    return { id, status, delivered: lines.filter((item) => item.deliveredAt).length, lines: lines.length };
  });
}

/** Only a draft is deleted; an ordered purchase is cancelled instead, so what was ordered stays readable. */
export async function deletePurchase(caller: PurchaseCaller, id: string) {
  requirePurchases(caller);
  const removed = await prisma.purchase.deleteMany({ where: { id, organizationId: caller.organizationId, status: "DRAFT" } });
  if (!removed.count) throw new ApiError(409, "Bara ett utkast kan tas bort. Makulera ett beställt inköp i stället.");
}

/** The company's material markup, for a quote line or a material row made from a purchase (only with the price right). */
export async function companyMaterialMarkup(caller: PurchaseCaller) {
  return purchaseAccess(caller).prices ? (await readPriceSettings(caller.organizationId)).markupPercent : "";
}
