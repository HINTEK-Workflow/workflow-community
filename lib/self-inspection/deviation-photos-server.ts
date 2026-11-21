import { prisma } from "@/lib/db";
import { ApiError, type Context } from "@/lib/kfid/server";
import { DEVIATION_PHOTO_LIMIT, mayHandleDeviation, mayReadDeviation, type DeviationPhotoPhase } from "./incidents";
import { DEVIATION_PERSONAL_DATA_REFUSAL } from "./retention";
import { deviationViewerOf } from "./server";

/**
 * Bilder på avvikelser (2026-10-30): who may add, read and remove a photo on a log entry. The bytes are handled like
 * every other attachment (lib/workflow/attachment-file.ts, lib/kfid/storage.ts); this file only decides access, always
 * inside the caller's company. An entry the person may not read answers as one that does not exist.
 */
async function readableEntry(ctx: Context, deviationId: string) {
  const entry = await prisma.selfInspectionDeviation.findFirst({ where: { id: deviationId, organizationId: ctx.organizationId },
    select: { id: true, type: true, status: true, reportedById: true, responsibleUserId: true, personalDataRemovedAt: true } });
  const viewer = deviationViewerOf(ctx);
  const access = entry ? { type: entry.type, reportedById: entry.reportedById, responsibleId: entry.responsibleUserId } : null;
  if (!entry || !access || !mayReadDeviation(viewer, access)) throw new ApiError(404, "Avvikelsen hittades inte.");
  return { entry, handles: mayHandleDeviation(viewer, access), reporter: entry.reportedById === ctx.user.id };
}

/** A new photo: Före by the reporter or whoever handles it, Efter (at Markera klar) by whoever handles it; at most DEVIATION_PHOTO_LIMIT. */
export async function requirePhotoUpload(ctx: Context, deviationId: string, phase: DeviationPhotoPhase) {
  const { entry, handles, reporter } = await readableEntry(ctx, deviationId);
  if (!(handles || (phase === "BEFORE" && reporter))) throw new ApiError(403, "Du kan inte lägga till bilder på den här avvikelsen.");
  if (entry.personalDataRemovedAt) throw new ApiError(409, DEVIATION_PERSONAL_DATA_REFUSAL);
  if (await prisma.selfInspectionDeviationAttachment.count({ where: { organizationId: ctx.organizationId, deviationId: entry.id } }) >= DEVIATION_PHOTO_LIMIT)
    throw new ApiError(400, `Högst ${DEVIATION_PHOTO_LIMIT} bilder per avvikelse.`);
  return entry;
}

/** One photo, for whoever may read its entry. */
export async function readablePhoto(ctx: Context, photoId: string) {
  const photo = await prisma.selfInspectionDeviationAttachment.findFirst({ where: { id: photoId, organizationId: ctx.organizationId } });
  if (!photo) throw new ApiError(404, "Bilden hittades inte.");
  try { await readableEntry(ctx, photo.deviationId); } catch { throw new ApiError(404, "Bilden hittades inte."); }
  return photo;
}

/** Removing a photo: whoever handles the entry, or the person who added it. */
export async function removablePhoto(ctx: Context, photoId: string) {
  const photo = await readablePhoto(ctx, photoId);
  const { handles } = await readableEntry(ctx, photo.deviationId);
  if (!handles && photo.createdById !== ctx.user.id) throw new ApiError(403, "Du kan inte ta bort den här bilden.");
  return photo;
}
