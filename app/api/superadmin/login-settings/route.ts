import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { getCurrentUser } from "@/lib/auth/session";
import { googleKeysConfigured, googleSignInAllowed, setGoogleSignInAllowed } from "@/lib/auth/login-settings";
import { registrationOpen, setRegistrationOpen } from "@/lib/auth/registration";
import { companyLookupView, lookupCompany, saveCompanyLookupKey, saveCompanyLookupValidUntil } from "@/lib/kfid/company-lookup";
import { normalizeOrgNumber } from "@/lib/kfid/org-number";
import { publicInstance } from "@/lib/instance";
import { ApiError, body, checkOrigin, failure } from "@/lib/kfid/server";

export const dynamic = "force-dynamic";

async function superadmin() {
  const user = await getCurrentUser();
  if (!user) throw new ApiError(401, "Logga in för att fortsätta.");
  if (user.role !== "SUPERADMIN") throw new ApiError(403, "Systemadministratör krävs.");
  return user;
}

const view = async () => ({ googleSignIn: await googleSignInAllowed(), googleConfigured: googleKeysConfigured(), googleAvailable: publicInstance().features.googleSignIn, registrationOpen: await registrationOpen(), companyLookup: await companyLookupView() });

/** Inloggning (2026-10-03): whether "Fortsätt med Google" is offered on the login page. */
export async function GET() {
  try {
    await superadmin();
    return NextResponse.json(await view(), { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) {
    return failure(error);
  }
}

export async function POST(request: Request) {
  try {
    checkOrigin(request);
    const user = await superadmin();
    const input = z.object({ googleSignIn: z.boolean().optional(), registrationOpen: z.boolean().optional(), scbKey: z.string().trim().max(400).nullable().optional(), scbValidUntil: z.union([z.iso.date(), z.null()]).optional(), testNumber: z.string().max(20).optional() }).strict().parse(await body(request));
    const changes: string[] = [];
    // A test lookup with the saved key (or the key typed): the company's name, so the superadmin sees that it works.
    if (input.testNumber !== undefined) {
      const digits = normalizeOrgNumber(input.testNumber);
      if (!digits) throw new ApiError(400, "Organisationsnumret stämmer inte.");
      const found = await lookupCompany(digits, input.scbKey || undefined);
      return NextResponse.json({ ...(await view()), test: found ? `SCB svarar: ${found.name}${found.city ? `, ${found.city}` : ""}.` : "SCB gav inget svar – kontrollera nyckeln och numret." });
    }
    if (input.scbKey !== undefined) { await saveCompanyLookupKey(input.scbKey || null, user.name || user.email); changes.push(input.scbKey ? "SCB-nyckeln för företagsuppslag byttes." : "SCB-nyckeln för företagsuppslag togs bort."); }
    if (input.scbValidUntil !== undefined) { await saveCompanyLookupValidUntil(input.scbValidUntil, user.name || user.email); changes.push(input.scbValidUntil ? `SCB-nyckeln gäller till ${input.scbValidUntil}.` : "SCB-nyckelns slutdatum togs bort."); }
    if (input.googleSignIn !== undefined) { await setGoogleSignInAllowed(input.googleSignIn); changes.push(`Inloggning med Google ${input.googleSignIn ? "påslagen" : "avstängd"}.`); }
    if (input.registrationOpen !== undefined) { await setRegistrationOpen(input.registrationOpen); changes.push(`Nya konton ${input.registrationOpen ? "tillåts – Workflow är öppet för alla med konto" : "tillåts inte – bara inbjudna och pilotlistan"}.`); }
    if (user.activeOrganizationId && changes.length)
      await prisma.administrationEvent.create({ data: { actorId: user.id, organizationId: user.activeOrganizationId, action: "login_settings", detail: changes.join(" ") } });
    return NextResponse.json(await view());
  } catch (error) {
    return failure(error);
  }
}
