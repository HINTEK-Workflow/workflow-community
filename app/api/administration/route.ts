import { NextResponse } from "next/server";
import { z } from "zod";
import { randomUUID } from "node:crypto";
import { prisma } from "@/lib/db";
import type { Prisma } from "@prisma/client";
import {
  checkOrigin,
  body,
  context,
  failure,
  ApiError,
} from "@/lib/kfid/server";
import {
  invitationActiveKey,
  invitationDeliveryEnabled,
  sendPreparedInvitation,
} from "@/lib/auth/invitations";
import { serverExtensions } from "@/lib/extensions/server";
import { LOGIN_RULE_REFUSAL, loginRuleAllows } from "@/lib/auth/access";
import { noWorkflowPermissionProfile, workflowPermissionProfileSchema } from "@/lib/workflow/permissions";
import { nextWorkViewSetting, readWorkView, withWorkView, WORK_VIEWS } from "@/lib/workflow/work-view";
import { currentWorkProfile, keepWorkAreas, nextWorkProfileSetting, readWorkProfile, withWorkProfile, WORK_PROFILES } from "@/lib/workflow/work-profile";
import { NEW_COMPANY_DISABLED_MODULES } from "@/lib/workflow/modules";
const id = z.string().min(1).max(100);
// Arbetsvy (2026-10-08): undefined = unchanged, null = no default view.
const workViewInput = z.enum(WORK_VIEWS).nullable().optional();
// A page opened before a row was merged may still send its old key; it means the row that took its place.
const workProfileInput = z.preprocess(currentWorkProfile, z.enum(WORK_PROFILES).nullable().optional());
import { companyProfileSchema as profile } from "@/lib/kfid/company";
import { formatOrgNumber, looksLikePersonalNumber, normalizeOrgNumber, normalizePersonalNumber } from "@/lib/kfid/org-number";
async function administrator() {
  const ctx = await context();
  if (!ctx.admin) throw new ApiError(403, "Bara en företagsadministratör kan göra det.");
  return ctx.user;
}
async function access(
  userId: string,
  organizationId: string,
  allowInactive = false,
) {
  const organization = await prisma.organization.findUnique({
    where: { id: organizationId },
    select: { isActive: true },
  });
  if (!organization) throw new ApiError(404, "Företaget hittades inte.");
  if (!organization.isActive && !allowInactive)
    throw new ApiError(409, "Företaget är pausat.");
  const m = await prisma.organizationMember.findUnique({
    where: { organizationId_userId: { organizationId, userId } },
  });
  if (!m || !m.isActive || m.role === "MEMBER")
    throw new ApiError(403, "Bara en företagsadministratör kan göra det.");
}
export async function GET(request: Request) {
  try {
    const user = await administrator();
    // Older administration history, one bounded page at a time (2026-09-26).
    const params = new URL(request.url).searchParams;
    if (params.get("events") === "older") {
      const organizationId = user.activeOrganizationId ?? "";
      await access(user.id, organizationId, true);
      const before = new Date(params.get("before") ?? "");
      const older = await prisma.administrationEvent.findMany({
        where: { organizationId, ...(Number.isNaN(before.getTime()) ? {} : { createdAt: { lt: before } }) },
        orderBy: { createdAt: "desc" },
        take: 25,
      });
      return NextResponse.json({ events: older });
    }
    const organizations = await prisma.organization.findMany({
      where: {
        id: user.activeOrganizationId ?? "",
        members: {
          some: {
            userId: user.id,
            isActive: true,
            role: { in: ["OWNER", "ADMIN"] },
          },
        },
      },
      orderBy: { name: "asc" },
      include: {
        members: {
          select: {
            id: true,
            role: true,
            canDeleteControls: true,
            workflowPermissions: true,
            isActive: true,
            user: {
              select: {
                id: true,
                name: true,
                email: true,
                isActive: true,
                lastLoginAt: true,
              },
            },
          },
        },
        invitations: {
          where: { status: { in: ["PREPARED", "PENDING"] } },
          orderBy: { createdAt: "desc" },
          select: {
            id: true,
            email: true,
            name: true,
            role: true,
            canDeleteControls: true,
            workflowPermissions: true,
            status: true,
            expiresAt: true,
            sentAt: true,
            createdAt: true,
          },
        },
        wallet: { select: { balance: true, testMode: true } },
        _count: { select: { customers: { where: { deletedAt: null } }, workflowTasks: true } },
      },
      take: 500,
    });
    const ids = organizations.map((o) => o.id);
    const [settings, events, eventCount] = await Promise.all([
      prisma.workspaceSettings.findMany({
        where: { organizationId: { in: ids } },
        select: { organizationId: true, profile: true },
      }),
      prisma.administrationEvent.findMany({
        where: { organizationId: { in: ids } },
        orderBy: { createdAt: "desc" },
        take: 25,
      }),
      prisma.administrationEvent.count({ where: { organizationId: { in: ids } } }),
    ]);
    return NextResponse.json({
      organizations: organizations.map((o) => ({
        ...o,
        profile: settings.find((s) => s.organizationId === o.id)?.profile ?? {},
      })),
      activeOrganizationId: user.activeOrganizationId,
      superadmin: user.role === "SUPERADMIN",
      invitationDeliveryEnabled: await invitationDeliveryEnabled(),
      events,
      eventCount,
    });
  } catch (e) {
    return failure(e);
  }
}
export async function POST(request: Request) {
  try {
    checkOrigin(request);
    const user = await administrator();
    const input = await body(request);
    const action = z
      .enum([
        "company_save",
        "member_save",
        "member_remove",
        "member_status",
        "invitation_create",
        "invitation_send",
        "invitation_revoke",
        "switch",
      ])
      .parse(input.action);
    if (action === "switch") {
      const organizationId = id.parse(input.organizationId);
      const member = await prisma.organizationMember.findFirst({
        where: {
          organizationId,
          userId: user.id,
          isActive: true,
        },
      });
      if (!member)
        throw new ApiError(
          403,
          "Du måste vara medlem i företaget för att öppna arbetsytan.",
        );
      await prisma.user.update({
        where: { id: user.id },
        data: { activeOrganizationId: organizationId },
      });
      return NextResponse.json({ ok: true });
    }
    const organizationId = input.organizationId
      ? id.parse(input.organizationId)
      : undefined;
    if (organizationId)
      await access(
        user.id,
        organizationId,
        action === "company_save" && user.role === "SUPERADMIN",
      );
    else throw new ApiError(403, "Välj ett företag som du administrerar.");
    if (action === "company_save") {
      const name = z.string().trim().min(1).max(200).parse(input.name);
      const details = profile.parse(input.profile);
      const isActive = z.boolean().parse(input.isActive);
      const requestedStorageMode = input.storageMode
        ? z.enum(["LOCAL", "HINTEK_CLOUD"]).parse(input.storageMode)
        : undefined;
      if (!isActive && organizationId === user.activeOrganizationId)
        throw new ApiError(
          409,
          "Byt arbetsyta innan du pausar det aktiva företaget.",
        );
      const result = await prisma.$transaction(async (tx) => {
        const old = organizationId
          ? await tx.organization.findUnique({ where: { id: organizationId } })
          : null;
        if (organizationId && !old)
          throw new ApiError(404, "Företaget hittades inte.");
        const storageMode = old
          ? (requestedStorageMode ?? old.storageMode)
          : (requestedStorageMode ?? "LOCAL");
        if (user.role !== "SUPERADMIN" && old?.isActive !== isActive)
          throw new ApiError(
            403,
            "Bara systemadministratören kan pausa företag.",
          );
        if (
          user.role !== "SUPERADMIN" &&
          old &&
          old.storageMode !== storageMode
        )
          throw new ApiError(
            403,
            "Bara systemadministratören kan ändra lagringsmodell.",
          );
        if (
          old?.storageMode === "HINTEK_CLOUD" &&
          storageMode === "LOCAL" &&
          (await tx.workflowTask.count({ where: { organizationId: old.id } })) +
            (await tx.customer.count({ where: { organizationId: old.id } })) >
            0
        )
          throw new ApiError(
            409,
            "Molnlagringen kan inte stängas av medan kunder eller uppgifter finns kvar på servern. Export och verifierad radering måste göras först.",
          );
        const company = old
          ? await tx.organization.update({
              where: { id: old.id },
              data: { name, isActive, storageMode },
            })
          : await tx.organization.create({
              data: {
                name,
                isActive,
                storageMode,
                slug: `company-${randomUUID()}`,
                // Webb och inlägg is off from the start (2026-11-20).
                disabledModules: [...NEW_COMPANY_DISABLED_MODULES],
                wallet: { create: {} },
              },
            });
        if (!isActive) {
          await tx.user.updateMany({
            where: { activeOrganizationId: company.id },
            data: { activeOrganizationId: null },
          });
        }
        // Företagsuppgifter is the one place for the company's name and contact e-mail (2026-10-07): the
        // organisation's name, the report settings' companyName/contactEmail and the profile are written together.
        // The workspace route's "settings" action (Ställ in Workflow) writes the same places.
        // What the company works with (Yrkesprofil) is no part of this form. The company's row is locked by the update above,
        // as the work_areas action locks it, so neither save can overwrite the other.
        const stored = await tx.workspaceSettings.findUnique({ where: { organizationId: company.id }, select: { profile: true } });
        // The number as its kind needs (2026-11-04): a sole trader's personal number is checked and one company per number;
        // an organisation number is only kept from being a personal number. The refusals never repeat the number.
        const compact = (value: string) => value.replace(/[^a-z0-9]/gi, "").toLowerCase();
        const before = profile.safeParse(stored?.profile ?? {});
        const soleTrader = details.companyType === "soleTrader";
        if (details.organizationNumber.trim() && (!before.success || compact(before.data.organizationNumber) !== compact(details.organizationNumber) || before.data.companyType !== details.companyType)) {
          if (!soleTrader && looksLikePersonalNumber(details.organizationNumber)) throw new ApiError(400, "Det här är ett personnummer. Välj Enskild firma om du driver företaget som privatperson.");
          const digits = soleTrader ? normalizePersonalNumber(details.organizationNumber) : normalizeOrgNumber(details.organizationNumber);
          if (soleTrader && !digits) throw new ApiError(400, "Personnumret stämmer inte. Kontrollera siffrorna (ÅÅMMDD-NNNN).");
          if (digits) {
            const taken = await tx.$queryRaw<{ organizationId: string }[]>`SELECT "organizationId" FROM "WorkspaceSettings" WHERE "organizationId" <> ${company.id}
              AND regexp_replace(lower(coalesce(profile->>'organizationNumber', '')), '[^a-z0-9]', '', 'g') = ${digits} LIMIT 1`;
            if (taken.length) throw new ApiError(409, "Numret används redan av ett annat företag i Workflow.");
            details.organizationNumber = formatOrgNumber(digits);
          }
        }
        const savedProfile = keepWorkAreas(details, stored?.profile);
        await tx.workspaceSettings.upsert({
          where: { organizationId: company.id },
          create: {
            organizationId: company.id,
            companyName: name,
            contactEmail: details.email,
            profile: savedProfile,
          },
          update: {
            companyName: name,
            contactEmail: details.email,
            profile: savedProfile,
          },
        });
        await tx.administrationEvent.create({
          data: {
            actorId: user.id,
            organizationId: company.id,
            action,
            detail: `${old ? "Uppdaterade" : "Skapade"} företag: ${name} · ${storageMode === "LOCAL" ? "lokal lagring" : "serverlagring"}`,
          },
        });
        return company;
      });
      return NextResponse.json({ id: result.id });
    }
    if (!organizationId) throw new ApiError(400, "Välj företag.");
    if (
      ["invitation_create", "invitation_send", "invitation_revoke"].includes(
        action,
      )
    ) {
      const result = await prisma.$transaction(async (tx) => {
        await tx.$queryRaw`SELECT id FROM "Organization" WHERE id=${organizationId} FOR UPDATE`;
        const organization = await tx.organization.findUnique({
          where: { id: organizationId },
          select: { isActive: true },
        });
        if (!organization?.isActive)
          throw new ApiError(409, "Företaget är pausat eller saknas.");
        if (action === "invitation_create") {
          const email = z.email().max(254).parse(input.email).toLowerCase();
          const name = z.string().trim().min(1).max(200).parse(input.name);
          if (!loginRuleAllows(email)) throw new ApiError(400, LOGIN_RULE_REFUSAL);
          const role = z.enum(["ADMIN", "MEMBER"]).parse(input.role);
          const canDeleteControls = z
            .boolean()
            .default(false)
            .parse(input.canDeleteControls);
          // Arbetsvy (2026-10-08): the default work view rides beside the profile in the same JSON record; display only.
          const invitedView = workViewInput.parse(input.workView);
          // Yrkesprofil (2026-11-01): beside it, and just as little a permission; only the admin's chosen rights above are one.
          const invitedProfile = workProfileInput.parse(input.workProfile);
          const invitedRecord = withWorkView(workflowPermissionProfileSchema.parse(input.workflowPermissions ?? noWorkflowPermissionProfile()), invitedView ? { view: invitedView, setAt: new Date().toISOString() } : null);
          const workflowPermissions = withWorkProfile(invitedRecord, invitedProfile ? { profile: invitedProfile, setAt: new Date().toISOString() } : null) as Prisma.InputJsonObject;
          const existing = await tx.user.findUnique({
            where: { email },
            select: { id: true, role: true },
          });
          if (existing?.id === user.id)
            throw new ApiError(409, "Du är redan medlem i företaget.");
          if (existing?.role === "SUPERADMIN")
            throw new ApiError(
              403,
              "Systemadministratörer hanteras inte med företagsinbjudningar.",
            );
          if (
            existing &&
            (await tx.organizationMember.findUnique({
              where: {
                organizationId_userId: {
                  organizationId,
                  userId: existing.id,
                },
              },
            }))
          )
            throw new ApiError(409, "Adressen är redan medlem i företaget.");
          const activeKey = invitationActiveKey(organizationId, email);
          const current = await tx.organizationInvitation.findUnique({
            where: { activeKey },
          });
          const invitation = current
            ? await tx.organizationInvitation.update({
                where: { id: current.id },
                data: {
                  email,
                  name,
                  role,
                  canDeleteControls,
                  workflowPermissions,
                  status: "PREPARED",
                  tokenHash: null,
                  expiresAt: null,
                  sentAt: null,
                  revokedAt: null,
                  invitedBy: user.id,
                },
              })
            : await tx.organizationInvitation.create({
                data: {
                  organizationId,
                  email,
                  name,
                  role,
                  canDeleteControls,
                  workflowPermissions,
                  activeKey,
                  invitedBy: user.id,
                },
              });
          await tx.administrationEvent.create({
            data: {
              actorId: user.id,
              organizationId,
              action,
              detail: `Förberedde inbjudan: ${email} (${role})`,
            },
          });
          return { invitationId: invitation.id, send: true };
        }

        const invitationId = id.parse(input.invitationId);
        const invitation = await tx.organizationInvitation.findFirst({
          where: {
            id: invitationId,
            organizationId,
            status: { in: ["PREPARED", "PENDING"] },
          },
        });
        if (!invitation) throw new ApiError(404, "Inbjudan hittades inte.");
        if (action === "invitation_revoke") {
          const revoked = await tx.organizationInvitation.updateMany({
            where: {
              id: invitation.id,
              status: { in: ["PREPARED", "PENDING"] },
              activeKey: { not: null },
            },
            data: {
              status: "REVOKED",
              activeKey: null,
              tokenHash: null,
              expiresAt: null,
              revokedAt: new Date(),
            },
          });
          if (!revoked.count)
            throw new ApiError(409, "Inbjudans status har redan ändrats.");
          await tx.administrationEvent.create({
            data: {
              actorId: user.id,
              organizationId,
              action,
              detail: `Återkallade inbjudan: ${invitation.email}`,
            },
          });
          return { invitationId: invitation.id, send: false };
        }
        if (!loginRuleAllows(invitation.email)) throw new ApiError(400, LOGIN_RULE_REFUSAL);
        return { invitationId: invitation.id, send: true };
      });
      if (result.send) {
        if (!(await invitationDeliveryEnabled())) {
          if (action === "invitation_send")
            throw new ApiError(
              409,
              "Inbjudningsutskick är avstängt under privat test.",
            );
        } else {
          await sendPreparedInvitation(result.invitationId);
          await prisma.administrationEvent.create({
            data: {
              actorId: user.id,
              organizationId,
              action: "invitation_send",
              detail: "Skickade en verifierad företagsinbjudan.",
            },
          });
        }
      }
      // Prissteg (2026-11-20): when the invitation takes the company past its price step, one clear line; never a block.
      const tierNotice = action === "invitation_create"
        ? await serverExtensions.cloudTierNotice(organizationId).catch(() => null)
        : null;
      return NextResponse.json({
        ok: true,
        status: (await invitationDeliveryEnabled()) ? "PENDING" : "PREPARED",
        ...(tierNotice ? { tierNotice } : {}),
      });
    }
    await prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM "Organization" WHERE id=${organizationId} FOR UPDATE`;
      const organization = await tx.organization.findUnique({
        where: { id: organizationId },
        select: { isActive: true },
      });
      if (!organization) throw new ApiError(404, "Företaget hittades inte.");
      if (!organization.isActive)
        throw new ApiError(409, "Företaget är pausat.");
      const email = z.email().max(254).parse(input.email).toLowerCase();
      const existing = await tx.user.findUnique({ where: { email } });
      if (existing?.id === user.id)
        throw new ApiError(
          409,
          "Du kan inte ändra eller ta bort din egen behörighet här.",
        );
      if (existing?.role === "SUPERADMIN")
        throw new ApiError(
          403,
          "Systemadministratörer hanteras inte som vanliga medlemmar.",
        );
      const membership = existing
        ? await tx.organizationMember.findUnique({
            where: {
              organizationId_userId: { organizationId, userId: existing.id },
            },
          })
        : null;
      const role =
        action === "member_status"
          ? (membership?.role ?? null)
          : action === "member_save"
            ? z.enum(["ADMIN", "MEMBER"]).parse(input.role)
            : null;
      const isCurrentAdmin =
        membership?.isActive &&
        (membership.role === "OWNER" || membership.role === "ADMIN");
      const losesAdminRole =
        action === "member_remove" ||
        (action === "member_save" && role === "MEMBER");
      if (
        isCurrentAdmin &&
        losesAdminRole &&
        (await tx.organizationMember.count({
          where: {
            organizationId,
            role: { in: ["OWNER", "ADMIN"] },
            isActive: true,
          },
        })) <= 1
      )
        throw new ApiError(409, "Företaget måste ha minst en aktiv administratör.");
      if (action === "member_status") {
        if (!membership) throw new ApiError(404, "Medlemmen hittades inte.");
        const isActive = z.boolean().parse(input.isActive);
        if (
          !isActive &&
          membership.isActive &&
          (membership.role === "OWNER" || membership.role === "ADMIN") &&
          (await tx.organizationMember.count({
            where: {
              organizationId,
              role: { in: ["OWNER", "ADMIN"] },
              isActive: true,
            },
          })) <= 1
        )
          throw new ApiError(409, "Företaget måste ha minst en aktiv administratör.");
        await tx.organizationMember.update({
          where: { id: membership.id },
          data: { isActive },
        });
        if (!isActive) {
          await tx.user.updateMany({
            where: {
              id: membership.userId,
              activeOrganizationId: organizationId,
            },
            data: { activeOrganizationId: null },
          });
        } else {
          await tx.user.updateMany({
            where: { id: membership.userId, activeOrganizationId: null },
            data: { activeOrganizationId: organizationId },
          });
        }
      } else if (action === "member_remove") {
        if (!membership) throw new ApiError(404, "Medlemmen hittades inte.");
        await tx.organizationMember.delete({ where: { id: membership.id } });
        await tx.user.updateMany({
          where: {
            id: membership.userId,
            activeOrganizationId: organizationId,
          },
          data: { activeOrganizationId: null },
        });
      } else {
        const canDeleteControls = z
          .boolean()
          .default(false)
          .parse(input.canDeleteControls);
        // Editing a member without sending permissions keeps what the admin granted before; only an explicit profile
        // changes them (an omitted profile must never silently widen or wipe access).
        const workflowPermissions = input.workflowPermissions === undefined ? undefined : workflowPermissionProfileSchema.parse(input.workflowPermissions);
        const name = z.string().trim().min(1).max(200).parse(input.name);
        void name;
        if (!existing || !membership)
          throw new ApiError(
            409,
            "Personen är inte medlem ännu. Skapa en inbjudan i stället.",
          );
        // Arbetsvy (2026-10-08): display only and never a permission. A new stamp only when the view changes or the admin
        // resets the person's own choices; the record keeps the view when only the permissions change, and vice versa.
        const storedView = readWorkView(membership.workflowPermissions);
        const resetChoices = z.boolean().default(false).parse(input.workViewReset);
        const nextView = nextWorkViewSetting(storedView, workViewInput.parse(input.workView), resetChoices, new Date());
        // Yrkesprofil (2026-11-01): kept the same way. A changed profile changes no rights here: the form asks the admin and
        // sends the rights only when the admin said yes.
        const storedProfile = readWorkProfile(membership.workflowPermissions);
        const nextProfile = nextWorkProfileSetting(storedProfile, workProfileInput.parse(input.workProfile), resetChoices, new Date());
        const record = workflowPermissions || nextView || nextProfile ? withWorkProfile(withWorkView(workflowPermissions ?? membership.workflowPermissions, nextView ?? storedView), nextProfile ?? storedProfile) as Prisma.InputJsonObject : undefined;
        await tx.organizationMember.update({
          where: { id: membership.id },
          data: { role: role!, canDeleteControls, ...(record ? { workflowPermissions: record } : {}) },
        });
      }
      await tx.administrationEvent.create({
        data: {
          actorId: user.id,
          organizationId,
          action,
          detail: `${action === "member_remove" ? "Tog bort medlem" : action === "member_status" ? (input.isActive ? "Aktiverade medlemskap" : "Pausade medlemskap") : "Sparade medlemsroll"}: ${email}${role ? ` (${role})` : ""}`,
        },
      });
    });
    await serverExtensions.syncCloudSeats({
      organizationId,
      actorId: user.id,
      reason: action,
    });
    return NextResponse.json({ ok: true });
  } catch (e) {
    return failure(e);
  }
}
