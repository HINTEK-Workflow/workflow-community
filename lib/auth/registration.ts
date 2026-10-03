import { createHmac, randomUUID, timingSafeEqual } from "node:crypto";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { env } from "@/lib/env";
import { registrationAllowsEmail, setRegistrationGate } from "@/lib/auth/registration-gate";
import { recordRegistrationAcceptances, registrationDocuments } from "@/lib/legal";
import { formatOrgNumber, normalizeOrgNumber } from "@/lib/kfid/org-number";
import { publicInstance } from "@/lib/instance";

// HINTEK sells Cloud, so a new company there starts free in Local; an installation without billing (the community
// edition on the customer's own server, 2026-10-03) keeps every company's data on its own server from the start.
export const registrationStorageMode = () => (publicInstance().features.billing ? "LOCAL" as const : "HINTEK_CLOUD" as const);

// Skapa konto (2026-10-03): a company signs itself up – organisation number, company name, the person, one
// "jag har läst" checkbox and an optional yes to news. It starts free, in Local (the company's own file); Cloud is the
// paid step. Only while "Tillåt nya konton" is on. The acceptances are stored against the exact document versions.

let checkedAt = 0;
/** Reads "Tillåt nya konton" at most every 15 seconds and updates the access checks. */
export async function refreshRegistrationGate() {
  if (Date.now() - checkedAt < 15_000) return;
  checkedAt = Date.now();
  const row = await prisma.systemSettings.findUnique({ where: { id: "global" }, select: { registrationOpen: true } }).catch(() => null);
  setRegistrationGate(Boolean(row?.registrationOpen));
}

export async function registrationOpen() {
  const row = await prisma.systemSettings.findUnique({ where: { id: "global" }, select: { registrationOpen: true } });
  return Boolean(row?.registrationOpen);
}

export async function setRegistrationOpen(value: boolean) {
  await prisma.systemSettings.upsert({ where: { id: "global" }, update: { registrationOpen: value }, create: { id: "global", registrationOpen: value } });
  setRegistrationGate(value);
  checkedAt = Date.now();
}

export class RegistrationError extends Error {
  constructor(public status: number, message: string) { super(message); }
}

export const companyInputSchema = z.object({
  organizationNumber: z.string().trim().min(10, "Ange organisationsnumret.").max(20),
  companyName: z.string().trim().min(2, "Ange företagets namn.").max(200),
  name: z.string().trim().min(2, "Ange ditt namn.").max(200).optional(),
  accepted: z.array(z.object({ id: z.string().max(60), contentHash: z.string().max(200) })).max(10),
  newsletter: z.boolean().default(false),
  address: z.string().trim().max(200).optional(),
  postalCode: z.string().trim().max(20).optional(),
  city: z.string().trim().max(100).optional(),
});
export type CompanyInput = z.infer<typeof companyInputSchema>;

/** Checks everything that does not need the person yet: open, a valid and unused number, the current documents. */
export async function checkCompany(input: CompanyInput) {
  if (!(await registrationOpen())) throw new RegistrationError(403, "Nya konton kan inte skapas just nu.");
  const number = normalizeOrgNumber(input.organizationNumber);
  if (!number) throw new RegistrationError(400, "Organisationsnumret stämmer inte. Kontrollera siffrorna (NNNNNN-NNNN).");
  const taken = await prisma.$queryRaw<{ organizationId: string }[]>`
    SELECT "organizationId" FROM "WorkspaceSettings"
    WHERE regexp_replace(lower(coalesce(profile->>'organizationNumber', '')), '[^a-z0-9]', '', 'g') = ${number}
    LIMIT 1`;
  if (taken.length) throw new RegistrationError(409, "Företaget finns redan i Workflow. Be företagets administratör bjuda in dig.");
  const documents = await registrationDocuments(registrationStorageMode());
  const accepted = new Set(input.accepted.map((item) => `${item.id}:${item.contentHash}`));
  if (!documents.every((document) => accepted.has(`${document.id}:${document.contentHash}`)))
    throw new RegistrationError(409, "Villkoren har ändrats sedan sidan öppnades. Ladda om sidan och kryssa i rutan igen.");
  return { number, documents };
}

/** Creates the company and its owner in one transaction. Returns the new user's id. */
export async function registerAccount(input: CompanyInput, person: { email: string; name: string; passwordHash?: string; emailVerified: boolean }) {
  const { number, documents } = await checkCompany(input);
  const email = person.email.trim().toLowerCase();
  if (!registrationAllowsEmail(email)) throw new RegistrationError(403, "Den här adressen kan inte registreras här.");
  return prisma.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(8216647)`;
    if (await tx.user.findUnique({ where: { email }, select: { id: true } }))
      throw new RegistrationError(409, "Det finns redan ett konto med den e-postadressen. Logga in i stället.");
    const again = await tx.$queryRaw<{ organizationId: string }[]>`
      SELECT "organizationId" FROM "WorkspaceSettings"
      WHERE regexp_replace(lower(coalesce(profile->>'organizationNumber', '')), '[^a-z0-9]', '', 'g') = ${number} LIMIT 1`;
    if (again.length) throw new RegistrationError(409, "Företaget finns redan i Workflow. Be företagets administratör bjuda in dig.");
    const now = new Date();
    const organization = await tx.organization.create({ data: { name: input.companyName, slug: `company-${randomUUID()}`, storageMode: registrationStorageMode(), wallet: { create: {} } } });
    const user = await tx.user.create({ data: {
      email, name: person.name, passwordHash: person.passwordHash ?? null, role: "STAFF", isActive: true,
      emailVerifiedAt: person.emailVerified ? now : null, activeOrganizationId: organization.id,
      newsletterOptInAt: input.newsletter ? now : null,
    } });
    await tx.workspaceSettings.create({ data: {
      organizationId: organization.id, companyName: input.companyName, contactEmail: email,
      profile: { organizationNumber: formatOrgNumber(number), contactName: person.name, email, address: input.address ?? "", postalCode: input.postalCode ?? "", city: input.city ?? "" },
    } });
    await tx.organizationMember.create({ data: { organizationId: organization.id, userId: user.id, role: "OWNER" } });
    // The guide opens by itself at the first sign-in (Kom igång, 2026-10-03).
    await tx.userPreferences.create({ data: { userId: user.id, data: { tours: { setupPending: now.toISOString() } } } });
    await recordRegistrationAcceptances(tx, { userId: user.id, organizationId: organization.id, documents });
    await tx.administrationEvent.create({ data: {
      actorId: user.id, organizationId: organization.id, action: "self_registration",
      detail: `Kontot skapades av ${email} (${person.passwordHash ? "e-post och lösenord" : "Google"}), organisationsnummer ${formatOrgNumber(number)}. Godkände: ${documents.map((document) => `${document.title} version ${document.version}`).join(", ") || "inga publicerade villkor"}.${input.newsletter ? " Ja till nyhetsutskick." : ""}`,
    } });
    return user.id;
  });
}

// ---------- Google: the company details wait in a short-lived, signed cookie while the person signs in with Google ----------
export const REGISTRATION_COOKIE = "wf-register";
const sign = (payload: string) => createHmac("sha256", env.AUTH_SECRET).update(`register:${payload}`).digest("base64url");

export function createRegistrationIntent(input: CompanyInput) {
  const payload = Buffer.from(JSON.stringify({ ...input, exp: Math.floor(Date.now() / 1000) + 900 })).toString("base64url");
  return { value: `${payload}.${sign(payload)}`, maxAge: 900 };
}

export function readRegistrationIntent(value: string | undefined): CompanyInput | null {
  const [payload, signature] = (value ?? "").split(".");
  if (!payload || !signature) return null;
  const expected = Buffer.from(sign(payload));
  const given = Buffer.from(signature);
  if (expected.length !== given.length || !timingSafeEqual(expected, given)) return null;
  try {
    const data = JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as CompanyInput & { exp: number };
    if (data.exp * 1000 < Date.now()) return null;
    return companyInputSchema.parse(data);
  } catch { return null; }
}
