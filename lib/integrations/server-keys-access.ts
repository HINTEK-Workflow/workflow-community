import { isHintekOrganization } from "@/lib/branding";
import { QA_ROLE_EMAILS, localRoleQaEnabled } from "@/lib/auth/access";

type Viewer = {
  user: { role: string; email: string };
  organization: Parameters<typeof isHintekOrganization>[0];
  testAdmin: boolean;
};

/**
 * Serverns nycklar: seen, checked, entered and removed only by a superadmin in Workflow's own organization (or the
 * synthetic QA superadmin on loopback QA). A company admin or a superadmin acting in a customer company is refused.
 */
export const seesServerKeys = (ctx: Viewer) =>
  ctx.user.role === "SUPERADMIN" && (isHintekOrganization(ctx.organization) || ctx.testAdmin || (localRoleQaEnabled() && ctx.user.email === QA_ROLE_EMAILS.superadmin));
