import { context, failure, requireAdmin, requireCloudStorage } from "@/lib/kfid/server";
import { cloudExportZipStream } from "@/lib/kfid/cloud-export";
import { auditCompanyExport, prepareArchiveZip } from "@/lib/kfid/cloud-export-archive";
import { localWorkspaceBundleFilename } from "@/features/kfid/local-workspace-bundle";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

// Företagsarkivet (lib/kfid/cloud-export-archive.ts): purchases, absence, maintenance, machines and the rest that the Cloud copy
// cannot carry yet. The same right as the Cloud copy – a signed-in admin of the active company, on its own company only; the
// company comes from the session, never from the request. One export at a time per company, read page by page.
export async function GET() {
  try {
    const ctx = await context();
    requireCloudStorage(ctx);
    requireAdmin(ctx);
    await auditCompanyExport(ctx, "archive");
    const zip = prepareArchiveZip({ organizationId: ctx.organizationId, organizationName: ctx.organization.name });
    const base = localWorkspaceBundleFilename(ctx.organization.name).replace(/\.hwf$/, "");
    return new Response(cloudExportZipStream(zip), {
      headers: {
        "Content-Type": "application/zip",
        "Content-Disposition": `attachment; filename="${base}-foretagsarkiv.zip"`,
        "Cache-Control": "private, no-store",
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch (error) {
    return failure(error);
  }
}
