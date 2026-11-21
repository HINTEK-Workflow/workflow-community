import { hasWorkflowPermission, workflowSubjectForTask, type WorkflowPermissionProfile } from "./permissions";

/**
 * The work order a booking is on, with the project it belongs to (a booking's own project or its work order's). Arbetsordern
 * styr (2026-10-26): a booking is on a work order or a project – a task is booked through its work order.
 */
type BookingTask = { kind: string; formArea?: string | null; projectId: string | null };
type BookingRef = { projectId: string | null; workflowTask: BookingTask | null };

/** The project a booking belongs to: its own, else its job's. */
export const plannedActivityProjectId = (activity: BookingRef) => activity.projectId ?? activity.workflowTask?.projectId ?? null;

/**
 * Who may read a booking (2026-10-10, kartläggningen 5.11): a booking in a project needs the right to read projects
 * (and its work order, if any); a booking of a work order outside projects follows the work order's own read right – no
 * project right is asked for it; a booking with neither project nor work order is the project planning's and needs projects:read.
 */
export function canReadPlannedActivity(profile: WorkflowPermissionProfile, admin: boolean, activity: BookingRef) {
  if (admin) return true;
  const task = activity.workflowTask;
  const taskReadable = !task || hasWorkflowPermission(profile, workflowSubjectForTask(task.kind, task.formArea), "read");
  if (!task || plannedActivityProjectId(activity)) return taskReadable && hasWorkflowPermission(profile, "projects", "read");
  return taskReadable;
}

/**
 * Who may book (create, change or delete a booking), the same rule as reading: in a project the project right (create for
 * a new booking, edit for a change) and edit on its work order; a work order outside projects only edit on it. Returns the reason shown
 * to the person, or null. Whose bookings may be changed (others' only by admin, project responsible or stand-in) is a
 * separate rule (bookingChangeRefusal in bookings.ts).
 */
export function plannedActivityWriteRefusal(profile: WorkflowPermissionProfile, admin: boolean, activity: BookingRef, isNew: boolean) {
  if (admin) return null;
  const task = activity.workflowTask;
  if (task && !hasWorkflowPermission(profile, workflowSubjectForTask(task.kind, task.formArea), "edit"))
    return "Du saknar behörighet att ändra jobbet och kan därför inte boka det.";
  if (!task || plannedActivityProjectId(activity)) {
    if (!hasWorkflowPermission(profile, "projects", isNew ? "create" : "edit"))
      return task ? "Jobbet hör till ett projekt, och du saknar behörighet att planera i projekt." : "Du saknar behörighet att planera i projekt. Välj en arbetsorder utan projekt som du får ändra.";
  }
  return null;
}

/**
 * Whether Boka is offered on a work order (2026-11-02), on the work order's page and Teamet alike: the rule of the server when it
 * saves, and for a job in a project also what the form needs to hold that project: the Projekt module on and the right to read projects.
 * Att boka leaves the same jobs out (workToBookScope).
 */
export function canBookJob(profile: WorkflowPermissionProfile, admin: boolean, projectId: string | null, projectsOn: boolean) {
  if (projectId && (!projectsOn || !(admin || hasWorkflowPermission(profile, "projects", "read")))) return false;
  return plannedActivityWriteRefusal(profile, admin, { projectId: null, workflowTask: { kind: "WORK_ORDER", formArea: null, projectId } }, true) === null;
}

/**
 * Whose work orders the list Att boka reads (2026-11-02), the same rule as booking them: without read and edit on work orders
 * nothing, and in a project also the project rights. Admin and the Teamet right see every such job; everyone else their own (`everyone`
 * false: responsible, or nobody responsible and created by them) and the jobs of projects where they are responsible or stand-in.
 */
export function workToBookScope(profile: WorkflowPermissionProfile, admin: boolean, team: boolean) {
  const may = (subject: "work-order" | "projects", action: "read" | "edit" | "create") => admin || hasWorkflowPermission(profile, subject, action);
  const any = may("work-order", "read") && may("work-order", "edit");
  return { any, inProjects: any && may("projects", "read") && may("projects", "create"), everyone: admin || team };
}

/** Whether the person may book anything at all: in projects, or a work order outside projects that they may edit. */
export function canBookAnything(profile: WorkflowPermissionProfile, admin: boolean) {
  return admin || hasWorkflowPermission(profile, "projects", "create")
    || (["kfid", "work-order", "risk-assessment", "forms"] as const).some((subject) => hasWorkflowPermission(profile, subject, "edit"));
}
