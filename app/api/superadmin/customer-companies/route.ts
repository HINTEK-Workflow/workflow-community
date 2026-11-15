import { NextResponse } from "next/server";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { companyDocumentGaps, companyProfileSchema, mergeCompanyDetails, type CompanyDetailKey } from "@/lib/kfid/company";
import { formatOrgNumber, looksLikePersonalNumber, normalizeCompanyOrgNumber, numberForOthers } from "@/lib/kfid/org-number";
import { normalizePostalCode } from "@/lib/postal-code";
import { keepWorkAreas } from "@/lib/workflow/work-profile";
import { oneYearFrom } from "@/lib/kfid/credit-policy";
import { serverExtensions } from "@/lib/extensions/server";
import { invitationActiveKey, invitationDeliveryEnabled, sendPreparedInvitation } from "@/lib/auth/invitations";
import { LOGIN_RULE_REFUSAL, loginRuleAllows } from "@/lib/auth/access";
import { registrationStorageMode } from "@/lib/auth/registration";
import { publicInstance } from "@/lib/instance";
import { ownerInvitationSendRefusal, storageChangeRefusal } from "@/lib/kfid/customer-company-list";
import { ApiError, body, checkOrigin, context, failure } from "@/lib/kfid/server";
import { grantCompensationCredits } from "@/lib/kfid/purchased-credits";
import { ensureCreditWallet } from "@/lib/credits/ensure-wallet";
import { DAILY_CAP_MAX, DAILY_CAP_MIN } from "@/lib/machine/alarm-scope";
import { isErasedCompany } from "@/lib/kfid/paused-company";

// The details a company's documents need (2026-11-04), the same fields as Skapa konto, Kom igång and Företagsuppgifter
// (features/kfid/company-details-form.tsx). Each is checked again by the profile's own schema when it is merged.
const detailText = (max: number) => z.string().trim().max(max).optional();
const companyDetailsShape = {
  vatNumber: detailText(300), fSkatt: z.boolean().optional(),
  address: detailText(200), postalCode: z.string().trim().max(20).transform(normalizePostalCode).optional(), city: detailText(120),
  contactName: detailText(300), phone: detailText(300), registeredOffice: detailText(300), bankgiro: detailText(20), plusgiro: detailText(20),
};
const DETAIL_LABEL: Partial<Record<CompanyDetailKey, string>> = {
  organizationNumber: "organisationsnummer", vatNumber: "momsregistreringsnummer", fSkatt: "F-skatt", address: "adress", postalCode: "postnummer", city: "ort",
  contactName: "kontaktperson", email: "kontakt-e-post", phone: "telefon", billingEmail: "faktura-e-post", registeredOffice: "säte", bankgiro: "bankgiro", plusgiro: "plusgiro",
};

const preparedCompanySchema = z.object({
  ...companyDetailsShape,
  name: z.string().trim().min(2).max(200),
  organizationNumber: z.string().trim().min(4).max(30),
  ownerName: z.string().trim().min(2).max(200),
  ownerEmail: z.email().max(254).transform((value) => value.toLowerCase()),
});

const customerAuditLabels = {
  customer_company_prepare: "Kundföretag förberett",
  customer_owner_invitation_prepare: "Admininbjudan förberedd eller ändrad",
  customer_owner_invitation_revoke: "Admininbjudan återkallad",
  customer_owner_invitation_send: "Admininbjudan skickad",
  customer_company_settings_update: "Kundföretagets inställningar ändrade",
  customer_credit_policy_update: "Kundföretagets kreditregel ändrad",
  customer_credit_grant: "Krediter tilldelade av Workflow",
  customer_company_paused: "Företaget pausat: kunden kan läsa och exportera",
  customer_company_resumed: "Företaget återaktiverat",
  // Radering efter avslut (lib/company-closure, 2026-10-10).
  company_closure_notice: "Besked om radering efter avslutat Cloud-avtal",
  company_closure_postponed: "Radering efter avslut uppskjuten",
  company_closure_cancelled: "Radering efter avslut avbruten",
  company_closure_failed: "Automatisk radering misslyckades",
} as const;

export async function GET(request: Request) {
  try {
    const ctx = await context();
    if (ctx.user.role !== "SUPERADMIN")
      throw new ApiError(403, "Bara installationens administratör kan göra det.");

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
        updatedAt: true,
        machineDailyOrderCap: true,
        members: {
          where: { isActive: true },
          select: {
            role: true,
            user: { select: { name: true, email: true } },
          },
        },
        invitations: {
          where: { status: { in: ["PREPARED", "PENDING"] } },
          select: { role: true, status: true, email: true, name: true, sentAt: true },
        },
        wallet: { select: { balance: true, purchasedBalance: true, expiryEnabled: true, expiryOverrideAt: true } },
        _count: { select: { customers: { where: { deletedAt: null } }, workflowTasks: true } },
      },
    });
    // Betalningen (beslut 11, 2026-11-01): metadata from ee/ only; without it no company has any.
    const payments = await serverExtensions.companyPayments(organizations.map((item) => item.id), new Date());
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
      invitationDelivery: await invitationDeliveryEnabled(),
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
          updatedAt: item.updatedAt,
          // A sole trader's personal number is never sent to the product administration whole (2026-11-04): ÅÅMMDD-••••.
          organizationNumber: numberForOthers(details.organizationNumber, details.companyType),
          companyType: details.companyType,
          contactName: details.contactName,
          contactEmail: details.email,
          billingEmail: details.billingEmail,
          city: details.city,
          // Company details only (2026-11-04): what the page shows and the edit form starts from, never business data.
          vatNumber: details.vatNumber, fSkatt: details.fSkatt, address: details.address, postalCode: details.postalCode, phone: details.phone,
          registeredOffice: details.registeredOffice, bankgiro: details.bankgiro, plusgiro: details.plusgiro,
          documentGaps: companyDocumentGaps(profileByOrganization.get(item.id)),
          owner: owner
            ? { name: owner.user.name, email: owner.user.email }
            : null,
          administrators: item.members
            .filter((member) => member.role === "OWNER" || member.role === "ADMIN")
            .map((member) => ({ name: member.user.name, email: member.user.email })),
          preparedOwnerEmail: ownerInvitation?.email ?? null,
          preparedOwnerName: ownerInvitation?.name ?? null,
          ownerInvitationStatus: ownerInvitation?.status ?? null,
          ownerInvitationSentAt: ownerInvitation?.sentAt ?? null,
          memberCount: item.members.length,
          invitationCount: item.invitations.length,
          customerCount: item._count.customers,
          // Every kind of task (data check 2026-10-04).
          controlCount: item._count.workflowTasks,
          creditBalance: item.wallet?.balance ?? 0,
          purchasedCreditBalance: item.wallet?.purchasedBalance ?? 0,
          creditExpiryEnabled: item.wallet?.expiryEnabled ?? true,
          creditExpiryOverrideAt: item.wallet?.expiryOverrideAt ?? null,
          machineDailyOrderCap: item.machineDailyOrderCap,
          registration: registrationOf.get(item.id) ?? null,
          acceptances: acceptancesOf(item.id),
          payment: payments[item.id] ?? null,
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
    ...companyDetailsShape,
    organizationNumber: z.string().trim().max(30).optional(),
    // Maskinlarm (integrationsmotorn, 2026-10-24): automatic work orders per company and rolling day; 20 by default.
    machineDailyOrderCap: z.number().int().min(DAILY_CAP_MIN, `Minst ${DAILY_CAP_MIN}.`).max(DAILY_CAP_MAX, `Högst ${DAILY_CAP_MAX}.`).optional(),
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
  z.object({
    action: z.literal("send_owner"),
    organizationId: z.string().min(1).max(100),
    resend: z.boolean().default(false),
  }),
  // Pausa / Återaktivera (beslut 11, 2026-11-01): read mode for the customer (lib/kfid/paused-company.ts).
  z.object({
    action: z.literal("set_active"),
    organizationId: z.string().min(1).max(100),
    isActive: z.boolean(),
  }),
  // Ge krediter (2026-10-03): compensation credits for a company or for Workflow itself ("self"), valid one year.
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
      throw new ApiError(403, "Bara installationens administratör kan göra det.");
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
    if (input.action === "set_active") {
      if (input.organizationId === ctx.organizationId)
        throw new ApiError(403, "Ändra inte installationens eget företag via kundföretagsvyn.");
      const company = await prisma.organization.findUnique({ where: { id: input.organizationId }, select: { id: true, slug: true, isActive: true } });
      if (!company || isErasedCompany(company)) throw new ApiError(404, "Kundföretaget hittades inte.");
      if (company.isActive !== input.isActive) await prisma.$transaction([
        prisma.organization.update({ where: { id: company.id }, data: { isActive: input.isActive } }),
        prisma.administrationEvent.create({ data: { actorId: ctx.user.id, organizationId: company.id, action: input.isActive ? "customer_company_resumed" : "customer_company_paused", detail: input.isActive ? "Återaktiverade företaget." : "Pausade företaget. Kunden kan läsa och exportera men inte ändra." } }),
      ]);
      return NextResponse.json({ ok: true });
    }
    if (input.action === "update_credit_policy") {
      if (input.organizationId === ctx.organizationId)
        throw new ApiError(403, "Ändra inte installationens eget företag via kundföretagsvyn.");
      await prisma.$transaction(async (tx) => {
        const rows = await tx.$queryRaw<Array<{ id: string }>>`
          SELECT id FROM "Organization" WHERE id=${input.organizationId} FOR UPDATE`;
        if (!rows.length) throw new ApiError(404, "Kundföretaget hittades inte.");
        const wallet = await ensureCreditWallet(input.organizationId, tx);
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
        throw new ApiError(403, "Ändra ditt eget företag under Inställningar → Företaget.");
      await prisma.$transaction(async (tx) => {
        const rows = await tx.$queryRaw<Array<{ id: string }>>`
          SELECT id FROM "Organization" WHERE id=${input.organizationId} FOR UPDATE`;
        if (!rows.length) throw new ApiError(404, "Kundföretaget hittades inte.");
        const current = await tx.organization.findUniqueOrThrow({ where: { id: input.organizationId } });
        const storageRefusal = storageChangeRefusal(current.storageMode, input.storageMode, publicInstance().features.billing);
        if (storageRefusal) throw new ApiError(409, storageRefusal);
        if (current.storageMode === "HINTEK_CLOUD" && input.storageMode === "LOCAL") {
          const count = (await tx.customer.count({ where: { organizationId: current.id } })) +
            (await tx.workflowTask.count({ where: { organizationId: current.id } }));
          if (count) throw new ApiError(409, "Exportera och verifiera kunddata innan Cloud byts till lokal lagring.");
        }
        const settings = await tx.workspaceSettings.findUnique({ where: { organizationId: current.id } });
        const parsed = companyProfileSchema.safeParse(settings?.profile);
        // The schema knows only the form's fields; what the company works with is the company's own answer and stays.
        const before = companyProfileSchema.parse(parsed.success ? parsed.data : {});
        // The organisation number changes only when it is written differently: a valid number, and one company per number as everywhere.
        // A sole trader's personal number is changed only by the company itself, never from here (the form shows it masked).
        let organizationNumber: string | undefined;
        if (before.companyType !== "soleTrader" && input.organizationNumber !== undefined && input.organizationNumber.replace(/[^a-z0-9]/gi, "").toLowerCase() !== before.organizationNumber.replace(/[^a-z0-9]/gi, "").toLowerCase()) {
          if (input.organizationNumber === "") organizationNumber = "";
          else {
            const digits = normalizeCompanyOrgNumber(input.organizationNumber);
            if (!digits) throw new ApiError(400, looksLikePersonalNumber(input.organizationNumber) ? "Det här är ett personnummer. Enskilda firmor skapar konto själva." : "Organisationsnumret stämmer inte. Kontrollera siffrorna.");
            const taken = await tx.$queryRaw<{ organizationId: string }[]>`SELECT "organizationId" FROM "WorkspaceSettings" WHERE "organizationId" <> ${current.id}
              AND regexp_replace(lower(coalesce(profile->>'organizationNumber', '')), '[^a-z0-9]', '', 'g') = ${digits} LIMIT 1`;
            if (taken.length) throw new ApiError(409, "Organisationsnumret används redan av ett annat företag i Workflow.");
            organizationNumber = formatOrgNumber(digits);
          }
        }
        const changes: Partial<Record<CompanyDetailKey, string | boolean>> = {
          email: input.contactEmail, billingEmail: input.billingEmail, organizationNumber, vatNumber: input.vatNumber, fSkatt: input.fSkatt, address: input.address,
          postalCode: input.postalCode, city: input.city, contactName: input.contactName, phone: input.phone, registeredOffice: input.registeredOffice, bankgiro: input.bankgiro, plusgiro: input.plusgiro,
        };
        const profile = keepWorkAreas(companyProfileSchema.parse(mergeCompanyDetails(before, changes)), settings?.profile);
        const changed = (Object.keys(changes) as CompanyDetailKey[]).filter((key) => changes[key] !== undefined && changes[key] !== before[key]).map((key) => DETAIL_LABEL[key] ?? key);
        await tx.organization.update({
          where: { id: current.id },
          data: { name: input.name, isActive: input.isActive, storageMode: input.storageMode, ...(input.machineDailyOrderCap !== undefined ? { machineDailyOrderCap: input.machineDailyOrderCap } : {}) },
        });
        await tx.workspaceSettings.upsert({
          where: { organizationId: current.id },
          create: { organizationId: current.id, companyName: input.name, contactEmail: input.contactEmail, profile },
          update: { companyName: input.name, contactEmail: input.contactEmail, profile },
        });
        await tx.administrationEvent.create({
          data: { actorId: ctx.user.id, organizationId: current.id,
            action: "customer_company_settings_update", detail: (input.machineDailyOrderCap !== undefined && input.machineDailyOrderCap !== current.machineDailyOrderCap
              ? `Ändrade kundföretagets metadata, status eller lagring. Maskinlarm: högst ${input.machineDailyOrderCap} automatiska arbetsordrar per dygn (förut ${current.machineDailyOrderCap}).`
              : "Ändrade kundföretagets metadata, status eller lagring.") + (changed.length ? ` Företagsuppgifter: ${changed.join(", ")}.` : "") },
        });
      });
      return NextResponse.json({ ok: true });
    }
    if (input.action === "send_owner") {
      // Skicka admininbjudan: a new company has no member who could reach the administration route, so its first admin is
      // invited from here. The refusal is decided again inside the send's row lock, so two sends never both get through.
      if (input.organizationId === ctx.organizationId) throw new ApiError(403, "Bjud in till ditt eget företag under Inställningar → Företag och användare.");
      if (!(await invitationDeliveryEnabled())) throw new ApiError(409, "Inbjudningar via e-post är avstängda. Slå på dem under Installation → E-post.");
      const organization = await prisma.organization.findUnique({ where: { id: input.organizationId }, select: { isActive: true } });
      if (!organization) throw new ApiError(404, "Kundföretaget hittades inte.");
      const invitation = await prisma.organizationInvitation.findFirst({
        where: { organizationId: input.organizationId, role: { in: ["OWNER", "ADMIN"] }, status: { in: ["PREPARED", "PENDING"] } },
        orderBy: { createdAt: "desc" }, select: { id: true, email: true },
      });
      if (!invitation) throw new ApiError(404, "Ingen admininbjudan finns. Förbered en först.");
      const person = await prisma.user.findUnique({ where: { email: invitation.email }, select: { role: true } });
      if (person?.role === "SUPERADMIN" || invitation.email === ctx.user.email.toLowerCase()) throw new ApiError(400, "Systemadministratörer får inte bjudas in som kundföretagets admin.");
      if (!loginRuleAllows(invitation.email)) throw new ApiError(400, LOGIN_RULE_REFUSAL);
      const admins = await prisma.organizationMember.count({ where: { organizationId: input.organizationId, role: { in: ["OWNER", "ADMIN"] }, isActive: true } });
      try {
        await sendPreparedInvitation(invitation.id, {
          guard: (current) => {
            const refusal = ownerInvitationSendRefusal({ companyActive: organization.isActive, hasAdmin: admins > 0, status: current.status, sentAt: current.sentAt, resend: input.resend, now: new Date() });
            if (refusal) throw new ApiError(409, refusal);
          },
        });
      } catch (error) {
        if (error instanceof ApiError) throw error;
        throw new ApiError(502, "E-postmeddelandet kunde inte skickas. Försök igen om en stund.");
      }
      await prisma.administrationEvent.create({
        data: { actorId: ctx.user.id, organizationId: input.organizationId, action: "customer_owner_invitation_send", detail: input.resend ? "Skickade admininbjudan igen." : "Skickade admininbjudan." },
      });
      return NextResponse.json({ ok: true, status: "PENDING", email: invitation.email });
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
      if (input.action === "revoke_owner") {
        // A sent invitation can be withdrawn too: the link is the right to become the company's admin, and a mistyped address
        // has no other way back. Taking away the token and the key ends the link at once; acceptance holds the same row lock.
        const revoked = await tx.organizationInvitation.updateMany({
          where: { organizationId: input.organizationId, role: { in: ["OWNER", "ADMIN"] }, status: { in: ["PREPARED", "PENDING"] } },
          data: { status: "REVOKED", activeKey: null, tokenHash: null, expiresAt: null, revokedAt: new Date() },
        });
        if (!revoked.count) throw new ApiError(404, "Ingen admininbjudan finns att återkalla.");
        await tx.administrationEvent.create({
          data: { actorId: ctx.user.id, organizationId: input.organizationId,
          action: "customer_owner_invitation_revoke", detail: pendingOwnerCount ? "Återkallade skickad admininbjudan. Länken gäller inte längre." : "Återkallade vilande admininbjudan." },
        });
        return "REVOKED";
      }
      if (pendingOwnerCount)
        throw new ApiError(409, "En admininbjudan är redan skickad. Återkalla den först om adressen ska ändras.");
      const prepared = await tx.organizationInvitation.findFirst({
        where: { organizationId: input.organizationId, role: { in: ["OWNER", "ADMIN"] }, status: "PREPARED" },
        orderBy: { createdAt: "desc" },
      });
      if (input.email === ctx.user.email.toLowerCase())
        throw new ApiError(400, "Systemadministratören kan inte bli kundföretagets admin.");
      if (!loginRuleAllows(input.email)) throw new ApiError(400, LOGIN_RULE_REFUSAL);
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
      throw new ApiError(403, "Bara installationens administratör kan göra det.");
    const input = preparedCompanySchema.parse(await body(request));
    if (input.ownerEmail === ctx.user.email.toLowerCase())
      throw new ApiError(400, "Välj kundföretagets egen admin, inte systemadministratören.");
    if (!loginRuleAllows(input.ownerEmail)) throw new ApiError(400, LOGIN_RULE_REFUSAL);
    const normalizedNumber = input.organizationNumber
      .toLocaleLowerCase("sv-SE")
      .replace(/[^a-z0-9]/g, "");
    if (normalizedNumber.length < 4)
      throw new ApiError(400, "Ange ett giltigt organisationsnummer.");
    // A sole trader's personal number is typed only by the company itself (2026-11-04).
    if (looksLikePersonalNumber(input.organizationNumber))
      throw new ApiError(400, "Det här är ett personnummer. Enskilda firmor skapar konto själva.");

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
      const { name: _name, organizationNumber: _number, ownerName: _owner, ownerEmail: _email, ...given } = input;
      void _name; void _number; void _owner; void _email;
      const profile = companyProfileSchema.parse(mergeCompanyDetails({
        organizationNumber: input.organizationNumber,
        contactName: input.ownerName,
        email: input.ownerEmail,
      }, given));
      const created = await tx.organization.create({
        data: {
          name: input.name,
          slug: `company-${randomUUID()}`,
          storageMode: await registrationStorageMode(),
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
