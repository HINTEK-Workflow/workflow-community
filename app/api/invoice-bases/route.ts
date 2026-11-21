import { NextResponse } from "next/server";
import { z } from "zod";
import { body, checkOrigin, context, failure, requireCloudWriteAccess, requireModule, type Context } from "@/lib/kfid/server";
import {
  createInvoiceBasis, deleteInvoiceBasis, getInvoiceBasis, invoiceBasisBlank, invoiceBasisProposal, listInvoiceBases, invoiceBasisSummary, markInvoiceBasisInvoiced, requireInvoiceBasis, saveInvoiceBasis, type InvoiceBasisCaller,
} from "@/lib/invoice-basis/server";
import { invoiceBasisListQuery } from "@/lib/invoice-basis/model";
import { workListCountsAllowed } from "@/lib/workflow/work-list";

export const dynamic = "force-dynamic";

/**
 * Fakturaunderlag från utfört arbete (2026-10-10). GET ?taskId= or ?projectId= is the panel on a finished job or a
 * project (its bases, what a new one would take, or why none can be made); with &proposal=1 the proposal of a new basis
 * (nothing saved or taken, Offerter – redigera); GET ?id= one basis. POST create saves the proposal as the person changed
 * it and takes the job's or project's untaken time, material and expenses (409 when they are no longer what the proposal
 * showed), save saves a draft, invoice marks it as invoiced (then locked; 422 while a line lacks a price) and delete
 * deletes a draft (which frees what it took). Reading needs admin or Offerter – läsa, changing Offerter – redigera, and
 * both the right to read the job or the project; session, company, membership, test-account restriction (context),
 * Cloud write access and Origin on every change are checked.
 */
const caller = (ctx: Context): InvoiceBasisCaller => ({
  organizationId: ctx.organizationId, userId: ctx.user.id, userName: ctx.user.name || ctx.user.email || "", admin: ctx.admin, permissions: ctx.workflowPermissions, storageMode: ctx.organization.storageMode,
});
const noStore = { "Cache-Control": "private, no-store" };
const id = z.string().trim().min(1).max(100);
const revision = z.number().int().min(1);

export async function GET(request: Request) {
  try {
    const ctx = await context();
    const who = caller(ctx);
    const url = new URL(request.url);
    const one = url.searchParams.get("id");
    if (one !== null) return NextResponse.json({ basis: await getInvoiceBasis(who, id.parse(one)) }, { headers: noStore });
    // Nytt fakturaunderlag (2026-11-14): ?blank=1 is the empty basis to fill in (Offerter – redigera); nothing is saved.
    if (url.searchParams.get("blank") === "1") return NextResponse.json({ basis: await invoiceBasisBlank(who) }, { headers: noStore });
    // The company's list (2026-10-28): ?list=1&status=all|DRAFT|INVOICED&page=&q=, 25 per page, the same right;
    // toppvisningen (2026-10-31) adds &mine=1 (made by me), &sort= and &counts=1 (by the work lists' rule: Mina, or an admin).
    if (url.searchParams.get("list") === "1") {
      const query = invoiceBasisListQuery(url.searchParams);
      return NextResponse.json(await listInvoiceBases(who, { ...query, counts: query.counts && workListCountsAllowed(query.mine ? "mine" : "all", ctx.admin) }), { headers: noStore });
    }
    const taskId = url.searchParams.get("taskId"), projectId = url.searchParams.get("projectId");
    const ref = taskId ? { taskId: id.parse(taskId) } : { projectId: id.parse(projectId) };
    if (url.searchParams.get("proposal") === "1") return NextResponse.json({ basis: await invoiceBasisProposal(who, ref) }, { headers: noStore });
    return NextResponse.json(await invoiceBasisSummary(who, ref), { headers: noStore });
  } catch (error) {
    return failure(error);
  }
}

const requestSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("create"), taskId: id.optional(), projectId: id.optional(), proposal: z.string().trim().min(1).max(100), basis: z.unknown() })
    .refine((value) => Boolean(value.taskId) !== Boolean(value.projectId), "Ange ett jobb eller ett projekt."),
  z.object({ action: z.literal("save"), id, revision, basis: z.unknown() }),
  z.object({ action: z.literal("invoice"), id, revision }),
  z.object({ action: z.literal("delete"), id }),
]);

export async function POST(request: Request) {
  try {
    checkOrigin(request);
    const ctx = await context();
    const who = caller(ctx);
    const input = requestSchema.parse(await body(request));
    requireInvoiceBasis(who, "edit");
    await requireCloudWriteAccess(ctx);
    requireModule(ctx, "invoicing");
    if (input.action === "create") return NextResponse.json(await createInvoiceBasis(who, { taskId: input.taskId, projectId: input.projectId }, { proposal: input.proposal, basis: input.basis }));
    if (input.action === "save") return NextResponse.json(await saveInvoiceBasis(who, input.id, input.revision, input.basis));
    if (input.action === "invoice") return NextResponse.json(await markInvoiceBasisInvoiced(who, input.id, input.revision));
    await deleteInvoiceBasis(who, input.id);
    return NextResponse.json({ ok: true });
  } catch (error) {
    return failure(error);
  }
}
