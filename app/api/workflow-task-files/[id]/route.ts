import { NextResponse } from "next/server";
import { z } from "zod";
import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { ApiError, checkOrigin, context, failure, requireCloudStorage, requireCloudWriteAccess, requireWorkflowPermission } from "@/lib/kfid/server";
import { read, remove } from "@/lib/kfid/storage";
import { workflowSubjectForTask } from "@/lib/workflow/permissions";
import { publishTaskChange } from "@/lib/workflow/live-bus";
import { requireTaskLevelById } from "@/lib/self-inspection/levels-server";

const receiptBody = z.object({ receipt: z.boolean() }).strict();

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

/** Kvitto (2026-11-04): mark or unmark a picture as a receipt. The same checks as removing the file (the task must be editable). */
export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    checkOrigin(request); const ctx = await context(); requireCloudStorage(ctx); await requireCloudWriteAccess(ctx);
    const { id } = await params;
    const body = receiptBody.safeParse(await request.json().catch(() => null));
    if (!body.success) throw new ApiError(400, "Ogiltig begäran.");
    const file = await prisma.workflowTaskAttachment.findFirst({ where: { id, organizationId: ctx.organizationId }, include: { task: { select: { status: true, kind: true, formArea: true, version: true, title: true, description: true, progress: true, data: true, completedAt: true } } } });
    if (!file) throw new ApiError(404, "Filen hittades inte.");
    requireWorkflowPermission(ctx, workflowSubjectForTask(file.task.kind, file.task.formArea), "edit");
    // Kvitto (2026-11-04): allowed on a completed or cancelled task too; only the mark changes (and the history gets a line).
    await requireTaskLevelById(ctx.organizationId, file.taskId, ctx.user, "fill");
    if (body.data.receipt && !file.mimeType.startsWith("image/")) throw new ApiError(400, "Bara en bild kan vara ett kvitto.");
    const { receipt } = body.data;
    let version = file.task.version;
    if (file.receipt !== receipt) {
      const nextVersion = file.task.version + 1;
      const who = ctx.user.name || ctx.user.email;
      const note = `Kvitto ${receipt ? "markerat" : "avmarkerat"}: ${file.filename} (${who})`.slice(0, 300);
      await prisma.$transaction(async (tx) => {
        const marked = await tx.workflowTaskAttachment.updateMany({ where: { id: file.id, organizationId: ctx.organizationId, receipt: !receipt }, data: { receipt } });
        if (!marked.count) return;
        const bumped = await tx.workflowTask.updateMany({ where: { id: file.taskId, organizationId: ctx.organizationId, version: file.task.version }, data: { version: nextVersion } });
        if (!bumped.count) throw new ApiError(409, "Uppgiften har ändrats. Läs in den senaste versionen.");
        await tx.workflowTaskRevision.create({ data: { taskId: file.taskId, version: nextVersion, createdBy: ctx.user.id, snapshot: { title: file.task.title, description: file.task.description, status: file.task.status, progress: file.task.progress, data: file.task.data as Prisma.InputJsonValue, completedAt: file.task.completedAt?.toISOString() ?? null, note } } });
      });
      version = nextVersion;
    }
    publishTaskChange(file.taskId, { version, byUserId: ctx.user.id, byName: ctx.user.name || ctx.user.email, reason: "attachment" });
    return NextResponse.json({ ok: true, receipt, version });
  } catch (error) { return failure(error); }
}

export async function DELETE(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    checkOrigin(request); const ctx = await context(); requireCloudStorage(ctx); await requireCloudWriteAccess(ctx);
    const { id } = await params;
    const file = await prisma.workflowTaskAttachment.findFirst({ where: { id, organizationId: ctx.organizationId }, include: { task: { select: { status: true, kind: true, formArea: true, version: true } } } });
    if (!file) throw new ApiError(404, "Filen hittades inte.");
    requireWorkflowPermission(ctx, workflowSubjectForTask(file.task.kind, file.task.formArea), "edit");
    if (file.task.status === "COMPLETED" || file.task.status === "CANCELLED") throw new ApiError(409, file.task.status === "CANCELLED" ? "Jobbet har utgått. Återuppta det innan du ändrar det." : "En slutförd uppgift kan inte ändras.");
    await requireTaskLevelById(ctx.organizationId, file.taskId, ctx.user, "fill");
    await prisma.workflowTaskAttachment.delete({ where: { id: file.id } });
    await remove(file.storagePath);
    // Attachments do not change the task's version; the others read the task again and get the new list.
    publishTaskChange(file.taskId, { version: file.task.version, byUserId: ctx.user.id, byName: ctx.user.name || ctx.user.email, reason: "attachment" });
    return NextResponse.json({ ok: true });
  } catch (error) { return failure(error); }
}
