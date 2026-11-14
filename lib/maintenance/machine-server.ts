import { prisma } from "@/lib/db";
import { ApiError } from "@/lib/kfid/server";
import { machineKeyFiguresFor } from "@/lib/machine/key-figures-server";
import type { KeyFigurePeriod } from "@/lib/machine/key-figures";
import { MACHINE_EVENTS_PAGE, machineStatus } from "@/lib/machine/place-status";
import { PART_LIMIT, partPath, subtreeIds, type MaintenanceCaller } from "./model";
import { requireMaintenance } from "./server";

/**
 * Maskinkopplingen på en maskindel (Underhåll, 2026-10-30: "signalerna kopplas till delar i det här trädet"): the
 * status row, the tab Händelser and the key figures for the part and everything under it – what the place page showed for
 * a place until the machine objects left the customers' place trees. The module's read right; company-bound.
 */
async function subtree(caller: MaintenanceCaller, partId: string) {
  requireMaintenance(caller, "read");
  const all = await prisma.machinePart.findMany({ where: { organizationId: caller.organizationId }, select: { id: true, parentId: true, name: true }, take: PART_LIMIT });
  if (!all.some((part) => part.id === partId)) throw new ApiError(404, "Delen hittades inte.");
  return { all, ids: subtreeIds(all, partId) };
}

export async function partMachineStatus(caller: MaintenanceCaller, partId: string) {
  const { ids } = await subtree(caller, partId);
  const organizationId = caller.organizationId;
  const [sources, latestState, latest, rows, pending] = await Promise.all([
    prisma.machineSource.count({ where: { organizationId, machinePartId: { in: ids } } }),
    prisma.machineEvent.findFirst({ where: { organizationId, machinePartId: { in: ids }, type: "state" }, orderBy: { occurredAt: "desc" }, select: { state: true, occurredAt: true } }),
    prisma.machineEvent.findFirst({ where: { organizationId, machinePartId: { in: ids } }, orderBy: { receivedAt: "desc" }, select: { receivedAt: true } }),
    prisma.machineAlarmOrder.findMany({ where: { organizationId, machinePartId: { in: ids }, status: "created", taskId: { not: null } }, select: { taskId: true } }),
    prisma.machineAlarmOrder.count({ where: { organizationId, machinePartId: { in: ids }, status: "pending" } }),
  ]);
  // A row closes only at the next alarm on the scope: what says "open" is its work order.
  const open = rows.length ? await prisma.workflowTask.count({ where: { organizationId, id: { in: rows.map((row) => row.taskId!) }, status: { notIn: ["COMPLETED", "CANCELLED"] } } }) : 0;
  const state = latestState?.state === "running" || latestState?.state === "stopped" ? latestState.state : null;
  return machineStatus({ sources, state, stateAt: state ? latestState!.occurredAt.toISOString() : null, lastHeardAt: latest?.receivedAt.toISOString() ?? null, openOrders: open, pendingOrders: pending });
}

export async function partMachineEvents(caller: MaintenanceCaller, partId: string, page = 1) {
  const { all, ids } = await subtree(caller, partId);
  const where = { organizationId: caller.organizationId, machinePartId: { in: ids } };
  const take = Math.min(50, Math.max(1, page)) * MACHINE_EVENTS_PAGE;
  const [rows, total, status] = await Promise.all([
    prisma.machineEvent.findMany({ where, orderBy: [{ occurredAt: "desc" }, { id: "desc" }], take,
      select: { id: true, occurredAt: true, receivedAt: true, type: true, code: true, severity: true, state: true, text: true, machinePartId: true, source: { select: { name: true } } } }),
    prisma.machineEvent.count({ where }),
    partMachineStatus(caller, partId),
  ]);
  const depth = partPath(all, partId).length + 1;
  const names = new Map(all.map((part) => [part.id, part.name]));
  const below = (id: string | null) => id && id !== partId ? [...partPath(all, id), names.get(id) ?? ""].slice(depth).join(" › ") : "";
  return {
    status,
    events: rows.map((row) => ({ id: row.id, occurredAt: row.occurredAt.toISOString(), receivedAt: row.receivedAt.toISOString(), type: row.type, code: row.code, severity: row.severity, state: row.state, text: row.text, sourceName: row.source.name, below: below(row.machinePartId) })),
    total, page,
  };
}

export async function partMachineKeyFigures(caller: MaintenanceCaller, partId: string, periodDays: KeyFigurePeriod, now = new Date()) {
  const { ids } = await subtree(caller, partId);
  return machineKeyFiguresFor(caller.organizationId, ids, periodDays, now);
}
