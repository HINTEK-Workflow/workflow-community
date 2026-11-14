import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import {
  context,
  failure,
  body,
  checkOrigin,
  requireAdmin,
  requireCloudStorage,
  requireCloudWriteAccess,
  requireWorkflowPermission,
  requireModule,
} from "@/lib/kfid/server";
import { listRecords, recordQuery } from "@/lib/kfid/records";
import { BULK_LIMIT, planBulk } from "@/lib/kfid/bulk-selection";
import { mayPickCustomer, pickerAnswer, PICKER_PAGE_LIMIT, readsCustomerRegister } from "@/lib/kfid/customer-picker-fields";
/** The customer register's list, trash and bulk actions. */
export async function GET(request: Request) {
  try {
    const ctx = await context();
    requireCloudStorage(ctx);
    const query = recordQuery.parse(Object.fromEntries(new URL(request.url).searchParams));
    // Papperskorgen hör till Kunder-sidan (den objektiva analysen 2026-10-24): den som väljer kund i ett jobb utan att ha
    // Kunder (customers:read) får listan att välja ur, men aldrig de borttagna kunderna.
    if (query.trash === "true") requireWorkflowPermission(ctx, "customers", "read");
    if (readsCustomerRegister(ctx)) return NextResponse.json(await listRecords(ctx, query));
    // Beslut 10 (2026-11-01): the picker is for someone who can make or change a job; for anyone else the answer is empty.
    if (!mayPickCustomer(ctx)) return NextResponse.json({ items: [], total: 0, page: 1, pages: 1, limit: PICKER_PAGE_LIMIT });
    // Without Kunder (2026-10-24): only the picker's answer – active customers by name that match on the picker's
    // own fields, at most 20, with those fields only (lib/kfid/customer-picker-fields.ts). The register itself is refused.
    const read = await listRecords(ctx, { ...query, sort: "name", direction: "asc", page: 1, limit: 100, counts: undefined });
    return NextResponse.json(pickerAnswer(read as unknown as { items: Record<string, unknown>[]; limit: number }, query.q));
  } catch (e) {
    return failure(e);
  }
}
export async function POST(request: Request) {
  try {
    checkOrigin(request);
    const ctx = await context();
    requireCloudStorage(ctx);
    await requireCloudWriteAccess(ctx);
    requireModule(ctx, "customers");
    const input = z
      .object({
        kind: z.literal("customers"),
        action: z.enum(["delete", "restore", "purge"]),
        ids: z.array(z.string().min(1).max(100)).min(1).max(BULK_LIMIT),
      })
      .parse(await body(request));
    requireAdmin(ctx);
    const ids = [...new Set(input.ids)];
    // Every record is checked on its own (organisation, state); one that does not fit is reported, the rest goes through.
    const plan = await prisma.$transaction(
      async (tx) => {
        const records = await tx.customer.findMany({
          // The company's own record (Eget företag) is not a customer to remove; it is reported as not found.
          where: { id: { in: ids }, organizationId: ctx.organizationId, ownCompany: false },
          select: { id: true, deletedAt: true },
        });
        const decided = planBulk(input.action, ids, records);
        if (!decided.apply.length) return decided;
        if (input.action === "purge")
          await tx.customer.deleteMany({
            where: {
              id: { in: decided.apply },
              organizationId: ctx.organizationId,
              deletedAt: { not: null },
            },
          });
        else
          await tx.customer.updateMany({
            where: { id: { in: decided.apply }, organizationId: ctx.organizationId },
            data: {
              deletedAt: input.action === "delete" ? new Date() : null,
              version: { increment: 1 },
            },
          });
        return decided;
      },
      { timeout: 15000 },
    );
    return NextResponse.json({ ok: true, count: plan.apply.length, failed: plan.failed });
  } catch (e) {
    return failure(e);
  }
}
