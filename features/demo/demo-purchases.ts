import { z } from "zod";
import { catalogueAccess } from "@/lib/catalogue/access";
import { addSwedishDays } from "@/lib/swedish-time";
import { customerTitle } from "@/lib/kfid/customer-name";
import { workListCountsAllowed } from "@/lib/workflow/work-list";
import { formatPrice, parseAmount } from "@/lib/workflow/expenses";
import { canSeePrices, roundOre } from "@/lib/workflow/material-prices";
import type { WorkflowPermissionProfile } from "@/lib/workflow/permissions";
import {
  PURCHASE_FILTERS, PURCHASE_MAX_LINES, PURCHASE_PAGE_SIZE, PURCHASE_SORTS, PURCHASE_SOURCE_KINDS, purchaseActions, purchaseEditable, purchaseInputSchema, purchaseLineInputSchema, purchaseNumberText,
  purchaseTotals, statusAfterDelivery, type PurchaseAction, type PurchaseFilter, type PurchaseLineView, type PurchaseListItem, type PurchaseSourceKind, type PurchaseStatus, type PurchaseView,
} from "@/lib/purchases/model";
import { parseListSort } from "@/lib/list-filter";
import type { DemoDatabase } from "./demo-data";

/**
 * Inköp och Artiklar i demon (2026-11-04): /api/purchases answered from memory, in the same shapes and with the same pure
 * rules as lib/purchases/server.ts (statuses, totals, what may be done in which status, delivery ticks). Five invented
 * purchases from two invented suppliers, linked to the demo's own projects and work orders: an ordered one with one line
 * delivered, a delivered one, two drafts and a cancelled one. Dates are relative to today. Nothing leaves the browser;
 * a reload starts over. (Artiklar's search in the price file is answered by demo-catalogue.ts.)
 */
export class DemoPurchaseError extends Error {
  constructor(readonly status: number, message: string) { super(message); }
}

type StoredLine = Omit<PurchaseLineView, "unitPrice" | "quantity"> & { quantity: number; unitPrice: number | null; position: number };
type DemoPurchase = {
  id: string; number: number; title: string; notes: string; status: PurchaseStatus; revision: number;
  projectId: string | null; customerId: string | null; workOrderId: string | null;
  orderedAt: string | null; deliveredAt: string | null; createdAt: string; updatedAt: string; createdById: string; lines: StoredLine[];
};
type Store = { purchases: DemoPurchase[]; lineSequence: number; sequence: number };

export type DemoPurchaseContext = {
  db: DemoDatabase; user: { id: string; name: string; permissions: WorkflowPermissionProfile }; admin: boolean; now: Date;
};
type DemoPurchaseRequest = { method: string; url: URL; body: unknown };

const STALE = "Inköpet har ändrats av någon annan. Läs in det senaste.";
const SUPPLIERS = ["Demo-Grossist AB", "Demo-Kabelhandel AB"] as const;
const stores = new WeakMap<DemoDatabase, Store>();

function seed(db: DemoDatabase, now: Date): Store {
  const at = (offset: number) => addSwedishDays(now, offset).toISOString();
  const task = (id: string) => (db.tasks.some((item) => item.id === id) ? id : null);
  const project = (id: string) => (db.projects.some((item) => item.id === id) ? id : null);
  let lineSequence = 0;
  const line = (position: number, name: string, quantity: number, unit: string, unitPrice: number | null, supplierName: string, articleNo: string, deliveredAt: string | null = null): StoredLine => ({
    id: `demo-purchase-line-${++lineSequence}`, position, name, quantity, unit, unitPrice, supplierName, articleNo, articleSource: supplierName, deliveredAt, sourceKind: null, sourceId: null,
  });
  const purchases: DemoPurchase[] = [
    { id: "demo-purchase-1", number: 1, title: "Material laddplatser plan –1", notes: "Levereras till garaget, ring förvaltaren före lossning.", status: "ORDERED", revision: 3,
      projectId: project("demo-project-laddplatser"), customerId: null, workOrderId: task("demo-task-garage-laddboxar"), orderedAt: at(-6), deliveredAt: null, createdAt: at(-9), updatedAt: at(-2), createdById: "demo-elna",
      lines: [
        line(0, "Laddbox 11 kW", 6, "st", 5900, SUPPLIERS[0], "LB-11", at(-2)),
        line(1, "Kabel EQLQ 5G6", 120, "m", 31.5, SUPPLIERS[1], "KB-5G6", at(-2)),
        line(2, "Garagecentral med lastbalansering", 1, "st", 11200, SUPPLIERS[0], "GC-LB"),
      ] },
    { id: "demo-purchase-2", number: 2, title: "LED-armaturer kontoret", notes: "", status: "DELIVERED", revision: 4,
      projectId: project("demo-project-belysning"), customerId: null, workOrderId: task("demo-task-kontor-led"), orderedAt: at(-21), deliveredAt: at(-14), createdAt: at(-24), updatedAt: at(-14), createdById: "demo-elna",
      lines: [
        line(0, "LED-panel 600×600 40 W", 24, "st", 389, SUPPLIERS[0], "LP-6040", at(-14)),
        line(1, "Nödbelysning med batteri", 4, "st", 640, SUPPLIERS[0], "NB-3H", at(-14)),
      ] },
    { id: "demo-purchase-3", number: 3, title: "", notes: "Prisat på senaste prislistan.", status: "DRAFT", revision: 2,
      projectId: project("demo-project-elcentral"), customerId: null, workOrderId: task("demo-task-villa-central"), orderedAt: null, deliveredAt: null, createdAt: at(-4), updatedAt: at(-1), createdById: "demo-elis",
      lines: [
        line(0, "Jordfelsbrytare 2-pol 25 A 30 mA", 3, "st", 412, SUPPLIERS[0], "200110"),
        line(1, "Automatsäkring 1-pol 16 A C-kurva", 12, "st", 56, SUPPLIERS[0], "200145"),
        line(2, "Kabel 5G2,5 mm² svart", 40, "m", 31.5, SUPPLIERS[1], "100305"),
      ] },
    { id: "demo-purchase-4", number: 4, title: "Servicematerial Reläbackens Mekaniska AB", notes: "", status: "DRAFT", revision: 1,
      projectId: null, customerId: "demo-customer-relabacken", workOrderId: task("demo-task-service-relabacken-laddbox"), orderedAt: null, deliveredAt: null, createdAt: at(-2), updatedAt: at(-2), createdById: "demo-elna",
      lines: [
        line(0, "Laddbox 7,4 kW med kabel", 1, "st", null, SUPPLIERS[0], "LB-7"),
        line(1, "Kabelstege 200 mm, 3 m", 2, "st", 145, SUPPLIERS[1], "KS-200"),
      ] },
    { id: "demo-purchase-5", number: 5, title: "Reservdelar ställverk", notes: "Makulerad: leverantören hade ledtid över fem veckor.", status: "CANCELLED", revision: 2,
      projectId: project("demo-project-stallverk"), customerId: null, workOrderId: null, orderedAt: null, deliveredAt: null, createdAt: at(-12), updatedAt: at(-10), createdById: "demo-elna",
      lines: [line(0, "Brytarmotor 24 V", 2, "st", 2850, SUPPLIERS[0], "BM-24")] },
  ];
  // The customer follows the work order or the project, as a purchase made on the server gets it.
  for (const purchase of purchases) purchase.customerId ??= db.tasks.find((item) => item.id === purchase.workOrderId)?.customerId ?? db.projects.find((item) => item.id === purchase.projectId)?.customerId ?? null;
  return { purchases, lineSequence, sequence: 100 };
}

const storeOf = (ctx: DemoPurchaseContext) => { let store = stores.get(ctx.db); if (!store) { store = seed(ctx.db, ctx.now); stores.set(ctx.db, store); } return store; };
const money = (value: number | null) => (value === null ? "" : formatPrice(value));
const amountOf = (value: string) => { const parsed = parseAmount(value); return value.trim() === "" || parsed === null ? null : roundOre(parsed); };

function access(ctx: DemoPurchaseContext) {
  const caller = { admin: ctx.admin, permissions: ctx.user.permissions };
  if (!catalogueAccess(caller).pick) throw new DemoPurchaseError(403, "Du saknar behörighet att göra inköp.");
  return { prices: canSeePrices(caller) };
}

function lineView(line: StoredLine, prices: boolean): PurchaseLineView {
  const { position, ...rest } = line;
  void position;
  return { ...rest, quantity: formatPrice(line.quantity), unitPrice: prices ? money(line.unitPrice) : "", ...(line.catalogue && !prices ? { catalogue: { ...line.catalogue, unitPrice: "", rebate: undefined } } : {}) };
}

function view(ctx: DemoPurchaseContext, purchase: DemoPurchase, prices: boolean): PurchaseView {
  const lines = purchase.lines.map((line) => lineView(line, prices));
  const totals = purchaseTotals(lines);
  const project = ctx.db.projects.find((item) => item.id === purchase.projectId);
  const customer = ctx.db.customers.find((item) => item.id === purchase.customerId);
  const order = ctx.db.tasks.find((item) => item.id === purchase.workOrderId);
  return {
    id: purchase.id, number: purchase.number, label: purchaseNumberText(purchase.number), title: purchase.title, notes: purchase.notes, status: purchase.status, revision: purchase.revision,
    project: project ? { id: project.id, name: project.name } : null, customer: customer ? { id: customer.id, name: customerTitle(customer) } : null, workOrder: order ? { id: order.id, title: order.title } : null,
    orderedAt: purchase.orderedAt, deliveredAt: purchase.deliveredAt, createdAt: purchase.createdAt, updatedAt: purchase.updatedAt, createdByName: ctx.db.users.find((user) => user.id === purchase.createdById)?.name ?? "",
    lines, totals: prices ? totals : { ...totals, amount: 0, bySupplier: totals.bySupplier.map((entry) => ({ ...entry, amount: 0 })) },
    canEdit: true, pricesHidden: !prices, actions: purchaseActions(purchase.status, lines.length),
  };
}

function find(ctx: DemoPurchaseContext, id: string) {
  const purchase = storeOf(ctx).purchases.find((item) => item.id === id);
  if (!purchase) throw new DemoPurchaseError(404, "Inköpet hittades inte.");
  return purchase;
}

/**
 * The chosen links must exist in the demo company, as the server checks them (checkReferences in lib/purchases/server.ts):
 * a work order or a project gives the purchase its project and customer when none was chosen.
 */
function links(ctx: DemoPurchaseContext, input: { projectId: string | null; customerId: string | null; workOrderId: string | null }) {
  const project = input.projectId ? ctx.db.projects.find((item) => item.id === input.projectId) : null;
  const order = input.workOrderId ? ctx.db.tasks.find((item) => item.id === input.workOrderId && item.kind === "WORK_ORDER") : null;
  if (input.projectId && !project) throw new DemoPurchaseError(404, "Projektet hittades inte.");
  if (input.customerId && !ctx.db.customers.some((item) => item.id === input.customerId)) throw new DemoPurchaseError(404, "Kunden hittades inte.");
  if (input.workOrderId && !order) throw new DemoPurchaseError(404, "Arbetsordern hittades inte.");
  return { projectId: input.projectId ?? order?.projectId ?? null, customerId: input.customerId ?? order?.customerId ?? project?.customerId ?? null, workOrderId: input.workOrderId };
}

type LineInput = z.output<typeof purchaseLineInputSchema>;
function storedLine(store: Store, input: LineInput, position: number, before?: StoredLine, from?: { kind: PurchaseSourceKind; id: string } | null): StoredLine {
  const quantity = parseAmount(input.quantity) ?? 0;
  if (quantity <= 0) throw new DemoPurchaseError(422, "Antal måste vara större än noll.");
  const supplierName = (input.catalogue?.supplierName || input.supplierName || "").trim();
  return {
    id: before?.id ?? `demo-purchase-line-${++store.lineSequence}`, position, name: input.name, quantity, unit: input.unit, unitPrice: amountOf(input.unitPrice) ?? (input.catalogue ? amountOf(input.catalogue.unitPrice) : null), supplierName,
    ...(input.catalogue ? { catalogue: input.catalogue as StoredLine["catalogue"] } : {}),
    articleNo: input.articleNo, articleSource: input.articleSource, manufacturerArticleNo: input.manufacturerArticleNo,
    ...(input.wholesale ? { wholesale: input.wholesale } : {}), ...(input.product ? { product: input.product } : {}),
    deliveredAt: before?.deliveredAt ?? null, sourceKind: before?.sourceKind ?? from?.kind ?? null, sourceId: before?.sourceId ?? from?.id ?? null,
  } as StoredLine;
}

const sourceSchema = z.object({ kind: z.enum(PURCHASE_SOURCE_KINDS), id: z.string().trim().min(1).max(100) });
const idSchema = z.string().trim().min(1).max(100);
const requestSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("create"), purchase: z.unknown() }),
  z.object({ action: z.literal("save"), id: idSchema, revision: z.number().int().min(1), purchase: z.unknown() }),
  z.object({ action: z.literal("add_lines"), id: idSchema.nullable().optional(), create: z.unknown().optional(), lines: z.array(z.unknown()).min(1).max(50), source: sourceSchema.nullable().optional() }),
  z.object({ action: z.literal("sync"), id: idSchema, source: sourceSchema, lines: z.array(z.unknown()).max(300), forget: z.array(z.unknown()).max(300).optional() }),
  z.object({ action: z.literal("status"), id: idSchema, to: z.enum(["order", "reopen", "cancel"]) }),
  z.object({ action: z.literal("deliver"), id: idSchema, lineId: idSchema, delivered: z.boolean() }),
  z.object({ action: z.literal("delete"), id: idSchema }),
]);

function create(ctx: DemoPurchaseContext, raw: unknown, from?: { kind: PurchaseSourceKind; id: string } | null) {
  const store = storeOf(ctx);
  const input = purchaseInputSchema.parse(raw);
  const target = links(ctx, input);
  const now = ctx.now.toISOString();
  const number = Math.max(0, ...store.purchases.map((item) => item.number)) + 1;
  const lines = input.lines.map((line, index) => storedLine(store, { ...line, id: undefined }, index, undefined, from));
  const purchase: DemoPurchase = { id: `demo-purchase-new-${++store.sequence}`, number, title: input.title, notes: input.notes, status: "DRAFT", revision: 1, ...target, orderedAt: null, deliveredAt: null, createdAt: now, updatedAt: now, createdById: ctx.user.id, lines };
  store.purchases.push(purchase);
  return { id: purchase.id, label: purchaseNumberText(number), revision: purchase.revision, lineIds: lines.map((line) => line.id) };
}

function editable(ctx: DemoPurchaseContext, purchaseId: string) {
  const purchase = find(ctx, purchaseId);
  if (!purchaseEditable(purchase.status)) throw new DemoPurchaseError(409, "Inköpet är beställt och låst. Öppna det igen för att ändra raderna.");
  return purchase;
}

function list(ctx: DemoPurchaseContext, params: URLSearchParams, prices: boolean) {
  const filter = (PURCHASE_FILTERS as readonly string[]).includes(params.get("filter") ?? "") ? params.get("filter") as PurchaseFilter : "open";
  const mine = params.get("mine") === "1";
  const q = (params.get("q") ?? "").trim().slice(0, 100).toLocaleLowerCase("sv-SE");
  const number = /^i?-?0*(\d{1,6})$/i.exec(q)?.[1];
  const page = Math.max(1, Math.min(500, Math.trunc(Number(params.get("page")) || 1)));
  const statuses: Record<PurchaseFilter, PurchaseStatus[] | null> = { open: ["DRAFT", "ORDERED"], draft: ["DRAFT"], ordered: ["ORDERED"], delivered: ["DELIVERED"], all: null };
  const projectId = params.get("projectId"), workOrderId = params.get("workOrderId");
  const projectName = (item: DemoPurchase) => (ctx.db.projects.find((project) => project.id === item.projectId)?.name ?? "").toLocaleLowerCase("sv-SE");
  const base = storeOf(ctx).purchases.filter((item) => (!mine || item.createdById === ctx.user.id) && (!projectId || item.projectId === projectId) && (!workOrderId || item.workOrderId === workOrderId)
    && (!q || item.title.toLocaleLowerCase("sv-SE").includes(q) || projectName(item).includes(q) || (number !== undefined && item.number === Number(number))));
  const inFilter = (item: DemoPurchase, which: PurchaseFilter) => { const wanted = statuses[which]; return !wanted || wanted.includes(item.status); };
  const sort = parseListSort(params.get("sort"), PURCHASE_SORTS);
  const ordered = base.filter((item) => inFilter(item, filter)).sort((a, b) => sort === "title" ? a.title.localeCompare(b.title, "sv") || b.number - a.number : sort === "number" ? b.number - a.number : b.updatedAt.localeCompare(a.updatedAt) || a.id.localeCompare(b.id));
  const items: PurchaseListItem[] = ordered.slice((page - 1) * PURCHASE_PAGE_SIZE, page * PURCHASE_PAGE_SIZE).map((item) => {
    const shown = view(ctx, item, prices);
    return { id: item.id, label: shown.label, title: item.title, status: item.status, suppliers: shown.totals.bySupplier.map((entry) => entry.supplierName), lines: shown.totals.lines, delivered: shown.totals.delivered, amount: prices ? shown.totals.amount : null,
      project: shown.project, workOrder: shown.workOrder, updatedAt: item.updatedAt, mine: item.createdById === ctx.user.id };
  });
  const counts = params.get("counts") === "1" && workListCountsAllowed(mine ? "mine" : "all", ctx.admin)
    ? Object.fromEntries(PURCHASE_FILTERS.map((which) => [which, base.filter((item) => inFilter(item, which)).length])) : null;
  return { items, total: ordered.length, hasMore: page * PURCHASE_PAGE_SIZE < ordered.length, page, canEdit: true, counts };
}

/** One /api/purchases request, as lib/purchases/server.ts answers it. */
export function demoPurchases(ctx: DemoPurchaseContext, request: DemoPurchaseRequest): unknown {
  const { prices } = access(ctx);
  const store = storeOf(ctx);
  const params = request.url.searchParams;
  if (request.method === "GET") {
    const part = params.get("part");
    if (part === "drafts") {
      const projectId = params.get("projectId"), workOrderId = params.get("workOrderId");
      const score = (item: DemoPurchase) => (workOrderId && item.workOrderId === workOrderId ? 4 : 0) + (projectId && item.projectId === projectId ? 2 : 0) + (item.createdById === ctx.user.id ? 1 : 0);
      return { drafts: store.purchases.filter((item) => item.status === "DRAFT").sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)).sort((a, b) => score(b) - score(a)).slice(0, 15)
        .map((item) => ({ id: item.id, label: purchaseNumberText(item.number), title: item.title, project: ctx.db.projects.find((project) => project.id === item.projectId)?.name ?? "" })) };
    }
    if (part === "refs") {
      const wanted = new Set((params.get("ids") ?? "").split(",").map((value) => value.trim()).filter(Boolean).slice(0, 20));
      return { purchases: store.purchases.filter((item) => wanted.has(item.id)).map((item) => ({ id: item.id, label: purchaseNumberText(item.number), title: item.title, revision: item.revision, status: item.status })) };
    }
    const one = params.get("id");
    if (one !== null) return { purchase: view(ctx, find(ctx, one), prices), markupPercent: prices ? "15" : "" };
    return list(ctx, params, prices);
  }
  if (request.method !== "POST") throw new DemoPurchaseError(405, "Den här åtgärden finns inte.");
  const input = requestSchema.parse(request.body);
  const now = ctx.now.toISOString();
  switch (input.action) {
    case "create": return create(ctx, input.purchase);
    case "save": {
      const purchase = editable(ctx, input.id);
      const next = purchaseInputSchema.parse(input.purchase);
      if (purchase.revision !== input.revision) throw new DemoPurchaseError(409, STALE);
      const target = links(ctx, next);
      const lines = next.lines.map((line, index) => storedLine(store, line, index, purchase.lines.find((before) => before.id === line.id)));
      // Someone without the price right keeps the stored prices, as on the server.
      if (!prices) for (const line of lines) { const before = purchase.lines.find((item) => item.id === line.id); if (before) { line.unitPrice = before.unitPrice; line.catalogue = before.catalogue; } }
      Object.assign(purchase, { title: next.title, notes: next.notes, ...target, lines, revision: purchase.revision + 1, updatedAt: now });
      return { id: purchase.id, revision: purchase.revision };
    }
    case "add_lines": {
      const parsed = z.array(purchaseLineInputSchema).min(1).max(50).parse(input.lines);
      if (!input.id) return create(ctx, { ...(input.create && typeof input.create === "object" ? input.create : {}), lines: parsed }, input.source ?? null);
      const purchase = editable(ctx, input.id);
      if (purchase.lines.length + parsed.length > PURCHASE_MAX_LINES) throw new DemoPurchaseError(422, `Ett inköp har högst ${PURCHASE_MAX_LINES} rader.`);
      const added = parsed.map((line, index) => storedLine(store, { ...line, id: undefined }, purchase.lines.length + index, undefined, input.source ?? null));
      purchase.lines.push(...added);
      purchase.revision += 1;
      purchase.updatedAt = now;
      return { id: purchase.id, label: purchaseNumberText(purchase.number), revision: purchase.revision, lineIds: added.map((line) => line.id) };
    }
    case "sync": {
      const rows = z.array(z.object({ lineId: idSchema, name: z.string().trim().max(300), quantity: z.string().trim().max(40), unit: z.string().trim().max(40) })).max(PURCHASE_MAX_LINES).parse(input.lines);
      const forget = new Set(z.array(idSchema).max(PURCHASE_MAX_LINES).parse(input.forget ?? []));
      const purchase = find(ctx, input.id);
      if (purchase.status !== "DRAFT") return { id: purchase.id, revision: purchase.revision, changed: false };
      const listed = new Map(rows.map((row) => [row.lineId, row]));
      let changed = false;
      for (const line of [...purchase.lines]) {
        const ofDocument = listed.has(line.id) || (line.sourceKind === input.source.kind && line.sourceId === input.source.id) || (forget.has(line.id) && (!line.sourceKind || (line.sourceKind === input.source.kind && line.sourceId === input.source.id)));
        if (!ofDocument) continue;
        const row = listed.get(line.id);
        if (!row) { purchase.lines.splice(purchase.lines.indexOf(line), 1); changed = true; continue; }
        const quantity = parseAmount(row.quantity) ?? line.quantity;
        if (line.name !== (row.name || line.name) || line.quantity !== quantity || line.unit !== row.unit || line.sourceId !== input.source.id) {
          Object.assign(line, { name: (row.name || line.name).slice(0, 300), quantity, unit: row.unit, sourceKind: input.source.kind, sourceId: input.source.id });
          changed = true;
        }
      }
      if (changed) { purchase.revision += 1; purchase.updatedAt = now; }
      return { id: purchase.id, revision: purchase.revision, changed };
    }
    case "status": {
      const purchase = find(ctx, input.id);
      const action = input.to as Exclude<PurchaseAction, "delete">;
      if (!purchaseActions(purchase.status, purchase.lines.length).includes(action)) throw new DemoPurchaseError(409, action === "order" ? "Lägg till minst en rad innan inköpet markeras som beställt." : "Det går inte i inköpets nuvarande läge.");
      if (action === "order") Object.assign(purchase, { status: "ORDERED", orderedAt: now });
      else if (action === "cancel") purchase.status = "CANCELLED";
      else Object.assign(purchase, { status: "DRAFT", orderedAt: null, deliveredAt: null });
      purchase.updatedAt = now;
      return { id: purchase.id, status: purchase.status };
    }
    case "deliver": {
      const purchase = find(ctx, input.id);
      if (purchase.status !== "ORDERED" && purchase.status !== "DELIVERED") throw new DemoPurchaseError(409, "Markera inköpet som beställt innan raderna bockas av.");
      const line = purchase.lines.find((item) => item.id === input.lineId);
      if (!line) throw new DemoPurchaseError(404, "Raden hittades inte.");
      line.deliveredAt = input.delivered ? now : null;
      purchase.status = statusAfterDelivery(purchase.status, purchase.lines);
      purchase.deliveredAt = purchase.status === "DELIVERED" ? now : null;
      purchase.updatedAt = now;
      return { id: purchase.id, status: purchase.status, delivered: purchase.lines.filter((item) => item.deliveredAt).length, lines: purchase.lines.length };
    }
    case "delete": {
      const purchase = find(ctx, input.id);
      if (purchase.status !== "DRAFT") throw new DemoPurchaseError(409, "Bara ett utkast kan tas bort. Makulera ett beställt inköp i stället.");
      store.purchases.splice(store.purchases.indexOf(purchase), 1);
      return { ok: true };
    }
  }
}
