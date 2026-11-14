import { createHash } from "node:crypto";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { knownSignals, recordSignals } from "@/lib/machine/signal-store";
import { signalsOfReadings } from "@/lib/machine/signals";
import { runRules } from "@/lib/machine/rule-engine";
import { storeBatch } from "@/lib/machine/store";
import { feedRunHours } from "@/lib/machine/run-hours-store";
import { interpretRaw, profileDefinitionSchema, RAW_DEDUPE_MS, RAW_ID_HASH_PREFIX, RAW_SAMPLE_HOURS, RAW_SAMPLE_LIMIT, type RawReject } from "@/lib/machine/raw-profile";

/**
 * Integrationsmotorn E4: the database part of /api/ingest/v1/raw. The company and the source come from the key (the
 * caller). The body is read with the source's format profile and goes into the same signal catalogue as /events (one write
 * per call). Telemetry is never stored row by row (plan, "belastning"): only the signals' latest values; rule transitions
 * become events in E3. "Fånga prov" keeps at most 20 bodies for 24 hours, also without a profile, so a profile can be
 * written from what the device really sends.
 */
/** Fall c: the source and the whole body as it came. */
export const bodyHash = (sourceId: string, text: string) => createHash("sha256").update(`${sourceId}\n${text}`).digest("hex");

export type RawOutcome =
  | { ok: false; status: 400 | 409; error: RawReject | "invalid_json" | "no_profile" | "bad_profile" }
  | { ok: true; captured: boolean; duplicate: boolean; records: number; readings: number; newSignals: number; ignoredSignals: number;
    rejectedRecords: { index: number; reason: string }[]; rejectedReadings: { record: number; path: string; reason: string }[] };

const empty = { records: 0, readings: 0, newSignals: 0, ignoredSignals: 0, rejectedRecords: [], rejectedReadings: [] };

async function capture(principal: { sourceId: string; organizationId: string }, text: string, now: Date) {
  const since = new Date(now.getTime() - RAW_SAMPLE_HOURS * 3_600_000);
  const count = await prisma.machineRawSample.count({ where: { sourceId: principal.sourceId, organizationId: principal.organizationId, receivedAt: { gte: since } } });
  if (count >= RAW_SAMPLE_LIMIT) return false;
  await prisma.machineRawSample.create({ data: { organizationId: principal.organizationId, sourceId: principal.sourceId, receivedAt: now, body: text } });
  return true;
}

/** Fall c: true the first time a body is seen within 10 minutes (a resend inside the window is a duplicate). */
async function firstTime(principal: { sourceId: string; organizationId: string }, hash: string, now: Date) {
  const rows = await prisma.$queryRaw<{ hash: string }[]>`
    INSERT INTO "MachineRawDedupe" ("organizationId", "sourceId", "hash", "createdAt") VALUES (${principal.organizationId}, ${principal.sourceId}, ${hash}, ${now}::timestamp(3))
    ON CONFLICT ("sourceId", "hash") DO UPDATE SET "createdAt" = EXCLUDED."createdAt" WHERE "MachineRawDedupe"."createdAt" < ${new Date(now.getTime() - RAW_DEDUPE_MS)}::timestamp(3)
    RETURNING "hash"`;
  return rows.length > 0;
}

/** Fall a: a record's own id, kept for a week (system-cleanup.ts tells these rows by the prefix). */
export const recordIdHash = (sourceId: string, id: string) => `${RAW_ID_HASH_PREFIX}${createHash("sha256").update(`${sourceId}\n${id}`).digest("hex")}`;

/** Fall a: the ids seen for the first time; the rest are resends, whatever the time. */
async function newRecordIds(principal: { sourceId: string; organizationId: string }, ids: readonly string[], now: Date) {
  if (!ids.length) return new Set<string>();
  const byHash = new Map(ids.map((id) => [recordIdHash(principal.sourceId, id), id]));
  const rows = await prisma.$queryRaw<{ hash: string }[]>`
    INSERT INTO "MachineRawDedupe" ("organizationId", "sourceId", "hash", "createdAt")
    VALUES ${Prisma.join([...byHash.keys()].map((hash) => Prisma.sql`(${principal.organizationId}, ${principal.sourceId}, ${hash}, ${now}::timestamp(3))`))}
    ON CONFLICT ("sourceId", "hash") DO NOTHING
    RETURNING "hash"`;
  return new Set(rows.flatMap((row) => byHash.get(row.hash) ?? []));
}

export async function receiveRaw(principal: { sourceId: string; organizationId: string }, text: string, now = new Date()): Promise<RawOutcome> {
  const source = await prisma.machineSource.findFirst({ where: { id: principal.sourceId, organizationId: principal.organizationId }, select: { captureUntil: true, profile: { select: { definition: true } } } });
  if (!source) return { ok: false, status: 409, error: "no_profile" };
  const captured = source.captureUntil && source.captureUntil > now ? await capture(principal, text, now) : false;
  let body: unknown;
  try { body = JSON.parse(text); } catch { return { ok: false, status: 400, error: "invalid_json" }; }
  if (!source.profile) return captured ? { ok: true, captured, duplicate: false, ...empty } : { ok: false, status: 409, error: "no_profile" };
  const profile = profileDefinitionSchema.safeParse(source.profile.definition);
  if (!profile.success) return { ok: false, status: 409, error: "bad_profile" };
  const read = interpretRaw(body, profile.data, now);
  if (!read.ok) return { ok: false, status: 400, error: read.error };
  const answer = { records: read.records, rejectedRecords: read.rejectedRecords, rejectedReadings: read.rejectedReadings };
  // A profile with an id (fall a) knows its resends by the id; without one, a body with no time of its own by the whole body (fall c).
  const fresh = profile.data.id ? await newRecordIds(principal, read.recordIds, now) : null;
  const duplicate = fresh ? read.recordIds.length > 0 && fresh.size === 0 : read.usesReceivedTime && !(await firstTime(principal, bodyHash(principal.sourceId, text), now));
  if (duplicate) return { ok: true, captured, duplicate: true, ...answer, readings: 0, newSignals: 0, ignoredSignals: 0 };
  const readings = fresh ? read.readings.filter((reading) => reading.recordId !== undefined && fresh.has(reading.recordId)) : read.readings;
  const seen = signalsOfReadings(readings);
  const known = await knownSignals(principal, [...seen.keys()]);
  const catalogue = await recordSignals(principal, seen, known, now);
  const newSignals = [...seen.keys()].filter((key) => !known.has(key) && catalogue.signals.has(key)).length;
  const ignored = catalogue.ignored + read.overLimit;
  await prisma.machineSource.update({ where: { id: principal.sourceId }, data: { lastEventAt: now, ...(ignored ? { ignoredSignals: { increment: ignored } } : {}) } });
  // Drifttimmar: a signal marked for it moves its part's hours. E3: the readings against the signals' rules; a transition becomes an event in the ordinary chain.
  await feedRunHours(principal, readings, known, now);
  await runRules(principal, readings, catalogue.signals, now, storeBatch);
  return { ok: true, captured, duplicate: false, ...answer, readings: readings.length, newSignals, ignoredSignals: ignored };
}
