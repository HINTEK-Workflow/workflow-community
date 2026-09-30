import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { ApiError, checkOrigin, context, failure, requireCloudStorage, requireCloudWriteAccess, requireWorkflowPermission } from "@/lib/kfid/server";
import { read, remove } from "@/lib/kfid/storage";
import { workflowSubjectForTask } from "@/lib/workflow/permissions";

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const ctx = await context(); requireCloudStorage(ctx);
    const { id } = await params;
    const file = await prisma.workflowTaskAttachment.findFirst({ where: { id, organizationId: ctx.organizationId }, include: { task: { select: { kind: true, formArea: true } } } });
    if (!file) throw new ApiError(404, "Filen hittades inte.");
    requireWorkflowPermission(ctx, workflowSubjectForTask(file.task.kind, file.task.formArea), "read");
    return new Response(new Uint8Array(await read(file.storagePath)), { headers: { "Content-Type": file.mimeType, "Content-Disposition": `${file.mimeType.startsWith("image/") ? "inline" : "attachment"}; filename*=UTF-8''${encodeURIComponent(file.filename)}`, "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff" } });
  } catch (error) { return failure(error); }
}

export async function DELETE(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    checkOrigin(request); const ctx = await context(); requireCloudStorage(ctx); await requireCloudWriteAccess(ctx);
    const { id } = await params;
    const file = await prisma.workflowTaskAttachment.findFirst({ where: { id, organizationId: ctx.organizationId }, include: { task: { select: { status: true, kind: true, formArea: true } } } });
    if (!file) throw new ApiError(404, "Filen hittades inte.");
    requireWorkflowPermission(ctx, workflowSubjectForTask(file.task.kind, file.task.formArea), "edit");
    if (file.task.status === "COMPLETED") throw new ApiError(409, "En slutförd uppgift kan inte ändras.");
    await prisma.workflowTaskAttachment.delete({ where: { id: file.id } });
    await remove(file.storagePath);
    return NextResponse.json({ ok: true });
  } catch (error) { return failure(error); }
}
