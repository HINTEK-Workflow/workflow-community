import { UserRole } from "@prisma/client";
import { prisma } from "@/lib/db";
import { env, absoluteUrl } from "@/lib/env";
import { sendSystemEmail } from "@/lib/mail/mailer";
import { mailConfig } from "@/lib/mail/settings-server";
import { buildOrganizationInvitationEmail } from "@/lib/mail/templates";
import { hashPassword } from "@/lib/auth/password";
import { createRawToken, expiresInHours, hashToken } from "@/lib/auth/tokens";
import { serverExtensions } from "@/lib/extensions/server";
import { LOGIN_RULE_REFUSAL, loginRuleAllows } from "@/lib/auth/access";
import { refreshRegistrationGate, registrationGateChanged } from "@/lib/auth/registration";
import { publicInstance } from "@/lib/instance";
import { readWorkProfile } from "@/lib/workflow/work-profile";

// Invitations are sent when switched on under E-post (or INVITATION_DELIVERY_ENABLED in .env), never from loopback QA.
export async function invitationDeliveryEnabled() {
  return (await mailConfig()).delivery.invitations;
}

export function invitationActiveKey(organizationId: string, email: string) {
  return `${organizationId}:${email.trim().toLowerCase()}`;
}

/**
 * Sends the invitation. `guard` is asked inside the row lock with the invitation as it is then and may refuse by throwing,
 * so a caller can tell a first send from a second one even when two requests arrive together.
 */
export async function sendPreparedInvitation(invitationId: string, options: { guard?: (current: { status: string; sentAt: Date | null }) => void } = {}) {
  if (!(await invitationDeliveryEnabled()))
    throw new Error("Inbjudningsutskick är avstängt under privat test.");

  const candidate = await prisma.organizationInvitation.findUnique({
    where: { id: invitationId },
    select: { organizationId: true },
  });
  if (!candidate) throw new Error("Inbjudan kan inte skickas.");

  const rawToken = createRawToken();
  const tokenHash = hashToken(rawToken);
  const expiresAt = expiresInHours(env.INVITATION_TTL_HOURS);
  const invitation = await prisma.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT id FROM "Organization" WHERE id=${candidate.organizationId} FOR UPDATE`;
    await tx.$queryRaw`SELECT id FROM "OrganizationInvitation" WHERE id=${invitationId} FOR UPDATE`;
    const current = await tx.organizationInvitation.findUnique({
      where: { id: invitationId },
      include: { organization: { select: { name: true, isActive: true } } },
    });
    if (
      !current ||
      !current.organization.isActive ||
      !["PREPARED", "PENDING"].includes(current.status) ||
      !current.activeKey
    )
      throw new Error("Inbjudan kan inte skickas.");
    options.guard?.({ status: current.status, sentAt: current.sentAt });
    return tx.organizationInvitation.update({
      where: { id: current.id },
      data: {
        status: "PENDING",
        tokenHash,
        expiresAt,
        sentAt: new Date(),
      },
      include: { organization: { select: { name: true, isActive: true } } },
    });
  });

  try {
    const inviteUrl = absoluteUrl(`/invite?token=${rawToken}`);
    const template = buildOrganizationInvitationEmail({
      name: invitation.name,
      organizationName: invitation.organization.name,
      inviteUrl,
      expiresInHours: env.INVITATION_TTL_HOURS,
    });
    await sendSystemEmail({
      to: invitation.email,
      subject: `Inbjudan till ${invitation.organization.name} i ${publicInstance().name}`,
      html: template.html,
      text: template.text,
    });
  } catch (error) {
    await prisma.organizationInvitation.updateMany({
      where: { id: invitation.id, tokenHash },
      data: {
        status: "PREPARED",
        tokenHash: null,
        expiresAt: null,
        sentAt: null,
      },
    });
    throw error;
  }
}

export async function inspectInvitationToken(rawToken: string) {
  if (!(await invitationDeliveryEnabled())) return null;
  const invitation = await prisma.organizationInvitation.findUnique({
    where: { tokenHash: hashToken(rawToken) },
    include: { organization: { select: { name: true, isActive: true } } },
  });
  if (
    !invitation ||
    invitation.status !== "PENDING" ||
    !invitation.expiresAt ||
    invitation.expiresAt <= new Date() ||
    !invitation.organization.isActive
  )
    return null;
  return {
    email: invitation.email,
    name: invitation.name,
    organizationName: invitation.organization.name,
    expiresAt: invitation.expiresAt,
  };
}

export async function acceptInvitationWithToken(
  rawToken: string,
  password: string,
  options: { newsletter?: boolean } = {},
) {
  if (!(await invitationDeliveryEnabled()))
    return {
      ok: false,
      message: "Inbjudningar öppnas efter den privata testperioden.",
    } as const;

  await refreshRegistrationGate();
  const tokenHash = hashToken(rawToken);
  const passwordHash = await hashPassword(password);
  const candidate = await prisma.organizationInvitation.findUnique({
    where: { tokenHash },
    select: { organizationId: true },
  });
  if (!candidate)
    return {
      ok: false,
      message: "Inbjudningslänken är ogiltig eller har gått ut.",
    } as const;
  const result = await prisma.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT id FROM "Organization" WHERE id=${candidate.organizationId} FOR UPDATE`;
    const rows = await tx.$queryRaw<Array<{ id: string }>>`
      SELECT id FROM "OrganizationInvitation"
      WHERE "tokenHash" = ${tokenHash}
      FOR UPDATE
    `;
    if (!rows[0])
      return {
        ok: false,
        message: "Inbjudningslänken är ogiltig eller har gått ut.",
      } as const;

    const invitation = await tx.organizationInvitation.findUnique({
      where: { id: rows[0].id },
      include: { organization: { select: { name: true, isActive: true } } },
    });
    if (
      !invitation ||
      invitation.status !== "PENDING" ||
      !invitation.expiresAt ||
      invitation.expiresAt <= new Date() ||
      !invitation.organization.isActive
    )
      return {
        ok: false,
        message: "Inbjudningslänken är ogiltig eller har gått ut.",
      } as const;

    // "Vem får logga in" (2026-10-06): an invitation to an address that may not sign in any more is not accepted.
    if (!loginRuleAllows(invitation.email)) return { ok: false, message: LOGIN_RULE_REFUSAL } as const;

    const existing = await tx.user.findUnique({
      where: { email: invitation.email },
      select: { id: true, role: true, passwordHash: true },
    });
    if (existing?.role === UserRole.SUPERADMIN)
      return {
        ok: false,
        message: "Systemadministratörer kan inte aktiveras via en företagsinbjudan.",
      } as const;

    const previousMembership = existing
      ? await tx.organizationMember.findUnique({
          where: {
            organizationId_userId: {
              organizationId: invitation.organizationId,
              userId: existing.id,
            },
          },
        })
      : null;
    if (previousMembership)
      return {
        ok: false,
        message: "Kontot är redan kopplat till företaget.",
      } as const;

    const now = new Date();
    const account = existing
      ? await tx.user.update({
          where: { id: existing.id },
          data: {
            emailVerifiedAt: now,
            ...(existing.passwordHash ? {} : { passwordHash }),
            ...(options.newsletter ? { newsletterOptInAt: now } : {}),
          },
        })
      : await tx.user.create({
          data: {
            email: invitation.email,
            name: invitation.name,
            passwordHash,
            emailVerifiedAt: now,
            isActive: true,
            role: "STAFF",
            newsletterOptInAt: options.newsletter ? now : null,
          },
        });

    await tx.organizationMember.create({
      data: {
        organizationId: invitation.organizationId,
        userId: account.id,
        role: invitation.role,
        canDeleteControls: invitation.canDeleteControls,
        workflowPermissions: invitation.workflowPermissions ?? undefined,
      },
    });
    // Yrkesprofil (2026-11-01): a new member the admin chose no profile for meets the guide once, to choose one or skip it.
    if (!existing && invitation.role === "MEMBER" && !readWorkProfile(invitation.workflowPermissions)?.profile)
      await tx.userPreferences.create({ data: { userId: account.id, data: { tours: { setupPending: now.toISOString() } } } });
    await tx.user.update({
      where: { id: account.id },
      data: { activeOrganizationId: invitation.organizationId },
    });
    await tx.organizationInvitation.update({
      where: { id: invitation.id },
      data: {
        status: "ACCEPTED",
        activeKey: null,
        tokenHash: null,
        acceptedAt: now,
        acceptedUserId: account.id,
      },
    });
    await tx.administrationEvent.create({
      data: {
        actorId: account.id,
        organizationId: invitation.organizationId,
        action: "invitation_accept",
        detail: `Accepterade inbjudan: ${invitation.email}`,
      },
    });
    return {
      ok: true,
      message: `Inbjudan till ${invitation.organization.name} är accepterad.`,
      actorId: account.id,
    } as const;
  });
  // The new member may sign in at once where only invited members may (lib/auth/access.ts).
  if (result.ok) registrationGateChanged();
  if (result.ok)
    await serverExtensions.syncCloudSeats({
      organizationId: candidate.organizationId,
      actorId: result.actorId,
      reason: "invitation_accept",
    });
  return { ok: result.ok, message: result.message } as const;
}
