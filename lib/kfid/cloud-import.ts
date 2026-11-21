import { createHash, randomUUID } from "node:crypto";
import { placeObjectOf } from "@/lib/workflow/maintenance";
import { Prisma } from "@prisma/client";
import { formDocumentSchema } from "@/lib/workflow/form-document";
import { prisma } from "@/lib/db";
import { ApiError } from "@/lib/kfid/errors";
import { visibleFormVersionWhere } from "@/lib/kfid/form-scope";
import { planCloudReimport } from "@/lib/kfid/cloud-reimport";
import { read, remove, store } from "@/lib/kfid/storage";
import { CLOUD_WORK_SCHEDULE_IMPORT_POLICY } from "@/lib/workflow/work-schedule";
import { plannedActivityAssignments } from "@/lib/workflow/planned-activity";
import { importedStaffRegister } from "@/lib/workflow/staff-register";
import { importFormSettings } from "@/lib/kfid/cloud-import-form-settings";
import type { FormSettingsSummary } from "@/lib/kfid/form-settings-reimport";
import { importSelfInspection } from "@/lib/self-inspection/transfer";
import { commentsToRestore } from "@/lib/comments/model";
import { catalogueTransferRows, importCatalogueTransfer, parseCatalogueTransfer, type CatalogueImportSummary } from "@/lib/catalogue/transfer";
import type { LocalWorkspaceBundleImport } from "@/features/kfid/local-workspace-bundle";
import type { LocalAttachment, LocalCustomer, LocalPlannedActivity, LocalWorkflowTask } from "@/features/kfid/local-workspace-store";
import { roundPeriodError } from "@/lib/workflow/round-work-orders";
import { isDraftStatus } from "@/lib/workflow/work-order-link";
import { assertReplacedTimeOpen } from "@/lib/workflow/time-period-lock";
import { keepStoreRows } from "@/lib/workflow/store-rows";
import type { MaterialRow } from "@/lib/workflow/expenses";

/** What a replaced time entry is compared on (Tidsperiod, 2026-10-30). */
const replacedTimeSelect = { userId: true, startedAt: true, endedAt: true, durationSec: true, note: true } as const;

type ImportDatabase = Pick<Prisma.TransactionClient, "customer" | "workflowTask" | "plannedActivity" | "plannedActivityAssignment" | "organizationMember">;
type CurrentCustomer = Prisma.CustomerGetPayload<Record<string, never>>;
type CurrentTask = Prisma.WorkflowTaskGetPayload<{ include: { attachments: true } }>;
type CurrentPlannedActivity = Prisma.PlannedActivityGetPayload<Record<string, never>>;
type ImportAction = "CREATE" | "UPDATE" | "COPY_CONFLICT";

type CustomerPlan = { local: LocalCustomer; current: CurrentCustomer | null; action: ImportAction };
type TaskPlan = { local: LocalWorkflowTask; current: CurrentTask | null; action: ImportAction };
type PlannedActivityPlan = { local: LocalPlannedActivity; current: CurrentPlannedActivity | null; action: ImportAction };

export type CloudWorkspacePlan = {
  customers: CustomerPlan[];
  workflowTasks: TaskPlan[];
  plannedActivities: PlannedActivityPlan[];
  summary: {
    customers: { new: number; update: number; conflictCopies: number };
    workflowTasks: { new: number; update: number; conflictCopies: number };
    plannedActivities: { new: number; update: number; conflictCopies: number };
    attachments: number;
    workSchedule: typeof CLOUD_WORK_SCHEDULE_IMPORT_POLICY;
  };
};

export type CloudImportResult = CloudWorkspacePlan["summary"] & {
  /** Limit profiles and round schedules (2026-10-06); absent in receipts from before. */
  formSettings?: FormSettingsSummary;
  /** Artiklar och priser (2026-10-08): what the file added; null when the file had none, absent in older receipts. */
  catalogue?: CatalogueImportSummary | null;
  /** Kommentarer (beslut 14): how many came back with a job the import had to create; absent in older receipts. */
  comments?: number;
  importId: string;
  duplicate: boolean;
};

function sha256(bytes: Uint8Array) {
  return createHash("sha256").update(bytes).digest("hex");
}

function count(actions: ImportAction[], action: ImportAction) {
  return actions.filter((item) => item === action).length;
}

function taskAttachmentMetadataMatches(current: CurrentTask["attachments"][number], local: LocalAttachment) {
  return current.filename === local.filename && current.mimeType === local.mimeType && current.size === local.size;
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
  const taskOriginIds = bundle.workspace.workflowTasks.flatMap((item) => item.cloudOrigin ? [item.cloudOrigin.id] : []);
  const activityOriginIds = bundle.workspace.plannedActivities.flatMap((item) => item.cloudOrigin ? [item.cloudOrigin.id] : []);
  const [customers, workflowTasks, plannedActivities] = await Promise.all([
    db.customer.findMany({ where: { organizationId, id: { in: customerOriginIds } } }),
    db.workflowTask.findMany({ where: { organizationId, id: { in: taskOriginIds } }, include: { attachments: { orderBy: { id: "asc" } } } }),
    db.plannedActivity.findMany({ where: { organizationId, id: { in: activityOriginIds } } }),
  ]);
  const customerById = new Map(customers.map((item) => [item.id, item]));
  const taskById = new Map(workflowTasks.map((item) => [item.id, item]));
  const plannedActivityById = new Map(plannedActivities.map((item) => [item.id, item]));
  const customerPlans: CustomerPlan[] = bundle.workspace.customers.map((local) => {
    const current = local.cloudOrigin ? customerById.get(local.cloudOrigin.id) ?? null : null;
    return { local, current, action: planCloudReimport(local.cloudOrigin, current) };
  });
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
  const customerActions = customerPlans.map((item) => item.action);
  const taskActions = taskPlans.map((item) => item.action);
  const plannedActivityActions = plannedActivityPlans.map((item) => item.action);
  return {
    customers: customerPlans,
    workflowTasks: taskPlans,
    plannedActivities: plannedActivityPlans,
    summary: {
      customers: {
        new: count(customerActions, "CREATE"),
        update: count(customerActions, "UPDATE"),
        conflictCopies: count(customerActions, "COPY_CONFLICT"),
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
    // Särskilda krav (2026-10-07): a file from before the field leaves what Cloud holds as it is.
    ...(local.specialRequirements !== undefined ? { specialRequirements: local.specialRequirements } : {}),
    // Kundtyp (2026-10-10): likewise, a file from before the field leaves the stored type (a new customer is a company).
    ...(local.customerType !== undefined ? { customerType: local.customerType } : {}),
    // Kundnummer i bokföringen (2026-10-11): likewise.
    ...(local.accountingCustomerNumber !== undefined ? { accountingCustomerNumber: local.accountingCustomerNumber } : {}),
    deletedAt: local.deletedAt ? new Date(local.deletedAt) : null,
  };
}

function receiptResult(value: Prisma.JsonValue): Omit<CloudImportResult, "duplicate"> {
  return value as Omit<CloudImportResult, "duplicate">;
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
  // Artiklar och priser (2026-10-08): the section is checked before anything is stored.
  const catalogueTransfer = parseCatalogueTransfer(input.bundle.workspace.catalogue);

  const staged = new Map<string, string>();
  try {
    for (const attachment of input.bundle.workspace.attachments) {
      const blob = input.bundle.files.get(attachment.id);
      if (!blob) throw new ApiError(422, "En bilaga saknas med serverlagring-kopian.");
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
      for (const id of [...new Set(input.bundle.workspace.workflowTasks.flatMap((item) => item.cloudOrigin ? [item.cloudOrigin.id] : []))].sort())
        await tx.$queryRaw`SELECT id FROM "WorkflowTask" WHERE id=${id} AND "organizationId"=${input.organizationId} FOR UPDATE`;
      for (const id of [...new Set(input.bundle.workspace.plannedActivities.flatMap((item) => item.cloudOrigin ? [item.cloudOrigin.id] : []))].sort())
        await tx.$queryRaw`SELECT id FROM "PlannedActivity" WHERE id=${id} AND "organizationId"=${input.organizationId} FOR UPDATE`;

      const plan = await buildCloudWorkspacePlan(tx, input.organizationId, input.bundle);
      // Kundisolering (2026-10-13): a person named in the file must belong to the company – a member (also a former one)
      // or someone the company's own time already names. An assignment to anyone else is let go (the name stays as
      // text); time for anyone else stops the import, since it cannot be written without a person.
      const members = new Set((await tx.organizationMember.findMany({ where: { organizationId: input.organizationId }, select: { userId: true } })).map((member) => member.userId));
      const knownPeople = new Set([...members, input.userId,
        ...(await tx.workflowTimeEntry.findMany({ where: { OR: [{ task: { is: { organizationId: input.organizationId } } }, { project: { is: { organizationId: input.organizationId } } }] }, select: { userId: true }, distinct: ["userId"] })).map((entry) => entry.userId)]);
      const named = [
        ...input.bundle.workspace.workflowTasks.flatMap((task) => task.timeEntries.map((entry) => entry.userId)),
        ...input.bundle.workspace.projects.flatMap((project) => project.timeEntries.map((entry) => entry.userId)),
        ...input.bundle.workspace.timeEntryEvents.filter((event) => !event.cloudOrigin).flatMap((event) => [event.userId, event.actorUserId]),
      ];
      if (named.some((userId) => !knownPeople.has(userId))) throw new ApiError(422, "Filen har tid för en person som inte hör till företaget. Återimporten avbröts.");
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
        const values = { name: local.name, kind: local.kind, latitude: local.latitude, longitude: local.longitude, address: local.address, postalCode: local.postalCode, city: local.city, description: local.description, isActive: local.isActive,
          // Object data (Underhåll stage 2, 2026-10-06) comes back with the place.
          ...placeObjectOf(local), updatedBy: input.userId };
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
      // The place tree once every place exists: a parent that did not come along leaves the place on the top level.
      for (const local of input.bundle.workspace.customerFacilities) {
        const id = facilityIds.get(local.id);
        if (id) await tx.customerFacility.update({ where: { id }, data: { parentId: facilityFor(local.parentId ?? null) } });
      }

      const used: string[] = [];
      const projectIds = new Map<string, string>();
      // Kommentarer (beslut 14): the parents this import created. A parent still in Cloud keeps Cloud's own thread.
      const createdProjects = new Map<string, string>();
      const createdWorkOrders = new Map<string, string>();
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
              staffRegister: importedStaffRegister(local.staffRegister, current.staffRegister),
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
              staffRegister: importedStaffRegister(local.staffRegister),
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
          createdProjects.set(local.id, created.id);
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
      // Cloud entry ids released by replacing a task's entries; an entry moved to another task in Local keeps its id.
      const releasedEntryIds = new Set<string>();
      // Arbetsordern styr (2026-10-26): a task is written with its work order (the database requires it), so the work
      // orders come first; the file (schema 12, older files upgraded when read) names a work order in it for every task.
      const orderedTasks = [...plan.workflowTasks].sort((a, b) => Number(b.local.kind === "WORK_ORDER") - Number(a.local.kind === "WORK_ORDER"));
      // Driftrond i arbetsordern (2026-10-27): a work order keeps the round it holds when the round came from Cloud and its
      // period is valid and free in Cloud; a 0.24.0 work order per day keeps its round when the day is free. Otherwise the
      // work order comes in as an ordinary one (its protocols keep their round and day) – nothing is refused for it.
      const roundKeyFor = async (local: (typeof orderedTasks)[number]["local"], currentId: string | null) => {
        if (local.kind !== "WORK_ORDER" || !local.roundScheduleId) return { roundScheduleId: null, roundOccurrence: null };
        const schedule = input.bundle.workspace.formSchedules.find((item) => item.id === local.roundScheduleId);
        const cloudScheduleId = schedule?.cloudOrigin?.id;
        const none = { roundScheduleId: null, roundOccurrence: null };
        if (!cloudScheduleId || !(await tx.formSchedule.findFirst({ where: { id: cloudScheduleId, organizationId: input.organizationId }, select: { id: true } }))) return none;
        const others = { organizationId: input.organizationId, roundScheduleId: cloudScheduleId, ...(currentId ? { id: { not: currentId } } : {}) };
        if (local.roundOccurrence) {
          const taken = await tx.workflowTask.findFirst({ where: { ...others, roundOccurrence: local.roundOccurrence }, select: { id: true } });
          return taken ? none : { roundScheduleId: cloudScheduleId, roundOccurrence: local.roundOccurrence };
        }
        const period = { from: local.plannedStartDate ?? "", to: local.dueDate };
        if (roundPeriodError(period)) return none;
        const overlapping = local.status === "CANCELLED" ? null : await tx.workflowTask.findFirst({ where: { ...others, roundOccurrence: null, status: { not: "CANCELLED" }, plannedStartDate: { lte: period.to }, dueDate: { gte: period.from } }, select: { id: true } });
        return overlapping ? none : { roundScheduleId: cloudScheduleId, roundOccurrence: null };
      };
      // Rapporterad från (2026-10-27): an entry's task, set once every task is written and linked (file entry id -> file task id).
      const entrySources: { entryId: string; localTaskId: string; localOrderId: string }[] = [];
      for (const item of orderedTasks) {
        const local = item.local;
        const customerId = local.customerId ? customerIds.get(local.customerId) ?? null : null;
        const projectId = local.projectId ? projectIds.get(local.projectId) ?? null : null;
        const current = item.current;
        // A protocol from a form keeps its template version; the stored, immutable version replaces the file's copy.
        // It also keeps its form's permission area (2026-09-27: controls and risk assessments as forms).
        let form: { formTemplateId: string | null; formTemplateVersion: number | null; formArea?: string | null } = { formTemplateId: null, formTemplateVersion: null };
        let data = local.data;
        if (local.data.kind === "FORM") {
          const details = local.data.details;
          // Only Workflow's forms and the company's own: a file naming another company's form id is refused (tenant isolation).
          const stored = await tx.formTemplateVersion.findFirst({ where: visibleFormVersionWhere(input.organizationId, details.templateId, details.templateVersion), include: { template: { select: { permissionArea: true } } } });
          // A form deleted after the export (2026-09-26): the Cloud protocol's own copy of the form is kept.
          const deleted = !stored && current ? await tx.workflowTask.findFirst({ where: { id: current.id, kind: "FORM", formTemplateId: null }, select: { data: true } }) : null;
          if (!stored && !deleted) throw new ApiError(422, `Protokollet ${local.title} kommer från ett formulär som inte finns på servern. Återimporten avbröts.`);
          if (stored) {
            form = { formTemplateId: stored.templateId, formTemplateVersion: stored.version, formArea: stored.template.permissionArea };
            data = { kind: "FORM", details: { ...details, templateName: stored.name, document: formDocumentSchema.parse(stored.document) } };
          } else {
            const kept = (deleted!.data as { details: { document: unknown; templateName: string } }).details;
            data = { kind: "FORM", details: { ...details, templateName: kept.templateName, document: formDocumentSchema.parse(kept.document) } };
          }
        }
        // Uttag ur förrådet (2026-10-30): the store's rows are the store's – an update keeps Cloud's, a copy gets none.
        if (local.data.kind === "WORK_ORDER") {
          const stored = item.action === "UPDATE" && current ? (current.data as { details?: { materials?: unknown } } | null)?.details?.materials : undefined;
          data = { ...local.data, details: { ...local.data.details, materials: keepStoreRows(local.data.details.materials ?? [], Array.isArray(stored) ? stored as MaterialRow[] : []) } };
        }
        const values = {
          projectId, customerId, facilityId: facilityFor(local.facilityId),
          kind: local.kind, ...form, title: local.title, description: local.description,
          status: local.status, progress: local.progress,
          assignedToUserId: local.assignedToUserId && members.has(local.assignedToUserId) ? local.assignedToUserId : null, assignedToName: local.assignedToName,
          dueDate: local.dueDate, data: data as Prisma.InputJsonValue,
          // Tidplan (steg 2): a file without them (an older one) keeps what Cloud has.
          ...(local.plannedStartDate !== undefined ? { plannedStartDate: local.plannedStartDate } : {}),
          // Etapp (plan 1M): a file without it (an older one) keeps what Cloud has; "" in the file clears it.
          ...(local.stage !== undefined ? { stage: local.stage } : {}),
          ...(local.estimatedMinutes !== undefined ? { estimatedMinutes: local.estimatedMinutes } : {}),
          startedAt: local.startedAt ? new Date(local.startedAt) : null,
          completedAt: local.completedAt ? new Date(local.completedAt) : null,
          // Utgår (2026-10-09): the reason and the status before come along; who is the importing person.
          cancelledAt: local.status === "CANCELLED" ? new Date(local.cancellation?.at ?? local.updatedAt) : null,
          cancelledBy: local.status === "CANCELLED" ? input.userId : null,
          cancelReason: local.status === "CANCELLED" ? local.cancellation?.reason ?? "" : "",
          cancelledFromStatus: local.status === "CANCELLED" ? local.cancellation?.fromStatus ?? null : null,
          // The work order is already written (work orders first); a task's own link is set with it.
          ...(local.kind !== "WORK_ORDER" ? { workOrderId: local.workOrderId ? workflowTaskIds.get(local.workOrderId) ?? null : null } : {}),
          ...(await roundKeyFor(local, item.action === "UPDATE" && current ? current.id : null)),
          updatedBy: input.userId,
        };
        // Uppgifter får skapas först (2026-10-27): a draft may come without a work order; a started task may not.
        if (local.kind !== "WORK_ORDER" && !values.workOrderId && (!isDraftStatus(local.status) || local.startedAt || local.completedAt))
          throw new ApiError(422, `Uppgiften ${local.title} är påbörjad men saknar arbetsorder i filen. Återimporten avbröts.`);
        let taskId: string;
        let version: number;
        let minimumRevisionVersion: number;
        if (item.action === "UPDATE" && current) {
          version = Math.max(current.version + 1, local.version);
          minimumRevisionVersion = current.version;
          const changed = await tx.workflowTask.updateMany({ where: { id: current.id, organizationId: input.organizationId, version: local.cloudOrigin!.version }, data: { ...values, version } });
          if (!changed.count) throw new ApiError(409, "En uppgift ändrades medan återimporten förbereddes. Förhandsgranska filen igen.");
          const before = await tx.workflowTimeEntry.findMany({ where: { taskId: current.id }, select: { id: true, ...replacedTimeSelect } });
          // Tidsperiod (2026-10-30): the file may bring a sent-in or approved month back as it is, never change it.
          await assertReplacedTimeOpen(tx, input.organizationId, before, local.timeEntries, input.userId);
          for (const entry of before) releasedEntryIds.add(entry.id);
          await tx.workflowTimeEntry.deleteMany({ where: { taskId: current.id } });
          for (const entry of local.timeEntries) if (entry.cloudOrigin && releasedEntryIds.has(entry.cloudOrigin.id)) entryIds.set(entry.id, entry.cloudOrigin.id);
          taskId = current.id;
        } else {
          version = Math.max(1, local.version);
          minimumRevisionVersion = 0;
          await assertReplacedTimeOpen(tx, input.organizationId, [], local.timeEntries, input.userId);
          const created = await tx.workflowTask.create({
            data: { organizationId: input.organizationId, ...values, title: item.action === "COPY_CONFLICT" ? `${local.title} (konfliktkopia)` : local.title, version, createdBy: input.userId },
          });
          taskId = created.id;
          if (local.kind === "WORK_ORDER") createdWorkOrders.set(local.id, taskId);
        }
        workflowTaskIds.set(local.id, taskId);
        if (local.timeEntries.length) await tx.workflowTimeEntry.createMany({
          data: local.timeEntries.map((entry) => ({ id: cloudEntryId(entry.id), taskId, userId: entry.userId, startedAt: new Date(entry.startedAt), endedAt: entry.endedAt ? new Date(entry.endedAt) : null, durationSec: entry.durationSec, note: entry.note, createdAt: new Date(entry.createdAt), updatedAt: new Date(entry.updatedAt) })),
        });
        for (const entry of local.timeEntries) if (entry.sourceTaskId) entrySources.push({ entryId: cloudEntryId(entry.id), localTaskId: entry.sourceTaskId, localOrderId: local.id });
        for (const revision of taskRevisionsToImport(local, minimumRevisionVersion, version))
          await tx.workflowTaskRevision.create({ data: { taskId, version: revision.version, snapshot: revision.snapshot, createdBy: input.userId } });
        if (item.action !== "UPDATE") {
          for (const attachment of input.bundle.workspace.attachments.filter((candidate) => candidate.taskId === local.id)) {
            const storagePath = staged.get(attachment.id);
            if (!storagePath) throw new ApiError(422, "En förberedd uppgiftsbilaga saknas.");
            await tx.workflowTaskAttachment.create({ data: { organizationId: input.organizationId, taskId, filename: attachment.filename, storagePath, mimeType: attachment.mimeType, size: attachment.size, receipt: attachment.receipt === true, createdAt: new Date(attachment.createdAt) } });
            used.push(storagePath);
          }
        }
      }
      // Projekttid (2026-10-26): the projects' own time, written like a task's – an updated project's entries are replaced and
      // keep their Cloud ids, so the history stays linked.
      for (const project of input.bundle.workspace.projects) {
        const projectId = projectIds.get(project.id);
        if (!projectId) continue;
        const before = await tx.workflowTimeEntry.findMany({ where: { projectId }, select: { id: true, ...replacedTimeSelect } });
        await assertReplacedTimeOpen(tx, input.organizationId, before, project.timeEntries, input.userId);
        const released = new Set(before.map((entry) => entry.id));
        await tx.workflowTimeEntry.deleteMany({ where: { projectId } });
        for (const entry of project.timeEntries) if (entry.cloudOrigin && released.has(entry.cloudOrigin.id)) entryIds.set(entry.id, entry.cloudOrigin.id);
        if (project.timeEntries.length) await tx.workflowTimeEntry.createMany({
          data: project.timeEntries.map((entry) => ({ id: cloudEntryId(entry.id), projectId, userId: entry.userId, startedAt: new Date(entry.startedAt), endedAt: entry.endedAt ? new Date(entry.endedAt) : null, durationSec: entry.durationSec, note: entry.note, createdAt: new Date(entry.createdAt), updatedAt: new Date(entry.updatedAt) })),
        });
      }
      // Hör till arbetsorder (Fas 2): the links once every task has its Cloud id. A file without the field (older
      // versions) leaves the Cloud link as it is; a link to an order that is not in the file is let go. The database's
      // trigger refuses a link to something that is not a work order of the same company.
      // Börjar efter (plan 1K, 2026-10-11) is written the same way: a file without the field keeps the Cloud dependencies,
      // an id that is not in the file is let go.
      for (const item of plan.workflowTasks) {
        if (item.local.workOrderId === undefined && item.local.predecessorIds === undefined) continue;
        const taskId = workflowTaskIds.get(item.local.id);
        if (!taskId) continue;
        const workOrderId = item.local.workOrderId ? workflowTaskIds.get(item.local.workOrderId) ?? null : null;
        const predecessorIds = item.local.predecessorIds?.flatMap((id) => { const cloudId = workflowTaskIds.get(id); return cloudId && cloudId !== taskId ? [cloudId] : []; });
        await tx.workflowTask.updateMany({ where: { id: taskId, organizationId: input.organizationId }, data: { ...(item.local.workOrderId !== undefined ? { workOrderId } : {}), ...(predecessorIds ? { predecessorIds: [...new Set(predecessorIds)] } : {}) } });
      }
      // Rapporterad från: only a task that is in the entry's work order in the file (the database's trigger says the same).
      for (const source of entrySources) {
        const task = input.bundle.workspace.workflowTasks.find((item) => item.id === source.localTaskId);
        const cloudTaskId = workflowTaskIds.get(source.localTaskId);
        if (!task || task.workOrderId !== source.localOrderId || !cloudTaskId) continue;
        await tx.workflowTimeEntry.updateMany({ where: { id: source.entryId }, data: { sourceTaskId: cloudTaskId } });
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
      // Time history recorded in Local joins the Cloud history; events that came from Cloud already exist there.
      const localTimeEvents = input.bundle.workspace.timeEntryEvents.filter((event) => !event.cloudOrigin);
      const cloudSnapshot = (snapshot: (typeof localTimeEvents)[number]["previous"]) => !snapshot ? Prisma.JsonNull
        : snapshot.projectId ? { ...snapshot, taskId: projectIds.get(snapshot.projectId) ?? snapshot.taskId, projectId: projectIds.get(snapshot.projectId) ?? snapshot.projectId } as Prisma.InputJsonValue
        : { ...snapshot, taskId: workflowTaskIds.get(snapshot.taskId) ?? snapshot.taskId } as Prisma.InputJsonValue;
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
        if (local.projectId && !projectId) throw new ApiError(422, "Planeringen saknar sitt projekt vid återimport.");
        if (local.workflowTaskId && !workflowTaskId) throw new ApiError(422, "Planeringen saknar sin uppgift vid återimport.");
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

      // Värden och referenser (2026-10-06): a value the file has and Cloud lacks comes back; Cloud's own is never overwritten.
      const values = input.bundle.workspace.companyValues ?? [];
      if (values.length) await tx.companyReferenceValue.createMany({ skipDuplicates: true, data: values.map((value) => ({ organizationId: input.organizationId, key: value.key, low: value.low, high: value.high, warnLow: value.warnLow, warnHigh: value.warnHigh, source: value.source, reference: value.reference, updatedBy: input.userId, updatedByName: value.updatedByName })) });
      // Egenkontroll (etapp 2, 2026-10-06): the programme comes back when Cloud has none; otherwise only what the file added.
      const { createdDeviations } = await importSelfInspection(tx, { organizationId: input.organizationId, userId: input.userId, doc: input.bundle.workspace.selfInspection, ids: { customers: customerIds, projects: projectIds, tasks: workflowTaskIds } });
      // Kommentarer (beslut 14): threads whose parent had to be created come back; who wrote them stays as the name.
      const restoredComments = commentsToRestore(input.bundle.workspace.comments ?? [], { workOrders: createdWorkOrders, projects: createdProjects, deviations: createdDeviations });
      if (restoredComments.length) await tx.comment.createMany({ data: restoredComments.map((comment) => ({ ...comment, organizationId: input.organizationId })) });

      // Limit profiles and round schedules (2026-10-06): the same conflict rule, bound to the organization.
      const formSettings = await importFormSettings(tx, { organizationId: input.organizationId, userId: input.userId, workspace: input.bundle.workspace }, {
        customerFor: (localId) => localId ? customerIds.get(localId) ?? null : null,
        facilityFor,
        projectFor: (localId) => localId ? projectIds.get(localId) ?? null : null,
      });

      // Artiklar och priser (2026-10-08): only what Cloud lacks is added; Cloud's own rows are never changed.
      const catalogue = await importCatalogueTransfer(tx, { organizationId: input.organizationId, transfer: catalogueTransfer });

      const receipt = await tx.cloudImport.create({
        data: {
          organizationId: input.organizationId,
          bundleSha256: input.bundleSha256,
          sourceWorkspaceId: input.bundle.workspace.workspaceId,
          snapshotExportedAt: new Date(input.bundle.workspace.cloudSnapshot!.exportedAt),
          importedBy: input.userId,
          result: { ...plan.summary, formSettings, catalogue, comments: restoredComments.length, importId: "pending" },
        },
      });
      const result = { ...plan.summary, formSettings, catalogue, comments: restoredComments.length, importId: receipt.id };
      await tx.cloudImport.update({ where: { id: receipt.id }, data: { result } });
      return { result: { ...result, duplicate: false }, used };
    }, { timeout: catalogueTransferRows(catalogueTransfer) > 20_000 ? 300_000 : 60_000 });

    const used = new Set(committed.used);
    await Promise.all([...staged.values()].filter((path) => !used.has(path)).map(remove));
    return committed.result;
  } catch (error) {
    await Promise.all([...staged.values()].map(remove));
    throw error;
  }
}
