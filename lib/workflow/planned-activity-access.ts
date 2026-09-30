import { hasWorkflowPermission, workflowSubjectForTask, type WorkflowPermissionProfile } from "./permissions";

export function canReadPlannedActivity(
  profile: WorkflowPermissionProfile,
  admin: boolean,
  activity: { workflowTask: { kind: string; formArea?: string | null } | null; controlId: string | null },
) {
  if (admin) return true;
  if (!hasWorkflowPermission(profile, "projects", "read")) return false;
  if (activity.workflowTask && !hasWorkflowPermission(profile, workflowSubjectForTask(activity.workflowTask.kind, activity.workflowTask.formArea), "read")) return false;
  return !activity.controlId || hasWorkflowPermission(profile, "kfid", "read");
}
