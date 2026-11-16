import { createHmac, randomUUID, timingSafeEqual } from "node:crypto";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { env } from "@/lib/env";
import { registrationAllowsEmail, setInvitedMembers, setRegistrationGate } from "@/lib/auth/registration-gate";
import { readLoginRule, setLoginRule, type LoginRule } from "@/lib/auth/login-rule";
import { LOGIN_RULE_REFUSAL, loginRuleAllows } from "@/lib/auth/access";
import { recordRegistrationAcceptances, registrationDocuments } from "@/lib/legal";
import { formatOrgNumber, looksLikePersonalNumber, maskPersonalNumber, normalizePartyNumber } from "@/lib/kfid/org-number";
import { publicInstance } from "@/lib/instance";
import { serverExtensions } from "@/lib/extensions/server";

// A new company starts in Cloud (with the trial) unless the owner has switched Local start on in the price settings
// (`localStorage.enabled`, off since 2026-11-08: Local is stopped for new accounts, the technology stays). An
// installation without billing (the community edition on the customer's own server, 2026-10-03) keeps every
// company's data on its own server from the start.
export const registrationStorageMode = async () => (publicInstance().features.billing && await serverExtensions.localStartOn() ? "LOCAL" as const : "HINTEK_CLOUD" as const);

// Skapa konto (2026-10-03): a company signs itself up – organisation number, company name, the person, one
// "jag har läst" checkbox and an optional yes to news. It starts free, in Local (the company's own file); Cloud is the
// paid step. Only while "Tillåt nya konton" is on. The acceptances are stored against the exact document versions.

let checkedAt = 0;
/** The read under way, which every caller meanwhile waits for; `generation` drops a read made stale by registrationGateChanged. */
let reading: Promise<void> | null = null;
let generation = 0;
/** Whether a read has succeeded since the process started; until then the checks keep their closed defaults. */
let loaded = false;
/**
 * Reads "Tillåt nya konton" and "Vem får logga in" at most every 15 seconds and updates the access checks, so a person
 * who may no longer sign in loses an existing session, API key and MCP access at the next check.
 *
 * Utloggad efter omstart (2026-11-16): every caller waits for the read under way. Before, only the first request after a
 * start waited for the settings; requests arriving meanwhile were judged by the closed defaults, so everyone but the owner
 * was refused – and the session route then wrote an empty token into the cookie, a real sign-out. A read that fails keeps
 * the values last read (the administrator's own choice) and is tried again two seconds later; before the first good read
 * the checks stay closed, as before.
 */
export async function refreshRegistrationGate() {
  if (reading) return reading;
  if (Date.now() - checkedAt < 15_000) return;
  const mine = ++generation;
  const pending = readGate(mine).finally(() => { if (reading === pending) reading = null; });
  reading = pending;
  return pending;
}

async function readGate(mine: number) {
  const row = await prisma.systemSettings.findUnique({ where: { id: "global" }, select: { registrationOpen: true, loginAccess: true } }).catch(() => undefined);
  const rule = row === undefined ? null : readLoginRule(row?.loginAccess);
  // Only asked for where it decides anything: a chosen rule, or open registration, already says who may sign in.
  const invited = row === undefined || !rule ? null : rule.mode || row?.registrationOpen ? [] : await readInvitedMembers();
  if (mine !== generation) return;
  if (row === undefined || !rule || invited === null) {
    if (!loaded) { setRegistrationGate(false); setInvitedMembers([]); }
    checkedAt = Date.now() - 13_000; // tried again in two seconds, not at every request while the database is away
    return;
  }
  setRegistrationGate(Boolean(row?.registrationOpen));
  setLoginRule(rule);
  setInvitedMembers(invited);
  loaded = true;
  checkedAt = Date.now();
}

/** After an accepted invitation: the next access check reads again, so the new member need not wait for the 15 seconds. */
export function registrationGateChanged() { checkedAt = 0; reading = null; generation++; }

/** The addresses of those who accepted an invitation and still are active members of an active company; null when unreadable. */
async function readInvitedMembers(): Promise<string[] | null> {
  const rows = await prisma.$queryRaw<{ email: string }[]>`
    SELECT DISTINCT lower(u.email) AS email
    FROM "OrganizationInvitation" i
    JOIN "OrganizationMember" m ON m."organizationId" = i."organizationId" AND m."userId" = i."acceptedUserId" AND m."isActive" = true
    JOIN "User" u ON u.id = i."acceptedUserId" AND u."isActive" = true
    JOIN "Organization" o ON o.id = i."organizationId" AND o."isActive" = true
    WHERE i.status = 'ACCEPTED'
    LIMIT 20000`.catch(() => null);
  return rows ? rows.map((row) => row.email) : null;
}

/** The saved "Vem får logga in" (mode null = not chosen yet). */
export async function savedLoginRule(): Promise<LoginRule> {
  const row = await prisma.systemSettings.findUnique({ where: { id: "global" }, select: { loginAccess: true } });
  return readLoginRule(row?.loginAccess);
}

export async function saveLoginRule(rule: LoginRule) {
  const loginAccess = { mode: rule.mode, allow: rule.allow, block: rule.block };
  await prisma.systemSettings.upsert({ where: { id: "global" }, update: { loginAccess }, create: { id: "global", loginAccess } });
  setLoginRule(readLoginRule(loginAccess));
  checkedAt = Date.now();
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
  // Aktiebolag eller annat företag, or enskild firma (2026-11-04): a sole trader signs up with its personal number in the same place.
  companyType: z.enum(["company", "soleTrader"]).default("company"),
  organizationNumber: z.string().trim().min(10, "Ange organisationsnumret.").max(20),
  companyName: z.string().trim().min(2, "Ange företagets namn.").max(200),
  name: z.string().trim().min(2, "Ange ditt namn.").max(200).optional(),
  accepted: z.array(z.object({ id: z.string().max(60), contentHash: z.string().max(200) })).max(10),
  newsletter: z.boolean().default(false),
  address: z.string().trim().max(200).optional(),
  postalCode: z.string().trim().max(20).optional(),
  city: z.string().trim().max(100).optional(),
  // Optional at sign-up (2026-11-04): the person's own number; everything else a document needs is asked in Kom igång.
  phone: z.string().trim().max(40).optional(),
});
export type CompanyInput = z.infer<typeof companyInputSchema>;

/** Checks everything that does not need the person yet: open, a valid and unused number, the current documents. */
export async function checkCompany(input: CompanyInput) {
  if (!(await registrationOpen())) throw new RegistrationError(403, "Nya konton kan inte skapas just nu.");
  // The refusals never repeat the number (a personal number is sensitive).
  const number = normalizePartyNumber(input.organizationNumber, input.companyType);
  if (!number) throw new RegistrationError(400, input.companyType === "soleTrader"
    ? "Personnumret stämmer inte. Kontrollera siffrorna (ÅÅMMDD-NNNN)."
    : looksLikePersonalNumber(input.organizationNumber)
      ? "Det här är ett personnummer. Välj Enskild firma om du driver företaget som privatperson."
      : "Organisationsnumret stämmer inte. Kontrollera siffrorna (NNNNNN-NNNN).");
  const taken = await prisma.$queryRaw<{ organizationId: string }[]>`
    SELECT "organizationId" FROM "WorkspaceSettings"
    WHERE regexp_replace(lower(coalesce(profile->>'organizationNumber', '')), '[^a-z0-9]', '', 'g') = ${number}
    LIMIT 1`;
  if (taken.length) throw new RegistrationError(409, "Företaget finns redan i Workflow. Be företagets administratör bjuda in dig.");
  const documents = await registrationDocuments(await registrationStorageMode());
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
  checkedAt = 0;
  await refreshRegistrationGate();
  const mode = await registrationStorageMode();
  if (!loginRuleAllows(email)) throw new RegistrationError(403, LOGIN_RULE_REFUSAL);
  return prisma.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(8216647)`;
    if (await tx.user.findUnique({ where: { email }, select: { id: true } }))
      throw new RegistrationError(409, "Det finns redan ett konto med den e-postadressen. Logga in i stället.");
    const again = await tx.$queryRaw<{ organizationId: string }[]>`
      SELECT "organizationId" FROM "WorkspaceSettings"
      WHERE regexp_replace(lower(coalesce(profile->>'organizationNumber', '')), '[^a-z0-9]', '', 'g') = ${number} LIMIT 1`;
    if (again.length) throw new RegistrationError(409, "Företaget finns redan i Workflow. Be företagets administratör bjuda in dig.");
    const now = new Date();
    const organization = await tx.organization.create({ data: { name: input.companyName, slug: `company-${randomUUID()}`, storageMode: mode, wallet: { create: {} } } });
    const user = await tx.user.create({ data: {
      email, name: person.name, passwordHash: person.passwordHash ?? null, role: "STAFF", isActive: true,
      emailVerifiedAt: person.emailVerified ? now : null, activeOrganizationId: organization.id,
      newsletterOptInAt: input.newsletter ? now : null,
    } });
    await tx.workspaceSettings.create({ data: {
      organizationId: organization.id, companyName: input.companyName, contactEmail: email,
      profile: { companyType: input.companyType, organizationNumber: formatOrgNumber(number), contactName: person.name, email, address: input.address ?? "", postalCode: input.postalCode ?? "", city: input.city ?? "", phone: input.phone ?? "" },
    } });
    await tx.organizationMember.create({ data: { organizationId: organization.id, userId: user.id, role: "OWNER" } });
    // The guide opens by itself at the first sign-in (Kom igång, 2026-10-03).
    await tx.userPreferences.create({ data: { userId: user.id, data: { tours: { setupPending: now.toISOString() } } } });
    await recordRegistrationAcceptances(tx, { userId: user.id, organizationId: organization.id, documents });
    await tx.administrationEvent.create({ data: {
      actorId: user.id, organizationId: organization.id, action: "self_registration",
      detail: `Kontot skapades av ${email} (${person.passwordHash ? "e-post och lösenord" : "Google"}), ${input.companyType === "soleTrader" ? `enskild firma, personnummer ${maskPersonalNumber(number)}` : `organisationsnummer ${formatOrgNumber(number)}`}. Godkände: ${documents.map((document) => `${document.title} version ${document.version}`).join(", ") || "inga publicerade villkor"}.${input.newsletter ? " Ja till nyhetsutskick." : ""}`,
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
