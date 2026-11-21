
/**
 * Workflow's global forms and each company's own (2026-10-06): a form with organizationId NULL is Workflow's and is
 * shown to every company; any other form belongs to exactly one company. These helpers have no database access, so the
 * rules can be tested on their own.
 */

/** The forms a company may read: Workflow's and its own – never another company's. */
export const visibleFormsWhere = (organizationId: string) => ({ OR: [{ organizationId: null }, { organizationId }] });

/** A stored form version, read only when its form is Workflow's or the company's own. */
export const visibleFormVersionWhere = (organizationId: string, templateId: string, version: number) =>
  ({ templateId, version, template: visibleFormsWhere(organizationId) });

/** Whether a template row may be read by the company. */
export const formVisibleTo = (organizationId: string, template: { organizationId: string | null }) =>
  template.organizationId === null || template.organizationId === organizationId;

type PromoteCandidate = { organizationId: string | null; status: string; publishedVersion: number | null; baseTemplateId: string | null; importedFrom: unknown };

/**
 * "Publicera som Workflow-original": why a form in Workflow's own organization may not become global, or null when it may.
 * Only a published form made by Workflow itself: never a form imported from another company (or copied from one, since a
 * copy keeps where it came from), never an unverified file, and never Workflow's own version of an existing original.
 */
export function promoteBlock(template: PromoteCandidate, organization: { id: string }): string | null {
  if (template.organizationId === null) return "Formuläret är redan ett Workflow-original.";
  if (template.organizationId !== organization.id) return "Formuläret hittades inte.";
  if (template.status !== "PUBLISHED" || !template.publishedVersion) return "Publicera formuläret i ert företag först.";
  if (template.baseTemplateId) return "Det här är en version av ett befintligt Workflow-original. Ändra originalet under Workflow-original i stället.";
  // An imported form never becomes a Workflow original (2026-10-06): a name can be copied, so no exception by name.
  if (template.importedFrom === null || template.importedFrom === undefined) return null;
  return "Formuläret är importerat från en fil och kan inte bli ett Workflow-original. Bygg det i Workflows egen organisation.";
}
