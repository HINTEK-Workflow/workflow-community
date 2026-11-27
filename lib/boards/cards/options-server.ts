import { prisma } from "@/lib/db";
import { ApiError } from "@/lib/kfid/errors";
import { maintenanceAccess } from "@/lib/maintenance/model";
import { organizationModuleOn } from "@/lib/workflow/modules";
import type { MetricCaller } from "../metrics-server";
import { listBoardFiles, sheetColumns } from "./file-server";
import { maintenanceCallerOf } from "./server";

/**
 * What the properties panel offers for the newer cards (GET /api/boards?part=sources&kind=…): the company's board files, a sheet's
 * columns, the machines and the active number signals. Only for a person who may change boards (checked by the caller), and the
 * machines only with Underhåll's read right and the module on, as their page.
 */
export type SourceOptionKind = "files" | "sheet" | "machines" | "signals";

export async function boardSourceOptions(viewer: MetricCaller, kind: string | null, id: string | null) {
  const machinesAllowed = () => organizationModuleOn(viewer.organization, "upkeep") && maintenanceAccess(maintenanceCallerOf(viewer)).read;
  switch (kind) {
    case "files": return { items: await listBoardFiles(viewer.organizationId) };
    case "sheet": return sheetColumns(viewer.organizationId, (id ?? "").slice(0, 60));
    case "machines": {
      if (!machinesAllowed()) return { items: [], refused: true };
      const rows = await prisma.machinePart.findMany({ where: { organizationId: viewer.organizationId, parentId: null, isActive: true, status: { not: "DECOMMISSIONED" } }, orderBy: [{ position: "asc" }, { name: "asc" }], take: 200, select: { id: true, name: true } });
      return { items: rows };
    }
    case "signals": {
      if (!machinesAllowed()) return { items: [], refused: true };
      const rows = await prisma.machineSignal.findMany({ where: { organizationId: viewer.organizationId, kind: "number", status: "active" }, orderBy: [{ name: "asc" }, { key: "asc" }], take: 300,
        select: { id: true, key: true, name: true, unit: true, machinePart: { select: { name: true } }, source: { select: { name: true } } } });
      return { items: rows.map((row) => ({ id: row.id, name: `${row.name.trim() || row.key}${row.unit ? ` (${row.unit})` : ""}`, machine: row.machinePart?.name ?? row.source.name })) };
    }
    default: throw new ApiError(400, "Okänd begäran.");
  }
}
