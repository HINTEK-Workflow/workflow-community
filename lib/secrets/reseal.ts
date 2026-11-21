import { createHash, createHmac } from "node:crypto";
import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { activeDataKey, companyKeyCurrent, openCompanyKey, sealCompanyKey } from "@/lib/integrations/company-keys";
import { keyRing } from "@/lib/security/key-ring";
import { keyId, open, seal, sealedKeyId } from "@/lib/security/sealing";
import { CENTRAL_FIELDS, CENTRAL_FIELD_IDS, LEGACY_COLUMNS, legacyCipherIn, withoutLegacyCipher, type LegacyColumn } from "@/lib/secrets/central-fields";
import { parseCentralState } from "@/lib/secrets/central-state";
import { clearCentralCache } from "@/lib/secrets/central-store";

/**
 * Omförsegling till nyckelringens aktuella hemlighet (2026-10-25, beslut 3a; runbook docs/drift/NYCKELROTATION.md).
 *
 * - inventory(): counts only – per place, how many values are current, on an older secret or format, or cannot be opened.
 * - snapshot(): every sealed column the reseal touches, exactly as stored (ciphertexts, never opened), for the backup
 *   file the way back reads.
 * - reseal(): in one transaction, every value that can be opened is sealed again with the current secret (and moved to
 *   its new place: the central keys to SystemSettings.centralSecrets, the companies' keys to their data keys), each new
 *   value is opened again and compared before the transaction is committed. Refused while anything cannot be opened.
 * - restore(): writes the snapshot back exactly. Works as long as the secrets that sealed it are still in the ring.
 *
 * Never touched: the staff register's events (append-only by law; opened with their secret, which stays in the ring),
 * the hashes of issued keys, passwords and links. Never prints or returns a value.
 */
export type PlaceCount = { current: number; older: number; unreadable: number };
export type Inventory = Record<string, PlaceCount>;

const blank = (): PlaceCount => ({ current: 0, older: 0, unreadable: 0 });
const legacySelect = Object.fromEntries(LEGACY_COLUMNS.map((column) => [column, true])) as Record<LegacyColumn, true>;

async function settingsRow(client: Prisma.TransactionClient | typeof prisma = prisma) {
  return client.systemSettings.findUnique({ where: { id: "global" }, select: { centralSecrets: true, ...legacySelect } });
}

export async function inventory(): Promise<Inventory> {
  const ring = keyRing();
  const currentKid = keyId(ring.current);
  const result: Inventory = {};
  const add = (place: string, state: keyof PlaceCount) => { (result[place] ??= blank())[state]++; };
  const judge = (place: string, purpose: Parameters<typeof open>[0], sealed: string | null | undefined, context: string) => {
    if (!sealed) return;
    const opened = open(purpose, sealed, context, ring);
    add(place, !opened.ok ? "unreadable" : opened.current && sealedKeyId(sealed) === currentKid ? "current" : "older");
  };

  const row = await settingsRow();
  const state = parseCentralState(row?.centralSecrets);
  for (const field of CENTRAL_FIELD_IDS) {
    const entry = state.entries[field];
    if (entry) { if (entry.cipher && !entry.removed) judge("centrala nycklar", "central", entry.cipher, field); }
    else { const legacy = legacyCipherIn(row ?? {}, field); if (legacy) judge("centrala nycklar (gammal plats)", "central", legacy, field); }
  }
  for (const key of await prisma.integrationKey.findMany({ where: { kind: "EXTERNAL", encryptedValue: { not: null } }, select: { id: true, organizationId: true, encryptedValue: true } })) {
    try {
      await openCompanyKey(key.organizationId, key.id, key.encryptedValue!);
      add("företagens nycklar", companyKeyCurrent(key.encryptedValue) ? "current" : "older");
    } catch { add("företagens nycklar", "unreadable"); }
  }
  for (const dataKey of await prisma.organizationDataKey.findMany({ select: { organizationId: true, wrappedKey: true } }))
    judge("företagens datanycklar", "org-data-key", dataKey.wrappedKey, dataKey.organizationId);
  for (const user of await prisma.user.findMany({ where: { OR: [{ totpSecret: { not: null } }, { totpPendingSecret: { not: null } }] }, select: { id: true, totpSecret: true, totpPendingSecret: true } })) {
    judge("tvåstegskoder", "totp", user.totpSecret, user.id);
    judge("tvåstegskoder (ej bekräftade)", "totp", user.totpPendingSecret, user.id);
  }
  for (const person of await prisma.staffRegisterPerson.findMany({ select: { organizationId: true, idNumberSealed: true } }))
    judge("personalliggaren (personer)", "staff-register", person.idNumberSealed, person.organizationId);
  // Append-only: counted so the ring is known to still need the older secret, never resealed.
  for (const event of await prisma.staffRegisterEvent.findMany({ select: { organizationId: true, idNumberSealed: true } }))
    judge("personalliggaren (händelser, ändras aldrig)", "staff-register", event.idNumberSealed, event.organizationId);
  return result;
}

/** Whether anything that the reseal would touch cannot be opened (the reseal then refuses to start). */
export const blockers = (counts: Inventory) => Object.entries(counts).filter(([place, count]) => count.unreadable > 0 && !place.includes("ändras aldrig")).map(([place]) => place);

export type Snapshot = {
  version: 1;
  takenAt: string;
  settings: Partial<Record<LegacyColumn | "centralSecrets", unknown>>;
  integrationKeys: { id: string; encryptedValue: string | null }[];
  dataKeys: { id: string; organizationId: string; wrappedKey: string; retiredAt: string | null }[];
  users: { id: string; totpSecret: string | null; totpPendingSecret: string | null }[];
  staffPersons: { id: string; idNumberSealed: string; idNumberHash: string }[];
  aiMemories: { id: string; subject: string }[];
};

export async function snapshot(): Promise<Snapshot> {
  const row = await settingsRow();
  return {
    version: 1, takenAt: new Date().toISOString(),
    settings: { centralSecrets: row?.centralSecrets ?? {}, ...Object.fromEntries(LEGACY_COLUMNS.map((column) => [column, row?.[column] ?? {}])) },
    integrationKeys: await prisma.integrationKey.findMany({ where: { kind: "EXTERNAL" }, select: { id: true, encryptedValue: true } }),
    dataKeys: (await prisma.organizationDataKey.findMany({ select: { id: true, organizationId: true, wrappedKey: true, retiredAt: true } })).map((key) => ({ ...key, retiredAt: key.retiredAt?.toISOString() ?? null })),
    users: await prisma.user.findMany({ where: { OR: [{ totpSecret: { not: null } }, { totpPendingSecret: { not: null } }] }, select: { id: true, totpSecret: true, totpPendingSecret: true } }),
    staffPersons: await prisma.staffRegisterPerson.findMany({ select: { id: true, idNumberSealed: true, idNumberHash: true } }),
    aiMemories: await prisma.aiMemory.findMany({ where: { scope: "USER" }, select: { id: true, subject: true } }),
  };
}

/** The snapshot's fingerprint, written beside the backup file and checked before it is restored. */
export const snapshotDigest = (text: string) => createHash("sha256").update(text, "utf8").digest("hex");

// The same keyed hashes as lib/staff-register/server.ts and lib/ai/memory.ts, under a given secret.
const staffHash = (secret: string, organizationId: string, serialized: string) =>
  createHmac("sha256", `staff-register-hash:${secret}`).update(`${organizationId}:${serialized}`).digest("hex");
const pseudonym = (secret: string, organizationId: string, userId: string) =>
  createHmac("sha256", secret).update(`ai-memory-v1:${organizationId}:${userId}`).digest("hex").slice(0, 40);

export type ResealResult = Record<string, number>;

/**
 * Seals everything again with the current secret. The caller has taken and verified the backup (scripts/secrets/
 * reseal.ts does that before it calls this). Every new value is opened again and compared inside the transaction.
 */
export async function reseal(): Promise<ResealResult> {
  const ring = keyRing();
  const counts = await inventory();
  const blocked = blockers(counts);
  if (blocked.length) throw new Error(`Omförseglingen stoppades: värden som inte går att öppna i ${blocked.join(", ")}. Ingenting ändrades.`);
  const done: ResealResult = {};
  const count = (place: string) => { done[place] = (done[place] ?? 0) + 1; };
  const verify = (purpose: Parameters<typeof open>[0], sealed: string, context: string, plain: string) => {
    const again = open(purpose, sealed, context, { current: ring.current, previous: [] });
    if (!again.ok || again.value !== plain) throw new Error("Kontrollen av ett nytt värde misslyckades. Ingenting ändrades.");
  };

  await prisma.$transaction(async (tx) => {
    // Central keys: into SystemSettings.centralSecrets with the current secret; their old places are emptied.
    const row = await settingsRow(tx);
    const state = parseCentralState(row?.centralSecrets);
    const columns: Partial<Record<LegacyColumn, unknown>> = Object.fromEntries(LEGACY_COLUMNS.map((column) => [column, row?.[column] ?? {}]));
    const now = new Date().toISOString();
    for (const field of CENTRAL_FIELD_IDS) {
      const entry = state.entries[field];
      const legacy = legacyCipherIn(columns, field);
      if (!entry && legacy) {
        const opened = open("central", legacy, field, ring);
        if (!opened.ok) continue;
        const sealed = seal("central", opened.value, field, ring);
        verify("central", sealed, field, opened.value);
        state.entries[field] = { cipher: sealed, updatedAt: now, updatedBy: "Omförsegling", origin: "migrated" };
        count("centrala nycklar flyttade");
      } else if (entry?.cipher && !entry.removed && sealedKeyId(entry.cipher) !== keyId(ring.current)) {
        const opened = open("central", entry.cipher, field, ring);
        if (!opened.ok) continue;
        const sealed = seal("central", opened.value, field, ring);
        verify("central", sealed, field, opened.value);
        entry.cipher = sealed;
        count("centrala nycklar omförseglade");
      }
      // One source only: once the value is in the copy, its old place no longer holds it.
      if (state.entries[field] && legacy) { const column = legacyColumnOf(field); columns[column] = withoutLegacyCipher(columns[column], field); }
    }
    await tx.systemSettings.update({ where: { id: "global" }, data: { centralSecrets: state as unknown as Prisma.InputJsonValue, ...(columns as Record<string, Prisma.InputJsonValue>) } });

    // Each company's data key: rewrapped with the current secret.
    for (const dataKey of await tx.organizationDataKey.findMany({ select: { id: true, organizationId: true, wrappedKey: true } })) {
      if (sealedKeyId(dataKey.wrappedKey) === keyId(ring.current)) continue;
      const opened = open("org-data-key", dataKey.wrappedKey, dataKey.organizationId, ring);
      if (!opened.ok) throw new Error("En datanyckel kunde inte öppnas. Ingenting ändrades.");
      const sealed = seal("org-data-key", opened.value, dataKey.organizationId, ring);
      verify("org-data-key", sealed, dataKey.organizationId, opened.value);
      await tx.organizationDataKey.update({ where: { id: dataKey.id }, data: { wrappedKey: sealed } });
      count("datanycklar omslagna");
    }
    // Companies' keys still in the shared format: into the company's own data key, bound to company and key.
    for (const key of await tx.integrationKey.findMany({ where: { kind: "EXTERNAL", encryptedValue: { not: null } }, select: { id: true, organizationId: true, encryptedValue: true } })) {
      if (companyKeyCurrent(key.encryptedValue)) continue;
      const plain = await openCompanyKey(key.organizationId, key.id, key.encryptedValue!, tx);
      await activeDataKey(key.organizationId, tx);
      const sealed = await sealCompanyKey(key.organizationId, key.id, plain, tx);
      if (await openCompanyKey(key.organizationId, key.id, sealed, tx) !== plain) throw new Error("Kontrollen av en företagsnyckel misslyckades. Ingenting ändrades.");
      await tx.integrationKey.update({ where: { id: key.id }, data: { encryptedValue: sealed } });
      count("företagens nycklar");
    }
    // Two-factor secrets, bound to the person.
    for (const user of await tx.user.findMany({ where: { OR: [{ totpSecret: { not: null } }, { totpPendingSecret: { not: null } }] }, select: { id: true, totpSecret: true, totpPendingSecret: true } })) {
      const data: { totpSecret?: string; totpPendingSecret?: string } = {};
      for (const column of ["totpSecret", "totpPendingSecret"] as const) {
        const sealedNow = user[column];
        if (!sealedNow || sealedKeyId(sealedNow) === keyId(ring.current)) continue;
        const opened = open("totp", sealedNow, user.id, ring);
        if (!opened.ok) throw new Error("En tvåstegskod kunde inte öppnas. Ingenting ändrades.");
        const sealed = seal("totp", opened.value, user.id, ring);
        verify("totp", sealed, user.id, opened.value);
        data[column] = sealed;
      }
      if (Object.keys(data).length) { await tx.user.update({ where: { id: user.id }, data }); count("tvåstegskoder"); }
    }
    // The register's people (not its events): sealed and hashed with the current secret.
    for (const person of await tx.staffRegisterPerson.findMany({ select: { id: true, organizationId: true, idNumberSealed: true, idNumberHash: true } })) {
      if (sealedKeyId(person.idNumberSealed) === keyId(ring.current)) continue;
      const opened = open("staff-register", person.idNumberSealed, person.organizationId, ring);
      if (!opened.ok) throw new Error("Ett personnummer kunde inte öppnas. Ingenting ändrades.");
      const sealed = seal("staff-register", opened.value, person.organizationId, ring);
      verify("staff-register", sealed, person.organizationId, opened.value);
      await tx.staffRegisterPerson.update({ where: { id: person.id }, data: { idNumberSealed: sealed, idNumberHash: staffHash(ring.current, person.organizationId, opened.value) } });
      count("personalliggaren (personer)");
    }
    // Fakturor: a ROT buyer's identity number, only in the locked invoice's sealed column.
    for (const invoice of await tx.$queryRaw<{ id: string; organizationId: string; identitySealed: string }[]>`SELECT "id", "organizationId", "identitySealed" FROM "CustomerInvoice" WHERE "identitySealed" IS NOT NULL`) {
      if (sealedKeyId(invoice.identitySealed) === keyId(ring.current)) continue;
      const opened = open("invoice-identity", invoice.identitySealed, invoice.organizationId, ring);
      if (!opened.ok) throw new Error("Ett personnummer på en faktura kunde inte öppnas. Ingenting ändrades.");
      const sealed = seal("invoice-identity", opened.value, invoice.organizationId, ring);
      verify("invoice-identity", sealed, invoice.organizationId, opened.value);
      await tx.$executeRaw`UPDATE "CustomerInvoice" SET "identitySealed" = ${sealed} WHERE "id" = ${invoice.id}`;
      count("fakturor (personnummer)");
    }
    // Workflow AI's memory per person: the pseudonym under the current secret.
    const memories = await tx.aiMemory.findMany({ where: { scope: "USER" }, select: { id: true, organizationId: true, subject: true } });
    if (memories.length) {
      const members = await tx.organizationMember.findMany({ where: { organizationId: { in: [...new Set(memories.map((memory) => memory.organizationId))] } }, select: { organizationId: true, userId: true } });
      for (const memory of memories) {
        const member = members.find((candidate) => candidate.organizationId === memory.organizationId && [ring.current, ...ring.previous].some((secret) => pseudonym(secret, candidate.organizationId, candidate.userId) === memory.subject));
        if (!member) continue;
        const subject = pseudonym(ring.current, member.organizationId, member.userId);
        if (subject === memory.subject) continue;
        await tx.aiMemory.update({ where: { id: memory.id }, data: { subject } });
        count("AI-minnen");
      }
    }
  }, { timeout: 120_000 });
  clearCentralCache();
  return done;
}

const legacyColumnOf = (field: (typeof CENTRAL_FIELD_IDS)[number]): LegacyColumn => CENTRAL_FIELDS[field].legacy.column;

/**
 * Writes a snapshot back exactly (the way back). Data keys made since are kept: a company key saved in between still
 * opens, and the restored older values need none.
 */
export async function restore(saved: Snapshot) {
  if (saved.version !== 1) throw new Error("Okänd säkerhetskopia.");
  await prisma.$transaction(async (tx) => {
    await tx.systemSettings.update({ where: { id: "global" }, data: saved.settings as Record<string, Prisma.InputJsonValue> });
    for (const key of saved.integrationKeys) await tx.integrationKey.updateMany({ where: { id: key.id }, data: { encryptedValue: key.encryptedValue } });
    for (const key of saved.dataKeys) await tx.organizationDataKey.updateMany({ where: { id: key.id }, data: { wrappedKey: key.wrappedKey, retiredAt: key.retiredAt ? new Date(key.retiredAt) : null } });
    for (const user of saved.users) await tx.user.updateMany({ where: { id: user.id }, data: { totpSecret: user.totpSecret, totpPendingSecret: user.totpPendingSecret } });
    for (const person of saved.staffPersons) await tx.staffRegisterPerson.updateMany({ where: { id: person.id }, data: { idNumberSealed: person.idNumberSealed, idNumberHash: person.idNumberHash } });
    for (const memory of saved.aiMemories) await tx.aiMemory.updateMany({ where: { id: memory.id }, data: { subject: memory.subject } });
  }, { timeout: 120_000 });
  clearCentralCache();
}
