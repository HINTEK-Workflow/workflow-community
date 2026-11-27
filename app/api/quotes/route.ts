import { NextResponse } from "next/server";
import { z } from "zod";
import { body, checkOrigin, context, failure, requireCloudWriteAccess, requireModule, type Context } from "@/lib/kfid/server";
import { ApiError } from "@/lib/kfid/errors";
import { canSeePrices } from "@/lib/workflow/material-prices";
import { changeQuoteStatus, createQuote, deleteQuote, getQuote, listQuotes, newQuoteVersion, readPriceSettings, requireQuotes, updateQuote, writePriceSettings, type QuoteCaller } from "@/lib/quotes/server";
import { QUOTE_FILTERS, QUOTE_SORTS } from "@/lib/quotes/model";
import { parseListSort } from "@/lib/list-filter";
import { workListCountsAllowed } from "@/lib/workflow/work-list";
import { createWorkOrderFromQuote, projectQuoteSummary, quoteMaterialSource, quoteWorkOrderSummary } from "@/lib/quotes/flow-server";
import { markQuoteNoticeSeen, sendQuoteLink } from "@/lib/quotes/customer-link-server";

export const dynamic = "force-dynamic";

/**
 * Offerter (2026-10-09, steg B). GET ?id= is one quote; GET ?part=settings the company's price settings (for those
 * who may see prices); GET otherwise the bounded list (?q= &filter= &page= &mine=1 &projectId= &customerId= &sort= &counts=1). POST
 * creates, saves a draft, changes the status, makes a new version (an ÄTA when accepted) or deletes a draft (Offerter –
 * redigera), makes a work order from an accepted quote (Offerter – läsa + Arbetsorder – skapa), or saves the
 * price settings (company admin), or mails the customer a link to answer it (send_link, steg E, Offerter – redigera).
 * Session, company, the right, Cloud write access and Origin are checked on every call.
 */
const caller = (ctx: Context): QuoteCaller => ({ organizationId: ctx.organizationId, userId: ctx.user.id, admin: ctx.admin, permissions: ctx.workflowPermissions, storageMode: ctx.organization.storageMode });
const noStore = { "Cache-Control": "private, no-store" };
const id = z.string().trim().min(1).max(100);
const revision = z.number().int().min(1);

export async function GET(request: Request) {
  try {
    const ctx = await context();
    const who = caller(ctx);
    const url = new URL(request.url);
    if (url.searchParams.get("part") === "settings") {
      if (ctx.organization.storageMode !== "HINTEK_CLOUD") throw new ApiError(409, "Priser och offerter ställs in med serverlagring.");
      if (!canSeePrices({ admin: ctx.admin, permissions: ctx.workflowPermissions })) throw new ApiError(403, "Du saknar behörighet att se priser.");
      return NextResponse.json({ settings: await readPriceSettings(ctx.organizationId), canEdit: ctx.admin }, { headers: noStore });
    }
    // Steg C (2026-10-09): material rows of a project or a work order as lines for a new quote, and a project's quotes
    // with Offererat mot använt. The rights are checked in lib/quotes/flow-server.ts.
    const part = url.searchParams.get("part");
    if (part === "materials") {
      const projectId = url.searchParams.get("projectId"), taskId = url.searchParams.get("taskId");
      return NextResponse.json(await quoteMaterialSource(who, { projectId: projectId ? id.parse(projectId) : undefined, taskId: taskId ? id.parse(taskId) : undefined }), { headers: noStore });
    }
    if (part === "project") return NextResponse.json(await projectQuoteSummary(who, id.parse(url.searchParams.get("projectId"))), { headers: noStore });
    // Plan 1D/1K (2026-10-11): every work order made from a quote, with Offererat mot använt for them.
    if (part === "work_orders") return NextResponse.json(await quoteWorkOrderSummary(who, id.parse(url.searchParams.get("id"))), { headers: noStore });
    const one = url.searchParams.get("id");
    if (one !== null) {
      const quote = await getQuote(who, id.parse(one));
      // Offert per e-post (steg E): opening the quote reads the person's "Offert besvarad" for it.
      await markQuoteNoticeSeen({ organizationId: ctx.organizationId, userId: ctx.user.id, quoteId: quote.id });
      return NextResponse.json({ quote }, { headers: noStore });
    }
    requireQuotes(who, "read");
    const filter = z.enum(QUOTE_FILTERS).catch("open").parse(url.searchParams.get("filter") ?? "open");
    const optionalId = (key: string) => { const value = url.searchParams.get(key); return value ? id.parse(value) : undefined; };
    const mine = url.searchParams.get("mine") === "1";
    return NextResponse.json(await listQuotes(who, {
      q: url.searchParams.get("q") ?? "", filter, page: Number(url.searchParams.get("page")) || 1, mine,
      projectId: optionalId("projectId"), customerId: optionalId("customerId"),
      // The chips' counts on the first page (toppvisningen, 2026-10-31), by the work lists' rule: Mina, or an admin.
      sort: parseListSort(url.searchParams.get("sort"), QUOTE_SORTS), counts: url.searchParams.get("counts") === "1" && workListCountsAllowed(mine ? "mine" : "all", ctx.admin),
    }), { headers: noStore });
  } catch (error) {
    return failure(error);
  }
}

const requestSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("create"), quote: z.unknown() }),
  z.object({ action: z.literal("save"), id, revision, quote: z.unknown() }),
  z.object({ action: z.literal("status"), id, revision, to: z.enum(["send", "accept", "decline", "expire"]) }),
  z.object({ action: z.literal("new_version"), id }),
  z.object({ action: z.literal("delete"), id }),
  z.object({ action: z.literal("work_order"), id }),
  // Offert per e-post (steg E): mail the customer a link; a draft is sent (locked) at the same time.
  z.object({ action: z.literal("send_link"), id, revision: revision.optional(), email: z.string().max(254), message: z.string().max(2000).optional() }),
  z.object({ action: z.literal("settings"), settings: z.unknown() }),
]);

export async function POST(request: Request) {
  try {
    checkOrigin(request);
    const ctx = await context();
    const who = caller(ctx);
    const input = requestSchema.parse(await body(request));
    if (input.action === "settings") {
      if (ctx.organization.storageMode !== "HINTEK_CLOUD") throw new ApiError(409, "Priser och offerter ställs in med serverlagring.");
      await requireCloudWriteAccess(ctx);
      return NextResponse.json({ settings: await writePriceSettings(who, input.settings) });
    }
    // The price settings above serve material rows and invoice bases too, so they stay open with Offerter off.
    requireModule(ctx, "quotes");
    // Accepterad offert → arbetsorder (steg C): Offerter – läsa and Arbetsorder – skapa, checked in the function.
    if (input.action === "work_order") {
      requireQuotes(who, "read");
      await requireCloudWriteAccess(ctx);
      return NextResponse.json(await createWorkOrderFromQuote(who, { id: ctx.user.id, name: ctx.user.name, email: ctx.user.email, analytics: ctx.analytics }, input.id));
    }
    requireQuotes(who, "edit");
    await requireCloudWriteAccess(ctx);
    if (input.action === "create") return NextResponse.json(await createQuote(who, input.quote));
    if (input.action === "save") return NextResponse.json(await updateQuote(who, input.id, input.revision, input.quote));
    if (input.action === "status") return NextResponse.json(await changeQuoteStatus(who, input.id, input.revision, input.to));
    if (input.action === "new_version") return NextResponse.json(await newQuoteVersion(who, input.id));
    if (input.action === "send_link") return NextResponse.json(await sendQuoteLink(who, { id: ctx.user.id, name: ctx.user.name, email: ctx.user.email }, input.id, input.revision, { email: input.email, message: input.message ?? "" }));
    await deleteQuote(who, input.id);
    return NextResponse.json({ ok: true });
  } catch (error) {
    return failure(error);
  }
}
