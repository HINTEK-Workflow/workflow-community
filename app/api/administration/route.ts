import { NextResponse } from "next/server";
import { z } from "zod";
import { randomUUID } from "node:crypto";
import { prisma } from "@/lib/db";
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
import { noWorkflowPermissionProfile, workflowPermissionProfileSchema } from "@/lib/workflow/permissions";
const id = z.string().min(1).max(100);
import { companyProfileSchema as profile } from "@/lib/kfid/company";
async function administrator() {
  const ctx = await context();
  if (!ctx.admin) throw new ApiError(403, "Företagsadministratör krävs.");
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
    throw new ApiError(403, "Företagsadministratör krävs.");
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
        _count: { select: { customers: true, controls: true } },
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
      invitationDeliveryEnabled: invitationDeliveryEnabled(),
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
          organization: { isActive: true },
        },
      });
      if (!member)
        throw new ApiError(
          403,
          "Du måste vara medlem i ett aktivt företag för att öppna arbetsytan.",
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
            "Endast systemadministratören kan pausa företag.",
          );
        if (
          user.role !== "SUPERADMIN" &&
          old &&
          old.storageMode !== storageMode
        )
          throw new ApiError(
            403,
            "Endast systemadministratören kan ändra lagringsmodell.",
          );
        if (
          old?.storageMode === "HINTEK_CLOUD" &&
          storageMode === "LOCAL" &&
          (await tx.control.count({ where: { organizationId: old.id } })) +
            (await tx.customer.count({ where: { organizationId: old.id } })) >
            0
        )
          throw new ApiError(
            409,
            "Molnlagringen kan inte stängas av medan kunder eller kontroller finns kvar hos HINTEK. Export och verifierad radering måste göras först.",
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
                wallet: { create: {} },
              },
            });
        if (!isActive) {
          await tx.user.updateMany({
            where: { activeOrganizationId: company.id },
            data: { activeOrganizationId: null },
          });
        }
        await tx.workspaceSettings.upsert({
          where: { organizationId: company.id },
          create: {
            organizationId: company.id,
            companyName: name,
            contactEmail: details.email,
            profile: details,
          },
          update: {
            companyName: name,
            contactEmail: details.email,
            profile: details,
          },
        });
        await tx.administrationEvent.create({
          data: {
            actorId: user.id,
            organizationId: company.id,
            action,
            detail: `${old ? "Uppdaterade" : "Skapade"} företag: ${name} · ${storageMode === "LOCAL" ? "lokal lagring" : "HINTEK Cloud"}`,
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
          const role = z.enum(["ADMIN", "MEMBER"]).parse(input.role);
          const canDeleteControls = z
            .boolean()
            .default(false)
            .parse(input.canDeleteControls);
          const workflowPermissions = workflowPermissionProfileSchema.parse(input.workflowPermissions ?? noWorkflowPermissionProfile());
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
            throw new ApiError(409, "Inbjudan har redan ändrat status.");
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
        return { invitationId: invitation.id, send: true };
      });
      if (result.send) {
        if (!invitationDeliveryEnabled()) {
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
      return NextResponse.json({
        ok: true,
        status: invitationDeliveryEnabled() ? "PENDING" : "PREPARED",
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
        await tx.organizationMember.update({
          where: { id: membership.id },
          data: { role: role!, canDeleteControls, ...(workflowPermissions ? { workflowPermissions } : {}) },
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
