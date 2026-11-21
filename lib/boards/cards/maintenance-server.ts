import { prisma } from "@/lib/db";
import { maintenanceAccess } from "@/lib/maintenance/model";
import { planningMaintenance } from "@/lib/maintenance/plan-server";
import { addSwedishDays } from "@/lib/swedish-time";
import { organizationModuleOn } from "@/lib/workflow/modules";
import type { MetricCaller } from "../metrics-server";
import { periodRange } from "../period";
import { faultsShape, type FaultsSource } from "./faults";
import { maintenanceCallerOf, type SourceResult } from "./server";
import { upkeepShape, upkeepWindow, type UpkeepSource } from "./upkeep";

/**
 * Underhåll och Felanmälan på servern. The maintenance jobs are read exactly as Planering's calendar reads them (planningMaintenance:
 * Underhåll or work orders to read); the fault reports with Underhåll's read right, as the machine tree counts them. Never a
 * reporter's name.
 */
const OPEN_TASK = ["COMPLETED", "CANCELLED"];

export async function readUpkeep(viewer: MetricCaller, source: UpkeepSource, now: Date): Promise<SourceResult> {
  if (!organizationModuleOn(viewer.organization, "upkeep")) return { ok: false, reason: "module_off" };
  const caller = maintenanceCallerOf(viewer);
  const access = maintenanceAccess(caller);
  if (!access.read && !access.workOrderRead) return { ok: false, reason: "forbidden" };
  const horizon = source.horizon ?? "30d";
  const window = upkeepWindow(horizon, now);
  const { occurrences } = await planningMaintenance(caller, window.from, window.until);
  return { ok: true, data: upkeepShape(occurrences, horizon, now) };
}

export async function readFaults(viewer: MetricCaller, source: FaultsSource, now: Date): Promise<SourceResult> {
  if (!organizationModuleOn(viewer.organization, "upkeep")) return { ok: false, reason: "module_off" };
  if (!maintenanceAccess(maintenanceCallerOf(viewer)).read) return { ok: false, reason: "forbidden" };
  const period = source.period ?? "week";
  const range = periodRange(period, now);
  const since = new Date(Math.min(range.from.getTime(), addSwedishDays(now, -365).getTime()));
  const reports = await prisma.operatorFaultReport.findMany({
    where: { organizationId: viewer.organizationId, OR: [{ status: "pending" }, { createdAt: { gte: since } }] },
    orderBy: { createdAt: "desc" }, take: 2000,
    select: { createdAt: true, machineLabel: true, cause: true, severity: true, status: true, workOrderLabel: true, maintenanceItemId: true, taskId: true },
  });
  const itemIds = reports.flatMap((report) => report.maintenanceItemId ? [report.maintenanceItemId] : []);
  const taskIds = reports.flatMap((report) => !report.maintenanceItemId && report.taskId ? [report.taskId] : []);
  const [items, tasks] = await Promise.all([
    itemIds.length ? prisma.maintenanceItem.findMany({ where: { organizationId: viewer.organizationId, id: { in: itemIds } }, select: { id: true, status: true } }) : [],
    taskIds.length ? prisma.workflowTask.findMany({ where: { organizationId: viewer.organizationId, id: { in: taskIds } }, select: { id: true, status: true } }) : [],
  ]);
  const itemOpen = new Map(items.map((item) => [item.id, item.status === "OPEN"]));
  const taskOpen = new Map(tasks.map((task) => [task.id, !OPEN_TASK.includes(task.status)]));
  return {
    ok: true,
    data: faultsShape(reports.map((report) => ({
      at: report.createdAt, machine: report.machineLabel, cause: report.cause, severity: report.severity, status: report.status, workOrder: report.workOrderLabel,
      open: report.status === "pending" || (report.status === "received" && (report.maintenanceItemId ? itemOpen.get(report.maintenanceItemId) ?? false : report.taskId ? taskOpen.get(report.taskId) ?? false : false)),
    })), period, now),
  };
}
