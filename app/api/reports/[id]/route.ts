import { prisma } from "@/lib/db";
import {
  context,
  failure,
  ApiError,
  requireCloudStorage,
  requireWorkflowPermission,
} from "@/lib/kfid/server";
import { read } from "@/lib/kfid/storage";
export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const ctx = await context();
    requireCloudStorage(ctx);
    requireWorkflowPermission(ctx, "kfid", "report");
    const { id } = await params;
    const report = await prisma.generatedResult.findFirst({
      where: { id, organizationId: ctx.organizationId, status: "COMPLETE" },
    });
    if (!report?.storagePath)
      throw new ApiError(404, "Rapporten hittades inte.");
    return new Response(new Uint8Array(await read(report.storagePath)), {
      headers: {
        "Content-Type": report.mimeType || "application/octet-stream",
        "Content-Disposition": `${new URL(request.url).searchParams.get("inline") === "true" && report.mimeType === "application/pdf" ? "inline" : "attachment"}; filename*=UTF-8''${encodeURIComponent(`KFID-${report.controlId}.${report.storagePath.split(".").pop()}`)}`,
        "Cache-Control": "private, no-store",
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch (e) {
    return failure(e);
  }
}
