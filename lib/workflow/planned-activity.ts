import { z } from "zod";

export const plannedActivityKinds = ["TASK", "MEETING", "DEADLINE", "OTHER"] as const;
export const plannedActivityStatuses = ["PLANNED", "IN_PROGRESS", "COMPLETED", "CANCELED"] as const;
export const plannedActivityEventKinds = ["CREATED", "UPDATED", "DELETED"] as const;

export const timeBudgetMinutesSchema = z.number().int().min(0).max(10_000_000);
const identifier = z.string().min(1).max(100);
const timestamp = z.iso.datetime();
export const plannedActivityAssignmentSchema = z.object({
  userId: identifier,
  plannedMinutes: z.number().int().positive().max(10_000_000).nullable().default(null),
  startsAt: timestamp.nullable().default(null),
  endsAt: timestamp.nullable().default(null),
});

export const plannedActivityInputSchema = z.object({
  id: identifier.optional(),
  version: z.number().int().positive().optional(),
  title: z.string().trim().min(1).max(200),
  description: z.string().trim().max(2_000).default(""),
  kind: z.enum(plannedActivityKinds).default("TASK"),
  status: z.enum(plannedActivityStatuses).default("PLANNED"),
  startsAt: timestamp,
  endsAt: timestamp,
  projectId: identifier.nullable().default(null),
  workflowTaskId: identifier.nullable().default(null),
  controlId: identifier.nullable().default(null),
  assignedToUserId: identifier.nullable().default(null),
  assignedToUserIds: z.array(identifier).max(25).default([]),
  assignments: z.array(plannedActivityAssignmentSchema).max(25).default([]),
  assignedToName: z.string().trim().max(160).default(""),
  /** A logged exception for planning outside the project's frame; only the project's responsible or an admin. */
  frameExceptionReason: z.string().trim().max(500).default(""),
}).superRefine((activity, context) => {
  if (Date.parse(activity.endsAt) <= Date.parse(activity.startsAt))
    context.addIssue({ code: "custom", path: ["endsAt"], message: "Sluttiden måste vara efter starttiden." });
  if (Number(Boolean(activity.workflowTaskId)) + Number(Boolean(activity.controlId)) > 1)
    context.addIssue({ code: "custom", path: ["workflowTaskId"], message: "En planerad aktivitet kan kopplas till högst en uppgift." });
  if (new Set(activity.assignedToUserIds).size !== activity.assignedToUserIds.length)
    context.addIssue({ code: "custom", path: ["assignedToUserIds"], message: "En ansvarig får bara väljas en gång." });
  const ids = activity.assignments.map((assignment) => assignment.userId);
  if (new Set(ids).size !== ids.length)
    context.addIssue({ code: "custom", path: ["assignments"], message: "En ansvarig får bara ha en planeringsrad." });
  for (const [index, assignment] of activity.assignments.entries()) {
    if (Boolean(assignment.startsAt) !== Boolean(assignment.endsAt))
      context.addIssue({ code: "custom", path: ["assignments", index], message: "Individuell start och slut måste anges tillsammans." });
    if (assignment.startsAt && assignment.endsAt) {
      const minutes = Math.round((Date.parse(assignment.endsAt) - Date.parse(assignment.startsAt)) / 60_000);
      if (minutes <= 0 || Date.parse(assignment.startsAt) < Date.parse(activity.startsAt) || Date.parse(assignment.endsAt) > Date.parse(activity.endsAt))
        context.addIssue({ code: "custom", path: ["assignments", index], message: "Individuell tid måste ligga inom aktivitetens tidsintervall." });
      if (assignment.plannedMinutes !== null && assignment.plannedMinutes !== minutes)
        context.addIssue({ code: "custom", path: ["assignments", index], message: "Individuell planerad tid måste motsvara dess tidsintervall." });
    }
  }
});

/**
 * Old records have one responsible user. New records can have several internal
 * assignees; each is booked for the full activity interval.
 */
export function plannedActivityAssignments(activity: Pick<z.infer<typeof plannedActivityInputSchema>, "assignedToUserId" | "assignedToUserIds" | "assignments">) {
  const byUserId = new Map(activity.assignments.map((assignment) => [assignment.userId, assignment]));
  for (const userId of [...activity.assignedToUserIds, ...(activity.assignedToUserId ? [activity.assignedToUserId] : [])])
    if (!byUserId.has(userId)) byUserId.set(userId, { userId, plannedMinutes: null, startsAt: null, endsAt: null });
  return [...byUserId.values()];
}

export function plannedActivityAssigneeUserIds(activity: Pick<z.infer<typeof plannedActivityInputSchema>, "assignedToUserId" | "assignedToUserIds" | "assignments">) {
  return plannedActivityAssignments(activity).map((assignment) => assignment.userId);
}

export const plannedActivityEventSchema = z.object({
  id: z.string().uuid(),
  kind: z.enum(plannedActivityEventKinds),
  summary: z.string().min(1).max(500),
  snapshot: z.record(z.string(), z.unknown()).default({}),
  actorName: z.string().max(160).default(""),
  createdAt: timestamp,
});

export function plannedActivitySummary(
  kind: z.infer<typeof plannedActivityEventSchema>["kind"],
  title: string,
) {
  if (kind === "CREATED") return `Planeringen ${title} skapades`;
  if (kind === "DELETED") return `Planeringen ${title} togs bort`;
  return `Planeringen ${title} uppdaterades`;
}
