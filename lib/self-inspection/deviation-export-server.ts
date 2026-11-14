import { z } from "zod";
import { prisma } from "@/lib/db";
import type { Context } from "@/lib/kfid/server";
import { read } from "@/lib/kfid/storage";
import { customerComments } from "@/lib/comments/server";
import { workflowReportFont, workflowReportIdentity } from "@/lib/workflow/report-server";
import { createDeviationsPdf, DEVIATION_EXPORT_FORMATS, DEVIATION_EXPORT_MAX, deviationExportFilename, deviationsCsv, exportableDeviations, exportPhotoIds } from "./deviation-export";
import { SelfInspectionError } from "./model";
import { cloudSelfInspectionView, deviationViewerOf } from "./server";

/**
 * Exportera på Avvikelser in Cloud (2026-10-30): the entries are read exactly as the log's page reads them
 * (cloudSelfInspectionView – the company, the reader's rights and ./incidents.ts in the query), and exportableDeviations
 * applies the read rule once more to the ids asked for. Photos are read from the company's own storage, only for the
 * entries that passed, and only JPG and PNG (what a PDF can hold).
 */
export const deviationExportRequestSchema = z.object({
  format: z.enum(DEVIATION_EXPORT_FORMATS),
  ids: z.array(z.string().min(1).max(64)).min(1, "Välj minst en post.").max(DEVIATION_EXPORT_MAX),
  sections: z.object({ description: z.boolean(), action: z.boolean(), investigation: z.boolean(), history: z.boolean(), photos: z.boolean() }).partial().default({}),
  scope: z.string().trim().max(120).optional(),
});
export type DeviationExportRequest = z.infer<typeof deviationExportRequestSchema>;

export async function cloudDeviationExport(ctx: Context, input: DeviationExportRequest) {
  const view = await cloudSelfInspectionView(ctx);
  const entries = exportableDeviations(view.deviations, input.ids, deviationViewerOf(ctx));
  if (!entries.length) throw new SelfInspectionError(404, "Det finns inget att exportera.");
  const filename = deviationExportFilename(entries, input.format);
  if (input.format === "csv") return { bytes: new TextEncoder().encode(deviationsCsv(entries, input.sections)), filename, mimeType: "text/csv; charset=utf-8", count: entries.length };
  const photos = new Map<string, Uint8Array>();
  if (input.sections.photos !== false) {
    const ids = exportPhotoIds(entries);
    const rows = ids.length ? await prisma.selfInspectionDeviationAttachment.findMany({ where: { organizationId: ctx.organizationId, id: { in: ids }, deviationId: { in: entries.map((entry) => entry.id) } },
      select: { id: true, storagePath: true } }) : [];
    await Promise.all(rows.map(async (row) => { try { photos.set(row.id, new Uint8Array(await read(row.storagePath))); } catch { /* a missing file is counted in the PDF */ } }));
  }
  const [identity, fontBytes] = await Promise.all([workflowReportIdentity(ctx.organizationId, ctx.organization.name), workflowReportFont()]);
  const comments = new Map(await Promise.all(entries.slice(0, DEVIATION_EXPORT_MAX).map(async (entry) => [entry.id, await customerComments(ctx.organizationId, { type: "DEVIATION", id: entry.id })] as const)));
  const bytes = await createDeviationsPdf({ identity, fontBytes, entries, sections: input.sections, photos, scope: input.scope, comments, retentionNote: true });
  return { bytes, filename, mimeType: "application/pdf", count: entries.length };
}
