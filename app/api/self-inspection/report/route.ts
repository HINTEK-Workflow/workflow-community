import { NextResponse } from "next/server";
import { context, failure, requireCloudStorage } from "@/lib/kfid/server";
import { SelfInspectionError } from "@/lib/self-inspection/model";
import { createSelfInspectionPdf } from "@/lib/self-inspection/report";
import { cloudSelfInspectionView } from "@/lib/self-inspection/server";
import { workflowReportFont, workflowReportIdentity } from "@/lib/workflow/report-server";

export const dynamic = "force-dynamic";

/** PDF of an approved version: a member gets the current one, an admin any version (2026-10-06). */
export async function GET(request: Request) {
  try {
    const ctx = await context();
    requireCloudStorage(ctx);
    const view = await cloudSelfInspectionView(ctx);
    const wanted = Number(new URL(request.url).searchParams.get("version"));
    const version = view.current && (!wanted || wanted === view.current.number) ? view.current : view.versions.find((item) => item.number === wanted);
    if (!version) throw new SelfInspectionError(404, "Versionen finns inte eller är inte fastställd.");
    const identity = await workflowReportIdentity(ctx.organizationId, ctx.organization.name);
    const bytes = await createSelfInspectionPdf({ identity, fontBytes: await workflowReportFont(), version });
    const filename = `${version.content.title}-version-${version.number}.pdf`.replace(/[<>:"/\\|?*\u0000-\u001f]+/g, "-");
    return new Response(new Uint8Array(bytes), { headers: { "Content-Type": "application/pdf", "Content-Disposition": `attachment; filename*=UTF-8''${encodeURIComponent(filename)}`, "Cache-Control": "private, no-store" } });
  } catch (error) {
    if (error instanceof SelfInspectionError) return NextResponse.json({ error: error.message }, { status: error.status });
    return failure(error);
  }
}
