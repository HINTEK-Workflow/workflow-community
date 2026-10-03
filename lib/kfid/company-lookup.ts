import { prisma } from "@/lib/db";
import { env } from "@/lib/env";
import { openPassword, sealPassword } from "@/lib/mail/settings";

// Företagsuppslag (2026-10-03): the company's name and address from SCB's free company register (Företagsregistret,
// free since 2025-06-26) by organisation number. The key is personal to the product owner, stored sealed in the app and
// never sent to the browser. Without a key, or when SCB does not answer, the person types the name; nothing stops.

const SCB_URL = "https://apiafr.scb.se/v1/juridiskaenheter";
const secret = () => env.INTEGRATION_KEYS_SECRET ?? env.AUTH_SECRET;

type Stored = { keyCipher?: string; keyHint?: string; updatedAt?: string; updatedBy?: string };
const stored = async (): Promise<Stored> => {
  const row = await prisma.systemSettings.findUnique({ where: { id: "global" }, select: { companyLookup: true } });
  return (row?.companyLookup ?? {}) as Stored;
};

export async function companyLookupView() {
  const value = await stored();
  return { configured: Boolean(value.keyCipher), keyHint: value.keyHint ?? null, updatedAt: value.updatedAt ?? null, updatedBy: value.updatedBy ?? null };
}

export async function saveCompanyLookupKey(key: string | null, actor: string) {
  const next: Stored = key ? { keyCipher: sealPassword(key.trim(), secret()), keyHint: `…${key.trim().slice(-4)}`, updatedAt: new Date().toISOString(), updatedBy: actor } : { updatedAt: new Date().toISOString(), updatedBy: actor };
  await prisma.systemSettings.upsert({ where: { id: "global" }, update: { companyLookup: next }, create: { id: "global", companyLookup: next } });
}

export type FoundCompany = { name: string; address: string; postalCode: string; city: string };

/** The company behind a valid ten-digit number, or null (no key, not found, or SCB did not answer). */
export async function lookupCompany(digits: string, keyOverride?: string): Promise<FoundCompany | null> {
  const key = keyOverride ?? openPassword((await stored()).keyCipher, secret());
  if (!key) return null;
  // SCB writes a legal entity's number with the century prefix 16; a sole trader's with 19/20, so the plain number is tried too.
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
