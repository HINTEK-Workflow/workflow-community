import { z } from "zod";

export const WORKFLOW_PERMISSION_SUBJECTS = ["projects", "kfid", "work-order", "risk-assessment", "forms", "customers"] as const;
export const WORKFLOW_PERMISSION_ACTIONS = ["read", "create", "edit", "complete", "reopen", "report", "archive"] as const;
export type WorkflowPermissionSubject = (typeof WORKFLOW_PERMISSION_SUBJECTS)[number];
export type WorkflowPermissionAction = (typeof WORKFLOW_PERMISSION_ACTIONS)[number];
export type WorkflowPermissionGrant = `${WorkflowPermissionSubject}:${WorkflowPermissionAction}`;

export const workflowPermissionMatrix: Record<WorkflowPermissionSubject, readonly WorkflowPermissionAction[]> = {
  projects: ["read", "create", "edit", "report", "archive"],
  kfid: ["read", "create", "edit", "complete", "report"],
  "work-order": ["read", "create", "edit", "complete", "reopen", "report"],
  "risk-assessment": ["read", "create", "edit", "complete", "reopen", "report"],
  // Protocols from published forms (2026-09-26): the same actions as work orders.
  forms: ["read", "create", "edit", "complete", "reopen", "report"],
  // The customer register (2026-10-02, the simulation: "Läsa och rapportera" could still edit a customer):
  // governed by its own permission, not implied by a report-only preset. An admin's grant turns it on as usual.
  customers: ["read", "create", "edit", "archive"],
};

export const workflowPermissionDependencies: Record<WorkflowPermissionAction, readonly WorkflowPermissionAction[]> = {
  read: [],
  create: ["read"],
  edit: ["read"],
  complete: ["read", "edit"],
  reopen: ["read", "edit"],
  report: ["read"],
  archive: ["read", "edit"],
};

const allGrants = Object.entries(workflowPermissionMatrix).flatMap(([subject, actions]) =>
  actions.map((action) => `${subject}:${action}` as WorkflowPermissionGrant),
);
const grantSchema = z.enum(allGrants as [WorkflowPermissionGrant, ...WorkflowPermissionGrant[]]);
export const workflowPermissionProfileSchema = z.object({
  version: z.literal(1),
  grants: z.array(grantSchema).max(allGrants.length).transform((items) => [...new Set(items)]),
}).superRefine((profile, context) => {
  const grants = new Set(profile.grants);
  for (const grant of profile.grants) {
    const [subject, action] = grant.split(":") as [WorkflowPermissionSubject, WorkflowPermissionAction];
    for (const dependency of workflowPermissionDependencies[action]) {
      if (!grants.has(`${subject}:${dependency}`)) context.addIssue({ code: "custom", path: ["grants"], message: `${grant} kräver ${subject}:${dependency}.` });
    }
  }
});
export type WorkflowPermissionProfile = z.infer<typeof workflowPermissionProfileSchema>;

/** Everything; used for company admins/owners and the Local file owner, never as an employee's default. */
export const defaultWorkflowPermissionProfile = (): WorkflowPermissionProfile => ({ version: 1, grants: [...allGrants] });
/**
 * An employee may only do what a company admin has granted (2026-09-27): a new invitation starts with no
 * access, and a member without a saved profile has none. Admins and owners are unaffected (full access by role).
 */
export const noWorkflowPermissionProfile = (): WorkflowPermissionProfile => ({ version: 1, grants: [] });

function grantsFor(selection: Partial<Record<WorkflowPermissionSubject, readonly WorkflowPermissionAction[]>>) {
  return WORKFLOW_PERMISSION_SUBJECTS.flatMap((subject) => (selection[subject] ?? []).map((action) => `${subject}:${action}` as WorkflowPermissionGrant));
}

export const workflowPermissionPresets = [
  { id: "full", label: "Full åtkomst", description: "Alla arbetsmoment i projekt och aktiva uppgiftstyper.", profile: defaultWorkflowPermissionProfile() },
  { id: "field", label: "Utföra arbete", description: "Skapa, redigera, slutföra, återöppna och rapportera; kan inte arkivera projekt.", profile: { version: 1 as const, grants: grantsFor({ projects: ["read", "create", "edit", "report"], kfid: ["read", "create", "edit", "complete", "report"], "work-order": ["read", "create", "edit", "complete", "reopen", "report"], "risk-assessment": ["read", "create", "edit", "complete", "reopen", "report"], forms: ["read", "create", "edit", "complete", "reopen", "report"], customers: ["read", "create", "edit"] }) } },
  { id: "report", label: "Läsa och rapportera", description: "Kan läsa och skapa rapporter men inte ändra verksamhetsdata.", profile: { version: 1 as const, grants: grantsFor({ projects: ["read", "report"], kfid: ["read", "report"], "work-order": ["read", "report"], "risk-assessment": ["read", "report"], forms: ["read", "report"], customers: ["read"] }) } },
  { id: "none", label: "Ingen åtkomst", description: "Inga projekt eller uppgifter visas förrän rättigheter läggs till.", profile: { version: 1 as const, grants: [] } },
] as const;

export function applyWorkflowPermissionToggle(profile: WorkflowPermissionProfile, subject: WorkflowPermissionSubject, action: WorkflowPermissionAction, enabled: boolean): WorkflowPermissionProfile {
  const grants = new Set(profile.grants);
  const grant = (candidate: WorkflowPermissionAction) => `${subject}:${candidate}` as WorkflowPermissionGrant;
  if (enabled) {
    grants.add(grant(action));
    for (const dependency of workflowPermissionDependencies[action]) grants.add(grant(dependency));
  } else {
    grants.delete(grant(action));
    for (const candidate of workflowPermissionMatrix[subject]) {
      if (workflowPermissionDependencies[candidate].includes(action)) grants.delete(grant(candidate));
    }
  }
  return workflowPermissionProfileSchema.parse({ version: 1, grants: [...grants] });
}

export function normalizeWorkflowPermissionProfile(value: unknown): WorkflowPermissionProfile {
  if (value === null || value === undefined) return noWorkflowPermissionProfile();
  const parsed = workflowPermissionProfileSchema.safeParse(value);
  return parsed.success ? parsed.data : { version: 1, grants: [] };
}

export function hasWorkflowPermission(profile: WorkflowPermissionProfile, subject: WorkflowPermissionSubject, action: WorkflowPermissionAction) {
  return workflowPermissionMatrix[subject].includes(action) && profile.grants.includes(`${subject}:${action}`);
}

/**
 * The permission areas a form's protocols can belong to (2026-09-27, decision B): Kontroll före idrifttagning and
 * Riskbedömning built as forms keep the areas they have always had; every other form is Formulär.
 */
export const FORM_PERMISSION_AREAS = ["forms", "kfid", "risk-assessment"] as const;
export type FormPermissionArea = (typeof FORM_PERMISSION_AREAS)[number];
export const formPermissionArea = (value: unknown): FormPermissionArea => FORM_PERMISSION_AREAS.includes(value as FormPermissionArea) ? value as FormPermissionArea : "forms";

/** A task's permission subject; a protocol follows its form's area (a protocol without one is Formulär). */
export function workflowSubjectForTask(kind: string, formArea?: string | null): WorkflowPermissionSubject {
  if (kind === "WORK_ORDER") return "work-order";
  if (kind === "RISK_ASSESSMENT") return "risk-assessment";
  if (kind === "FORM") return formPermissionArea(formArea);
  return "kfid";
}

/** The task kinds and protocol areas a member may read, for list queries (see lib/workflow/task-access.ts). */
export function readableTaskScope(can: (subject: WorkflowPermissionSubject) => boolean) {
  const kinds = [...(can("work-order") ? ["WORK_ORDER" as const] : []), ...(can("risk-assessment") ? ["RISK_ASSESSMENT" as const] : [])];
  const areas = FORM_PERMISSION_AREAS.filter((area) => can(area));
  return { kinds, areas, any: kinds.length > 0 || areas.length > 0 };
}
