import { prisma } from "@/lib/db";
import { auditCompanyExport } from "@/lib/kfid/cloud-export-archive";
import { context, failure, requireAdmin, requireCloudStorage } from "@/lib/kfid/server";
import { localWorkspaceBundleFilename, LOCAL_WORKSPACE_BUNDLE_MIME } from "@/features/kfid/local-workspace-bundle";
import {
  bindExportedLocalWorkspace,
  cloudExportSize,
  cloudExportZipStream,
  createCloudWorkspaceBundle,
  fitsOneCloudFile,
  prepareCloudExportZip,
  type CloudExportSource,
} from "@/lib/kfid/cloud-export";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

// The Cloud copy (lib/kfid/cloud-export.ts): one .hwf file within the limits of one file, otherwise all of the
// company's data as a zip file in parts (S4, 2026-10-23).
export async function GET() {
  try {
    const ctx = await context();
    requireCloudStorage(ctx);
    requireAdmin(ctx);
    await auditCompanyExport(ctx, "cloud");
    const exportingMember = await prisma.organizationMember.findUniqueOrThrow({
      where: { organizationId_userId: { organizationId: ctx.organizationId, userId: ctx.user.id } },
      select: { weeklyWorkMinutes: true },
    });
    const source: CloudExportSource = {
      organizationId: ctx.organizationId, organizationName: ctx.organization.name,
      organizationWeeklyWorkMinutes: ctx.organization.weeklyWorkMinutes,
      user: { id: ctx.user.id, email: ctx.user.email }, memberWeeklyWorkMinutes: exportingMember.weeklyWorkMinutes,
    };
    const filename = localWorkspaceBundleFilename(ctx.organization.name);
    if (fitsOneCloudFile(await cloudExportSize(ctx.organizationId))) {
      const single = await createCloudWorkspaceBundle(source);
      if (single) {
        await bindExportedLocalWorkspace(source, single.localIdentityId);
        return new Response(single.bundle, {
          headers: {
            "Content-Type": LOCAL_WORKSPACE_BUNDLE_MIME,
            "Content-Disposition": `attachment; filename="${filename}"`,
            "Cache-Control": "private, no-store",
          },
        });
      }
    }
    const zip = await prepareCloudExportZip(source);
    return new Response(cloudExportZipStream(zip), {
      headers: {
        "Content-Type": "application/zip",
        "Content-Disposition": `attachment; filename="${filename.replace(/\.hwf$/, "")}-export.zip"`,
        "Cache-Control": "private, no-store",
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch (error) {
    return failure(error);
  }
}
