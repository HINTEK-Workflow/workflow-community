import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { ApiError, checkOrigin, context, failure, requireAdmin, requireCloudStorage } from "@/lib/kfid/server";
import { buildCloudWorkspacePlan } from "@/lib/kfid/cloud-import";
import { MAX_CLOUD_WORKSPACE_BUNDLE_BYTES, MAX_CLOUD_WORKSPACE_RECORDS } from "@/lib/kfid/cloud-reimport";
import { parseUploadedCloudBundle } from "@/lib/kfid/cloud-bundle";

export async function POST(request: Request) {
  try {
    checkOrigin(request);
    const ctx = await context();
    requireCloudStorage(ctx);
    requireAdmin(ctx);
    const form = await request.formData();
    const file = form.get("file");
    if (!(file instanceof File) || !file.size || file.size > MAX_CLOUD_WORKSPACE_BUNDLE_BYTES)
      throw new ApiError(413, "Välj en Cloud-kopia på högst 50 MB.");
    const bundle = await parseUploadedCloudBundle(file, ctx.organizationId);
    if (!bundle.workspace.cloudSnapshot)
      throw new ApiError(422, "Filen saknar ursprung från Cloud-exporten.");
    if (bundle.workspace.customers.length + bundle.workspace.projects.length + bundle.workspace.controls.length + bundle.workspace.workflowTasks.length > MAX_CLOUD_WORKSPACE_RECORDS)
      throw new ApiError(413, "Cloud-kopian får innehålla högst 500 poster sammanlagt.");
    const plan = await buildCloudWorkspacePlan(prisma, ctx.organizationId, bundle);
    return NextResponse.json({
      exportedAt: bundle.workspace.cloudSnapshot.exportedAt,
      ...plan.summary,
      attachmentBytes: bundle.attachmentBytes,
      importEnabled: true,
      note: "Förhandsbedömningen kontrollerar även bilagornas innehåll. Ändrade original bevaras och den lokala versionen blir en separat konfliktkopia.",
    });
  } catch (error) {
    return failure(error);
  }
}
