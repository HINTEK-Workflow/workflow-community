import { ApiError, checkOrigin, context, failure } from "@/lib/kfid/server";
import { formPreviewPdf, requireFormAdmin } from "@/lib/kfid/form-server";

export const dynamic = "force-dynamic";

/**
 * The editor's PDF preview in a new tab (2026-09-26): the editor posts an ordinary form with target="_blank",
 * so the browser – also on a phone – opens the PDF in its own viewer. Superadmin only, Origin checked, nothing stored.
 */
export async function POST(request: Request) {
  try {
    checkOrigin(request);
    const ctx = await context();
    requireFormAdmin(ctx);
    const form = await request.formData();
    const payload = form.get("payload");
    if (typeof payload !== "string" || payload.length > 2_000_000) throw new ApiError(400, "Förhandsgranskningen saknar innehåll.");
    let input: { meta?: unknown; document?: unknown; values?: unknown; blank?: unknown; sample?: boolean };
    try { input = JSON.parse(payload); } catch { throw new ApiError(400, "Ogiltig förhandsgranskning."); }
    // The builder's preview sends the answers on screen (2026-09-28); the PDF button without them gets example data.
    return await formPreviewPdf({ meta: input.meta, document: input.document, values: input.values, blank: input.blank === true, sample: input.sample !== false });
  } catch (error) {
    return failure(error);
  }
}
