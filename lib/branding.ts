import { DEFAULT_INSTANCE_NAME, publicInstance, type PublicInstance } from "@/lib/instance";

/** The default product name; the running installation's name is publicInstance().name / useInstance().name. */
export const WORKFLOW_NAME = DEFAULT_INSTANCE_NAME;
export const WORKFLOW_BRANDING_EVENT = "hintek:workflow-branding";

export type OrganizationIdentity = {
  name: string;
  slug?: string | null;
  domain?: string | null;
};

export type ShellBranding = {
  companyName: string;
  isHintek: boolean;
  logoUrl: string | null;
};

type Operator = Pick<PublicInstance, "operator" | "operatorDomains" | "operatorSlugs">;

/** What the slug of a company made through registration, an invitation or Förbered företag starts with. */
const GENERATED_COMPANY_SLUG = "company-";

/**
 * The installation's own organization (Workflow on app.example.com; Fas 1: from the instance settings). On the server
 * the settings come from the environment; client components pass the instance from useInstance().
 */
export function isHintekOrganization(organization: OrganizationIdentity, operator: Operator = publicInstance()) {
  const domain = organization.domain?.trim().toLowerCase();
  const slug = organization.slug?.trim().toLowerCase();
  // Domain and slug are the identity: no customer can choose them (a company gets the slug company-<random>, and the domain
  // is never written from a form), while the name is the customer's own text, so "<operator> Bygg AB" is a customer.
  if (operator.operatorDomains.some((own) => domain === own || domain?.endsWith(`.${own}`) === true)) return true;
  if (operator.operatorSlugs.some((own) => slug === own || slug?.startsWith(`${own}-`) === true)) return true;
  // The fallback, for an own company whose seed slug was changed: the exact operator name, and never a registered company.
  return !slug?.startsWith(GENERATED_COMPANY_SLUG) && organization.name.trim().toLowerCase() === operator.operator.trim().toLowerCase();
}

export function shellBranding(
  organization?: OrganizationIdentity | null,
  logoPath?: string | null,
  operator: Operator = publicInstance(),
): ShellBranding {
  if (!organization)
    return { companyName: operator.operator, isHintek: true, logoUrl: null };
  const isHintek = isHintekOrganization(organization, operator);
  return {
    companyName: organization.name,
    isHintek,
    logoUrl:
      !isHintek && logoPath
        ? `/api/files/logo?v=${encodeURIComponent(logoPath)}`
        : null,
  };
}
