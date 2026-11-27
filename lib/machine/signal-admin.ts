import { z } from "zod";
import { prisma } from "@/lib/db";
import { ApiError } from "@/lib/kfid/server";
import { parseScopeKey } from "@/lib/machine/alarm-scope";
import { cleanSignalText, MAX_SIGNAL_NAME_LENGTH, MAX_SIGNAL_UNIT_LENGTH, MAX_SIGNALS_PER_COMPANY, MAX_SIGNALS_PER_SOURCE, SIGNAL_STATUSES, signalLabel } from "@/lib/machine/signals";
import { runHoursFeedProblem } from "@/lib/machine/run-hours";
import { partLabels } from "@/lib/maintenance/part-labels";
import { listRules } from "@/lib/machine/rule-admin";

/**
 * Integrationsmotorn E2: the admin's part of the signal catalogue – the source's signal page under Kopplingar → Maskiner. The
 * caller (lib/api-handlers/machine-sources.ts) has checked the session, the admin, Cloud and, for a change, the Origin. Every
 * read and write is bound to the caller's company here as well.
 */
export const updateSignalCommand = z.object({
  action: z.literal("update_signal"),
  signalId: z.string().min(1).max(64),
  name: z.string().max(200),
  unit: z.string().max(100),
  status: z.enum(SIGNAL_STATUSES),
  /** Underhåll (2026-10-30): the signal's own machine part (a part in the maintenance tree, never a customer's place). */
  partId: z.string().min(1).max(100).nullable(),
  deadband: z.number().finite().min(0, "Dödbandet kan inte vara negativt.").max(1e9, "Dödbandet är för stort.").nullable(),
  /** Drifttimmar från PLC (2026-11-02): the value feeds the signal's own machine part. Left out: unchanged. */
  runHours: z.boolean().optional(),
});
export type UpdateSignal = z.infer<typeof updateSignalCommand>;

/** The source's signals, newest seen first, with their machine parts (at most the source's cap, so one page). */
export async function listSignals(organizationId: string, sourceId: string) {
  const source = await prisma.machineSource.findFirst({ where: { id: sourceId, organizationId }, select: { id: true, name: true, ignoredSignals: true } });
  if (!source) throw new ApiError(404, "Källan finns inte.");
  const [signals, companyCount] = await Promise.all([
    prisma.machineSignal.findMany({ where: { sourceId, organizationId }, orderBy: [{ lastSeenAt: "desc" }, { key: "asc" }], take: MAX_SIGNALS_PER_SOURCE,
      select: { id: true, key: true, kind: true, status: true, name: true, unit: true, machinePartId: true, deadband: true, runHoursFeed: true, firstSeenAt: true, lastSeenAt: true, lastValue: true, lastValueAt: true } }),
    prisma.machineSignal.count({ where: { organizationId } }),
  ]);
  const byId = await partLabels(organizationId, signals.map((signal) => signal.machinePartId));
  const rules = await listRules(organizationId, signals.map((signal) => signal.id));
  return {
    rules,
    source: { id: source.id, name: source.name, ignoredSignals: source.ignoredSignals },
    signals: signals.map(({ machinePartId, ...signal }) => ({ ...signal, partId: machinePartId, part: machinePartId ? byId.get(machinePartId) ?? null : null })),
    limits: { perSource: MAX_SIGNALS_PER_SOURCE, perCompany: MAX_SIGNALS_PER_COMPANY, companyCount },
  };
}

/** Name, unit, status, machine part and dead band of one signal. Returns the audit line. */
export async function updateSignal(organizationId: string, input: UpdateSignal) {
  const signal = await prisma.machineSignal.findFirst({ where: { id: input.signalId, organizationId }, select: { id: true, key: true, name: true, kind: true, runHoursFeed: true, source: { select: { name: true } } } });
  if (!signal) throw new ApiError(404, "Signalen finns inte.");
  const name = cleanSignalText(input.name, MAX_SIGNAL_NAME_LENGTH);
  if (name === null) throw new ApiError(400, `Namnet får vara högst ${MAX_SIGNAL_NAME_LENGTH} tecken, utan radbrytningar.`);
  const unit = cleanSignalText(input.unit, MAX_SIGNAL_UNIT_LENGTH);
  if (unit === null) throw new ApiError(400, `Enheten får vara högst ${MAX_SIGNAL_UNIT_LENGTH} tecken, utan radbrytningar.`);
  if (input.deadband !== null && signal.kind !== "number") throw new ApiError(400, "Dödband gäller bara tal.");
  // The part must be one of the company's machine parts (the database's trigger holds the same border).
  const part = input.partId ? await prisma.machinePart.findFirst({ where: { id: input.partId, organizationId, isActive: true }, select: { id: true, name: true } }) : null;
  if (input.partId && !part) throw new ApiError(404, "Maskindelen finns inte eller är pausad.");
  const runHoursFeed = input.runHours ?? signal.runHoursFeed;
  const problem = runHoursFeedProblem({ feed: runHoursFeed, kind: signal.kind, status: input.status, partId: part?.id ?? null });
  if (problem) throw new ApiError(400, problem);
  if (runHoursFeed) {
    const other = await prisma.machineSignal.findFirst({ where: { organizationId, machinePartId: part!.id, runHoursFeed: true, NOT: { id: signal.id } }, select: { key: true, name: true, source: { select: { name: true } } } });
    if (other) throw new ApiError(409, `${part!.name} får redan drifttimmar från ${signalLabel(other)} på ${other.source.name}.`);
  }
  // Like a rule on a found signal: a signal that feeds the hours is active, or it would do nothing.
  const status = runHoursFeed && input.status === "discovered" ? "active" : input.status;
  await prisma.machineSignal.updateMany({ where: { id: signal.id, organizationId }, data: { name, unit, status, machinePartId: part?.id ?? null, deadband: input.deadband, runHoursFeed } });
  return `Ändrade signalen ”${signalLabel({ key: signal.key, name })}” på maskinkällan ”${signal.source.name}” (${status}${part ? `, maskindel ”${part.name}”` : ""}${runHoursFeed ? ", ger drifttimmar" : ""}).`;
}

/** What a suggestion concerns, in words: the machine part's (an old row: the place's) or the signal's name; "" for the source itself. */
export async function scopeLabels(organizationId: string, scopeKeys: string[]) {
  const parsed = [...new Set(scopeKeys)].map(parseScopeKey).filter((item): item is NonNullable<typeof item> => Boolean(item));
  const facilityIds = parsed.filter((item) => item.kind === "facility").map((item) => item.id);
  const signalIds = parsed.filter((item) => item.kind === "signal").map((item) => item.id);
  const partIds = parsed.filter((item) => item.kind === "part").map((item) => item.id);
  const [places, signals, parts] = await Promise.all([
    facilityIds.length ? prisma.customerFacility.findMany({ where: { id: { in: facilityIds }, organizationId }, select: { id: true, name: true } }) : [],
    signalIds.length ? prisma.machineSignal.findMany({ where: { id: { in: signalIds }, organizationId }, select: { id: true, key: true, name: true } }) : [],
    partIds.length ? prisma.machinePart.findMany({ where: { id: { in: partIds }, organizationId }, select: { id: true, name: true } }) : [],
  ]);
  const labels = new Map<string, string>();
  for (const part of parts) labels.set(`part:${part.id}`, part.name);
  for (const place of places) labels.set(`facility:${place.id}`, place.name);
  for (const signal of signals) labels.set(`signal:${signal.id}`, signalLabel(signal));
  return labels;
}
