import { createHash, createHmac, randomBytes, randomUUID } from "node:crypto";
import type { Prisma } from "@prisma/client";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { ApiError } from "@/lib/kfid/errors";
import { read } from "@/lib/kfid/storage";
import { ZipWriter } from "@/lib/kfid/zip-writer";
import { MAX_CLOUD_WORKSPACE_BUNDLE_BYTES, MAX_CLOUD_WORKSPACE_COMMENTS, MAX_CLOUD_WORKSPACE_RECORDS } from "@/lib/kfid/cloud-reimport";
import { companyValues } from "@/lib/kfid/company-values-server";
import { createLocalWorkspace, localWorkspaceRecordSchemas, parseLocalWorkspace, type LocalWorkspaceDocument } from "@/features/kfid/local-workspace-store";
import { createLocalWorkspaceBundle } from "@/features/kfid/local-workspace-bundle";
import { placeObjectOf } from "@/lib/workflow/maintenance";
import { workflowTaskDataSchema, workflowTaskStatuses, type WorkflowTaskStatus } from "@/lib/workflow/task-model";
import { timeEntrySnapshotSchema } from "@/lib/workflow/time-correction";
import { limitProfileValueSchema } from "@/lib/workflow/form-limits";
import { formScheduleRuleSchema, parseScheduleReminders, scheduleTempPlace } from "@/lib/workflow/form-schedule";
import { placeKindOf } from "@/lib/workflow/customer-facility";
import { staffRegisterOf } from "@/lib/workflow/staff-register";
import { selfInspectionForExport } from "@/lib/self-inspection/transfer";
import { catalogueForExport } from "@/lib/catalogue/transfer";

/**
 * The Cloud export (Ladda ned Cloud-kopia). A company within the limits of one file (500 customers, projects, tasks and
 * plans, 50 MB of attachments) gets the .hwf file as before. A larger company gets all of its data as a zip file in
 * parts (S4, 2026-10-23: "Exporten delas upp"): the records are read page by page and sent as they are written,
 * so the server never holds the whole company in memory. Every record has the same shape as in a .hwf file.
 */

type LocalFacility = LocalWorkspaceDocument["customerFacilities"][number];
type LocalProject = LocalWorkspaceDocument["projects"][number];
type LocalTask = LocalWorkspaceDocument["workflowTasks"][number];
type LocalAttachment = LocalWorkspaceDocument["attachments"][number];
type LocalTimeEntryEvent = LocalWorkspaceDocument["timeEntryEvents"][number];
type LocalPlannedActivity = LocalWorkspaceDocument["plannedActivities"][number];
type LocalCustomer = LocalWorkspaceDocument["customers"][number];
type LocalComment = LocalWorkspaceDocument["comments"][number];

// Projekttid (2026-10-26): the project's own time entries follow it into the file (`timeEntries` on the project).
const projectInclude = { events: { orderBy: { createdAt: "asc" } }, decisions: { orderBy: { createdAt: "asc" } }, timeEntries: { orderBy: { startedAt: "asc" } } } satisfies Prisma.ProjectInclude;
const taskInclude = { timeEntries: { orderBy: { startedAt: "asc" } }, revisions: { orderBy: { version: "asc" } }, attachments: { orderBy: { createdAt: "asc" } } } satisfies Prisma.WorkflowTaskInclude;
const activityInclude = { events: { orderBy: { createdAt: "asc" } }, assignments: { select: { plannedMinutes: true, startsAt: true, endsAt: true, member: { select: { userId: true } } } } } satisfies Prisma.PlannedActivityInclude;
type CloudCustomer = Prisma.CustomerGetPayload<Record<string, never>>;
type CloudFacility = Prisma.CustomerFacilityGetPayload<Record<string, never>>;
type CloudProject = Prisma.ProjectGetPayload<{ include: typeof projectInclude }>;
type CloudTask = Prisma.WorkflowTaskGetPayload<{ include: typeof taskInclude }>;
type CloudTimeEntryEvent = Prisma.WorkflowTimeEntryEventGetPayload<Record<string, never>>;
type CloudPlannedActivity = Prisma.PlannedActivityGetPayload<{ include: typeof activityInclude }>;
type CloudComment = Prisma.CommentGetPayload<Record<string, never>>;

/** Who exports what: the signed-in admin's own company, checked by the route before anything is read. */
export type CloudExportSource = {
  organizationId: string;
  organizationName: string;
  organizationWeeklyWorkMinutes: number;
  user: { id: string; email: string };
  memberWeeklyWorkMinutes: number | null;
};

/** Records per part of the zip file; a task carries its time, versions and attachments, so its parts are smaller. */
export const CLOUD_EXPORT_PART_SIZES = {
  customers: 500, customerFacilities: 500, projects: 200, workflowTasks: 100, timeEntryEvents: 1000, plannedActivities: 500, comments: 1000,
} as const;

/** The folders of the zip file, in the order they are written. */
export const CLOUD_EXPORT_FOLDERS = {
  customers: "kunder", customerFacilities: "platser", projects: "projekt", workflowTasks: "uppgifter",
  attachments: "bilagor", timeEntryEvents: "tidhistorik", plannedActivities: "planering", comments: "kommentarer",
} as const;
export type CloudExportSection = keyof typeof CLOUD_EXPORT_FOLDERS;

export function cloudExportPartName(section: CloudExportSection, part: number) {
  if (!Number.isInteger(part) || part < 1 || part > 999_999) throw new Error("Invalid part number");
  return `${CLOUD_EXPORT_FOLDERS[section]}/del-${String(part).padStart(4, "0")}.json`;
}

/** True when the company fits in one .hwf file, the limits the re-import also has. Comments have their own limit: a job may have many. */
export function fitsOneCloudFile(size: { records: number; attachmentBytes: number; comments?: number }) {
  return size.records <= MAX_CLOUD_WORKSPACE_RECORDS && size.attachmentBytes <= MAX_CLOUD_WORKSPACE_BUNDLE_BYTES && (size.comments ?? 0) <= MAX_CLOUD_WORKSPACE_COMMENTS;
}

export async function cloudExportSize(organizationId: string) {
  const where = { organizationId };
  const [customers, projects, tasks, activities, files, comments] = await Promise.all([
    prisma.customer.count({ where }), prisma.project.count({ where }), prisma.workflowTask.count({ where }), prisma.plannedActivity.count({ where }),
    prisma.workflowTaskAttachment.aggregate({ where, _sum: { size: true } }),
    prisma.comment.count({ where }),
  ]);
  return { records: customers + projects + tasks + activities, attachmentBytes: files._sum.size ?? 0, comments };
}

/**
 * The file's own ids. Cloud ids never become file ids: each one is an HMAC of the Cloud id under a key made for this
 * export only (like the random ids before), so two exports cannot be linked by their ids. Because the same Cloud id
 * always gives the same file id, a reference in one part finds its record in another part without a map of the whole
 * company. A reference to something that is not in the export (another company, or deleted) becomes null as before.
 */
export type CloudExportIds = {
  own: (kind: "customer" | "facility" | "project" | "task" | "entry" | "attachment" | "file" | "schedule" | "comment", cloudId: string) => string;
  customer: (cloudId: string | null | undefined) => string | null;
  facility: (cloudId: string | null | undefined) => string | null;
  project: (cloudId: string | null | undefined) => string | null;
  task: (cloudId: string | null | undefined) => string | null;
};

export function cloudExportIds(known: { customers: Iterable<string>; facilities: Iterable<string>; projects: Iterable<string>; tasks: Iterable<string> }, key: Uint8Array = randomBytes(32)): CloudExportIds {
  const own: CloudExportIds["own"] = (kind, cloudId) => {
    const bytes = createHmac("sha256", key).update(`${kind}:${cloudId}`).digest().subarray(0, 16);
    bytes[6] = (bytes[6] & 0x0f) | 0x40;
    bytes[8] = (bytes[8] & 0x3f) | 0x80;
    const hex = bytes.toString("hex");
    return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
  };
  const lookup = (kind: "customer" | "facility" | "project" | "task", ids: Set<string>) =>
    (cloudId: string | null | undefined) => cloudId && ids.has(cloudId) ? own(kind, cloudId) : null;
  return {
    own,
    customer: lookup("customer", new Set(known.customers)),
    facility: lookup("facility", new Set(known.facilities)),
    project: lookup("project", new Set(known.projects)),
    task: lookup("task", new Set(known.tasks)),
  };
}

/** The Map that the self-inspection export reads its references through, backed by the export's ids. */
class LookupMap extends Map<string, string> {
  constructor(private readonly lookup: (id: string) => string | null) { super(); }
  override get(key: string) { return this.lookup(key) ?? undefined; }
  override has(key: string) { return this.lookup(key) !== null; }
}

export function storageExtension(filename: string, mimeType: string) {
  const extension = filename.toLowerCase().match(/\.(jpg|jpeg|png|webp|pdf|txt|doc|docx|xls|xlsx)$/)?.[1];
  if (extension) return extension === "jpeg" ? "jpg" : extension;
  if (mimeType === "image/jpeg") return "jpg";
  if (mimeType === "image/png") return "png";
  if (mimeType === "image/webp") return "webp";
  if (mimeType === "application/pdf") return "pdf";
  if (mimeType === "text/plain") return "txt";
  throw new ApiError(422, "En bilaga har ett format som inte kan exporteras till lokal arbetsyta.");
}

function portableTaskSnapshot(value: unknown, fallback: { title: string; description: string; status: string; progress: number; data: unknown; completedAt: Date | null }) {
  const source = value && typeof value === "object" ? value as Record<string, unknown> : {};
  const status = (workflowTaskStatuses as readonly string[]).includes(String(source.status))
    ? String(source.status) as WorkflowTaskStatus
    : fallback.status as WorkflowTaskStatus;
  return {
    title: typeof source.title === "string" ? source.title : fallback.title,
    description: typeof source.description === "string" ? source.description : fallback.description,
    status,
    progress: typeof source.progress === "number" ? Math.max(0, Math.min(100, Math.round(source.progress))) : fallback.progress,
    data: workflowTaskDataSchema.parse(source.data ?? fallback.data),
    completedAt: typeof source.completedAt === "string" ? source.completedAt : fallback.completedAt?.toISOString() ?? null,
  };
}

function customerToLocal(customer: CloudCustomer, ids: CloudExportIds): LocalCustomer {
  return {
    id: ids.own("customer", customer.id),
    name: customer.name, company: customer.company, address: customer.address,
    postalCode: customer.postalCode, city: customer.city, email: customer.email,
    phone: customer.phone, mobile: customer.mobile, lat: customer.lat, lng: customer.lng,
    notes: customer.notes, specialRequirements: customer.specialRequirements, customerType: customer.customerType, accountingCustomerNumber: customer.accountingCustomerNumber, version: customer.version,
    deletedAt: customer.deletedAt?.toISOString() ?? null,
    createdAt: customer.createdAt.toISOString(), updatedAt: customer.updatedAt.toISOString(),
    cloudOrigin: { id: customer.id, version: customer.version },
  };
}

function facilityToLocal(facility: CloudFacility, ids: CloudExportIds): LocalFacility | null {
  const customerId = ids.customer(facility.customerId);
  if (!customerId) return null;
  return {
    id: ids.own("facility", facility.id), customerId, name: facility.name, address: facility.address, postalCode: facility.postalCode,
    // The place tree (2026-10-04) follows into the file with the local ids.
    parentId: ids.facility(facility.parentId), kind: placeKindOf(facility), latitude: facility.latitude, longitude: facility.longitude,
    city: facility.city, description: facility.description, isActive: facility.isActive, version: facility.version,
    // Object data (Underhåll stage 2, 2026-10-06) follows into the file.
    ...placeObjectOf(facility),
    createdAt: facility.createdAt.toISOString(), updatedAt: facility.updatedAt.toISOString(), cloudOrigin: { id: facility.id },
  };
}

function projectToLocal(project: CloudProject, ids: CloudExportIds): LocalProject {
  return {
    id: ids.own("project", project.id),
    name: project.name,
    description: project.description,
    startDate: project.startDate,
    dueDate: project.dueDate,
    client: project.client,
    contactPerson: project.contactPerson,
    reference: project.reference,
    workSite: project.workSite,
    staffRegister: staffRegisterOf(project.staffRegister),
    taskTypes: Array.isArray(project.taskTypes) ? project.taskTypes as ("WORK_ORDER" | "RISK_ASSESSMENT" | "COMMISSIONING_CONTROL")[] : [],
    workMoments: Array.isArray(project.workMoments) ? project.workMoments as ("START_TIME" | "EXECUTION" | "SIGN_REPORT" | "CLOSE_ORDER")[] : [],
    customerId: ids.customer(project.customerId),
    facilityId: ids.facility(project.facilityId),
    responsibleUserId: null,
    responsibleName: project.responsibleName,
    timeBudgetMinutes: project.timeBudgetMinutes,
    archivedAt: project.archivedAt?.toISOString() ?? null,
    closedAt: project.closedAt?.toISOString() ?? null,
    events: project.events.map((event) => ({ id: randomUUID(), kind: event.kind as LocalProject["events"][number]["kind"], summary: event.summary, taskId: ids.task(event.taskId), actorName: event.actorName, createdAt: event.createdAt.toISOString() })),
    // The decision log follows the project into the file (additive, 2026-09-26).
    decisions: project.decisions.map((decision) => ({ id: randomUUID(), decidedOn: decision.decidedOn, text: decision.text, decidedBy: decision.decidedBy, actorName: decision.actorName, createdAt: decision.createdAt.toISOString() })),
    timeEntries: project.timeEntries.map((entry) => ({
      id: ids.own("entry", entry.id), userId: entry.userId, startedAt: entry.startedAt.toISOString(), endedAt: entry.endedAt?.toISOString() ?? null, durationSec: entry.durationSec, note: entry.note,
      createdAt: entry.createdAt.toISOString(), updatedAt: entry.updatedAt.toISOString(), cloudOrigin: { id: entry.id },
    })),
    createdAt: project.createdAt.toISOString(),
    updatedAt: project.updatedAt.toISOString(),
    cloudOrigin: { id: project.id },
  };
}

/** A task and its attachments; `storagePath` says where each attachment's contents are in Cloud's storage. */
function taskToLocal(task: CloudTask, ids: CloudExportIds): { task: LocalTask; attachments: { local: LocalAttachment; storagePath: string }[] } {
  const id = ids.own("task", task.id);
  const attachments = task.attachments.map((attachment) => ({
    local: { id: ids.own("attachment", attachment.id), taskId: id, filename: attachment.filename, storageName: `${ids.own("file", attachment.id)}.${storageExtension(attachment.filename, attachment.mimeType)}`, mimeType: attachment.mimeType, size: attachment.size, section: "vis" as const, rowId: null, ...(attachment.receipt ? { receipt: true } : {}), createdAt: attachment.createdAt.toISOString(), cloudOrigin: { id: attachment.id } },
    storagePath: attachment.storagePath,
  }));
  return { attachments, task: {
    id, version: task.version, kind: task.kind as "WORK_ORDER" | "RISK_ASSESSMENT" | "FORM", title: task.title, description: task.description, status: task.status as WorkflowTaskStatus, progress: task.progress,
    // Utgår (2026-10-09): when, why and the status before follow the job into the file.
    ...(task.status === "CANCELLED" && task.cancelledAt ? { cancellation: { at: task.cancelledAt.toISOString(), by: "", reason: task.cancelReason, fromStatus: task.cancelledFromStatus } } : {}),
    projectId: ids.project(task.projectId),
    customerId: ids.customer(task.customerId),
    facilityId: ids.facility(task.facilityId),
    // Hör till arbetsorder (Fas 2): the file's own id of the order (every task of the company is in the file).
    workOrderId: ids.task(task.workOrderId),
    // Driftrond i arbetsordern (2026-10-27): the round the work order holds for its period (Start – Klart senast), or – a
    // 0.24.0 work order – the round and its day, with the file's own id of the round.
    ...(task.roundScheduleId ? { roundScheduleId: ids.own("schedule", task.roundScheduleId), ...(task.roundOccurrence ? { roundOccurrence: task.roundOccurrence } : {}) } : {}),
    assignedToUserId: task.assignedToUserId, assignedToName: task.assignedToName, dueDate: task.dueDate,
    // Tidplan (steg 2): Start and Uppskattad tid follow the job into the file; Börjar efter (plan 1K, 2026-10-11) with
    // the file's own ids, so the dependencies survive a save and a re-import.
    plannedStartDate: task.plannedStartDate, estimatedMinutes: task.estimatedMinutes, stage: task.stage,
    predecessorIds: task.predecessorIds.flatMap((predecessor) => { const local = ids.task(predecessor); return local ? [local] : []; }),
    data: workflowTaskDataSchema.parse(task.data), startedAt: task.startedAt?.toISOString() ?? null, completedAt: task.completedAt?.toISOString() ?? null, createdAt: task.createdAt.toISOString(), updatedAt: task.updatedAt.toISOString(),
    timeEntries: task.timeEntries.map((entry) => ({
      id: ids.own("entry", entry.id), userId: entry.userId, startedAt: entry.startedAt.toISOString(), endedAt: entry.endedAt?.toISOString() ?? null, durationSec: entry.durationSec, note: entry.note,
      // Rapporterad från (2026-10-27): the task in the work order the time was reported from, by the file's id.
      ...(entry.sourceTaskId && ids.task(entry.sourceTaskId) ? { sourceTaskId: ids.task(entry.sourceTaskId) } : {}),
      createdAt: entry.createdAt.toISOString(), updatedAt: entry.updatedAt.toISOString(), cloudOrigin: { id: entry.id },
    })),
    revisions: task.revisions.map((revision) => ({ id: randomUUID(), version: revision.version, createdAt: revision.createdAt.toISOString(), snapshot: portableTaskSnapshot(revision.snapshot, task) })),
    cloudOrigin: { id: task.id, version: task.version, attachmentIds: task.attachments.map((attachment) => attachment.id).sort() },
  } };
}

// History of entries that no longer exist keeps a stable file id of its own; task references use the file's ids.
function timeEntryEventToLocal(event: CloudTimeEntryEvent, ids: CloudExportIds): LocalTimeEntryEvent {
  const portableSnapshot = (value: unknown) => {
    const parsed = timeEntrySnapshotSchema.safeParse(value);
    if (!parsed.success) return null;
    // Projekttid: a project's entry names the project (taskId is the owner's id for older readers).
    if (parsed.data.projectId) { const project = ids.project(parsed.data.projectId) ?? parsed.data.projectId; return { ...parsed.data, taskId: project, projectId: project }; }
    return { ...parsed.data, taskId: ids.task(parsed.data.taskId) ?? parsed.data.taskId };
  };
  return {
    id: randomUUID(), entryId: ids.own("entry", event.entryId), userId: event.userId, action: event.action as "CREATED" | "UPDATED" | "DELETED",
    previous: portableSnapshot(event.previous), next: portableSnapshot(event.next), reason: event.reason,
    actorUserId: event.actorUserId, actorName: event.actorName, createdAt: event.createdAt.toISOString(), cloudOrigin: { id: event.id },
  };
}

function plannedActivityToLocal(activity: CloudPlannedActivity, ids: CloudExportIds): LocalPlannedActivity {
  return {
    id: randomUUID(),
    version: activity.version,
    title: activity.title,
    description: activity.description,
    kind: activity.kind as "TASK" | "MEETING" | "DEADLINE" | "OTHER",
    status: activity.status as "PLANNED" | "IN_PROGRESS" | "COMPLETED" | "CANCELED",
    frameExceptionReason: "",
    startsAt: activity.startsAt.toISOString(),
    endsAt: activity.endsAt.toISOString(),
    projectId: ids.project(activity.projectId),
    workflowTaskId: ids.task(activity.workflowTaskId),
    assignedToUserId: activity.assignedToUserId,
    assignedToUserIds: activity.assignments.map((assignment) => assignment.member.userId),
    assignments: activity.assignments.map((assignment) => ({ userId: assignment.member.userId, plannedMinutes: assignment.plannedMinutes, startsAt: assignment.startsAt?.toISOString() ?? null, endsAt: assignment.endsAt?.toISOString() ?? null })),
    assignedToName: activity.assignedToName,
    deletedAt: activity.deletedAt?.toISOString() ?? null,
    createdAt: activity.createdAt.toISOString(),
    updatedAt: activity.updatedAt.toISOString(),
    events: activity.events.map((event) => ({
      id: randomUUID(), kind: event.kind as "CREATED" | "UPDATED" | "DELETED", summary: event.summary,
      snapshot: event.snapshot && typeof event.snapshot === "object" && !Array.isArray(event.snapshot) ? event.snapshot as Record<string, unknown> : {},
      actorName: event.actorName, createdAt: event.createdAt.toISOString(),
    })),
    cloudOrigin: { id: activity.id, version: activity.version },
  };
}

/**
 * A comment under the file's ids, or null when its parent is not in the export. A deviation keeps its id in the file (the
 * self-inspection section), so its thread names that id. Who wrote it travels as the name: a Cloud member id is no identity in a file.
 */
export function commentToLocal(comment: CloudComment, ids: CloudExportIds): LocalComment | null {
  const parent = comment.workflowTaskId ? { parentType: "WORK_ORDER" as const, parentId: ids.task(comment.workflowTaskId) }
    : comment.projectId ? { parentType: "PROJECT" as const, parentId: ids.project(comment.projectId) }
    : { parentType: "DEVIATION" as const, parentId: comment.deviationId };
  if (!parent.parentId) return null;
  return { id: ids.own("comment", comment.id), parentType: parent.parentType, parentId: parent.parentId, authorName: comment.authorName, body: comment.body, inCustomerReport: comment.inCustomerReport, createdAt: comment.createdAt.toISOString() };
}

/**
 * The file without its large registers: the company, the exporting member's own identity and the bounded sections
 * (values, catalogue, self-inspection, limit profiles and round schedules). A .hwf file is this plus every record;
 * the zip file sends it as foretag.json and the records in parts.
 */
async function exportHead(source: CloudExportSource, ids: CloudExportIds): Promise<LocalWorkspaceDocument> {
  const { organizationId } = source;
  const workspace = createLocalWorkspace({ id: organizationId, name: source.organizationName });
  // The exported Local owner receives only the exporting member's own setting.
  // WorkScheduleEvent is deliberately not copied: its Cloud member references are
  // not a portable identity binding and must never be replayed on Cloud import.
  workspace.organization.weeklyWorkMinutes = source.organizationWeeklyWorkMinutes;
  workspace.localIdentity.weeklyWorkMinutes = source.memberWeeklyWorkMinutes;
  workspace.cloudSnapshot = { format: "KFID_CLOUD_SNAPSHOT", schemaVersion: 1, exportedAt: new Date().toISOString() };
  // Limit profiles and round schedules (2026-09-28) follow to the file with the facilities they belong to.
  const [limitProfiles, schedules] = await Promise.all([
    prisma.formLimitProfile.findMany({ where: { organizationId } }),
    prisma.formSchedule.findMany({ where: { organizationId, deletedAt: null } }),
  ]);
  workspace.formLimitProfiles = limitProfiles.flatMap((profile) => {
    const facilityId = ids.facility(profile.facilityId);
    return facilityId ? [{ id: randomUUID(), templateId: profile.templateId, facilityId, objectName: profile.objectName,
      values: z.record(z.string(), limitProfileValueSchema).catch({}).parse(profile.values), version: profile.version, updatedAt: profile.updatedAt.toISOString(), updatedByName: profile.updatedByName,
      // Re-import (2026-10-06): the Cloud id and version, so a changed profile never overwrites Cloud silently.
      cloudOrigin: { id: profile.id, version: profile.version } }] : [];
  });
  // Värden och referenser (2026-10-06): the company's own values follow too.
  workspace.companyValues = await companyValues(organizationId);
  // Egenkontroll (etapp 2, 2026-10-06): the programme and its registers follow into the file, under the file's ids.
  // Artiklar och priser (2026-10-08): its own section, bounded; Local only carries it back to Cloud.
  workspace.catalogue = await catalogueForExport(organizationId);
  workspace.selfInspection = await selfInspectionForExport({ organizationId, user: source.user, ids: {
    customers: new LookupMap(ids.customer), projects: new LookupMap(ids.project), tasks: new LookupMap(ids.task),
  } });
  workspace.formSchedules = schedules.flatMap((schedule) => {
    const rule = formScheduleRuleSchema.safeParse(schedule.rule);
    return rule.success ? [{ id: ids.own("schedule", schedule.id), version: schedule.version, title: schedule.title, templateId: schedule.templateId, customerId: ids.customer(schedule.customerId),
      facilityId: ids.facility(schedule.facilityId), projectId: ids.project(schedule.projectId), assignedToUserId: null, assignedToName: schedule.assignedToName,
      active: schedule.active, rule: rule.data, reminders: parseScheduleReminders(schedule.reminders), tempPlace: scheduleTempPlace(schedule.tempPlace), templateName: "", deletedAt: null, createdAt: schedule.createdAt.toISOString(), updatedAt: schedule.updatedAt.toISOString(),
      cloudOrigin: { id: schedule.id, version: schedule.version } }] : [];
  });
  return workspace;
}

/** The member binding ("Cloud-kopia skapad"), written when an export has been made, as before. */
export async function bindExportedLocalWorkspace(source: CloudExportSource, localIdentityId: string) {
  await prisma.localWorkspaceBinding.upsert({
    where: { organizationId_userId_localIdentityId: { organizationId: source.organizationId, userId: source.user.id, localIdentityId } },
    create: {
      organizationId: source.organizationId, userId: source.user.id, localIdentityId,
      memberWeeklyWorkMinutesAtBinding: source.memberWeeklyWorkMinutes,
      scheduleBaselineCapturedAt: new Date(),
    },
    update: {
      revokedAt: null, revokedByUserId: null,
      memberWeeklyWorkMinutesAtBinding: source.memberWeeklyWorkMinutes,
      scheduleBaselineCapturedAt: new Date(), lastLocalScheduleUpdatedAt: null, lastScheduleSyncedAt: null,
    },
  });
}

/**
 * The whole company as one .hwf file, as before; null when the finished file would pass 50 MB (then the caller sends
 * the zip file instead). Only for a company within the limits of one file.
 */
export async function createCloudWorkspaceBundle(source: CloudExportSource) {
  const where = { organizationId: source.organizationId };
  const [customers, facilities, projects, workflowTasks, timeEntryEvents, plannedActivities, comments] = await Promise.all([
    prisma.customer.findMany({ where, orderBy: { createdAt: "asc" } }),
    // Customer facilities follow their customers into the file (additive, decision 11).
    prisma.customerFacility.findMany({ where, orderBy: { createdAt: "asc" } }),
    prisma.project.findMany({ where, orderBy: { createdAt: "asc" }, include: projectInclude }),
    prisma.workflowTask.findMany({ where, orderBy: { createdAt: "asc" }, include: taskInclude }),
    // The append-only time history follows the entries into the file (additive, 2026-09-26).
    prisma.workflowTimeEntryEvent.findMany({ where, orderBy: { createdAt: "asc" } }),
    prisma.plannedActivity.findMany({ where, orderBy: { createdAt: "asc" }, include: activityInclude }),
    // Kommentarer (beslut 14, 2026-11-01): the threads follow their jobs, so the company can keep them. Oldest first, as a thread reads.
    prisma.comment.findMany({ where, orderBy: ascending }),
  ]);
  const ids = cloudExportIds({
    customers: customers.map((item) => item.id), facilities: facilities.map((item) => item.id),
    projects: projects.map((item) => item.id), tasks: workflowTasks.map((item) => item.id),
  });
  const workspace = await exportHead(source, ids);
  workspace.customers = customers.map((customer) => customerToLocal(customer, ids));
  workspace.customerFacilities = facilities.flatMap((facility) => { const local = facilityToLocal(facility, ids); return local ? [local] : []; });
  workspace.projects = projects.map((project) => projectToLocal(project, ids));
  const attachmentPaths = new Map<string, string>();
  workspace.workflowTasks = workflowTasks.map((cloud) => {
    const { task, attachments } = taskToLocal(cloud, ids);
    for (const attachment of attachments) {
      workspace.attachments.push(attachment.local);
      attachmentPaths.set(attachment.local.id, attachment.storagePath);
    }
    return task;
  });
  // Newest first, as Local keeps its history.
  workspace.timeEntryEvents = timeEntryEvents.map((event) => timeEntryEventToLocal(event, ids)).reverse();
  workspace.plannedActivities = plannedActivities.map((activity) => plannedActivityToLocal(activity, ids));
  workspace.comments = comments.flatMap((comment) => { const local = commentToLocal(comment, ids); return local ? [local] : []; });
  // A large catalogue fills the register by itself: past the file's limit it goes as the zip file, and the bundle would refuse it (with room for the bundle's own frame).
  if (Buffer.byteLength(JSON.stringify(workspace)) > MAX_CLOUD_WORKSPACE_BUNDLE_BYTES - 1_000_000) return null;
  const bundle = await createLocalWorkspaceBundle(workspace, {
    read: async (attachment) => {
      const path = attachmentPaths.get(attachment.id);
      if (!path) throw new ApiError(422, "En bilaga saknas i exporten.");
      const bytes = await read(path);
      return new Blob([new Uint8Array(bytes)], { type: attachment.mimeType });
    },
    write: async () => { throw new Error("Exporten är skrivskyddad."); },
    remove: async () => { throw new Error("Exporten är skrivskyddad."); },
  });
  if (bundle.size > MAX_CLOUD_WORKSPACE_BUNDLE_BYTES) return null;
  return { bundle, localIdentityId: workspace.localIdentity.id };
}

/** Pages of a register in a fixed order, read with a cursor so that only one page is in memory at a time. */
export async function* cloudExportPages<T extends { id: string }>(load: (page: { take: number; skip?: number; cursor?: { id: string } }) => Promise<T[]>, size: number): AsyncGenerator<T[]> {
  let cursor: string | undefined;
  for (;;) {
    const rows = await load({ take: size, ...(cursor ? { skip: 1, cursor: { id: cursor } } : {}) });
    if (rows.length) yield rows;
    if (rows.length < size) return;
    cursor = rows[rows.length - 1].id;
  }
}

const ascending = [{ createdAt: "asc" as const }, { id: "asc" as const }];
const descending = [{ createdAt: "desc" as const }, { id: "desc" as const }];

// One large export at a time per company in this server process: a second click waits for the first.
const running = new Set<string>();

/** `release` frees the company's export slot; the stream calls it when the download ends, fails or is cancelled. */
export type CloudExportZip = { chunks: AsyncGenerator<Uint8Array>; exportedAt: string; release: () => void };

/**
 * Prepares the zip file for a large company and returns its bytes as a stream. Everything that can be refused (an
 * export already running, an attachment format, a catalogue over its limits) is checked here, before the response
 * starts, so the person gets the usual message instead of a broken download.
 */
export async function prepareCloudExportZip(source: CloudExportSource, partSizes: Record<keyof typeof CLOUD_EXPORT_PART_SIZES, number> = CLOUD_EXPORT_PART_SIZES): Promise<CloudExportZip> {
  const { organizationId } = source;
  if (running.has(organizationId)) throw new ApiError(429, "En export pågår redan för företaget. Försök igen när den är klar.");
  running.add(organizationId);
  try {
    const where = { organizationId };
    const select = { id: true } as const;
    const [customers, facilities, projects, tasks] = await Promise.all([
      prisma.customer.findMany({ where, select }), prisma.customerFacility.findMany({ where, select }),
      prisma.project.findMany({ where, select }), prisma.workflowTask.findMany({ where, select }),
    ]);
    const ids = cloudExportIds({
      customers: customers.map((item) => item.id), facilities: facilities.map((item) => item.id),
      projects: projects.map((item) => item.id), tasks: tasks.map((item) => item.id),
    });
    for await (const page of cloudExportPages((args) => prisma.workflowTaskAttachment.findMany({ where, orderBy: { id: "asc" }, select: { id: true, filename: true, mimeType: true }, ...args }), 2000))
      for (const attachment of page) storageExtension(attachment.filename, attachment.mimeType);
    const head = parseLocalWorkspace(await exportHead(source, ids), organizationId);
    const release = () => { running.delete(organizationId); };
    return { chunks: cloudExportZipChunks(source, ids, head, partSizes, release), exportedAt: head.cloudSnapshot!.exportedAt, release };
  } catch (error) {
    running.delete(organizationId);
    throw error;
  }
}

async function* cloudExportZipChunks(source: CloudExportSource, ids: CloudExportIds, head: LocalWorkspaceDocument, partSizes: Record<keyof typeof CLOUD_EXPORT_PART_SIZES, number>, release: () => void): AsyncGenerator<Uint8Array> {
  const { organizationId } = source;
  const where = { organizationId };
  try {
    const exportedAt = head.cloudSnapshot!.exportedAt;
    const zip = new ZipWriter({ date: new Date(exportedAt) });
    const encoder = new TextEncoder();
    const json = (name: string, value: unknown) => zip.file(name, encoder.encode(JSON.stringify(value)), { compress: true });
    const sections: Record<CloudExportSection, { count: number; parts: string[] }> = {
      customers: { count: 0, parts: [] }, customerFacilities: { count: 0, parts: [] }, projects: { count: 0, parts: [] }, workflowTasks: { count: 0, parts: [] },
      attachments: { count: 0, parts: [] }, timeEntryEvents: { count: 0, parts: [] }, plannedActivities: { count: 0, parts: [] }, comments: { count: 0, parts: [] },
    };
    let attachmentBytes = 0;
    function* part<S extends Exclude<CloudExportSection, "attachments">>(section: S, records: unknown[]) {
      const schema = localWorkspaceRecordSchemas[section];
      const checked = records.map((record) => schema.parse(record));
      const name = cloudExportPartName(section, sections[section].parts.length + 1);
      sections[section].parts.push(name);
      sections[section].count += checked.length;
      yield* json(name, { format: "HWF_EXPORT_PART", schemaVersion: 1, section, part: sections[section].parts.length, records: checked });
    }

    yield* json("foretag.json", head);
    for await (const page of cloudExportPages((args) => prisma.customer.findMany({ where, orderBy: ascending, ...args }), partSizes.customers))
      yield* part("customers", page.map((item) => customerToLocal(item, ids)));
    for await (const page of cloudExportPages((args) => prisma.customerFacility.findMany({ where, orderBy: ascending, ...args }), partSizes.customerFacilities))
      yield* part("customerFacilities", page.flatMap((item) => { const local = facilityToLocal(item, ids); return local ? [local] : []; }));
    for await (const page of cloudExportPages((args) => prisma.project.findMany({ where, orderBy: ascending, include: projectInclude, ...args }), partSizes.projects))
      yield* part("projects", page.map((item) => projectToLocal(item, ids)));
    for await (const page of cloudExportPages((args) => prisma.workflowTask.findMany({ where, orderBy: ascending, include: taskInclude, ...args }), partSizes.workflowTasks)) {
      const mapped = page.map((item) => taskToLocal(item, ids));
      yield* part("workflowTasks", mapped.map((item) => item.task));
      // The tasks' attachments: each file is read, checked and sent on its own, then its register part.
      const records: LocalAttachment[] = [];
      const files: { attachmentId: string; path: string; size: number; sha256: string }[] = [];
      for (const attachment of mapped.flatMap((item) => item.attachments)) {
        const local = localWorkspaceRecordSchemas.attachments.parse(attachment.local);
        const bytes = new Uint8Array(await read(attachment.storagePath));
        if (bytes.byteLength !== local.size) throw new Error(`Bilagan ”${local.filename}” har ändrats eller är skadad. Exporten avbröts.`);
        const path = `${CLOUD_EXPORT_FOLDERS.attachments}/filer/${local.storageName}`;
        yield* zip.file(path, bytes, { compress: local.mimeType === "text/plain" });
        records.push(local);
        files.push({ attachmentId: local.id, path, size: bytes.byteLength, sha256: createHash("sha256").update(bytes).digest("hex") });
        attachmentBytes += bytes.byteLength;
      }
      if (records.length) {
        const name = cloudExportPartName("attachments", sections.attachments.parts.length + 1);
        sections.attachments.parts.push(name);
        sections.attachments.count += records.length;
        yield* json(name, { format: "HWF_EXPORT_PART", schemaVersion: 1, section: "attachments", part: sections.attachments.parts.length, records, files });
      }
    }
    // Newest first, as Local keeps its history.
    for await (const page of cloudExportPages((args) => prisma.workflowTimeEntryEvent.findMany({ where, orderBy: descending, ...args }), partSizes.timeEntryEvents))
      yield* part("timeEntryEvents", page.map((item) => timeEntryEventToLocal(item, ids)));
    for await (const page of cloudExportPages((args) => prisma.plannedActivity.findMany({ where, orderBy: ascending, include: activityInclude, ...args }), partSizes.plannedActivities))
      yield* part("plannedActivities", page.map((item) => plannedActivityToLocal(item, ids)));
    for await (const page of cloudExportPages((args) => prisma.comment.findMany({ where, orderBy: ascending, ...args }), partSizes.comments))
      yield* part("comments", page.flatMap((item) => { const local = commentToLocal(item, ids); return local ? [local] : []; }));

    yield* json("innehall.json", {
      format: "HWF_EXPORT", schemaVersion: 1, exportedAt,
      organization: { id: organizationId, name: source.organizationName },
      workspaceId: head.workspaceId, localIdentityId: head.localIdentity.id,
      head: "foretag.json", sections, attachmentBytes,
    });
    yield* zip.file("LASMIG.txt", encoder.encode([
      "Workflow – export av hela företaget",
      "",
      `Skapad ${exportedAt}.`,
      "Företaget har för mycket data för en enda .hwf-fil, så uppgifterna ligger här i delar.",
      "innehall.json listar alla delar. foretag.json är företaget utan de stora registren.",
      "Varje del (kunder, platser, projekt, uppgifter, bilagor, tidhistorik, planering, kommentarer) har samma poster som en .hwf-fil.",
      "Bilagornas filer ligger i bilagor/filer.",
      "Offerter, fakturaunderlag och fakturor laddas ned som en egen zip-fil under Abonnemang, och övriga företagsdata (inköp, frånvaro, underhåll med mera) som företagsarkivet.",
      "",
    ].join("\r\n")), { compress: true });
    // The member binding, as for the .hwf file: written once the whole export has been made.
    await bindExportedLocalWorkspace(source, head.localIdentity.id);
    yield zip.finish();
  } finally {
    release();
  }
}

/** The zip file as a response body; a download that is cancelled stops the reading at once. */
export function cloudExportZipStream(zip: CloudExportZip) {
  return new ReadableStream<Uint8Array>({
    async pull(controller) {
      try {
        const next = await zip.chunks.next();
        if (next.done) { zip.release(); controller.close(); }
        else controller.enqueue(next.value);
      } catch (error) {
        zip.release();
        console.warn(`Cloud export stopped (${error instanceof Error ? error.name : "Unknown"}).`);
        controller.error(error);
      }
    },
    async cancel() {
      // A generator that never started has no finally to run, so the slot is freed here too.
      try { await zip.chunks.return(undefined); } finally { zip.release(); }
    },
  });
}
