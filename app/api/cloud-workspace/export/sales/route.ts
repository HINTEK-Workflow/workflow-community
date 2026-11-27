import { context, failure, requireAdmin, requireCloudStorage } from "@/lib/kfid/server";
import { cloudExportZipStream } from "@/lib/kfid/cloud-export";
import { auditCompanyExport } from "@/lib/kfid/cloud-export-archive";
import { prepareSalesExportZip } from "@/lib/kfid/cloud-export-sales";
import { localWorkspaceBundleFilename } from "@/features/kfid/local-workspace-bundle";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

// Offerter och fakturaunderlag (lib/kfid/cloud-export-sales.ts): the same right as the Cloud copy – a signed-in admin of the
// active company, on its own company only; the company comes from the session, never from the request.
export async function GET() {
  try {
    const ctx = await context();
    requireCloudStorage(ctx);
    requireAdmin(ctx);
    await auditCompanyExport(ctx, "sales");
    const zip = prepareSalesExportZip({ organizationId: ctx.organizationId, organizationName: ctx.organization.name });
    const base = localWorkspaceBundleFilename(ctx.organization.name).replace(/\.hwf$/, "");
    return new Response(cloudExportZipStream(zip), {
      headers: {
        "Content-Type": "application/zip",
        "Content-Disposition": `attachment; filename="${base}-offerter-och-fakturaunderlag.zip"`,
        "Cache-Control": "private, no-store",
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch (error) {
    return failure(error);
  }
}
