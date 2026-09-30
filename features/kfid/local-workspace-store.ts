import { z } from "zod";
import {
  controlSchema,
  customerSchema,
  normalizeControl,
  validateForCompletion,
  type ControlData,
} from "@/lib/kfid/model";
import { workflowTaskCompletion, workflowTaskKinds, workflowTaskDataSchema, workflowTaskHasDocumentation, workflowTaskInputSchema, workflowTaskProgress, resetWorkflowTaskApproval, stampWorkflowTaskApproval } from "@/lib/workflow/task-model";
import { plannedActivityAssignments, plannedActivityEventSchema, plannedActivityInputSchema, plannedActivitySummary, timeBudgetMinutesSchema } from "@/lib/workflow/planned-activity";
import { DEFAULT_WEEKLY_WORK_MINUTES, weeklyWorkMinutesOverrideSchema, weeklyWorkMinutesSchema } from "@/lib/workflow/work-schedule";
import { assertTimeCorrection, timeEntryEventSchema, type TimeEntryEvent, type TimeEntrySnapshot } from "@/lib/workflow/time-correction";
import { summarizeProjectStatus } from "@/lib/workflow/project-status";
import { planningFrameError, projectDecisionInputSchema, projectFrameError, shiftDay, taskDueDateError } from "@/lib/workflow/project-frame";
import { customerFacilityInputSchema, facilityLinkError, type CustomerFacilityInput } from "@/lib/workflow/customer-facility";
import { addSwedishDays } from "@/lib/swedish-time";
import { formLimitProfileInputSchema, limitProfileValueSchema, type FormLimitProfileInput } from "@/lib/workflow/form-limits";
import { defaultScheduleReminders, formScheduleInputSchema, formScheduleRemindersSchema, formScheduleRuleSchema, type FormScheduleInput } from "@/lib/workflow/form-schedule";
import { MIN_TIME_ENTRY_SECONDS, type StoppedTimer } from "@/lib/workflow/running-timer";

export const LOCAL_WORKSPACE_FILENAME = "kfid-workspace.json";
const LOCAL_WORKSPACE_BACKUP_FILENAME = "kfid-workspace.backup.json";
const LOCAL_WORKSPACE_FORMAT = "KFID_LOCAL_WORKSPACE";
export const LOCAL_WORKSPACE_SCHEMA_VERSION = 11;

const timestamp = z.iso.datetime();
const cloudOriginSchema = z.object({
  id: z.string().min(1).max(100),
  version: z.number().int().positive(),
});
const localCustomerSchema = customerSchema.extend({
  id: z.string().uuid(),
  version: z.number().int().positive(),
  deletedAt: timestamp.nullable(),
  createdAt: timestamp,
  updatedAt: timestamp,
  cloudOrigin: cloudOriginSchema.optional(),
});
const localRevisionSchema = z.object({
  id: z.string().uuid(),
  version: z.number().int().positive(),
  createdAt: timestamp,
  data: controlSchema,
});
const localWorkflowTimeEntrySchema = z.object({ id: z.string().uuid(), userId: z.string().max(100), startedAt: timestamp, endedAt: timestamp.nullable(), durationSec: z.number().int().nonnegative(), note: z.string().max(1000), createdAt: timestamp, updatedAt: timestamp, cloudOrigin: z.object({ id: z.string().min(1).max(100) }).optional() });
const localControlSchema = z.object({
  id: z.string().uuid(),
  number: z.number().int().positive(),
  customerId: z.string().uuid().nullable(),
  projectId: z.string().uuid().nullable().default(null),
  facilityId: z.string().uuid().nullable().default(null),
  title: z.string().max(500),
  project: z.string().max(500),
  performer: z.string().max(500),
  date: z.string().max(500),
  status: z.enum(["DRAFT", "COMPLETED"]),
  version: z.number().int().positive(),
  deletedAt: timestamp.nullable(),
  postedAt: timestamp.nullable(),
  lastOpenedAt: timestamp.nullable(),
  createdAt: timestamp,
  updatedAt: timestamp,
  data: controlSchema,
  revisions: z.array(localRevisionSchema),
  // Manual time on the control (additive, 2026-09-26, decision 13): older files read as controls without time.
  timeEntries: z.array(localWorkflowTimeEntrySchema).default([]),
  cloudOrigin: cloudOriginSchema.extend({
    siteId: z.string().nullable(),
    departmentId: z.string().nullable(),
    attachmentIds: z.array(z.string().min(1).max(100)).optional(),
  }).optional(),
});
const localProjectHistorySchema = z.object({
  id: z.string().uuid(),
  kind: z.enum(["CREATED", "UPDATED", "BUDGET_UPDATED", "ARCHIVED", "RESTORED", "TASK_LINKED", "TASK_REOPENED", "CLOSED", "REOPENED", "PLANNING_EXCEPTION", "TASK_MOVED"]),
  summary: z.string().min(1).max(500),
  taskId: z.string().uuid().nullable().default(null),
  actorName: z.string().max(160).default(""),
  createdAt: timestamp,
});
// The project's append-only decision log (additive, 2026-09-26): same fields as Cloud's ProjectDecision.
const localProjectDecisionSchema = projectDecisionInputSchema.extend({
  id: z.string().uuid(),
  actorName: z.string().max(160).default(""),
  createdAt: timestamp,
});
const localWorkScheduleEventSchema = z.object({
  id: z.string().uuid(),
  scope: z.enum(["ORGANIZATION", "MEMBER"]),
  previousMinutes: weeklyWorkMinutesOverrideSchema,
  nextMinutes: weeklyWorkMinutesOverrideSchema,
  actorName: z.string().max(160).default(""),
  createdAt: timestamp,
});
const localProjectSchema = z.object({
  id: z.string().uuid(),
  name: z.string().trim().min(1).max(160),
  description: z.string().max(2000),
  // Frame start and fixed project fields (additive, 2026-09-26): older files read as projects without a frame.
  startDate: z.union([z.literal(""), z.iso.date()]).default(""),
  dueDate: z.union([z.literal(""), z.iso.date()]),
  client: z.string().max(200).default(""),
  contactPerson: z.string().max(200).default(""),
  reference: z.string().max(120).default(""),
  workSite: z.string().max(300).default(""),
  customerId: z.string().uuid().nullable(),
  facilityId: z.string().uuid().nullable().default(null),
  taskTypes: z.array(z.enum(["WORK_ORDER", "RISK_ASSESSMENT", "COMMISSIONING_CONTROL"])).max(3).default([]),
  workMoments: z.array(z.enum(["START_TIME", "EXECUTION", "SIGN_REPORT", "CLOSE_ORDER"])).max(4).default([]),
  responsibleUserId: z.string().max(100).nullable().default(null),
  responsibleName: z.string().max(160).default(""),
  timeBudgetMinutes: timeBudgetMinutesSchema.default(0),
  archivedAt: timestamp.nullable().default(null),
  // Manual closure (additive, 2026-09-26): older files read as open projects.
  closedAt: timestamp.nullable().default(null),
  events: z.array(localProjectHistorySchema).default([]),
  decisions: z.array(localProjectDecisionSchema).default([]),
  createdAt: timestamp,
  updatedAt: timestamp,
  cloudOrigin: z.object({ id: z.string().min(1).max(100) }).optional(),
});
const localPlannedActivitySchema = plannedActivityInputSchema.safeExtend({
  id: z.string().uuid(),
  version: z.number().int().positive(),
  deletedAt: timestamp.nullable().default(null),
  createdAt: timestamp,
  updatedAt: timestamp,
  events: z.array(plannedActivityEventSchema).default([]),
  cloudOrigin: cloudOriginSchema.optional(),
});
// cloudOrigin (additive, 2026-09-26) keeps the Cloud identity of an exported entry so its history stays linked on re-import.
const localWorkflowTaskRevisionSchema = z.object({
  id: z.string().uuid(),
  version: z.number().int().positive(),
  createdAt: timestamp,
  snapshot: z.object({
    title: z.string().min(1).max(200),
    description: z.string().max(5000),
    status: z.enum(["PLANNED", "IN_PROGRESS", "PAUSED", "NEEDS_ACTION", "COMPLETED"]),
    progress: z.number().int().min(0).max(100),
    data: workflowTaskDataSchema,
    completedAt: timestamp.nullable(),
  }),
});
const localWorkflowTaskSchema = z.object({
  completionHistory: z.array(z.object({ version: z.number().int().positive(), title: z.string(), description: z.string(), data: workflowTaskDataSchema, completedAt: timestamp.nullable(), reopenedAt: timestamp })).optional(),
  id: z.string().uuid(), version: z.number().int().positive(), kind: z.enum(workflowTaskKinds), title: z.string().min(1).max(200), description: z.string().max(5000), status: z.enum(["PLANNED", "IN_PROGRESS", "PAUSED", "NEEDS_ACTION", "COMPLETED"]), progress: z.number().int().min(0).max(100), projectId: z.string().uuid().nullable(), customerId: z.string().uuid().nullable(), facilityId: z.string().uuid().nullable().default(null), siteId: z.string().nullable(), departmentId: z.string().nullable(), assignedToUserId: z.string().nullable(), assignedToName: z.string().max(160), dueDate: z.union([z.literal(""), z.iso.date()]), data: workflowTaskDataSchema, startedAt: timestamp.nullable(), completedAt: timestamp.nullable(), createdAt: timestamp, updatedAt: timestamp, timeEntries: z.array(localWorkflowTimeEntrySchema), revisions: z.array(localWorkflowTaskRevisionSchema).default([]), cloudOrigin: cloudOriginSchema.extend({ attachmentIds: z.array(z.string().min(1).max(100)).optional() }).optional(),
});
const localAttachmentSchema = z.object({
  id: z.string().uuid(),
  controlId: z.string().uuid().nullable().default(null),
  taskId: z.string().uuid().nullable().optional(),
  filename: z.string().min(1).max(200),
  storageName: z
    .string()
    .regex(/^[0-9a-f-]{36}\.(jpg|png|webp|pdf|txt|doc|docx|xls|xlsx)$/),
  mimeType: z.string().min(1).max(100),
  size: z.number().int().positive().max(10_000_000),
  section: z.enum(["iso", "cont", "volt", "rcd", "vis"]),
  rowId: z.string().max(100).nullable(),
  createdAt: timestamp,
  cloudOrigin: z.object({ id: z.string().min(1).max(100) }).optional(),
}).superRefine((attachment, context) => {
  if (Boolean(attachment.controlId) === Boolean(attachment.taskId)) context.addIssue({ code: "custom", path: ["controlId"], message: "Bilagan ska tillhöra exakt en kontroll eller uppgift." });
});

// Customer facilities (additive, 2026-09-26, decision 11): same fields as Cloud's CustomerFacility.
const localCustomerFacilitySchema = customerFacilityInputSchema.extend({
  id: z.string().uuid(),
  customerId: z.string().uuid(),
  isActive: z.boolean().default(true),
  version: z.number().int().positive().default(1),
  createdAt: timestamp,
  updatedAt: timestamp,
  cloudOrigin: z.object({ id: z.string().min(1).max(100) }).optional(),
});

// The file's limit profiles and round schedules use the same shapes and rules as Cloud (lib/workflow/form-limits.ts, form-schedule.ts).
const localFormLimitProfileSchema = z.object({ id: z.string().min(1).max(100), templateId: z.string().min(1).max(100), facilityId: z.string().min(1).max(100), objectName: z.string().max(120).default(""),
  values: z.record(z.string().max(40), limitProfileValueSchema).default({}), version: z.number().int().positive().default(1), updatedAt: timestamp, updatedByName: z.string().max(200).default("") });
const localFormScheduleSchema = z.object({ id: z.string().min(1).max(100), version: z.number().int().positive().default(1), title: z.string().min(1).max(200), templateId: z.string().min(1).max(100),
  customerId: z.string().max(100).nullable().default(null), facilityId: z.string().max(100).nullable().default(null), projectId: z.string().max(100).nullable().default(null),
  assignedToUserId: z.string().max(100).nullable().default(null), assignedToName: z.string().max(160).default(""), active: z.boolean().default(true), rule: formScheduleRuleSchema,
  // Round reminders (2026-09-30), additive: kept in the file; the bell and e-mail are Cloud's.
  reminders: formScheduleRemindersSchema.default(defaultScheduleReminders),
  templateName: z.string().max(200).default(""), deletedAt: timestamp.nullable().default(null), createdAt: timestamp, updatedAt: timestamp });

const workspaceContentsSchema = z.object({
    workspaceId: z.string().uuid(),
    createdAt: z.iso.datetime(),
    updatedAt: z.iso.datetime(),
    cloudSnapshot: z.object({
      format: z.literal("KFID_CLOUD_SNAPSHOT"),
      schemaVersion: z.literal(1),
      exportedAt: timestamp,
    }).optional(),
    customers: z.array(localCustomerSchema),
    customerFacilities: z.array(localCustomerFacilitySchema).default([]),
    projects: z.array(localProjectSchema).default([]),
    plannedActivities: z.array(localPlannedActivitySchema).default([]),
    workScheduleEvents: z.array(localWorkScheduleEventSchema).default([]),
    // Additive and defaulted: older files open unchanged and gain history from their next correction.
    timeEntryEvents: z.array(timeEntryEventSchema).default([]),
    workflowTasks: z.array(localWorkflowTaskSchema).default([]),
    // Limit profiles and round schedules (2026-09-28): additive and defaulted like the facilities, so older files open unchanged.
    formLimitProfiles: z.array(localFormLimitProfileSchema).default([]),
    formSchedules: z.array(localFormScheduleSchema).default([]),
    controls: z.array(localControlSchema),
    attachments: z.array(localAttachmentSchema),
  }).passthrough();

const localWorkspaceV1Schema = workspaceContentsSchema.extend({
  format: z.literal(LOCAL_WORKSPACE_FORMAT),
  schemaVersion: z.literal(1),
  organization: z.object({ id: z.string().min(1), name: z.string().min(1) }),
}).passthrough();

const localWorkspaceV2Schema = workspaceContentsSchema.extend({
  format: z.literal(LOCAL_WORKSPACE_FORMAT),
  schemaVersion: z.literal(2),
  localIdentity: z.object({ id: z.string().uuid(), name: z.string().min(1) }),
  cloudBinding: z.object({
    organizationId: z.string().min(1),
    organizationName: z.string().min(1),
  }),
  organization: z.object({ id: z.string().min(1), name: z.string().min(1) }),
}).passthrough();

const localWorkspaceV3Schema = workspaceContentsSchema.extend({
  format: z.literal(LOCAL_WORKSPACE_FORMAT),
  schemaVersion: z.literal(3),
  localIdentity: z.object({ id: z.string().uuid(), name: z.string().min(1) }),
  cloudBinding: z.object({ organizationId: z.string().min(1), organizationName: z.string().min(1) }),
  organization: z.object({ id: z.string().min(1), name: z.string().min(1) }),
}).passthrough();

const localWorkspaceV4Schema = workspaceContentsSchema.extend({
  format: z.literal(LOCAL_WORKSPACE_FORMAT),
  schemaVersion: z.literal(4),
  localIdentity: z.object({ id: z.string().uuid(), name: z.string().min(1) }),
  cloudBinding: z.object({ organizationId: z.string().min(1), organizationName: z.string().min(1) }),
  organization: z.object({ id: z.string().min(1), name: z.string().min(1) }),
}).passthrough();

const localWorkspaceV5Schema = workspaceContentsSchema.extend({
  format: z.literal(LOCAL_WORKSPACE_FORMAT),
  schemaVersion: z.literal(5),
  localIdentity: z.object({ id: z.string().uuid(), name: z.string().min(1) }),
  cloudBinding: z.object({ organizationId: z.string().min(1), organizationName: z.string().min(1) }),
  organization: z.object({ id: z.string().min(1), name: z.string().min(1) }),
}).passthrough();

const localWorkspaceV6Schema = workspaceContentsSchema.extend({
  format: z.literal(LOCAL_WORKSPACE_FORMAT),
  schemaVersion: z.literal(6),
  localIdentity: z.object({ id: z.string().uuid(), name: z.string().min(1) }),
  cloudBinding: z.object({ organizationId: z.string().min(1), organizationName: z.string().min(1) }),
  organization: z.object({ id: z.string().min(1), name: z.string().min(1) }),
}).passthrough();

const localWorkspaceV7Schema = workspaceContentsSchema.extend({
  format: z.literal(LOCAL_WORKSPACE_FORMAT),
  schemaVersion: z.literal(7),
  localIdentity: z.object({ id: z.string().uuid(), name: z.string().min(1) }),
  cloudBinding: z.object({ organizationId: z.string().min(1), organizationName: z.string().min(1) }),
  organization: z.object({ id: z.string().min(1), name: z.string().min(1) }),
}).passthrough();

const localWorkspaceV8Schema = workspaceContentsSchema.extend({
  format: z.literal(LOCAL_WORKSPACE_FORMAT),
  schemaVersion: z.literal(8),
  localIdentity: z.object({ id: z.string().uuid(), name: z.string().min(1) }),
  cloudBinding: z.object({ organizationId: z.string().min(1), organizationName: z.string().min(1) }),
  organization: z.object({ id: z.string().min(1), name: z.string().min(1) }),
}).passthrough();

const localWorkspaceV9Schema = workspaceContentsSchema.extend({
  format: z.literal(LOCAL_WORKSPACE_FORMAT),
  schemaVersion: z.literal(9),
  localIdentity: z.object({ id: z.string().uuid(), name: z.string().min(1), weeklyWorkMinutes: weeklyWorkMinutesOverrideSchema.default(null) }),
  cloudBinding: z.object({ organizationId: z.string().min(1), organizationName: z.string().min(1) }),
  organization: z.object({ id: z.string().min(1), name: z.string().min(1), weeklyWorkMinutes: weeklyWorkMinutesSchema.default(DEFAULT_WEEKLY_WORK_MINUTES) }),
}).passthrough();

const localWorkspaceV10Schema = workspaceContentsSchema.extend({
  format: z.literal(LOCAL_WORKSPACE_FORMAT),
  schemaVersion: z.literal(10),
  localIdentity: z.object({ id: z.string().uuid(), name: z.string().min(1), weeklyWorkMinutes: weeklyWorkMinutesOverrideSchema.default(null) }),
  cloudBinding: z.object({ organizationId: z.string().min(1), organizationName: z.string().min(1) }),
  organization: z.object({ id: z.string().min(1), name: z.string().min(1), weeklyWorkMinutes: weeklyWorkMinutesSchema.default(DEFAULT_WEEKLY_WORK_MINUTES) }),
}).passthrough();

const localWorkspaceSchema = workspaceContentsSchema
  .extend({
    format: z.literal(LOCAL_WORKSPACE_FORMAT),
    schemaVersion: z.literal(LOCAL_WORKSPACE_SCHEMA_VERSION),
    localIdentity: z.object({ id: z.string().uuid(), name: z.string().min(1), weeklyWorkMinutes: weeklyWorkMinutesOverrideSchema.default(null) }),
    cloudBinding: z.object({
      organizationId: z.string().min(1),
      organizationName: z.string().min(1),
    }),
    organization: z.object({ id: z.string().min(1), name: z.string().min(1), weeklyWorkMinutes: weeklyWorkMinutesSchema.default(DEFAULT_WEEKLY_WORK_MINUTES) }),
  })
  .passthrough()
  .superRefine((workspace, context) => {
    const customerIds = new Set<string>();
    for (const customer of workspace.customers) {
      if (customerIds.has(customer.id))
        context.addIssue({
          code: "custom",
          path: ["customers"],
          message: "Dubblett i kundregistret.",
        });
      customerIds.add(customer.id);
    }
    const facilityIds = new Set<string>();
    for (const facility of workspace.customerFacilities) {
      if (facilityIds.has(facility.id)) context.addIssue({ code: "custom", path: ["customerFacilities"], message: "Dubblett i anläggningsregistret." });
      if (!customerIds.has(facility.customerId)) context.addIssue({ code: "custom", path: ["customerFacilities"], message: "En anläggning hänvisar till en kund som saknas." });
      facilityIds.add(facility.id);
    }
    for (const item of [...workspace.projects, ...workspace.workflowTasks, ...workspace.controls])
      if (item.facilityId && !facilityIds.has(item.facilityId)) context.addIssue({ code: "custom", path: ["customerFacilities"], message: "En post hänvisar till en anläggning som saknas." });
    const controlIds = new Set<string>();
    const projectIds = new Set(workspace.projects.map((project) => project.id));
    for (const project of workspace.projects) {
      if (project.customerId && !customerIds.has(project.customerId))
        context.addIssue({
          code: "custom",
          path: ["projects"],
          message: "Ett projekt hänvisar till en kund som saknas.",
        });
    }
    const controlNumbers = new Set<number>();
    const workflowTaskIds = new Set<string>();
    for (const task of workspace.workflowTasks) {
      if (workflowTaskIds.has(task.id)) context.addIssue({ code: "custom", path: ["workflowTasks"], message: "Dubblett i uppgiftsregistret." });
      if (task.projectId && !projectIds.has(task.projectId)) context.addIssue({ code: "custom", path: ["workflowTasks"], message: "En uppgift hänvisar till ett projekt som saknas." });
      if (task.customerId && !customerIds.has(task.customerId)) context.addIssue({ code: "custom", path: ["workflowTasks"], message: "En uppgift hänvisar till en kund som saknas." });
      workflowTaskIds.add(task.id);
    }
    for (const control of workspace.controls) {
      if (controlIds.has(control.id) || controlNumbers.has(control.number))
        context.addIssue({
          code: "custom",
          path: ["controls"],
          message: "Dubblett i kontrollregistret.",
        });
      if (control.customerId && !customerIds.has(control.customerId))
        context.addIssue({
          code: "custom",
          path: ["controls"],
          message: "En kontroll hänvisar till en kund som saknas.",
        });
      if (control.projectId && !projectIds.has(control.projectId))
        context.addIssue({
          code: "custom",
          path: ["controls"],
          message: "En kontroll hänvisar till ett projekt som saknas.",
        });
      controlIds.add(control.id);
      controlNumbers.add(control.number);
    }
    const plannedActivityIds = new Set<string>();
    for (const activity of workspace.plannedActivities) {
      if (plannedActivityIds.has(activity.id)) context.addIssue({ code: "custom", path: ["plannedActivities"], message: "Dubblett i planeringsregistret." });
      if (activity.projectId && !projectIds.has(activity.projectId)) context.addIssue({ code: "custom", path: ["plannedActivities"], message: "En planerad aktivitet hänvisar till ett projekt som saknas." });
      if (activity.workflowTaskId && !workflowTaskIds.has(activity.workflowTaskId)) context.addIssue({ code: "custom", path: ["plannedActivities"], message: "En planerad aktivitet hänvisar till en uppgift som saknas." });
      if (activity.controlId && !controlIds.has(activity.controlId)) context.addIssue({ code: "custom", path: ["plannedActivities"], message: "En planerad aktivitet hänvisar till en kontroll som saknas." });
      plannedActivityIds.add(activity.id);
    }
    const attachmentIds = new Set<string>();
    const storageNames = new Set<string>();
    for (const attachment of workspace.attachments) {
      if (
        attachmentIds.has(attachment.id) ||
        storageNames.has(`${attachment.controlId ?? attachment.taskId}/${attachment.storageName}`)
      )
        context.addIssue({
          code: "custom",
          path: ["attachments"],
          message: "Dubblett i bilageregistret.",
        });
      if (attachment.controlId && !controlIds.has(attachment.controlId))
        context.addIssue({
          code: "custom",
          path: ["attachments"],
          message: "En bilaga hänvisar till en kontroll som saknas.",
        });
      if (attachment.taskId && !workflowTaskIds.has(attachment.taskId)) context.addIssue({ code: "custom", path: ["attachments"], message: "En bilaga hänvisar till en uppgift som saknas." });
      attachmentIds.add(attachment.id);
      storageNames.add(`${attachment.controlId ?? attachment.taskId}/${attachment.storageName}`);
    }
  });

export type LocalWorkspaceDocument = z.infer<typeof localWorkspaceSchema>;
export type LocalCustomer = z.infer<typeof localCustomerSchema>;
export type LocalProject = z.infer<typeof localProjectSchema>;
export type LocalWorkflowTask = z.infer<typeof localWorkflowTaskSchema>;
export type LocalControl = z.infer<typeof localControlSchema>;
export type LocalAttachment = z.infer<typeof localAttachmentSchema>;
export type LocalPlannedActivity = z.infer<typeof localPlannedActivitySchema>;
export type LocalRecordKind = "controls" | "customers";
export type LocalRecordAction = "delete" | "restore" | "purge";

export function localCustomerItem(customer: LocalCustomer) {
  const { createdAt: _createdAt, updatedAt: _updatedAt, ...item } = customer;
  void _createdAt;
  void _updatedAt;
  return item;
}

export function saveLocalCustomerRecord(
  workspace: LocalWorkspaceDocument,
  input: unknown,
  customerId?: string,
  expectedVersion?: number,
) {
  const data = customerSchema.parse(input);
  const now = new Date().toISOString();
  const current = customerId
    ? workspace.customers.find((customer) => customer.id === customerId)
    : undefined;
  if (customerId && (!current || current.deletedAt))
    throw new Error("Kunden hittades inte i den lokala arbetsytan.");
  if (current && current.version !== expectedVersion)
    throw new Error("Kunden har ändrats. Öppna den lokala filen igen.");
  const customer: LocalCustomer = current
    ? {
        ...current,
        ...data,
        lat: data.lat ?? null,
        lng: data.lng ?? null,
        version: current.version + 1,
        updatedAt: now,
      }
    : {
        id: crypto.randomUUID(),
        ...data,
        lat: data.lat ?? null,
        lng: data.lng ?? null,
        version: 1,
        deletedAt: null,
        createdAt: now,
        updatedAt: now,
      };
  return {
    workspace: {
      ...workspace,
      customers: current
        ? workspace.customers.map((item) =>
            item.id === customer.id ? customer : item,
          )
        : [...workspace.customers, customer],
    },
    customer,
  };
}

export function saveLocalControlRecord(
  workspace: LocalWorkspaceDocument,
  input: {
    id?: string;
    version: number;
    customerId: string | null;
    projectId?: string | null;
    facilityId?: string | null;
    data: ControlData;
    status: "DRAFT" | "COMPLETED";
    copy?: boolean;
  },
) {
  const data = normalizeControl(input.data);
  let facilityId: string | null = null;
  if (!data.meta.proj.trim())
    throw new Error("Ange projekt eller anläggning innan du sparar.");
  if (
    input.customerId &&
    !workspace.customers.some(
      (customer) => customer.id === input.customerId && !customer.deletedAt,
    )
  )
    throw new Error("Kunden hittades inte i den lokala arbetsytan.");
  if (
    input.projectId &&
    !workspace.projects.some((project) => project.id === input.projectId)
  )
    throw new Error("Projektet hittades inte i den lokala arbetsytan.");
  if (input.projectId && workspace.projects.find((project) => project.id === input.projectId)?.archivedAt)
    throw new Error("Återställ projektet innan du sparar kontrollen.");
  if (input.projectId && workspace.projects.find((project) => project.id === input.projectId)?.closedAt)
    throw new Error("Projektet är avslutat. Återöppna projektet innan du sparar en kontroll i det.");
  {
    // Same rule as Cloud: a new control in a project, or a changed customer/project, takes the project's customer.
    const project = input.projectId ? workspace.projects.find((item) => item.id === input.projectId) : undefined;
    const prior = input.id && !input.copy ? workspace.controls.find((control) => control.id === input.id) : undefined;
    const changed = !prior || (prior.projectId ?? null) !== (input.projectId ?? null) || (prior.customerId ?? null) !== (input.customerId ?? null);
    if (project?.customerId && input.customerId !== project.customerId && changed) throw new Error("En kontroll i projektet har projektets kund.");
    if (prior && (prior.projectId ?? null) !== (input.projectId ?? null)) throw new Error("Byt projekt via projektets Koppla befintlig uppgift, så att bytet hamnar i historiken.");
    // Same rule as Cloud: a new control in a project takes the project's facility; later it stays with the customer.
    facilityId = input.facilityId !== undefined ? input.facilityId : prior && (prior.customerId ?? null) === (input.customerId ?? null) ? prior.facilityId : null;
    if (!prior && input.facilityId === undefined && project?.facilityId && project.customerId === input.customerId) facilityId = project.facilityId;
    if (input.facilityId !== undefined) assertLocalFacilityLink(workspace, { facilityId: input.facilityId, customerId: input.customerId, previousFacilityId: prior?.facilityId });
  }
  if (
    input.status === "COMPLETED" &&
    !validateForCompletion(data, { attachmentCount: 0 }).complete
  )
    throw new Error(
      `Kontrollen kan inte färdigställas. ${validateForCompletion(data, { attachmentCount: 0 }).errors[0].message}`,
    );
  const current =
    input.id && !input.copy
      ? workspace.controls.find((control) => control.id === input.id)
      : undefined;
  if (input.id && !input.copy && (!current || current.deletedAt))
    throw new Error("Kontrollen hittades inte i den lokala arbetsytan.");
  if (current?.status === "COMPLETED")
    throw new Error("Kontrollen är färdigställd. Skapa en kopia för att ändra.");
  if (current && current.version !== input.version)
    throw new Error("Kontrollen har ändrats. Öppna den lokala filen igen.");
  const now = new Date().toISOString();
  const id = current?.id ?? crypto.randomUUID();
  const version = current ? current.version + 1 : 1;
  const revision = { id: crypto.randomUUID(), version, createdAt: now, data };
  const control: LocalControl = current
    ? {
        ...current,
        customerId: input.customerId,
        projectId: input.projectId ?? null,
        facilityId,
        title: data.meta.name?.trim() || data.meta.proj,
        project: data.meta.proj,
        performer: data.meta.perf,
        date: data.meta.date,
        data,
        status: input.status,
        version,
        updatedAt: now,
        lastOpenedAt: now,
        revisions: [...current.revisions, revision],
      }
    : {
        id,
        number:
          workspace.controls.reduce(
            (highest, item) => Math.max(highest, item.number),
            0,
          ) + 1,
        customerId: input.customerId,
        projectId: input.projectId ?? null,
        facilityId,
        title: data.meta.name?.trim() || data.meta.proj,
        project: data.meta.proj,
        performer: data.meta.perf,
        date: data.meta.date,
        data,
        status: input.status,
        version,
        deletedAt: null,
        postedAt: null,
        lastOpenedAt: now,
        createdAt: now,
        updatedAt: now,
        // A new control, or a copy made with Spara som, starts without reported time.
        timeEntries: [],
        revisions: [revision],
      };
  return {
    workspace: {
      ...workspace,
      controls: current
        ? workspace.controls.map((item) =>
            item.id === control.id ? control : item,
          )
        : [...workspace.controls, control],
    },
    control,
  };
}

export function saveLocalProjectRecord(
  workspace: LocalWorkspaceDocument,
  input: {
    id?: string;
    name: string;
    description: string;
    startDate: string;
    dueDate: string;
    client?: string;
    contactPerson?: string;
    reference?: string;
    workSite?: string;
    customerId: string | null;
    facilityId?: string | null;
    taskTypes?: ("WORK_ORDER" | "RISK_ASSESSMENT" | "COMMISSIONING_CONTROL")[];
    workMoments?: ("START_TIME" | "EXECUTION" | "SIGN_REPORT" | "CLOSE_ORDER")[];
    responsibleUserId?: string | null;
    responsibleName?: string;
    timeBudgetMinutes?: number;
    shiftDays?: number;
  },
  actorName = "",
) {
  const now = new Date().toISOString();
  const current = input.id ? workspace.projects.find((item) => item.id === input.id) : undefined;
  // "Flytta allt lika mycket" (decision 5): open tasks' dates and active planning move with a changed frame.
  const shiftDays = current && (current.startDate !== input.startDate || current.dueDate !== input.dueDate) ? input.shiftDays ?? 0 : 0;
  if (shiftDays && current) {
    const inProject = (taskId: string | null, controlId: string | null, projectId: string | null) => projectId === current.id
      || Boolean(taskId && workspace.workflowTasks.find((task) => task.id === taskId)?.projectId === current.id)
      || Boolean(controlId && workspace.controls.find((control) => control.id === controlId)?.projectId === current.id);
    const move = (value: string) => addSwedishDays(value, shiftDays).toISOString();
    workspace = {
      ...workspace,
      workflowTasks: workspace.workflowTasks.map((task) => task.projectId === current.id && task.status !== "COMPLETED" && task.dueDate ? { ...task, dueDate: shiftDay(task.dueDate, shiftDays), version: task.version + 1, updatedAt: now } : task),
      plannedActivities: workspace.plannedActivities.map((activity) => {
        if (activity.deletedAt || !["PLANNED", "IN_PROGRESS"].includes(activity.status) || !inProject(activity.workflowTaskId, activity.controlId, activity.projectId)) return activity;
        const moved: LocalPlannedActivity = { ...activity, startsAt: move(activity.startsAt), endsAt: move(activity.endsAt), assignments: activity.assignments.map((assignment) => assignment.startsAt && assignment.endsAt ? { ...assignment, startsAt: move(assignment.startsAt), endsAt: move(assignment.endsAt) } : assignment), version: activity.version + 1, updatedAt: now };
        return { ...moved, events: [...activity.events, { id: crypto.randomUUID(), kind: "UPDATED" as const, summary: `Planeringen ${activity.title} flyttades ${shiftDays} dagar med projektets tidsram`, snapshot: localPlannedActivitySnapshot(moved), actorName, createdAt: now }] };
      }),
    };
  }
  // Same frame rule as Cloud: new projects need start and end; existing ones may stay without a frame.
  const frameError = projectFrameError({ startDate: input.startDate, dueDate: input.dueDate }, !current);
  if (frameError) throw new Error(frameError);
  const data = localProjectSchema.omit({ createdAt: true, updatedAt: true }).parse({
    id: input.id ?? crypto.randomUUID(),
    name: input.name,
    description: input.description,
    startDate: input.startDate,
    dueDate: input.dueDate,
    client: input.client ?? "",
    contactPerson: input.contactPerson ?? "",
    reference: input.reference ?? "",
    workSite: input.workSite ?? "",
    customerId: input.customerId,
    facilityId: input.facilityId ?? null,
    taskTypes: input.taskTypes ?? [],
    workMoments: input.workMoments ?? [],
    responsibleUserId: input.responsibleUserId ?? null,
    responsibleName: input.responsibleName ?? "",
    timeBudgetMinutes: input.timeBudgetMinutes ?? current?.timeBudgetMinutes ?? 0,
    archivedAt: null,
    events: [],
  });
  if (data.customerId && !workspace.customers.some((item) => item.id === data.customerId && !item.deletedAt))
    throw new Error("Kunden hittades inte i den lokala arbetsytan.");
  assertLocalFacilityLink(workspace, { facilityId: data.facilityId, customerId: data.customerId, previousFacilityId: current?.facilityId });
  const project: LocalProject = {
    ...data,
    archivedAt: current?.archivedAt ?? null,
    closedAt: current?.closedAt ?? null,
    // The decision log is append-only and is never rebuilt from the form.
    decisions: current?.decisions ?? [],
    events: [...(current?.events ?? []), {
      id: crypto.randomUUID(),
      kind: current && current.timeBudgetMinutes !== data.timeBudgetMinutes ? "BUDGET_UPDATED" : current ? "UPDATED" : "CREATED",
      summary: current
        ? current.timeBudgetMinutes !== data.timeBudgetMinutes
          ? `Projektets tidsbudget ändrades till ${data.timeBudgetMinutes} minuter`
          : "Projektets grunduppgifter uppdaterades"
        : "Projektet skapades",
      taskId: null,
      actorName,
      createdAt: now,
    }],
    createdAt: current?.createdAt ?? now,
    updatedAt: now,
  };
  return {
    workspace: {
      ...workspace,
      projects: current
        ? workspace.projects.map((item) => item.id === project.id ? project : item)
        : [...workspace.projects, project],
    },
    project,
  };
}

/** The link guide in Local (decision 7): same choices and history as Cloud; a completed task keeps its content. */
export function linkLocalTaskToProject(
  workspace: LocalWorkspaceDocument,
  taskId: string,
  taskKind: "COMMISSIONING_CONTROL" | "WORK_ORDER" | "RISK_ASSESSMENT" | "FORM",
  projectId: string,
  apply: { customer: boolean; responsible: boolean; dueDate: string } = { customer: true, responsible: false, dueDate: "" },
  actorName = "",
) {
  const project = workspace.projects.find((item) => item.id === projectId);
  if (!project)
    throw new Error("Projektet hittades inte i den lokala arbetsytan.");
  if (project.archivedAt) throw new Error("Återställ projektet innan du kopplar en uppgift.");
  if (project.closedAt) throw new Error("Projektet är avslutat. Återöppna projektet innan du kopplar en uppgift.");
  const dueError = apply.dueDate ? taskDueDateError(apply.dueDate, project) : null;
  if (dueError) throw new Error(dueError);
  const now = new Date().toISOString();
  // History in both projects, and the task's planning follows it into the project.
  const finish = (next: LocalWorkspaceDocument, title: string, fromProjectId: string | null) => {
    let result = fromProjectId && fromProjectId !== projectId ? appendLocalProjectEvent(next, fromProjectId, "TASK_MOVED", `Uppgiften ${title} flyttades till projektet ${project.name}`, taskId, actorName) : next;
    result = appendLocalProjectEvent(result, projectId, fromProjectId ? "TASK_MOVED" : "TASK_LINKED", fromProjectId ? `Uppgiften ${title} flyttades hit från ett annat projekt` : `Uppgiften ${title} kopplades till projektet`, taskId, actorName);
    return { ...result, plannedActivities: result.plannedActivities.map((activity) => !activity.deletedAt && (activity.workflowTaskId === taskId || activity.controlId === taskId) && activity.projectId !== projectId
      ? { ...activity, projectId, version: activity.version + 1, updatedAt: now, events: [...activity.events, { id: crypto.randomUUID(), kind: "UPDATED" as const, summary: `Planeringen ${activity.title} följde med uppgiften till projektet ${project.name}`, snapshot: localPlannedActivitySnapshot({ ...activity, projectId }), actorName, createdAt: now }] }
      : activity) };
  };
  if (taskKind === "COMMISSIONING_CONTROL") {
    const current = workspace.controls.find((control) => control.id === taskId && !control.deletedAt);
    if (!current) throw new Error("Uppgiften hittades inte i den lokala arbetsytan.");
    const version = current.version + 1;
    const updated: LocalControl = {
      ...current,
      projectId,
      customerId: apply.customer && current.status !== "COMPLETED" && project.customerId ? project.customerId : current.customerId,
      facilityId: localFacilityFor(current, project, Boolean(apply.customer && current.status !== "COMPLETED" && project.customerId)),
      version,
      updatedAt: now,
      revisions: [...current.revisions, { id: crypto.randomUUID(), version, createdAt: now, data: current.data }],
    };
    return finish({ ...workspace, controls: workspace.controls.map((control) => control.id === taskId ? updated : control) }, current.title, current.projectId);
  }
  const current = workspace.workflowTasks.find((task) => task.id === taskId && task.kind === taskKind);
  if (!current) throw new Error("Uppgiften hittades inte i den lokala arbetsytan.");
  const open = current.status !== "COMPLETED";
  const updated: LocalWorkflowTask = {
    ...current,
    projectId,
    customerId: open && apply.customer && project.customerId ? project.customerId : current.customerId,
    facilityId: localFacilityFor(current, project, Boolean(open && apply.customer && project.customerId)),
    assignedToUserId: open && apply.responsible && project.responsibleUserId ? project.responsibleUserId : current.assignedToUserId,
    assignedToName: open && apply.responsible && project.responsibleUserId ? project.responsibleName : current.assignedToName,
    dueDate: open && apply.dueDate ? apply.dueDate : current.dueDate,
    version: current.version + 1,
    updatedAt: now,
  };
  return finish({ ...workspace, workflowTasks: workspace.workflowTasks.map((task) => task.id === taskId ? updated : task) }, current.title, current.projectId);
}
/** Same rule as Cloud: taking the project's customer also takes its facility, or keeps the task's own of that customer. */
function localFacilityFor(task: { customerId: string | null; facilityId: string | null }, project: LocalProject, applyCustomer: boolean) {
  return applyCustomer ? project.facilityId ?? (task.customerId === project.customerId ? task.facilityId : null) : task.facilityId;
}

/** Same rule as Cloud's assertFacilityLink: the facility belongs to the item's customer and is active unless already linked. */
function assertLocalFacilityLink(workspace: LocalWorkspaceDocument, input: { facilityId: string | null | undefined; customerId: string | null | undefined; previousFacilityId?: string | null }) {
  if (!input.facilityId) return;
  const error = facilityLinkError(workspace.customerFacilities.find((facility) => facility.id === input.facilityId), { customerId: input.customerId, previousFacilityId: input.previousFacilityId, facilityId: input.facilityId });
  if (error) throw new Error(error);
}

/** Saves a customer facility in the open file (any change bumps its version). */
export function saveLocalCustomerFacility(workspace: LocalWorkspaceDocument, customerId: string, input: { id?: string; facility: CustomerFacilityInput }) {
  if (!workspace.customers.some((customer) => customer.id === customerId && !customer.deletedAt)) throw new Error("Kunden hittades inte i den lokala arbetsytan.");
  const facility = customerFacilityInputSchema.parse(input.facility);
  const now = new Date().toISOString();
  if (input.id) {
    const current = workspace.customerFacilities.find((item) => item.id === input.id && item.customerId === customerId);
    if (!current) throw new Error("Anläggningen hittades inte i den lokala arbetsytan.");
    return { ...workspace, customerFacilities: workspace.customerFacilities.map((item) => item.id === current.id ? { ...item, ...facility, version: item.version + 1, updatedAt: now } : item) };
  }
  return { ...workspace, customerFacilities: [...workspace.customerFacilities, { ...facility, id: crypto.randomUUID(), customerId, isActive: true, version: 1, createdAt: now, updatedAt: now }] };
}

export function setLocalCustomerFacilityActive(workspace: LocalWorkspaceDocument, id: string, isActive: boolean) {
  if (!workspace.customerFacilities.some((item) => item.id === id)) throw new Error("Anläggningen hittades inte i den lokala arbetsytan.");
  const now = new Date().toISOString();
  return { ...workspace, customerFacilities: workspace.customerFacilities.map((item) => item.id === id ? { ...item, isActive, version: item.version + 1, updatedAt: now } : item) };
}

function appendLocalProjectEvent(workspace: LocalWorkspaceDocument, projectId: string, kind: "CREATED" | "UPDATED" | "ARCHIVED" | "RESTORED" | "TASK_LINKED" | "TASK_REOPENED" | "PLANNING_EXCEPTION" | "TASK_MOVED", summary: string, taskId: string | null = null, actorName = "") {
  const now = new Date().toISOString();
  return { ...workspace, projects: workspace.projects.map((project) => project.id === projectId ? { ...project, updatedAt: now, events: [...project.events, { id: crypto.randomUUID(), kind, summary, taskId, actorName, createdAt: now }] } : project) };
}

export function setLocalProjectArchived(workspace: LocalWorkspaceDocument, projectId: string, archived: boolean, actorName = "") {
  const project = workspace.projects.find((item) => item.id === projectId);
  if (!project) throw new Error("Projektet hittades inte i den lokala arbetsytan.");
  if (Boolean(project.archivedAt) === archived) return workspace;
  const now = new Date().toISOString();
  return { ...workspace, projects: workspace.projects.map((item) => item.id === projectId ? { ...item, archivedAt: archived ? now : null, updatedAt: now, events: [...item.events, { id: crypto.randomUUID(), kind: archived ? "ARCHIVED" as const : "RESTORED" as const, summary: archived ? "Projektet arkiverades" : "Projektet återställdes", taskId: null, actorName, createdAt: now }] } : item) };
}

/** Same rule as Cloud: close only when every task is completed and no planning is active; logged either way. */
export function setLocalProjectClosed(workspace: LocalWorkspaceDocument, projectId: string, closed: boolean, actorName = "") {
  const project = workspace.projects.find((item) => item.id === projectId);
  if (!project) throw new Error("Projektet hittades inte i den lokala arbetsytan.");
  if (project.archivedAt) throw new Error("Återställ projektet från arkivet först.");
  if (Boolean(project.closedAt) === closed) return workspace;
  if (closed) {
    const status = summarizeProjectStatus({
      archivedAt: project.archivedAt, closedAt: project.closedAt, dueDate: project.dueDate,
      tasks: [...workspace.workflowTasks.filter((task) => task.projectId === projectId), ...workspace.controls.filter((control) => control.projectId === projectId && !control.deletedAt)],
      activities: workspace.plannedActivities.filter((activity) => activity.projectId === projectId),
    });
    if (status.state !== "READY_TO_CLOSE") throw new Error("Projektet kan avslutas först när alla uppgifter är slutförda och ingen planering är aktiv.");
  }
  const now = new Date().toISOString();
  return { ...workspace, projects: workspace.projects.map((item) => item.id === projectId ? { ...item, closedAt: closed ? now : null, updatedAt: now, events: [...item.events, { id: crypto.randomUUID(), kind: closed ? "CLOSED" as const : "REOPENED" as const, summary: closed ? "Projektet avslutades" : "Projektet återöppnades", taskId: null, actorName, createdAt: now }] } : item) };
}

/** Same rule as Cloud: a decision is appended to the log and never edited or removed; an archived project is read-only. */
export function addLocalProjectDecision(workspace: LocalWorkspaceDocument, projectId: string, input: z.input<typeof projectDecisionInputSchema>, actorName = "") {
  const project = workspace.projects.find((item) => item.id === projectId);
  if (!project) throw new Error("Projektet hittades inte i den lokala arbetsytan.");
  if (project.archivedAt) throw new Error("Återställ projektet innan du lägger till ett beslut.");
  const decision = { ...projectDecisionInputSchema.parse(input), id: crypto.randomUUID(), actorName, createdAt: new Date().toISOString() };
  return { ...workspace, projects: workspace.projects.map((item) => item.id === projectId ? { ...item, decisions: [...item.decisions, decision] } : item) };
}

function validateLocalPlannedActivityReferences(workspace: LocalWorkspaceDocument, activity: z.infer<typeof plannedActivityInputSchema>) {
  const project = activity.projectId ? workspace.projects.find((item) => item.id === activity.projectId) : undefined;
  if (activity.projectId && !project) throw new Error("Projektet hittades inte i den lokala arbetsytan.");
  if (project?.archivedAt) throw new Error("Återställ projektet innan du planerar arbete i det.");
  if (project?.closedAt && !["COMPLETED", "CANCELED"].includes(activity.status)) throw new Error("Projektet är avslutat. Återöppna projektet innan du planerar arbete i det.");
  const workflowTask = activity.workflowTaskId ? workspace.workflowTasks.find((item) => item.id === activity.workflowTaskId) : undefined;
  if (activity.workflowTaskId && !workflowTask) throw new Error("Uppgiften hittades inte i den lokala arbetsytan.");
  const control = activity.controlId ? workspace.controls.find((item) => item.id === activity.controlId && !item.deletedAt) : undefined;
  if (activity.controlId && !control) throw new Error("Kontrollen hittades inte i den lokala arbetsytan.");
  const taskProjectId = workflowTask?.projectId ?? control?.projectId ?? null;
  if (activity.projectId && taskProjectId && activity.projectId !== taskProjectId)
    throw new Error("Den valda uppgiften tillhör ett annat projekt.");
  // Same frame rules as Cloud; the Local file owner is the local administrator and may make logged exceptions.
  const previous = activity.id ? workspace.plannedActivities.find((item) => item.id === activity.id) : undefined;
  const active = !["COMPLETED", "CANCELED"].includes(activity.status);
  const changed = !previous || previous.startsAt !== activity.startsAt || previous.endsAt !== activity.endsAt || previous.projectId !== activity.projectId
    || previous.workflowTaskId !== activity.workflowTaskId || previous.controlId !== activity.controlId;
  if (active && changed && (workflowTask?.status === "COMPLETED" || control?.status === "COMPLETED"))
    throw new Error("Uppgiften är slutförd. Återöppna den innan du planerar mer arbete på den.");
  const frameProject = project ?? workspace.projects.find((item) => item.id === taskProjectId);
  const frameError = active && changed ? planningFrameError(activity, frameProject) : null;
  if (frameError && !activity.frameExceptionReason) throw new Error(`${frameError} Ange en motivering för att göra ett undantag.`);
  return frameError && frameProject ? { projectId: frameProject.id, reason: activity.frameExceptionReason } : null;
}

function localPlannedActivitySnapshot(activity: LocalPlannedActivity) {
  return {
    title: activity.title,
    description: activity.description,
    kind: activity.kind,
    status: activity.status,
    startsAt: activity.startsAt,
    endsAt: activity.endsAt,
    projectId: activity.projectId,
    workflowTaskId: activity.workflowTaskId,
      controlId: activity.controlId,
      assignedToUserId: activity.assignedToUserId,
      assignedToUserIds: activity.assignedToUserIds,
      assignments: activity.assignments,
      assignedToName: activity.assignedToName,
    version: activity.version,
    deletedAt: activity.deletedAt,
  };
}

export function saveLocalPlannedActivity(
  workspace: LocalWorkspaceDocument,
  input: unknown,
  actorName = "",
) {
  const parsed = plannedActivityInputSchema.parse(input);
  const data = { ...parsed, assignments: plannedActivityAssignments(parsed), assignedToUserIds: plannedActivityAssignments(parsed).map((assignment) => assignment.userId) };
  const exception = validateLocalPlannedActivityReferences(workspace, data);
  const current = data.id ? workspace.plannedActivities.find((item) => item.id === data.id) : undefined;
  if (data.id && !current) throw new Error("Den planerade aktiviteten hittades inte i den lokala arbetsytan.");
  if (current?.deletedAt) throw new Error("Den planerade aktiviteten är borttagen och kan inte ändras.");
  if (current && data.version !== current.version) throw new Error("Planeringen har ändrats. Öppna arbetsytan igen.");
  const now = new Date().toISOString();
  const kind = current ? "UPDATED" : "CREATED";
  const activity: LocalPlannedActivity = {
    ...data,
    id: current?.id ?? crypto.randomUUID(),
    version: (current?.version ?? 0) + 1,
    deletedAt: null,
    createdAt: current?.createdAt ?? now,
    updatedAt: now,
    cloudOrigin: current?.cloudOrigin,
    events: current?.events ?? [],
  };
  activity.events = [...activity.events, {
    id: crypto.randomUUID(),
    kind,
    summary: `${plannedActivitySummary(kind, activity.title)}${exception ? ` (undantag från projektets tidsram: ${exception.reason})` : ""}`,
    snapshot: localPlannedActivitySnapshot(activity),
    actorName,
    createdAt: now,
  }];
  const next = { ...workspace, plannedActivities: current ? workspace.plannedActivities.map((item) => item.id === activity.id ? activity : item) : [...workspace.plannedActivities, activity] };
  return {
    workspace: exception ? appendLocalProjectEvent(next, exception.projectId, "PLANNING_EXCEPTION", `Planeringen ${activity.title} fick undantag från projektets tidsram: ${exception.reason}`, null, actorName) : next,
    activity,
  };
}

export function removeLocalPlannedActivity(
  workspace: LocalWorkspaceDocument,
  id: string,
  version: number,
  actorName = "",
) {
  const current = workspace.plannedActivities.find((item) => item.id === id);
  if (!current || current.deletedAt) throw new Error("Den planerade aktiviteten hittades inte i den lokala arbetsytan.");
  if (version !== current.version) throw new Error("Planeringen har ändrats. Öppna arbetsytan igen.");
  const now = new Date().toISOString();
  const activity: LocalPlannedActivity = { ...current, version: current.version + 1, deletedAt: now, updatedAt: now };
  activity.events = [...activity.events, {
    id: crypto.randomUUID(),
    kind: "DELETED",
    summary: plannedActivitySummary("DELETED", activity.title),
    snapshot: localPlannedActivitySnapshot(activity),
    actorName,
    createdAt: now,
  }];
  return { workspace: { ...workspace, plannedActivities: workspace.plannedActivities.map((item) => item.id === id ? activity : item) }, activity };
}

export function saveLocalWorkSchedule(
  workspace: LocalWorkspaceDocument,
  input: { scope: "ORGANIZATION" | "MEMBER"; minutes: number | null },
  actorName = "",
) {
  const minutes = weeklyWorkMinutesOverrideSchema.parse(input.minutes);
  if (input.scope === "ORGANIZATION" && minutes === null) throw new Error("Organisationens veckoarbetstid måste anges.");
  const previousMinutes = input.scope === "ORGANIZATION" ? workspace.organization.weeklyWorkMinutes : workspace.localIdentity.weeklyWorkMinutes;
  if (previousMinutes === minutes) return workspace;
  const createdAt = new Date().toISOString();
  return {
    ...workspace,
    updatedAt: createdAt,
    organization: input.scope === "ORGANIZATION" ? { ...workspace.organization, weeklyWorkMinutes: minutes! } : workspace.organization,
    localIdentity: input.scope === "MEMBER" ? { ...workspace.localIdentity, weeklyWorkMinutes: minutes } : workspace.localIdentity,
    workScheduleEvents: [{ id: crypto.randomUUID(), scope: input.scope, previousMinutes, nextMinutes: minutes, actorName, createdAt }, ...workspace.workScheduleEvents],
  };
}

export function saveLocalWorkflowTaskRecord(workspace: LocalWorkspaceDocument, input: unknown) {
  const parsed = workflowTaskInputSchema.parse(input);
  const current = parsed.id ? workspace.workflowTasks.find((item) => item.id === parsed.id) : undefined;
  if (parsed.id && !current) throw new Error("Uppgiften hittades inte i den lokala arbetsytan.");
  if (current && current.version !== parsed.version) throw new Error("Uppgiften har ändrats. Öppna arbetsytan igen.");
  if (current?.status === "COMPLETED") throw new Error("Återöppna uppgiften innan du ändrar den.");
  if (current && current.kind !== parsed.kind) throw new Error("Uppgiftstypen kan inte ändras.");
  if (current && current.projectId !== parsed.projectId) throw new Error("Byt projekt via projektets Koppla befintlig uppgift, så att bytet hamnar i historiken.");
  if (parsed.projectId && !workspace.projects.some((item) => item.id === parsed.projectId)) throw new Error("Projektet hittades inte i den lokala arbetsytan.");
  if (parsed.projectId && workspace.projects.find((item) => item.id === parsed.projectId)?.archivedAt) throw new Error("Återställ projektet innan du sparar en uppgift i det.");
  if (parsed.projectId && workspace.projects.find((item) => item.id === parsed.projectId)?.closedAt) throw new Error("Projektet är avslutat. Återöppna projektet innan du lägger till eller ändrar uppgifter i det.");
  // Same frame rules as Cloud: the project's customer, and a new or changed "Klart senast" within the frame.
  const frameProject = parsed.projectId ? workspace.projects.find((item) => item.id === parsed.projectId) : undefined;
  if (frameProject?.customerId && parsed.customerId !== frameProject.customerId) throw new Error("En uppgift i projektet har projektets kund.");
  const dueError = frameProject && (!current || current.dueDate !== parsed.dueDate || current.projectId !== parsed.projectId) ? taskDueDateError(parsed.dueDate, frameProject) : null;
  if (dueError) throw new Error(dueError);
  if (parsed.customerId && !workspace.customers.some((item) => item.id === parsed.customerId && !item.deletedAt)) throw new Error("Kunden hittades inte i den lokala arbetsytan.");
  assertLocalFacilityLink(workspace, { facilityId: parsed.facilityId, customerId: parsed.customerId, previousFacilityId: current?.facilityId });
  if (parsed.status === "COMPLETED") {
    const completion = workflowTaskCompletion(parsed);
    if (!completion.ready) throw new Error(completion.issues.map((issue) => issue.message).join(" "));
  }
  const now = new Date().toISOString();
  parsed.data = stampWorkflowTaskApproval(parsed.data, now);
  const status = parsed.status === "PLANNED" && workflowTaskHasDocumentation(parsed) ? "IN_PROGRESS" : parsed.status;
  const progress = workflowTaskProgress({ ...parsed, status });
  const version = (current?.version ?? 0) + 1;
  const completedAt = status === "COMPLETED" ? now : null;
  const revision = { id: crypto.randomUUID(), version, createdAt: now, snapshot: { title: parsed.title, description: parsed.description, status, progress, data: parsed.data, completedAt } };
  const task: LocalWorkflowTask = { id: current?.id ?? crypto.randomUUID(), version, kind: parsed.kind, title: parsed.title, description: parsed.description, status, progress, projectId: parsed.projectId, customerId: parsed.customerId, facilityId: parsed.facilityId, siteId: parsed.siteId, departmentId: parsed.departmentId, assignedToUserId: parsed.assignedToUserId, assignedToName: parsed.assignedToName, dueDate: parsed.dueDate, data: parsed.data, startedAt: current?.startedAt ?? (status === "IN_PROGRESS" ? now : null), completedAt, createdAt: current?.createdAt ?? now, updatedAt: now, timeEntries: current?.timeEntries ?? [], revisions: [...(current?.revisions ?? []), revision], cloudOrigin: current?.cloudOrigin };
  if (current?.completionHistory) task.completionHistory = current.completionHistory;
  let timeEntryEvents = workspace.timeEntryEvents;
  if (status === "COMPLETED") ({ timeEntries: task.timeEntries, timeEntryEvents } = closeLocalRunningEntries(workspace, task, now));
  // Same as Cloud: completing a task stops its running timer, and a long entry that just stopped gets the warning.
  const stopped: StoppedTimer[] = task.timeEntries.filter((entry) => entry.endedAt && current?.timeEntries.some((before) => before.id === entry.id && !before.endedAt))
    .map((entry) => ({ entryId: entry.id, taskId: task.id, taskTitle: task.title, startedAt: entry.startedAt, endedAt: entry.endedAt!, durationSec: entry.durationSec }));
  return { workspace: { ...workspace, timeEntryEvents, workflowTasks: current ? workspace.workflowTasks.map((item) => item.id === task.id ? task : item) : [...workspace.workflowTasks, task] }, task, stopped };
}

// Stopping the timer (pause or completion) finishes an entry; it enters the append-only time history then.
function closeLocalRunningEntries(workspace: LocalWorkspaceDocument, task: LocalWorkflowTask, now: string) {
  const events: TimeEntryEvent[] = [];
  const timeEntries = task.timeEntries.flatMap((entry) => {
    if (entry.endedAt) return [entry];
    const closed = { ...entry, endedAt: now, durationSec: Math.max(0, Math.floor((Date.parse(now) - Date.parse(entry.startedAt)) / 1000)), updatedAt: now };
    if (closed.durationSec < MIN_TIME_ENTRY_SECONDS) return [];
    events.push(localTimeEvent({ entryId: entry.id, userId: entry.userId, action: "CREATED", previous: null, next: localTimeSnapshot(closed, task), reason: "", actorUserId: entry.userId, actorName: workspace.localIdentity.name }, now));
    return [closed];
  });
  return { timeEntries, timeEntryEvents: [...events, ...workspace.timeEntryEvents] };
}

/** Same per-person rule as Cloud: pause closes only the caller's entry, and starting pauses the caller's other timers. */
export function updateLocalWorkflowTimer(workspace: LocalWorkspaceDocument, taskId: string, command: "START" | "PAUSE", userId: string) {
  // The id may also be a control (Daniel 2026-09-27: every task editor can start time); same per-person rules.
  const control = workspace.controls.find((item) => item.id === taskId && !item.deletedAt);
  const current = workspace.workflowTasks.find((item) => item.id === taskId);
  if (!current && !control) throw new Error("Uppgiften hittades inte i den lokala arbetsytan.");
  if ((current ?? control)!.status === "COMPLETED") throw new Error("En slutförd uppgift kan inte tidrapporteras.");
  const iso = new Date().toISOString();
  const stopped: StoppedTimer[] = [];
  let timeEntryEvents = workspace.timeEntryEvents;
  // Closes the caller's running entries on one task or control; other people's entries keep running.
  const closeEntries = (owner: { id: string; title: string; timeEntries: LocalWorkflowTask["timeEntries"] }) => owner.timeEntries.flatMap((entry) => {
    if (entry.endedAt || entry.userId !== userId) return [entry];
    const closed = { ...entry, endedAt: iso, durationSec: Math.max(0, Math.floor((Date.parse(iso) - Date.parse(entry.startedAt)) / 1000)), updatedAt: iso };
    if (closed.durationSec < MIN_TIME_ENTRY_SECONDS) return [];
    timeEntryEvents = [localTimeEvent({ entryId: entry.id, userId: entry.userId, action: "CREATED", previous: null, next: localTimeSnapshot(closed, owner), reason: "", actorUserId: entry.userId, actorName: workspace.localIdentity.name }, iso), ...timeEntryEvents];
    stopped.push({ entryId: entry.id, taskId: owner.id, taskTitle: owner.title, startedAt: entry.startedAt, endedAt: iso, durationSec: closed.durationSec });
    return [closed];
  });
  const closeOwn = (task: LocalWorkflowTask) => {
    const timeEntries = closeEntries(task);
    return { ...task, timeEntries, status: task.status === "IN_PROGRESS" && !timeEntries.some((entry) => !entry.endedAt) ? "PAUSED" as const : task.status, updatedAt: iso };
  };
  const runsMine = (entries: LocalWorkflowTask["timeEntries"]) => entries.some((entry) => !entry.endedAt && entry.userId === userId);
  const newEntry = () => ({ id: crypto.randomUUID(), userId, startedAt: iso, endedAt: null, durationSec: 0, note: "", createdAt: iso, updatedAt: iso });
  const tasks = workspace.workflowTasks.map((item) => {
    if (item.id === taskId) {
      if (command === "PAUSE") return closeOwn({ ...item, status: "IN_PROGRESS" });
      return { ...item, status: "IN_PROGRESS" as const, startedAt: item.startedAt ?? iso, updatedAt: iso, timeEntries: runsMine(item.timeEntries) ? item.timeEntries : [...item.timeEntries, newEntry()] };
    }
    return command === "START" && runsMine(item.timeEntries) ? closeOwn(item) : item;
  });
  const controls = workspace.controls.map((item) => {
    const title = item.title || "Kontroll";
    if (item.id === taskId) {
      if (command === "PAUSE") return { ...item, timeEntries: closeEntries({ id: item.id, title, timeEntries: item.timeEntries }) };
      return runsMine(item.timeEntries) ? item : { ...item, timeEntries: [...item.timeEntries, newEntry()] };
    }
    return command === "START" && runsMine(item.timeEntries) ? { ...item, timeEntries: closeEntries({ id: item.id, title, timeEntries: item.timeEntries }) } : item;
  });
  const task = current ? { ...tasks.find((item) => item.id === taskId)!, progress: workflowTaskProgress(current) } : null;
  return { workspace: { ...workspace, timeEntryEvents, controls, workflowTasks: task ? tasks.map((item) => item.id === task.id ? task : item) : tasks }, task, stopped };
}

/** What a Local time entry is registered on: a work order/risk assessment, or (decision 13) a control, manual time only. */
type LocalTimeOwner = { kind: "task" | "control"; id: string; title: string; status: string; projectId: string | null; timeEntries: LocalWorkflowTask["timeEntries"] };
const localTimeOwners = (workspace: LocalWorkspaceDocument): LocalTimeOwner[] => [
  ...workspace.workflowTasks.map((task) => ({ kind: "task" as const, id: task.id, title: task.title, status: task.status, projectId: task.projectId, timeEntries: task.timeEntries })),
  ...workspace.controls.filter((control) => !control.deletedAt).map((control) => ({ kind: "control" as const, id: control.id, title: control.title, status: control.status, projectId: control.projectId, timeEntries: control.timeEntries })),
];
const localTaskState = (workspace: LocalWorkspaceDocument, owner: Pick<LocalTimeOwner, "status" | "projectId">) => ({ status: owner.status, archived: Boolean(owner.projectId && workspace.projects.find((project) => project.id === owner.projectId)?.archivedAt) });
const localTimeSnapshot = (entry: { startedAt: string; endedAt: string | null; durationSec: number; note: string }, owner: Pick<LocalTimeOwner, "id" | "title">): TimeEntrySnapshot => ({ taskId: owner.id, taskTitle: owner.title, startedAt: entry.startedAt, endedAt: entry.endedAt, durationSec: entry.durationSec, note: entry.note });
const localTimeEvent = (event: Omit<TimeEntryEvent, "id" | "createdAt">, createdAt: string): TimeEntryEvent => ({ ...event, id: crypto.randomUUID(), createdAt });

// The Local file owner is the local administrator: the same correction rules as Cloud apply to their own entries.
// Changing the task moves the entry between tasks and controls; its id and history stay.
export function saveLocalWorkflowTimeEntry(
  workspace: LocalWorkspaceDocument,
  input: { id?: string; taskId: string; startedAt: string; endedAt: string; note: string },
  userId: string,
  reason = "",
  actorName = "",
) {
  const owners = localTimeOwners(workspace);
  const target = owners.find((owner) => owner.id === input.taskId);
  if (!target) throw new Error("Uppgiften hittades inte i den lokala arbetsytan.");
  const startedAt = new Date(input.startedAt);
  const endedAt = new Date(input.endedAt);
  if (!Number.isFinite(startedAt.getTime()) || !Number.isFinite(endedAt.getTime()) || endedAt <= startedAt)
    throw new Error("Sluttiden måste vara efter starttiden.");
  const durationSec = Math.floor((endedAt.getTime() - startedAt.getTime()) / 1000);
  if (durationSec > 24 * 60 * 60) throw new Error("En enskild tidpost får vara högst 24 timmar.");
  const existing = input.id
    ? owners.flatMap((owner) => owner.timeEntries.map((entry) => ({ owner, entry }))).find(({ entry }) => entry.id === input.id && entry.userId === userId)
    : undefined;
  if (input.id && !existing) throw new Error("Tidposten hittades inte i den lokala arbetsytan.");
  const normalizedReason = assertTimeCorrection({ actorIsAdmin: true, actorOwnsEntry: true, source: existing ? localTaskState(workspace, existing.owner) : undefined, target: localTaskState(workspace, target) }, reason);
  const now = new Date().toISOString();
  const entry = { ...existing?.entry, id: existing?.entry.id ?? crypto.randomUUID(), userId, startedAt: startedAt.toISOString(), endedAt: endedAt.toISOString(), durationSec, note: input.note.trim().slice(0, 1000), createdAt: existing?.entry.createdAt ?? now, updatedAt: now };
  const place = <T extends { id: string; timeEntries: LocalWorkflowTask["timeEntries"] }>(item: T, kind: LocalTimeOwner["kind"]): T => {
    const without = item.timeEntries.filter((other) => other.id !== entry.id);
    return target.kind === kind && item.id === target.id ? { ...item, timeEntries: [...without, entry], updatedAt: now } : without.length === item.timeEntries.length ? item : { ...item, timeEntries: without };
  };
  const event = localTimeEvent({ entryId: entry.id, userId, action: existing ? "UPDATED" : "CREATED", previous: existing ? localTimeSnapshot(existing.entry, existing.owner) : null, next: localTimeSnapshot(entry, target), reason: normalizedReason, actorUserId: userId, actorName }, now);
  return { ...workspace, workflowTasks: workspace.workflowTasks.map((task) => place(task, "task")), controls: workspace.controls.map((control) => place(control, "control")), timeEntryEvents: [event, ...workspace.timeEntryEvents] };
}

export function removeLocalWorkflowTimeEntry(workspace: LocalWorkspaceDocument, id: string, userId: string, reason = "", actorName = "") {
  const found = localTimeOwners(workspace).flatMap((owner) => owner.timeEntries.map((entry) => ({ owner, entry }))).find(({ entry }) => entry.id === id && entry.userId === userId);
  if (!found) throw new Error("Tidposten hittades inte i den lokala arbetsytan.");
  const normalizedReason = assertTimeCorrection({ actorIsAdmin: true, actorOwnsEntry: true, source: localTaskState(workspace, found.owner) }, reason);
  const now = new Date().toISOString();
  const event = localTimeEvent({ entryId: id, userId, action: "DELETED", previous: localTimeSnapshot(found.entry, found.owner), next: null, reason: normalizedReason, actorUserId: userId, actorName }, now);
  const without = <T extends { timeEntries: LocalWorkflowTask["timeEntries"] }>(item: T): T => item.timeEntries.some((entry) => entry.id === id) ? { ...item, timeEntries: item.timeEntries.filter((entry) => entry.id !== id) } : item;
  return { ...workspace, workflowTasks: workspace.workflowTasks.map(without), controls: workspace.controls.map(without), timeEntryEvents: [event, ...workspace.timeEntryEvents] };
}

export function reopenLocalWorkflowTask(workspace: LocalWorkspaceDocument, taskId: string) {
  const current = workspace.workflowTasks.find((task) => task.id === taskId);
  if (!current) throw new Error("Uppgiften hittades inte i den lokala arbetsytan.");
  if (current.status !== "COMPLETED") return workspace;
  if (current.projectId && workspace.projects.find((project) => project.id === current.projectId)?.archivedAt) throw new Error("Återställ projektet innan du återöppnar uppgiften.");
  if (current.projectId && workspace.projects.find((project) => project.id === current.projectId)?.closedAt) throw new Error("Projektet är avslutat. Återöppna projektet innan du återöppnar uppgiften.");
  const now = new Date().toISOString();
  const data = resetWorkflowTaskApproval(current.data);
  const progress = workflowTaskProgress({ ...current, data, status: "NEEDS_ACTION" });
  const reopenedVersion = current.version + 1;
  const reopened: LocalWorkflowTask = { ...current, data, status: "NEEDS_ACTION", progress, completedAt: null, version: reopenedVersion, updatedAt: now, revisions: [...current.revisions, { id: crypto.randomUUID(), version: reopenedVersion, createdAt: now, snapshot: { title: current.title, description: current.description, status: "NEEDS_ACTION", progress, data, completedAt: null } }] };
  reopened.completionHistory = [...(current.completionHistory ?? []), { version: current.version, title: current.title, description: current.description, data: current.data, completedAt: current.completedAt, reopenedAt: now }];
  const updated = { ...workspace, workflowTasks: workspace.workflowTasks.map((task) => task.id === taskId ? reopened : task) };
  return current.projectId ? appendLocalProjectEvent(updated, current.projectId, "TASK_REOPENED", `Uppgiften ${current.title} återöppnades`, taskId) : updated;
}

export function changeLocalRecordState(
  workspace: LocalWorkspaceDocument,
  kind: LocalRecordKind,
  action: LocalRecordAction,
  ids: string[],
) {
  const selected = new Set(ids);
  const now = new Date().toISOString();
  if (kind === "controls") {
    const controls =
      action === "purge"
        ? workspace.controls.filter((item) => !selected.has(item.id))
        : workspace.controls.map((item) =>
            selected.has(item.id)
              ? { ...item, deletedAt: action === "delete" ? now : null }
              : item,
          );
    return {
      ...workspace,
      controls,
      attachments:
        action === "purge"
          ? workspace.attachments.filter(
              (item) => !item.controlId || !selected.has(item.controlId),
            )
          : workspace.attachments,
    };
  }
  const customers =
    action === "purge"
      ? workspace.customers.filter((item) => !selected.has(item.id))
      : workspace.customers.map((item) =>
          selected.has(item.id)
            ? { ...item, deletedAt: action === "delete" ? now : null }
            : item,
        );
  // Purging a customer removes its facilities and clears every link to the customer and its facilities, also on
  // work orders and risk assessments (previously left pointing at the missing customer).
  const purgedFacilities = new Set(action === "purge" ? workspace.customerFacilities.filter((facility) => selected.has(facility.customerId)).map((facility) => facility.id) : []);
  const unlink = <T extends { customerId: string | null; facilityId: string | null }>(item: T): T => action === "purge" && ((item.customerId && selected.has(item.customerId)) || (item.facilityId && purgedFacilities.has(item.facilityId)))
    ? { ...item, customerId: item.customerId && selected.has(item.customerId) ? null : item.customerId, facilityId: item.facilityId && purgedFacilities.has(item.facilityId) ? null : item.facilityId }
    : item;
  return {
    ...workspace,
    customers,
    customerFacilities: workspace.customerFacilities.filter((facility) => !purgedFacilities.has(facility.id)),
    workflowTasks: workspace.workflowTasks.map(unlink),
    controls:
      action === "purge"
        ? workspace.controls.map(unlink)
        : workspace.controls,
    projects:
      action === "purge"
        ? workspace.projects.map(unlink)
        : workspace.projects,
  };
}

type PermissionCapableHandle = FileSystemDirectoryHandle & {
  queryPermission?: (descriptor: {
    mode: "readwrite";
  }) => Promise<PermissionState>;
  requestPermission?: (descriptor: {
    mode: "readwrite";
  }) => Promise<PermissionState>;
};

declare global {
  interface Window {
    showDirectoryPicker?: (options?: {
      id?: string;
      mode?: "read" | "readwrite";
    }) => Promise<FileSystemDirectoryHandle>;
  }
}

export function createLocalWorkspace(organization: {
  id: string;
  name: string;
}): LocalWorkspaceDocument {
  const now = new Date().toISOString();
  return {
    format: LOCAL_WORKSPACE_FORMAT,
    schemaVersion: LOCAL_WORKSPACE_SCHEMA_VERSION,
    workspaceId: crypto.randomUUID(),
    localIdentity: { id: crypto.randomUUID(), name: organization.name, weeklyWorkMinutes: null },
    cloudBinding: {
      organizationId: organization.id,
      organizationName: organization.name,
    },
    organization: { ...organization, weeklyWorkMinutes: DEFAULT_WEEKLY_WORK_MINUTES },
    createdAt: now,
    updatedAt: now,
    customers: [],
    customerFacilities: [],
    projects: [],
    plannedActivities: [],
    workScheduleEvents: [],
    timeEntryEvents: [],
    workflowTasks: [],
    formLimitProfiles: [],
    formSchedules: [],
    controls: [],
    attachments: [],
  };
}

export function parseLocalWorkspace(
  value: unknown,
  organizationId: string,
): LocalWorkspaceDocument {
  const current = localWorkspaceSchema.safeParse(value);
  let workspace: LocalWorkspaceDocument;
  if (current.success) {
    workspace = current.data;
  } else {
    const v10 = localWorkspaceV10Schema.safeParse(value);
    const v9 = v10.success ? null : localWorkspaceV9Schema.safeParse(value);
    const v8 = v10.success || v9?.success ? null : localWorkspaceV8Schema.safeParse(value);
    const v7 = v10.success || v9?.success || v8?.success ? null : localWorkspaceV7Schema.safeParse(value);
    const v6 = v10.success || v9?.success || v8?.success || v7?.success ? null : localWorkspaceV6Schema.safeParse(value);
    const v5 = v10.success || v9?.success || v8?.success || v7?.success || v6?.success ? null : localWorkspaceV5Schema.safeParse(value);
    const v4 = v10.success || v9?.success || v8?.success || v7?.success || v6?.success || v5?.success ? null : localWorkspaceV4Schema.safeParse(value);
    const v3 = v10.success || v9?.success || v8?.success || v7?.success || v6?.success || v5?.success || v4?.success ? null : localWorkspaceV3Schema.safeParse(value);
    const v2 = v10.success || v9?.success || v8?.success || v7?.success || v6?.success || v5?.success || v4?.success || v3?.success ? null : localWorkspaceV2Schema.safeParse(value);
    const legacy = v10.success ? v10.data : v9?.success ? v9.data : v8?.success ? v8.data : v7?.success ? v7.data : v6?.success ? v6.data : v5?.success ? v5.data : v4?.success ? v4.data : v3?.success ? v3.data : v2?.success ? v2.data : localWorkspaceV1Schema.parse(value);
    workspace = localWorkspaceSchema.parse({
      ...legacy,
      schemaVersion: LOCAL_WORKSPACE_SCHEMA_VERSION,
      localIdentity: "localIdentity" in legacy
        ? legacy.localIdentity
        : { id: legacy.workspaceId, name: legacy.organization.name },
      cloudBinding: "cloudBinding" in legacy
        ? legacy.cloudBinding
        : {
            organizationId: legacy.organization.id,
            organizationName: legacy.organization.name,
          },
    });
  }
  if (workspace.cloudBinding.organizationId !== organizationId)
    throw new Error(
      "Mappen tillhör ett annat Workflow-företag. Välj rätt mapp för den aktiva arbetsytan.",
    );
  workspace = {
    ...workspace,
    workflowTasks: workspace.workflowTasks.map((task) => task.revisions.length || !task.completionHistory?.length
      ? task
      : {
          ...task,
          revisions: task.completionHistory.map((entry) => ({
            id: crypto.randomUUID(),
            version: entry.version,
            createdAt: entry.reopenedAt,
            snapshot: { title: entry.title, description: entry.description, status: "COMPLETED" as const, progress: 100, data: entry.data, completedAt: entry.completedAt },
          })),
        }),
  };
  return workspace;
}

async function writeFile(
  directory: FileSystemDirectoryHandle,
  filename: string,
  contents: string,
) {
  const file = await directory.getFileHandle(filename, { create: true });
  const writable = await file.createWritable();
  await writable.write(contents);
  await writable.close();
}

export async function loadOrCreateLocalWorkspace(
  directory: FileSystemDirectoryHandle,
  organization: { id: string; name: string },
) {
  const fileHandle = await directory.getFileHandle(LOCAL_WORKSPACE_FILENAME, {
    create: true,
  });
  const file = await fileHandle.getFile();
  if (file.size === 0) {
    const workspace = createLocalWorkspace(organization);
    await writeFile(
      directory,
      LOCAL_WORKSPACE_FILENAME,
      JSON.stringify(workspace, null, 2),
    );
    return workspace;
  }
  if (file.size > 50_000_000)
    throw new Error(
      "Den lokala arbetsytan är större än 50 MB och kan inte öppnas.",
    );
  try {
    return parseLocalWorkspace(JSON.parse(await file.text()), organization.id);
  } catch (error) {
    if (error instanceof Error && error.message.includes("annat Workflow-företag"))
      throw error;
    throw new Error(
      `Filen ${LOCAL_WORKSPACE_FILENAME} kunde inte läsas. Originalfilen har inte ändrats.`,
    );
  }
}

export async function saveLocalWorkspace(
  directory: FileSystemDirectoryHandle,
  workspace: LocalWorkspaceDocument,
) {
  const current = await directory.getFileHandle(LOCAL_WORKSPACE_FILENAME, {
    create: true,
  });
  const currentFile = await current.getFile();
  if (currentFile.size) {
    let stored: LocalWorkspaceDocument;
    try {
      stored = parseLocalWorkspace(
        JSON.parse(await currentFile.text()),
        workspace.organization.id,
      );
    } catch {
      throw new Error(
        `Filen ${LOCAL_WORKSPACE_FILENAME} har ändrats eller skadats och skrivs inte över.`,
      );
    }
    if (
      stored.workspaceId !== workspace.workspaceId ||
      stored.updatedAt !== workspace.updatedAt
    )
      throw new Error(
        "Den lokala arbetsytan har ändrats i ett annat fönster. Öppna mappen igen innan du sparar.",
      );
    await writeFile(
      directory,
      LOCAL_WORKSPACE_BACKUP_FILENAME,
      JSON.stringify(stored, null, 2),
    );
  }
  const next = prepareLocalWorkspaceSave(workspace);
  await writeFile(
    directory,
    LOCAL_WORKSPACE_FILENAME,
    JSON.stringify(next, null, 2),
  );
  return next;
}

export function prepareLocalWorkspaceSave(
  workspace: LocalWorkspaceDocument,
): LocalWorkspaceDocument {
  return parseLocalWorkspace(
    { ...workspace, updatedAt: new Date().toISOString() },
    workspace.organization.id,
  );
}

export async function ensureLocalWritePermission(
  directory: FileSystemDirectoryHandle,
  request: boolean,
) {
  const handle = directory as PermissionCapableHandle;
  if (!handle.queryPermission) return true;
  if ((await handle.queryPermission({ mode: "readwrite" })) === "granted")
    return true;
  return Boolean(
    request &&
    handle.requestPermission &&
    (await handle.requestPermission({ mode: "readwrite" })) === "granted",
  );
}

function openHandleDatabase() {
  return new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open("kfid-local-workspaces", 2);
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains("directories"))
        request.result.createObjectStore("directories");
      if (!request.result.objectStoreNames.contains("recoveries"))
        request.result.createObjectStore("recoveries", {
          keyPath: "organizationId",
        });
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

export async function rememberLocalDirectory(
  scope: string,
  directory: FileSystemDirectoryHandle,
) {
  const db = await openHandleDatabase();
  await new Promise<void>((resolve, reject) => {
    const transaction = db.transaction("directories", "readwrite");
    transaction.objectStore("directories").put(directory, scope);
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error);
  });
  db.close();
}

export async function recalledLocalDirectory(scope: string) {
  const db = await openHandleDatabase();
  const directory = await new Promise<FileSystemDirectoryHandle | undefined>(
    (resolve, reject) => {
      const request = db
        .transaction("directories", "readonly")
        .objectStore("directories")
        .get(scope);
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    },
  );
  db.close();
  return directory;
}

export function downloadLocalWorkspaceCopy(workspace: LocalWorkspaceDocument) {
  const url = URL.createObjectURL(
    new Blob([JSON.stringify(workspace, null, 2)], {
      type: "application/json",
    }),
  );
  const link = document.createElement("a");
  link.href = url;
  link.download = `KFID-lokal-sakerhetskopia-${new Date().toISOString().slice(0, 10)}.json`;
  link.click();
  URL.revokeObjectURL(url);
}

/**
 * A limit profile in the file (2026-09-28): the same rule as Cloud – one set of values per form family, facility and
 * object – with a version so two tabs never overwrite each other silently. The file's owner is the local administrator.
 */
export function saveLocalFormLimitProfile(workspace: LocalWorkspaceDocument, input: FormLimitProfileInput, family: string, actorName = "") {
  const profile = formLimitProfileInputSchema.parse(input);
  if (!workspace.customerFacilities.some((facility) => facility.id === profile.facilityId)) throw new Error("Anläggningen hittades inte i den lokala arbetsytan.");
  const now = new Date().toISOString();
  const current = workspace.formLimitProfiles.find((item) => item.templateId === family && item.facilityId === profile.facilityId && item.objectName === profile.objectName);
  if (current && profile.version !== undefined && current.version !== profile.version) throw new Error("Gränsvärdena har ändrats i en annan flik. Läs in dem på nytt.");
  const next = { id: current?.id ?? crypto.randomUUID(), templateId: family, facilityId: profile.facilityId, objectName: profile.objectName, values: profile.values, version: (current?.version ?? 0) + 1, updatedAt: now, updatedByName: actorName };
  return { ...workspace, formLimitProfiles: current ? workspace.formLimitProfiles.map((item) => item.id === current.id ? next : item) : [...workspace.formLimitProfiles, next] };
}

/** A round schedule in the file: the same validation as Cloud; the facility decides the customer. */
export function saveLocalFormSchedule(workspace: LocalWorkspaceDocument, input: z.input<typeof formScheduleInputSchema> | FormScheduleInput, templateName: string) {
  const schedule = formScheduleInputSchema.parse(input);
  const facility = schedule.facilityId ? workspace.customerFacilities.find((item) => item.id === schedule.facilityId) : undefined;
  if (schedule.facilityId && !facility) throw new Error("Anläggningen hittades inte i den lokala arbetsytan.");
  const customerId = facility?.customerId ?? schedule.customerId;
  if (customerId && !workspace.customers.some((customer) => customer.id === customerId && !customer.deletedAt)) throw new Error("Kunden hittades inte i den lokala arbetsytan.");
  if (schedule.projectId && !workspace.projects.some((project) => project.id === schedule.projectId && !project.archivedAt)) throw new Error("Projektet hittades inte i den lokala arbetsytan.");
  const now = new Date().toISOString();
  const current = schedule.id ? workspace.formSchedules.find((item) => item.id === schedule.id && !item.deletedAt) : undefined;
  if (schedule.id && !current) throw new Error("Ronden hittades inte.");
  if (current && schedule.version !== undefined && current.version !== schedule.version) throw new Error("Ronden har ändrats i en annan flik. Läs in den på nytt.");
  const next = { ...schedule, customerId: customerId ?? null, id: current?.id ?? crypto.randomUUID(), version: (current?.version ?? 0) + 1, templateName, deletedAt: null, createdAt: current?.createdAt ?? now, updatedAt: now };
  return { workspace: { ...workspace, formSchedules: current ? workspace.formSchedules.map((item) => item.id === current.id ? next : item) : [...workspace.formSchedules, next] }, id: next.id };
}

export function removeLocalFormSchedule(workspace: LocalWorkspaceDocument, id: string) {
  if (!workspace.formSchedules.some((item) => item.id === id && !item.deletedAt)) throw new Error("Ronden hittades inte.");
  const now = new Date().toISOString();
  return { ...workspace, formSchedules: workspace.formSchedules.map((item) => item.id === id ? { ...item, deletedAt: now, updatedAt: now, version: item.version + 1 } : item) };
}
