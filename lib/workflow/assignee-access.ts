import { hasWorkflowPermission, normalizeWorkflowPermissionProfile, type WorkflowPermissionSubject } from "./permissions";

/**
 * Who can be made responsible for a job (simulation 2026-10-10, surfplatta fynd 3: a protocol was given to a person who
 * may not read protocols – no notice, and the person never saw the job). Only a member who may read the job's type: an
 * owner or administrator always, everyone else by the read permission of the job's area (work order, risk assessment,
 * Formulär, Kontroll före idrifttagning). The Ansvarig list shows only them; the server refuses anyone else.
 */
export type AssigneeCandidate = { role: string; workflowPermissions: unknown };

export function memberMayReadJob(member: AssigneeCandidate, subject: WorkflowPermissionSubject) {
  if (member.role === "OWNER" || member.role === "ADMIN") return true;
  return hasWorkflowPermission(normalizeWorkflowPermissionProfile(member.workflowPermissions), subject, "read");
}

/** The job's type in words, for the refusal ("… får inte läsa arbetsordrar"). */
const SUBJECT_WORDS: Partial<Record<WorkflowPermissionSubject, string>> = {
  "work-order": "arbetsordrar",
  "risk-assessment": "riskbedömningar",
  forms: "formulärets protokoll",
  kfid: "Kontroll före idrifttagning",
};

/** The refusal when the chosen person may not read the job, with what to do about it. */
export function assigneeReadRefusal(name: string, subject: WorkflowPermissionSubject) {
  const who = name.trim() || "Personen";
  return `${who} får inte läsa ${SUBJECT_WORDS[subject] ?? "den här typen av jobb"} och kan därför inte vara ansvarig. Välj någon annan, eller ge ${name.trim() ? "personen" : "den"} rätt att läsa under Användare.`;
}
