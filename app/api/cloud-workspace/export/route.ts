import { randomUUID } from "node:crypto";
import { prisma } from "@/lib/db";
import { ApiError, context, failure, requireAdmin, requireCloudStorage } from "@/lib/kfid/server";
import { normalizeControl } from "@/lib/kfid/model";
import { read } from "@/lib/kfid/storage";
import { createLocalWorkspace, type LocalAttachment } from "@/features/kfid/local-workspace-store";
import {
  createLocalWorkspaceBundle,
  localWorkspaceBundleFilename,
  LOCAL_WORKSPACE_BUNDLE_MIME,
} from "@/features/kfid/local-workspace-bundle";
import { MAX_CLOUD_WORKSPACE_BUNDLE_BYTES, MAX_CLOUD_WORKSPACE_RECORDS } from "@/lib/kfid/cloud-reimport";
import { workflowTaskDataSchema } from "@/lib/workflow/task-model";
import { timeEntrySnapshotSchema } from "@/lib/workflow/time-correction";
import { z } from "zod";
import { limitProfileValueSchema } from "@/lib/workflow/form-limits";
import { formScheduleRuleSchema, parseScheduleReminders } from "@/lib/workflow/form-schedule";

export const dynamic = "force-dynamic";

function storageExtension(filename: string, mimeType: string) {
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
  const status = ["PLANNED", "IN_PROGRESS", "PAUSED", "NEEDS_ACTION", "COMPLETED"].includes(String(source.status))
    ? String(source.status) as "PLANNED" | "IN_PROGRESS" | "PAUSED" | "NEEDS_ACTION" | "COMPLETED"
    : fallback.status as "PLANNED" | "IN_PROGRESS" | "PAUSED" | "NEEDS_ACTION" | "COMPLETED";
  return {
    title: typeof source.title === "string" ? source.title : fallback.title,
    description: typeof source.description === "string" ? source.description : fallback.description,
    status,
    progress: typeof source.progress === "number" ? Math.max(0, Math.min(100, Math.round(source.progress))) : fallback.progress,
    data: workflowTaskDataSchema.parse(source.data ?? fallback.data),
    completedAt: typeof source.completedAt === "string" ? source.completedAt : fallback.completedAt?.toISOString() ?? null,
  };
}

export async function GET() {
  try {
    const ctx = await context();
    requireCloudStorage(ctx);
    requireAdmin(ctx);
    const [customers, projects, controls, workflowTasks, plannedActivities, exportingMember, timeEntryEvents, facilities] = await Promise.all([
      prisma.customer.findMany({ where: { organizationId: ctx.organizationId }, orderBy: { createdAt: "asc" } }),
      prisma.project.findMany({ where: { organizationId: ctx.organizationId }, orderBy: { createdAt: "asc" }, include: { events: { orderBy: { createdAt: "asc" } }, decisions: { orderBy: { createdAt: "asc" } } } }),
      prisma.control.findMany({
        where: { organizationId: ctx.organizationId },
        orderBy: { number: "asc" },
        include: { revisions: { orderBy: { version: "asc" } }, attachments: { orderBy: { createdAt: "asc" } }, timeEntries: { orderBy: { startedAt: "asc" } } },
      }),
      prisma.workflowTask.findMany({ where: { organizationId: ctx.organizationId }, orderBy: { createdAt: "asc" }, include: { timeEntries: { orderBy: { startedAt: "asc" } }, revisions: { orderBy: { version: "asc" } }, attachments: { orderBy: { createdAt: "asc" } } } }),
      prisma.plannedActivity.findMany({ where: { organizationId: ctx.organizationId }, orderBy: { createdAt: "asc" }, include: { events: { orderBy: { createdAt: "asc" } }, assignments: { select: { plannedMinutes: true, startsAt: true, endsAt: true, member: { select: { userId: true } } } } } }),
      prisma.organizationMember.findUniqueOrThrow({
        where: { organizationId_userId: { organizationId: ctx.organizationId, userId: ctx.user.id } },
        select: { weeklyWorkMinutes: true },
      }),
      // The append-only time history follows the entries into the file (additive, 2026-09-26).
      prisma.workflowTimeEntryEvent.findMany({ where: { organizationId: ctx.organizationId }, orderBy: { createdAt: "asc" } }),
      // Customer facilities follow their customers into the file (additive, decision 11).
      prisma.customerFacility.findMany({ where: { organizationId: ctx.organizationId }, orderBy: { createdAt: "asc" } }),
    ]);
    const totalFileBytes = controls.reduce((sum, control) =>
      sum + control.attachments.reduce((inner, attachment) => inner + attachment.size, 0), 0) + workflowTasks.reduce((sum, task) => sum + task.attachments.reduce((inner, attachment) => inner + attachment.size, 0), 0);
    if (customers.length + projects.length + controls.length + workflowTasks.length + plannedActivities.length > MAX_CLOUD_WORKSPACE_RECORDS)
      throw new ApiError(413, "Cloud-arbetsytan innehåller fler än 500 kunder, projekt, uppgifter och planeringar och kan inte exporteras som en fil.");
    if (totalFileBytes > MAX_CLOUD_WORKSPACE_BUNDLE_BYTES)
      throw new ApiError(413, "Arbetsytan är för stor för en enskild fil. Ingen ofullständig export skapades.");

    const workspace = createLocalWorkspace({ id: ctx.organizationId, name: ctx.organization.name });
    // The exported Local owner receives only the exporting member's own setting.
    // WorkScheduleEvent is deliberately not copied: its Cloud member references are
    // not a portable identity binding and must never be replayed on Cloud import.
    workspace.organization.weeklyWorkMinutes = ctx.organization.weeklyWorkMinutes;
    workspace.localIdentity.weeklyWorkMinutes = exportingMember.weeklyWorkMinutes;
    workspace.cloudSnapshot = {
      format: "KFID_CLOUD_SNAPSHOT", schemaVersion: 1, exportedAt: new Date().toISOString(),
    };
    const customerIds = new Map(customers.map((customer) => [customer.id, randomUUID()]));
    const workflowTaskIds = new Map(workflowTasks.map((task) => [task.id, randomUUID()]));
    const controlIds = new Map(controls.map((control) => [control.id, randomUUID()]));
    const entryIds = new Map<string, string>();
    const localEntryId = (cloudId: string) => { let id = entryIds.get(cloudId); if (!id) { id = randomUUID(); entryIds.set(cloudId, id); } return id; };
    const localTimeEntry = (entry: { id: string; userId: string; startedAt: Date; endedAt: Date | null; durationSec: number; note: string; createdAt: Date; updatedAt: Date }) => ({
      id: localEntryId(entry.id), userId: entry.userId, startedAt: entry.startedAt.toISOString(), endedAt: entry.endedAt?.toISOString() ?? null, durationSec: entry.durationSec, note: entry.note,
      createdAt: entry.createdAt.toISOString(), updatedAt: entry.updatedAt.toISOString(), cloudOrigin: { id: entry.id },
    });
    workspace.customers = customers.map((customer) => ({
      id: customerIds.get(customer.id)!,
      name: customer.name, company: customer.company, address: customer.address,
      postalCode: customer.postalCode, city: customer.city, email: customer.email,
      phone: customer.phone, mobile: customer.mobile, lat: customer.lat, lng: customer.lng,
      notes: customer.notes, version: customer.version,
      deletedAt: customer.deletedAt?.toISOString() ?? null,
      createdAt: customer.createdAt.toISOString(), updatedAt: customer.updatedAt.toISOString(),
      cloudOrigin: { id: customer.id, version: customer.version },
    }));
    const facilityIds = new Map(facilities.filter((facility) => customerIds.has(facility.customerId)).map((facility) => [facility.id, randomUUID()]));
    const localFacilityId = (id: string | null) => id ? facilityIds.get(id) ?? null : null;
    workspace.customerFacilities = facilities.filter((facility) => facilityIds.has(facility.id)).map((facility) => ({
      id: facilityIds.get(facility.id)!, customerId: customerIds.get(facility.customerId)!, name: facility.name, address: facility.address, postalCode: facility.postalCode,
      city: facility.city, description: facility.description, isActive: facility.isActive, version: facility.version,
      createdAt: facility.createdAt.toISOString(), updatedAt: facility.updatedAt.toISOString(), cloudOrigin: { id: facility.id },
    }));
    const projectIds = new Map(projects.map((project) => [project.id, randomUUID()]));
    // Limit profiles and round schedules (2026-09-28) follow to the file with the facilities they belong to.
    const [limitProfiles, schedules] = await Promise.all([
      prisma.formLimitProfile.findMany({ where: { organizationId: ctx.organizationId, facilityId: { in: [...facilityIds.keys()] } } }),
      prisma.formSchedule.findMany({ where: { organizationId: ctx.organizationId, deletedAt: null } }),
    ]);
    workspace.formLimitProfiles = limitProfiles.map((profile) => ({ id: randomUUID(), templateId: profile.templateId, facilityId: facilityIds.get(profile.facilityId)!, objectName: profile.objectName,
      values: z.record(z.string(), limitProfileValueSchema).catch({}).parse(profile.values), version: profile.version, updatedAt: profile.updatedAt.toISOString(), updatedByName: profile.updatedByName }));
    workspace.formSchedules = schedules.flatMap((schedule) => {
      const rule = formScheduleRuleSchema.safeParse(schedule.rule);
      return rule.success ? [{ id: randomUUID(), version: schedule.version, title: schedule.title, templateId: schedule.templateId, customerId: schedule.customerId ? customerIds.get(schedule.customerId) ?? null : null,
        facilityId: localFacilityId(schedule.facilityId), projectId: schedule.projectId ? projectIds.get(schedule.projectId) ?? null : null, assignedToUserId: null, assignedToName: schedule.assignedToName,
        active: schedule.active, rule: rule.data, reminders: parseScheduleReminders(schedule.reminders), templateName: "", deletedAt: null, createdAt: schedule.createdAt.toISOString(), updatedAt: schedule.updatedAt.toISOString() }] : [];
    });
    workspace.projects = projects.map((project) => ({
      id: projectIds.get(project.id)!,
      name: project.name,
      description: project.description,
      startDate: project.startDate,
      dueDate: project.dueDate,
      client: project.client,
      contactPerson: project.contactPerson,
      reference: project.reference,
      workSite: project.workSite,
      taskTypes: Array.isArray(project.taskTypes) ? project.taskTypes as ("WORK_ORDER" | "RISK_ASSESSMENT" | "COMMISSIONING_CONTROL")[] : [],
      workMoments: Array.isArray(project.workMoments) ? project.workMoments as ("START_TIME" | "EXECUTION" | "SIGN_REPORT" | "CLOSE_ORDER")[] : [],
      customerId: project.customerId ? customerIds.get(project.customerId) ?? null : null,
      facilityId: localFacilityId(project.facilityId),
      responsibleUserId: null,
      responsibleName: project.responsibleName,
      timeBudgetMinutes: project.timeBudgetMinutes,
      archivedAt: project.archivedAt?.toISOString() ?? null,
      closedAt: project.closedAt?.toISOString() ?? null,
      events: project.events.map((event) => ({ id: randomUUID(), kind: event.kind as "CREATED" | "UPDATED" | "BUDGET_UPDATED" | "ARCHIVED" | "RESTORED" | "TASK_LINKED" | "TASK_REOPENED" | "CLOSED" | "REOPENED", summary: event.summary, taskId: event.taskId ? workflowTaskIds.get(event.taskId) ?? null : null, actorName: event.actorName, createdAt: event.createdAt.toISOString() })),
      // The decision log follows the project into the file (additive, 2026-09-26).
      decisions: project.decisions.map((decision) => ({ id: randomUUID(), decidedOn: decision.decidedOn, text: decision.text, decidedBy: decision.decidedBy, actorName: decision.actorName, createdAt: decision.createdAt.toISOString() })),
      createdAt: project.createdAt.toISOString(),
      updatedAt: project.updatedAt.toISOString(),
      cloudOrigin: { id: project.id },
    }));
    const attachmentPaths = new Map<string, string>();
    workspace.controls = controls.map((control) => {
      if (control.status !== "DRAFT" && control.status !== "COMPLETED")
        throw new ApiError(422, "En kontroll har en status som inte kan exporteras.");
      const id = controlIds.get(control.id)!;
      const customerId = control.customerId ? customerIds.get(control.customerId) : null;
      if (control.customerId && !customerId)
        throw new ApiError(422, "En kontroll saknar sin kund i exporten.");
      for (const attachment of control.attachments) {
        const attachmentId = randomUUID();
        const localAttachment: LocalAttachment = {
          id: attachmentId, controlId: id, filename: attachment.filename,
          storageName: `${randomUUID()}.${storageExtension(attachment.filename, attachment.mimeType)}`,
          mimeType: attachment.mimeType, size: attachment.size,
          section: attachment.section as LocalAttachment["section"], rowId: attachment.rowId,
          createdAt: attachment.createdAt.toISOString(),
          cloudOrigin: { id: attachment.id },
        };
        workspace.attachments.push(localAttachment);
        attachmentPaths.set(attachmentId, attachment.storagePath);
      }
      return {
        id, number: control.number, customerId: customerId ?? null,
        projectId: control.projectId ? projectIds.get(control.projectId) ?? null : null,
        facilityId: localFacilityId(control.facilityId),
        title: control.title, project: control.project, performer: control.performer,
        date: control.date, status: control.status,
        version: control.version,
        deletedAt: control.deletedAt?.toISOString() ?? null,
        postedAt: control.postedAt?.toISOString() ?? null,
        lastOpenedAt: control.lastOpenedAt?.toISOString() ?? null,
        createdAt: control.createdAt.toISOString(), updatedAt: control.updatedAt.toISOString(),
        data: normalizeControl(control.data),
        revisions: control.revisions.map((revision) => ({
          id: randomUUID(), version: revision.version,
          createdAt: revision.createdAt.toISOString(), data: normalizeControl(revision.data),
        })),
        // Manual time on controls follows them into the file (additive, decision 13).
        timeEntries: control.timeEntries.map(localTimeEntry),
        cloudOrigin: { id: control.id, version: control.version,
          siteId: control.siteId, departmentId: control.departmentId,
          attachmentIds: control.attachments.map((attachment) => attachment.id).sort() },
      };
    });
    workspace.workflowTasks = workflowTasks.map((task) => {
      const id = workflowTaskIds.get(task.id)!;
      for (const attachment of task.attachments) {
        const attachmentId = randomUUID();
        workspace.attachments.push({ id: attachmentId, controlId: null, taskId: id, filename: attachment.filename, storageName: `${randomUUID()}.${storageExtension(attachment.filename, attachment.mimeType)}`, mimeType: attachment.mimeType, size: attachment.size, section: "vis", rowId: null, createdAt: attachment.createdAt.toISOString(), cloudOrigin: { id: attachment.id } });
        attachmentPaths.set(attachmentId, attachment.storagePath);
      }
      return {
      id, version: task.version, kind: task.kind as "WORK_ORDER" | "RISK_ASSESSMENT" | "FORM", title: task.title, description: task.description, status: task.status as "PLANNED" | "IN_PROGRESS" | "PAUSED" | "NEEDS_ACTION" | "COMPLETED", progress: task.progress,
      projectId: task.projectId ? projectIds.get(task.projectId) ?? null : null,
      customerId: task.customerId ? customerIds.get(task.customerId) ?? null : null,
      facilityId: localFacilityId(task.facilityId),
      siteId: task.siteId, departmentId: task.departmentId, assignedToUserId: task.assignedToUserId, assignedToName: task.assignedToName, dueDate: task.dueDate,
      data: workflowTaskDataSchema.parse(task.data), startedAt: task.startedAt?.toISOString() ?? null, completedAt: task.completedAt?.toISOString() ?? null, createdAt: task.createdAt.toISOString(), updatedAt: task.updatedAt.toISOString(),
      timeEntries: task.timeEntries.map(localTimeEntry),
      revisions: task.revisions.map((revision) => ({ id: randomUUID(), version: revision.version, createdAt: revision.createdAt.toISOString(), snapshot: portableTaskSnapshot(revision.snapshot, task) })),
      cloudOrigin: { id: task.id, version: task.version, attachmentIds: task.attachments.map((attachment) => attachment.id).sort() },
    };});
    // History of entries that no longer exist keeps a stable file id of its own; task references use the file's ids.
    const portableSnapshot = (value: unknown) => {
      const parsed = timeEntrySnapshotSchema.safeParse(value);
      return parsed.success ? { ...parsed.data, taskId: workflowTaskIds.get(parsed.data.taskId) ?? controlIds.get(parsed.data.taskId) ?? parsed.data.taskId } : null;
    };
    workspace.timeEntryEvents = timeEntryEvents.map((event) => ({
      id: randomUUID(), entryId: localEntryId(event.entryId), userId: event.userId, action: event.action as "CREATED" | "UPDATED" | "DELETED",
      previous: portableSnapshot(event.previous), next: portableSnapshot(event.next), reason: event.reason,
      actorUserId: event.actorUserId, actorName: event.actorName, createdAt: event.createdAt.toISOString(), cloudOrigin: { id: event.id },
    })).reverse();
    workspace.plannedActivities = plannedActivities.map((activity) => ({
      id: randomUUID(),
      version: activity.version,
      title: activity.title,
      description: activity.description,
      kind: activity.kind as "TASK" | "MEETING" | "DEADLINE" | "OTHER",
      status: activity.status as "PLANNED" | "IN_PROGRESS" | "COMPLETED" | "CANCELED",
      frameExceptionReason: "",
      startsAt: activity.startsAt.toISOString(),
      endsAt: activity.endsAt.toISOString(),
      projectId: activity.projectId ? projectIds.get(activity.projectId) ?? null : null,
      workflowTaskId: activity.workflowTaskId ? workflowTaskIds.get(activity.workflowTaskId) ?? null : null,
      controlId: activity.controlId ? controlIds.get(activity.controlId) ?? null : null,
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
    }));
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
    if (bundle.size > MAX_CLOUD_WORKSPACE_BUNDLE_BYTES)
      throw new ApiError(413, "Cloud-kopian skulle bli större än 50 MB. Ingen ofullständig export skapades.");
    await prisma.localWorkspaceBinding.upsert({
      where: { organizationId_userId_localIdentityId: {
        organizationId: ctx.organizationId, userId: ctx.user.id, localIdentityId: workspace.localIdentity.id,
      } },
      create: {
        organizationId: ctx.organizationId, userId: ctx.user.id, localIdentityId: workspace.localIdentity.id,
        memberWeeklyWorkMinutesAtBinding: exportingMember.weeklyWorkMinutes,
        scheduleBaselineCapturedAt: new Date(),
      },
      update: {
        revokedAt: null, revokedByUserId: null,
        memberWeeklyWorkMinutesAtBinding: exportingMember.weeklyWorkMinutes,
        scheduleBaselineCapturedAt: new Date(), lastLocalScheduleUpdatedAt: null, lastScheduleSyncedAt: null,
      },
    });
    return new Response(bundle, {
      headers: {
        "Content-Type": LOCAL_WORKSPACE_BUNDLE_MIME,
        "Content-Disposition": `attachment; filename="${localWorkspaceBundleFilename(ctx.organization.name)}"`,
        "Cache-Control": "private, no-store",
      },
    });
  } catch (error) {
    return failure(error);
  }
}
