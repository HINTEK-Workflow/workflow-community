import { NextResponse } from "next/server";
import { ApiError, checkOrigin, failure } from "@/lib/kfid/server";
import { readLimitedFormData } from "@/lib/security/limited-body";
import { requireOperator } from "@/lib/operator/session";
import { createFaultReport } from "@/lib/operator/reports-server";
import { REPORT_PHOTO_LIMIT } from "@/lib/operator/rules";

export const dynamic = "force-dynamic";
const MAX_BYTES = REPORT_PHOTO_LIMIT * 10_500_000 + 50_000;

/**
 * Skicka felanmälan: a form with `data` (the report as JSON) and up to five `photo` files. The operator's own company and
 * machines only (lib/operator/reports-server.ts).
 */
export async function POST(request: Request) {
  try {
    checkOrigin(request);
    const operator = await requireOperator();
    if (Number(request.headers.get("content-length")) > MAX_BYTES) throw new ApiError(413, "Bilderna är för stora. Högst 10 MB per bild.");
    const form = await readLimitedFormData(request, MAX_BYTES);
    let data: unknown;
    try { data = JSON.parse(String(form.get("data") ?? "")); } catch { throw new ApiError(400, "Ogiltig felanmälan."); }
    const photos = form.getAll("photo").filter((item): item is File => item instanceof File && item.size > 0);
    return NextResponse.json(await createFaultReport(operator, data, photos), { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return failure(error);
  }
}
