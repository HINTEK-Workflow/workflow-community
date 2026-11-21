import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { ApiError, checkOrigin, context, failure, requireAdmin, requireCloudStorage } from "@/lib/kfid/server";
import { buildCloudWorkspacePlan } from "@/lib/kfid/cloud-import";
import { previewFormSettings } from "@/lib/kfid/cloud-import-form-settings-preview";
import { MAX_CLOUD_WORKSPACE_BUNDLE_BYTES, MAX_CLOUD_WORKSPACE_RECORDS } from "@/lib/kfid/cloud-reimport";
import { parseUploadedCloudBundle } from "@/lib/kfid/cloud-bundle";
import { readLimitedFormData } from "@/lib/security/limited-body";
import { catalogueTransferCounts, parseCatalogueTransfer } from "@/lib/catalogue/transfer";

export async function POST(request: Request) {
  try {
    checkOrigin(request);
    const ctx = await context();
    requireCloudStorage(ctx);
    requireAdmin(ctx);
    const form = await readLimitedFormData(request, MAX_CLOUD_WORKSPACE_BUNDLE_BYTES + 1_000_000);
    const file = form.get("file");
    if (!(file instanceof File) || !file.size || file.size > MAX_CLOUD_WORKSPACE_BUNDLE_BYTES)
      throw new ApiError(413, "Välj en Cloud-kopia på högst 50 MB.");
    const bundle = await parseUploadedCloudBundle(file, ctx.organizationId);
    if (!bundle.workspace.cloudSnapshot)
      throw new ApiError(422, "Filen saknar ursprung från Cloud-exporten.");
    if (bundle.workspace.customers.length + bundle.workspace.projects.length + bundle.workspace.workflowTasks.length > MAX_CLOUD_WORKSPACE_RECORDS)
      throw new ApiError(413, "Cloud-kopian får innehålla högst 500 poster sammanlagt.");
    const plan = await buildCloudWorkspacePlan(prisma, ctx.organizationId, bundle);
    // Limit profiles and round schedules are counted before the import too (2026-10-07), with the import's own rules.
    const copiedCustomers = new Set(plan.customers.filter((item) => item.action === "COPY_CONFLICT").map((item) => item.local.id));
    const formSettings = await previewFormSettings(prisma, ctx.organizationId, bundle.workspace, copiedCustomers, new Set(bundle.workspace.customers.map((item) => item.id)));
    return NextResponse.json({
      exportedAt: bundle.workspace.cloudSnapshot.exportedAt,
      ...plan.summary,
      formSettings,
      // Artiklar och priser (2026-10-08): what the file holds; on import only what Cloud lacks is added.
      catalogue: catalogueTransferCounts(parseCatalogueTransfer(bundle.workspace.catalogue)),
      attachmentBytes: bundle.attachmentBytes,
      importEnabled: true,
      note: "Förhandsbedömningen kontrollerar även bilagornas innehåll. Ändrade original bevaras och den lokala versionen blir en separat konfliktkopia.",
    });
  } catch (error) {
    return failure(error);
  }
}
