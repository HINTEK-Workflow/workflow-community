import { z } from "zod";

export const WORKFLOW_PERMISSION_SUBJECTS = ["projects", "kfid", "work-order", "risk-assessment", "forms", "form-builder", "customers", "catalogue", "staff-register", "quotes", "team", "economy", "maintenance", "invoicing", "boards", "screens"] as const;
export const WORKFLOW_PERMISSION_ACTIONS = ["read", "create", "edit", "complete", "reopen", "report", "archive", "publish"] as const;
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
  // Bygga formulär (2026-11-26: "admin kan styra vem som får göra det eftersom admin inte kan göra att åt alla i större
  // bolag"): build, change, import, publish and delete the company's forms in Skapa formulär, also with Workflow AI. One right of its
  // own, with nothing it depends on – filling in a form is still Formulär above. Admins and owners hold it by role; opt-in for
  // everyone else: in no preset but Full åtkomst. The one rule is mayBuildFormsWith below.
  "form-builder": ["edit"],
  // The customer register (2026-10-02, the simulation: "Läsa och rapportera" could still edit a customer):
  // governed by its own permission, not implied by a report-only preset. An admin's grant turns it on as usual.
  customers: ["read", "create", "edit", "archive"],
  // Artiklar och priser (2026-10-08, steg 1): read = see the catalogue and its latest prices; edit = import price
  // files, manage suppliers and delete an import. Picking an article on a work order's material row also works with
  // work-order:edit (lib/catalogue/access.ts), so existing profiles keep working.
  catalogue: ["read", "edit"],
  // Personalliggare (2026-10-09, steg 1): read = the Kontrollvy and the export, with identity numbers in full;
  // edit = register and correct others, and add people who are not members. Checking oneself in and out needs only
  // projects:read (lib/staff-register/model.ts), so no existing profile loses anything.
  "staff-register": ["read", "edit"],
  // Offerter (2026-10-09, steg B): read = see the company's quotes with purchase prices and markup, and take out
  // their PDF; edit = create, change, send, mark as accepted/declined/expired and make a new version. Read also lets the
  // person see prices on material rows (lib/workflow/material-prices.ts). Not in "Utföra arbete": a new right is opt-in.
  quotes: ["read", "edit"],
  // Dashboard (2026-10-28): two read rights of their own, so a person can see Teamet (the team's load, time,
  // project status and statistics) without Ekonomi or admin rights. Opening a tab never reads past the module rights:
  // the aggregates are still filtered per module, and amounts still need the price right (lib/workflow/material-prices.ts).
  // Opt-in: in no preset but Full åtkomst. A work view never grants either, nor does being a project's responsible person.
  team: ["read"],
  economy: ["read"],
  // Underhåll (2026-10-30): read = the menu item Underhåll – the machine tree, the store and the costs; edit = change
  // the tree, the store and the maintenance items. Cloud only. An item held by a work order is also read and filled in with
  // the work order's own rights (lib/maintenance/model.ts). Opt-in: in no preset but Full åtkomst.
  maintenance: ["read", "edit"],
  // Fakturera (owner's decision 2026-11-04): read = see the company's issued invoices; edit = issue and credit them, send them
  // and mark them paid. Viewing and creating invoice bases stays under Offerter. Admins and owners hold it by role; opt-in for
  // everyone else: in no preset but Full åtkomst. Without Workflow's commercial part it does nothing.
  invoicing: ["read", "edit"],
  // Tavlor (2026-11-18, frågorna 4–5): read = see the company's published boards in the app and present them; edit = make
  // and change boards and their own tables; publish = publish a board and share it with screens and links. Skärmar: read = see the
  // connected screens; edit = connect, change and block them. Opt-in: in no preset but Full åtkomst; admins hold them by role.
  boards: ["read", "edit", "publish"],
  screens: ["read", "edit"],
};

export const workflowPermissionDependencies: Record<WorkflowPermissionAction, readonly WorkflowPermissionAction[]> = {
  read: [],
  create: ["read"],
  edit: ["read"],
  complete: ["read", "edit"],
  reopen: ["read", "edit"],
  report: ["read"],
  archive: ["read", "edit"],
  publish: ["read", "edit"],
};

/** What a right needs within its own area: only the actions the area has (Bygga formulär is one right with nothing before it). */
const dependenciesOf = (subject: WorkflowPermissionSubject, action: WorkflowPermissionAction) =>
  workflowPermissionDependencies[action].filter((dependency) => workflowPermissionMatrix[subject].includes(dependency));

const allGrants =Object.entries(workflowPermissionMatrix).flatMap(([subject, actions]) =>
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
    for (const dependency of dependenciesOf(subject, action)) {
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
  { id: "full", label: "Full åtkomst", description: "Alla arbetsmoment, Teamet och Ekonomi.", profile: defaultWorkflowPermissionProfile() },
  { id: "field", label: "Utföra arbete", description: "Skapa, redigera, slutföra, återöppna och rapportera. Arkiverar bara projekt som personen ansvarar för.", profile: { version: 1 as const, grants: grantsFor({ projects: ["read", "create", "edit", "report"], kfid: ["read", "create", "edit", "complete", "report"], "work-order": ["read", "create", "edit", "complete", "reopen", "report"], "risk-assessment": ["read", "create", "edit", "complete", "reopen", "report"], forms: ["read", "create", "edit", "complete", "reopen", "report"], customers: ["read", "create", "edit"], catalogue: ["read"] }) } },
  { id: "report", label: "Läsa och rapportera", description: "Kan läsa och skapa rapporter men inte ändra verksamhetsdata.", profile: { version: 1 as const, grants: grantsFor({ projects: ["read", "report"], kfid: ["read", "report"], "work-order": ["read", "report"], "risk-assessment": ["read", "report"], forms: ["read", "report"], customers: ["read"] }) } },
  { id: "none", label: "Ingen åtkomst", description: "Inga projekt eller uppgifter visas förrän behörigheter läggs till.", profile: { version: 1 as const, grants: [] } },
] as const;

export function applyWorkflowPermissionToggle(profile: WorkflowPermissionProfile, subject: WorkflowPermissionSubject, action: WorkflowPermissionAction, enabled: boolean): WorkflowPermissionProfile {
  const grants = new Set(profile.grants);
  const grant = (candidate: WorkflowPermissionAction) => `${subject}:${candidate}` as WorkflowPermissionGrant;
  if (enabled) {
    grants.add(grant(action));
    for (const dependency of dependenciesOf(subject, action)) grants.add(grant(dependency));
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
/**
 * Driftronder are rounds of forms, so the server shows a round only to someone who may read its form's area
 * (lib/kfid/rounds-server.ts). The menu, Sök and the links to the page follow the same rule (webbplatskartan
 * 2026-10-24: a member with only Arbetsordrar saw Driftronder in the menu and got the permission box).
 */
export function canReadRounds(admin: boolean, permissions: WorkflowPermissionProfile) {
  return admin || FORM_PERMISSION_AREAS.some((area) => hasWorkflowPermission(permissions, area, "read"));
}

/** A task's permission subject; a protocol follows its form's area (a protocol without one is Formulär). */
export function workflowSubjectForTask(kind: string, formArea?: string | null): WorkflowPermissionSubject {
  if (kind === "WORK_ORDER") return "work-order";
  if (kind === "RISK_ASSESSMENT") return "risk-assessment";
  if (kind === "FORM") return formPermissionArea(formArea);
  return "kfid";
}

/**
 * Bygga formulär (2026-11-26): whether the person may build and change the company's forms in Skapa formulär and use
 * Formulär med Workflow AI – an admin or owner always, anyone else only with the right form-builder:edit, and only where the company
 * keeps its data on Workflow's server. The server's rule (mayBuildForms in lib/kfid/form-server.ts) and the menu, Sök, Ny uppgift
 * and Import all come through here, so no button is offered to someone the server refuses.
 */
export const mayBuildFormsWith = (input: { admin: boolean; workflowPermissions: WorkflowPermissionProfile; cloud: boolean }) =>
  input.cloud && (input.admin || hasWorkflowPermission(input.workflowPermissions, "form-builder", "edit"));

/** The task kinds and protocol areas a member may read, for list queries (see lib/workflow/task-access.ts). */
/** Teamet (2026-10-28): admins, or a member granted team:read. Never the work view or project responsibility. */
export const canViewTeam = (ctx: { admin: boolean; workflowPermissions: WorkflowPermissionProfile }) => ctx.admin || hasWorkflowPermission(ctx.workflowPermissions, "team", "read");
/** Ekonomi (2026-10-28): admins, or a member granted economy:read; amounts still need the price right. */
export const canViewEconomy = (ctx: { admin: boolean; workflowPermissions: WorkflowPermissionProfile }) => ctx.admin || hasWorkflowPermission(ctx.workflowPermissions, "economy", "read");

export function readableTaskScope(can: (subject: WorkflowPermissionSubject) => boolean) {
  const kinds = [...(can("work-order") ? ["WORK_ORDER" as const] : []), ...(can("risk-assessment") ? ["RISK_ASSESSMENT" as const] : [])];
  const areas = FORM_PERMISSION_AREAS.filter((area) => can(area));
  return { kinds, areas, any: kinds.length > 0 || areas.length > 0 };
}
