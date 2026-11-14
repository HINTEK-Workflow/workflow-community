import { NextResponse } from "next/server";
import { z } from "zod";
import { body, checkOrigin, context, failure, requireCloudWriteAccess, requireModule, type Context } from "@/lib/kfid/server";
import { PURCHASE_FILTERS, PURCHASE_SORTS, PURCHASE_SOURCE_KINDS } from "@/lib/purchases/model";
import { parseListSort } from "@/lib/list-filter";
import { workListCountsAllowed } from "@/lib/workflow/work-list";
import {
  addPurchaseLines, changePurchaseStatus, companyMaterialMarkup, createPurchase, deletePurchase, getPurchase, listPurchases, openDrafts, purchaseRefsStatus, requirePurchases,
  setLineDelivered, syncDocumentLines, updatePurchase, type PurchaseCaller,
} from "@/lib/purchases/server";

export const dynamic = "force-dynamic";

/**
 * Inköp (2026-10-16, docs/proposals/inkop-och-artiklar-2026-10-16.md). GET ?id= is one purchase (with the
 * company's material markup for a quote or a work order made from it); GET ?part=drafts the open drafts a document may
 * add to (&projectId= &workOrderId=); GET ?part=refs&ids= where a document's linked purchases stand; GET otherwise the
 * bounded list (?q= &filter= &page= &mine=1 &projectId= &workOrderId= &sort= &counts=1). POST creates, saves a draft, adds lines (Artiklar
 * and snabbvalet), follows a document's changes (sync), changes the status, ticks a line delivered or deletes a draft.
 * Session, company, the right (whoever may put material on a work order or a quote), Cloud write access and Origin are
 * checked on every call.
 */
const caller = (ctx: Context): PurchaseCaller => ({ organizationId: ctx.organizationId, userId: ctx.user.id, admin: ctx.admin, permissions: ctx.workflowPermissions, storageMode: ctx.organization.storageMode });
const noStore = { "Cache-Control": "private, no-store" };
const id = z.string().trim().min(1).max(100);
const source = z.object({ kind: z.enum(PURCHASE_SOURCE_KINDS), id }).nullable().optional();

export async function GET(request: Request) {
  try {
    const ctx = await context();
    const who = caller(ctx);
    const url = new URL(request.url);
    const optional = (key: string) => { const value = url.searchParams.get(key); return value ? id.parse(value) : undefined; };
    const part = url.searchParams.get("part");
    if (part === "drafts") return NextResponse.json({ drafts: await openDrafts(who, { projectId: optional("projectId"), workOrderId: optional("workOrderId") }) }, { headers: noStore });
    if (part === "refs") {
      const ids = (url.searchParams.get("ids") ?? "").split(",").map((value) => value.trim()).filter(Boolean).slice(0, 20).map((value) => id.parse(value));
      return NextResponse.json({ purchases: await purchaseRefsStatus(who, ids) }, { headers: noStore });
    }
    const one = url.searchParams.get("id");
    if (one !== null) return NextResponse.json({ purchase: await getPurchase(who, id.parse(one)), markupPercent: await companyMaterialMarkup(who) }, { headers: noStore });
    requirePurchases(who);
    const filter = z.enum(PURCHASE_FILTERS).catch("open").parse(url.searchParams.get("filter") ?? "open");
    const mine = url.searchParams.get("mine") === "1";
    return NextResponse.json(await listPurchases(who, {
      q: url.searchParams.get("q") ?? "", filter, page: Number(url.searchParams.get("page")) || 1, mine,
      projectId: optional("projectId"), workOrderId: optional("workOrderId"),
      // The chips' counts (toppvisningen, 2026-10-31), by the work lists' rule: Mina, or an admin.
      sort: parseListSort(url.searchParams.get("sort"), PURCHASE_SORTS), counts: url.searchParams.get("counts") === "1" && workListCountsAllowed(mine ? "mine" : "all", ctx.admin),
    }), { headers: noStore });
  } catch (error) {
    return failure(error);
  }
}

const requestSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("create"), purchase: z.unknown() }),
  z.object({ action: z.literal("save"), id, revision: z.number().int().min(1), purchase: z.unknown() }),
  z.object({ action: z.literal("add_lines"), id: id.nullable().optional(), create: z.unknown().optional(), lines: z.array(z.unknown()).min(1).max(50), source }),
  z.object({ action: z.literal("sync"), id, source: z.object({ kind: z.enum(PURCHASE_SOURCE_KINDS), id }), lines: z.array(z.unknown()).max(300), forget: z.array(z.unknown()).max(300).optional() }),
  z.object({ action: z.literal("status"), id, to: z.enum(["order", "reopen", "cancel"]) }),
  z.object({ action: z.literal("deliver"), id, lineId: id, delivered: z.boolean() }),
  z.object({ action: z.literal("delete"), id }),
]);

export async function POST(request: Request) {
  try {
    checkOrigin(request);
    const ctx = await context();
    const who = caller(ctx);
    requirePurchases(who);
    await requireCloudWriteAccess(ctx);
    requireModule(ctx, "purchasing");
    const input = requestSchema.parse(await body(request));
    switch (input.action) {
      case "create": return NextResponse.json(await createPurchase(who, input.purchase));
      case "save": return NextResponse.json(await updatePurchase(who, input.id, input.revision, input.purchase));
      case "add_lines": return NextResponse.json(await addPurchaseLines(who, { id: input.id, create: input.create }, input.lines, input.source ?? null));
      case "sync": return NextResponse.json(await syncDocumentLines(who, input.id, input.source, input.lines, input.forget ?? []));
      case "status": return NextResponse.json(await changePurchaseStatus(who, input.id, input.to));
      case "deliver": return NextResponse.json(await setLineDelivered(who, input.id, input.lineId, input.delivered));
      case "delete": await deletePurchase(who, input.id); return NextResponse.json({ ok: true });
    }
  } catch (error) {
    return failure(error);
  }
}
