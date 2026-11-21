import { NextResponse } from "next/server";
import { body, checkOrigin, context, failure, requireCloudStorage } from "@/lib/kfid/server";
import { SelfInspectionError } from "@/lib/self-inspection/model";
import { cloudDeviationExport, deviationExportRequestSchema } from "@/lib/self-inspection/deviation-export-server";

export const dynamic = "force-dynamic";

/**
 * Exportera på Avvikelser (2026-10-30): the chosen entries as PDF or CSV. Posted (the ids may be many) and so
 * checked for Origin like every post; the session, the company and the read rule decide what the file holds.
 */
export async function POST(request: Request) {
  try {
    checkOrigin(request);
    // A report by POST, nothing is changed: it works for a paused company too (beslut 11).
    const ctx = await context({ allowedWhenPaused: true });
    requireCloudStorage(ctx);
    const input = deviationExportRequestSchema.parse(await body(request));
    const file = await cloudDeviationExport(ctx, input);
    return new Response(new Uint8Array(file.bytes), { headers: { "Content-Type": file.mimeType, "Content-Disposition": `attachment; filename*=UTF-8''${encodeURIComponent(file.filename)}`,
      "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff" } });
  } catch (error) {
    if (error instanceof SelfInspectionError) return NextResponse.json({ error: error.message }, { status: error.status });
    return failure(error);
  }
}
