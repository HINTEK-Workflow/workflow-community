import { prisma } from "@/lib/db";
import { foldRunHours, type RunHoursState } from "@/lib/machine/run-hours";
import type { KnownSignal } from "@/lib/machine/signal-store";
import { partPlansChanged } from "@/lib/maintenance/plan-server";
import { machinePartAllowed } from "@/lib/security/access-rules";

/**
 * Drifttimmar från PLC (2026-11-02), the database part: after the catalogue is updated (from /events or /raw), a signal
 * marked as feeding run hours moves its machine part's hours by the rules in run-hours.ts, and the part's plans fill as when a
 * person saves the hours. The part's version does not move: a person's open form must not go stale once a minute, and a save
 * from a form writes the hours only when the person changed them. Never throws into the intake: the readings are already saved.
 */
type Reading = { key: string; value: unknown; at: Date };

export async function feedRunHours(principal: { sourceId: string; organizationId: string }, readings: readonly Reading[], known: ReadonlyMap<string, KnownSignal>, now: Date) {
  const { organizationId } = principal;
  // Nyckel med minsta behörighet (K2.5): a key limited to some machines moves no other machine's hours.
  const feeding = [...known].filter(([, signal]) => signal.runHoursFeed && signal.status === "active" && signal.kind === "number" && signal.partId);
  const allowed = feeding.length ? (await prisma.machineSource.findFirst({ where: { id: principal.sourceId, organizationId }, select: { allowedMachinePartIds: true } }))?.allowedMachinePartIds ?? [] : [];
  for (const [key, signal] of feeding) {
    if (!signal.partId || !machinePartAllowed(allowed, signal.partId)) continue;
    const own = readings.filter((reading) => reading.key === key).map((reading) => ({ value: reading.value, at: reading.at.getTime() > now.getTime() ? now : reading.at }));
    if (!own.length) continue;
    try {
      const part = await prisma.machinePart.findFirst({ where: { id: signal.partId, organizationId }, select: { id: true, name: true, runHours: true, runHoursAt: true, runHoursHeld: true, runHoursHeldAt: true, runHoursHeldReason: true } });
      if (!part) continue;
      const start: RunHoursState = { runHours: part.runHours, runHoursAt: part.runHoursAt, held: part.runHoursHeld, heldAt: part.runHoursHeldAt, heldReason: part.runHoursHeldReason };
      const { state, used, write, newlyHeld } = foldRunHours(start, own);
      if (!write) continue;
      // A person's save or another call in between wins: this value is weighed again with the next one.
      const saved = await prisma.machinePart.updateMany({
        where: { id: part.id, organizationId, runHours: part.runHours, runHoursAt: part.runHoursAt },
        data: { ...(used ? { runHours: state.runHours, runHoursAt: state.runHoursAt, runHoursOrigin: "machine" } : {}), runHoursHeld: state.held, runHoursHeldAt: state.heldAt, runHoursHeldReason: state.heldReason },
      });
      if (!saved.count) continue;
      if (newlyHeld) await prisma.administrationEvent.create({ data: { actorId: `system:machine-source:${principal.sourceId}`, organizationId, action: "maintenance_run_hours_held", detail: `Underhåll: ${part.name}: maskinen skickade ${newlyHeld.value} drifttimmar (${newlyHeld.reason === "jump" ? "för stort hopp" : "lägre"}). Värdet används inte.`.slice(0, 500) } });
      if (used) await partPlansChanged(organizationId, part.id);
    } catch (error) {
      console.error("machine run hours failed", error instanceof Error ? error.name : "unknown");
    }
  }
}
