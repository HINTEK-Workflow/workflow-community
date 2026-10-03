import { NextResponse } from "next/server";
import { ZodError } from "zod";
import { prisma } from "@/lib/db";
import { getCurrentUser } from "@/lib/auth/session";
import { authUserSelect } from "@/lib/auth/service";
import { canAccessTest } from "@/lib/auth/access";
import { currentPrincipal } from "@/lib/integrations/principal";
import { isTestEmail } from "@/lib/auth/access";
import { env } from "@/lib/env";
import { ApiError } from "@/lib/kfid/errors";
import { assertRequiredLegalAccess } from "@/lib/legal";
import { serverExtensions } from "@/lib/extensions/server";
import { hasWorkflowPermission, normalizeWorkflowPermissionProfile, type WorkflowPermissionAction, type WorkflowPermissionSubject } from "@/lib/workflow/permissions";

export { ApiError } from "@/lib/kfid/errors";
/**
 * The signed-in person and their active company – or, inside an API/MCP call (2026-09-30), the member the verified
 * key acts for and the key's company. Everything after this (membership, permissions, legal gate, write access) is the
 * same for both, so an external client can never do more than the person could in Workflow.
 */
export async function context(options: { skipLegal?: boolean } = {}) {
  const principal = currentPrincipal();
  const user = principal
    ? await prisma.user.findUnique({ where: { id: principal.actingUserId }, select: authUserSelect }).then((found) => (canAccessTest(found) ? found : null))
    : await getCurrentUser();
  if (!user) throw new ApiError(401, principal ? "Nyckelns användare har inte åtkomst." : "Logga in för att fortsätta.");
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
  if (!membership?.isActive || !membership.organization.isActive)
    throw new ApiError(403, "Du saknar ett aktivt företag.");
  const organizationId = membership.organizationId;
  const wallet = await prisma.creditWallet.upsert({
    where: { organizationId },
    create: { organizationId },
    update: {},
  });
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
    /** Set inside an API/MCP call: which key, for what. */
    integration: principal,
  };
  if (!options.skipLegal) await assertRequiredLegalAccess(result);
  return result;
}
export type Context = Awaited<ReturnType<typeof context>>;
export function checkOrigin(request: Request) {
  const origin = request.headers.get("origin");
  const allowed = [
    new URL(env.APP_URL).origin,
    process.env.NEXTAUTH_URL ? new URL(process.env.NEXTAUTH_URL).origin : "",
  ];
  if (!origin || !allowed.includes(origin))
    throw new ApiError(403, "Otillåten begäran.");
}
export async function body(request: Request) {
  const text = await request.text();
  if (Buffer.byteLength(text) > 2_000_000)
    throw new ApiError(413, "För stor begäran.");
  try {
    return JSON.parse(text);
  } catch {
    throw new ApiError(400, "Ogiltig JSON.");
  }
}
export function failure(error: unknown) {
  if (error instanceof ApiError)
    return NextResponse.json(
      { error: error.message },
      { status: error.status },
    );
  if (error instanceof ZodError)
    return NextResponse.json(
      { error: error.issues[0]?.message ?? "Ogiltiga uppgifter." },
      { status: 400 },
    );
  console.error(
    "KFID request failed",
    error instanceof Error ? error.name : "Unknown",
  );
  return NextResponse.json(
    { error: "Åtgärden kunde inte slutföras. Försök igen." },
    { status: 500 },
  );
}
export async function ownedControl(ctx: Context, id: string) {
  const control = await prisma.control.findFirst({
    where: { id, organizationId: ctx.organizationId, deletedAt: null },
  });
  if (!control) throw new ApiError(404, "Kontrollen hittades inte.");
  return control;
}
export function requireAdmin(ctx: Context) {
  if (!ctx.admin) throw new ApiError(403, "Företagsadministratör krävs.");
}

export function requireCloudStorage(ctx: Context) {
  if (ctx.organization.storageMode !== "HINTEK_CLOUD")
    throw new ApiError(
      409,
      "Företaget använder lokal lagring. Kund- och kontrolldata får därför inte sparas på servern.",
    );
}

export async function requireCloudWriteAccess(ctx: Context, now = new Date()) {
  if (ctx.organization.storageMode !== "HINTEK_CLOUD") return;
  const access = await serverExtensions.cloudWriteAccess(ctx.organizationId, now);
  if (access.allowed) return access;
  throw new ApiError(
    423,
    access.reason === "PAYMENT_OVERDUE"
      ? "Cloud-skrivning är pausad på grund av förfallen betalning. Läsning, export och lokal funktion fungerar fortfarande."
      : "Organisationen saknar en giltig Cloud-rättighet för att skriva data. Läsning och export fungerar fortfarande.",
  );
}

export function requireControlDelete(ctx: Context) {
  if (!ctx.canDeleteControls)
    throw new ApiError(403, "Du saknar behörighet att radera kontroller.");
}

export function requireWorkflowPermission(ctx: Context, subject: WorkflowPermissionSubject, action: WorkflowPermissionAction) {
  if (ctx.admin || hasWorkflowPermission(ctx.workflowPermissions, subject, action)) return;
  throw new ApiError(403, `Du saknar behörighet att ${action === "read" ? "visa" : action === "create" ? "skapa" : action === "edit" ? "redigera" : action === "complete" ? "slutföra" : action === "reopen" ? "återöppna" : action === "report" ? "exportera" : "arkivera"} den här delen av Workflow.`);
}
