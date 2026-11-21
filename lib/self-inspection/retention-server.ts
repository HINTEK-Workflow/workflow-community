import { prisma } from "@/lib/db";
import { remove } from "@/lib/kfid/storage";
import { deviationReadWhere, type DeviationViewer } from "./incidents";
import { DEVIATION_RETENTION_WARNING_DAYS, deviationPersonalDataWhere, deviationRemovalWhere, deviationRetentionCutoffs, deviationRetentionDetail, personalDataRemovedPatch } from "./retention";

/**
 * Nightly (history:retention, the owner's decision 2026-11-04): the lapsed entries of the deviation log, per company, rules in
 * ./retention.ts. The whole entry goes (its comments and photos by the foreign keys), or a near miss's or an accident's names, text,
 * comments and photos. Every query is bound to one company. Each company gets one counted line in its administration history; never a
 * name, a title or a number. Files are removed after the commit, as everywhere else. `dryRun` only counts.
 */
export async function purgeExpiredDeviations(now = new Date(), options: { dryRun?: boolean; removeFile?: (path: string) => Promise<void> } = {}) {
  const cutoffs = deviationRetentionCutoffs(now);
  if (!cutoffs.general && !cutoffs.incident && !cutoffs.personalData) return [];
  const companies = await prisma.selfInspectionDeviation.groupBy({ by: ["organizationId"], where: { status: "DONE", closedAt: { not: null }, retentionHoldAt: null } });
  const results: { organizationId: string; removed: number; personalData: number; files: number }[] = [];
  for (const { organizationId } of companies) {
    const removalWhere = deviationRemovalWhere(organizationId, cutoffs);
    const personalWhere = deviationPersonalDataWhere(organizationId, cutoffs);
    if (options.dryRun) {
      const removalIds = removalWhere ? (await prisma.selfInspectionDeviation.findMany({ where: removalWhere, select: { id: true } })).map((row) => row.id) : [];
      const personalIds = personalWhere ? (await prisma.selfInspectionDeviation.findMany({ where: { ...personalWhere, id: { notIn: removalIds } }, select: { id: true } })).map((row) => row.id) : [];
      const files = await prisma.selfInspectionDeviationAttachment.count({ where: { organizationId, deviationId: { in: [...removalIds, ...personalIds] } } });
      if (removalIds.length || personalIds.length) results.push({ organizationId, removed: removalIds.length, personalData: personalIds.length, files });
      continue;
    }
    const done = await prisma.$transaction(async (tx) => {
      const removalIds = removalWhere ? (await tx.selfInspectionDeviation.findMany({ where: removalWhere, select: { id: true } })).map((row) => row.id) : [];
      const personalIds = personalWhere ? (await tx.selfInspectionDeviation.findMany({ where: { ...personalWhere, id: { notIn: removalIds } }, select: { id: true } })).map((row) => row.id) : [];
      if (!removalIds.length && !personalIds.length) return null;
      const files = (await tx.selfInspectionDeviationAttachment.findMany({ where: { organizationId, deviationId: { in: [...removalIds, ...personalIds] } }, select: { storagePath: true } })).map((file) => file.storagePath);
      if (personalIds.length) {
        await tx.selfInspectionDeviationAttachment.deleteMany({ where: { organizationId, deviationId: { in: personalIds } } });
        await tx.comment.deleteMany({ where: { organizationId, deviationId: { in: personalIds } } });
        await tx.selfInspectionDeviation.updateMany({ where: { organizationId, id: { in: personalIds } }, data: personalDataRemovedPatch(now) });
      }
      if (removalIds.length) await tx.selfInspectionDeviation.deleteMany({ where: { organizationId, id: { in: removalIds } } });
      const counts = { removed: removalIds.length, personalData: personalIds.length, files: files.length };
      await tx.administrationEvent.create({ data: { actorId: "system:deviation-retention", organizationId, action: "deviation_retention", detail: deviationRetentionDetail(counts) } });
      return { counts, files };
    }, { timeout: 120_000 });
    if (!done) continue;
    for (const path of done.files) await (options.removeFile ?? remove)(path);
    results.push({ organizationId, ...done.counts });
  }
  return results;
}

/** How many of the entries the reader may read reach a step within the warning time; the log says so before it happens. */
export async function countDeviationsSoonPurged(organizationId: string, viewer: DeviationViewer, now = new Date()) {
  const cutoffs = deviationRetentionCutoffs(new Date(now.getTime() + DEVIATION_RETENTION_WARNING_DAYS * 86_400_000));
  const removal = deviationRemovalWhere(organizationId, cutoffs);
  const personal = deviationPersonalDataWhere(organizationId, cutoffs);
  if (!removal && !personal) return 0;
  return prisma.selfInspectionDeviation.count({ where: { organizationId, AND: [deviationReadWhere(viewer), { OR: [...(removal ? [removal] : []), ...(personal ? [personal] : [])] }] } });
}
