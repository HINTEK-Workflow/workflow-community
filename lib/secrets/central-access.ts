import { requireFreshAuth } from "@/lib/auth/fresh-auth";
import { seesServerKeys } from "@/lib/integrations/server-keys-access";
import { ApiError } from "@/lib/kfid/errors";
import type { CentralActor } from "@/lib/secrets/central-store";

/**
 * Samma regel för alla centrala nycklar (2026-10-25, utredningens M1): Workflow's own keys – Stripe, Google, Solar,
 * OpenAI, Azure, SMTP, Microsoft, SCB, Lantmäteriet, webbpush – are seen only by a superadmin in Workflow's own
 * organization, and changed only after a password or code within ten minutes (the shared reauth dialog asks and the
 * change is tried again). A company admin, or a superadmin acting in a customer company, is refused.
 */
type Ctx = Parameters<typeof seesServerKeys>[0] & {
  user: { id: string; role: string; email: string; name?: string | null };
  organizationId: string;
  auth: Parameters<typeof requireFreshAuth>[1];
};

export function requireCentralKeyViewer(ctx: Ctx) {
  if (!seesServerKeys(ctx)) throw new ApiError(403, "De centrala nycklarna visas bara för installationens superadmin.");
}

/** For every change of a central key or of where it is sent (an SMTP server, an AI address): returns the actor. */
export async function requireCentralKeyChange(ctx: Ctx): Promise<CentralActor> {
  requireCentralKeyViewer(ctx);
  await requireFreshAuth(ctx.user.id, ctx.auth);
  return { userId: ctx.user.id, organizationId: ctx.organizationId, label: (ctx.user.name || ctx.user.email).slice(0, 200) };
}

/** The actor for a save that changes no key (the map's layer or cache limit): no fresh sign-in needed. */
export function centralActor(ctx: Pick<Ctx, "user" | "organizationId">): CentralActor {
  return { userId: ctx.user.id, organizationId: ctx.organizationId, label: (ctx.user.name || ctx.user.email).slice(0, 200) };
}
