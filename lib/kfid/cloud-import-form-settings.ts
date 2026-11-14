import { Prisma } from "@prisma/client";
import { ApiError } from "@/lib/kfid/errors";
import { visibleFormsWhere } from "@/lib/kfid/form-scope";
import type { LocalWorkspaceDocument } from "@/features/kfid/local-workspace-store";
import { scheduleTempPlace } from "@/lib/workflow/form-schedule";
import { conflictObjectName, emptyFormSettingsSummary, planLimitProfileReimport, planScheduleReimport, scheduleConflictTitle, type FormSettingsSummary } from "./form-settings-reimport";

type Db = Pick<Prisma.TransactionClient, "formLimitProfile" | "formSchedule" | "formTemplate" | "customerFacility">;
type Maps = { customerFor: (localId: string | null) => string | null; facilityFor: (localId: string | null) => string | null; projectFor: (localId: string | null) => string | null };

/**
 * Återimport of the file's limit profiles and round schedules (2026-10-06), inside the import's transaction and after
 * the customers, places and projects, whose Cloud ids `maps` gives. Every read and write is bound to the organization;
 * a form the company may not read, or a place that did not come along, is skipped. See form-settings-reimport.ts.
 */
export async function importFormSettings(db: Db, input: { organizationId: string; userId: string; workspace: Pick<LocalWorkspaceDocument, "formLimitProfiles" | "formSchedules"> }, maps: Maps): Promise<FormSettingsSummary> {
  const { organizationId, userId, workspace } = input;
  const summary = emptyFormSettingsSummary();
  const templateIds = [...new Set([...workspace.formLimitProfiles.map((item) => item.templateId), ...workspace.formSchedules.map((item) => item.templateId)])];
  const visible = new Set(templateIds.length ? (await db.formTemplate.findMany({ where: { id: { in: templateIds }, ...visibleFormsWhere(organizationId) }, select: { id: true } })).map((item) => item.id) : []);

  for (const local of workspace.formLimitProfiles) {
    const facilityId = maps.facilityFor(local.facilityId);
    if (!facilityId || !visible.has(local.templateId)) { summary.limitProfiles.skipped += 1; continue; }
    const key = { organizationId, templateId: local.templateId, facilityId, objectName: local.objectName };
    const atKey = await db.formLimitProfile.findUnique({ where: { organizationId_templateId_facilityId_objectName: key } });
    // The profile it came from counts only when it is still the one on the same key.
    const origin = local.cloudOrigin && atKey?.id === local.cloudOrigin.id ? atKey : null;
    const outcome = planLimitProfileReimport(local, origin, atKey);
    const values = local.values as Prisma.InputJsonValue;
    if (outcome === "UNCHANGED") summary.limitProfiles.unchanged += 1;
    else if (outcome === "UPDATE") {
      const changed = await db.formLimitProfile.updateMany({ where: { id: origin!.id, organizationId, version: local.cloudOrigin!.version }, data: { values, version: Math.max(origin!.version + 1, local.version), updatedBy: userId, updatedByName: local.updatedByName } });
      if (!changed.count) throw new ApiError(409, "En gränsprofil ändrades medan återimporten förbereddes. Förhandsgranska filen igen.");
      summary.limitProfiles.update += 1;
    } else {
      let objectName = local.objectName;
      if (outcome === "COPY_CONFLICT") {
        const taken = new Set((await db.formLimitProfile.findMany({ where: { organizationId, templateId: local.templateId, facilityId }, select: { objectName: true } })).map((item) => item.objectName));
        objectName = conflictObjectName(local.objectName, (name) => taken.has(name));
      }
      await db.formLimitProfile.create({ data: { ...key, objectName, values, updatedBy: userId, updatedByName: local.updatedByName } });
      if (outcome === "COPY_CONFLICT") summary.limitProfiles.conflictCopies += 1; else summary.limitProfiles.new += 1;
    }
  }

  for (const local of workspace.formSchedules) {
    const current = local.cloudOrigin ? await db.formSchedule.findFirst({ where: { id: local.cloudOrigin.id, organizationId }, select: { id: true, version: true, deletedAt: true, assignedToUserId: true, assignedToName: true } }) : null;
    const outcome = planScheduleReimport(local, current);
    if (outcome === "UNCHANGED") { summary.schedules.unchanged += 1; continue; }
    if (outcome === "KEEP_CLOUD") { summary.schedules.keptCloud += 1; continue; }
    if (outcome === "DELETE") {
      const changed = await db.formSchedule.updateMany({ where: { id: current!.id, organizationId, version: local.cloudOrigin!.version, deletedAt: null }, data: { deletedAt: new Date(), updatedBy: userId, version: { increment: 1 } } });
      if (!changed.count) throw new ApiError(409, "En rond ändrades medan återimporten förbereddes. Förhandsgranska filen igen.");
      summary.schedules.removed += 1;
      continue;
    }
    // A schedule needs a form the company may read. Its own customer, place and temporary place are only what a round planned
    // before 2026-10-27 (kväll) stored – kept as they come back; a place that did not come along leaves the round without one.
    if (!visible.has(local.templateId)) { summary.schedules.skipped += 1; continue; }
    const facilityId = maps.facilityFor(local.facilityId);
    const place = facilityId ? await db.customerFacility.findFirst({ where: { id: facilityId, organizationId }, select: { customerId: true } }) : null;
    // A Local person is not a Cloud member: the responsible person is kept only when the name is the one Cloud has.
    const assignedToUserId = outcome === "UPDATE" && current?.assignedToName === local.assignedToName ? current.assignedToUserId : null;
    const data = {
      title: outcome === "COPY_CONFLICT" ? scheduleConflictTitle(local.title) : local.title, templateId: local.templateId,
      customerId: place?.customerId ?? maps.customerFor(local.customerId), facilityId: place ? facilityId : null, projectId: maps.projectFor(local.projectId),
      assignedToUserId, assignedToName: local.assignedToName,
      // A conflict copy starts paused, so the round is not doubled and no reminder goes out twice.
      active: outcome === "COPY_CONFLICT" ? false : local.active,
      rule: local.rule as Prisma.InputJsonValue, reminders: local.reminders as Prisma.InputJsonValue, updatedBy: userId,
      // The round's temporary place (2026-10-08) comes back with it; none is stored as NULL.
      tempPlace: (scheduleTempPlace(local.tempPlace) ?? Prisma.DbNull) as Prisma.InputJsonValue | typeof Prisma.DbNull,
    };
    if (outcome === "UPDATE") {
      const changed = await db.formSchedule.updateMany({ where: { id: current!.id, organizationId, version: local.cloudOrigin!.version, deletedAt: null }, data: { ...data, version: Math.max(current!.version + 1, local.version) } });
      if (!changed.count) throw new ApiError(409, "En rond ändrades medan återimporten förbereddes. Förhandsgranska filen igen.");
      summary.schedules.update += 1;
    } else {
      await db.formSchedule.create({ data: { ...data, organizationId, createdBy: userId } });
      if (outcome === "COPY_CONFLICT") summary.schedules.conflictCopies += 1; else summary.schedules.new += 1;
    }
  }
  return summary;
}
