import { NextResponse } from "next/server";
import { z } from "zod";
import {
  ApiError,
  body,
  checkOrigin,
  context,
  failure,
} from "@/lib/kfid/server";

// Content-free acknowledgement of a PDF generated locally in the browser (Local storage mode).
// Local PDFs are free and never charge credits; the body holds only kind + requestKey, never customer or control
// data (asserted by tests/local-workspace.browser.cjs). Nothing is stored or mutated; the current balance is echoed.
export async function POST(request: Request) {
  try {
    checkOrigin(request);
    const ctx = await context();
    if (ctx.organization.storageMode !== "LOCAL")
      throw new ApiError(409, "Den här exporten gäller endast lokal lagring.");
    z
      .object({
        kind: z.enum(["pdf", "pdf_template"]),
        requestKey: z.uuid(),
      })
      .parse(await body(request));
    return NextResponse.json({ ok: true, balance: ctx.wallet.balance });
  } catch (error) {
    return failure(error);
  }
}
