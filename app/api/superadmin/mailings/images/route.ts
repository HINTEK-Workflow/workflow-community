import { NextResponse } from "next/server";
import { absoluteUrl } from "@/lib/env";
import { ApiError, checkOrigin, context, failure } from "@/lib/kfid/server";
import { MAILING_IMAGE_MAX_BYTES, storeMailingImage } from "@/lib/mail/mailing-images";

export const dynamic = "force-dynamic";

// Bild till ett utskick (2026-10-03): the superadmin uploads; the answer is the public address used in the mail.
export async function POST(request: Request) {
  try {
    checkOrigin(request);
    const ctx = await context();
    if (ctx.user.role !== "SUPERADMIN") throw new ApiError(403, "Systemadministratör krävs.");
    const file = (await request.formData()).get("file");
    if (!(file instanceof File)) throw new ApiError(400, "Välj en bild.");
    if (file.size > MAILING_IMAGE_MAX_BYTES) throw new ApiError(413, "Bilden är större än 2 MB.");
    let key: string;
    try { key = await storeMailingImage(new Uint8Array(await file.arrayBuffer())); }
    catch (error) { throw new ApiError(400, (error as Error).message); }
    return NextResponse.json({ url: absoluteUrl(`/api/mailing-images/${key}`) });
  } catch (error) {
    return failure(error);
  }
}
