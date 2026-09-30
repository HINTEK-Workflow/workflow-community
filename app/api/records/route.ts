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
  requireControlDelete,
  requireWorkflowPermission,
  ApiError,
} from "@/lib/kfid/server";
import { listRecords, recordQuery } from "@/lib/kfid/records";
import { remove } from "@/lib/kfid/storage";
import { closeControlTimers } from "@/lib/workflow/timer-server";
export async function GET(request: Request) {
  try {
    const ctx = await context();
    requireCloudStorage(ctx);
    const query = recordQuery.parse(Object.fromEntries(new URL(request.url).searchParams));
    if (query.kind === "controls") requireWorkflowPermission(ctx, "kfid", "read");
    return NextResponse.json(
      await listRecords(
        ctx,
        query,
      ),
    );
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
    const input = z
      .object({
        kind: z.enum(["controls", "customers"]),
        action: z.enum(["delete", "restore", "purge"]),
        ids: z.array(z.string().min(1).max(100)).min(1).max(100),
      })
      .parse(await body(request));
    if (input.kind === "controls") {
      requireWorkflowPermission(ctx, "kfid", "edit");
      requireControlDelete(ctx);
    }
    else requireAdmin(ctx);
    const ids = [...new Set(input.ids)];
    const paths = await prisma.$transaction(
      async (tx) => {
        if (input.kind === "customers") {
          const records = await tx.customer.findMany({
            where: { id: { in: ids }, organizationId: ctx.organizationId },
          });
          if (records.length !== ids.length)
            throw new ApiError(404, "En eller flera kunder saknas.");
          if (input.action === "purge") {
            if (records.some((r) => !r.deletedAt))
              throw new ApiError(
                409,
                "Flytta alla valda kunder till papperskorgen först.",
              );
            await tx.customer.deleteMany({
              where: {
                id: { in: ids },
                organizationId: ctx.organizationId,
                deletedAt: { not: null },
              },
            });
          } else
            await tx.customer.updateMany({
              where: { id: { in: ids }, organizationId: ctx.organizationId },
              data: {
                deletedAt: input.action === "delete" ? new Date() : null,
                version: { increment: 1 },
              },
            });
          return [] as string[];
        }
        // Lock in deterministic order so parallel bulk operations cannot deadlock.
        for (const id of [...ids].sort())
          await tx.$queryRaw`SELECT id FROM "Control" WHERE id=${id} AND "organizationId"=${ctx.organizationId} FOR UPDATE`;
        const records = await tx.control.findMany({
          where: { id: { in: ids }, organizationId: ctx.organizationId },
        });
        if (records.length !== ids.length)
          throw new ApiError(404, "En eller flera kontroller saknas.");
        if (input.action !== "purge") {
          await tx.control.updateMany({
            where: { id: { in: ids }, organizationId: ctx.organizationId },
            data: {
              deletedAt: input.action === "delete" ? new Date() : null,
              lockToken: null,
              lockedBy: null,
              lockExpiresAt: null,
            },
          });
          // A deleted control keeps no running timer.
          if (input.action === "delete")
            for (const record of records) await closeControlTimers(tx, ctx, { id: record.id, title: record.title || "Kontroll" }, new Date());
          return [] as string[];
        }
        if (records.some((r) => !r.deletedAt))
          throw new ApiError(
            409,
            "Flytta alla valda kontroller till papperskorgen först.",
          );
        const reports = await tx.generatedResult.findMany({
          where: { controlId: { in: ids }, organizationId: ctx.organizationId },
        });
        if (reports.some((r) => r.status === "PENDING"))
          throw new ApiError(409, "Vänta tills rapportgenereringen är klar.");
        const files = await tx.attachment.findMany({
          where: { controlId: { in: ids }, organizationId: ctx.organizationId },
        });
        await tx.generatedResult.deleteMany({
          where: { controlId: { in: ids }, organizationId: ctx.organizationId },
        });
        await tx.control.deleteMany({
          where: { id: { in: ids }, organizationId: ctx.organizationId },
        });
        return [
          ...files.map((f) => f.storagePath),
          ...reports.flatMap((r) => (r.storagePath ? [r.storagePath] : [])),
        ];
      },
      { timeout: 15000 },
    );
    await Promise.all(paths.map(remove));
    return NextResponse.json({ ok: true, count: ids.length });
  } catch (e) {
    return failure(e);
  }
}
