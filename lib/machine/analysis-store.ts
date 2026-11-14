import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { analyse, HISTORY_DAYS, parseTuning, SUGGESTION_KINDS, tunedAfterDismiss, type Finding, type SuggestionKind } from "@/lib/machine/analysis";
import { analysisGroups } from "@/lib/machine/analysis-scope";

/** Analysis is run at most once an hour per source when someone opens the page, and once a night for every source. */
const MIN_INTERVAL_MS = 3_600_000;
const EVENT_LIMIT = 5000;
const record = (value: unknown) => (value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null);

/**
 * Reads a source's last 14 days, runs the rules and saves what is new. Returns how many new suggestions were made.
 * Integrationsmotorn E2: the rules run per scope (the object or active signal the events concern, lib/machine/analysis-scope.ts),
 * so a router for a whole hall is not one machine; "Maskinen har tystnat" is per active signal.
 */
export async function analyseSource(source: { id: string; organizationId: string; analysisTuning: unknown; lastAnalysedAt: Date | null }, now = new Date(), force = false) {
  if (!force && source.lastAnalysedAt && now.getTime() - source.lastAnalysedAt.getTime() < MIN_INTERVAL_MS) return 0;
  const [events, signals] = await Promise.all([
    prisma.machineEvent.findMany({
      where: { sourceId: source.id, organizationId: source.organizationId, occurredAt: { gte: new Date(now.getTime() - HISTORY_DAYS * 86_400_000) } },
      orderBy: { occurredAt: "desc" }, take: EVENT_LIMIT, select: { occurredAt: true, type: true, code: true, severity: true, state: true, machinePartId: true, signalId: true, values: true },
    }),
    prisma.machineSignal.findMany({ where: { sourceId: source.id, organizationId: source.organizationId, status: "active" }, select: { id: true, key: true, name: true, machinePartId: true } }),
  ]);
  const groups = analysisGroups(source.id, events.map((event) => ({ ...event, values: record(event.values) })), signals);
  const findings: (Finding & { scopeKey: string })[] = groups.flatMap((group) =>
    analyse(group.events, now, source.analysisTuning, { kinds: group.kinds, silent: group.silent }).map((finding) => ({ ...finding, scopeKey: group.scopeKey })));
  let made = 0;
  for (const finding of findings) {
    // The unique (sourceId, scopeKey, dedupeKey): an observation already made, also one the admin dismissed, is not made again.
    const result = await prisma.machineSuggestion.createMany({
      data: [{ organizationId: source.organizationId, sourceId: source.id, scopeKey: finding.scopeKey, kind: finding.kind, dedupeKey: finding.dedupeKey, title: finding.title, basis: finding.basis, stats: finding.stats as Prisma.InputJsonObject }],
      skipDuplicates: true,
    });
    made += result.count;
  }
  await prisma.machineSource.update({ where: { id: source.id }, data: { lastAnalysedAt: now } });
  return made;
}

/** The nightly pass over every active source of every cloud company. Counts only. */
export async function analyseAllSources(now = new Date()) {
  const sources = await prisma.machineSource.findMany({ where: { isActive: true, organization: { isActive: true } }, select: { id: true, organizationId: true, analysisTuning: true, lastAnalysedAt: true } });
  let made = 0;
  // Forced: a source someone looked at in the evening has an hour's mark on it, and the night's pass must still cover it.
  for (const source of sources) made += await analyseSource(source, now, true);
  return { sources: sources.length, suggestions: made };
}

/** The admin's answer. Dismissing raises that kind's threshold for this source one step (the machine "learns" what is normal for it). */
export async function decideSuggestion(organizationId: string, id: string, action: "dismiss" | "acknowledge", actorId: string, now = new Date()) {
  const row = await prisma.machineSuggestion.findFirst({ where: { id, organizationId, status: "open" }, select: { id: true, sourceId: true, kind: true } });
  if (!row) return false;
  const claimed = await prisma.machineSuggestion.updateMany({ where: { id: row.id, status: "open" }, data: { status: action === "dismiss" ? "dismissed" : "acknowledged", decidedAt: now, decidedById: actorId } });
  if (!claimed.count) return false;
  if (action === "dismiss" && (SUGGESTION_KINDS as readonly string[]).includes(row.kind)) {
    const source = await prisma.machineSource.findFirst({ where: { id: row.sourceId, organizationId }, select: { analysisTuning: true } });
    if (source) await prisma.machineSource.update({ where: { id: row.sourceId }, data: { analysisTuning: tunedAfterDismiss(parseTuning(source.analysisTuning), row.kind as SuggestionKind) } });
  }
  return true;
}
