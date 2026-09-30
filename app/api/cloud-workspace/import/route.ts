import { createHash } from "node:crypto";
import { NextResponse } from "next/server";
import { parseUploadedCloudBundle } from "@/lib/kfid/cloud-bundle";
import { executeCloudWorkspaceImport } from "@/lib/kfid/cloud-import";
import { MAX_CLOUD_WORKSPACE_BUNDLE_BYTES, MAX_CLOUD_WORKSPACE_RECORDS } from "@/lib/kfid/cloud-reimport";
import {
  ApiError,
  checkOrigin,
  context,
  failure,
  requireAdmin,
  requireCloudStorage,
  requireCloudWriteAccess,
} from "@/lib/kfid/server";

export const runtime = "nodejs";

export async function POST(request: Request) {
  try {
    checkOrigin(request);
    const ctx = await context();
    requireCloudStorage(ctx);
    await requireCloudWriteAccess(ctx);
    requireAdmin(ctx);
    if (Number(request.headers.get("content-length")) > MAX_CLOUD_WORKSPACE_BUNDLE_BYTES + 1_000_000)
      throw new ApiError(413, "Cloud-kopian får vara högst 50 MB.");
    const form = await request.formData();
    if (form.get("confirm") !== "IMPORT")
      throw new ApiError(400, "Bekräfta återimporten efter förhandsgranskningen.");
    const file = form.get("file");
    if (!(file instanceof File) || !file.size || file.size > MAX_CLOUD_WORKSPACE_BUNDLE_BYTES)
      throw new ApiError(413, "Välj en Cloud-kopia på högst 50 MB.");
    const bytes = new Uint8Array(await file.arrayBuffer());
    const bundle = await parseUploadedCloudBundle(new Blob([bytes], { type: file.type }), ctx.organizationId);
    if (!bundle.workspace.cloudSnapshot)
      throw new ApiError(422, "Filen saknar ursprung från Cloud-exporten.");
    if (bundle.workspace.customers.length + bundle.workspace.projects.length + bundle.workspace.controls.length + bundle.workspace.workflowTasks.length + bundle.workspace.plannedActivities.length > MAX_CLOUD_WORKSPACE_RECORDS)
      throw new ApiError(413, "Cloud-kopian får innehålla högst 500 kunder, projekt, uppgifter och planeringar sammanlagt.");
    const result = await executeCloudWorkspaceImport({
      organizationId: ctx.organizationId,
      userId: ctx.user.id,
      bundleSha256: createHash("sha256").update(bytes).digest("hex"),
      bundle,
    });
    return NextResponse.json(result);
  } catch (error) {
    return failure(error);
  }
}
