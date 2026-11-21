import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { checkOrigin, context, failure, requireCloudStorage, requireCloudWriteAccess } from "@/lib/kfid/server";
import { readArchive, removeArchive } from "@/lib/workflow/report-archive-server";

export const dynamic = "force-dynamic";

/** A kept report's file, for the person who may read what it is a report of; `?inline=1` shows a PDF in the browser. */
export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const ctx = await context();
    requireCloudStorage(ctx);
    const { id } = await params;
    const { entry, bytes } = await readArchive(ctx, id);
    const inline = new URL(request.url).searchParams.get("inline") === "1" && entry.format === "PDF";
    return new Response(new Uint8Array(bytes), { headers: {
      "Content-Type": entry.mimeType,
      "Content-Disposition": `${inline ? "inline" : "attachment"}; filename*=UTF-8''${encodeURIComponent(entry.filename)}`,
      "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff",
    } });
  } catch (error) {
    return failure(error);
  }
}

/** Removes a kept report (the person who kept it, or an admin), the file with it. */
export async function DELETE(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    checkOrigin(request);
    const ctx = await context();
    requireCloudStorage(ctx);
    await requireCloudWriteAccess(ctx);
    const { id } = await params;
    const entry = await removeArchive(ctx, id);
    await prisma.administrationEvent.create({ data: { actorId: ctx.user.id, organizationId: ctx.organizationId, action: "report_archive_delete", detail: `Tog bort en rapport (${entry.format === "XLSX" ? "Excel" : "PDF"}) ur Rapportarkivet.` } });
    return NextResponse.json({ ok: true });
  } catch (error) {
    return failure(error);
  }
}
