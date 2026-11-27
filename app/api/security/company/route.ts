import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { requireFreshAuth } from "@/lib/auth/fresh-auth";
import { revokeAllSessions } from "@/lib/auth/sessions";
import { clearTwoFactorRequiredCache, disableTotp } from "@/lib/auth/two-factor";
import { ApiError, body, checkOrigin, context, failure, requireAdmin } from "@/lib/kfid/server";
import { companySecurityLog, recordSecurityEvent } from "@/lib/security/security-log";
import { microsoftSignInReady } from "@/lib/auth/microsoft";
import { isGuid, MICROSOFT_CONSUMER_TENANT, MICROSOFT_PROVIDER } from "@/lib/auth/microsoft-core";

export const dynamic = "force-dynamic";

/**
 * Användare → Säkerhet (2026-10-10), for the company admin and only the active company: the company's two-factor rule,
 * each member's two-factor status, "Logga ut överallt" for a member, turning a member's two-factor off when the phone
 * is lost, and the company's security log (its own events and its members' events since they joined).
 */
async function admin() {
  const ctx = await context();
  requireAdmin(ctx);
  return ctx;
}

const noStore = { headers: { "Cache-Control": "private, no-store" } };

export async function GET(request: Request) {
  try {
    const ctx = await admin();
    const cursor = new URL(request.url).searchParams.get("before");
    if (cursor) return NextResponse.json({ log: await companySecurityLog(ctx.organizationId, cursor) }, noStore);
    const [settings, members, log, microsoftAvailable] = await Promise.all([
      prisma.workspaceSettings.findUnique({ where: { organizationId: ctx.organizationId }, select: { requireTwoFactor: true, microsoftTenantId: true } }),
      prisma.organizationMember.findMany({
        where: { organizationId: ctx.organizationId, isActive: true },
        orderBy: { createdAt: "asc" }, take: 500,
        select: { role: true, user: { select: { id: true, name: true, email: true, totpEnabledAt: true, isActive: true, authAccounts: { where: { provider: "google" }, select: { id: true }, take: 1 } } } },
      }),
      companySecurityLog(ctx.organizationId),
      microsoftSignInReady(),
    ]);
    return NextResponse.json({
      required: Boolean(settings?.requireTwoFactor),
      // Microsoft-inloggning låst till företagets katalog (2026-10-11); shown while Microsoft sign-in is on, or a lock is set.
      microsoftAvailable, microsoftTenantId: settings?.microsoftTenantId ?? null,
      me: ctx.user.id,
      members: members.filter((member) => member.user.isActive).map((member) => ({
        id: member.user.id, name: member.user.name || member.user.email, email: member.user.email, role: member.role,
        twoFactor: Boolean(member.user.totpEnabledAt), google: member.user.authAccounts.length > 0,
      })),
      log,
    }, noStore);
  } catch (error) {
    return failure(error);
  }
}

const input = z.discriminatedUnion("action", [
  z.object({ action: z.literal("require"), on: z.boolean() }),
  z.object({ action: z.literal("member_signout"), userId: z.string().min(1).max(100) }),
  z.object({ action: z.literal("member_two_factor_off"), userId: z.string().min(1).max(100) }),
  z.object({ action: z.literal("microsoft_tenant"), tenantId: z.string().trim().max(100).nullable() }),
]);

/**
 * The admin's own ways in after a lock to `tid`: password, passkeys, Google, and Microsoft accounts from that directory.
 * Saving a lock that leaves none is refused, as "Vem får logga in" refuses to lock the superadmin out.
 */
async function waysLeftAfterLock(userId: string, tid: string) {
  const user = await prisma.user.findUniqueOrThrow({ where: { id: userId }, select: { passwordHash: true, _count: { select: { passkeys: true } }, authAccounts: { select: { provider: true, hostedDomain: true } } } });
  const accounts = user.authAccounts.filter((account) => account.provider !== MICROSOFT_PROVIDER || account.hostedDomain === tid).length;
  return (user.passwordHash ? 1 : 0) + user._count.passkeys + accounts;
}

export async function POST(request: Request) {
  try {
    checkOrigin(request);
    const ctx = await admin();
    const command = input.parse(await body(request));
    const headers = request.headers;

    if (command.action === "require") {
      await requireFreshAuth(ctx.user.id, ctx.auth);
      await prisma.workspaceSettings.upsert({ where: { organizationId: ctx.organizationId }, update: { requireTwoFactor: command.on }, create: { organizationId: ctx.organizationId, requireTwoFactor: command.on } });
      clearTwoFactorRequiredCache();
      await recordSecurityEvent({ type: "two_factor_policy", actorId: ctx.user.id, organizationId: ctx.organizationId, platform: false, detail: command.on ? "Krävs för medarbetare" : "Krävs inte", headers });
      await prisma.administrationEvent.create({ data: { actorId: ctx.user.id, organizationId: ctx.organizationId, action: "two_factor_policy", detail: command.on ? "Tvåstegsverifiering krävs nu för alla som loggar in." : "Tvåstegsverifiering krävs inte längre." } });
      return NextResponse.json({ ok: true });
    }

    if (command.action === "microsoft_tenant") {
      // Lås Microsoft-inloggning till företagets katalog: an Entra directory id, or null to lift the lock.
      await requireFreshAuth(ctx.user.id, ctx.auth);
      const tenantId = command.tenantId ? command.tenantId.toLowerCase() : null;
      if (tenantId && (!isGuid(tenantId) || tenantId === MICROSOFT_CONSUMER_TENANT))
        throw new ApiError(400, "Ange katalogens id (Directory/tenant ID) från Microsoft Entra, ett GUID. Personliga Microsoft-konton har ingen egen katalog.");
      if (tenantId && (await waysLeftAfterLock(ctx.user.id, tenantId)) === 0)
        throw new ApiError(409, "Du skulle låsa ute dig själv: ditt enda sätt att logga in är ett Microsoft-konto från en annan katalog. Lägg till ett lösenord eller en passkey först.");
      await prisma.workspaceSettings.upsert({ where: { organizationId: ctx.organizationId }, update: { microsoftTenantId: tenantId }, create: { organizationId: ctx.organizationId, microsoftTenantId: tenantId } });
      await recordSecurityEvent({ type: "microsoft_tenant_policy", actorId: ctx.user.id, organizationId: ctx.organizationId, platform: false, detail: tenantId ? "Låst till företagets katalog" : "Inte låst", headers });
      await prisma.administrationEvent.create({ data: { actorId: ctx.user.id, organizationId: ctx.organizationId, action: "microsoft_tenant_policy", detail: tenantId ? `Microsoft-inloggning bara från katalogen ${tenantId}.` : "Microsoft-inloggning är inte längre låst till en katalog." } });
      return NextResponse.json({ ok: true });
    }

    // Only a member of this company, and never a superadmin of the installation (the installation's own rules apply).
    const member = await prisma.organizationMember.findUnique({ where: { organizationId_userId: { organizationId: ctx.organizationId, userId: command.userId } }, select: { role: true, user: { select: { id: true, role: true } } } });
    if (!member) throw new ApiError(404, "Personen är inte medlem i företaget.");
    if (member.user.role === "SUPERADMIN" && ctx.user.role !== "SUPERADMIN") throw new ApiError(403, "Systemadministratörens inloggning hanteras inte här.");
    // Säkerhetsgranskningen 2026-11-24 (G-10): the owner's sign-in is changed only by an owner, and two-factor and sessions belong
    // to the person's whole account – so not for someone who is also in another company. Pausing or removing the person here
    // still ends their access to this company.
    if (member.role === "OWNER" && member.user.id !== ctx.user.id && ctx.memberRole !== "OWNER") throw new ApiError(403, "Bara en ägare kan ändra ägarens inloggning.");
    const elsewhere = member.user.id === ctx.user.id ? 0 : await prisma.organizationMember.count({ where: { userId: member.user.id, isActive: true, organizationId: { not: ctx.organizationId } } });
    if (elsewhere) throw new ApiError(409, "Personen finns också i ett annat företag, så tvåstegsverifiering och inloggningar hanteras inte här. Pausa eller ta bort personen under Användare om personen inte längre ska komma åt ert företag.");

    if (command.action === "member_signout") {
      await revokeAllSessions(member.user.id, { actorId: ctx.user.id, organizationId: ctx.organizationId, headers });
      return NextResponse.json({ ok: true });
    }
    // Tappad telefon: the admin turns the member's two-factor off so they can set it up again (fresh sign-in needed).
    if (member.user.id === ctx.user.id) throw new ApiError(400, "Ändra din egen tvåstegsverifiering under Mina inställningar.");
    await requireFreshAuth(ctx.user.id, ctx.auth);
    await disableTotp(member.user.id);
    await recordSecurityEvent({ type: "two_factor_off", userId: member.user.id, actorId: ctx.user.id, organizationId: ctx.organizationId, detail: "Av administratör", headers });
    return NextResponse.json({ ok: true });
  } catch (error) {
    return failure(error);
  }
}
