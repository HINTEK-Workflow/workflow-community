import { NextResponse } from "next/server";
import { z } from "zod";
import { hashPassword } from "@/lib/auth/password";
import { sendVerificationEmail } from "@/lib/auth/service";
import { REGISTRATION_COOKIE, RegistrationError, checkCompany, companyInputSchema, createRegistrationIntent, registerAccount, registrationOpen, registrationStorageMode } from "@/lib/auth/registration";
import { registrationDocuments } from "@/lib/legal";
import { env } from "@/lib/env";
import { ApiError, body, checkOrigin, failure } from "@/lib/kfid/server";
import { hitRateLimit, RATE_RULES } from "@/lib/security/rate-limit";
import { clientIp } from "@/lib/security/client-ip";

export const dynamic = "force-dynamic";

const LINK_OF: Record<string, string> = { TERMS: "/legal/terms", PRIVACY: "/legal/privacy", DPA: "/legal/dpa" };

/** What the registration page needs: whether it is open, and the documents the one checkbox accepts. */
export async function GET() {
  try {
    if (!(await registrationOpen())) return NextResponse.json({ open: false, documents: [] });
    const documents = await registrationDocuments(await registrationStorageMode());
    return NextResponse.json({ open: true, documents: documents.map((document) => ({ id: document.id, title: document.title, version: document.version, contentHash: document.contentHash, href: LINK_OF[document.type] ?? "/legal/terms" })) }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return failure(error);
  }
}

// Ten tries an hour per address keeps automated sign-ups out; a person never needs more. Counted in the database and
// keyed by the address the proxy vouches for (security review 2026-10-04).
async function limit(request: Request) {
  if (!(await hitRateLimit(RATE_RULES.register, clientIp(request.headers))).allowed) throw new ApiError(429, "För många försök. Vänta en stund och försök igen.");
}

const emailSchema = companyInputSchema.extend({
  mode: z.literal("email"),
  name: z.string().trim().min(2, "Ange ditt namn.").max(200),
  email: z.email("Ange en giltig e-postadress.").max(254),
  password: z.string().min(12, "Lösenordet behöver minst 12 tecken.").max(72).refine((value) => Buffer.byteLength(value) <= 72, "Lösenordet får vara högst 72 byte."),
});
const googleSchema = companyInputSchema.extend({ mode: z.literal("google") });

/**
 * Skapa konto (2026-10-03). E-post: the company and its owner are created and a verification mail is sent.
 * Google: the company details are checked and wait in a signed, short-lived cookie until Google has signed the person
 * in (lib/auth/config.ts creates the account then).
 */
export async function POST(request: Request) {
  try {
    checkOrigin(request);
    await limit(request);
    const raw = await body(request);
    if (raw?.mode === "google") {
      const input = googleSchema.parse(raw);
      try { await checkCompany(input); } catch (error) { if (error instanceof RegistrationError) throw new ApiError(error.status, error.message); throw error; }
      const intent = createRegistrationIntent(input);
      const response = NextResponse.json({ ok: true });
      response.cookies.set(REGISTRATION_COOKIE, intent.value, { httpOnly: true, sameSite: "lax", secure: env.APP_URL.startsWith("https://"), path: "/", maxAge: intent.maxAge });
      return response;
    }
    const input = emailSchema.parse(raw);
    try { await registerAccount(input, { email: input.email, name: input.name, passwordHash: await hashPassword(input.password), emailVerified: false }); }
    catch (error) { if (error instanceof RegistrationError) throw new ApiError(error.status, error.message); throw error; }
    await sendVerificationEmail(input.email).catch(() => undefined);
    return NextResponse.json({ ok: true, email: input.email.trim().toLowerCase() }, { status: 201 });
  } catch (error) {
    return failure(error);
  }
}
