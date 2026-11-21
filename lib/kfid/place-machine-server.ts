import type { Context } from "@/lib/kfid/server";
import { hasWorkflowPermission } from "@/lib/workflow/permissions";

/**
 * Integrationsmotorn E1: who may read what the machines sent and act on an automatic order (Skapa avvikelse): the same
 * right as work orders, the administrator always. The status row, Händelser and the key figures that were shown for a place
 * here belong to the machine parts of Underhåll since 2026-10-30 (lib/maintenance/machine-server.ts), never to the
 * customer's place tree.
 */
export const canReadMachineEvents = (ctx: Context) => ctx.admin || hasWorkflowPermission(ctx.workflowPermissions, "work-order", "read");
