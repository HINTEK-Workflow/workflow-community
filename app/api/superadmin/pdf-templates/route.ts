import { NextResponse } from "next/server";
import { ApiError, body, checkOrigin, context, failure } from "@/lib/kfid/server";
import { hitRateLimit, RATE_RULES } from "@/lib/security/rate-limit";
import { pdfTemplatesEditorView, savePdfTemplate } from "@/lib/pdf-templates/server";
import { pdfTemplateSaveSchema } from "@/lib/pdf-templates/input";

export const dynamic = "force-dynamic";

/**
 * PDF-mallar (2026-11-03): Installation's editor of the documents' texts, visibility and order. Workflow's
 * superadmin only; every call checks the session and the role, a change also the Origin, the rate and the editor's token
 * (optimistic concurrency). Templates only – no company's data is read or returned here.
 */
async function superadmin() {
  const ctx = await context({ skipLegal: true });
  if (ctx.user.role !== "SUPERADMIN") throw new ApiError(403, "Bara installationens administratör kan göra det.");
  return ctx;
}

export async function GET() {
  try {
    await superadmin();
    return NextResponse.json(await pdfTemplatesEditorView(), { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) {
    return failure(error);
  }
}

export async function PUT(request: Request) {
  try {
    checkOrigin(request);
    const ctx = await superadmin();
    if (!(await hitRateLimit(RATE_RULES.pdfTemplateSave, ctx.user.id)).allowed) throw new ApiError(429, "Många ändringar den senaste timmen. Vänta en stund.");
    const input = pdfTemplateSaveSchema.parse(await body(request));
    const saved = await savePdfTemplate({ userId: ctx.user.id, organizationId: ctx.organizationId }, input);
    return NextResponse.json(saved, { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) {
    const blocks = (error as { blocks?: unknown }).blocks;
    if (error instanceof ApiError && blocks) return NextResponse.json({ error: error.message, blocks }, { status: error.status });
    return failure(error);
  }
}
