import { createHmac } from "node:crypto";
import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { env } from "@/lib/env";
import { keyRing, ringHashSecrets, noteUnreadable, clearUnreadable } from "@/lib/security/key-ring";
import { open, seal } from "@/lib/security/sealing";
import { recordSecurityEvent, type SecurityEventType } from "@/lib/security/security-log";
import { publicInstance } from "@/lib/instance";
import { CENTRAL_FIELDS, LEGACY_COLUMNS, legacyCipherIn, visibleCentralFields, type CentralField, type LegacyColumn } from "@/lib/secrets/central-fields";
import { centralStateValue, entryUsable, parseCentralState, retire, unreadableAlarmedAt, type CentralEntry, type CentralState } from "@/lib/secrets/central-state";
import type { CentralKeyCopy } from "@/lib/extensions/types";

/**
 * Centrala nycklar på servern (2026-10-25): where every central key is read, saved and removed. The rules are in
 * lib/secrets/central-state.ts; this module adds the database, the key ring and the logs.
 *
 * Workflow's sealed copy is the only source the core knows: reading never talks to anything else and a save is never
 * refused because of something outside. Workflow's installation keeps a backup copy in a key vault (ee/secrets/, since
 * 2026-11-10 outside the core): with CENTRAL_SECRET_STORE=vault a save is handed to it afterwards. A value never leaves this
 * module except to the server code that uses it and to that copy.
 */
const CACHE_MS = 10_000;
type Snapshot = { state: CentralState; legacy: Partial<Record<LegacyColumn, unknown>>; at: number };
let snapshot: Snapshot | null = null;

export class CentralStoreError extends Error {
  constructor(message: string, readonly status = 409) { super(message); this.name = "CentralStoreError"; }
}

export type CentralActor = { userId: string; organizationId: string; label: string };

let modeOverride: "database" | "vault" | null = null;

/** "vault" only when the server is set up for it (and has the commercial part); Community and Local always have "database". */
export const centralStoreMode = () => modeOverride ?? env.CENTRAL_SECRET_STORE;

/** Tests only (never in production): the mode, so a backup copy can be tried without the server's settings. */
export function setCentralStoreModeForTests(mode: "database" | "vault" | null) {
  if (env.NODE_ENV === "production") throw new Error("Bara i tester.");
  modeOverride = mode;
  clearCentralCache();
}

// Loaded on first use: the scheduled jobs (tsx) read central keys without loading the ee/ door at start.
const extensions = async () => (await import("@/lib/extensions/server")).serverExtensions;

/** The backup copy a save is handed to, or null (database mode, or an installation without one). */
async function centralKeyCopy(): Promise<CentralKeyCopy | null> {
  if (centralStoreMode() !== "vault") return null;
  const ext = await extensions();
  return ext.centralKeys ? (await ext.centralKeys()).copy : null;
}

const legacySelect = Object.fromEntries(LEGACY_COLUMNS.map((column) => [column, true])) as Record<LegacyColumn, true>;

async function load(): Promise<Snapshot> {
  if (snapshot && Date.now() - snapshot.at < CACHE_MS) return snapshot;
  const row = await prisma.systemSettings.findUnique({ where: { id: "global" }, select: { centralSecrets: true, ...legacySelect } });
  const legacy: Snapshot["legacy"] = {};
  for (const column of LEGACY_COLUMNS) legacy[column] = row?.[column];
  snapshot = { state: parseCentralState(row?.centralSecrets), legacy, at: Date.now() };
  return snapshot;
}

export const clearCentralCache = () => { snapshot = null; };

const openEntry = (field: CentralField, cipher: string | undefined) => {
  const result = open("central", cipher, field, keyRing());
  if (result.ok) { clearUnreadable(`central:${field}`); return result.value; }
  if (result.reason !== "empty") noteUnreadable(`central:${field}`);
  return "";
};

/** A field's value before 2026-10-25 (its old place, older sealings), until it is moved. */
const openLegacy = (field: CentralField, legacy: Snapshot["legacy"]) => openEntry(field, legacyCipherIn(legacy, field));

/** The value Workflow holds for the field now (its copy, or its old place when it has no entry yet), "" when none. */
const localValue = (field: CentralField, entry: CentralEntry | undefined, legacy: Snapshot["legacy"]) =>
  !entry ? openLegacy(field, legacy) : entryUsable(entry) ? openEntry(field, entry.cipher) : "";

/**
 * The value that applies now, "" when none. Removed in Workflow: "" at once. Not yet in the copy: the old place, as
 * before 2026-10-25. A backup copy never decides this (2026-10-26: no time limit).
 */
export async function centralSecret(field: CentralField): Promise<string> {
  const { state, legacy } = await load();
  const entry = state.entries[field];
  if (!entry) return openLegacy(field, legacy);
  return entryUsable(entry) ? openEntry(field, entry.cipher) : "";
}

/** Several values at once (one read of the copy). */
export async function centralSecrets<F extends CentralField>(fields: readonly F[]): Promise<Record<F, string>> {
  const values = await Promise.all(fields.map((field) => centralSecret(field)));
  return Object.fromEntries(fields.map((field, index) => [field, values[index]])) as Record<F, string>;
}

export type CentralFieldInfo = {
  field: CentralField; label: string;
  /** A value applies now. */
  present: boolean;
  /** The bin was used in Workflow (also nothing from the server's environment). */
  removed: boolean;
  /** "vault" = here and copied to the backup copy; "local" = only here; "legacy" = still in its old place. */
  storage: "vault" | "local" | "legacy" | null;
  unreadable: boolean;
  origin: CentralEntry["origin"] | null;
  updatedAt: string | null; updatedBy: string | null; syncedAt: string | null;
  pendingRemoval: boolean;
  /** Saved here, but the copy has not reached the backup copy yet (retried automatically). */
  copyPending: boolean;
};

/** What the status page may say about a field: never the value. */
export async function centralFieldInfo(field: CentralField): Promise<CentralFieldInfo> {
  const { state, legacy } = await load();
  const entry = state.entries[field];
  const base = { field, label: CENTRAL_FIELDS[field].label };
  if (!entry) {
    const cipher = legacyCipherIn(legacy, field);
    const value = openLegacy(field, legacy);
    return { ...base, present: Boolean(value), removed: false, storage: cipher ? "legacy" : null, unreadable: Boolean(cipher) && !value,
      origin: null, updatedAt: null, updatedBy: null, syncedAt: null, pendingRemoval: false, copyPending: false };
  }
  const value = entryUsable(entry) ? openEntry(field, entry.cipher) : "";
  return {
    ...base, present: Boolean(value), removed: Boolean(entry.removed),
    storage: entry.removed || !entry.cipher ? null : entry.vault && !entry.copyPending ? "vault" : "local",
    unreadable: Boolean(entry.cipher) && !entry.removed && !value,
    origin: entry.origin ?? null, updatedAt: entry.updatedAt ?? null, updatedBy: entry.updatedBy ?? null,
    syncedAt: entry.vault?.syncedAt ?? null, pendingRemoval: Boolean(entry.pendingRemoval), copyPending: Boolean(entry.copyPending),
  };
}

/** Whether the bin was used for the field in Workflow (the value then does not fall back to the environment). */
export async function centralRemoved(field: CentralField) {
  return Boolean((await load()).state.entries[field]?.removed);
}

/** Reads and changes the state under a row lock, so two saves never overwrite each other. */
async function updateState<T>(change: (state: CentralState) => T | Promise<T>): Promise<T> {
  await prisma.systemSettings.upsert({ where: { id: "global" }, update: {}, create: { id: "global" } });
  const result = await prisma.$transaction(async (tx) => {
    const rows = await tx.$queryRaw<{ centralSecrets: unknown }[]>`SELECT "centralSecrets" FROM "SystemSettings" WHERE "id" = 'global' FOR UPDATE`;
    const state = parseCentralState(rows[0]?.centralSecrets);
    const value = await change(state);
    await tx.systemSettings.update({ where: { id: "global" }, data: { centralSecrets: centralStateValue(state) as unknown as Prisma.InputJsonValue } });
    return value;
  });
  clearCentralCache();
  return result;
}

const nowIso = () => new Date().toISOString();
const sealed = (field: CentralField, value: string) => seal("central", value, field, keyRing());

// Keyed fingerprints of values that no longer apply: made with the ring's current secret, recognised with any secret in
// the ring (so a rotation keeps them). Reveal nothing about the value without the server's key.
const fingerprintWith = (secret: string, field: CentralField, value: string) =>
  createHmac("sha256", secret).update(`central-retired\n${field}\n${value}`).digest("base64url").slice(0, 32);
const fingerprint = (field: CentralField, value: string) => (value ? fingerprintWith(keyRing().current, field, value) : null);
const isRetired = (entry: CentralEntry | undefined, field: CentralField, value: string) =>
  Boolean(entry?.retired?.length) && ringHashSecrets().some((secret) => entry!.retired!.includes(fingerprintWith(secret, field, value)));

/** The platform's security log (field name only); the route that saved writes its own administration history. */
async function logEvent(type: SecurityEventType, field: CentralField | null, actor?: CentralActor) {
  await recordSecurityEvent({ type, actorId: actor?.userId ?? null, userId: actor?.userId ?? null, platform: true, detail: field ?? "" });
}

export type SaveResult = {
  /** "none" = no backup copy on this installation; "done" = copied there; "pending" = saved here, copy retried later. */
  copy: "none" | "done" | "pending";
  message?: string;
};

/**
 * Saves (a value) or removes (null) a central key. Workflow's copy first, always – a save is never refused because of a
 * backup copy (2026-10-26). With one (Workflow's key vault) the value is then handed to it, which copies it or marks it as owed.
 * A removal applies here at once and is carried out in the backup copy by it.
 */
export async function saveCentralSecret(field: CentralField, value: string | null, actor: CentralActor): Promise<SaveResult> {
  // An empty value is a removal, never a sealed "".
  const plain = value?.trim() || null;
  const copy = await centralKeyCopy();
  const at = nowIso();
  const by = actor.label.slice(0, 200);

  if (plain === null) {
    // The link is read under the row lock, so a removal is always carried out in the backup copy too.
    const link = await updateState((state) => {
      const known = state.entries[field];
      const old = entryUsable(known) ? openEntry(field, known!.cipher) : "";
      const linked = known?.vault ?? (known?.pendingRemoval ? { id: known.pendingRemoval.id, revision: known.pendingRemoval.revision } : undefined);
      state.entries[field] = { removed: true, updatedAt: at, updatedBy: by, origin: "workflow", retired: retire(known ?? {}, fingerprint(field, old)),
        ...(linked ? { pendingRemoval: { id: linked.id, revision: linked.revision, at } } : {}) };
      return linked;
    });
    await logEvent("central_key_removed", field, actor);
    if (!copy || !link) return { copy: "none" };
    return copy.removed(field, link.id);
  }

  await updateState((state) => {
    const known = state.entries[field];
    const old = entryUsable(known) ? openEntry(field, known!.cipher) : "";
    // Kept as the link: the value is written over the same secret in the backup copy (also one whose removal is still owed).
    const linked = known?.vault ?? (known?.pendingRemoval ? { id: known.pendingRemoval.id, revision: known.pendingRemoval.revision, syncedAt: known.pendingRemoval.at } : undefined);
    state.entries[field] = { cipher: sealed(field, plain), updatedAt: at, updatedBy: by, origin: "workflow",
      retired: old && old !== plain ? retire(known ?? {}, fingerprint(field, old)) : known?.retired,
      ...(linked ? { vault: linked } : {}), ...(copy ? { copyPending: at } : {}) };
  });
  await logEvent("central_key_saved", field, actor);
  if (!copy) return { copy: "none" };
  return copy.saved(field, at);
}

/** Central lagring's own view (the core): how the central keys are kept here. Names and times only, never a value. */
export type CentralStoreStatus = { mode: "database" | "vault"; fields: CentralFieldInfo[] };

export async function centralStoreStatus(): Promise<CentralStoreStatus> {
  return { mode: centralStoreMode(), fields: await Promise.all(visibleCentralFields(publicInstance().features.billing).map((field) => centralFieldInfo(field))) };
}

/** The mark of the daily alarm about sealed values that cannot be opened (secrets:sync, every installation). */
export async function sealedCheckAlarmedAt() {
  clearCentralCache();
  return unreadableAlarmedAt((await load()).state);
}
export async function markSealedCheckAlarm(at: string) {
  await updateState((state) => { state.parts.sealedCheck = { ...(state.parts.sealedCheck as object | undefined), unreadableAlarmedAt: at }; });
}

/**
 * The store's inner parts for Workflow's key vault copy (ee/secrets/central-vault-store.ts): the cached state, the update under
 * the row lock, opening and sealing a value, the fingerprints of retired values and the platform log. Server code only.
 */
export const centralStoreInternals = {
  load, updateState, openEntry, localValue, sealed, fingerprint, isRetired, logEvent, nowIso,
};
