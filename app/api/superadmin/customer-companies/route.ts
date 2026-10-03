import { NextResponse } from "next/server";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { companyProfileSchema } from "@/lib/kfid/company";
import { oneYearFrom } from "@/lib/kfid/credit-policy";
import { serverExtensions } from "@/lib/extensions/server";
import { invitationActiveKey } from "@/lib/auth/invitations";
import { ApiError, body, checkOrigin, context, failure } from "@/lib/kfid/server";
import { grantCompensationCredits } from "@/lib/kfid/purchased-credits";

const preparedCompanySchema = z.object({
  name: z.string().trim().min(2).max(200),
  organizationNumber: z.string().trim().min(4).max(30),
  ownerName: z.string().trim().min(2).max(200),
  ownerEmail: z.email().max(254).transform((value) => value.toLowerCase()),
});

const customerAuditLabels = {
  customer_company_prepare: "Kundföretag förberett",
  customer_owner_invitation_prepare: "Admininbjudan förberedd eller ändrad",
  customer_owner_invitation_revoke: "Admininbjudan återkallad",
  customer_company_settings_update: "Kundföretagets inställningar ändrade",
  customer_credit_policy_update: "Kundföretagets kreditregel ändrad",
  customer_credit_grant: "Krediter tilldelade av HINTEK",
} as const;

export async function GET(request: Request) {
  try {
    const ctx = await context();
    if (ctx.user.role !== "SUPERADMIN")
      throw new ApiError(403, "Systemadministratör krävs.");

    const historyFor = new URL(request.url).searchParams.get("historyFor");
    if (historyFor !== null) {
      if (!historyFor || historyFor.length > 100)
        throw new ApiError(400, "Ogiltigt kundföretag.");
      if (historyFor === ctx.organizationId)
        throw new ApiError(404, "Kundföretaget hittades inte.");
      const organization = await prisma.organization.findUnique({
        where: { id: historyFor }, select: { id: true },
      });
      if (!organization) throw new ApiError(404, "Kundföretaget hittades inte.");
      const events = await prisma.administrationEvent.findMany({
        where: { organizationId: historyFor, action: { in: Object.keys(customerAuditLabels) } },
        orderBy: [{ createdAt: "desc" }, { id: "desc" }],
        take: 20,
        select: { id: true, action: true, createdAt: true },
      });
      return NextResponse.json({
        events: events.map((event) => ({
          id: event.id,
          label: customerAuditLabels[event.action as keyof typeof customerAuditLabels],
          createdAt: event.createdAt,
        })),
      });
    }

    const organizations = await prisma.organization.findMany({
      where: { id: { not: ctx.organizationId } },
      orderBy: { name: "asc" },
      take: 500,
      select: {
        id: true,
        name: true,
        isActive: true,
        storageMode: true,
        createdAt: true,
        members: {
          where: { isActive: true },
          select: {
            role: true,
            user: { select: { name: true, email: true } },
          },
        },
        invitations: {
          where: { status: { in: ["PREPARED", "PENDING"] } },
          select: { role: true, status: true, email: true, name: true },
        },
        wallet: { select: { balance: true, purchasedBalance: true, expiryEnabled: true, expiryOverrideAt: true } },
        _count: { select: { customers: true, controls: true } },
      },
    });
    const profiles = await prisma.workspaceSettings.findMany({
      where: { organizationId: { in: organizations.map((item) => item.id) } },
      select: { organizationId: true, profile: true },
    });
    const profileByOrganization = new Map(
      profiles.map((item) => [item.organizationId, item.profile]),
    );
    // Skapa konto (2026-10-03): when the company registered itself, and what was accepted, with versions and times.
    const ids = organizations.map((item) => item.id);
    const [registrations, acceptances] = await Promise.all([
      prisma.administrationEvent.findMany({ where: { organizationId: { in: ids }, action: "self_registration" }, select: { organizationId: true, detail: true, createdAt: true } }),
      prisma.legalAcceptance.findMany({
        where: { OR: [{ organizationId: { in: ids } }, { user: { organizationMemberships: { some: { organizationId: { in: ids }, role: { in: ["OWNER", "ADMIN"] } } } } }] },
        orderBy: { acceptedAt: "desc" }, take: 2000,
        select: { organizationId: true, documentVersion: true, acceptedAt: true, document: { select: { title: true } }, user: { select: { email: true, organizationMemberships: { where: { organizationId: { in: ids } }, select: { organizationId: true } } } } },
      }),
    ]);
    const registrationOf = new Map(registrations.map((item) => [item.organizationId, { at: item.createdAt, detail: item.detail }]));
    const acceptancesOf = (organizationId: string) => acceptances
      .filter((item) => item.organizationId === organizationId || item.user.organizationMemberships.some((member) => member.organizationId === organizationId))
      .slice(0, 20)
      .map((item) => ({ title: item.document.title, version: item.documentVersion, acceptedAt: item.acceptedAt, by: item.user.email }));

    return NextResponse.json({
      organizations: organizations.map((item) => {
        const profile = companyProfileSchema.safeParse(
          profileByOrganization.get(item.id),
        );
        const details = profile.success ? profile.data : companyProfileSchema.parse({});
        const owner = item.members.find((member) => member.role === "OWNER" || member.role === "ADMIN");
        const ownerInvitation = item.invitations.find(
          (invitation) => invitation.role === "OWNER" || invitation.role === "ADMIN",
        );
        return {
          id: item.id,
          name: item.name,
          isActive: item.isActive,
          storageMode: item.storageMode,
          createdAt: item.createdAt,
          organizationNumber: details.organizationNumber,
          contactName: details.contactName,
          contactEmail: details.email,
          billingEmail: details.billingEmail,
          city: details.city,
          owner: owner
            ? { name: owner.user.name, email: owner.user.email }
            : null,
          administrators: item.members
            .filter((member) => member.role === "OWNER" || member.role === "ADMIN")
            .map((member) => ({ name: member.user.name, email: member.user.email })),
          preparedOwnerEmail: ownerInvitation?.email ?? null,
          preparedOwnerName: ownerInvitation?.name ?? null,
          ownerInvitationStatus: ownerInvitation?.status ?? null,
          memberCount: item.members.length,
          invitationCount: item.invitations.length,
          customerCount: item._count.customers,
          controlCount: item._count.controls,
          creditBalance: item.wallet?.balance ?? 0,
          purchasedCreditBalance: item.wallet?.purchasedBalance ?? 0,
          creditExpiryEnabled: item.wallet?.expiryEnabled ?? true,
          creditExpiryOverrideAt: item.wallet?.expiryOverrideAt ?? null,
          registration: registrationOf.get(item.id) ?? null,
          acceptances: acceptancesOf(item.id),
        };
      }),
    });
  } catch (error) {
    return failure(error);
  }
}

const ownerInvitationSchema = z.discriminatedUnion("action", [
  z.object({
    action: z.literal("update_credit_policy"),
    organizationId: z.string().min(1).max(100),
    expiryEnabled: z.boolean(),
    expiryOverrideAt: z.union([z.iso.datetime(), z.null()]),
  }),
  z.object({
    action: z.literal("update_company"),
    organizationId: z.string().min(1).max(100),
    name: z.string().trim().min(2).max(200),
    isActive: z.boolean(),
    storageMode: z.enum(["LOCAL", "HINTEK_CLOUD"]),
    contactEmail: z.union([z.literal(""), z.email()]),
    billingEmail: z.union([z.literal(""), z.email()]),
  }),
  z.object({
    action: z.literal("prepare_owner"),
    organizationId: z.string().min(1).max(100),
    name: z.string().trim().min(2).max(200),
    email: z.email().max(254).transform((value) => value.toLowerCase()),
  }),
  z.object({
    action: z.literal("revoke_owner"),
    organizationId: z.string().min(1).max(100),
  }),
  // Ge krediter (2026-10-03): compensation credits for a company or for HINTEK itself ("self"), valid one year.
  z.object({
    action: z.literal("grant_credits"),
    organizationId: z.string().min(1).max(100),
    credits: z.number().int().min(1).max(10_000),
    reason: z.string().trim().min(3, "Skriv varför krediterna ges.").max(300),
    requestKey: z.uuid(),
  }),
]);

export async function PATCH(request: Request) {
  try {
    checkOrigin(request);
    const ctx = await context();
    if (ctx.user.role !== "SUPERADMIN")
      throw new ApiError(403, "Systemadministratör krävs.");
    const input = ownerInvitationSchema.parse(await body(request));
    if (input.action === "grant_credits") {
      const organizationId = input.organizationId === "self" ? ctx.organizationId : input.organizationId;
      const organization = await prisma.organization.findUnique({ where: { id: organizationId }, select: { id: true, storageMode: true } });
      if (!organization) throw new ApiError(404, "Företaget hittades inte.");
      const expiresAt = new Date(Date.now() + 365 * 86_400_000);
      const result = await grantCompensationCredits({ organizationId, actorId: ctx.user.id, credits: input.credits, requestKey: `grant-${input.requestKey}`, reason: input.reason, expiresAt });
      if (result.created)
        await prisma.administrationEvent.create({ data: { actorId: ctx.user.id, organizationId, action: "customer_credit_grant",
          detail: `Gav ${input.credits} kompensationskrediter (gäller till ${expiresAt.toISOString().slice(0, 10)}): ${input.reason}` } });
      return NextResponse.json({ ok: true, cloud: organization.storageMode === "HINTEK_CLOUD" });
    }
    if (input.action === "update_credit_policy") {
      if (input.organizationId === ctx.organizationId)
        throw new ApiError(403, "Ändra inte HINTEK-företaget via kundföretagsvyn.");
      await prisma.$transaction(async (tx) => {
        const rows = await tx.$queryRaw<Array<{ id: string }>>`
          SELECT id FROM "Organization" WHERE id=${input.organizationId} FOR UPDATE`;
        if (!rows.length) throw new ApiError(404, "Kundföretaget hittades inte.");
        const wallet = await tx.creditWallet.upsert({
          where: { organizationId: input.organizationId },
          create: { organizationId: input.organizationId },
          update: {},
        });
        await tx.$queryRaw<Array<{ id: string }>>`
          SELECT id FROM "CreditWallet" WHERE id=${wallet.id} FOR UPDATE`;
        const expiryOverrideAt = input.expiryOverrideAt ? new Date(input.expiryOverrideAt) : null;
        const latestLot = input.expiryEnabled && !expiryOverrideAt
          ? await tx.creditLot.findFirst({
              where: { walletId: wallet.id, origin: "PURCHASE", purchaseId: { not: null }, remaining: { gt: 0 } },
              orderBy: [{ purchase: { paidAt: "desc" } }, { createdAt: "desc" }],
              select: { purchase: { select: { paidAt: true } } },
            }) : null;
        const effectiveExpiry = input.expiryEnabled
          ? (expiryOverrideAt ?? (latestLot?.purchase?.paidAt ? oneYearFrom(latestLot.purchase.paidAt) : null))
          : null;
        await tx.creditWallet.update({
          where: { id: wallet.id },
          data: { expiryEnabled: input.expiryEnabled, expiryOverrideAt },
        });
        await tx.creditLot.updateMany({
          where: { walletId: wallet.id, origin: "PURCHASE", remaining: { gt: 0 } },
          data: { expiresAt: effectiveExpiry },
        });
        await tx.administrationEvent.create({
          data: { actorId: ctx.user.id, organizationId: input.organizationId,
            action: "customer_credit_policy_update",
            detail: `Kreditförfall ${input.expiryEnabled ? "på" : "av"}; undantagsdatum ${expiryOverrideAt?.toISOString() ?? "inget"}.` },
        });
      });
      await serverExtensions.syncCreditExpiryNotices(input.organizationId);
      return NextResponse.json({ ok: true });
    }
    if (input.action === "update_company") {
      if (input.organizationId === ctx.organizationId)
        throw new ApiError(403, "Ändra ditt eget HINTEK-företag under Mitt företag.");
      await prisma.$transaction(async (tx) => {
        const rows = await tx.$queryRaw<Array<{ id: string }>>`
          SELECT id FROM "Organization" WHERE id=${input.organizationId} FOR UPDATE`;
        if (!rows.length) throw new ApiError(404, "Kundföretaget hittades inte.");
        const current = await tx.organization.findUniqueOrThrow({ where: { id: input.organizationId } });
        if (current.storageMode === "LOCAL" && input.storageMode === "HINTEK_CLOUD")
          throw new ApiError(409, "Cloud öppnas först efter verifierad betalning. Köp är ännu inte aktiverade.");
        if (current.storageMode === "HINTEK_CLOUD" && input.storageMode === "LOCAL") {
          const count = (await tx.customer.count({ where: { organizationId: current.id } })) +
            (await tx.control.count({ where: { organizationId: current.id } }));
          if (count) throw new ApiError(409, "Exportera och verifiera kunddata innan Cloud byts till lokal lagring.");
        }
        const settings = await tx.workspaceSettings.findUnique({ where: { organizationId: current.id } });
        const parsed = companyProfileSchema.safeParse(settings?.profile);
        const profile = companyProfileSchema.parse({
          ...(parsed.success ? parsed.data : {}),
          email: input.contactEmail,
          billingEmail: input.billingEmail,
        });
        await tx.organization.update({
          where: { id: current.id },
          data: { name: input.name, isActive: input.isActive, storageMode: input.storageMode },
        });
        await tx.workspaceSettings.upsert({
          where: { organizationId: current.id },
          create: { organizationId: current.id, companyName: input.name, contactEmail: input.contactEmail, profile },
          update: { companyName: input.name, contactEmail: input.contactEmail, profile },
        });
        if (!input.isActive) await tx.user.updateMany({
          where: { activeOrganizationId: current.id },
          data: { activeOrganizationId: null },
        });
        await tx.administrationEvent.create({
          data: { actorId: ctx.user.id, organizationId: current.id,
            action: "customer_company_settings_update", detail: "Ändrade kundföretagets metadata, status eller lagring." },
        });
      });
      return NextResponse.json({ ok: true });
    }
    const status = await prisma.$transaction(async (tx) => {
      const rows = await tx.$queryRaw<{ id: string }[]>`
        SELECT id FROM "Organization" WHERE id=${input.organizationId} FOR UPDATE`;
      if (!rows.length) throw new ApiError(404, "Kundföretaget hittades inte.");
      const ownerCount = await tx.organizationMember.count({
        where: { organizationId: input.organizationId, role: { in: ["OWNER", "ADMIN"] }, isActive: true },
      });
      if (ownerCount) throw new ApiError(409, "Företaget har redan en aktiv administratör.");
      const pendingOwnerCount = await tx.organizationInvitation.count({
        where: { organizationId: input.organizationId, role: { in: ["OWNER", "ADMIN"] }, status: "PENDING" },
      });
      if (pendingOwnerCount)
        throw new ApiError(409, "En admininbjudan är redan skickad. Hantera den i inbjudningsflödet.");
      const prepared = await tx.organizationInvitation.findFirst({
        where: { organizationId: input.organizationId, role: { in: ["OWNER", "ADMIN"] }, status: "PREPARED" },
        orderBy: { createdAt: "desc" },
      });
      if (input.action === "revoke_owner") {
        if (!prepared) throw new ApiError(404, "Ingen förberedd admininbjudan finns.");
        await tx.organizationInvitation.update({
          where: { id: prepared.id },
          data: { status: "REVOKED", activeKey: null, tokenHash: null, expiresAt: null, revokedAt: new Date() },
        });
        await tx.administrationEvent.create({
          data: { actorId: ctx.user.id, organizationId: input.organizationId,
          action: "customer_owner_invitation_revoke", detail: "Återkallade vilande admininbjudan." },
        });
        return "REVOKED";
      }
      if (input.email === ctx.user.email.toLowerCase())
        throw new ApiError(400, "Systemadministratören kan inte bli kundföretagets admin.");
      const existingUser = await tx.user.findUnique({ where: { email: input.email }, select: { id: true, role: true } });
      if (existingUser?.role === "SUPERADMIN")
        throw new ApiError(400, "Systemadministratörer får inte bjudas in som kundföretagets admin.");
      if (existingUser && await tx.organizationMember.findUnique({
        where: { organizationId_userId: { organizationId: input.organizationId, userId: existingUser.id } },
      })) throw new ApiError(409, "Adressen är redan medlem i företaget.");
      const activeKey = invitationActiveKey(input.organizationId, input.email);
      const conflicting = await tx.organizationInvitation.findUnique({ where: { activeKey }, select: { id: true } });
      if (conflicting && conflicting.id !== prepared?.id)
        throw new ApiError(409, "Det finns redan en aktiv inbjudan till adressen.");
      if (prepared) {
        await tx.organizationInvitation.update({
          where: { id: prepared.id },
          data: { name: input.name, email: input.email, role: "ADMIN", activeKey, invitedBy: ctx.user.id },
        });
      } else {
        await tx.organizationInvitation.create({
          data: { organizationId: input.organizationId, name: input.name, email: input.email,
            role: "ADMIN", status: "PREPARED", activeKey, invitedBy: ctx.user.id },
        });
      }
      await tx.administrationEvent.create({
        data: { actorId: ctx.user.id, organizationId: input.organizationId,
          action: "customer_owner_invitation_prepare", detail: "Förberedde vilande admininbjudan utan utskick." },
      });
      return "PREPARED";
    });
    return NextResponse.json({ ok: true, status });
  } catch (error) {
    return failure(error);
  }
}

export async function POST(request: Request) {
  try {
    checkOrigin(request);
    const ctx = await context();
    if (ctx.user.role !== "SUPERADMIN")
      throw new ApiError(403, "Systemadministratör krävs.");
    const input = preparedCompanySchema.parse(await body(request));
    if (input.ownerEmail === ctx.user.email.toLowerCase())
      throw new ApiError(400, "Välj kundföretagets egen admin, inte systemadministratören.");
    const normalizedNumber = input.organizationNumber
      .toLocaleLowerCase("sv-SE")
      .replace(/[^a-z0-9]/g, "");
    if (normalizedNumber.length < 4)
      throw new ApiError(400, "Ange ett giltigt organisationsnummer.");

    const organization = await prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(8216647)`;
      const existing = await tx.$queryRaw<{ organizationId: string }[]>`
        SELECT "organizationId" FROM "WorkspaceSettings"
        WHERE regexp_replace(lower(coalesce(profile->>'organizationNumber', '')),
          '[^a-z0-9]', '', 'g') = ${normalizedNumber}
        LIMIT 1`;
      if (existing.length)
        throw new ApiError(409, "Organisationsnumret finns redan. Öppna det befintliga företaget i stället.");
      const ownerUser = await tx.user.findUnique({
        where: { email: input.ownerEmail },
        select: { role: true },
      });
      if (ownerUser?.role === "SUPERADMIN")
        throw new ApiError(400, "Systemadministratörer får inte bjudas in som kundföretagets admin.");
      const profile = companyProfileSchema.parse({
        organizationNumber: input.organizationNumber,
        contactName: input.ownerName,
        email: input.ownerEmail,
      });
      const created = await tx.organization.create({
        data: {
          name: input.name,
          slug: `company-${randomUUID()}`,
          storageMode: "LOCAL",
          wallet: { create: {} },
        },
      });
      await tx.workspaceSettings.create({
        data: {
          organizationId: created.id,
          companyName: input.name,
          contactEmail: input.ownerEmail,
          profile,
        },
      });
      await tx.organizationInvitation.create({
        data: {
          organizationId: created.id,
          email: input.ownerEmail,
          name: input.ownerName,
          role: "ADMIN",
          status: "PREPARED",
          activeKey: invitationActiveKey(created.id, input.ownerEmail),
          invitedBy: ctx.user.id,
        },
      });
      await tx.administrationEvent.create({
        data: {
          actorId: ctx.user.id,
          organizationId: created.id,
          action: "customer_company_prepare",
          detail: "Förberedde kundföretag och admininbjudan utan utskick.",
        },
      });
      return created;
    });
    return NextResponse.json({ id: organization.id, invitationStatus: "PREPARED" }, { status: 201 });
  } catch (error) {
    return failure(error);
  }
}
