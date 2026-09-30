import { NextResponse } from "next/server";
import { z } from "zod";
import { acceptLegalDocument, legalStatus } from "@/lib/legal";
import { body, checkOrigin, context, failure } from "@/lib/kfid/server";

export async function GET() {
  try {
    const ctx = await context({ skipLegal: true });
    return NextResponse.json({ documents: await legalStatus(ctx) });
  } catch (error) {
    return failure(error);
  }
}

export async function POST(request: Request) {
  try {
    checkOrigin(request);
    const ctx = await context({ skipLegal: true });
    const input = await body(request);
    const parsed = z
      .object({
        action: z.literal("accept"),
        documentId: z.string().min(1).max(100),
        contentHash: z.string().regex(/^[a-f0-9]{64}$/),
      })
      .parse(input);
    const acceptance = await acceptLegalDocument(
      ctx,
      parsed.documentId,
      parsed.contentHash,
    );
    return NextResponse.json({ ok: true, acceptedAt: acceptance.acceptedAt });
  } catch (error) {
    return failure(error);
  }
}
