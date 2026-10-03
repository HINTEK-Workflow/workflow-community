import { NextResponse } from "next/server";
import { lookupCompany } from "@/lib/kfid/company-lookup";
import { normalizeOrgNumber } from "@/lib/kfid/org-number";
import { registrationOpen } from "@/lib/auth/registration";
import { ApiError, failure } from "@/lib/kfid/server";

export const dynamic = "force-dynamic";

// Thirty lookups an hour per address: enough to fix a typo, not enough to walk the register.
const windows = new Map<string, { start: number; count: number }>();

/** Företagsuppslag for Skapa konto (2026-10-03): name and address by organisation number, only while registration is open. */
export async function GET(request: Request) {
  try {
    if (!(await registrationOpen())) throw new ApiError(404, "Finns inte.");
    const ip = (request.headers.get("x-forwarded-for") ?? "").split(",")[0].trim() || request.headers.get("x-real-ip") || "local";
    const now = Date.now(); const window = windows.get(ip);
    if (!window || now - window.start > 3_600_000) windows.set(ip, { start: now, count: 1 });
    else if (++window.count > 30) throw new ApiError(429, "För många uppslag. Skriv in uppgifterna själv.");
    const digits = normalizeOrgNumber(new URL(request.url).searchParams.get("number") ?? "");
    if (!digits) throw new ApiError(400, "Organisationsnumret stämmer inte.");
    const company = await lookupCompany(digits);
    return NextResponse.json(company ? { found: true, ...company } : { found: false }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return failure(error);
  }
}
