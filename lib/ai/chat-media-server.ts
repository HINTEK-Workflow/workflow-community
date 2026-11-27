import "server-only";
import { prisma } from "@/lib/db";
import { ApiError, requireWorkflowPermission, type Context } from "@/lib/kfid/server";
import { read } from "@/lib/kfid/storage";
import { publicInstance } from "@/lib/instance";
import { routeAiModel } from "@/lib/ai/model-catalog";
import type { AzureRouteModel } from "@/lib/ai/azure-settings";
import { chatMediaSupport } from "@/lib/ai/chat-media";
import { prepareChatImage, type PreparedChatImage } from "@/lib/ai/chat-image";
import { providerChoiceFor } from "@/lib/ai/provider-choice-server";
import { openAiModelCards } from "@/lib/ai/provider-settings-server";
import { readWholeTask } from "@/lib/tools/registry";
import { ToolError } from "@/lib/tools/call-route";
import { workflowSubjectForTask } from "@/lib/workflow/permissions";

/** The level the chat answers with (Enkla svar): the model whose card must say Bilder. */
export const CHAT_IMAGE_LEVEL = routeAiModel("WORKFLOW_SEARCH").model as AzureRouteModel;

/** Whether the chat's image and microphone buttons work for this company right now, with a plain reason when not (2026-11-21). */
export async function chatMediaStatus(organizationId: string) {
  const [{ choice, azure }, cards] = await Promise.all([providerChoiceFor(organizationId), openAiModelCards()]);
  return chatMediaSupport({ choice, azure, openAiCards: cards, level: CHAT_IMAGE_LEVEL, operator: publicInstance().operator });
}

/**
 * A photo already on a work order (or another task), read for the chat (2026-11-21): the file must be in the person's company,
 * the person must be allowed to read that kind of task, and the task itself must be one the person can open (the tasks route in
 * the person's own session). The file is read from storage into memory, prepared like an upload and never stored again.
 */
export async function attachmentImage(ctx: Context, attachmentId: string): Promise<{ image: PreparedChatImage; name: string; taskId: string }> {
  const file = await prisma.workflowTaskAttachment.findFirst({ where: { id: attachmentId, organizationId: ctx.organizationId }, select: { id: true, taskId: true, filename: true, mimeType: true, storagePath: true, task: { select: { kind: true, formArea: true } } } });
  if (!file) throw new ApiError(404, "Bilden hittades inte.");
  requireWorkflowPermission(ctx, workflowSubjectForTask(file.task.kind, file.task.formArea), "read");
  try { await readWholeTask(file.taskId); } catch (error) {
    if (error instanceof ToolError) throw new ApiError(error.status === 403 ? 403 : 404, "Bilden hittades inte.");
    throw error;
  }
  if (!file.mimeType.startsWith("image/")) throw new ApiError(400, "Filen är ingen bild.");
  const image = await prepareChatImage(new Uint8Array(await read(file.storagePath)));
  return { image, name: file.filename, taskId: file.taskId };
}
