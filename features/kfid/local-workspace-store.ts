import { z } from "zod";
import { customerSchema } from "@/lib/kfid/customer-schema";
import { stampCustomerAndJudgements, workflowTaskCompletion, workflowTaskKinds, workflowTaskStatuses, workflowTaskDataSchema, workflowTaskHasDocumentation, workflowTaskInputSchema, workflowTaskProgress, resetWorkflowTaskApproval, stampWorkflowTaskApproval } from "@/lib/workflow/task-model";
import { plannedActivityAssignments, plannedActivityEventSchema, plannedActivityInputSchema, plannedActivitySummary, timeBudgetMinutesSchema } from "@/lib/workflow/planned-activity";
import { DEFAULT_WEEKLY_WORK_MINUTES, weeklyWorkMinutesOverrideSchema, weeklyWorkMinutesSchema } from "@/lib/workflow/work-schedule";
import { assertTimeCorrection, timeEntryEventSchema, type TimeEntryEvent, type TimeEntrySnapshot } from "@/lib/workflow/time-correction";
import { summarizeProjectStatus } from "@/lib/workflow/project-status";
import { planningFrameError, projectDecisionInputSchema, projectFrameError, taskDueDateError } from "@/lib/workflow/project-frame";
import { projectShift } from "@/lib/workflow/job-planning";
import { TO_BOOK_LIMIT, workToBook } from "@/lib/overview/team-followup";
import { customerFacilityBaseSchema, customerFacilityInputSchema, DUPLICATE_PLACE_MESSAGE, duplicatePlace, facilityLinkError, normalizeFacilityInput, placeInUseMessage, placeParentError, type CustomerFacilityInput } from "@/lib/workflow/customer-facility";
import { addSwedishDays, swedishDayKey } from "@/lib/swedish-time";
import { formLimitProfileInputSchema, limitProfileValueSchema, type FormLimitProfileInput } from "@/lib/workflow/form-limits";
import { mergeCompanyValues, storedCompanyValueSchema, type CompanyValueInput } from "@/lib/workflow/company-values";
import { defaultScheduleReminders, formScheduleInputSchema, formScheduleRemindersSchema, formScheduleRuleSchema, type FormScheduleInput } from "@/lib/workflow/form-schedule";
import { tempPlaceSchema } from "@/lib/workflow/temp-place";
import { MIN_TIME_ENTRY_SECONDS, type StoppedTimer } from "@/lib/workflow/running-timer";
import { withoutStaleWaiting } from "@/lib/workflow/maintenance";
import { savedStatusForTask } from "@/lib/workflow/task-status-rule";
import { taskScheduleError } from "@/lib/workflow/schedule";
import { datesOnProjectLink, normalizeStage, startForNewJob } from "@/lib/workflow/job-planning";
import { cancelTaskError, isTaskCancelled, restoreTaskError, restoredTaskStatus } from "@/lib/workflow/task-cancel";
import { duplicateRiskAssessmentError, inheritFromWorkOrder, isDraftStatus, PROJECT_LINK_WORK_ORDER_ONLY, sharedBasicsChanged, taskNeedsWorkOrder, tasksFollowingWorkOrder, timeOwnerId, WORK_ORDER_REQUIRED, workOrderLinkError, workOrderRequiredError } from "@/lib/workflow/work-order-link";
import { emptySelfInspectionDocument, selfInspectionDocumentSchema } from "@/lib/self-inspection/model";
import { COMMENT_FILE_BODY_MAX, COMMENT_PARENT_TYPES } from "@/lib/comments/model";
import { MAX_CLOUD_WORKSPACE_COMMENTS } from "@/lib/kfid/cloud-reimport";
import { localAssignRefusal } from "@/lib/self-inspection/work";
import { isRiskAssessmentTask, riskCheckOf, riskExceptionRefusal, riskStepExempt, stampRiskStep } from "@/lib/workflow/risk-step";
import { localRiskStepRefusal } from "@/lib/workflow/risk-step-local";
import { upgradeLegacySelfInspectionTemplate } from "@/lib/self-inspection/template-upgrade";
import { staffRegisterInputSchema, staffRegisterOf, type StaffRegister } from "@/lib/workflow/staff-register";
import { customerDisplayName, movedJobPlace, projectCustomerChange, projectCustomerFields } from "@/lib/workflow/project-customer";
import { upgradeLocalWorkOrders } from "./local-work-orders";
import { roundHolderSaveError, roundOfProtocolValues, roundOrderRef, roundPeriodError, roundProtocolOrder, withRoundOrderTempPlace } from "@/lib/workflow/round-work-orders";
import { localOrderRoundSafetyRefusal, localRoundSafetyRefusal, localStampRoundSafety, roundSafetyRiskFrom, roundSafetyWorkGate } from "@/lib/workflow/round-safety";
import type { RoundOrderRef } from "@/lib/workflow/form-schedule";
import { projectTimeState } from "@/lib/workflow/time-owner";
import { taskIsSigned, workOrderRemovalRefusal } from "@/lib/workflow/work-order-link";
import { saveBlob } from "@/lib/download";
import { customerTitle } from "@/lib/kfid/customer-name";

export const LOCAL_WORKSPACE_FILENAME = "kfid-workspace.json";
const LOCAL_WORKSPACE_BACKUP_FILENAME = "kfid-workspace.backup.json";
const LOCAL_WORKSPACE_FORMAT = "KFID_LOCAL_WORKSPACE";
// 12 (2026-10-26, Arbetsordern styr): every task in a work order, time only on work orders and projects (a
// project's own `timeEntries`), round work orders. Older files are upgraded when read (features/kfid/local-work-orders.ts).
// 13 (2026-10-27): a task may be a draft without a work order (linked before the work starts), a work order holds a
// round for a period (`roundScheduleId` without `roundOccurrence`), a time entry remembers the task it was reported from
// (`sourceTaskId`) and a round occurrence keeps its safety check in its data. A version 12 file reads unchanged and is
// written as 13; an older reader refuses a 13 file instead of misreading a draft or a round's work order.
export const LOCAL_WORKSPACE_SCHEMA_VERSION = 13;

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
// `sourceTaskId` (schema 13, 2026-10-27): the task in the work order the time was reported from; additive.
const localWorkflowTimeEntrySchema = z.object({ id: z.string().uuid(), userId: z.string().max(100), startedAt: timestamp, endedAt: timestamp.nullable(), durationSec: z.number().int().nonnegative(), note: z.string().max(1000), createdAt: timestamp, updatedAt: timestamp, sourceTaskId: z.string().uuid().nullable().optional(), cloudOrigin: z.object({ id: z.string().min(1).max(100) }).optional() });
const localProjectHistorySchema = z.object({
  id: z.string().uuid(),
  kind: z.enum(["CREATED", "UPDATED", "BUDGET_UPDATED", "ARCHIVED", "RESTORED", "TASK_LINKED", "TASK_REOPENED", "CLOSED", "REOPENED", "PLANNING_EXCEPTION", "TASK_MOVED", "TASK_SCHEDULED", "SCHEDULE_EXCEPTION"]),
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
  // Personalliggare, steg 0 (additive, 2026-10-08): older files read as "not required".
  staffRegister: z.unknown().optional().transform((value) => staffRegisterOf(value)),
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
  // Projekttid (2026-10-26): time on the project itself, without a work order; older files have none.
  timeEntries: z.array(localWorkflowTimeEntrySchema).default([]),
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
    status: z.enum(workflowTaskStatuses),
    progress: z.number().int().min(0).max(100),
    data: workflowTaskDataSchema,
    completedAt: timestamp.nullable(),
    /** A plain line for the history (Kvitto, 2026-11-04). */
    note: z.string().max(300).optional(),
  }),
});
const localWorkflowTaskSchema = z.object({
  // Tidplan (projektförslaget steg 2, 2026-10-09): Start and Uppskattad tid; additive, so older .hwf files parse unchanged.
  plannedStartDate: z.union([z.literal(""), z.iso.date()]).optional(),
  estimatedMinutes: z.number().int().min(0).max(600_000).nullable().optional(),
  // Etapp (plan 1M, 2026-10-11): an optional label that groups a project's jobs; additive, so older .hwf files parse unchanged.
  stage: z.string().max(60).optional(),
  // Börjar efter (plan 1K, 2026-10-11): the jobs this one starts after, by the file's ids; additive, so older .hwf files
  // parse unchanged. An id that is not a job in the file is dropped on reading (parseLocalWorkspace).
  predecessorIds: z.array(z.string().min(1).max(100)).max(20).optional(),
  // Utgår (2026-10-09): when, why and the status before; additive, so older .hwf files parse unchanged.
  cancellation: z.object({ at: timestamp, by: z.string().max(160).default(""), reason: z.string().max(500), fromStatus: z.string().max(40).nullable().default(null) }).optional(),
  // Driftrond i arbetsordern (2026-10-27): the round a work order holds for its period (Start – Klart senast); 2026-10-26
  // (schema 12) also the day of a work order made per occurrence. Additive, older files have none.
  roundScheduleId: z.string().min(1).max(100).nullable().optional(),
  roundOccurrence: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(),
  completionHistory: z.array(z.object({ version: z.number().int().positive(), title: z.string(), description: z.string(), data: workflowTaskDataSchema, completedAt: timestamp.nullable(), reopenedAt: timestamp })).optional(),
  id: z.string().uuid(), version: z.number().int().positive(), kind: z.enum(workflowTaskKinds), title: z.string().min(1).max(200), description: z.string().max(5000), status: z.enum(workflowTaskStatuses), progress: z.number().int().min(0).max(100), projectId: z.string().uuid().nullable(), customerId: z.string().uuid().nullable(), facilityId: z.string().uuid().nullable().default(null), workOrderId: z.string().uuid().nullable().optional(), assignedToUserId: z.string().nullable(), assignedToName: z.string().max(160), dueDate: z.union([z.literal(""), z.iso.date()]), data: workflowTaskDataSchema, startedAt: timestamp.nullable(), completedAt: timestamp.nullable(), createdAt: timestamp, updatedAt: timestamp, timeEntries: z.array(localWorkflowTimeEntrySchema), revisions: z.array(localWorkflowTaskRevisionSchema).default([]), cloudOrigin: cloudOriginSchema.extend({ attachmentIds: z.array(z.string().min(1).max(100)).optional() }).optional(),
});
const localAttachmentSchema = z.object({
  id: z.string().uuid(),
  taskId: z.string().uuid(),
  filename: z.string().min(1).max(200),
  storageName: z
    .string()
    .regex(/^[0-9a-f-]{36}\.(jpg|png|webp|pdf|txt|doc|docx|xls|xlsx)$/),
  mimeType: z.string().min(1).max(100),
  size: z.number().int().positive().max(10_000_000),
  section: z.enum(["iso", "cont", "volt", "rcd", "vis"]),
  rowId: z.string().max(100).nullable(),
  /** Kvitto (2026-11-04); a file without the field is an ordinary picture. */
  receipt: z.boolean().optional(),
  createdAt: timestamp,
  cloudOrigin: z.object({ id: z.string().min(1).max(100) }).optional(),
});

// Customer facilities (additive, 2026-09-26, decision 11): same fields as Cloud's CustomerFacility.
const localCustomerFacilitySchema = customerFacilityBaseSchema.extend({
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
  values: z.record(z.string().max(40), limitProfileValueSchema).default({}), version: z.number().int().positive().default(1), updatedAt: timestamp, updatedByName: z.string().max(200).default(""),
  // The Cloud profile and version it was exported from (additive, 2026-10-06), so a re-import never overwrites silently.
  cloudOrigin: cloudOriginSchema.optional() });
const localFormScheduleSchema = z.object({ id: z.string().min(1).max(100), version: z.number().int().positive().default(1), title: z.string().min(1).max(200), templateId: z.string().min(1).max(100),
  customerId: z.string().max(100).nullable().default(null), facilityId: z.string().max(100).nullable().default(null), projectId: z.string().max(100).nullable().default(null),
  assignedToUserId: z.string().max(100).nullable().default(null), assignedToName: z.string().max(160).default(""), active: z.boolean().default(true), rule: formScheduleRuleSchema,
  // Round reminders (2026-09-30), additive: kept in the file; the bell and e-mail are Cloud's.
  reminders: formScheduleRemindersSchema.default(defaultScheduleReminders),
  // The round's temporary place (2026-10-08), additive: older files have none; a malformed one is read as none.
  tempPlace: tempPlaceSchema.nullish().catch(null),
  templateName: z.string().max(200).default(""), deletedAt: timestamp.nullable().default(null), createdAt: timestamp, updatedAt: timestamp,
  // The Cloud schedule and version it was exported from (additive, 2026-10-06), so a re-import never overwrites silently.
  cloudOrigin: cloudOriginSchema.optional() });

// Kommentarer (beslut 14, 2026-11-01): the threads of work orders, projects and deviations, under the file's ids. Written by the
// Cloud export and read only by the Cloud import. Local has one user and no thread: it never shows or changes these, it keeps them.
const localCommentSchema = z.object({
  id: z.string().min(1).max(100),
  parentType: z.enum(COMMENT_PARENT_TYPES),
  parentId: z.string().min(1).max(100),
  authorName: z.string().max(320),
  body: z.string().min(1).max(COMMENT_FILE_BODY_MAX),
  inCustomerReport: z.boolean(),
  createdAt: timestamp,
});

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
    // Värden och referenser (2026-10-06): the company's own limit values; additive, so older files open unchanged.
    companyValues: z.array(storedCompanyValueSchema).max(500).default([]),
    formSchedules: z.array(localFormScheduleSchema).default([]),
    // Egenkontrollprogram (2026-10-06): the same document and rules as Cloud's tables; additive, so older files open unchanged.
    selfInspection: selfInspectionDocumentSchema.default(emptySelfInspectionDocument),
    // Artiklar och priser (2026-10-08): written by the Cloud export (format HWF_CATALOGUE, lib/catalogue/transfer.ts) and
    // checked only by the Cloud import. Local mode has no catalogue: it never reads or changes this, it only keeps it.
    catalogue: z.unknown().optional(),
    // Additive and defaulted: older files open unchanged.
    comments: z.array(localCommentSchema).max(MAX_CLOUD_WORKSPACE_COMMENTS).default([]),
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

const localWorkspaceV12Schema = workspaceContentsSchema.extend({
  format: z.literal(LOCAL_WORKSPACE_FORMAT),
  schemaVersion: z.literal(12),
  localIdentity: z.object({ id: z.string().uuid(), name: z.string().min(1), weeklyWorkMinutes: weeklyWorkMinutesOverrideSchema.default(null) }),
  cloudBinding: z.object({ organizationId: z.string().min(1), organizationName: z.string().min(1) }),
  organization: z.object({ id: z.string().min(1), name: z.string().min(1), weeklyWorkMinutes: weeklyWorkMinutesSchema.default(DEFAULT_WEEKLY_WORK_MINUTES) }),
}).passthrough();

const localWorkspaceV11Schema = workspaceContentsSchema.extend({
  format: z.literal(LOCAL_WORKSPACE_FORMAT),
  schemaVersion: z.literal(11),
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
    // The place tree (2026-10-04): a parent exists, has the same customer and the chain never loops.
    for (const facility of workspace.customerFacilities)
      if (facility.parentId && placeParentError(workspace.customerFacilities, { id: facility.id, customerId: facility.customerId, parentId: facility.parentId }))
        context.addIssue({ code: "custom", path: ["customerFacilities"], message: "En plats hänvisar till en överordnad plats som saknas eller hör till en annan kund." });
    for (const item of [...workspace.projects, ...workspace.workflowTasks])
      if (item.facilityId && !facilityIds.has(item.facilityId)) context.addIssue({ code: "custom", path: ["customerFacilities"], message: "En post hänvisar till en anläggning som saknas." });
    const projectIds = new Set(workspace.projects.map((project) => project.id));
    for (const project of workspace.projects) {
      if (project.customerId && !customerIds.has(project.customerId))
        context.addIssue({
          code: "custom",
          path: ["projects"],
          message: "Ett projekt hänvisar till en kund som saknas.",
        });
    }
    const workflowTaskIds = new Set<string>();
    for (const task of workspace.workflowTasks) {
      if (workflowTaskIds.has(task.id)) context.addIssue({ code: "custom", path: ["workflowTasks"], message: "Dubblett i uppgiftsregistret." });
      if (task.projectId && !projectIds.has(task.projectId)) context.addIssue({ code: "custom", path: ["workflowTasks"], message: "En uppgift hänvisar till ett projekt som saknas." });
      if (task.customerId && !customerIds.has(task.customerId)) context.addIssue({ code: "custom", path: ["workflowTasks"], message: "En uppgift hänvisar till en kund som saknas." });
      workflowTaskIds.add(task.id);
    }
    // Arbetsordern styr (2026-10-26/27): a task names a work order unless it is a draft (Planerad or Utgår, never started or
    // completed, as Cloud's CHECK), time is never on a task of its own, and a round's work order has a valid period.
    for (const task of workspace.workflowTasks) {
      if (taskNeedsWorkOrder(task) && !(isDraftStatus(task.status) && !task.startedAt && !task.completedAt)) context.addIssue({ code: "custom", path: ["workflowTasks"], message: "En påbörjad uppgift saknar arbetsorder." });
      if (task.kind !== "WORK_ORDER" && task.timeEntries.length) context.addIssue({ code: "custom", path: ["workflowTasks"], message: "Tid ligger på en uppgift i stället för på dess arbetsorder." });
      if (task.roundScheduleId && (task.kind !== "WORK_ORDER" || (!task.roundOccurrence && roundPeriodError({ from: task.plannedStartDate, to: task.dueDate }))))
        context.addIssue({ code: "custom", path: ["workflowTasks"], message: "En rond hör till en arbetsorder med giltig period." });
    }
    // Hör till arbetsorder (Fas 2): a link names a work order in the same file, never a work order itself or the task.
    for (const task of workspace.workflowTasks) {
      if (!task.workOrderId) continue;
      const order = workspace.workflowTasks.find((item) => item.id === task.workOrderId);
      if (!order || order.kind !== "WORK_ORDER" || task.kind === "WORK_ORDER" || task.id === task.workOrderId)
        context.addIssue({ code: "custom", path: ["workflowTasks"], message: "En uppgift hänvisar till en arbetsorder som saknas eller inte är en arbetsorder." });
    }
    const plannedActivityIds = new Set<string>();
    for (const activity of workspace.plannedActivities) {
      if (plannedActivityIds.has(activity.id)) context.addIssue({ code: "custom", path: ["plannedActivities"], message: "Dubblett i planeringsregistret." });
      if (activity.projectId && !projectIds.has(activity.projectId)) context.addIssue({ code: "custom", path: ["plannedActivities"], message: "En planerad aktivitet hänvisar till ett projekt som saknas." });
      if (activity.workflowTaskId && !workflowTaskIds.has(activity.workflowTaskId)) context.addIssue({ code: "custom", path: ["plannedActivities"], message: "En planerad aktivitet hänvisar till en uppgift som saknas." });
      plannedActivityIds.add(activity.id);
    }
    const attachmentIds = new Set<string>();
    const storageNames = new Set<string>();
    for (const attachment of workspace.attachments) {
      if (
        attachmentIds.has(attachment.id) ||
        storageNames.has(`${attachment.taskId}/${attachment.storageName}`)
      )
        context.addIssue({
          code: "custom",
          path: ["attachments"],
          message: "Dubblett i bilageregistret.",
        });
      if (!workflowTaskIds.has(attachment.taskId)) context.addIssue({ code: "custom", path: ["attachments"], message: "En bilaga hänvisar till en uppgift som saknas." });
      attachmentIds.add(attachment.id);
      storageNames.add(`${attachment.taskId}/${attachment.storageName}`);
    }
  });

export type LocalWorkspaceDocument = z.infer<typeof localWorkspaceSchema>;
export type LocalCustomer = z.infer<typeof localCustomerSchema>;
export type LocalProject = z.infer<typeof localProjectSchema>;
export type LocalWorkflowTask = z.infer<typeof localWorkflowTaskSchema>;
export type LocalAttachment = z.infer<typeof localAttachmentSchema>;
export type LocalPlannedActivity = z.infer<typeof localPlannedActivitySchema>;
/**
 * The record shapes of the file, one per register. The parted Cloud export (S4, 2026-10-23) checks every record of a
 * part with the same schema as a whole file, so a part holds exactly the records a .hwf file would.
 */
export const localWorkspaceRecordSchemas = {
  customers: localCustomerSchema,
  customerFacilities: localCustomerFacilitySchema,
  projects: localProjectSchema,
  workflowTasks: localWorkflowTaskSchema,
  timeEntryEvents: timeEntryEventSchema,
  plannedActivities: localPlannedActivitySchema,
  attachments: localAttachmentSchema,
  comments: localCommentSchema,
} as const;
export type LocalRecordKind = "customers";
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

/**
 * A new customer and, when asked, its first place with the same address ("Skapa en plats med samma adress",
 * 2026-10-10), written to the file together. The place follows the file's ordinary place rules; when it cannot be made
 * the customer is still saved and `firstPlaceError` says why.
 */
export function saveLocalNewCustomer(workspace: LocalWorkspaceDocument, input: unknown, firstPlace: CustomerFacilityInput | null): { workspace: LocalWorkspaceDocument; customer: LocalCustomer; firstPlaceError?: string } {
  const result = saveLocalCustomerRecord(workspace, input);
  if (!firstPlace) return result;
  try {
    return { ...result, workspace: saveLocalCustomerFacility(result.workspace, result.customer.id, { facility: firstPlace }) };
  } catch (issue) {
    return { ...result, firstPlaceError: (issue as Error).message };
  }
}

/** The project form's staff register, validated like Cloud, with the first problem as a plain message. */
function localStaffRegister(value: Partial<StaffRegister>) {
  // Workflow's own register (steg 1) is Cloud only: a Local file never keeps identity numbers or check-ins.
  const parsed = staffRegisterInputSchema.safeParse({ ...value, inWorkflow: false });
  if (!parsed.success) throw new Error(parsed.error.issues[0]?.message ?? "Personalliggarens uppgifter är ogiltiga.");
  return parsed.data;
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
    staffRegister?: Partial<StaffRegister>;
    customerId: string | null;
    facilityId?: string | null;
    taskTypes?: ("WORK_ORDER" | "RISK_ASSESSMENT" | "COMMISSIONING_CONTROL")[];
    workMoments?: ("START_TIME" | "EXECUTION" | "SIGN_REPORT" | "CLOSE_ORDER")[];
    responsibleUserId?: string | null;
    responsibleName?: string;
    timeBudgetMinutes?: number;
    shiftDays?: number;
    customerChange?: "move_jobs";
  },
  actorName = "",
) {
  const now = new Date().toISOString();
  const current = input.id ? workspace.projects.find((item) => item.id === input.id) : undefined;
  // Kundbyte (2026-10-10): the same rule as Cloud – jobs with the old customer move only on the person's explicit choice,
  // completed work never changes customer; the decision rides on the error for the form (`details.customerChange`).
  const customerOf = (id: string | null | undefined) => id ? workspace.customers.find((item) => item.id === id) : undefined;
  let customerChangeSummary = "";
  if (current && !current.archivedAt && input.customerId && input.customerId !== current.customerId) {
    const toCustomerId = input.customerId;
    const jobs = workspace.workflowTasks.filter((task) => task.projectId === current.id && task.customerId && task.customerId !== toCustomerId);
    const change = projectCustomerChange({ fromCustomerId: current.customerId, toCustomerId, fromName: customerDisplayName(customerOf(current.customerId)), toName: customerDisplayName(customerOf(toCustomerId)), jobs });
    if (change && (change.blocked || input.customerChange !== "move_jobs")) throw Object.assign(new Error(change.message), { status: 409, details: { error: change.message, customerChange: change } });
    if (change) {
      const moved = new Set(jobs.filter((job) => job.status !== "COMPLETED").map((job) => job.id));
      const ownerOf = (facilityId: string | null | undefined) => workspace.customerFacilities.find((facility) => facility.id === facilityId)?.customerId ?? null;
      workspace = { ...workspace, workflowTasks: workspace.workflowTasks.map((task) => moved.has(task.id)
        ? { ...task, customerId: toCustomerId, facilityId: movedJobPlace({ facilityId: task.facilityId ?? null, facilityCustomerId: ownerOf(task.facilityId) }, toCustomerId, input.facilityId ?? null), version: task.version + 1, updatedAt: now }
        : task) };
      customerChangeSummary = `Projektets kund ändrades från ${change.fromName} till ${change.toName}${moved.size ? `; ${moved.size} jobb flyttades till den nya kunden` : ""}`;
    }
  }
  // Beställare and Kontaktperson follow the customer (2026-10-10), like Arbetsplats / anläggning follows the place.
  const customerFields = projectCustomerFields({ customer: customerOf(input.customerId), previousCustomer: customerOf(current?.customerId), client: input.client ?? "", contactPerson: input.contactPerson ?? "" });
  // "Flytta allt lika mycket" (decision 5): open jobs' Start and Klart senast (projectShift) and active planning move with a changed frame.
  const shiftDays = current && (current.startDate !== input.startDate || current.dueDate !== input.dueDate) ? input.shiftDays ?? 0 : 0;
  if (shiftDays && current) {
    const inProject = (taskId: string | null, projectId: string | null) => projectId === current.id
      || Boolean(taskId && workspace.workflowTasks.find((task) => task.id === taskId)?.projectId === current.id);
    const move = (value: string) => addSwedishDays(value, shiftDays).toISOString();
    const shift = projectShift(workspace.workflowTasks.filter((task) => task.projectId === current.id), shiftDays);
    const moved = new Map(shift.moves.map((item) => [item.job.id, item]));
    workspace = {
      ...workspace,
      workflowTasks: workspace.workflowTasks.map((task) => { const shifted = moved.get(task.id); return shifted ? { ...task, plannedStartDate: shifted.plannedStartDate, dueDate: shifted.dueDate, version: task.version + 1, updatedAt: now } : task; }),
      plannedActivities: workspace.plannedActivities.map((activity) => {
        if (activity.deletedAt || !["PLANNED", "IN_PROGRESS"].includes(activity.status) || !inProject(activity.workflowTaskId, activity.projectId) || (activity.workflowTaskId && shift.kept.has(activity.workflowTaskId))) return activity;
        const movedBooking: LocalPlannedActivity = { ...activity, startsAt: move(activity.startsAt), endsAt: move(activity.endsAt), assignments: activity.assignments.map((assignment) => assignment.startsAt && assignment.endsAt ? { ...assignment, startsAt: move(assignment.startsAt), endsAt: move(assignment.endsAt) } : assignment), version: activity.version + 1, updatedAt: now };
        return { ...movedBooking, events: [...activity.events, { id: crypto.randomUUID(), kind: "UPDATED" as const, summary: `Planeringen ${activity.title} flyttades ${shiftDays} dagar med projektets tidsram`, snapshot: localPlannedActivitySnapshot(movedBooking), actorName, createdAt: now }] };
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
    client: customerFields.client,
    contactPerson: customerFields.contactPerson,
    reference: input.reference ?? "",
    workSite: input.workSite ?? "",
    // Same validation as Cloud; without the field (an older caller) the stored value is kept.
    staffRegister: input.staffRegister ? localStaffRegister(input.staffRegister) : current?.staffRegister,
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
          : customerChangeSummary || "Projektets grunduppgifter uppdaterades"
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
  taskKind: "WORK_ORDER" | "RISK_ASSESSMENT" | "FORM",
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
    return { ...result, plannedActivities: result.plannedActivities.map((activity) => !activity.deletedAt && activity.workflowTaskId === taskId && activity.projectId !== projectId
      ? { ...activity, projectId, version: activity.version + 1, updatedAt: now, events: [...activity.events, { id: crypto.randomUUID(), kind: "UPDATED" as const, summary: `Planeringen ${activity.title} följde med uppgiften till projektet ${project.name}`, snapshot: localPlannedActivitySnapshot({ ...activity, projectId }), actorName, createdAt: now }] }
      : activity) };
  };
  const current = workspace.workflowTasks.find((task) => task.id === taskId && task.kind === taskKind);
  if (!current) throw new Error("Uppgiften hittades inte i den lokala arbetsytan.");
  // Arbetsordern styr (2026-10-26): only a work order moves to a project; its tasks follow, like Cloud.
  if (current.kind !== "WORK_ORDER") throw new Error(PROJECT_LINK_WORK_ORDER_ONLY);
  const open = current.status !== "COMPLETED" && !isTaskCancelled(current.status);
  const updated: LocalWorkflowTask = {
    ...current,
    projectId,
    customerId: open && apply.customer && project.customerId ? project.customerId : current.customerId,
    facilityId: localFacilityFor(current, project, Boolean(open && apply.customer && project.customerId)),
    assignedToUserId: open && apply.responsible && project.responsibleUserId ? project.responsibleUserId : current.assignedToUserId,
    assignedToName: open && apply.responsible && project.responsibleUserId ? project.responsibleName : current.assignedToName,
    ...datesOnProjectLink(current, { open, chosenDue: apply.dueDate, today: swedishDayKey(new Date()), frame: { startDate: project.startDate ?? "", dueDate: project.dueDate } }),
    version: current.version + 1,
    updatedAt: now,
  };
  // Open tasks take all the shared Grunduppgifter (2026-10-30); finished ones only the project, customer and place they must match.
  const isOpen = (task: LocalWorkflowTask) => task.status !== "COMPLETED" && !isTaskCancelled(task.status);
  const following = new Map([...tasksFollowingWorkOrder(updated, workspace.workflowTasks.filter(isOpen)),
    ...tasksFollowingWorkOrder({ ...updated, assignedToUserId: undefined, assignedToName: undefined, plannedStartDate: undefined, dueDate: undefined }, workspace.workflowTasks.filter((task) => !isOpen(task)))].map((task) => [task.id, task]));
  return finish({ ...workspace, workflowTasks: workspace.workflowTasks.map((task) => task.id === taskId ? updated
    : following.has(task.id) ? { ...followedFields(task, following.get(task.id)!), version: task.version + 1, updatedAt: now } : task) }, current.title, current.projectId);
}
/** The shared Grunduppgifter a task takes from its work order (2026-10-30), as stored in the file. */
function followedFields(task: LocalWorkflowTask, next: LocalWorkflowTask): LocalWorkflowTask {
  return { ...task, projectId: next.projectId, customerId: next.customerId, facilityId: next.facilityId ?? null, assignedToUserId: next.assignedToUserId ?? null, assignedToName: next.assignedToName ?? "", plannedStartDate: next.plannedStartDate ?? "", dueDate: next.dueDate ?? "" };
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
  const facility = normalizeFacilityInput(customerFacilityInputSchema.parse(input.facility));
  const parentError = placeParentError(workspace.customerFacilities, { id: input.id, customerId, parentId: facility.parentId });
  if (parentError) throw new Error(parentError);
  // The same rule as Cloud's 409 (2026-10-08): the existing place's id rides on the error for the Plats field.
  const duplicate = duplicatePlace(workspace.customerFacilities, { id: input.id, customerId, parentId: facility.parentId, name: facility.name });
  if (duplicate) throw Object.assign(new Error(DUPLICATE_PLACE_MESSAGE), { status: 409, details: { existingId: duplicate.id } });
  const now = new Date().toISOString();
  if (input.id) {
    const current = workspace.customerFacilities.find((item) => item.id === input.id && item.customerId === customerId);
    if (!current) throw new Error("Anläggningen hittades inte i den lokala arbetsytan.");
    return { ...workspace, customerFacilities: workspace.customerFacilities.map((item) => item.id === current.id ? { ...item, ...facility, version: item.version + 1, updatedAt: now } : item) };
  }
  return { ...workspace, customerFacilities: [...workspace.customerFacilities, { ...facility, id: crypto.randomUUID(), customerId, isActive: true, version: 1, createdAt: now, updatedAt: now }] };
}

/** Ta bort (2026-10-14), the same rule as Cloud: only a place nothing in the file points to. */
export function deleteLocalCustomerFacility(workspace: LocalWorkspaceDocument, id: string) {
  if (!workspace.customerFacilities.some((item) => item.id === id)) throw new Error("Platsen hittades inte i den lokala arbetsytan.");
  const message = placeInUseMessage({
    children: workspace.customerFacilities.filter((item) => item.parentId === id).length,
    projects: workspace.projects.filter((project) => project.facilityId === id).length,
    workflowTasks: workspace.workflowTasks.filter((task) => task.facilityId === id).length,
    formSchedules: workspace.formSchedules.filter((schedule) => schedule.facilityId === id).length,
    limitProfiles: workspace.formLimitProfiles.filter((profile) => profile.facilityId === id).length,
  });
  if (message) throw new Error(message);
  return { ...workspace, customerFacilities: workspace.customerFacilities.filter((item) => item.id !== id) };
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
      archivedAt: project.archivedAt, closedAt: project.closedAt, startDate: project.startDate, dueDate: project.dueDate,
      tasks: workspace.workflowTasks.filter((task) => task.projectId === projectId),
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
  const taskProjectId = workflowTask?.projectId ?? null;
  if (activity.projectId && taskProjectId && activity.projectId !== taskProjectId)
    throw new Error("Den valda uppgiften tillhör ett annat projekt.");
  // Same frame rules as Cloud; the Local file owner is the local administrator and may make logged exceptions.
  const previous = activity.id ? workspace.plannedActivities.find((item) => item.id === activity.id) : undefined;
  const active = !["COMPLETED", "CANCELED"].includes(activity.status);
  const changed = !previous || previous.startsAt !== activity.startsAt || previous.endsAt !== activity.endsAt || previous.projectId !== activity.projectId
    || previous.workflowTaskId !== activity.workflowTaskId;
  if (active && changed && workflowTask?.status === "COMPLETED")
    throw new Error("Uppgiften är slutförd. Återöppna den innan du planerar mer arbete på den.");
  if (active && changed && isTaskCancelled(workflowTask?.status))
    throw new Error("Jobbet har utgått. Återuppta det innan du planerar arbete på det.");
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

/** The file's round work orders (holding a round for a period, and schedule 12's per occurrence), as the round views read them. */
export const localRoundOrders = (workspace: Pick<LocalWorkspaceDocument, "workflowTasks">): RoundOrderRef[] =>
  workspace.workflowTasks.flatMap((task) => { const ref = task.kind === "WORK_ORDER" ? roundOrderRef({ ...task, plannedStartDate: task.plannedStartDate ?? "" }) : null; return ref ? [ref] : []; });
/** The file's round work orders with where they are done named (2026-10-27 kväll), for Driftronder and the planning. */
export const localRoundOrderPlaces = (workspace: Pick<LocalWorkspaceDocument, "workflowTasks" | "customers" | "customerFacilities" | "projects">): RoundOrderRef[] =>
  localRoundOrders(workspace).map((ref) => {
    const customer = ref.customerId ? workspace.customers.find((item) => item.id === ref.customerId) : undefined;
    const place = ref.facilityId ? workspace.customerFacilities.find((item) => item.id === ref.facilityId) : undefined;
    return { ...ref, customerName: customer ? customerTitle(customer) : "", facilityName: place?.name ?? "", projectName: ref.projectId ? workspace.projects.find((item) => item.id === ref.projectId)?.name ?? "" : "",
      facilityPosition: typeof place?.latitude === "number" && typeof place.longitude === "number" ? { latitude: place.latitude, longitude: place.longitude } : null };
  });
/** The days registered in a work order of the file (its protocols' `values.round`). */
const localRegisteredOccurrences = (workspace: LocalWorkspaceDocument, workOrderId: string) =>
  workspace.workflowTasks.flatMap((task) => { const round = task.workOrderId === workOrderId ? roundOfProtocolValues(task.data) : null; return round && task.status !== "CANCELLED" ? [round.occurrence] : []; });

export function saveLocalWorkflowTaskRecord(base: LocalWorkspaceDocument, input: unknown, options: {
  /** The company's choice (Arbetssätt, read from the server by the page): Arbetet är redan utfört. Left out it is allowed, as a company's default. */
  riskExceptionAllowed?: boolean;
} = {}) {
  const parsed = workflowTaskInputSchema.parse(input);
  const workspace = base;
  // Driftrond i arbetsordern (2026-10-27, punkt 3): a protocol started from a round registers the occurrence in the round's
  // work order for the day – the same as Cloud; nothing is made here.
  if (!parsed.id && parsed.kind === "FORM") {
    const round = roundOfProtocolValues(parsed.data);
    if (round) {
      if (!workspace.formSchedules.some((item) => item.id === round.scheduleId && !item.deletedAt)) throw new Error("Ronden hittades inte i den lokala arbetsytan.");
      const result = roundProtocolOrder(round, parsed.workOrderId, localRoundOrders(workspace));
      if (result.error !== undefined) throw new Error(result.error);
      parsed.workOrderId = result.id;
      // Where the occurrence is done is the work order's (2026-10-27 kväll): its temporary place too, as its customer and place.
      parsed.data = withRoundOrderTempPlace(parsed.data, workspace.workflowTasks.find((item) => item.id === result.id)?.data);
    }
  }
  const current = parsed.id ? workspace.workflowTasks.find((item) => item.id === parsed.id) : undefined;
  if (parsed.id && !current) throw new Error("Uppgiften hittades inte i den lokala arbetsytan.");
  if (current && current.version !== parsed.version) throw new Error("Uppgiften har ändrats. Öppna arbetsytan igen.");
  if (current?.status === "COMPLETED") throw new Error("Återöppna uppgiften innan du ändrar den.");
  if (isTaskCancelled(current?.status)) throw new Error("Jobbet har utgått. Återuppta det innan du ändrar det.");
  if (current && current.kind !== parsed.kind) throw new Error("Uppgiftstypen kan inte ändras.");
  // A work order changes project through the project's Flytta; a task follows its work order (Arbetsordern styr, 2026-10-26).
  if (current?.kind === "WORK_ORDER" && current.projectId !== parsed.projectId) throw new Error("Flytta arbetsordern via projektet, så att bytet hamnar i historiken.");
  // Arbetsordern styr (2026-10-26/27): the same rules as Cloud – a linked task has its work order's customer and project and
  // is never let go, a draft may have none yet, and a work order holds one risk assessment.
  if (parsed.kind !== "WORK_ORDER") {
    const order = parsed.workOrderId ? workspace.workflowTasks.find((item) => item.id === parsed.workOrderId) : undefined;
    const changed = (current?.workOrderId ?? null) !== (parsed.workOrderId ?? null);
    Object.assign(parsed, inheritFromWorkOrder(parsed, order, { isNew: !current }));
    const linkError = workOrderLinkError(parsed, order, { changed, previousWorkOrderId: current?.workOrderId ?? null });
    if (linkError) throw new Error(linkError);
    if (changed && order && isRiskAssessmentTask(parsed)) {
      const duplicate = duplicateRiskAssessmentError(workspace.workflowTasks.filter((item) => item.workOrderId === order.id && item.id !== parsed.id && isRiskAssessmentTask(item)));
      if (duplicate) throw new Error(duplicate);
    }
  }
  // Roller med nivå (2026-10-07): a task given to a person named in the programme must reach the task's risk class (the owner
  // counts as level 3). After the link, so a linked task is checked with its work order's responsible person (2026-10-30).
  const levelRefusal = localAssignRefusal(workspace.selfInspection, parsed, current ?? null);
  if (levelRefusal) throw new Error(levelRefusal);
  if (parsed.projectId && !workspace.projects.some((item) => item.id === parsed.projectId)) throw new Error("Projektet hittades inte i den lokala arbetsytan.");
  if (parsed.projectId && workspace.projects.find((item) => item.id === parsed.projectId)?.archivedAt) throw new Error("Återställ projektet innan du sparar en uppgift i det.");
  if (parsed.projectId && workspace.projects.find((item) => item.id === parsed.projectId)?.closedAt) throw new Error("Projektet är avslutat. Återöppna projektet innan du lägger till eller ändrar uppgifter i det.");
  // Same frame rules as Cloud: the project's customer, and a new or changed "Klart senast" within the frame.
  const frameProject = parsed.projectId ? workspace.projects.find((item) => item.id === parsed.projectId) : undefined;
  if (frameProject?.customerId && parsed.customerId !== frameProject.customerId) throw new Error("En uppgift i projektet har projektets kund.");
  const dueError = frameProject && (!current || current.dueDate !== parsed.dueDate || current.projectId !== parsed.projectId) ? taskDueDateError(parsed.dueDate, frameProject) : null;
  if (dueError) throw new Error(dueError);
  // Start på alla jobb (plan 1M): the same as Cloud – a new job starts today inside the project's frame; a saved Start is never cleared.
  if (!current) parsed.plannedStartDate = startForNewJob({ chosen: parsed.plannedStartDate, today: swedishDayKey(new Date()), dueDate: parsed.dueDate, frame: frameProject ? { startDate: frameProject.startDate ?? "", dueDate: frameProject.dueDate ?? "" } : null });
  else if (parsed.plannedStartDate === "" && current.plannedStartDate) parsed.plannedStartDate = current.plannedStartDate;
  // Start and Uppskattad tid (steg 2): the same rules as Cloud; left out keeps what the task has.
  const scheduleError = taskScheduleError(parsed, current ? { plannedStartDate: current.plannedStartDate ?? "", dueDate: current.dueDate, projectId: current.projectId } : null, frameProject);
  if (scheduleError) throw new Error(scheduleError);
  if (parsed.customerId && !workspace.customers.some((item) => item.id === parsed.customerId && !item.deletedAt)) throw new Error("Kunden hittades inte i den lokala arbetsytan.");
  assertLocalFacilityLink(workspace, { facilityId: parsed.facilityId, customerId: parsed.customerId, previousFacilityId: current?.facilityId });
  // Riskbedömning som steg (2026-10-08): the same stamp and completion gate as Cloud (lib/workflow/risk-step.ts).
  const riskExceptionRefused = riskExceptionRefusal(parsed.data, current?.data ?? null, options.riskExceptionAllowed !== false);
  if (riskExceptionRefused) throw new Error(riskExceptionRefused);
  parsed.data = stampRiskStep(parsed.data, { created: !current, stored: current?.data ?? null, exempt: riskStepExempt(parsed), actor: workspace.localIdentity, now: new Date().toISOString() });
  const linkedRisk = riskCheckOf(parsed.data)?.extendedTaskId;
  if (linkedRisk && !workspace.workflowTasks.some((item) => item.id === linkedRisk && isRiskAssessmentTask(item))) throw new Error("Den kopplade riskbedömningen hittades inte i den lokala arbetsytan.");
  // Säkerhetsavstämning (2026-10-27, punkt 4): the same stamp as Cloud.
  parsed.data = localStampRoundSafety(workspace.workflowTasks, parsed, { created: !current, stored: current?.data ?? null, actor: workspace.localIdentity, now: new Date().toISOString(), inRound: Boolean(roundOfProtocolValues(parsed.data)) });
  const now = new Date().toISOString();
  // Before the completion check, as Cloud: a judgement or verdict that no longer holds must not count.
  parsed.data = stampCustomerAndJudgements(parsed.data, current?.data ?? null, workspace.localIdentity.name, now);
  if (parsed.status === "COMPLETED") {
    const completion = workflowTaskCompletion(parsed);
    if (!completion.ready) throw new Error(completion.issues.map((issue) => issue.message).join(" "));
    const riskRefusal = localRiskStepRefusal(workspace.workflowTasks, { ...parsed, status: current?.status ?? "PLANNED" }, "complete");
    if (riskRefusal) throw new Error(riskRefusal);
    const safetyRefusal = localRoundSafetyRefusal(workspace.workflowTasks, { ...parsed, status: current?.status ?? "PLANNED" }, "complete");
    if (safetyRefusal) throw new Error(safetyRefusal);
  }
  parsed.data = stampWorkflowTaskApproval(parsed.data, now);
  // Same as Cloud: Pågår and Pausad follow the time (2026-10-08).
  const chosen = savedStatusForTask(parsed, current?.status);
  // Säkerhetsavstämning: the check comes before the work, as Cloud.
  const safetyGate = roundSafetyWorkGate(parsed, roundSafetyRiskFrom(workspace.workflowTasks, parsed.workOrderId), { chosen, documented: workflowTaskHasDocumentation(parsed), stored: current ? { status: current.status, data: current.data } : null });
  if (safetyGate.refusal) throw new Error(safetyGate.refusal);
  const status = safetyGate.status as typeof chosen;
  // Uppgifter får skapas först (2026-10-27): without a work order only a draft is saved, as Cloud.
  const unlinked = workOrderRequiredError({ kind: parsed.kind, workOrderId: parsed.workOrderId, status });
  if (unlinked) throw new Error(unlinked);
  // Driftrond i arbetsordern (punkt 3): the round a work order holds and its period, checked as Cloud.
  const roundScheduleId = parsed.kind !== "WORK_ORDER" ? null : parsed.roundScheduleId === undefined ? current?.roundScheduleId ?? null : parsed.roundScheduleId;
  if (parsed.kind === "WORK_ORDER" && (roundScheduleId || current?.roundScheduleId)) {
    const holderError = roundHolderSaveError({ roundScheduleId, from: parsed.plannedStartDate ?? "", to: parsed.dueDate, status },
      current ? { roundScheduleId: current.roundScheduleId ?? null, roundOccurrence: current.roundOccurrence ?? null } : null,
      { scheduleExists: Boolean(roundScheduleId && workspace.formSchedules.some((item) => item.id === roundScheduleId && !item.deletedAt)), others: localRoundOrders(workspace).filter((order) => order.scheduleId === roundScheduleId && order.id !== current?.id), occurrences: current ? localRegisteredOccurrences(workspace, current.id) : [] });
    if (holderError) throw new Error(holderError);
  }
  // Same as Cloud: "Väntar på …" belongs to a paused work order only.
  parsed.data = withoutStaleWaiting(status, parsed.data);
  const progress = workflowTaskProgress({ ...parsed, status });
  const version = (current?.version ?? 0) + 1;
  const completedAt = status === "COMPLETED" ? now : null;
  const revision = { id: crypto.randomUUID(), version, createdAt: now, snapshot: { title: parsed.title, description: parsed.description, status, progress, data: parsed.data, completedAt } };
  const task: LocalWorkflowTask = { id: current?.id ?? crypto.randomUUID(), version, kind: parsed.kind, title: parsed.title, description: parsed.description, status, progress, projectId: parsed.projectId, customerId: parsed.customerId, facilityId: parsed.facilityId, ...(parsed.workOrderId || current?.workOrderId ? { workOrderId: parsed.workOrderId } : {}), assignedToUserId: parsed.assignedToUserId, assignedToName: parsed.assignedToName, dueDate: parsed.dueDate, ...(current?.roundOccurrence ? { roundScheduleId: current.roundScheduleId, roundOccurrence: current.roundOccurrence } : roundScheduleId ? { roundScheduleId } : {}), plannedStartDate: parsed.plannedStartDate ?? current?.plannedStartDate ?? "", estimatedMinutes: parsed.estimatedMinutes === undefined ? current?.estimatedMinutes ?? null : parsed.estimatedMinutes, ...(parsed.stage !== undefined || current?.stage !== undefined ? { stage: normalizeStage(parsed.stage ?? current?.stage) } : {}), ...(current?.predecessorIds ? { predecessorIds: current.predecessorIds } : {}), data: parsed.data, startedAt: current?.startedAt ?? (status === "IN_PROGRESS" ? now : null), completedAt, createdAt: current?.createdAt ?? now, updatedAt: now, timeEntries: current?.timeEntries ?? [], revisions: [...(current?.revisions ?? []), revision], cloudOrigin: current?.cloudOrigin };
  if (current?.completionHistory) task.completionHistory = current.completionHistory;
  let timeEntryEvents = workspace.timeEntryEvents;
  if (status === "COMPLETED") ({ timeEntries: task.timeEntries, timeEntryEvents } = closeLocalRunningEntries(workspace, task, now));
  // Same as Cloud: completing a task stops its running timer, and a long entry that just stopped gets the warning.
  const stopped: StoppedTimer[] = task.timeEntries.filter((entry) => entry.endedAt && current?.timeEntries.some((before) => before.id === entry.id && !before.endedAt))
    .map((entry) => ({ entryId: entry.id, taskId: task.id, taskTitle: task.title, startedAt: entry.startedAt, endedAt: entry.endedAt!, durationSec: entry.durationSec }));
  // The tasks of a work order follow its Grunduppgifter (Arbetsordern som hållare, 2026-10-30), like Cloud: a new responsible
  // person must take each open task's class.
  const following = task.kind === "WORK_ORDER" && current && sharedBasicsChanged(current, task) ? new Map(tasksFollowingWorkOrder(task, workspace.workflowTasks.filter((item) => item.status !== "COMPLETED" && !isTaskCancelled(item.status))).map((item) => [item.id, item])) : new Map<string, LocalWorkflowTask>();
  for (const next of following.values()) {
    const before = workspace.workflowTasks.find((item) => item.id === next.id)!;
    const refusal = localAssignRefusal(workspace.selfInspection, next, before);
    if (refusal) throw new Error(`${before.title}: ${refusal}`);
  }
  const saved = current ? workspace.workflowTasks.map((item) => item.id === task.id ? task : following.has(item.id) ? { ...followedFields(item, following.get(item.id)!), version: item.version + 1, updatedAt: now } : item) : [...workspace.workflowTasks, task];
  return { workspace: { ...workspace, timeEntryEvents, workflowTasks: saved }, task, stopped };
}


/**
 * Ta bort arbetsorder in the file (svar 2b), the same rule as Cloud: its tasks go with it; refused while one is completed or
 * signed. Returns the new file and the removed attachments (the caller removes their files).
 */
export function removeLocalWorkOrder(workspace: LocalWorkspaceDocument, id: string) {
  const order = workspace.workflowTasks.find((task) => task.id === id && task.kind === "WORK_ORDER");
  if (!order) throw new Error("Arbetsordern hittades inte i den lokala arbetsytan.");
  const inside = workspace.workflowTasks.filter((task) => task.workOrderId === id);
  const refusal = workOrderRemovalRefusal(inside.map((task) => ({ id: task.id, kind: task.kind, title: task.title, status: task.status, signed: taskIsSigned(task.data) })));
  if (refusal) throw new Error(refusal);
  const ids = new Set([id, ...inside.map((task) => task.id)]);
  const now = new Date().toISOString();
  const attachments = workspace.attachments.filter((attachment) => ids.has(attachment.taskId));
  return {
    workspace: { ...workspace, workflowTasks: workspace.workflowTasks.filter((task) => !ids.has(task.id)), attachments: workspace.attachments.filter((attachment) => !ids.has(attachment.taskId)),
      plannedActivities: workspace.plannedActivities.map((activity) => activity.workflowTaskId && ids.has(activity.workflowTaskId) ? { ...activity, workflowTaskId: null, version: activity.version + 1, updatedAt: now } : activity) },
    attachments,
  };
}

// Stopping the timer (pause or completion) finishes an entry; it enters the append-only time history then.
function closeLocalRunningEntries(workspace: LocalWorkspaceDocument, task: LocalWorkflowTask, now: string, options: { keepShort?: boolean } = {}) {
  const events: TimeEntryEvent[] = [];
  const timeEntries = task.timeEntries.flatMap((entry) => {
    if (entry.endedAt) return [entry];
    const elapsedSec = Math.max(0, Math.floor((Date.parse(now) - Date.parse(entry.startedAt)) / 1000));
    const closed = { ...entry, endedAt: now, durationSec: options.keepShort ? Math.max(MIN_TIME_ENTRY_SECONDS, elapsedSec) : elapsedSec, updatedAt: now };
    if (closed.durationSec < MIN_TIME_ENTRY_SECONDS) return [];
    events.push(localTimeEvent({ entryId: entry.id, userId: entry.userId, action: "CREATED", previous: null, next: localTimeSnapshot(closed, task), reason: "", actorUserId: entry.userId, actorName: workspace.localIdentity.name }, now));
    return [closed];
  });
  return { timeEntries, timeEntryEvents: [...events, ...workspace.timeEntryEvents] };
}

/**
 * Same per-person rule as Cloud: pause closes only the caller's entry, and starting pauses the caller's other timers.
 * `keepShort` saves an entry under a minute too (the person answered "Spara ändå", 2026-10-12).
 */
export function updateLocalWorkflowTimer(workspace: LocalWorkspaceDocument, clickedId: string, command: "START" | "PAUSE", userId: string, options: { keepShort?: boolean } = {}) {
  const clicked = workspace.workflowTasks.find((item) => item.id === clickedId);
  if (!clicked) throw new Error("Uppgiften hittades inte i den lokala arbetsytan.");
  // Tid på jobbet (Fas 2): a task that belongs to a work order runs its time on the work order, like Cloud; a draft is
  // linked first (2026-10-27).
  if (taskNeedsWorkOrder(clicked)) throw new Error(WORK_ORDER_REQUIRED);
  const taskId = timeOwnerId(clicked);
  const current = workspace.workflowTasks.find((item) => item.id === taskId);
  if (!current) throw new Error("Arbetsordern hittades inte i den lokala arbetsytan.");
  if (isTaskCancelled(current.status)) throw new Error(current.id === clicked.id ? "Jobbet har utgått. Återuppta det för att skriva tid." : "Tiden räknas på arbetsordern " + current.title + ", som har utgått.");
  if (current.status === "COMPLETED") throw new Error(current.id === clicked.id ? "En slutförd uppgift kan inte tidrapporteras." : "Tiden räknas på arbetsordern " + current.title + ", som är färdigställd. Återöppna den för att skriva tid.");
  const riskRefusal = command === "START" ? localRiskStepRefusal(workspace.workflowTasks, current, "start") : null;
  if (riskRefusal) throw new Error(riskRefusal);
  // Säkerhetsavstämning (2026-10-27, punkt 4): a round occurrence's check, as Cloud.
  const safetyRefusal = command !== "START" ? null : clicked.id !== current.id ? localRoundSafetyRefusal(workspace.workflowTasks, clicked, "start") : localOrderRoundSafetyRefusal(workspace.workflowTasks, current.id);
  if (safetyRefusal) throw new Error(safetyRefusal);
  const iso = new Date().toISOString();
  const stopped: StoppedTimer[] = [];
  let timeEntryEvents = workspace.timeEntryEvents;
  // Closes the caller's running entries on one task; other people's entries keep running.
  const closeEntries = (owner: { id: string; title: string; timeEntries: LocalWorkflowTask["timeEntries"]; project?: boolean }) => owner.timeEntries.flatMap((entry) => {
    if (entry.endedAt || entry.userId !== userId) return [entry];
    const elapsedSec = Math.max(0, Math.floor((Date.parse(iso) - Date.parse(entry.startedAt)) / 1000));
    const closed = { ...entry, endedAt: iso, durationSec: options.keepShort ? Math.max(MIN_TIME_ENTRY_SECONDS, elapsedSec) : elapsedSec, updatedAt: iso };
    if (closed.durationSec < MIN_TIME_ENTRY_SECONDS) return [];
    timeEntryEvents = [localTimeEvent({ entryId: entry.id, userId: entry.userId, action: "CREATED", previous: null, next: localTimeSnapshot(closed, owner), reason: "", actorUserId: entry.userId, actorName: workspace.localIdentity.name }, iso), ...timeEntryEvents];
    stopped.push({ entryId: entry.id, taskId: owner.id, taskTitle: owner.title, ...(owner.project ? { projectId: owner.id } : {}), startedAt: entry.startedAt, endedAt: iso, durationSec: closed.durationSec });
    return [closed];
  });
  const closeOwn = (task: LocalWorkflowTask) => {
    const timeEntries = closeEntries(task);
    return { ...task, timeEntries, status: task.status === "IN_PROGRESS" && !timeEntries.some((entry) => !entry.endedAt) ? "PAUSED" as const : task.status, updatedAt: iso };
  };
  const runsMine = (entries: LocalWorkflowTask["timeEntries"]) => entries.some((entry) => !entry.endedAt && entry.userId === userId);
  // Rapporterad från (2026-10-27): the task the person started the time in is remembered on the work order's entry.
  const newEntry = () => ({ id: crypto.randomUUID(), userId, startedAt: iso, endedAt: null, durationSec: 0, note: "", createdAt: iso, updatedAt: iso, ...(clicked.id !== taskId ? { sourceTaskId: clicked.id } : {}) });
  const tasks = workspace.workflowTasks.map((item) => {
    if (item.id === taskId) {
      if (command === "PAUSE") return closeOwn({ ...item, status: "IN_PROGRESS" });
      return { ...item, data: withoutStaleWaiting("IN_PROGRESS", item.data), status: "IN_PROGRESS" as const, startedAt: item.startedAt ?? iso, updatedAt: iso, timeEntries: runsMine(item.timeEntries) ? item.timeEntries : [...item.timeEntries, newEntry()] };
    }
    return command === "START" && runsMine(item.timeEntries) ? closeOwn(item) : item;
  });
  // One running timer per person (2026-10-26): starting on a work order stops the person's project time too.
  const projects = command === "START" ? workspace.projects.map((project) => runsMine(project.timeEntries) ? { ...project, timeEntries: closeEntries({ id: project.id, title: project.name, timeEntries: project.timeEntries, project: true }) } : project) : workspace.projects;
  const task = { ...tasks.find((item) => item.id === taskId)!, progress: workflowTaskProgress(current) };
  return { workspace: { ...workspace, timeEntryEvents, projects, workflowTasks: tasks.map((item) => item.id === task.id ? task : item) }, task, stopped };
}

/**
 * Projekttid med timer in the file (2026-10-26, svar 5a): the same rules as Cloud's project_timer – start pauses the
 * person's timer elsewhere (one running timer per person), pause saves the entry (under a minute only with keepShort).
 */
export function updateLocalProjectTimer(workspace: LocalWorkspaceDocument, projectId: string, command: "START" | "PAUSE", userId: string, options: { keepShort?: boolean } = {}) {
  const project = workspace.projects.find((item) => item.id === projectId);
  if (!project) throw new Error("Projektet hittades inte i den lokala arbetsytan.");
  if (command === "START" && project.archivedAt) throw new Error("Återställ projektet innan du skriver tid på det.");
  if (command === "START" && project.closedAt) throw new Error("Projektet är avslutat. Återöppna det för att skriva tid.");
  const iso = new Date().toISOString();
  const stopped: StoppedTimer[] = [];
  let timeEntryEvents = workspace.timeEntryEvents;
  const close = (owner: { id: string; title: string; timeEntries: LocalWorkflowTask["timeEntries"]; project?: boolean }) => owner.timeEntries.flatMap((entry) => {
    if (entry.endedAt || entry.userId !== userId) return [entry];
    const elapsedSec = Math.max(0, Math.floor((Date.parse(iso) - Date.parse(entry.startedAt)) / 1000));
    const closed = { ...entry, endedAt: iso, durationSec: options.keepShort ? Math.max(MIN_TIME_ENTRY_SECONDS, elapsedSec) : elapsedSec, updatedAt: iso };
    if (closed.durationSec < MIN_TIME_ENTRY_SECONDS) return [];
    timeEntryEvents = [localTimeEvent({ entryId: entry.id, userId: entry.userId, action: "CREATED", previous: null, next: localTimeSnapshot(closed, owner), reason: "", actorUserId: entry.userId, actorName: workspace.localIdentity.name }, iso), ...timeEntryEvents];
    stopped.push({ entryId: entry.id, taskId: owner.id, taskTitle: owner.title, ...(owner.project ? { projectId: owner.id } : {}), startedAt: entry.startedAt, endedAt: iso, durationSec: closed.durationSec });
    return [closed];
  });
  const runsMine = (entries: LocalWorkflowTask["timeEntries"]) => entries.some((entry) => !entry.endedAt && entry.userId === userId);
  const projects = workspace.projects.map((item) => {
    if (item.id === projectId) return command === "PAUSE" ? { ...item, timeEntries: close({ id: item.id, title: item.name, timeEntries: item.timeEntries, project: true }) }
      : runsMine(item.timeEntries) ? item : { ...item, timeEntries: [...item.timeEntries, { id: crypto.randomUUID(), userId, startedAt: iso, endedAt: null, durationSec: 0, note: "", createdAt: iso, updatedAt: iso }] };
    return command === "START" && runsMine(item.timeEntries) ? { ...item, timeEntries: close({ id: item.id, title: item.name, timeEntries: item.timeEntries, project: true }) } : item;
  });
  const workflowTasks = command === "START" ? workspace.workflowTasks.map((task) => {
    if (!runsMine(task.timeEntries)) return task;
    const timeEntries = close(task);
    return { ...task, timeEntries, status: task.status === "IN_PROGRESS" && !timeEntries.some((entry) => !entry.endedAt) ? "PAUSED" as const : task.status, updatedAt: iso };
  }) : workspace.workflowTasks;
  return { workspace: { ...workspace, projects, workflowTasks, timeEntryEvents }, stopped };
}

/** What a Local time entry is registered on: a work order, or a project itself (Projekttid, 2026-10-26). */
type LocalTimeOwner = { id: string; title: string; status: string; projectId: string | null; timeEntries: LocalWorkflowTask["timeEntries"]; project?: boolean };
const localTimeOwners = (workspace: LocalWorkspaceDocument): LocalTimeOwner[] => [
  ...workspace.workflowTasks.map((task) => ({ id: task.id, title: task.title, status: task.status, projectId: task.projectId, timeEntries: task.timeEntries })),
  ...workspace.projects.map((project) => ({ id: project.id, title: project.name, status: projectTimeState(project).status, projectId: project.id, timeEntries: project.timeEntries, project: true })),
];
const localTaskState = (workspace: LocalWorkspaceDocument, owner: Pick<LocalTimeOwner, "status" | "projectId">) => ({ status: owner.status, archived: Boolean(owner.projectId && workspace.projects.find((project) => project.id === owner.projectId)?.archivedAt) });
const localTimeSnapshot = (entry: { startedAt: string; endedAt: string | null; durationSec: number; note: string }, owner: Pick<LocalTimeOwner, "id" | "title" | "project">): TimeEntrySnapshot => ({ taskId: owner.id, taskTitle: owner.title, ...(owner.project ? { projectId: owner.id } : {}), startedAt: entry.startedAt, endedAt: entry.endedAt, durationSec: entry.durationSec, note: entry.note });
const localTimeEvent = (event: Omit<TimeEntryEvent, "id" | "createdAt">, createdAt: string): TimeEntryEvent => ({ ...event, id: crypto.randomUUID(), createdAt });

// The Local file owner is the local administrator: the same correction rules as Cloud apply to their own entries.
// Changing the task moves the entry to that task; its id and history stay.
export function saveLocalWorkflowTimeEntry(
  workspace: LocalWorkspaceDocument,
  input: { id?: string; taskId?: string; projectId?: string; startedAt: string; endedAt: string; note: string },
  userId: string,
  reason = "",
  actorName = "",
) {
  const owners = localTimeOwners(workspace);
  // Tid på arbetsordern (2026-10-26): time written on a task is recorded on its work order; a project takes its own time.
  const sourceId = input.projectId ?? input.taskId ?? "";
  const picked = workspace.workflowTasks.find((task) => task.id === sourceId);
  if (picked && taskNeedsWorkOrder(picked)) throw new Error(WORK_ORDER_REQUIRED);
  const target = owners.find((owner) => owner.id === (picked ? timeOwnerId(picked) : sourceId));
  if (!target) throw new Error("Arbetsordern eller projektet hittades inte i den lokala arbetsytan.");
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
  // Rapporterad från (2026-10-27): time written in a task remembers it; moved to another owner without one, it forgets the old.
  const source = picked && picked.id !== target.id ? { sourceTaskId: picked.id } : existing && existing.owner.id !== target.id ? { sourceTaskId: null } : {};
  const entry = { ...existing?.entry, ...source, id: existing?.entry.id ?? crypto.randomUUID(), userId, startedAt: startedAt.toISOString(), endedAt: endedAt.toISOString(), durationSec, note: input.note.trim().slice(0, 1000), createdAt: existing?.entry.createdAt ?? now, updatedAt: now };
  const place = <T extends { id: string; timeEntries: LocalWorkflowTask["timeEntries"] }>(item: T): T => {
    const without = item.timeEntries.filter((other) => other.id !== entry.id);
    return item.id === target.id ? { ...item, timeEntries: [...without, entry], updatedAt: now } : without.length === item.timeEntries.length ? item : { ...item, timeEntries: without };
  };
  const event = localTimeEvent({ entryId: entry.id, userId, action: existing ? "UPDATED" : "CREATED", previous: existing ? localTimeSnapshot(existing.entry, existing.owner) : null, next: localTimeSnapshot(entry, target), reason: normalizedReason, actorUserId: userId, actorName }, now);
  return { ...workspace, workflowTasks: workspace.workflowTasks.map(place), projects: workspace.projects.map(place), timeEntryEvents: [event, ...workspace.timeEntryEvents] };
}

export function removeLocalWorkflowTimeEntry(workspace: LocalWorkspaceDocument, id: string, userId: string, reason = "", actorName = "") {
  const found = localTimeOwners(workspace).flatMap((owner) => owner.timeEntries.map((entry) => ({ owner, entry }))).find(({ entry }) => entry.id === id && entry.userId === userId);
  if (!found) throw new Error("Tidposten hittades inte i den lokala arbetsytan.");
  const normalizedReason = assertTimeCorrection({ actorIsAdmin: true, actorOwnsEntry: true, source: localTaskState(workspace, found.owner) }, reason);
  const now = new Date().toISOString();
  const event = localTimeEvent({ entryId: id, userId, action: "DELETED", previous: localTimeSnapshot(found.entry, found.owner), next: null, reason: normalizedReason, actorUserId: userId, actorName }, now);
  const without = <T extends { timeEntries: LocalWorkflowTask["timeEntries"] }>(item: T): T => item.timeEntries.some((entry) => entry.id === id) ? { ...item, timeEntries: item.timeEntries.filter((entry) => entry.id !== id) } : item;
  return { ...workspace, workflowTasks: workspace.workflowTasks.map(without), projects: workspace.projects.map(without), timeEntryEvents: [event, ...workspace.timeEntryEvents] };
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

/** Utgår and Återuppta (2026-10-09), the same rules as Cloud (lib/workflow/task-cancel.ts): running time stops. */
export function setLocalWorkflowTaskCancelled(workspace: LocalWorkspaceDocument, taskId: string, input: { cancel: true; reason: string; keepShort?: boolean } | { cancel: false }) {
  const current = workspace.workflowTasks.find((task) => task.id === taskId);
  if (!current) throw new Error("Uppgiften hittades inte i den lokala arbetsytan.");
  const refusal = input.cancel ? cancelTaskError(current, input.reason) : restoreTaskError(current);
  if (refusal) throw new Error(refusal);
  const project = current.projectId ? workspace.projects.find((item) => item.id === current.projectId) : undefined;
  if (project?.archivedAt) throw new Error("Återställ projektet först.");
  if (project?.closedAt) throw new Error("Projektet är avslutat. Återöppna projektet först.");
  const now = new Date().toISOString();
  const status = input.cancel ? "CANCELLED" as const : restoredTaskStatus(current.cancellation?.fromStatus);
  const version = current.version + 1;
  let next: LocalWorkflowTask = { ...current, status, version, updatedAt: now };
  let timeEntryEvents = workspace.timeEntryEvents;
  if (input.cancel) {
    ({ timeEntries: next.timeEntries, timeEntryEvents } = closeLocalRunningEntries(workspace, current, now, { keepShort: input.keepShort }));
    next.cancellation = { at: now, by: workspace.localIdentity.name, reason: input.reason.trim(), fromStatus: current.status };
  } else delete next.cancellation;
  next = { ...next, progress: workflowTaskProgress(next), revisions: [...current.revisions, { id: crypto.randomUUID(), version, createdAt: now, snapshot: { title: current.title, description: current.description, status, progress: workflowTaskProgress(next), data: current.data, completedAt: null } }] };
  const updated = { ...workspace, timeEntryEvents, workflowTasks: workspace.workflowTasks.map((task) => task.id === taskId ? next : task) };
  const summary = input.cancel ? `Jobbet ${current.title} utgår: ${input.reason.trim()}` : `Jobbet ${current.title} återupptogs`;
  return current.projectId ? appendLocalProjectEvent(updated, current.projectId, "UPDATED", summary.slice(0, 500), taskId) : updated;
}

export function changeLocalRecordState(
  workspace: LocalWorkspaceDocument,
  kind: LocalRecordKind,
  action: LocalRecordAction,
  ids: string[],
) {
  const selected = new Set(ids);
  const now = new Date().toISOString();
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
    companyValues: [],
    formSchedules: [],
    selfInspection: emptySelfInspectionDocument(),
    comments: [],
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
    // Schema 12 (2026-10-26) reads as it is: its tasks are all in work orders, and its round work orders per day are kept.
    const v12 = localWorkspaceV12Schema.safeParse(value);
    const v11 = v12.success ? { success: false as const } : localWorkspaceV11Schema.safeParse(value);
    const v10 = v11.success || v12.success ? { success: false as const } : localWorkspaceV10Schema.safeParse(value);
    const v9 = v10.success || v11.success ? null : localWorkspaceV9Schema.safeParse(value);
    const v8 = v10.success || v9?.success ? null : localWorkspaceV8Schema.safeParse(value);
    const v7 = v10.success || v9?.success || v8?.success ? null : localWorkspaceV7Schema.safeParse(value);
    const v6 = v10.success || v9?.success || v8?.success || v7?.success ? null : localWorkspaceV6Schema.safeParse(value);
    const v5 = v10.success || v9?.success || v8?.success || v7?.success || v6?.success ? null : localWorkspaceV5Schema.safeParse(value);
    const v4 = v10.success || v9?.success || v8?.success || v7?.success || v6?.success || v5?.success ? null : localWorkspaceV4Schema.safeParse(value);
    const v3 = v10.success || v9?.success || v8?.success || v7?.success || v6?.success || v5?.success || v4?.success ? null : localWorkspaceV3Schema.safeParse(value);
    const v2 = v10.success || v9?.success || v8?.success || v7?.success || v6?.success || v5?.success || v4?.success || v3?.success ? null : localWorkspaceV2Schema.safeParse(value);
    const legacy = v12.success ? v12.data : v11.success ? v11.data : v10.success ? v10.data : v9?.success ? v9.data : v8?.success ? v8.data : v7?.success ? v7.data : v6?.success ? v6.data : v5?.success ? v5.data : v4?.success ? v4.data : v3?.success ? v3.data : v2?.success ? v2.data : localWorkspaceV1Schema.parse(value);
    // Arbetsordern styr (2026-10-26): standalone tasks get a work order around them and time on tasks moves to it.
    workspace = localWorkspaceSchema.parse({
      ...upgradeLocalWorkOrders(legacy),
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
  // Börjar efter (plan 1K): an id that is not a job in the file is let go before the file is used.
  workspace = withKnownPredecessors(workspace);
  return moveLegacyCustomerRequirements(upgradeLegacySelfInspection(workspace));
}

/**
 * Börjar efter (plan 1K, 2026-10-11): a job's predecessors are kept as the file says, except an id that is not a job in
 * the file (removed, or never there) and the job itself, which are let go. A file without the field reads as before.
 */
export function withKnownPredecessors(workspace: LocalWorkspaceDocument): LocalWorkspaceDocument {
  const ids = new Set(workspace.workflowTasks.map((task) => task.id));
  let changed = false;
  const workflowTasks = workspace.workflowTasks.map((task) => {
    if (!task.predecessorIds) return task;
    const kept = [...new Set(task.predecessorIds)].filter((id) => id !== task.id && ids.has(id));
    if (kept.length === task.predecessorIds.length) return task;
    changed = true;
    return { ...task, predecessorIds: kept };
  });
  return changed ? { ...workspace, workflowTasks } : workspace;
}

/**
 * A programme that is still an untouched copy of an earlier edition of Workflow's template is moved to the current edition
 * when the file is opened (2026-10-08: the older edition must not survive as the current programme). A programme
 * with an approved version or the company's own text is left as it is (lib/self-inspection/template-upgrade.ts).
 */
export function upgradeLegacySelfInspection(workspace: LocalWorkspaceDocument): LocalWorkspaceDocument {
  const selfInspection = upgradeLegacySelfInspectionTemplate(workspace.selfInspection, { now: new Date().toISOString(), newId: () => crypto.randomUUID() });
  return selfInspection === workspace.selfInspection ? workspace : { ...workspace, selfInspection };
}

/**
 * Customers' special requirements that an older version kept in the programme are the customers' own field "Särskilda
 * krav" since 2026-10-07: moved onto the customer when the file is opened (in memory; the file is written the next time
 * it is saved). Nothing is lost: a customer that already has text keeps it and gets the older text after it.
 */
export function moveLegacyCustomerRequirements(workspace: LocalWorkspaceDocument): LocalWorkspaceDocument {
  const legacy = workspace.selfInspection.customerRequirements ?? [];
  if (!legacy.length) return workspace;
  const customers = workspace.customers.map((customer) => {
    const text = legacy.filter((item) => item.customerId === customer.id).map((item) => item.requirements.trim()).filter(Boolean).join("\n\n");
    if (!text) return customer;
    const own = customer.specialRequirements?.trim() ?? "";
    return own.includes(text) ? customer : { ...customer, specialRequirements: [own, text].filter(Boolean).join("\n\n") };
  });
  return { ...workspace, customers, selfInspection: { ...workspace.selfInspection, customerRequirements: [] } };
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
  saveBlob(JSON.stringify(workspace, null, 2), `KFID-lokal-sakerhetskopia-${new Date().toISOString().slice(0, 10)}.json`, "application/json");
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
  const next = { id: current?.id ?? crypto.randomUUID(), templateId: family, facilityId: profile.facilityId, objectName: profile.objectName, values: profile.values, version: (current?.version ?? 0) + 1, updatedAt: now, updatedByName: actorName, cloudOrigin: current?.cloudOrigin };
  return { ...workspace, formLimitProfiles: current ? workspace.formLimitProfiles.map((item) => item.id === current.id ? next : item) : [...workspace.formLimitProfiles, next] };
}

/** Värden och referenser in the file (2026-10-06): the same rules as Cloud – one value per key, a version per value. */
export function saveLocalCompanyValues(workspace: LocalWorkspaceDocument, inputs: CompanyValueInput[], actorName = "") {
  return { ...workspace, companyValues: mergeCompanyValues(workspace.companyValues, inputs, actorName) };
}

/**
 * A round schedule in the file: the same validation as Cloud. The round is the time rules (2026-10-27 kväll): its
 * customer, place, temporary place and project come with the work order that holds it, so a save never sets them – a round
 * from before then keeps what it has stored (the file's format is unchanged), a new one has none.
 */
export function saveLocalFormSchedule(workspace: LocalWorkspaceDocument, input: z.input<typeof formScheduleInputSchema> | FormScheduleInput, templateName: string) {
  const schedule = formScheduleInputSchema.parse(input);
  const now = new Date().toISOString();
  const current = schedule.id ? workspace.formSchedules.find((item) => item.id === schedule.id && !item.deletedAt) : undefined;
  if (schedule.id && !current) throw new Error("Ronden hittades inte.");
  if (current && schedule.version !== undefined && current.version !== schedule.version) throw new Error("Ronden har ändrats i en annan flik. Läs in den på nytt.");
  const kept = { customerId: current?.customerId ?? null, facilityId: current?.facilityId ?? null, projectId: current?.projectId ?? null, tempPlace: current?.tempPlace ?? null };
  const next = { ...schedule, ...kept, id: current?.id ?? crypto.randomUUID(), version: (current?.version ?? 0) + 1, templateName, deletedAt: null, createdAt: current?.createdAt ?? now, updatedAt: now, cloudOrigin: current?.cloudOrigin };
  return { workspace: { ...workspace, formSchedules: current ? workspace.formSchedules.map((item) => item.id === current.id ? next : item) : [...workspace.formSchedules, next] }, id: next.id };
}

export function removeLocalFormSchedule(workspace: LocalWorkspaceDocument, id: string) {
  if (!workspace.formSchedules.some((item) => item.id === id && !item.deletedAt)) throw new Error("Ronden hittades inte.");
  const now = new Date().toISOString();
  return { ...workspace, formSchedules: workspace.formSchedules.map((item) => item.id === id ? { ...item, deletedAt: now, updatedAt: now, version: item.version + 1 } : item) };
}

/** Att boka (2026-11-02) in the file: the rule of lib/overview/team-followup.ts. Local's one person may book every job here. */
export function localWorkToBook(workspace: Pick<LocalWorkspaceDocument, "workflowTasks" | "plannedActivities" | "projects" | "customers">, today: string) {
  const booked = new Set(workspace.plannedActivities.filter((activity) => !activity.deletedAt && activity.status !== "CANCELED" && activity.workflowTaskId).map((activity) => activity.workflowTaskId));
  const { total, rows } = workToBook({ today, workOrders: workspace.workflowTasks.flatMap((task) => {
    if (task.kind !== "WORK_ORDER") return [];
    const project = task.projectId ? workspace.projects.find((item) => item.id === task.projectId) : null;
    if (project?.archivedAt || project?.closedAt) return [];
    const customer = task.customerId ? workspace.customers.find((item) => item.id === task.customerId && !item.deletedAt) : null;
    return [{ id: task.id, title: task.title, status: task.status, progress: workflowTaskProgress(task), startedAt: null, roundScheduleId: task.roundScheduleId ?? null, booked: booked.has(task.id), plannedStartDate: task.plannedStartDate ?? "", dueDate: task.dueDate,
      assignedToUserId: task.assignedToUserId, assignedToName: task.assignedToName, customerName: customer ? customerTitle(customer) : "", projectId: task.projectId, projectName: project?.name ?? "" }];
  }) });
  return { total, rows: rows.slice(0, TO_BOOK_LIMIT) };
}

/**
 * Kvitto (2026-11-04): a picture is marked or unmarked as a receipt also on a completed or cancelled task. Nothing else on
 * the task changes; the history gets one line (who, which file, on or off) as a new version.
 */
export function setLocalAttachmentReceipt(workspace: LocalWorkspaceDocument, taskId: string, attachmentId: string, receipt: boolean, now = new Date().toISOString()): LocalWorkspaceDocument {
  const current = workspace.workflowTasks.find((task) => task.id === taskId);
  const attachment = workspace.attachments.find((item) => item.id === attachmentId && item.taskId === taskId);
  if (!current || !attachment) throw new Error("Bilagan hittades inte i den lokala arbetsytan.");
  if (receipt && !attachment.mimeType.startsWith("image/")) throw new Error("Bara en bild kan vara ett kvitto.");
  if ((attachment.receipt === true) === receipt) return workspace;
  const version = current.version + 1;
  const note = `Kvitto ${receipt ? "markerat" : "avmarkerat"}: ${attachment.filename} (${workspace.localIdentity.name})`.slice(0, 300);
  const next: LocalWorkflowTask = { ...current, version, updatedAt: now, revisions: [...current.revisions, { id: crypto.randomUUID(), version, createdAt: now, snapshot: { title: current.title, description: current.description, status: current.status, progress: current.progress, data: current.data, completedAt: current.completedAt, note } }] };
  return { ...workspace, attachments: workspace.attachments.map((item) => item.id === attachmentId ? { ...item, receipt } : item), workflowTasks: workspace.workflowTasks.map((task) => task.id === taskId ? next : task) };
}
