import { NextResponse } from "next/server";
import { ApiError, body, checkOrigin, context } from "@/lib/kfid/server";
import { staffRegisterFailure } from "@/lib/staff-register/api";
import { disclosureInputSchema } from "@/lib/staff-register/model";
import { disclosureCandidates, discloseStaffRegister } from "@/lib/staff-register/server";

export const dynamic = "force-dynamic";

/**
 * Personalliggare på begäran (2026-10-09 evening): a company that is erased or switched off has no login, so
 * Workflow hands its kept register rows out on request. Superadmin only. GET lists the inactive companies with kept rows
 * (building sites and counts, no other data); POST (Origin, required reason) returns one site's rows as the ordinary
 * CSV export and writes the reason and the count to the company's administration history.
 */
async function superadmin() {
  const ctx = await context();
  if (ctx.user.role !== "SUPERADMIN") throw new ApiError(403, "Bara installationens administratör kan göra det.");
  return ctx;
}

export async function GET() {
  try {
    await superadmin();
    return NextResponse.json({ companies: await disclosureCandidates() }, { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) {
    return staffRegisterFailure(error);
  }
}

export async function POST(request: Request) {
  try {
    checkOrigin(request);
    const ctx = await superadmin();
    const input = disclosureInputSchema.parse(await body(request));
    const result = await discloseStaffRegister({ ...input, actorId: ctx.user.id, superadmin: ctx.user.role === "SUPERADMIN" });
    const name = `personalliggare-${result.siteId}-${result.from}-${result.to}`.replace(/[^\p{L}\p{N}-]+/gu, "-");
    return new Response(result.csv, { headers: {
      "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": `attachment; filename*=UTF-8''${encodeURIComponent(`${name}.csv`)}`, "Cache-Control": "private, no-store",
    } });
  } catch (error) {
    return staffRegisterFailure(error);
  }
}
