import { assertFacilityLink } from "@/lib/kfid/facility-server";
import { NextResponse } from "next/server";
import { z } from "zod";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import {
  context,
  checkOrigin,
  body,
  failure,
  ApiError,
  ownedControl,
  requireAdmin,
  requireCloudStorage,
  requireCloudWriteAccess,
  requireControlDelete,
  requireWorkflowPermission,
} from "@/lib/kfid/server";
import { hasWorkflowPermission } from "@/lib/workflow/permissions";
import { duplicateControl } from "@/lib/kfid/duplicate";
import { read, remove } from "@/lib/kfid/storage";
import { preferencesSchema } from "@/lib/kfid/preferences";
import {
  normalizeControl,
  customerSchema,
  validateForCompletion,
} from "@/lib/kfid/model";
import { legalStatus } from "@/lib/legal";
import { reportBrandingSchema } from "@/lib/kfid/report-branding";
import { extractLogoPrimary } from "@/lib/logo-color";
import { isHintekOrganization } from "@/lib/branding";
import { serverExtensions } from "@/lib/extensions/server";
import { closeControlTimers } from "@/lib/workflow/timer-server";
const idSchema = z.string().min(1).max(100);
const json = (v: unknown) => v as Prisma.InputJsonValue;
export const dynamic = "force-dynamic";

// The Stripe sandbox exists only with ee/ (Fas 2).
const stripeSandboxAvailable = () => serverExtensions.paymentSandboxAvailable();

async function grantTestCredits(
  tx: Prisma.TransactionClient,
  ctx: Awaited<ReturnType<typeof context>>,
  key: string,
  description: string,
) {
  await tx.$queryRaw`SELECT id FROM "CreditWallet" WHERE id=${ctx.wallet.id} FOR UPDATE`;
  if (await tx.creditEntry.findUnique({ where: { requestKey: key } })) return false;
  const [wallet, tracked] = await Promise.all([
    tx.creditWallet.findUniqueOrThrow({ where: { id: ctx.wallet.id } }),
    tx.creditLot.aggregate({ where: { walletId: ctx.wallet.id }, _sum: { remaining: true } }),
  ]);
  const untracked = wallet.balance - (tracked._sum.remaining ?? 0);
  if (untracked < 0)
    throw new Error("Testplånbokens kreditlotter överstiger saldot.");
  if (untracked > 0) {
    await tx.creditLot.create({
      data: {
        walletId: ctx.wallet.id,
        origin: "LEGACY",
        sourceKey: `test-balance-backfill:${ctx.wallet.id}`,
        credits: untracked,
        remaining: untracked,
        grantedBy: ctx.user.id,
        reason: "Spårning av tidigare lokalt testsaldo",
        noExpiryReason: "Isolerad lokal testplånbok",
      },
    });
  }
  await tx.creditLot.create({
    data: {
      walletId: ctx.wallet.id,
      origin: "COMPENSATION",
      sourceKey: key,
      credits: 100,
      remaining: 100,
      grantedBy: ctx.user.id,
      reason: description,
      noExpiryReason: "Isolerad lokal testplånbok",
    },
  });
  await tx.creditEntry.create({
    data: {
      walletId: ctx.wallet.id,
      amount: 100,
      kind: "TEST",
      requestKey: key,
      description,
    },
  });
  await tx.creditWallet.update({
    where: { id: ctx.wallet.id },
    data: { balance: { increment: 100 } },
  });
  return true;
}

export async function GET(request: Request) {
  try {
    const url = new URL(request.url);
    const action = url.searchParams.get("action") || "overview";
    const ctx = await context({ skipLegal: action === "overview" });
    const canKfid = (permission: "read" | "create" | "edit" | "complete" | "report") => ctx.admin || hasWorkflowPermission(ctx.workflowPermissions, "kfid", permission);
    if (action === "overview") {
      // HINTEK AI lives in ee/ (2026-09-30); without it the control review is off.
      const ai = await serverExtensions.aiOverview();
      const legalRequired = (await legalStatus(ctx)).some(
        (document) => document.required && !document.acceptedAt,
      );
      if (legalRequired)
        return NextResponse.json({
          controls: [],
          projects: [],
          wallet: { balance: 0, testMode: false },
          entries: [],
          reports: [],
          settings: null,
          preferences: preferencesSchema.parse({}),
          globalSuggestions: {},
          organization: {
            id: ctx.organization.id,
            name: ctx.organization.name,
            storageMode: ctx.organization.storageMode,
          },
          admin: ctx.admin,
          canDeleteControls: ctx.canDeleteControls,
          workflowPermissions: ctx.workflowPermissions,
          testAdmin: ctx.testAdmin,
          aiEnabled: ai.enabled,
          aiConfigured: ai.configured,
          paymentsEnabled: false,
          paymentSandbox: await stripeSandboxAvailable(),
          legalRequired: true,
        });
      const cloudStorage = ctx.organization.storageMode === "HINTEK_CLOUD";
      // Bounded (2026-09-26): the overview carries no control or customer lists. Controls are paged by
      // /api/records and /api/work-items, and customers are read with action=customers by the forms that show them.
      // Only the most recently changed control is sent, for the editor's "Senaste kontrollen" shortcut.
      const [controls, projects, entries, settings, preferences, entryCount] =
        await Promise.all([
          cloudStorage && canKfid("read")
            ? prisma.control.findMany({
                where: { organizationId: ctx.organizationId, deletedAt: null },
                orderBy: { updatedAt: "desc" },
                select: {
                  id: true,
                  number: true,
                  title: true,
                  project: true,
                  performer: true,
                  date: true,
                  status: true,
                  version: true,
                  deletedAt: true,
                  updatedAt: true,
                  postedAt: true,
                  customerId: true,
                  projectId: true,
                  siteId: true,
                  departmentId: true,
                  lastOpenedAt: true,
                },
                take: 1,
              })
            : Promise.resolve([]),
          cloudStorage && (ctx.admin || hasWorkflowPermission(ctx.workflowPermissions, "projects", "read"))
            ? prisma.project.findMany({
                where: { organizationId: ctx.organizationId },
                orderBy: { updatedAt: "desc" },
                select: {
                  id: true,
                  name: true,
                  description: true,
                  dueDate: true,
                  customerId: true,
                  updatedAt: true,
                  archivedAt: true,
                  closedAt: true,
                  // The frame and fixed fields that tasks in the project inherit (2026-09-26).
                  startDate: true,
                  responsibleUserId: true,
                  responsibleName: true,
                  client: true,
                  contactPerson: true,
                  reference: true,
                  workSite: true,
                  facilityId: true,
                  facility: { select: { id: true, name: true, address: true, postalCode: true, city: true } },
                },
              })
            : Promise.resolve([]),
          ctx.admin ? prisma.creditEntry.findMany({
            where: { walletId: ctx.wallet.id },
            orderBy: { createdAt: "desc" },
            take: 25,
          }) : Promise.resolve([]),
          prisma.workspaceSettings.findUnique({
            where: { organizationId: ctx.organizationId },
          }),
          prisma.userPreferences.findUnique({ where: { userId: ctx.user.id } }),
          ctx.admin ? prisma.creditEntry.count({ where: { walletId: ctx.wallet.id } }) : Promise.resolve(0),
        ]);
      let resolvedSettings = settings;
      if (
        settings?.logoPath &&
        !settings.themePrimary &&
        !isHintekOrganization(ctx.organization)
      ) {
        const themePrimary = await read(settings.logoPath)
          .then(extractLogoPrimary)
          .catch(() => null);
        if (themePrimary) {
          await prisma.workspaceSettings.updateMany({
            where: { id: settings.id, themePrimary: null },
            data: { themePrimary },
          });
          resolvedSettings = { ...settings, themePrimary };
        }
      }
      return NextResponse.json({
        controls,
        projects,
        wallet: ctx.wallet,
        entries,
        entryCount,
        reports: cloudStorage && canKfid("report")
          ? await prisma.generatedResult.findMany({
              where: { organizationId: ctx.organizationId, status: "COMPLETE" },
              orderBy: { createdAt: "desc" },
              take: 100,
              select: {
                id: true,
                controlId: true,
                kind: true,
                createdAt: true,
              },
            })
          : [],
        settings: resolvedSettings,
        preferences: preferencesSchema.parse(preferences?.data ?? {}),
        globalSuggestions:
          (await prisma.systemSettings.findUnique({ where: { id: "global" } }))
            ?.suggestions ?? {},
        organization: ctx.organization,
        admin: ctx.admin,
        canDeleteControls: ctx.canDeleteControls,
        workflowPermissions: ctx.workflowPermissions,
        testAdmin: ctx.testAdmin,
        aiEnabled: ai.enabled,
        aiConfigured: ai.configured,
        paymentsEnabled: false,
        paymentSandbox: await stripeSandboxAvailable(),
        legalRequired: false,
      });
    }
    // Older credit history for admins, one bounded page at a time (2026-09-26).
    if (action === "creditEntries") {
      if (!ctx.admin) throw new ApiError(403, "Företagsadministratör krävs.");
      const before = new Date(url.searchParams.get("before") ?? "");
      const older = await prisma.creditEntry.findMany({
        where: { walletId: ctx.wallet.id, ...(Number.isNaN(before.getTime()) ? {} : { createdAt: { lt: before } }) },
        orderBy: { createdAt: "desc" },
        take: 25,
      });
      return NextResponse.json({ entries: older });
    }
    requireCloudStorage(ctx);
    // Customer choices with their facilities (decision 11), read only when a form that lists them is shown.
    if (action === "customers") {
      // A search (q) and a smaller page (limit) for the searchable customer choice and the API/MCP tools
      // (2026-09-30); without them the full register up to 2000 as before.
      const query = (url.searchParams.get("q") ?? "").trim().slice(0, 100);
      const limit = Math.min(2000, Math.max(1, Number(url.searchParams.get("limit")) || 2000));
      const customers = await prisma.customer.findMany({
        where: { organizationId: ctx.organizationId, ...(query ? { OR: ["name", "company", "email", "city", "phone"].map((field) => ({ [field]: { contains: query, mode: "insensitive" as const } })) } : {}) },
        orderBy: { name: "asc" },
        take: limit,
        include: { facilities: { orderBy: { name: "asc" }, select: { id: true, customerId: true, name: true, address: true, postalCode: true, city: true, description: true, isActive: true } } },
      });
      return NextResponse.json({ customers });
    }
    if (action === "latest") {
      requireWorkflowPermission(ctx, "kfid", "read");
      const current = url.searchParams.get("currentId") || "";
      const visits = await prisma.controlVisit.findMany({
        where: {
          userId: ctx.user.id,
          organizationId: ctx.organizationId,
          controlId: { not: current },
        },
        orderBy: { openedAt: "desc" },
        take: 20,
      });
      const active = await prisma.control.findMany({
        where: {
          organizationId: ctx.organizationId,
          deletedAt: null,
          id: { in: visits.map((v) => v.controlId) },
        },
        select: { id: true },
      });
      const recent = visits.find((v) =>
        active.some((c) => c.id === v.controlId),
      );
      const control =
        recent ??
        (await prisma.control.findFirst({
          where: {
            organizationId: ctx.organizationId,
            deletedAt: null,
            ...(current ? { id: { not: current } } : {}),
          },
          orderBy: { number: "desc" },
          select: { id: true },
        }));
      return NextResponse.json({
        id:
          recent?.controlId ?? (control as { id?: string } | null)?.id ?? null,
      });
    }
    const id = idSchema.parse(url.searchParams.get("id"));
    if (action === "customer") {
      const customer = await prisma.customer.findFirst({
        where: { id, organizationId: ctx.organizationId, deletedAt: null },
      });
      if (!customer) throw new ApiError(404, "Kunden hittades inte.");
      return NextResponse.json(customer);
    }
    const control = await ownedControl(ctx, id);
    if (action === "control") {
      requireWorkflowPermission(ctx, "kfid", "read");
      await prisma.controlVisit.upsert({
        where: {
          userId_organizationId_controlId: {
            userId: ctx.user.id,
            organizationId: ctx.organizationId,
            controlId: id,
          },
        },
        create: {
          userId: ctx.user.id,
          organizationId: ctx.organizationId,
          controlId: id,
        },
        update: { openedAt: new Date() },
      });
      const [attachments, revisions, timeEntries] = await Promise.all([
        prisma.attachment.findMany({
          where: { controlId: id, organizationId: ctx.organizationId },
        }),
        prisma.controlRevision.findMany({
          where: { controlId: id },
          orderBy: { version: "desc" },
          take: 25,
          select: { id: true, version: true, createdAt: true, createdBy: true },
        }),
        // Reported time and the caller's own running timer for the shared editor header (2026-09-27).
        prisma.workflowTimeEntry.findMany({ where: { controlId: id }, select: { userId: true, durationSec: true, endedAt: true, startedAt: true } }),
      ]);
      const now = Date.now();
      const { lockToken, ...safe } = control;
      void lockToken;
      return NextResponse.json({
        ...safe,
        attachments: attachments.map(({ storagePath, ...a }) => {
          void storagePath;
          return a;
        }),
        revisions,
        totalDurationSec: timeEntries.reduce((sum, entry) => sum + (entry.endedAt ? entry.durationSec : Math.max(0, Math.floor((now - entry.startedAt.getTime()) / 1000))), 0),
        timerRunning: timeEntries.some((entry) => !entry.endedAt && entry.userId === ctx.user.id),
      });
    }
    if (action === "revision") {
      requireWorkflowPermission(ctx, "kfid", "read");
      const version = z.coerce
        .number()
        .int()
        .positive()
        .parse(url.searchParams.get("version"));
      const revision = await prisma.controlRevision.findUnique({
        where: { controlId_version: { controlId: id, version } },
      });
      if (!revision) throw new ApiError(404, "Versionen hittades inte.");
      return NextResponse.json(revision);
    }
    throw new ApiError(400, "Okänd åtgärd.");
  } catch (e) {
    return failure(e);
  }
}

export async function POST(request: Request) {
  try {
    checkOrigin(request);
    const input = await body(request);
    const ctx = await context();
    const action = z.string().parse(input.action);
    if (action === "superadmin_test_credit") {
      if (!ctx.testAdmin || !ctx.wallet.testMode)
        throw new ApiError(403, "Manuell testpåfyllning är endast tillåten för superadmin i den lokala testmiljön.");
      const requestId = z.string().uuid().parse(input.requestId);
      await prisma.$transaction(async (tx) => {
        const key = `test-manual:${ctx.wallet.id}:${requestId}`;
        await grantTestCredits(tx, ctx, key, "100 manuella testkrediter – inget köp");
      });
      return NextResponse.json({ ok: true, addedCredits: 100 });
    }
    if (action === "test_credit") {
      if (!ctx.testAdmin || !ctx.wallet.testMode)
        throw new ApiError(403, "Testpåfyllning är inte tillåten.");
      await prisma.$transaction(async (tx) => {
        const key = `test-initial:${ctx.wallet.id}`;
        if (await tx.creditEntry.findUnique({ where: { requestKey: key } }))
          throw new ApiError(409, "Testkrediterna har redan lagts till.");
        await grantTestCredits(tx, ctx, key, "100 testkrediter – inget köp");
      });
      return NextResponse.json({ ok: true });
    }
    // A guided tour seen or dismissed (2026-09-28): merged into the stored preferences, never a stale full copy.
    if (action === "tour") {
      const tour = z.enum(["formBuilder"]).parse(input.tour);
      const stored = await prisma.userPreferences.findUnique({ where: { userId: ctx.user.id } });
      const current = preferencesSchema.parse(stored?.data ?? {});
      const data = { ...current, tours: { ...current.tours, [tour]: new Date().toISOString() } };
      await prisma.userPreferences.upsert({ where: { userId: ctx.user.id }, create: { userId: ctx.user.id, data }, update: { data } });
      return NextResponse.json({ ok: true });
    }
    // Beslutsstöd (2026-10-01): how often tips are shown and which are muted, merged like a tour.
    if (action === "advisor") {
      const advisor = preferencesSchema.shape.advisor.parse(input.advisor);
      const stored = await prisma.userPreferences.findUnique({ where: { userId: ctx.user.id } });
      const data = { ...preferencesSchema.parse(stored?.data ?? {}), advisor };
      await prisma.userPreferences.upsert({ where: { userId: ctx.user.id }, create: { userId: ctx.user.id, data }, update: { data } });
      return NextResponse.json({ ok: true, advisor });
    }
    if (action === "preferences") {
      const data = preferencesSchema.parse(input.data);
      await prisma.userPreferences.upsert({
        where: { userId: ctx.user.id },
        create: { userId: ctx.user.id, data },
        update: { data },
      });
      return NextResponse.json({ ok: true });
    }
    if (action === "settings") {
      requireAdmin(ctx);
      const data = z
        .object({
          companyName: z.string().trim().min(1).max(200),
          contactEmail: z.union([z.literal(""), z.email()]),
          suggestions: z.record(
            z.string(),
            z.array(z.string().max(200)).max(100),
          ),
          reportBranding: reportBrandingSchema.optional(),
        })
        .parse(input.data);
      await prisma.$transaction(async (tx) => {
        await tx.$queryRaw`SELECT id FROM "Organization" WHERE id=${ctx.organizationId} FOR UPDATE`;
        const old = await tx.workspaceSettings.findUnique({
          where: { organizationId: ctx.organizationId },
        });
        const merged = {
          companyName: data.companyName,
          contactEmail: data.contactEmail,
          reportPrimary:
            data.reportBranding?.primary ?? old?.reportPrimary ?? "#174C72",
          reportAccent:
            data.reportBranding?.accent ?? old?.reportAccent ?? "#2E7EAA",
          reportSoft:
            data.reportBranding?.soft ?? old?.reportSoft ?? "#EDF5F9",
          suggestions: {
            ...((old?.suggestions as Record<string, string[]>) ?? {}),
            ...data.suggestions,
          },
        };
        await tx.workspaceSettings.upsert({
          where: { organizationId: ctx.organizationId },
          create: { organizationId: ctx.organizationId, ...merged },
          update: merged,
        });
      });
      return NextResponse.json({ ok: true });
    }
    requireCloudStorage(ctx);
    if (action === "release") {
      await prisma.control.updateMany({
        where: {
          id: idSchema.parse(input.id),
          organizationId: ctx.organizationId,
          lockToken: idSchema.parse(input.lockToken),
        },
        data: { lockToken: null, lockedBy: null, lockExpiresAt: null },
      });
      return NextResponse.json({ ok: true });
    }
    await requireCloudWriteAccess(ctx);
    if (action === "duplicate") {
      requireWorkflowPermission(ctx, "kfid", "create");
      return NextResponse.json(
        await duplicateControl(
          ctx,
          idSchema.parse(input.sourceId),
          z.uuid().parse(input.id),
          idSchema.parse(input.lockToken),
          input.data,
          input.customerId ? idSchema.parse(input.customerId) : null,
          input.projectId ? idSchema.parse(input.projectId) : null,
          input.siteId ? idSchema.parse(input.siteId) : null,
          input.departmentId ? idSchema.parse(input.departmentId) : null,
        ),
      );
    }
    if (action === "save") {
      const id = idSchema.parse(input.id);
      const version = z.number().int().nonnegative().parse(input.version);
      const lockToken = idSchema.parse(input.lockToken);
      const data = normalizeControl(input.data);
      if (!data.meta.proj.trim())
        throw new ApiError(
          400,
          "Ange projekt eller anläggning innan du sparar.",
        );
      const status = z
        .enum(["DRAFT", "COMPLETED"])
        .parse(input.status ?? "DRAFT");
      const existingControl = await prisma.control.findFirst({ where: { id, organizationId: ctx.organizationId }, select: { status: true } });
      requireWorkflowPermission(ctx, "kfid", existingControl ? "edit" : "create");
      if (status === "COMPLETED" && existingControl?.status !== "COMPLETED") requireWorkflowPermission(ctx, "kfid", "complete");
      if (status === "COMPLETED") {
        const completion = validateForCompletion(data, {
          attachmentCount: await prisma.attachment.count({
            where: { controlId: id, organizationId: ctx.organizationId },
          }),
        });
        if (!completion.complete)
          throw new ApiError(
            422,
            `Kontrollen kan inte färdigställas. ${completion.errors[0].message}`,
          );
      }
      const customerId = input.customerId
        ? idSchema.parse(input.customerId)
        : null;
      const projectId = input.projectId ? idSchema.parse(input.projectId) : null;
      const siteId = input.siteId ? idSchema.parse(input.siteId) : null;
      const departmentId = input.departmentId ? idSchema.parse(input.departmentId) : null;
      const priorLocation = await prisma.control.findFirst({
        where: { id, organizationId: ctx.organizationId },
        select: { siteId: true, departmentId: true, customerId: true, projectId: true, facilityId: true },
      });
      // The customer facility (decision 11): a new control in a project takes the project's facility; later it is kept
      // while the customer stays the same. An explicit facilityId (for example from Local) is validated like a task's.
      let facilityId: string | null = priorLocation && priorLocation.customerId === customerId ? priorLocation.facilityId : null;
      if (input.facilityId !== undefined) {
        facilityId = input.facilityId ? idSchema.parse(input.facilityId) : null;
        await assertFacilityLink(ctx.organizationId, { facilityId, customerId, previousFacilityId: priorLocation?.facilityId });
      }
      if (departmentId && !siteId)
        throw new ApiError(400, "Välj plats före avdelning.");
      // After creation a control changes project only through the project's Koppla/Flytta, which writes history.
      if (priorLocation && priorLocation.projectId !== projectId)
        throw new ApiError(409, "Byt projekt via projektets Koppla befintlig uppgift, så att bytet hamnar i historiken.");
      if (siteId && !(await prisma.site.findFirst({
        where: { id: siteId, organizationId: ctx.organizationId,
          ...(priorLocation?.siteId === siteId ? {} : { isActive: true }) },
        select: { id: true },
      }))) throw new ApiError(400, "Platsen hittades inte eller är pausad.");
      if (departmentId && !(await prisma.department.findFirst({
        where: { id: departmentId, siteId: siteId!, organizationId: ctx.organizationId,
          ...(priorLocation?.departmentId === departmentId ? {} : { isActive: true }) },
        select: { id: true },
      }))) throw new ApiError(400, "Avdelningen hittades inte eller är pausad.");
      if (
        customerId &&
        !(await prisma.customer.findFirst({
          where: {
            id: customerId,
            organizationId: ctx.organizationId,
            deletedAt: null,
          },
        }))
      )
        throw new ApiError(400, "Kunden hittades inte.");
      if (projectId) {
        const project = await prisma.project.findFirst({ where: { id: projectId, organizationId: ctx.organizationId }, select: { id: true, archivedAt: true, closedAt: true, customerId: true, facilityId: true } });
        if (!project) throw new ApiError(400, "Projektet hittades inte.");
        if (project.archivedAt) throw new ApiError(409, "Återställ projektet innan du sparar kontrollen.");
        if (project.closedAt) throw new ApiError(409, "Projektet är avslutat. Återöppna projektet innan du sparar en kontroll i det.");
        // A new control in a project, or a changed customer/project, takes the project's customer (2026-09-26);
        // an older control that already differs keeps saving and is shown as a deviation on the project.
        const changed = !priorLocation || priorLocation.projectId !== projectId || priorLocation.customerId !== customerId;
        if (project.customerId && customerId !== project.customerId && changed) throw new ApiError(400, "En kontroll i projektet har projektets kund.");
        if (!priorLocation && input.facilityId === undefined && project.facilityId && project.customerId === customerId) facilityId = project.facilityId;
      }
      const result = await prisma.$transaction(async (tx) => {
        await tx.$queryRaw`SELECT id FROM "Control" WHERE id=${id} FOR UPDATE`;
        const old = await tx.control.findUnique({ where: { id } });
        const values = {
          title: data.meta.name?.trim() || data.meta.proj,
          project: data.meta.proj,
          performer: data.meta.perf,
          date: data.meta.date,
          data: json(data),
          status,
          customerId,
          facilityId,
          projectId,
          siteId,
          departmentId,
          updatedBy: ctx.user.id,
          lockToken,
          lockedBy: ctx.user.id,
          lockExpiresAt: new Date(Date.now() + 90_000),
        };
        if (old) {
          if (old.organizationId !== ctx.organizationId || old.deletedAt)
            throw new ApiError(404, "Kontrollen hittades inte.");
          if (
            old.lockToken &&
            old.lockToken !== lockToken &&
            old.lockExpiresAt &&
            old.lockExpiresAt > new Date()
          )
            throw new ApiError(
              423,
              "Kontrollen redigeras i en annan flik eller av en annan användare.",
            );
          if (old.status === "COMPLETED")
            throw new ApiError(
              409,
              "Kontrollen är färdigställd. Skapa en kopia för att ändra.",
            );
          const changed = await tx.control.updateMany({
            where: { id, organizationId: ctx.organizationId, version },
            data: { ...values, version: { increment: 1 } },
          });
          if (!changed.count)
            throw new ApiError(
              409,
              "En nyare version finns. Dina ändringar finns kvar i formuläret; öppna senaste versionen innan du sparar igen.",
            );
        } else {
          if (version !== 0)
            throw new ApiError(409, "Kontrollen finns inte längre.");
          await tx.control.create({
            data: {
              id,
              organizationId: ctx.organizationId,
              createdBy: ctx.user.id,
              ...values,
            },
          });
        }
        const nextVersion = old ? version + 1 : 1;
        // Completing stops every running timer on the control.
        if (status === "COMPLETED") await closeControlTimers(tx, ctx, { id, title: data.meta.proj || "Kontroll" }, new Date());
        await tx.controlRevision.create({
          data: {
            controlId: id,
            version: nextVersion,
            data: json(data),
            createdBy: ctx.user.id,
          },
        });
        return { id, version: nextVersion, status };
      });
      return NextResponse.json(result);
    }
    if (action === "lock") {
      requireWorkflowPermission(ctx, "kfid", "edit");
      const id = idSchema.parse(input.id),
        lockToken = idSchema.parse(input.lockToken);
      await ownedControl(ctx, id);
      const changed = await prisma.control.updateMany({
        where: {
          id,
          organizationId: ctx.organizationId,
          OR: [
            { lockToken: null },
            { lockToken },
            { lockExpiresAt: { lt: new Date() } },
          ],
        },
        data: {
          lockToken,
          lockedBy: ctx.user.id,
          lockExpiresAt: new Date(Date.now() + 90_000),
          lastOpenedAt: new Date(),
        },
      });
      if (!changed.count)
        throw new ApiError(
          423,
          "Kontrollen redigeras redan. Du kan läsa den eller spara en kopia.",
        );
      return NextResponse.json({ ok: true });
    }
    if (["delete", "restore", "purge"].includes(action)) {
      requireWorkflowPermission(ctx, "kfid", "edit");
      requireControlDelete(ctx);
      const id = idSchema.parse(input.id);
      const item = await prisma.control.findFirst({
        where: { id, organizationId: ctx.organizationId },
      });
      if (!item) throw new ApiError(404, "Kontrollen hittades inte.");
      if (action === "purge") {
        if (!item.deletedAt)
          throw new ApiError(
            400,
            "Flytta kontrollen till papperskorgen först.",
          );
        const paths = await prisma.$transaction(async (tx) => {
          await tx.$queryRaw`SELECT id FROM "Control" WHERE id=${id} FOR UPDATE`;
          const current = await tx.control.findFirst({
            where: {
              id,
              organizationId: ctx.organizationId,
              deletedAt: { not: null },
            },
          });
          if (!current) throw new ApiError(409, "Kontrollen har återställts.");
          const files = await tx.attachment.findMany({
            where: { controlId: id },
          });
          const results = await tx.generatedResult.findMany({
            where: { controlId: id, organizationId: ctx.organizationId },
          });
          if (results.some((r) => r.status === "PENDING"))
            throw new ApiError(409, "Vänta tills rapportgenereringen är klar.");
          await tx.generatedResult.deleteMany({
            where: { controlId: id, organizationId: ctx.organizationId },
          });
          await tx.control.delete({ where: { id } });
          return [
            ...files.map((f) => f.storagePath),
            ...results.flatMap((r) => (r.storagePath ? [r.storagePath] : [])),
          ];
        });
        await Promise.all(paths.map(remove));
      } else
        await prisma.$transaction(async (tx) => {
          await tx.control.update({
            where: { id },
            data: {
              deletedAt: action === "delete" ? new Date() : null,
              lockToken: null,
              lockedBy: null,
              lockExpiresAt: null,
            },
          });
          // A deleted control keeps no running timer.
          if (action === "delete") await closeControlTimers(tx, ctx, { id, title: item.title || "Kontroll" }, new Date());
        });
      return NextResponse.json({ ok: true });
    }
    if (action === "customer_save") {
      const data = customerSchema.parse(input.data);
      const id = input.id ? idSchema.parse(input.id) : undefined;
      // Governed by its own permission, not open to every member regardless of role (2026-10-02, decision 2.2:
      // "om den inte har rättigheter så får den inte det men om den har rättighet att ändra får den göra det").
      requireWorkflowPermission(ctx, "customers", id ? "edit" : "create");
      if (id) {
        const updated = await prisma.customer.updateMany({
          where: {
            id,
            organizationId: ctx.organizationId,
            deletedAt: null,
            version: z.number().int().positive().parse(input.version),
          },
          data: { ...data, version: { increment: 1 } },
        });
        if (!updated.count)
          throw new ApiError(409, "Kunden har ändrats. Hämta listan igen.");
        return NextResponse.json({ id });
      }
      const customer = await prisma.customer.create({
        data: { ...data, organizationId: ctx.organizationId },
      });
      return NextResponse.json({ id: customer.id });
    }
    if (
      ["customer_delete", "customer_restore", "customer_purge"].includes(action)
    ) {
      requireAdmin(ctx);
      const id = idSchema.parse(input.id);
      const customer = await prisma.customer.findFirst({
        where: { id, organizationId: ctx.organizationId },
      });
      if (!customer) throw new ApiError(404, "Kunden hittades inte.");
      if (action === "customer_purge") {
        if (!customer.deletedAt)
          throw new ApiError(400, "Flytta kunden till papperskorgen först.");
        await prisma.customer.delete({ where: { id } });
      } else
        await prisma.customer.update({
          where: { id },
          data: {
            deletedAt: action === "customer_delete" ? new Date() : null,
            version: { increment: 1 },
          },
        });
      return NextResponse.json({ ok: true });
    }
    throw new ApiError(400, "Okänd åtgärd.");
  } catch (e) {
    return failure(e);
  }
}
