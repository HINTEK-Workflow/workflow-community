import { NextResponse } from "next/server";
import { z } from "zod";
import { ApiError, context, failure, requireCloudStorage } from "@/lib/kfid/server";
import { mayReadCustomerRegister } from "@/lib/kfid/customer-access";
import { limitedPlaceView, placeRegisterView, placeView } from "@/lib/kfid/place-server";
import { requireObjectData } from "@/lib/workflow/feature-settings-server";
import { placeRegisterFilterSchema } from "@/lib/workflow/place-register";

export const dynamic = "force-dynamic";

/**
 * A place with its whole way, the places below it, its history and its rounds (2026-10-04, Platser etapp 3), or
 * with ?register=1 the company's places across customers as a filtered page (Alla objekt, Underhåll 2026-10-06). Both
 * are read like the customer register; changing a place goes through /api/customer-card and its permission. The machine
 * events and key figures that were here (?events=1, ?kpi=1) belong to the machine parts since Underhåll (2026-10-30):
 * /api/maintenance?part=events|kpi. Beslut 10 (2026-11-01): the list needs the right Kunder; without it one place is only the
 * limited view of someone with a job at exactly that place or a round there today, and otherwise a refusal.
 */
export async function GET(request: Request) {
  try {
    const ctx = await context();
    requireCloudStorage(ctx);
    const url = new URL(request.url);
    const page = Math.min(50, Math.max(1, Number(url.searchParams.get("page")) || 1));
    if (url.searchParams.get("register") === "1") {
      if (!mayReadCustomerRegister(ctx)) throw new ApiError(403, "Du saknar behörighet att se kundregistret.");
      // Alla objekt belongs to Objektdata på platser (2026-10-07): refused while that is off.
      await requireObjectData(ctx.organizationId);
      const filter = placeRegisterFilterSchema.parse(Object.fromEntries(["level", "objectType", "criticality", "state", "q", "sort"].map((key) => [key, url.searchParams.get(key) ?? undefined])));
      return NextResponse.json(await placeRegisterView(ctx, filter, page), { headers: { "Cache-Control": "private, no-store" } });
    }
    const id = z.string().min(1).max(100).parse(url.searchParams.get("id"));
    if (!mayReadCustomerRegister(ctx)) return NextResponse.json(await limitedPlaceView(ctx, id), { headers: { "Cache-Control": "private, no-store" } });
    return NextResponse.json(await placeView(ctx, id, page), { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) {
    return failure(error);
  }
}
