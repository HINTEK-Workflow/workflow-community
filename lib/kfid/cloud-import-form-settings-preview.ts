import { Prisma } from "@prisma/client";
import { visibleFormsWhere } from "@/lib/kfid/form-scope";
import type { LocalWorkspaceDocument } from "@/features/kfid/local-workspace-store";
import { emptyFormSettingsSummary, planLimitProfileReimport, planScheduleReimport, type FormSettingsSummary } from "./form-settings-reimport";

type Db = Pick<Prisma.TransactionClient, "formLimitProfile" | "formSchedule" | "formTemplate" | "customerFacility">;
type Workspace = Pick<LocalWorkspaceDocument, "formLimitProfiles" | "formSchedules" | "customerFacilities">;

/**
 * The preview of a återimport counts limit profiles and round schedules too (2026-10-07). It only reads, and decides
 * with the same rules as importFormSettings (cloud-import-form-settings.ts). A place is "there" when its customer comes
 * along in the file; it keeps its Cloud id when it came from Cloud, belongs to the same customer and that customer is
 * updated rather than copied – otherwise the import creates it, so a profile on it is new.
 */
export async function previewFormSettings(db: Db, organizationId: string, workspace: Workspace, copiedCustomers: Set<string>, fileCustomers: Set<string>): Promise<FormSettingsSummary> {
  const summary = emptyFormSettingsSummary();
  const templateIds = [...new Set([...workspace.formLimitProfiles.map((item) => item.templateId), ...workspace.formSchedules.map((item) => item.templateId)])];
  const visible = new Set(templateIds.length ? (await db.formTemplate.findMany({ where: { id: { in: templateIds }, ...visibleFormsWhere(organizationId) }, select: { id: true } })).map((item) => item.id) : []);
  const originIds = workspace.customerFacilities.flatMap((item) => item.cloudOrigin && !copiedCustomers.has(item.customerId) ? [item.cloudOrigin.id] : []);
  const cloudPlaces = originIds.length ? await db.customerFacility.findMany({ where: { id: { in: originIds }, organizationId }, select: { id: true, customerId: true } }) : [];
  const cloudPlace = new Map(cloudPlaces.map((item) => [item.id, item]));
  const places = new Map(workspace.customerFacilities.filter((item) => fileCustomers.has(item.customerId)).map((item) => {
    const current = item.cloudOrigin ? cloudPlace.get(item.cloudOrigin.id) : undefined;
    return [item.id, current ? current.id : null] as const;
  }));

  for (const local of workspace.formLimitProfiles) {
    if (!local.facilityId || !places.has(local.facilityId) || !visible.has(local.templateId)) { summary.limitProfiles.skipped += 1; continue; }
    const facilityId = places.get(local.facilityId);
    const atKey = facilityId ? await db.formLimitProfile.findUnique({ where: { organizationId_templateId_facilityId_objectName: { organizationId, templateId: local.templateId, facilityId, objectName: local.objectName } } }) : null;
    const origin = local.cloudOrigin && atKey?.id === local.cloudOrigin.id ? atKey : null;
    const outcome = planLimitProfileReimport(local, origin, atKey);
    if (outcome === "UNCHANGED") summary.limitProfiles.unchanged += 1;
    else if (outcome === "UPDATE") summary.limitProfiles.update += 1;
    else if (outcome === "COPY_CONFLICT") summary.limitProfiles.conflictCopies += 1;
    else summary.limitProfiles.new += 1;
  }

  for (const local of workspace.formSchedules) {
    const current = local.cloudOrigin ? await db.formSchedule.findFirst({ where: { id: local.cloudOrigin.id, organizationId }, select: { id: true, version: true, deletedAt: true, assignedToUserId: true, assignedToName: true } }) : null;
    const outcome = planScheduleReimport(local, current);
    if (outcome === "UNCHANGED") summary.schedules.unchanged += 1;
    else if (outcome === "KEEP_CLOUD") summary.schedules.keptCloud += 1;
    else if (outcome === "DELETE") summary.schedules.removed += 1;
    // A round no longer needs a place (2026-10-27 kväll): one stored before then that did not come along is left out, not the round.
    else if (!visible.has(local.templateId)) summary.schedules.skipped += 1;
    else if (outcome === "UPDATE") summary.schedules.update += 1;
    else if (outcome === "COPY_CONFLICT") summary.schedules.conflictCopies += 1;
    else summary.schedules.new += 1;
  }
  return summary;
}
