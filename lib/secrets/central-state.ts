import { z } from "zod";
import { isCentralField, type CentralField } from "@/lib/secrets/central-fields";

/**
 * Den lokala förseglade kopian av de centrala nycklarna (2026-10-25). SystemSettings.centralSecrets = { entries, … }.
 * Pure: no database, no clock of its own.
 *
 * - Workflow's sealed copy is the primary source and always applies.
 * - entries[field]: the sealed value (sealing purpose "central", context = the field), or `removed` when the bin was used.
 *   `vault`, `pendingRemoval` and `copyPending` link an entry to a backup copy outside Workflow; only an installation with
 *   such a copy writes them (Workflow's key vault, ee/secrets/central-vault-store.ts), the core keeps them as they are.
 * - Every other part of the object (the key vault's state, the emergency copy, a sync run) belongs to that extension: the
 *   core keeps it untouched in `parts` and writes it back as it was read.
 * - An old key never comes back: every value replaced or removed here leaves a keyed fingerprint (`retired`).
 */
/** How many earlier values per key are remembered as never to be restored. */
export const RETIRED_LIMIT = 20;

const stamp = z.string().max(40);
const entrySchema = z.object({
  cipher: z.string().max(8000).optional(),
  removed: z.boolean().optional(),
  updatedAt: stamp.optional(),
  updatedBy: z.string().max(200).optional(),
  /** Where the value last came from: saved in Workflow, restored from a backup copy, or moved from its old place. */
  origin: z.enum(["workflow", "vault", "migrated"]).optional(),
  vault: z.object({ id: z.string().max(100), revision: z.string().max(60), syncedAt: stamp }).optional(),
  pendingRemoval: z.object({ id: z.string().max(100), revision: z.string().max(60), at: stamp }).optional(),
  /** The save (its updatedAt) whose copy has not reached the backup copy yet. */
  copyPending: stamp.optional(),
  /** Keyed fingerprints of values replaced or removed here (never a value): such a value is never restored. */
  retired: z.array(z.string().max(80)).max(RETIRED_LIMIT).optional(),
});
export type CentralEntry = z.infer<typeof entrySchema>;

const centralStateSchema = z.object({ entries: z.record(z.string(), entrySchema).default({}) }).passthrough();

export type CentralState = {
  entries: Partial<Record<CentralField, CentralEntry>>;
  /** The parts an extension keeps beside the entries, as stored (never read by the core). */
  parts: Record<string, unknown>;
};

export function parseCentralState(value: unknown): CentralState {
  const parsed = centralStateSchema.safeParse(value ?? {});
  if (!parsed.success) return { entries: {}, parts: {} };
  const { entries: stored, ...parts } = parsed.data;
  const entries: CentralState["entries"] = {};
  for (const [field, entry] of Object.entries(stored)) if (isCentralField(field)) entries[field] = entry;
  return { entries, parts };
}

/** What is stored: the extension's parts as they were, and the entries. */
export function centralStateValue(state: CentralState): Record<string, unknown> {
  return { ...state.parts, entries: state.entries };
}

/** Whether the entry's value may be used now: there is one and it was not removed. A backup copy never decides this. */
export function entryUsable(entry: CentralEntry | undefined) {
  return Boolean(entry?.cipher) && !entry?.removed;
}

/** Adds a fingerprint of a value that no longer applies (newest last, at most RETIRED_LIMIT). */
export function retire(entry: Pick<CentralEntry, "retired">, fingerprint: string | null) {
  if (!fingerprint) return entry.retired;
  return [...(entry.retired ?? []).filter((known) => known !== fingerprint), fingerprint].slice(-RETIRED_LIMIT);
}

/** The last alarm about sealed values that cannot be opened (the core's own mark; older states kept it in the vault part). */
export function unreadableAlarmedAt(state: CentralState): string | null {
  const own = (state.parts.sealedCheck as { unreadableAlarmedAt?: unknown } | undefined)?.unreadableAlarmedAt;
  const older = (state.parts.vault as { unreadableAlarmedAt?: unknown } | undefined)?.unreadableAlarmedAt;
  const value = typeof own === "string" ? own : typeof older === "string" ? older : null;
  return value && value.length <= 40 ? value : null;
}

/**
 * Gäller till (2026-11-14, lib/secrets/key-expiry.ts): the core's own part `keyExpiry` beside the entries – one
 * optional last day per key card (not a secret) and the mark of the latest expiry alarm per card. Kept as a part, not in an
 * entry, so a new value saved, removed or restored never takes the date with it, and a card without a central key (the
 * server's own secrets) has one too.
 */
const expiryStateSchema = z.object({
  dates: z.record(z.string().max(40), z.object({ on: z.string().regex(/^\d{4}-\d{2}-\d{2}$/), updatedAt: stamp.optional(), updatedBy: z.string().max(200).optional() })).default({}),
  alarmed: z.record(z.string().max(40), z.string().max(60)).default({}),
});
export type KeyExpiryState = z.infer<typeof expiryStateSchema>;

export function keyExpiryState(state: CentralState): KeyExpiryState {
  return expiryStateSchema.catch({ dates: {}, alarmed: {} }).parse(state.parts.keyExpiry ?? {});
}
