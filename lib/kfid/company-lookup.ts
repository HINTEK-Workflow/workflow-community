import { prisma } from "@/lib/db";
import { normalizeCompanyOrgNumber } from "@/lib/kfid/org-number";
import { centralFieldInfo, centralSecret, saveCentralSecret, type CentralActor } from "@/lib/secrets/central-store";

// Företagsuppslag (2026-10-03): the company's name and address from SCB's free company register (Företagsregistret,
// free since 2025-06-26) by organisation number. The key is personal to the product owner, stored sealed in the app and
// never sent to the browser. Without a key, or when SCB does not answer, the person types the name; nothing stops.

const SCB_URL = "https://apiafr.scb.se/v1/juridiskaenheter";
// The key is a central key (lib/secrets/central-store.ts, 2026-10-25); companyLookup keeps the hint and the end date.

// validUntil (2026-10-03: "den är aktiv i två år"): when SCB's key stops working, so keys:alerts warns in time;
// alerted holds the warnings already sent for that date.
type Stored = { keyCipher?: string; keyHint?: string; updatedAt?: string; updatedBy?: string; validUntil?: string; alerted?: string[] };
const stored = async (): Promise<Stored> => {
  const row = await prisma.systemSettings.findUnique({ where: { id: "global" }, select: { companyLookup: true } });
  return (row?.companyLookup ?? {}) as Stored;
};

export async function companyLookupView() {
  const [value, info] = await Promise.all([stored(), centralFieldInfo("scb.apiKey")]);
  return { configured: info.present, keyHint: info.storage ? value.keyHint ?? null : null, storage: info.storage, updatedAt: value.updatedAt ?? null, updatedBy: value.updatedBy ?? null, validUntil: value.validUntil ?? null };
}

export async function saveCompanyLookupKey(key: string | null, actor: CentralActor) {
  // The key first (in the key vault too, where the installation has one): when that fails nothing of the save is kept.
  await saveCentralSecret("scb.apiKey", key?.trim() || null, actor);
  const next: Stored = key ? { keyHint: `…${key.trim().slice(-4)}`, updatedAt: new Date().toISOString(), updatedBy: actor.label } : { updatedAt: new Date().toISOString(), updatedBy: actor.label };
  await prisma.systemSettings.upsert({ where: { id: "global" }, update: { companyLookup: next }, create: { id: "global", companyLookup: next } });
}

/** The day SCB's key stops working (YYYY-MM-DD), or null; a new date starts the warnings over. */
export async function saveCompanyLookupValidUntil(validUntil: string | null, actor: string) {
  const current = await stored();
  const next: Stored = { ...current, validUntil: validUntil ?? undefined, alerted: [], updatedAt: new Date().toISOString(), updatedBy: actor };
  await prisma.systemSettings.upsert({ where: { id: "global" }, update: { companyLookup: next }, create: { id: "global", companyLookup: next } });
}

export type FoundCompany = { name: string; address: string; postalCode: string; city: string };

/** The company behind a valid ten-digit number, or null (no key, not found, or SCB did not answer). */
export async function lookupCompany(digits: string, keyOverride?: string): Promise<FoundCompany | null> {
  // Never a personal number (enskild firma, 2026-11-04): it is not sent to SCB, whatever calls this.
  if (!normalizeCompanyOrgNumber(digits)) return null;
  const key = keyOverride ?? await centralSecret("scb.apiKey");
  if (!key) return null;
  // SCB writes a legal entity's number with the century prefix 16, so the plain number is tried too.
  for (const candidate of [`16${digits}`, digits]) {
    try {
      const response = await fetch(`${SCB_URL}/${candidate}`, { headers: { "X-API-Key": key, accept: "application/json" }, signal: AbortSignal.timeout(5_000) });
      if (response.status === 404) continue;
      if (!response.ok) return null;
      const data = await response.json() as Record<string, unknown> | Record<string, unknown>[];
      const entity = (Array.isArray(data) ? data[0] : data) as { namn?: string; postAdress?: { gatuAdress?: string; postNr?: string; postOrt?: string } } | undefined;
      if (!entity?.namn) continue;
      return { name: String(entity.namn).trim(), address: String(entity.postAdress?.gatuAdress ?? "").trim(), postalCode: String(entity.postAdress?.postNr ?? "").trim(), city: String(entity.postAdress?.postOrt ?? "").trim() };
    } catch { return null; }
  }
  return null;
}
