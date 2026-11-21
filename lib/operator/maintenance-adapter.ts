import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { store } from "@/lib/kfid/storage";
import { faultOrderText } from "@/lib/operator/rules";
import type { CorrectiveWork, CorrectiveWorkInput, MachineHistory, MachineNode, MaintenancePort } from "@/lib/operator/machines";
import { createItemAs } from "@/lib/maintenance/server";
import { itemInputSchema } from "@/lib/maintenance/model";
import { PLACE_LEVEL_LABELS, placeLevelOf } from "@/lib/maintenance/place-model";
import { workflowTaskInputSchema, workflowTaskProgress } from "@/lib/workflow/task-model";

/**
 * Operatörssidan mot underhållsmodulen (0.34.0; replaces the temporary adapter of the operator-sida branch):
 *
 * - the machine tree is the module's two trees as one (2026-10-31): the places (Ort › Anläggning › Område › Avdelning) that
 *   have a machine on or under them, as nodes that only group and cannot be reported on, with the machines and their parts under
 *   them – the admin chooses per account what is seen (a whole place, or one machine), so nothing is shown before that choice;
 * - a node's alarm contacts are the part's own (MachineAlarmContact.machinePartId): `alarmFacilityId` carries the part's id;
 * - a fault report makes a work order on the part and a corrective maintenance item (source OPERATOR) held by it – the
 *   work order is the holder, the item has the fault, priority and Felanmäld;
 * - the receipt's number is "AO-" and the end of the work order's id (work orders have no numbers of their own yet); it is
 *   written in the order's title and description, so the company finds the order by it (användartest 2026-10-31, A1);
 * - photos are copied onto the work order as attachments (the report keeps its own copies).
 */
export const FAULT_CREATOR = "system:operator-fault";
export const FAULT_CREATOR_NAME = "Felanmälan";

const json = (value: unknown) => JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;
export const orderLabel = (id: string) => `AO-${id.slice(-6).toUpperCase()}`;

/** The part's status as the operator page's operating state (Service snart is still in service). */
const operatingState = (status: string) => status === "OUT_OF_SERVICE" || status === "DECOMMISSIONED" ? status : "IN_SERVICE";

async function tree(organizationId: string): Promise<MachineNode[]> {
  const [rows, places] = await Promise.all([
    prisma.machinePart.findMany({
      where: { organizationId, isActive: true },
      orderBy: [{ position: "asc" }, { name: "asc" }], take: 2000,
      select: { id: true, parentId: true, placeId: true, name: true, partType: true, status: true },
    }),
    prisma.maintenancePlace.findMany({ where: { organizationId }, orderBy: { name: "asc" }, take: 2000, select: { id: true, parentId: true, name: true, level: true } }),
  ]);
  const ids = new Set(rows.map((row) => row.id));
  const placeById = new Map(places.map((place) => [place.id, place]));
  // Only places with a machine on or under them: an empty place says nothing to an operator.
  const usedPlaces = new Set<string>();
  for (const row of rows) {
    let current = !row.parentId && row.placeId ? placeById.get(row.placeId) : undefined;
    while (current && !usedPlaces.has(current.id)) {
      usedPlaces.add(current.id);
      current = current.parentId ? placeById.get(current.parentId) : undefined;
    }
  }
  const placeNodes: MachineNode[] = places.filter((place) => usedPlaces.has(place.id)).map((place) => ({
    id: place.id, parentId: place.parentId && usedPlaces.has(place.parentId) ? place.parentId : null, name: place.name, objectType: PLACE_LEVEL_LABELS[placeLevelOf(place.level)],
    reportable: false, alarmFacilityId: null, operatingState: "",
  }));
  return [...placeNodes, ...rows.map((row): MachineNode => ({
    id: row.id, parentId: row.parentId && ids.has(row.parentId) ? row.parentId : !row.parentId && row.placeId && usedPlaces.has(row.placeId) ? row.placeId : null, name: row.name, objectType: row.partType,
    reportable: row.status !== "DECOMMISSIONED", alarmFacilityId: row.id, operatingState: operatingState(row.status),
  }))];
}

async function runStates(organizationId: string, nodeIds: readonly string[]) {
  if (!nodeIds.length) return new Map<string, "running" | "stopped">();
  const rows = await prisma.machineEvent.findMany({
    where: { organizationId, machinePartId: { in: [...nodeIds] }, type: "state", state: { in: ["running", "stopped"] } },
    orderBy: { occurredAt: "desc" }, distinct: ["machinePartId"], select: { machinePartId: true, state: true },
  });
  return new Map(rows.flatMap((row) => row.machinePartId ? [[row.machinePartId, row.state as "running" | "stopped"] as const] : []));
}

async function createCorrectiveWork(input: CorrectiveWorkInput): Promise<CorrectiveWork> {
  const words = { machineLabel: input.machinePath || input.machine.name, cause: input.cause, text: input.text, severity: input.severity, reporter: input.reporterName, accountName: input.accountName };
  const text = faultOrderText(words);
  const by = input.decidedById ?? FAULT_CREATOR;
  const reportedAt = input.now.toISOString();
  const task = workflowTaskInputSchema.parse({
    kind: "WORK_ORDER", title: text.title, description: text.description, status: "PLANNED",
    projectId: null, customerId: null, facilityId: null, assignedToUserId: null, assignedToName: "",
    // The fault, priority and Felanmäld are the maintenance item's (below), not the order's (2026-10-30).
    // 2026-11-07 (kundresan, M25): the risk assessment before Starta tid, exactly as on a machine alarm's order.
    data: { kind: "WORK_ORDER", details: {}, riskStep: true },
  });
  // The photos are stored before the transaction (files are not part of it); a failure removes nothing of the report.
  const files: { filename: string; storagePath: string; mimeType: string; size: number }[] = [];
  for (const photo of input.photos) files.push({ filename: photo.filename, storagePath: await store(photo.buffer, photo.extension), mimeType: photo.mimeType, size: photo.buffer.length });
  return prisma.$transaction(async (tx) => {
    const part = await tx.machinePart.findFirst({ where: { id: input.machine.id, organizationId: input.organizationId }, select: { id: true, customerId: true } });
    const created = await tx.workflowTask.create({
      data: {
        organizationId: input.organizationId, projectId: null, customerId: part?.customerId ?? null, facilityId: null, machinePartId: part?.id ?? null,
        kind: "WORK_ORDER", title: task.title, description: task.description,
        assignedToUserId: null, assignedToName: "", status: task.status, progress: workflowTaskProgress(task), dueDate: task.dueDate, data: json(task.data),
        // Always the fault report's own mark (H1), also when an administrator approved it: who approved stands on the report.
        createdBy: FAULT_CREATOR, updatedBy: by,
        attachments: files.length ? { create: files.map((file) => ({ ...file, organizationId: input.organizationId })) } : undefined,
      },
      select: { id: true },
    });
    // The number comes from the id, so the title and description that carry it are written once the order exists (still
    // version 1, the same transaction); the first revision holds them.
    const label = orderLabel(created.id);
    const named = faultOrderText({ ...words, label });
    await tx.workflowTask.update({ where: { id: created.id }, data: { title: named.title, description: named.description }, select: { id: true } });
    await tx.workflowTaskRevision.create({ data: { taskId: created.id, version: 1, snapshot: json({ ...task, title: named.title, description: named.description }), createdBy: FAULT_CREATOR } });
    const item = part ? await createItemAs(tx, { organizationId: input.organizationId, userId: by }, itemInputSchema.parse({
      partId: part.id, workOrderId: created.id, type: "CORRECTIVE", priority: text.priority, fault: text.fault, reportedAt,
    }), "OPERATOR") : null;
    return { workOrderId: created.id, workOrderLabel: label, maintenanceItemId: item?.id ?? null };
  });
}

async function workStatuses(organizationId: string, workOrderIds: readonly string[]) {
  if (!workOrderIds.length) return new Map<string, string>();
  const rows = await prisma.workflowTask.findMany({ where: { organizationId, id: { in: [...workOrderIds] } }, select: { id: true, status: true } });
  return new Map(rows.map((row) => [row.id, row.status]));
}

async function history(organizationId: string, nodeId: string, now: Date): Promise<MachineHistory> {
  const [items, alarms] = await Promise.all([
    prisma.maintenanceItem.findMany({
      where: { organizationId, partId: nodeId, status: "DONE" },
      orderBy: { completedAt: "desc" }, take: 10,
      select: { fault: true, cause: true, causeNote: true, completedAt: true, workOrderId: true, workOrder: { select: { title: true, data: true } } },
    }),
    prisma.machineEvent.findMany({
      where: { organizationId, machinePartId: nodeId, type: "alarm", state: "raised", occurredAt: { gte: new Date(now.getTime() - 24 * 3_600_000) } },
      orderBy: { occurredAt: "desc" }, take: 10, select: { occurredAt: true, code: true, text: true },
    }),
  ]);
  const closeNotes = (data: unknown) => String(((data ?? {}) as { details?: { closeNotes?: unknown } }).details?.closeNotes ?? "");
  return {
    work: items.map((item) => ({
      label: item.workOrderId ? orderLabel(item.workOrderId) : "", at: item.completedAt?.toISOString() ?? "",
      cause: (item.fault || item.workOrder?.title || "").slice(0, 200),
      done: (closeNotes(item.workOrder?.data) || [item.cause, item.causeNote].filter(Boolean).join(": ")).slice(0, 300),
    })),
    alarms: alarms.map((alarm) => ({ at: alarm.occurredAt.toISOString(), code: alarm.code, text: alarm.text.slice(0, 200) })),
  };
}

export const maintenanceModuleAdapter: MaintenancePort = { name: "maintenance", tree, runStates, createCorrectiveWork, workStatuses, history };
