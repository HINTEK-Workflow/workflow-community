import { NextResponse } from "next/server";
import { ZodError } from "zod";
// Swedish zod texts for every route (A1, review 2026-10-20); installed when this module loads.
import { issueText } from "@/lib/validation/zod-swedish";
import { prisma } from "@/lib/db";
import { getCurrentAuth } from "@/lib/auth/session";
import { TWO_FACTOR_SETUP_REQUIRED, twoFactorRequiredCached } from "@/lib/auth/two-factor";
import { strongSignInMethod } from "@/lib/auth/session-rules";
import { authUserSelect } from "@/lib/auth/service";
import { canAccessTest, localRoleQaEnabled } from "@/lib/auth/access";
import { currentPrincipal } from "@/lib/integrations/principal";
import { isTestEmail } from "@/lib/auth/access";
import { env } from "@/lib/env";
import { ApiError, ReauthRequired } from "@/lib/kfid/errors";
import { errorLogRecord, errorRef } from "@/lib/kfid/error-log";
import { assertRequiredLegalAccess } from "@/lib/legal";
import { serverExtensions } from "@/lib/extensions/server";
import { hasWorkflowPermission, normalizeWorkflowPermissionProfile, type WorkflowPermissionAction, type WorkflowPermissionSubject } from "@/lib/workflow/permissions";
import { readLimitedText } from "@/lib/security/limited-body";
import { recordUsage } from "@/lib/analytics/record";
import { notCounted, type CountingSubject } from "@/lib/analytics/exclusion";
import { isHintekOrganization } from "@/lib/branding";
import { ADDRESS_HEADER } from "@/lib/workflow/first-frame";
import { allowedOrigins, publicSite } from "@/lib/public-site";
import { headers } from "next/headers";
import { isErasedCompany, NO_ACTIVE_COMPANY_TEXT, PAUSED_COMPANY_TEXT, pausedCompanyRefusal, REQUEST_METHOD_HEADER } from "@/lib/kfid/paused-company";
import { moduleOffText, moduleTitle, organizationModuleOn, type ModuleKey } from "@/lib/workflow/modules";
import { superadminSeesAll, viewAsFromCookieHeader, type ViewAs } from "@/lib/workflow/view-as";

export { ApiError } from "@/lib/kfid/errors";

/** Whether this sign-in must set up two-step verification before it may do anything (see context). */
async function twoFactorBlocks(signedIn: NonNullable<Awaited<ReturnType<typeof getCurrentAuth>>>) {
  // The synthetic QA superadmin on loopback (app/api/qa/session) keeps working although a superadmin always needs two-factor now.
  if (signedIn.method === "qa" && signedIn.user.role === "SUPERADMIN" && localRoleQaEnabled()) return false;
  return !signedIn.user.totpEnabledAt && !strongSignInMethod(signedIn.method) && (await twoFactorRequiredCached(signedIn.user));
}

/**
 * The signed-in person for routes that do not work in a company (the superadmin's installation settings, 2026-10-13):
 * the same two-step rule as context(), so "Tvåstegsverifiering krävs för superadmin" cannot be passed by a route that
 * reads the session itself. Null when nobody is signed in.
 */
export async function signedInAuth() {
  const signedIn = await getCurrentAuth();
  if (!signedIn?.user) return null;
  if (await twoFactorBlocks(signedIn)) throw new ApiError(403, TWO_FACTOR_SETUP_REQUIRED);
  return signedIn;
}
export const signedInUser = async () => (await signedInAuth())?.user ?? null;
/**
 * The signed-in person and their active company – or, inside an API/MCP call (2026-09-30), the member the verified
 * key acts for and the key's company. Everything after this (membership, permissions, legal gate, write access) is the
 * same for both, so an external client can never do more than the person could in Workflow.
 */
/** The preview mode of this request; a request whose cookies cannot be read counts as previewing, so the superadmin's override stays off. */
const requestViewAs = (): Promise<ViewAs | null> => headers().then((list) => viewAsFromCookieHeader(list.get("cookie"))).catch((): ViewAs => "owner");

/** The requests already counted as a used function, so a route that asks for its context twice counts once. */
const countedRequests = new WeakSet<object>();
/**
 * Beteendeanalys (2026-10-07; moved here from checkOrigin 2026-11-16, so the person is known): a changing request is
 * counted as the function its address belongs to – an anonymous counter in memory – unless the person is the installation's
 * own (a superadmin or a member of its own company) or the browser was switched off by the owner (lib/analytics/exclusion.ts).
 */
function countUsage(list: { get(name: string): string | null } | null, who: CountingSubject) {
  if (!list || countedRequests.has(list)) return;
  countedRequests.add(list);
  const method = list.get(REQUEST_METHOD_HEADER);
  const address = list.get(ADDRESS_HEADER);
  if (!method || !address) return;
  if (!notCounted(who)) recordUsage(method, address.split("?")[0]);
}

export async function context(options: { skipLegal?: boolean; allowedWhenPaused?: boolean } = {}) {
  const principal = currentPrincipal();
  const signedIn = principal ? null : await getCurrentAuth();
  const user = principal
    ? await prisma.user.findUnique({ where: { id: principal.actingUserId }, select: authUserSelect }).then((found) => (canAccessTest(found) ? found : null))
    : signedIn?.user ?? null;
  if (!user) throw new ApiError(401, principal ? "Nyckelns användare har inte åtkomst." : "Logga in för att fortsätta.");
  // Tvåstegsverifiering krävs (2026-10-10): a password sign-in without TOTP stops here until the person turns it on
  // under Mina inställningar → Säkerhet (/api/security does not go through context). Google and Microsoft count as
  // the provider's own; a passkey (with fingerprint, face or PIN) is two steps in itself (2026-10-11).
  if (signedIn && (await twoFactorBlocks(signedIn))) throw new ApiError(403, TWO_FACTOR_SETUP_REQUIRED);
  const activeOrganizationId = principal ? principal.organizationId : user.activeOrganizationId;
  if (!activeOrganizationId)
    throw new ApiError(
      403,
      "Välj ett aktivt företag innan du öppnar arbetsytan.",
    );
  const membership = await prisma.organizationMember.findUnique({
    where: {
      organizationId_userId: {
        organizationId: activeOrganizationId,
        userId: user.id,
      },
    },
    include: { organization: true },
  });
  if (!membership?.isActive) throw new ApiError(403, NO_ACTIVE_COMPANY_TEXT);
  // Pausat företag (beslut 11, 2026-11-01): read mode, not a lockout. lib/kfid/paused-company.ts holds the rule.
  if (!membership.organization.isActive) {
    const refusal = pausedCompanyRefusal({
      method: await headers().then((list) => list.get(REQUEST_METHOD_HEADER)).catch(() => null),
      integration: Boolean(principal), erased: isErasedCompany(membership.organization), allowedWhenPaused: options.allowedWhenPaused === true,
    });
    if (refusal) throw new ApiError(refusal.status, refusal.message);
  }
  const organizationId = membership.organizationId;
  const requestHeaders = principal ? null : await Promise.resolve().then(() => headers()).catch(() => null);
  // Who is never counted in Beteendeanalys (2026-11-16): the installation's own people and a browser switched off by the owner.
  const analytics: CountingSubject = { cookie: requestHeaders?.get("cookie") ?? null, superadmin: user.role === "SUPERADMIN", ownCompany: isHintekOrganization(membership.organization) };
  countUsage(requestHeaders, analytics);
  // Read only (2026-10-08): a status or list read must not create credit data. `wallet` is null until an explicit
  // credit action creates it with ensureCreditWallet() (lib/credits/ensure-wallet.ts); reads show a zero balance.
  const wallet = await prisma.creditWallet.findUnique({ where: { organizationId } });
  const result = {
    user,
    organizationId,
    wallet,
    organization: membership.organization,
    canDeleteControls:
      membership.canDeleteControls ||
      membership.role === "OWNER" ||
      membership.role === "ADMIN",
    admin: membership.role === "OWNER" || membership.role === "ADMIN",
    memberRole: membership.role,
    workflowPermissions: normalizeWorkflowPermissionProfile(membership.workflowPermissions),
    testAdmin: isTestEmail(user.email) && user.role === "SUPERADMIN",
    seesAll: user.role === "SUPERADMIN" && !principal && superadminSeesAll({ role: user.role, memberRole: membership.role, viewAs: await requestViewAs() }),
    /** Set inside an API/MCP call: which key, for what. */
    integration: principal,
    /** Beteendeanalys: who this request is, for the counters that skip the installation's own people (lib/analytics/exclusion.ts). */
    analytics,
    /** This sign-in (null inside an API/MCP call): for "färsk inloggning" before sensitive changes. */
    auth: signedIn ? { sessionId: signedIn.sessionId, authAt: signedIn.authAt, method: signedIn.method } : null,
  };
  if (!options.skipLegal) await assertRequiredLegalAccess(result);
  return result;
}
export type Context = Awaited<ReturnType<typeof context>>;
/**
 * Every mutation must come from the app's own pages (APP_URL, or NEXTAUTH_URL). `publicSite` lets one route – the
 * anonymous beacon – also accept the separate public site's pages, and only on a request to that host
 * (lib/public-site.ts, 2026-10-15). Never "any origin".
 */
export function checkOrigin(request: Request, options: { publicSite?: boolean } = {}) {
  const origin = request.headers.get("origin");
  const allowed = allowedOrigins({
    appUrl: env.APP_URL,
    nextAuthUrl: process.env.NEXTAUTH_URL,
    site: options.publicSite ? publicSite() : null,
    host: request.headers.get("host"),
    publicSite: options.publicSite,
  });
  if (!origin || !allowed.includes(origin))
    throw new ApiError(403, "Otillåten begäran.");
  // Beteendeanalys: a used function is counted in context(), where the person is known (2026-11-16).
}
export async function body(request: Request) {
  // Read with a ceiling, so an oversized or endless body stops at 2 MB instead of filling memory (2026-10-04).
  const text = await readLimitedText(request, 2_000_000);
  try {
    return JSON.parse(text);
  } catch {
    throw new ApiError(400, "Ogiltig JSON.");
  }
}
export function failure(error: unknown) {
  if (error instanceof ApiError)
    return NextResponse.json(
      // reauth: the client asks the person to confirm with password or code and repeats the request (2026-10-10).
      { error: error.message, ...(error instanceof ReauthRequired ? { reauth: true } : {}) },
      { status: error.status },
    );
  if (error instanceof ZodError)
    return NextResponse.json(
      { error: issueText(error.issues[0]) },
      { status: 400 },
    );
  // A reference, the error's name and code and one cleaned line of its message (lib/kfid/error-log.ts), so a 500 can
  // be traced to its cause; the person gets the same reference.
  const ref = errorRef();
  console.error("KFID request failed", JSON.stringify(errorLogRecord(error, ref)));
  return NextResponse.json(
    { error: "Åtgärden kunde inte slutföras. Försök igen.", ref },
    { status: 500 },
  );
}
/**
 * A report opened in a tab of its own (Förhandsgranska, a form post or a link) never shows raw JSON to a person
 * (2026-10-10): when the browser navigates to the route, the error is a short readable page in Swedish; a fetch
 * from the page still gets the JSON error it shows itself.
 */
export async function failureFor(request: Request, error: unknown) {
  const response = failure(error);
  if (request.headers.get("sec-fetch-dest") !== "document") return response;
  const { error: message = "Rapporten kunde inte skapas." } = (await response.clone().json().catch(() => ({}))) as { error?: string };
  const text = message.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
  return new Response(`<!doctype html><html lang="sv"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Rapporten kunde inte öppnas</title><style>body{margin:0;font:16px/1.5 system-ui,sans-serif;background:#f4f7fb;color:#1c2b3a}main{max-width:32rem;margin:15vh auto;padding:1.5rem;background:#fff;border:1px solid #d8e1ec;border-radius:.75rem}h1{margin:0 0 .5rem;font-size:1.25rem}p{margin:.5rem 0;color:#4a5b6d}</style></head><body><main><h1>Rapporten kunde inte öppnas</h1><p>${text}</p><p>Stäng fliken och försök igen från Workflow.</p></main></body></html>`,
    { status: response.status, headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" } });
}
export function requireAdmin(ctx: Context) {
  if (!ctx.admin) throw new ApiError(403, "Bara en företagsadministratör kan göra det.");
}

export function requireCloudStorage(ctx: Context) {
  if (ctx.organization.storageMode !== "HINTEK_CLOUD")
    throw new ApiError(
      409,
      "Företaget använder lokal lagring. Kund- och kontrolldata får därför inte sparas på servern.",
    );
}

/**
 * For a route that lets a paused company in with allowedWhenPaused because some of its actions are reads by POST: the actions
 * that change something call this first. Only a company marked paused stops here; context() has already decided the rest.
 */
export function requireNotPaused(ctx: { organization: { isActive?: boolean } }) {
  if (ctx.organization.isActive === false) throw new ApiError(423, PAUSED_COMPANY_TEXT);
}

export async function requireCloudWriteAccess(ctx: Context, now = new Date()) {
  requireNotPaused(ctx);
  if (ctx.organization.storageMode !== "HINTEK_CLOUD") return;
  const access = await serverExtensions.cloudWriteAccess(ctx.organizationId, now);
  if (access.allowed) return access;
  throw new ApiError(
    423,
    access.reason === "PAYMENT_OVERDUE"
      ? "Cloud-skrivning är pausad på grund av förfallen betalning. Läsning, export, personalliggaren och lokal funktion fungerar fortfarande."
      : "Organisationen saknar en giltig Cloud-rättighet för att skriva data. Läsning och export fungerar fortfarande, även personalliggarens kontrollvy.",
  );
}

/**
 * Företagets moduler (0.39.0): a new action in a module the company has turned off is refused here, the same for admin, API, MCP and
 * AI, because they all come through the route. Reads stay open, so the history can be read and exported. No extra query: context()
 * has read the company's row. lib/workflow/modules.ts holds the rule, and tests/modules-guard.test.ts that no route forgets it.
 */
export function requireModule(ctx: { organization: { disabledModules?: readonly string[] | null }; seesAll?: boolean; organizationId?: string; user?: { id: string } }, key: ModuleKey) {
  if (organizationModuleOn(ctx.organization, key)) return;
  if (!ctx.seesAll || !ctx.organizationId || !ctx.user) throw new ApiError(409, moduleOffText(key));
  // The superadmin's override (lib/workflow/view-as.ts): what would have been refused goes through, with a line in the log. A log that fails stops nothing.
  void prisma.administrationEvent.create({ data: { organizationId: ctx.organizationId, actorId: ctx.user.id, action: "superadmin_module_override", detail: `Superadmin gjorde en ändring i ${moduleTitle(key)}, som är avstängt i företaget.` } }).catch(() => undefined);
}

export function requireControlDelete(ctx: Context) {
  if (!ctx.canDeleteControls)
    throw new ApiError(403, "Du saknar behörighet att radera kontroller.");
}

export function requireWorkflowPermission(ctx: Context, subject: WorkflowPermissionSubject, action: WorkflowPermissionAction) {
  if (ctx.admin || hasWorkflowPermission(ctx.workflowPermissions, subject, action)) return;
  throw new ApiError(403, `Du saknar behörighet att ${action === "read" ? "visa" : action === "create" ? "skapa" : action === "edit" ? "redigera" : action === "complete" ? "slutföra" : action === "reopen" ? "återöppna" : action === "report" ? "exportera" : action === "publish" ? "publicera" : "arkivera"} den här delen av Workflow.`);
}
