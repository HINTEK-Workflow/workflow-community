import { NextResponse } from "next/server";
import { companyLookupView, lookupCompany } from "@/lib/kfid/company-lookup";
import { looksLikePersonalNumber, normalizeCompanyOrgNumber } from "@/lib/kfid/org-number";
import { ApiError, context, failure } from "@/lib/kfid/server";
import { hitRateLimit, RATE_RULES } from "@/lib/security/rate-limit";

export const dynamic = "force-dynamic";

/**
 * Företagsuppslag for signed-in administrators (2026-10-07): a company admin filling in the company's own details
 * and the superadmin preparing a customer company look the number up in SCB's register, with the key under
 * Installation → Servernycklar. Name and address only; nothing is stored here.
 */
export async function GET(request: Request) {
  try {
    const ctx = await context({ skipLegal: true });
    if (!ctx.admin && ctx.user.role !== "SUPERADMIN") throw new ApiError(403, "Det här kräver företagsadministratör.");
    if (!(await companyLookupView()).configured) return NextResponse.json({ available: false, found: false }, { headers: { "Cache-Control": "no-store" } });
    if (!(await hitRateLimit(RATE_RULES.companyLookupUser, ctx.user.id)).allowed) throw new ApiError(429, "För många uppslag. Skriv in uppgifterna själv.");
    const given = new URL(request.url).searchParams.get("number") ?? "";
    // A personal number (enskild firma) is never sent to SCB, nor repeated in an answer (2026-11-04).
    if (looksLikePersonalNumber(given)) throw new ApiError(400, "Personnummer slås inte upp. Skriv uppgifterna själv.");
    const digits = normalizeCompanyOrgNumber(given);
    if (!digits) throw new ApiError(400, "Organisationsnumret stämmer inte.");
    const company = await lookupCompany(digits);
    return NextResponse.json(company ? { available: true, found: true, ...company } : { available: true, found: false }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return failure(error);
  }
}
