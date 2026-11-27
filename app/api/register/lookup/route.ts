import { NextResponse } from "next/server";
import { companyLookupView, lookupCompany } from "@/lib/kfid/company-lookup";
import { looksLikePersonalNumber, normalizeCompanyOrgNumber } from "@/lib/kfid/org-number";
import { registrationOpen } from "@/lib/auth/registration";
import { ApiError, failure } from "@/lib/kfid/server";
import { hitRateLimit, RATE_RULES } from "@/lib/security/rate-limit";
import { clientIp } from "@/lib/security/client-ip";

export const dynamic = "force-dynamic";

// Thirty lookups an hour per address: enough to fix a typo, not enough to walk the register (counted in the database,
// security review 2026-10-04).

/** Företagsuppslag for Skapa konto (2026-10-03): name and address by organisation number, only while registration is open. */
export async function GET(request: Request) {
  try {
    if (!(await registrationOpen())) throw new ApiError(404, "Finns inte.");
    if (!(await hitRateLimit(RATE_RULES.companyLookup, clientIp(request.headers))).allowed) throw new ApiError(429, "För många uppslag. Skriv in uppgifterna själv.");
    const given = new URL(request.url).searchParams.get("number") ?? "";
    // A personal number (enskild firma) is never sent to SCB, nor repeated in an answer (2026-11-04).
    if (looksLikePersonalNumber(given)) throw new ApiError(400, "Personnummer slås inte upp. Skriv uppgifterna själv.");
    const digits = normalizeCompanyOrgNumber(given);
    if (!digits) throw new ApiError(400, "Organisationsnumret stämmer inte.");
    // available: false when the installation has no SCB key, so the form can say so in a short line (2026-11-04).
    const available = (await companyLookupView()).configured;
    const company = available ? await lookupCompany(digits) : null;
    return NextResponse.json(company ? { available, found: true, ...company } : { available, found: false }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return failure(error);
  }
}
