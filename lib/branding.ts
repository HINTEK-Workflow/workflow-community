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

/**
 * The installation's own organization (HINTEK on workflow.hintek.se; Fas 1: from the instance settings). On the server
 * the settings come from the environment; client components pass the instance from useInstance().
 */
export function isHintekOrganization(organization: OrganizationIdentity, operator: Operator = publicInstance()) {
  const domain = organization.domain?.trim().toLowerCase();
  const slug = organization.slug?.trim().toLowerCase();
  const name = organization.name.trim().toLowerCase();
  const operatorName = operator.operator.trim().toLowerCase();
  return (
    operator.operatorDomains.some((own) => domain === own || domain?.endsWith(`.${own}`) === true) ||
    operator.operatorSlugs.some((own) => slug === own || slug?.startsWith(`${own}-`) === true) ||
    name === operatorName ||
    name.startsWith(`${operatorName} `)
  );
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
