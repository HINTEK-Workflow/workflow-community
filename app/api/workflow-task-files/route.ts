import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { ApiError, checkOrigin, context, failure, requireCloudStorage, requireCloudWriteAccess, requireWorkflowPermission } from "@/lib/kfid/server";
import { workflowSubjectForTask } from "@/lib/workflow/permissions";
import { workflowTaskAttachmentLimit } from "@/lib/workflow/task-model";
import { remove, store } from "@/lib/kfid/storage";
import { prepareAttachmentFile } from "@/lib/workflow/attachment-file";
import { publishTaskChange } from "@/lib/workflow/live-bus";
import { readLimitedFormData } from "@/lib/security/limited-body";
import { requireTaskLevel } from "@/lib/self-inspection/levels-server";

export async function POST(request: Request) {
  let storagePath: string | undefined;
  try {
    checkOrigin(request);
    const ctx = await context();
    requireCloudStorage(ctx);
    await requireCloudWriteAccess(ctx);
    if (Number(request.headers.get("content-length")) > 12_000_000) throw new ApiError(413, "Filen får vara högst 10 MB.");
    const form = await readLimitedFormData(request, 12_000_000);
    const taskId = String(form.get("taskId") || "");
    const file = form.get("file");
    // Kvitto (2026-11-04): only a picture can be a receipt.
    const wantsReceipt = form.get("receipt") === "true";
    if (!(file instanceof File) || !file.size || file.size > 10_000_000) throw new ApiError(400, "Välj en fil på högst 10 MB.");
    const task = await prisma.workflowTask.findFirst({ where: { id: taskId, organizationId: ctx.organizationId } });
    if (!task) throw new ApiError(404, "Uppgiften hittades inte.");
    requireWorkflowPermission(ctx, workflowSubjectForTask(task.kind, task.formArea), "edit");
    if (task.status === "COMPLETED" || task.status === "CANCELLED") throw new ApiError(409, task.status === "CANCELLED" ? "Jobbet har utgått. Återuppta det innan du ändrar det." : "En slutförd uppgift kan inte ändras.");
    // Roller med nivå (2026-10-07): adding to a protocol is filling it in.
    await requireTaskLevel(ctx.organizationId, task, ctx.user, "fill");
    const limit = workflowTaskAttachmentLimit(task.kind);
    if (await prisma.workflowTaskAttachment.count({ where: { taskId, organizationId: ctx.organizationId } }) >= limit) throw new ApiError(400, `Max ${limit} bilagor per uppgift.`);
    const { buffer, mimeType, extension } = await prepareAttachmentFile(file);
    storagePath = await store(buffer, extension);
    const attachment = await prisma.workflowTaskAttachment.create({ data: { organizationId: ctx.organizationId, taskId, filename: file.name.slice(0, 200), storagePath, mimeType, size: buffer.length, receipt: wantsReceipt && mimeType.startsWith("image/") }, select: { id: true } });
    publishTaskChange(taskId, { version: task.version, byUserId: ctx.user.id, byName: ctx.user.name || ctx.user.email, reason: "attachment" });
    return NextResponse.json(attachment);
  } catch (error) {
    if (storagePath) await remove(storagePath);
    return failure(error);
  }
}
