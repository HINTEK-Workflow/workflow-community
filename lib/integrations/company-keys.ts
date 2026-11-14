import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { keyRing } from "@/lib/security/key-ring";
import { open, seal } from "@/lib/security/sealing";

/**
 * Företagens egna nycklar (2026-10-25, beslut 3a): a company's external keys (Fortnox and the others under
 * Inställningar → Kopplingar och nycklar) are sealed with the company's own data key, never with a key shared by all
 * companies, and never kept in the installation's key vault.
 *
 * - The data key: 256 random bits per company (OrganizationDataKey), stored only wrapped by the installation's key ring
 *   (sealing purpose org-data-key, bound to the company). A rotation of the ring rewraps these rows only.
 * - A key's value, format v3: `v3.<data key id>.<iv>.<tag>.<data>`, AES-256-GCM with company and key id as additional
 *   data – a value copied to another company or another key cannot be opened, and the data key is looked up only among
 *   the company's own.
 * - Values sealed before 2026-10-25 (v1, the shared derivation) are still opened until scripts/secrets/reseal.ts has
 *   moved them; a new or replaced value is always v3.
 * - Erasing the company erases its data keys (cascade), which leaves its values unreadable in every later backup.
 */
const aad = (organizationId: string, keyId: string) => Buffer.from(`integration-key\n${organizationId}:${keyId}`, "utf8");

type Client = Prisma.TransactionClient | typeof prisma;

async function unwrap(organizationId: string, wrapped: string) {
  const opened = open("org-data-key", wrapped, organizationId, keyRing());
  if (!opened.ok) throw new Error("Företagets datanyckel kan inte öppnas.");
  const key = Buffer.from(opened.value, "base64");
  if (key.length !== 32) throw new Error("Företagets datanyckel har fel längd.");
  return key;
}

/** The company's active data key, made on first use (one per company; a parallel first use finds the other's). */
export async function activeDataKey(organizationId: string, client: Client = prisma): Promise<{ id: string; key: Buffer }> {
  const existing = await client.organizationDataKey.findFirst({ where: { organizationId, retiredAt: null }, select: { id: true, wrappedKey: true } });
  if (existing) return { id: existing.id, key: await unwrap(organizationId, existing.wrappedKey) };
  const key = randomBytes(32);
  try {
    const created = await client.organizationDataKey.create({ data: { organizationId, wrappedKey: seal("org-data-key", key.toString("base64"), organizationId, keyRing()) }, select: { id: true } });
    return { id: created.id, key };
  } catch (error) {
    if (!(error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002")) throw error;
    const other = await client.organizationDataKey.findFirstOrThrow({ where: { organizationId, retiredAt: null }, select: { id: true, wrappedKey: true } });
    return { id: other.id, key: await unwrap(organizationId, other.wrappedKey) };
  }
}

/** Seals a company key's value with the company's data key, bound to the company and the key's id. */
export async function sealCompanyKey(organizationId: string, keyId: string, value: string, client: Client = prisma) {
  const dataKey = await activeDataKey(organizationId, client);
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", dataKey.key, iv);
  cipher.setAAD(aad(organizationId, keyId));
  const data = Buffer.concat([cipher.update(value, "utf8"), cipher.final()]);
  return ["v3", dataKey.id, iv.toString("base64url"), cipher.getAuthTag().toString("base64url"), data.toString("base64url")].join(".");
}

/**
 * Opens a company key's value, or throws without detail. The data key is looked up only among the company's own, so a
 * value from another company cannot be opened even if it were copied here.
 */
export async function openCompanyKey(organizationId: string, keyId: string, stored: string, client: Client = prisma): Promise<string> {
  const parts = stored.split(".");
  if (parts[0] === "v3" && parts.length === 5) {
    const [, dataKeyId, iv, tag, data] = parts;
    const row = await client.organizationDataKey.findFirst({ where: { id: dataKeyId, organizationId }, select: { wrappedKey: true } });
    if (!row) throw new Error("Nyckeln kan inte öppnas.");
    const key = await unwrap(organizationId, row.wrappedKey);
    const ivBytes = Buffer.from(iv, "base64url");
    const tagBytes = Buffer.from(tag, "base64url");
    if (ivBytes.length !== 12 || tagBytes.length !== 16) throw new Error("Nyckeln kan inte öppnas.");
    try {
      const decipher = createDecipheriv("aes-256-gcm", key, ivBytes, { authTagLength: 16 });
      decipher.setAAD(aad(organizationId, keyId));
      decipher.setAuthTag(tagBytes);
      return Buffer.concat([decipher.update(Buffer.from(data, "base64url")), decipher.final()]).toString("utf8");
    } catch {
      throw new Error("Nyckeln kan inte öppnas.");
    }
  }
  const legacy = open("integration-key", stored, "", keyRing());
  if (!legacy.ok) throw new Error("Nyckeln kan inte öppnas.");
  return legacy.value;
}

/** Whether a stored value is already in the company-bound format (the reseal script's work list). */
export const companyKeyCurrent = (stored: string | null | undefined) => Boolean(stored?.startsWith("v3."));
