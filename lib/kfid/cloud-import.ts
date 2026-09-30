import { createHash, randomUUID } from "node:crypto";
import { Prisma } from "@prisma/client";
import { formDocumentSchema } from "@/lib/workflow/form-document";
import { prisma } from "@/lib/db";
import { ApiError } from "@/lib/kfid/errors";
import { normalizeControl } from "@/lib/kfid/model";
import { planCloudControlReimport, planCloudReimport } from "@/lib/kfid/cloud-reimport";
import { read, remove, store } from "@/lib/kfid/storage";
import { CLOUD_WORK_SCHEDULE_IMPORT_POLICY } from "@/lib/workflow/work-schedule";
import { plannedActivityAssignments } from "@/lib/workflow/planned-activity";
import type { LocalWorkspaceBundleImport } from "@/features/kfid/local-workspace-bundle";
import type { LocalAttachment, LocalControl, LocalCustomer, LocalPlannedActivity, LocalWorkflowTask } from "@/features/kfid/local-workspace-store";

type ImportDatabase = Pick<Prisma.TransactionClient, "customer" | "control" | "workflowTask" | "plannedActivity" | "plannedActivityAssignment" | "organizationMember">;
type CurrentCustomer = Prisma.CustomerGetPayload<Record<string, never>>;
type CurrentControl = Prisma.ControlGetPayload<{ include: { attachments: true } }>;
type CurrentTask = Prisma.WorkflowTaskGetPayload<{ include: { attachments: true } }>;
type CurrentPlannedActivity = Prisma.PlannedActivityGetPayload<Record<string, never>>;
type ImportAction = "CREATE" | "UPDATE" | "COPY_CONFLICT";

type CustomerPlan = { local: LocalCustomer; current: CurrentCustomer | null; action: ImportAction };
type ControlPlan = { local: LocalControl; current: CurrentControl | null; action: ImportAction };
type TaskPlan = { local: LocalWorkflowTask; current: CurrentTask | null; action: ImportAction };
type PlannedActivityPlan = { local: LocalPlannedActivity; current: CurrentPlannedActivity | null; action: ImportAction };

export type CloudWorkspacePlan = {
  customers: CustomerPlan[];
  controls: ControlPlan[];
  workflowTasks: TaskPlan[];
  plannedActivities: PlannedActivityPlan[];
  summary: {
    customers: { new: number; update: number; conflictCopies: number };
    controls: { new: number; update: number; conflictCopies: number };
    workflowTasks: { new: number; update: number; conflictCopies: number };
    plannedActivities: { new: number; update: number; conflictCopies: number };
    attachments: number;
    workSchedule: typeof CLOUD_WORK_SCHEDULE_IMPORT_POLICY;
  };
};

export type CloudImportResult = CloudWorkspacePlan["summary"] & {
  importId: string;
  duplicate: boolean;
};

function sha256(bytes: Uint8Array) {
  return createHash("sha256").update(bytes).digest("hex");
}

function count(actions: ImportAction[], action: ImportAction) {
  return actions.filter((item) => item === action).length;
}

function attachmentMetadataMatches(current: CurrentControl["attachments"][number], local: LocalAttachment) {
  return current.filename === local.filename &&
    current.mimeType === local.mimeType &&
    current.size === local.size &&
    current.section === local.section &&
    current.rowId === local.rowId;
}

function taskAttachmentMetadataMatches(current: CurrentTask["attachments"][number], local: LocalAttachment) {
  return current.filename === local.filename && current.mimeType === local.mimeType && current.size === local.size;
}

async function attachmentsMatch(
  current: CurrentControl,
  localAttachments: LocalAttachment[],
  files: Map<string, Blob>,
) {
  const currentById = new Map(current.attachments.map((item) => [item.id, item]));
  try {
    for (const local of localAttachments) {
      const originId = local.cloudOrigin?.id;
      const cloud = originId ? currentById.get(originId) : undefined;
      const incoming = files.get(local.id);
      if (!cloud || !incoming || !attachmentMetadataMatches(cloud, local)) return false;
      const [cloudBytes, incomingBytes] = await Promise.all([
        read(cloud.storagePath),
        incoming.arrayBuffer().then((value) => new Uint8Array(value)),
      ]);
      if (sha256(cloudBytes) !== sha256(incomingBytes)) return false;
    }
    return true;
  } catch {
    return false;
  }
}

async function taskAttachmentsMatch(current: CurrentTask, localAttachments: LocalAttachment[], files: Map<string, Blob>) {
  const currentById = new Map(current.attachments.map((item) => [item.id, item]));
  try {
    for (const local of localAttachments) {
      const cloud = local.cloudOrigin?.id ? currentById.get(local.cloudOrigin.id) : undefined;
      const incoming = files.get(local.id);
      if (!cloud || !incoming || !taskAttachmentMetadataMatches(cloud, local)) return false;
      const [cloudBytes, incomingBytes] = await Promise.all([read(cloud.storagePath), incoming.arrayBuffer().then((value) => new Uint8Array(value))]);
      if (sha256(cloudBytes) !== sha256(incomingBytes)) return false;
    }
    return current.attachments.length === localAttachments.length;
  } catch { return false; }
}

export async function buildCloudWorkspacePlan(
  db: ImportDatabase,
  organizationId: string,
  bundle: LocalWorkspaceBundleImport,
): Promise<CloudWorkspacePlan> {
  const customerOriginIds = bundle.workspace.customers.flatMap((item) => item.cloudOrigin ? [item.cloudOrigin.id] : []);
  const controlOriginIds = bundle.workspace.controls.flatMap((item) => item.cloudOrigin ? [item.cloudOrigin.id] : []);
  const taskOriginIds = bundle.workspace.workflowTasks.flatMap((item) => item.cloudOrigin ? [item.cloudOrigin.id] : []);
  const activityOriginIds = bundle.workspace.plannedActivities.flatMap((item) => item.cloudOrigin ? [item.cloudOrigin.id] : []);
  const [customers, controls, workflowTasks, plannedActivities] = await Promise.all([
    db.customer.findMany({ where: { organizationId, id: { in: customerOriginIds } } }),
    db.control.findMany({
      where: { organizationId, id: { in: controlOriginIds } },
      include: { attachments: { orderBy: { id: "asc" } } },
    }),
    db.workflowTask.findMany({ where: { organizationId, id: { in: taskOriginIds } }, include: { attachments: { orderBy: { id: "asc" } } } }),
    db.plannedActivity.findMany({ where: { organizationId, id: { in: activityOriginIds } } }),
  ]);
  const customerById = new Map(customers.map((item) => [item.id, item]));
  const controlById = new Map(controls.map((item) => [item.id, item]));
  const taskById = new Map(workflowTasks.map((item) => [item.id, item]));
  const plannedActivityById = new Map(plannedActivities.map((item) => [item.id, item]));
  const customerPlans: CustomerPlan[] = bundle.workspace.customers.map((local) => {
    const current = local.cloudOrigin ? customerById.get(local.cloudOrigin.id) ?? null : null;
    return { local, current, action: planCloudReimport(local.cloudOrigin, current) };
  });
  const controlPlans: ControlPlan[] = [];
  for (const local of bundle.workspace.controls) {
    const current = local.cloudOrigin ? controlById.get(local.cloudOrigin.id) ?? null : null;
    const localAttachments = bundle.workspace.attachments.filter((item) => item.controlId === local.id);
    const originIds = localAttachments.flatMap((item) => item.cloudOrigin ? [item.cloudOrigin.id] : []);
    let action = planCloudControlReimport(
      local.cloudOrigin,
      current ? {
        version: current.version,
        status: current.status,
        attachmentIds: current.attachments.map((item) => item.id),
      } : null,
      originIds,
      localAttachments.length,
    );
    if (action === "UPDATE" && current && !(await attachmentsMatch(current, localAttachments, bundle.files)))
      action = "COPY_CONFLICT";
    controlPlans.push({ local, current, action });
  }
  const taskPlans: TaskPlan[] = [];
  for (const local of bundle.workspace.workflowTasks) {
    const current = local.cloudOrigin ? taskById.get(local.cloudOrigin.id) ?? null : null;
    const localAttachments = bundle.workspace.attachments.filter((item) => item.taskId === local.id);
    let action = planCloudReimport(local.cloudOrigin, current);
    if (action === "UPDATE" && current && !(await taskAttachmentsMatch(current, localAttachments, bundle.files))) action = "COPY_CONFLICT";
    taskPlans.push({ local, current, action });
  }
  const plannedActivityPlans: PlannedActivityPlan[] = bundle.workspace.plannedActivities.map((local) => {
    const current = local.cloudOrigin ? plannedActivityById.get(local.cloudOrigin.id) ?? null : null;
    return { local, current, action: planCloudReimport(local.cloudOrigin, current) };
  });
  const customerActionByLocalId = new Map(customerPlans.map((item) => [item.local.id, item.action]));
  for (const item of controlPlans) {
    if (item.action === "UPDATE" && item.local.customerId &&
        customerActionByLocalId.get(item.local.customerId) === "COPY_CONFLICT")
      item.action = "COPY_CONFLICT";
  }
  const customerActions = customerPlans.map((item) => item.action);
  const controlActions = controlPlans.map((item) => item.action);
  const taskActions = taskPlans.map((item) => item.action);
  const plannedActivityActions = plannedActivityPlans.map((item) => item.action);
  return {
    customers: customerPlans,
    controls: controlPlans,
    workflowTasks: taskPlans,
    plannedActivities: plannedActivityPlans,
    summary: {
      customers: {
        new: count(customerActions, "CREATE"),
        update: count(customerActions, "UPDATE"),
        conflictCopies: count(customerActions, "COPY_CONFLICT"),
      },
      controls: {
        new: count(controlActions, "CREATE"),
        update: count(controlActions, "UPDATE"),
        conflictCopies: count(controlActions, "COPY_CONFLICT"),
      },
      workflowTasks: { new: count(taskActions, "CREATE"), update: count(taskActions, "UPDATE"), conflictCopies: count(taskActions, "COPY_CONFLICT") },
      plannedActivities: { new: count(plannedActivityActions, "CREATE"), update: count(plannedActivityActions, "UPDATE"), conflictCopies: count(plannedActivityActions, "COPY_CONFLICT") },
      attachments: bundle.workspace.attachments.length,
      // Local owner identity is not proof of a Cloud member identity. Keep the
      // current Cloud schedule untouched until a verified binding is designed.
      workSchedule: CLOUD_WORK_SCHEDULE_IMPORT_POLICY,
    },
  };
}

function customerValues(local: LocalCustomer, conflict: boolean) {
  const suffix = " (konfliktkopia)";
  const name = conflict ? `${local.name.slice(0, 200 - suffix.length)}${suffix}` : local.name;
  return {
    name,
    company: local.company,
    address: local.address,
    postalCode: local.postalCode,
    city: local.city,
    email: local.email,
    phone: local.phone,
    mobile: local.mobile,
    lat: local.lat ?? null,
    lng: local.lng ?? null,
    notes: local.notes,
    deletedAt: local.deletedAt ? new Date(local.deletedAt) : null,
  };
}

function controlValues(local: LocalControl, customerId: string | null, projectId: string | null, conflict: boolean, facilityId: string | null = null) {
  const data = normalizeControl(local.data);
  return {
    customerId,
    facilityId,
    projectId,
    title: `${data.meta.name?.trim() || data.meta.proj}${conflict ? " (konfliktkopia)" : ""}`,
    project: data.meta.proj,
    performer: data.meta.perf,
    date: data.meta.date,
    status: local.status,
    data: data as Prisma.InputJsonValue,
    deletedAt: local.deletedAt ? new Date(local.deletedAt) : null,
    postedAt: local.postedAt ? new Date(local.postedAt) : null,
    lastOpenedAt: local.lastOpenedAt ? new Date(local.lastOpenedAt) : null,
    lockToken: null,
    lockedBy: null,
    lockExpiresAt: null,
  };
}

function receiptResult(value: Prisma.JsonValue): Omit<CloudImportResult, "duplicate"> {
  return value as Omit<CloudImportResult, "duplicate">;
}

function revisionsToImport(local: LocalControl, minimumVersion: number, targetVersion: number) {
  const revisions = new Map<number, Prisma.InputJsonValue>();
  for (const revision of local.revisions) {
    if (revision.version > minimumVersion && revision.version <= targetVersion)
      revisions.set(revision.version, normalizeControl(revision.data) as Prisma.InputJsonValue);
  }
  revisions.set(targetVersion, normalizeControl(local.data) as Prisma.InputJsonValue);
  return [...revisions.entries()]
    .sort(([left], [right]) => left - right)
    .map(([version, data]) => ({ version, data }));
}

function taskRevisionsToImport(local: LocalWorkflowTask, minimumVersion: number, targetVersion: number) {
  const revisions = new Map<number, Prisma.InputJsonValue>();
  for (const revision of local.revisions) {
    if (revision.version > minimumVersion && revision.version <= targetVersion)
      revisions.set(revision.version, revision.snapshot as Prisma.InputJsonValue);
  }
  revisions.set(targetVersion, { title: local.title, description: local.description, status: local.status, progress: local.progress, data: local.data, completedAt: local.completedAt } as Prisma.InputJsonValue);
  return [...revisions.entries()].sort(([left], [right]) => left - right).map(([version, snapshot]) => ({ version, snapshot }));
}

export async function executeCloudWorkspaceImport(input: {
  organizationId: string;
  userId: string;
  bundleSha256: string;
  bundle: LocalWorkspaceBundleImport;
}): Promise<CloudImportResult> {
  if (input.bundle.workspace.organization.id !== input.organizationId)
    throw new ApiError(403, "Cloud-kopian tillhör ett annat företag.");
  if (!input.bundle.workspace.cloudSnapshot)
    throw new ApiError(422, "Filen saknar ursprung från Cloud-exporten.");
  const existing = await prisma.cloudImport.findUnique({
    where: { organizationId_bundleSha256: {
      organizationId: input.organizationId,
      bundleSha256: input.bundleSha256,
    } },
  });
  if (existing) return { ...receiptResult(existing.result), duplicate: true };

  const staged = new Map<string, string>();
  try {
    for (const attachment of input.bundle.workspace.attachments) {
      const blob = input.bundle.files.get(attachment.id);
      if (!blob) throw new ApiError(422, "En bilaga saknas i Cloud-kopian.");
      const extension = attachment.storageName.split(".").pop();
      if (!extension) throw new ApiError(422, "En bilaga saknar filändelse.");
      staged.set(attachment.id, await store(new Uint8Array(await blob.arrayBuffer()), extension));
    }

    const committed = await prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM "Organization" WHERE id=${input.organizationId} FOR UPDATE`;
      const duplicate = await tx.cloudImport.findUnique({
        where: { organizationId_bundleSha256: {
          organizationId: input.organizationId,
          bundleSha256: input.bundleSha256,
        } },
      });
      if (duplicate) return { result: { ...receiptResult(duplicate.result), duplicate: true }, used: [] as string[] };

      for (const id of [...new Set(input.bundle.workspace.customers.flatMap((item) => item.cloudOrigin ? [item.cloudOrigin.id] : []))].sort())
        await tx.$queryRaw`SELECT id FROM "Customer" WHERE id=${id} AND "organizationId"=${input.organizationId} FOR UPDATE`;
      for (const id of [...new Set(input.bundle.workspace.controls.flatMap((item) => item.cloudOrigin ? [item.cloudOrigin.id] : []))].sort())
        await tx.$queryRaw`SELECT id FROM "Control" WHERE id=${id} AND "organizationId"=${input.organizationId} FOR UPDATE`;
      for (const id of [...new Set(input.bundle.workspace.workflowTasks.flatMap((item) => item.cloudOrigin ? [item.cloudOrigin.id] : []))].sort())
        await tx.$queryRaw`SELECT id FROM "WorkflowTask" WHERE id=${id} AND "organizationId"=${input.organizationId} FOR UPDATE`;
      for (const id of [...new Set(input.bundle.workspace.plannedActivities.flatMap((item) => item.cloudOrigin ? [item.cloudOrigin.id] : []))].sort())
        await tx.$queryRaw`SELECT id FROM "PlannedActivity" WHERE id=${id} AND "organizationId"=${input.organizationId} FOR UPDATE`;

      const plan = await buildCloudWorkspacePlan(tx, input.organizationId, input.bundle);
      const customerIds = new Map<string, string>();
      for (const item of plan.customers) {
        if (item.action === "UPDATE" && item.current) {
          const changed = await tx.customer.updateMany({
            where: {
              id: item.current.id,
              organizationId: input.organizationId,
              version: item.local.cloudOrigin!.version,
            },
            data: {
              ...customerValues(item.local, false),
              version: Math.max(item.current.version + 1, item.local.version),
            },
          });
          if (!changed.count) throw new ApiError(409, "En kund ändrades medan återimporten förbereddes. Förhandsgranska filen igen.");
          customerIds.set(item.local.id, item.current.id);
        } else {
          const created = await tx.customer.create({
            data: {
              organizationId: input.organizationId,
              ...customerValues(item.local, item.action === "COPY_CONFLICT"),
              version: Math.max(1, item.local.version),
            },
          });
          customerIds.set(item.local.id, created.id);
        }
      }

      // Customer facilities (decision 11): updated in place when they came from Cloud and still belong to the same
      // customer, otherwise created (for example under a conflict copy of the customer).
      const facilityIds = new Map<string, string>();
      for (const local of input.bundle.workspace.customerFacilities) {
        const customerId = customerIds.get(local.customerId);
        if (!customerId) continue;
        const values = { name: local.name, address: local.address, postalCode: local.postalCode, city: local.city, description: local.description, isActive: local.isActive, updatedBy: input.userId };
        const current = local.cloudOrigin ? await tx.customerFacility.findFirst({ where: { id: local.cloudOrigin.id, organizationId: input.organizationId, customerId }, select: { id: true } }) : null;
        if (current) {
          await tx.customerFacility.update({ where: { id: current.id }, data: { ...values, version: { increment: 1 } } });
          facilityIds.set(local.id, current.id);
        } else {
          const created = await tx.customerFacility.create({ data: { organizationId: input.organizationId, customerId, ...values, createdBy: input.userId }, select: { id: true } });
          facilityIds.set(local.id, created.id);
        }
      }
      const facilityFor = (localFacilityId: string | null) => localFacilityId ? facilityIds.get(localFacilityId) ?? null : null;

      const used: string[] = [];
      const projectIds = new Map<string, string>();
      for (const local of input.bundle.workspace.projects) {
        const customerId = local.customerId ? customerIds.get(local.customerId) ?? null : null;
        const current = local.cloudOrigin
          ? await tx.project.findFirst({ where: { id: local.cloudOrigin.id, organizationId: input.organizationId } })
          : null;
        if (current) {
          await tx.project.update({
            where: { id: current.id },
            data: {
              name: local.name,
              description: local.description,
              startDate: local.startDate,
              dueDate: local.dueDate,
              client: local.client,
              contactPerson: local.contactPerson,
              reference: local.reference,
              workSite: local.workSite,
              taskTypes: local.taskTypes,
              workMoments: local.workMoments,
              customerId,
              facilityId: facilityFor(local.facilityId),
              responsibleUserId: null,
              responsibleName: local.responsibleName,
              timeBudgetMinutes: local.timeBudgetMinutes,
              archivedAt: local.archivedAt ? new Date(local.archivedAt) : null,
              closedAt: local.closedAt ? new Date(local.closedAt) : null,
              updatedBy: input.userId,
            },
          });
          projectIds.set(local.id, current.id);
        } else {
          const created = await tx.project.create({
            data: {
              organizationId: input.organizationId,
              name: local.name,
              description: local.description,
              startDate: local.startDate,
              dueDate: local.dueDate,
              client: local.client,
              contactPerson: local.contactPerson,
              reference: local.reference,
              workSite: local.workSite,
              taskTypes: local.taskTypes,
              workMoments: local.workMoments,
              customerId,
              facilityId: facilityFor(local.facilityId),
              responsibleUserId: null,
              responsibleName: local.responsibleName,
              timeBudgetMinutes: local.timeBudgetMinutes,
              archivedAt: local.archivedAt ? new Date(local.archivedAt) : null,
              closedAt: local.closedAt ? new Date(local.closedAt) : null,
              createdBy: input.userId,
              updatedBy: input.userId,
            },
          });
          projectIds.set(local.id, created.id);
        }
        const targetProjectId = projectIds.get(local.id)!;
        await tx.projectEvent.deleteMany({ where: { projectId: targetProjectId } });
        if (local.events.length) await tx.projectEvent.createMany({ data: local.events.map((event) => ({ organizationId: input.organizationId, projectId: targetProjectId, kind: event.kind, summary: event.summary, actorName: event.actorName, createdBy: input.userId, createdAt: new Date(event.createdAt) })) });
        // The decision log is append-only: decisions already in Cloud stay, and only decisions made in Local are added.
        const existingDecisions = await tx.projectDecision.findMany({ where: { organizationId: input.organizationId, projectId: targetProjectId }, select: { decidedOn: true, text: true, decidedBy: true, createdAt: true } });
        const decisionSignatures = new Set(existingDecisions.map((decision) => `${decision.decidedOn}|${decision.decidedBy}|${decision.createdAt.toISOString()}|${decision.text}`));
        const importedDecisions = local.decisions.filter((decision) => !decisionSignatures.has(`${decision.decidedOn}|${decision.decidedBy}|${new Date(decision.createdAt).toISOString()}|${decision.text}`));
        if (importedDecisions.length) await tx.projectDecision.createMany({ data: importedDecisions.map((decision) => ({ organizationId: input.organizationId, projectId: targetProjectId, decidedOn: decision.decidedOn, text: decision.text, decidedBy: decision.decidedBy, actorName: decision.actorName, createdBy: input.userId, createdAt: new Date(decision.createdAt) })) });
      }
      const workflowTaskIds = new Map<string, string>();
      // Local entry id -> Cloud entry id. An updated task keeps its entries' Cloud ids so the Cloud history stays linked.
      const entryIds = new Map<string, string>();
      const cloudEntryId = (localId: string) => { let id = entryIds.get(localId); if (!id) { id = randomUUID(); entryIds.set(localId, id); } return id; };
      // Cloud entry ids released by replacing a task's or control's entries; an entry moved to a control in Local keeps its id.
      const releasedEntryIds = new Set<string>();
      for (const item of plan.workflowTasks) {
        const local = item.local;
        const customerId = local.customerId ? customerIds.get(local.customerId) ?? null : null;
        const projectId = local.projectId ? projectIds.get(local.projectId) ?? null : null;
        const current = item.current;
        // A protocol from a form keeps its template version; the stored, immutable version replaces the file's copy.
        // It also keeps its form's permission area (Daniel 2026-09-27: controls and risk assessments as forms).
        let form: { formTemplateId: string | null; formTemplateVersion: number | null; formArea?: string | null } = { formTemplateId: null, formTemplateVersion: null };
        let data = local.data;
        if (local.data.kind === "FORM") {
          const details = local.data.details;
          const stored = await tx.formTemplateVersion.findUnique({ where: { templateId_version: { templateId: details.templateId, version: details.templateVersion } }, include: { template: { select: { permissionArea: true } } } });
          // A form deleted after the export (Daniel 2026-09-26): the Cloud protocol's own copy of the form is kept.
          const deleted = !stored && current ? await tx.workflowTask.findFirst({ where: { id: current.id, kind: "FORM", formTemplateId: null }, select: { data: true } }) : null;
          if (!stored && !deleted) throw new ApiError(422, `Protokollet ${local.title} kommer från ett formulär som inte finns hos HINTEK. Återimporten avbröts.`);
          if (stored) {
            form = { formTemplateId: stored.templateId, formTemplateVersion: stored.version, formArea: stored.template.permissionArea };
            data = { kind: "FORM", details: { ...details, templateName: stored.name, document: formDocumentSchema.parse(stored.document) } };
          } else {
            const kept = (deleted!.data as { details: { document: unknown; templateName: string } }).details;
            data = { kind: "FORM", details: { ...details, templateName: kept.templateName, document: formDocumentSchema.parse(kept.document) } };
          }
        }
        const values = {
          projectId, customerId, facilityId: facilityFor(local.facilityId), siteId: local.siteId, departmentId: local.departmentId,
          kind: local.kind, ...form, title: local.title, description: local.description,
          status: local.status, progress: local.progress,
          assignedToUserId: local.assignedToUserId, assignedToName: local.assignedToName,
          dueDate: local.dueDate, data: data as Prisma.InputJsonValue,
          startedAt: local.startedAt ? new Date(local.startedAt) : null,
          completedAt: local.completedAt ? new Date(local.completedAt) : null,
          updatedBy: input.userId,
        };
        let taskId: string;
        let version: number;
        let minimumRevisionVersion: number;
        if (item.action === "UPDATE" && current) {
          version = Math.max(current.version + 1, local.version);
          minimumRevisionVersion = current.version;
          const changed = await tx.workflowTask.updateMany({ where: { id: current.id, organizationId: input.organizationId, version: local.cloudOrigin!.version }, data: { ...values, version } });
          if (!changed.count) throw new ApiError(409, "En uppgift ändrades medan återimporten förbereddes. Förhandsgranska filen igen.");
          for (const entry of await tx.workflowTimeEntry.findMany({ where: { taskId: current.id }, select: { id: true } })) releasedEntryIds.add(entry.id);
          await tx.workflowTimeEntry.deleteMany({ where: { taskId: current.id } });
          for (const entry of local.timeEntries) if (entry.cloudOrigin && releasedEntryIds.has(entry.cloudOrigin.id)) entryIds.set(entry.id, entry.cloudOrigin.id);
          taskId = current.id;
        } else {
          version = Math.max(1, local.version);
          minimumRevisionVersion = 0;
          const created = await tx.workflowTask.create({
            data: { organizationId: input.organizationId, ...values, title: item.action === "COPY_CONFLICT" ? `${local.title} (konfliktkopia)` : local.title, version, createdBy: input.userId },
          });
          taskId = created.id;
        }
        workflowTaskIds.set(local.id, taskId);
        if (local.timeEntries.length) await tx.workflowTimeEntry.createMany({
          data: local.timeEntries.map((entry) => ({ id: cloudEntryId(entry.id), taskId, userId: entry.userId, startedAt: new Date(entry.startedAt), endedAt: entry.endedAt ? new Date(entry.endedAt) : null, durationSec: entry.durationSec, note: entry.note, createdAt: new Date(entry.createdAt), updatedAt: new Date(entry.updatedAt) })),
        });
        for (const revision of taskRevisionsToImport(local, minimumRevisionVersion, version))
          await tx.workflowTaskRevision.create({ data: { taskId, version: revision.version, snapshot: revision.snapshot, createdBy: input.userId } });
        if (item.action !== "UPDATE") {
          for (const attachment of input.bundle.workspace.attachments.filter((candidate) => candidate.taskId === local.id)) {
            const storagePath = staged.get(attachment.id);
            if (!storagePath) throw new ApiError(422, "En förberedd uppgiftsbilaga saknas.");
            await tx.workflowTaskAttachment.create({ data: { organizationId: input.organizationId, taskId, filename: attachment.filename, storagePath, mimeType: attachment.mimeType, size: attachment.size, createdAt: new Date(attachment.createdAt) } });
            used.push(storagePath);
          }
        }
      }
      for (const project of input.bundle.workspace.projects) {
        const projectId = projectIds.get(project.id);
        if (!projectId) continue;
        for (const event of project.events) {
          const taskId = event.taskId ? workflowTaskIds.get(event.taskId) : null;
          if (taskId) await tx.projectEvent.updateMany({
            where: { projectId, summary: event.summary, createdAt: new Date(event.createdAt) },
            data: { taskId },
          });
        }
      }
      const controlIds = new Map<string, string>();
      for (const item of plan.controls) {
        const customerId = item.local.customerId ? customerIds.get(item.local.customerId) ?? null : null;
        const projectId = item.local.projectId ? projectIds.get(item.local.projectId) ?? null : null;
        const values = controlValues(item.local, customerId, projectId, item.action === "COPY_CONFLICT", facilityFor(item.local.facilityId));
        let controlId: string;
        let nextVersion: number;
        let minimumRevisionVersion: number;
        if (item.action === "UPDATE" && item.current) {
          nextVersion = Math.max(item.current.version + 1, item.local.version);
          minimumRevisionVersion = item.current.version;
          const changed = await tx.control.updateMany({
            where: {
              id: item.current.id,
              organizationId: input.organizationId,
              version: item.local.cloudOrigin!.version,
            },
            data: { ...values, updatedBy: input.userId, version: nextVersion },
          });
          if (!changed.count) throw new ApiError(409, "En kontroll ändrades medan återimporten förbereddes. Förhandsgranska filen igen.");
          controlId = item.current.id;
        } else {
          nextVersion = Math.max(1, item.local.version);
          minimumRevisionVersion = 0;
          const created = await tx.control.create({
            data: {
              organizationId: input.organizationId,
              ...values,
              version: nextVersion,
              siteId: item.action === "COPY_CONFLICT" ? item.current?.siteId ?? null : null,
              departmentId: item.action === "COPY_CONFLICT" ? item.current?.departmentId ?? null : null,
              createdBy: input.userId,
              updatedBy: input.userId,
            },
          });
          controlId = created.id;
          const localAttachments = input.bundle.workspace.attachments.filter((attachment) => attachment.controlId === item.local.id);
          for (const attachment of localAttachments) {
            const storagePath = staged.get(attachment.id);
            if (!storagePath) throw new ApiError(422, "En förberedd bilaga saknas.");
            await tx.attachment.create({
              data: {
                organizationId: input.organizationId,
                controlId,
                filename: attachment.filename,
                storagePath,
                mimeType: attachment.mimeType,
                size: attachment.size,
                section: attachment.section,
                rowId: attachment.rowId,
                createdAt: new Date(attachment.createdAt),
              },
            });
            used.push(storagePath);
          }
        }
        for (const revision of revisionsToImport(item.local, minimumRevisionVersion, nextVersion))
          await tx.controlRevision.create({
            data: {
              controlId,
              version: revision.version,
              data: revision.data,
              createdBy: input.userId,
            },
          });
        controlIds.set(item.local.id, controlId);
        // Manual time on the control (decision 13), handled like a task's: an updated control keeps its entries' Cloud ids.
        if (item.action === "UPDATE" && item.current) {
          for (const entry of await tx.workflowTimeEntry.findMany({ where: { controlId }, select: { id: true } })) releasedEntryIds.add(entry.id);
          await tx.workflowTimeEntry.deleteMany({ where: { controlId } });
        }
        for (const entry of item.local.timeEntries) if (entry.cloudOrigin && releasedEntryIds.has(entry.cloudOrigin.id) && !entryIds.has(entry.id)) entryIds.set(entry.id, entry.cloudOrigin.id);
        if (item.local.timeEntries.length) await tx.workflowTimeEntry.createMany({
          data: item.local.timeEntries.map((entry) => ({ id: cloudEntryId(entry.id), controlId, userId: entry.userId, startedAt: new Date(entry.startedAt), endedAt: entry.endedAt ? new Date(entry.endedAt) : null, durationSec: entry.durationSec, note: entry.note, createdAt: new Date(entry.createdAt), updatedAt: new Date(entry.updatedAt) })),
        });
      }

      // Time history recorded in Local joins the Cloud history; events that came from Cloud already exist there.
      const localTimeEvents = input.bundle.workspace.timeEntryEvents.filter((event) => !event.cloudOrigin);
      const cloudSnapshot = (snapshot: (typeof localTimeEvents)[number]["previous"]) => snapshot
        ? { ...snapshot, taskId: workflowTaskIds.get(snapshot.taskId) ?? controlIds.get(snapshot.taskId) ?? snapshot.taskId } as Prisma.InputJsonValue
        : Prisma.JsonNull;
      if (localTimeEvents.length) await tx.workflowTimeEntryEvent.createMany({
        data: localTimeEvents.map((event) => ({
          organizationId: input.organizationId, entryId: cloudEntryId(event.entryId), userId: event.userId, action: event.action,
          previous: cloudSnapshot(event.previous), next: cloudSnapshot(event.next), reason: event.reason,
          actorUserId: event.actorUserId, actorName: event.actorName, createdAt: new Date(event.createdAt),
        })),
      });

      for (const item of plan.plannedActivities) {
        const local = item.local;
        const projectId = local.projectId ? projectIds.get(local.projectId) ?? null : null;
        const workflowTaskId = local.workflowTaskId ? workflowTaskIds.get(local.workflowTaskId) ?? null : null;
        const controlId = local.controlId ? controlIds.get(local.controlId) ?? null : null;
        if (local.projectId && !projectId) throw new ApiError(422, "Planeringen saknar sitt projekt vid återimport.");
        if (local.workflowTaskId && !workflowTaskId) throw new ApiError(422, "Planeringen saknar sin uppgift vid återimport.");
        if (local.controlId && !controlId) throw new ApiError(422, "Planeringen saknar sin kontroll vid återimport.");
        const requestedAssignments = plannedActivityAssignments(local);
        const requestedAssigneeIds = requestedAssignments.map((assignment) => assignment.userId);
        const assignmentMembers = requestedAssigneeIds.length ? await tx.organizationMember.findMany({
          where: { organizationId: input.organizationId, isActive: true, userId: { in: requestedAssigneeIds }, user: { is: { isActive: true } } },
          select: { id: true, userId: true, user: { select: { name: true, email: true } } },
        }) : [];
        const memberByUserId = new Map(assignmentMembers.map((member) => [member.userId, member]));
        const assignments = requestedAssigneeIds.flatMap((userId) => {
          const member = memberByUserId.get(userId);
          return member ? [member] : [];
        });
        const assignmentNames = assignments.map((member) => member.user.name || member.user.email).join(", ");
        const values = {
          projectId,
          workflowTaskId,
          controlId,
          title: item.action === "COPY_CONFLICT" ? `${local.title} (konfliktkopia)` : local.title,
          description: local.description,
          kind: local.kind,
          status: local.status,
          startsAt: new Date(local.startsAt),
          endsAt: new Date(local.endsAt),
          assignedToUserId: assignments[0]?.userId ?? null,
          assignedToName: assignmentNames || local.assignedToName,
          deletedAt: local.deletedAt ? new Date(local.deletedAt) : null,
          updatedBy: input.userId,
        };
        let activityId: string;
        let version: number;
        if (item.action === "UPDATE" && item.current) {
          version = Math.max(item.current.version + 1, local.version);
          const changed = await tx.plannedActivity.updateMany({
            where: { id: item.current.id, organizationId: input.organizationId, version: local.cloudOrigin!.version },
            data: { ...values, version },
          });
          if (!changed.count) throw new ApiError(409, "En planering ändrades medan återimporten förbereddes. Förhandsgranska filen igen.");
          activityId = item.current.id;
        } else {
          version = Math.max(1, local.version);
          const created = await tx.plannedActivity.create({
            data: { organizationId: input.organizationId, ...values, version, createdBy: input.userId },
          });
          activityId = created.id;
        }
        await tx.plannedActivityAssignment.deleteMany({ where: { organizationId: input.organizationId, plannedActivityId: activityId } });
        if (assignments.length) await tx.plannedActivityAssignment.createMany({
          data: assignments.map((member) => {
            const allocation = requestedAssignments.find((assignment) => assignment.userId === member.userId)!;
            return { organizationId: input.organizationId, plannedActivityId: activityId, memberId: member.id,
              plannedMinutes: allocation.plannedMinutes, startsAt: allocation.startsAt ? new Date(allocation.startsAt) : null, endsAt: allocation.endsAt ? new Date(allocation.endsAt) : null };
          }),
        });
        const existingEvents = await tx.plannedActivityEvent.findMany({
          where: { organizationId: input.organizationId, plannedActivityId: activityId },
          select: { kind: true, summary: true, createdAt: true },
        });
        const existingSignatures = new Set(existingEvents.map((event) => `${event.kind}|${event.summary}|${event.createdAt.toISOString()}`));
        const importedEvents = local.events.filter((event) => !existingSignatures.has(`${event.kind}|${event.summary}|${event.createdAt}`));
        if (importedEvents.length) await tx.plannedActivityEvent.createMany({
          data: importedEvents.map((event) => ({
            organizationId: input.organizationId,
            plannedActivityId: activityId,
            kind: event.kind,
            summary: event.summary,
            snapshot: event.snapshot as Prisma.InputJsonValue,
            actorName: event.actorName,
            createdBy: input.userId,
            createdAt: new Date(event.createdAt),
          })),
        });
      }

      const receipt = await tx.cloudImport.create({
        data: {
          organizationId: input.organizationId,
          bundleSha256: input.bundleSha256,
          sourceWorkspaceId: input.bundle.workspace.workspaceId,
          snapshotExportedAt: new Date(input.bundle.workspace.cloudSnapshot!.exportedAt),
          importedBy: input.userId,
          result: { ...plan.summary, importId: "pending" },
        },
      });
      const result = { ...plan.summary, importId: receipt.id };
      await tx.cloudImport.update({ where: { id: receipt.id }, data: { result } });
      return { result: { ...result, duplicate: false }, used };
    }, { timeout: 60_000 });

    const used = new Set(committed.used);
    await Promise.all([...staged.values()].filter((path) => !used.has(path)).map(remove));
    return committed.result;
  } catch (error) {
    await Promise.all([...staged.values()].map(remove));
    throw error;
  }
}
