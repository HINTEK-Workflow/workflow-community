import { prisma } from "@/lib/db";
import { swedishDayKey } from "@/lib/swedish-time";
import { retentionCutoffDay } from "./settings-model";
import type { CounterRow } from "./buffer";

/** Adds counts to the day's counters in one statement; each row is an atomic "count = count + n". */
export async function writeCounters(input: CounterRow[]) {
  if (!input.length) return;
  // One row per counter: the same counter twice in one statement would be refused by the database.
  const merged = new Map<string, CounterRow>();
  for (const row of input) {
    const id = `${row.day}|${row.kind}|${row.key}`;
    const current = merged.get(id);
    if (current) current.count += row.count; else merged.set(id, { ...row });
  }
  const rows = [...merged.values()];
  const days = rows.map((row) => row.day);
  const kinds = rows.map((row) => row.kind);
  const keys = rows.map((row) => row.key);
  const counts = rows.map((row) => row.count);
  await prisma.$executeRaw`
    INSERT INTO "AnalyticsCounter" ("day", "kind", "key", "count")
    SELECT * FROM unnest(${days}::text[], ${kinds}::text[], ${keys}::text[], ${counts}::int[])
    ON CONFLICT ("day", "kind", "key") DO UPDATE SET "count" = "AnalyticsCounter"."count" + EXCLUDED."count"`;
}

/** Every counter from a day to a day (both included), oldest first. */
export async function readCounters(from: string, to: string) {
  return prisma.analyticsCounter.findMany({ where: { day: { gte: from, lte: to } }, orderBy: [{ day: "asc" }, { kind: "asc" }, { key: "asc" }], take: 200_000 });
}

/** The day of the oldest counter, for the page's "first count". */
export async function firstCounterDay() {
  const row = await prisma.analyticsCounter.findFirst({ orderBy: { day: "asc" }, select: { day: true } });
  return row?.day ?? null;
}

/** "Nollställ": removes every counter. Returns how many rows went. */
export async function resetCounters() {
  return (await prisma.analyticsCounter.deleteMany({})).count;
}

/** The nightly cleanup: removes counters older than the retention time. Returns how many rows went. */
export async function pruneCounters(now: Date, months: number, options: { dryRun?: boolean } = {}) {
  const cutoff = retentionCutoffDay(swedishDayKey(now), months);
  // Torrkörning (T5, 2026-10-24): counted, not deleted.
  if (options.dryRun) return prisma.analyticsCounter.count({ where: { day: { lt: cutoff } } });
  return (await prisma.analyticsCounter.deleteMany({ where: { day: { lt: cutoff } } })).count;
}
