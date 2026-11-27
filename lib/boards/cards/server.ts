import { ApiError } from "@/lib/kfid/errors";
import type { MaintenanceCaller } from "@/lib/maintenance/model";
import type { MetricCaller } from "../metrics-server";
import type { CardDataProblem, Shape } from "../shapes";
import type { SourceConfig } from ".";
import { readCalendar } from "./calendar-server";
import { readPdf, readSheet } from "./file-server";
import { readMachine, readMachineEvents, readMachines, readMachineSignal } from "./machines-server";
import { readFaults, readUpkeep } from "./maintenance-server";
import { readTrend } from "./trend-server";

/**
 * Tavlans nyare kort på servern (2026-11-19): one reader per source, each with the same right and module as the page the data
 * comes from (Planering, Underhåll and its machine connection, the measures), only rows of the viewer's company. The viewer is the
 * signed-in person in the app, or the publisher for a screen or a link (lib/boards/viewer-server.ts).
 */
export type SourceResult = { ok: true; data: Shape; label?: string } | { ok: false; reason: CardDataProblem };

/** Underhåll's caller for the viewer. Boards exist only in Cloud (the route refuses a company with its own file), so the storage is Cloud. */
export const maintenanceCallerOf = (viewer: MetricCaller): MaintenanceCaller => ({ organizationId: viewer.organizationId, userId: viewer.userId, admin: viewer.admin, permissions: viewer.workflowPermissions, storageMode: "HINTEK_CLOUD" });

/** A refusal from a page's own reader as the card's calm reason. */
export function problemOf(error: unknown): CardDataProblem {
  if (error instanceof ApiError) return error.status === 403 || error.status === 409 ? "forbidden" : error.status === 404 ? "missing" : "failed";
  return "failed";
}

export async function readSourceCard(viewer: MetricCaller, source: SourceConfig, now: Date): Promise<SourceResult> {
  try {
    switch (source.type) {
      case "pdf": return await readPdf(viewer, source);
      case "sheet": return await readSheet(viewer, source);
      case "calendar": return await readCalendar(viewer, source, now);
      case "machine": return await readMachine(viewer, source);
      case "machines": return await readMachines(viewer, source);
      case "machine_events": return await readMachineEvents(viewer, source);
      case "machine_signal": return await readMachineSignal(viewer, source, now);
      case "upkeep": return await readUpkeep(viewer, source, now);
      case "faults": return await readFaults(viewer, source, now);
      case "trend": return await readTrend(viewer, source, now);
    }
  } catch (error) {
    return { ok: false, reason: problemOf(error) };
  }
}
