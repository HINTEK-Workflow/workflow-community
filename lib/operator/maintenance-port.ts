import type { MaintenancePort } from "@/lib/operator/machines";
import { maintenanceModuleAdapter } from "@/lib/operator/maintenance-adapter";

/**
 * Which adapter answers the operator page's questions about machines and corrective work (lib/operator/machines.ts).
 * The maintenance module's adapter (lib/operator/maintenance-adapter.ts, 0.34.0).
 * Unit and integration tests may swap it (setMaintenancePortForTests).
 */
let override: MaintenancePort | null = null;
export const maintenancePort = (): MaintenancePort => override ?? maintenanceModuleAdapter;
export function setMaintenancePortForTests(port: MaintenancePort | null) {
  override = port;
}
