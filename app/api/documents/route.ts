import { NextResponse } from "next/server";
import { z } from "zod";
import { ApiError, checkOrigin, context, failure, requireModule } from "@/lib/kfid/server";
import { readLimitedFormData } from "@/lib/security/limited-body";
import { documentListQuerySchema } from "@/lib/documents/model";
import { documentFacets, listDocuments, uploadDocument } from "@/lib/documents/server";

export const dynamic = "force-dynamic";

/**
 * Dokument (0.87.0): GET lists a customer's, a place's or the whole company's documents (`facets=1` gives the filter's customers and
 * places); POST uploads one file to a customer, or to one of its places. lib/documents/server.ts holds every check.
 */
export async function GET(request: Request) {
  try {
    const ctx = await context();
    const params = Object.fromEntries(new URL(request.url).searchParams);
    if (params.facets === "1") return NextResponse.json(await documentFacets(ctx, z.string().min(1).max(100).optional().parse(params.customerId || undefined)));
    return NextResponse.json(await listDocuments(ctx, documentListQuerySchema.parse(params)));
  } catch (error) {
    return failure(error);
  }
}

export async function POST(request: Request) {
  try {
    checkOrigin(request);
    const ctx = await context();
    requireModule(ctx, "customers");
    if (Number(request.headers.get("content-length")) > 12_000_000) throw new ApiError(413, "Filen får vara högst 10 MB.");
    const form = await readLimitedFormData(request, 12_000_000);
    const file = form.get("file");
    if (!(file instanceof File)) throw new ApiError(400, "Välj en fil.");
    const ids = z.object({ customerId: z.string().min(1).max(100), placeId: z.string().min(1).max(100).nullable() })
      .parse({ customerId: form.get("customerId"), placeId: form.get("placeId") || null });
    // The right, Cloud's write right and the customer are checked in uploadDocument, before anything is stored.
    return NextResponse.json(await uploadDocument(ctx, { customerId: ids.customerId, placeId: ids.placeId, file }));
  } catch (error) {
    return failure(error);
  }
}
