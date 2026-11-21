import { readMaintenance } from "./maintenance-setting";
import { readRiskExceptionAllowed } from "./risk-step-server";
import { OBJECT_DATA_OFF, type FeatureSettings } from "./feature-settings";
import { ApiError } from "@/lib/kfid/errors";

export async function readFeatureSettings(organizationId: string): Promise<FeatureSettings> {
  return { maintenance: await readMaintenance(organizationId), riskException: await readRiskExceptionAllowed(organizationId) };
}

/** Alla objekt and the object data of places belong to Objektdata på platser. */
export async function requireObjectData(organizationId: string) {
  if (!(await readMaintenance(organizationId))) throw new ApiError(409, OBJECT_DATA_OFF);
}
