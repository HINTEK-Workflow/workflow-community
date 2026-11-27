import { randomBytes } from "node:crypto";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { admitNewSignals, shouldWriteValue, type CatalogueSignal, type SeenSignal } from "@/lib/machine/signals";

/**
 * Integrationsmotorn E2: the database part of the signal catalogue. `knownSignals` is read before the events are saved (an
 * active signal decides the event's object); `recordSignals` runs once per call for the events that were accepted – one
 * INSERT … ON CONFLICT DO UPDATE for the whole call – so a duplicate never moves "last seen" or the latest value. New signals
 * over the caps are counted on the source, not stored.
 */
export type KnownSignal = CatalogueSignal & { key: string; kind: string; deadband: number | null; lastValue: unknown; lastValueAt: Date | null; runHoursFeed: boolean };

export async function knownSignals(principal: { sourceId: string; organizationId: string }, keys: string[]): Promise<Map<string, KnownSignal>> {
  if (!keys.length) return new Map();
  const rows = await prisma.machineSignal.findMany({
    where: { sourceId: principal.sourceId, organizationId: principal.organizationId, key: { in: [...new Set(keys)] } },
    select: { id: true, key: true, kind: true, status: true, machinePartId: true, deadband: true, lastValue: true, lastValueAt: true, runHoursFeed: true },
  });
  return new Map(rows.map(({ machinePartId, ...row }) => [row.key, { ...row, partId: machinePartId }]));
}

/**
 * Records what the accepted events (signalsOfEvents) or the raw readings (signalsOfReadings, E4) said. Returns the signals by
 * key (known and newly made) and how many were over the cap. A new signal gets the profile's name, unit and dead band; a
 * known one keeps what the admin set.
 */
export async function recordSignals(principal: { sourceId: string; organizationId: string }, seen: Map<string, SeenSignal>, known: Map<string, KnownSignal>, now: Date) {
  const result = new Map<string, CatalogueSignal>([...known].map(([key, signal]) => [key, { id: signal.id, status: signal.status, partId: signal.partId }]));
  if (!seen.size) return { signals: result, ignored: 0 };
  const fresh = [...seen.values()].filter((signal) => !known.has(signal.key));
  let ignored = 0;
  let admitted = fresh;
  if (fresh.length) {
    const [source, company] = await Promise.all([
      prisma.machineSignal.count({ where: { sourceId: principal.sourceId, organizationId: principal.organizationId } }),
      prisma.machineSignal.count({ where: { organizationId: principal.organizationId } }),
    ]);
    ({ admitted, ignored } = admitNewSignals(fresh, { source, company }));
  }
  const rows = [...[...seen.values()].filter((signal) => known.has(signal.key)), ...admitted].map((signal) => {
    const before = known.get(signal.key);
    const write = shouldWriteValue({ kind: before?.kind ?? signal.kind, deadband: before?.deadband ?? null, previous: before ? { value: before.lastValue, at: before.lastValueAt } : null, next: { value: signal.value, at: signal.valueAt } });
    // A value not to be written goes in as NULL with no time, and the update keeps the stored one.
    return Prisma.sql`(${cuidLike()}, ${principal.organizationId}, ${principal.sourceId}, ${signal.key}, ${signal.kind}, ${signal.name ?? ""}, ${signal.unit ?? ""}, ${signal.deadband ?? null}::double precision, ${signal.seenAt}::timestamp(3), ${signal.seenAt}::timestamp(3), ${write && signal.value !== null ? JSON.stringify(signal.value) : null}::jsonb, ${write ? signal.valueAt : null}::timestamp(3), ${now}::timestamp(3))`;
  });
  if (rows.length) {
    const saved = await prisma.$queryRaw<{ id: string; key: string; status: string; machinePartId: string | null }[]>`
      INSERT INTO "MachineSignal" ("id", "organizationId", "sourceId", "key", "kind", "name", "unit", "deadband", "firstSeenAt", "lastSeenAt", "lastValue", "lastValueAt", "updatedAt")
      VALUES ${Prisma.join(rows)}
      ON CONFLICT ("sourceId", "key") DO UPDATE SET
        "lastSeenAt" = GREATEST("MachineSignal"."lastSeenAt", EXCLUDED."lastSeenAt"),
        "lastValue" = CASE WHEN EXCLUDED."lastValueAt" IS NOT NULL AND EXCLUDED."lastValueAt" > COALESCE("MachineSignal"."lastValueAt", '-infinity'::timestamp) THEN EXCLUDED."lastValue" ELSE "MachineSignal"."lastValue" END,
        "lastValueAt" = CASE WHEN EXCLUDED."lastValueAt" IS NOT NULL AND EXCLUDED."lastValueAt" > COALESCE("MachineSignal"."lastValueAt", '-infinity'::timestamp) THEN EXCLUDED."lastValueAt" ELSE "MachineSignal"."lastValueAt" END,
        "updatedAt" = EXCLUDED."updatedAt"
      RETURNING "id", "key", "status", "machinePartId"`;
    for (const row of saved) result.set(row.key, { id: row.id, status: row.status, partId: row.machinePartId });
  }
  return { signals: result, ignored };
}

/** A collision-free id in the same alphabet as the others (letters and digits), for a row the database may already have. */
function cuidLike() {
  const random = randomBytes(16);
  return `sg${Date.now().toString(36)}${[...random].map((byte) => (byte % 36).toString(36)).join("")}`;
}
