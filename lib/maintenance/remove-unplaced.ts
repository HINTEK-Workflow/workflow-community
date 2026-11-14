import { prisma } from "@/lib/db";
import { defaultWorkflowPermissionProfile } from "@/lib/workflow/permissions";
import { PART_LIMIT, type MaintenanceCaller } from "./model";
import { audit, partHistoryRefusal, partRemovalRefusal, removePartRow, type Db } from "./server";
import { planUnplaced, type UnplacedPlan } from "./unplaced-plan";

/**
 * The database part of removing the old machine roots from before the two trees (decision 2026-11-02; run by scripts/ops/remove-unplaced-machines.ts, never by
 * the app). Everything is bound to the one company. By default it only lists; with `execute` it removes in one transaction, row by
 * row through Ta bort's own rule and removal (lib/maintenance/server.ts), so a part that the app refuses stays, and is reported.
 */
const ACTOR = "system:remove-unplaced";

async function readPlan(db: Db, organizationId: string): Promise<UnplacedPlan> {
  const parts = await db.machinePart.findMany({ where: { organizationId }, select: { id: true, parentId: true, placeId: true, name: true }, take: PART_LIMIT + 1 });
  if (parts.length > PART_LIMIT) throw new Error(`Företaget har fler än ${PART_LIMIT} delar. Inget görs.`);
  const refusals = new Map<string, string>();
  const unplaced = planUnplaced(parts, refusals);
  for (const row of unplaced.remove) {
    const refusal = await partHistoryRefusal(db, organizationId, row.id);
    if (refusal) refusals.set(row.id, refusal);
  }
  return planUnplaced(parts, refusals);
}

/** What stays behind after the removal, by what the database does: nothing here is deleted by the script itself. */
async function leftBehind(db: Db, organizationId: string, ids: string[]) {
  const where = { organizationId, machinePartId: { in: ids } };
  const [sources, signals, events, alarmRows, faultReports, operatorLinks, images, spares, plans, contacts, summaries] = await Promise.all([
    db.machineSource.findMany({ where, select: { name: true } }),
    db.machineSignal.count({ where }),
    db.machineEvent.count({ where }),
    db.machineAlarmOrder.count({ where }),
    db.operatorFaultReport.count({ where: { organizationId, machineNodeId: { in: ids } } }),
    db.operatorAccountMachine.count({ where: { organizationId, nodeId: { in: ids } } }),
    db.machinePartImage.count({ where: { organizationId, partId: { in: ids } } }),
    db.machinePartArticle.count({ where: { organizationId, partId: { in: ids } } }),
    db.maintenancePlan.count({ where: { organizationId, partId: { in: ids } } }),
    db.machineAlarmContact.count({ where }),
    db.machineDaySummary.count({ where }),
  ]);
  return {
    /** Stay, without the part: the link becomes empty. */
    sources: sources.map((source) => source.name), signals, events, alarmRows,
    /** Stay, pointing at a part that is gone (plain ids with no key in the database). */
    faultReports, operatorLinks,
    /** Go with the part. */
    images, spares, plans, contacts, summaries,
  };
}

export type RemovalReport = UnplacedPlan & { companyName: string; executed: boolean; placedMachines: number; effects: Awaited<ReturnType<typeof leftBehind>>; removedFiles: string[] };

export async function removeUnplaced(organizationId: string, options: { execute: boolean }): Promise<RemovalReport> {
  const company = await prisma.organization.findUnique({ where: { id: organizationId }, select: { id: true, name: true, storageMode: true } });
  if (!company) throw new Error("Företaget hittades inte.");
  const caller: MaintenanceCaller = { organizationId, userId: ACTOR, admin: true, permissions: defaultWorkflowPermissionProfile(), storageMode: company.storageMode };
  const placedMachines = await prisma.machinePart.count({ where: { organizationId, parentId: null, placeId: { not: null } } });
  if (!options.execute) {
    const plan = await readPlan(prisma, organizationId);
    return { ...plan, companyName: company.name, executed: false, placedMachines, effects: await leftBehind(prisma, organizationId, plan.remove.map((row) => row.id)), removedFiles: [] };
  }
  // One transaction: the plan is read again inside it, and if anything goes wrong nothing has happened.
  return prisma.$transaction(async (tx) => {
    const plan = await readPlan(tx, organizationId);
    const effects = await leftBehind(tx, organizationId, plan.remove.map((row) => row.id));
    const removedFiles: string[] = [];
    for (const row of plan.remove) {
      const refusal = await partRemovalRefusal(tx, organizationId, row.id);
      if (refusal) throw new Error(`${row.way}: ${refusal}`);
      removedFiles.push(...(await removePartRow(tx, caller, row)).removedFiles);
    }
    await audit(tx, caller, "maintenance_unplaced_removed", `Underhåll: Utan plats rensad: ${plan.remove.length} delar borttagna, ${plan.keep.length} kvar.`);
    return { ...plan, companyName: company.name, executed: true, placedMachines, effects, removedFiles };
  }, { timeout: 120_000, maxWait: 10_000 });
}
