import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { googleKeysConfigured, googleSignInAllowed, setGoogleSignInAllowed } from "@/lib/auth/login-settings";
import { registrationOpen, savedLoginRule, saveLoginRule, setRegistrationOpen } from "@/lib/auth/registration";
import { isTestEmail, pilotAccessEmails } from "@/lib/auth/access";
import { parseLoginList, ruleAllows, type LoginAccessMode, type LoginRule } from "@/lib/auth/login-rule";
import { instanceAdminEmail } from "@/lib/instance-server";
import { companyLookupView, lookupCompany, saveCompanyLookupKey, saveCompanyLookupValidUntil } from "@/lib/kfid/company-lookup";
import { normalizeCompanyOrgNumber } from "@/lib/kfid/org-number";
import { publicInstance } from "@/lib/instance";
import { ApiError, body, checkOrigin, context, failure } from "@/lib/kfid/server";
import { requireCentralKeyChange, requireCentralKeyViewer } from "@/lib/secrets/central-access";
import { CentralStoreError } from "@/lib/secrets/central-store";


export const dynamic = "force-dynamic";

// Workflow's superadmin only, and a fresh sign-in for every change of a key (lib/secrets/central-access.ts, 2026-10-25).
async function superadmin() {
  const ctx = await context({ skipLegal: true });
  requireCentralKeyViewer(ctx);
  return Object.assign(ctx, { ...ctx.user, activeOrganizationId: ctx.organizationId });
}

const MODE_NAMES: Record<LoginAccessMode, string> = { ALL: "Alla", ONLY: "Endast", BLOCK: "Alla utom blockerade" };

/** Before "Vem får logga in" is chosen, the older rule in the same terms: open = Alla, otherwise Endast the pilot list. */
const legacyRule = (open: boolean): LoginRule => (open ? { mode: "ALL", allow: [], block: [] } : { mode: "ONLY", allow: [...pilotAccessEmails()], block: [] });

async function loginAccessView() {
  const saved = await savedLoginRule();
  const effective = saved.mode ? saved : legacyRule(await registrationOpen());
  return { mode: effective.mode as LoginAccessMode, allow: effective.allow, block: effective.block, chosen: Boolean(saved.mode), pilotCount: pilotAccessEmails().size, owner: instanceAdminEmail() || null };
}

function listChanges(label: string, before: string[], after: string[]) {
  const added = after.filter((item) => !before.includes(item));
  const removed = before.filter((item) => !after.includes(item));
  return [added.length ? `${label} tillagda: ${added.join(", ")}.` : "", removed.length ? `${label} borttagna: ${removed.join(", ")}.` : ""].filter(Boolean).join(" ");
}

const view = async (me = "") => ({ me, loginAccess: await loginAccessView(), googleSignIn: await googleSignInAllowed(), googleConfigured: await googleKeysConfigured(), googleAvailable: publicInstance().features.googleSignIn, registrationOpen: await registrationOpen(), companyLookup: await companyLookupView() });

/** Inloggning (2026-10-03): whether "Fortsätt med Google" is offered on the login page. */
export async function GET() {
  try {
    const user = await superadmin();
    return NextResponse.json(await view(user.email), { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) {
    return failure(error instanceof CentralStoreError ? new ApiError(error.status, error.message) : error);
  }
}

export async function POST(request: Request) {
  try {
    checkOrigin(request);
    const user = await superadmin();
    const input = z.object({ googleSignIn: z.boolean().optional(), registrationOpen: z.boolean().optional(), loginAccess: z.object({ mode: z.enum(["ALL", "ONLY", "BLOCK"]), allow: z.string().max(100_000), block: z.string().max(100_000) }).strict().optional(), scbKey: z.string().trim().max(400).nullable().optional(), scbValidUntil: z.union([z.iso.date(), z.null()]).optional(), testNumber: z.string().max(20).optional() }).strict().parse(await body(request));
    const changes: string[] = [];
    // A test lookup with the saved key (or the key typed): the company's name, so the superadmin sees that it works.
    if (input.testNumber !== undefined) {
      const digits = normalizeCompanyOrgNumber(input.testNumber);
      if (!digits) throw new ApiError(400, "Organisationsnumret stämmer inte.");
      const found = await lookupCompany(digits, input.scbKey || undefined);
      return NextResponse.json({ ...(await view(user.email)), test: found ? `SCB svarar: ${found.name}${found.city ? `, ${found.city}` : ""}.` : "SCB gav inget svar – kontrollera nyckeln och numret." });
    }
    if (input.scbKey !== undefined) { await saveCompanyLookupKey(input.scbKey || null, await requireCentralKeyChange(user)); changes.push(input.scbKey ? "SCB-nyckeln för företagsuppslag byttes." : "SCB-nyckeln för företagsuppslag togs bort."); }
    if (input.scbValidUntil !== undefined) { await saveCompanyLookupValidUntil(input.scbValidUntil, user.name || user.email); changes.push(input.scbValidUntil ? `SCB-nyckeln gäller till ${input.scbValidUntil}.` : "SCB-nyckelns slutdatum togs bort."); }
    if (input.googleSignIn !== undefined) { await setGoogleSignInAllowed(input.googleSignIn); changes.push(`Inloggning med Google ${input.googleSignIn ? "påslagen" : "avstängd"}.`); }
    if (input.loginAccess) {
      const allow = parseLoginList(input.loginAccess.allow);
      const block = parseLoginList(input.loginAccess.block);
      const invalid = [...allow.invalid, ...block.invalid];
      if (invalid.length) throw new ApiError(400, `Raderna kan inte tolkas: ${invalid.slice(0, 5).join(", ")}${invalid.length > 5 ? " …" : ""}. Skriv en hel e-postadress eller en domän som @foretag.se, en per rad.`);
      if (allow.entries.length > 2000 || block.entries.length > 2000) throw new ApiError(400, "Högst 2 000 rader per lista.");
      const next: LoginRule = { mode: input.loginAccess.mode, allow: allow.entries, block: block.entries };
      // The superadmin can never lock themselves out (2026-10-06): the rule must still let the saver in.
      if (!isTestEmail(user.email) && !ruleAllows(next, user.email))
        throw new ApiError(409, next.mode === "ONLY"
          ? `Du skulle låsa ute dig själv. Lägg till din egen adress (${user.email}) eller din domän i listan över vilka som får logga in.`
          : `Du skulle låsa ute dig själv. Ta bort din egen adress (${user.email}) eller din domän ur listan över blockerade.`);
      const before = await loginAccessView();
      await saveLoginRule(next);
      const detail = [
        before.mode !== next.mode || !before.chosen ? `Vem får logga in: ${MODE_NAMES[next.mode!]}.` : "",
        listChanges("Får logga in –", before.allow, next.allow),
        listChanges("Blockerade –", before.block, next.block),
      ].filter(Boolean).join(" ");
      if (detail) changes.push(detail);
    }
    if (input.registrationOpen !== undefined) {
      await setRegistrationOpen(input.registrationOpen);
      // Until "Vem får logga in" is chosen, this switch also decides sign-in (Alla when on), as before 2026-10-06.
      const chosen = (await savedLoginRule()).mode;
      changes.push(`Nya konton ${input.registrationOpen ? "tillåts – Skapa konto visas på inloggningssidan" : "tillåts inte – Skapa konto visas inte"}${chosen ? "" : ` (vem som får logga in följer: ${input.registrationOpen ? "Alla" : "Endast pilotlistan"})`}.`);
    }
    if (user.activeOrganizationId && changes.length)
      await prisma.administrationEvent.create({ data: { actorId: user.id, organizationId: user.activeOrganizationId, action: "login_settings", detail: changes.join(" ") } });
    return NextResponse.json(await view(user.email));
  } catch (error) {
    return failure(error instanceof CentralStoreError ? new ApiError(error.status, error.message) : error);
  }
}
