import { NextResponse } from "next/server";
import { z } from "zod";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { currentAppVersion } from "@/lib/release-notes";
import {
  context,
  checkOrigin,
  body,
  failure,
  ApiError,
  requireAdmin,
  requireCloudStorage,
  requireCloudWriteAccess,
  requireWorkflowPermission,
  requireModule,
} from "@/lib/kfid/server";
import { hasWorkflowPermission } from "@/lib/workflow/permissions";
import { read } from "@/lib/kfid/storage";
import { mergePreferences, preferencesSchema } from "@/lib/kfid/preferences";
import { writeUserPreferences } from "@/lib/calendar/link-store";
import { WORK_AREAS } from "@/lib/workflow/work-profile";
import { customerSchema } from "@/lib/kfid/customer-schema";
import { legalStatus } from "@/lib/legal";
import { DEFAULT_REPORT_BRANDING, reportBrandingSchema } from "@/lib/kfid/report-branding";
import { extractLogoPrimary } from "@/lib/logo-color";
import { isHintekOrganization } from "@/lib/branding";
import { serverExtensions } from "@/lib/extensions/server";
import { readMaintenance, writeMaintenance } from "@/lib/workflow/maintenance-setting";
import { riskExceptionOn } from "@/lib/workflow/risk-step";
import { creditEntryDescription } from "@/lib/ai/surface-labels";
import { EMPTY_WALLET_VIEW, ensureCreditWallet } from "@/lib/credits/ensure-wallet";
import { readCreditSummary } from "@/lib/credits/wallet-summary-server";
import { formatOrgNumber, normalizePartyNumber } from "@/lib/kfid/org-number";
import { companyProfileSchema, mergeCompanyDetails, profileWithMaskedNumber } from "@/lib/kfid/company";
import { staffRegisterOf } from "@/lib/workflow/staff-register";
import { canSeePrices } from "@/lib/workflow/material-prices";
import { priceSettingsOf } from "@/lib/quotes/settings";
import { normalizePostalCode } from "@/lib/postal-code";
import { ensureOwnCompany } from "@/lib/kfid/own-company-server";
import { MODULE_KEYS } from "@/lib/workflow/modules";
import { moduleImpact, saveModuleChanges } from "@/lib/workflow/modules-server";
import { OWN_COMPANY_REFUSAL, ownCompanyFirst } from "@/lib/workflow/own-company";
import { mayReadCustomerRegister } from "@/lib/kfid/customer-access";
import { customerChoices, customerChoiceSearch, customerForOwnWork } from "@/lib/kfid/job-access";

/** The company's settings without the price settings (business secrets, sent apart only to those who may see prices). */
function withoutPriceSettings<T extends { priceSettings?: unknown }>(settings: T): Omit<T, "priceSettings"> {
  const copy = { ...settings };
  delete copy.priceSettings;
  return copy;
}
const idSchema = z.string().min(1).max(100);
const creditEntryRun = { aiReservations: { select: { status: true, surface: true, agentId: true }, take: 1 } } as const;
const creditEntryRow = <T extends { id: string; kind: string; amount: number; description: string; createdAt: Date; aiReservations: { status: string; surface: string | null; agentId: string }[] }>(entry: T) =>
  ({ id: entry.id, amount: entry.amount, description: creditEntryDescription(entry), createdAt: entry.createdAt });
export const dynamic = "force-dynamic";
// The shell's project choices are bounded (quality check 2026-10-05).
const SHELL_OPEN_PROJECTS = 300;
const SHELL_FINISHED_PROJECTS = 50;
const shellProjectSelect = {
  id: true, name: true, description: true, dueDate: true, customerId: true, updatedAt: true, archivedAt: true, closedAt: true,
  // The frame and fixed fields that tasks in the project inherit (2026-09-26).
  startDate: true, responsibleUserId: true, responsibleName: true, client: true, contactPerson: true, reference: true, workSite: true,
  // Personalliggare (steg 0, 2026-10-08): the task editor reminds the person who starts time.
  staffRegister: true,
  facilityId: true, facility: { select: { id: true, name: true, address: true, postalCode: true, city: true } },
} as const;

// The Stripe sandbox exists only with ee/ (Fas 2).
const stripeSandboxAvailable = () => serverExtensions.paymentSandboxAvailable();

async function grantTestCredits(
  tx: Prisma.TransactionClient,
  ctx: Awaited<ReturnType<typeof context>>,
  walletId: string,
  key: string,
  description: string,
) {
  await tx.$queryRaw`SELECT id FROM "CreditWallet" WHERE id=${walletId} FOR UPDATE`;
  if (await tx.creditEntry.findUnique({ where: { requestKey: key } })) return false;
  const [wallet, tracked] = await Promise.all([
    tx.creditWallet.findUniqueOrThrow({ where: { id: walletId } }),
    tx.creditLot.aggregate({ where: { walletId }, _sum: { remaining: true } }),
  ]);
  // Kreditlotter (2026-10-27): a wallet whose balance and lots disagree is no longer evened out here with a hidden LEGACY
  // lot. The difference is shown by `npm run credits:reconcile -- --check` and evened out only by its audited --apply.
  if (wallet.balance !== (tracked._sum.remaining ?? 0))
    throw new ApiError(409, "Kreditsaldot stämmer inte med kreditlotterna. Stäm av plånboken med npm run credits:reconcile innan testkrediter läggs till.");
  await tx.creditLot.create({
    data: {
      walletId,
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
      walletId,
      amount: 100,
      kind: "TEST",
      requestKey: key,
      description,
    },
  });
  await tx.creditWallet.update({
    where: { id: walletId },
    data: { balance: { increment: 100 } },
  });
  return true;
}

const moduleKeysSchema = z.array(z.enum(MODULE_KEYS)).min(1).max(MODULE_KEYS.length);
const moduleChangesSchema = z.object(Object.fromEntries(MODULE_KEYS.map((key) => [key, z.boolean().optional()]))).strict();

export async function GET(request: Request) {
  try {
    const url = new URL(request.url);
    const action = url.searchParams.get("action") || "overview";
    const ctx = await context({ skipLegal: action === "overview" });
    if (action === "overview") {
      // Workflow AI lives in ee/ (2026-09-30); without it the protocol review is off.
      const ai = await serverExtensions.aiOverview();
      const legalRequired = (await legalStatus(ctx)).some(
        (document) => document.required && !document.acceptedAt,
      );
      if (legalRequired)
        return NextResponse.json({
          projects: [],
          wallet: { balance: 0, testMode: false },
          entries: [],
          settings: null,
          preferences: preferencesSchema.parse({}),
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
      // Bounded (2026-09-26): the overview carries no task or customer lists. Tasks are paged by /api/work-items,
      // and customers are read with action=customers by the forms that show them.
      const canReadShellProjects = ctx.admin || hasWorkflowPermission(ctx.workflowPermissions, "projects", "read");
      const [projects, entries, settings, preferences, entryCount, projectCount] =
        await Promise.all([
          // The shell's project choices (quality check 2026-10-05: every project on every page grew without bound): the
          // projects that accept work, newest first, and the most recently changed closed or archived ones; the editors
          // show those for tasks already in them. The count is sent separately.
          cloudStorage && canReadShellProjects
            ? Promise.all([
                prisma.project.findMany({ where: { organizationId: ctx.organizationId, archivedAt: null, closedAt: null }, orderBy: [{ updatedAt: "desc" }, { id: "asc" }], take: SHELL_OPEN_PROJECTS, select: shellProjectSelect }),
                prisma.project.findMany({ where: { organizationId: ctx.organizationId, OR: [{ archivedAt: { not: null } }, { closedAt: { not: null } }] }, orderBy: [{ updatedAt: "desc" }, { id: "asc" }], take: SHELL_FINISHED_PROJECTS, select: shellProjectSelect }),
              ]).then(([open, finished]) => [...open, ...finished].sort((a, b) => b.updatedAt.getTime() - a.updatedAt.getTime()).map((project) => ({ ...project, staffRegister: staffRegisterOf(project.staffRegister) })))
            : Promise.resolve([]),
          ctx.admin && ctx.wallet ? prisma.creditEntry.findMany({
            where: { walletId: ctx.wallet.id },
            orderBy: { createdAt: "desc" },
            take: 25,
            include: creditEntryRun,
          }).then((rows) => rows.map(creditEntryRow)) : Promise.resolve([]),
          prisma.workspaceSettings.findUnique({
            where: { organizationId: ctx.organizationId },
          }),
          prisma.userPreferences.findUnique({ where: { userId: ctx.user.id } }),
          ctx.admin && ctx.wallet ? prisma.creditEntry.count({ where: { walletId: ctx.wallet.id } }) : Promise.resolve(0),
          cloudStorage && canReadShellProjects ? prisma.project.count({ where: { organizationId: ctx.organizationId } }) : Promise.resolve(0),
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
        projects,
        projectCount,
        // No wallet yet (nothing bought or granted): the same zero balance a fresh wallet shows (2026-10-08).
        wallet: ctx.wallet ?? EMPTY_WALLET_VIEW,
        // Verkligt saldo och giltighetstid (2026-10-28): expired lots left out before the sweep, for the admin's tile.
        credits: ctx.admin ? await readCreditSummary(ctx.organizationId) : null,
        entries,
        entryCount,
        // Priser och offerter (2026-10-09): the price settings are business secrets – never in the shared settings; the
        // company's markup goes along only for someone who may see prices (lib/workflow/material-prices.ts).
        // A sole trader's personal number is whole only for the company's administrators (2026-11-04).
        settings: resolvedSettings ? { ...withoutPriceSettings(resolvedSettings), profile: ctx.admin ? resolvedSettings.profile : profileWithMaskedNumber(resolvedSettings.profile), maintenance: await readMaintenance(ctx.organizationId), riskException: riskExceptionOn(resolvedSettings.profile) } : null,
        prices: canSeePrices({ admin: ctx.admin, permissions: ctx.workflowPermissions }) ? { visible: true, markupPercent: priceSettingsOf(resolvedSettings?.priceSettings).markupPercent } : { visible: false, markupPercent: "" },
        preferences: preferencesSchema.parse(preferences?.data ?? {}),
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
      if (!ctx.admin) throw new ApiError(403, "Bara en företagsadministratör kan göra det.");
      const before = new Date(url.searchParams.get("before") ?? "");
      const older = !ctx.wallet ? [] : await prisma.creditEntry.findMany({
        where: { walletId: ctx.wallet.id, ...(Number.isNaN(before.getTime()) ? {} : { createdAt: { lt: before } }) },
        orderBy: { createdAt: "desc" },
        take: 25,
        include: creditEntryRun,
      });
      return NextResponse.json({ entries: older.map(creditEntryRow) });
    }
    requireCloudStorage(ctx);
    // Företagets moduler (0.39.0): what a module holds, asked before it goes off. Its own rows' counts, for the company's admin.
    if (action === "module_impact") {
      requireAdmin(ctx);
      const keys = moduleKeysSchema.parse(url.searchParams.getAll("module"));
      return NextResponse.json({ impact: await Promise.all(keys.map(async (key) => ({ key, rows: await moduleImpact(ctx.organizationId, key) }))) }, { headers: { "Cache-Control": "private, no-store" } });
    }
    // Customer choices with their facilities (decision 11), read only when a form that lists them is shown.
    if (action === "customers") {
      // A search (q) and a smaller page (limit) for the searchable customer choice and the API/MCP tools
      // (2026-09-30); without them the full register up to 2000 as before.
      const query = (url.searchParams.get("q") ?? "").trim().slice(0, 100);
      const limit = Math.min(2000, Math.max(1, Number(url.searchParams.get("limit")) || 2000));
      // `active=1`: only customers not removed, counted before the limit (the user test 2026-10-31: list_customers with a
      // limit gave too few or none, as removed customers took the places). Without it removed ones come too, for old references.
      const activeOnly = url.searchParams.get("active") === "1";
      // Beslut 10 (2026-11-01): without Kunder a short page for someone who can make a job, and the customers of the person's own jobs.
      if (!mayReadCustomerRegister(ctx)) return NextResponse.json(await customerChoices(ctx, { query, limit, activeOnly }), { headers: { "Cache-Control": "private, no-store" } });
      const customers = await prisma.customer.findMany({
        where: { organizationId: ctx.organizationId, ...(activeOnly ? { deletedAt: null } : {}), ...customerChoiceSearch(query) },
        orderBy: { name: "asc" },
        take: limit,
        include: { facilities: { orderBy: { name: "asc" }, select: { id: true, customerId: true, parentId: true, kind: true, latitude: true, longitude: true, name: true, address: true, postalCode: true, city: true, description: true, isActive: true } } },
      });
      // Eget företag (2026-10-24): the company's own record is a choice of its own, first; the register never lists it.
      return NextResponse.json({ customers: ownCompanyFirst(customers) });
    }
    const id = idSchema.parse(url.searchParams.get("id"));
    if (action === "customer") {
      const customer = await prisma.customer.findFirst({
        where: { id, organizationId: ctx.organizationId, deletedAt: null },
      });
      if (!customer) throw new ApiError(404, "Kunden hittades inte.");
      // Without Kunder: what the person's own job needs, or only the name for a job they may read; otherwise a refusal (beslut 10).
      if (!mayReadCustomerRegister(ctx)) return NextResponse.json(await customerForOwnWork(ctx, customer as unknown as { id: string } & Record<string, unknown>), { headers: { "Cache-Control": "private, no-store" } });
      return NextResponse.json(customer);
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
      if (!ctx.testAdmin || !(ctx.wallet ?? EMPTY_WALLET_VIEW).testMode)
        throw new ApiError(403, "Manuell testpåfyllning är endast tillåten för superadmin i den lokala testmiljön.");
      const requestId = z.string().uuid().parse(input.requestId);
      await prisma.$transaction(async (tx) => {
        // An explicit credit action: the wallet is created here if the company has none yet (2026-10-08).
        const wallet = await ensureCreditWallet(ctx.organizationId, tx);
        const key = `test-manual:${wallet.id}:${requestId}`;
        await grantTestCredits(tx, ctx, wallet.id, key, "100 manuella testkrediter – inget köp");
      });
      return NextResponse.json({ ok: true, addedCredits: 100 });
    }
    if (action === "test_credit") {
      if (!ctx.testAdmin || !(ctx.wallet ?? EMPTY_WALLET_VIEW).testMode)
        throw new ApiError(403, "Testpåfyllning är inte tillåten.");
      await prisma.$transaction(async (tx) => {
        const wallet = await ensureCreditWallet(ctx.organizationId, tx);
        const key = `test-initial:${wallet.id}`;
        if (await tx.creditEntry.findUnique({ where: { requestKey: key } }))
          throw new ApiError(409, "Testkrediterna har redan lagts till.");
        await grantTestCredits(tx, ctx, wallet.id, key, "100 testkrediter – inget köp");
      });
      return NextResponse.json({ ok: true });
    }
    // A guided tour seen or dismissed (2026-09-28): merged into the stored preferences, never a stale full copy.
    if (action === "tour") {
      const tour = z.enum(["formBuilder", "setup", "releaseNotes"]).parse(input.tour);
      const stored = await prisma.userPreferences.findUnique({ where: { userId: ctx.user.id } });
      const current = preferencesSchema.parse(stored?.data ?? {});
      // Versionsnyheter (2026-10-06): the version whose notes were seen, so the next update shows its notice again.
      // A new account that finishes Kom igång has nothing to be told about an update (resa 2026-11-06): the running version counts as seen.
      const firstVersion = tour === "setup" && !current.tours.releaseNotes ? { releaseNotes: currentAppVersion() } : {};
      const data = { ...current, tours: { ...current.tours, ...firstVersion, [tour]: tour === "releaseNotes" ? currentAppVersion() : new Date().toISOString() } };
      await writeUserPreferences(ctx.user.id, data);
      return NextResponse.json({ ok: true });
    }
    // Beslutsstöd (2026-10-01): how often tips are shown and which are muted, merged like a tour.
    if (action === "advisor") {
      const advisor = preferencesSchema.shape.advisor.parse(input.advisor);
      const stored = await prisma.userPreferences.findUnique({ where: { userId: ctx.user.id } });
      const data = { ...preferencesSchema.parse(stored?.data ?? {}), advisor };
      await writeUserPreferences(ctx.user.id, data);
      return NextResponse.json({ ok: true, advisor });
    }
    if (action === "preferences") {
      // Merged onto what is stored (simulation 0.6.3): a device sends only what it changed, so a phone and a tablet open at
      // the same time never write back each other's older choices (lib/kfid/preferences.ts mergePreferences).
      const stored = await prisma.userPreferences.findUnique({ where: { userId: ctx.user.id } });
      const data = mergePreferences(stored?.data ?? {}, input.data);
      await writeUserPreferences(ctx.user.id, data);
      return NextResponse.json({ ok: true });
    }
    // Företagets moduler (0.39.0): the company's admin turns its modules on or off, also in Local, where it is display only.
    // Audited; the data stays either way (lib/workflow/modules-server.ts).
    if (action === "modules") {
      requireAdmin(ctx);
      const change = await saveModuleChanges(ctx, moduleChangesSchema.parse(input.data));
      return NextResponse.json({ ok: true, disabledModules: change.disabled, turnedOff: change.turnedOff, turnedOn: change.turnedOn });
    }
    // What the company works with (Yrkesprofil, 2026-11-01): the company's own answer in the guide. It puts those profiles
    // first where one is chosen and gives the package the admin can confirm; on its own it opens or closes nothing.
    if (action === "work_areas") {
      requireAdmin(ctx);
      const workAreas = [...new Set(z.array(z.enum(WORK_AREAS)).max(WORK_AREAS.length).parse(input.areas))];
      await prisma.$transaction(async (tx) => {
        await tx.$queryRaw`SELECT id FROM "Organization" WHERE id=${ctx.organizationId} FOR UPDATE`;
        const current = await tx.workspaceSettings.findUnique({ where: { organizationId: ctx.organizationId }, select: { profile: true } });
        const organization = await tx.organization.findUniqueOrThrow({ where: { id: ctx.organizationId }, select: { name: true } });
        const profile = { ...((current?.profile ?? {}) as Record<string, unknown>), workAreas };
        await tx.workspaceSettings.upsert({ where: { organizationId: ctx.organizationId }, create: { organizationId: ctx.organizationId, companyName: organization.name, contactEmail: "", profile }, update: { profile } });
      });
      return NextResponse.json({ ok: true });
    }
    // One place for the company's name and contact e-mail (2026-10-07): Företagsuppgifter (the administration
    // route's company_save) writes Organization.name, settings.companyName, settings.contactEmail and profile.email
    // together. This action carries the name and e-mail only from Ställ in Workflow; when it does, it writes the same
    // four places, so the two never drift. Reads use settings.companyName || organization.name everywhere.
    if (action === "settings") {
      requireAdmin(ctx);
      const data = z
        .object({
          companyName: z.string().trim().min(1).max(200).optional(),
          contactEmail: z.union([z.literal(""), z.email()]).optional(),
          reportBranding: reportBrandingSchema.optional(),
          // Ställ in Workflow (2026-10-07): the organisation number, and the address SCB gave for it.
          organizationNumber: z.string().trim().max(20).optional(),
          companyType: z.enum(["company", "soleTrader"]).optional(),
          address: z.string().trim().max(200).optional(),
          postalCode: z.string().trim().max(20).transform(normalizePostalCode).optional(),
          city: z.string().trim().max(100).optional(),
          // Kom igång asks for what the documents need (2026-11-04); each value is checked by the profile's own rules below.
          vatNumber: z.string().trim().max(300).optional(),
          fSkatt: z.boolean().optional(),
          contactName: z.string().trim().max(300).optional(),
          phone: z.string().trim().max(300).optional(),
          billingEmail: z.union([z.literal(""), z.email()]).optional(),
          registeredOffice: z.string().trim().max(300).optional(),
          bankgiro: z.string().trim().max(20).optional(),
          plusgiro: z.string().trim().max(20).optional(),
        })
        .parse(input.data);
      await prisma.$transaction(async (tx) => {
        await tx.$queryRaw`SELECT id FROM "Organization" WHERE id=${ctx.organizationId} FOR UPDATE`;
        const old = await tx.workspaceSettings.findUnique({
          where: { organizationId: ctx.organizationId },
        });
        const organization = await tx.organization.findUniqueOrThrow({ where: { id: ctx.organizationId }, select: { name: true } });
        // The number is checked as the company's kind needs (organisation number, or personal number for a sole trader); the refusals never repeat it.
        const storedProfile = companyProfileSchema.safeParse(old?.profile ?? {});
        const storedType = storedProfile.success ? storedProfile.data.companyType : "company";
        const companyType = data.companyType ?? storedType;
        const numberToCheck = data.organizationNumber ?? (companyType !== storedType && storedProfile.success ? storedProfile.data.organizationNumber : "");
        const orgDigits = numberToCheck ? normalizePartyNumber(numberToCheck, companyType) : null;
        if (numberToCheck && !orgDigits) throw new ApiError(400, companyType === "soleTrader" ? "Personnumret stämmer inte." : "Organisationsnumret stämmer inte.");
        const merged = {
          companyName: data.companyName ?? old?.companyName ?? organization.name,
          contactEmail: data.contactEmail ?? old?.contactEmail ?? "",
          reportPrimary:
            data.reportBranding?.primary ?? old?.reportPrimary ?? DEFAULT_REPORT_BRANDING.primary,
          reportAccent:
            data.reportBranding?.accent ?? old?.reportAccent ?? DEFAULT_REPORT_BRANDING.accent,
          reportSoft:
            data.reportBranding?.soft ?? old?.reportSoft ?? DEFAULT_REPORT_BRANDING.soft,
        };
        await tx.workspaceSettings.upsert({
          where: { organizationId: ctx.organizationId },
          create: { organizationId: ctx.organizationId, ...merged },
          update: merged,
        });
        if (data.companyName !== undefined || data.contactEmail !== undefined) {
          if (data.companyName && data.companyName !== organization.name)
            await tx.organization.update({ where: { id: ctx.organizationId }, data: { name: data.companyName } });
          if (data.contactEmail !== undefined) {
            const current = await tx.workspaceSettings.findUniqueOrThrow({ where: { organizationId: ctx.organizationId }, select: { profile: true } });
            await tx.workspaceSettings.update({ where: { organizationId: ctx.organizationId }, data: { profile: { ...((current.profile ?? {}) as Record<string, unknown>), email: data.contactEmail } } });
          }
        }
        if (orgDigits) {
          // One company per organisation number, as in Skapa konto.
          const taken = await tx.$queryRaw<{ id: string }[]>`SELECT "organizationId" AS id FROM "WorkspaceSettings" WHERE "organizationId" <> ${ctx.organizationId}
            AND regexp_replace(lower(coalesce(profile->>'organizationNumber', '')), '[^a-z0-9]', '', 'g') = ${orgDigits} LIMIT 1`;
          if (taken.length) throw new ApiError(409, "Organisationsnumret används redan av ett annat företag i Workflow.");
          const current = await tx.workspaceSettings.findUniqueOrThrow({ where: { organizationId: ctx.organizationId }, select: { profile: true } });
          const profile = { ...((current.profile ?? {}) as Record<string, unknown>), organizationNumber: formatOrgNumber(orgDigits),
            ...(data.address ? { address: data.address } : {}), ...(data.postalCode ? { postalCode: data.postalCode } : {}), ...(data.city ? { city: data.city } : {}) };
          await tx.workspaceSettings.update({ where: { organizationId: ctx.organizationId }, data: { profile } });
        }
        const extra = { companyType: data.companyType, vatNumber: data.vatNumber, fSkatt: data.fSkatt, contactName: data.contactName, phone: data.phone, billingEmail: data.billingEmail,
          registeredOffice: data.registeredOffice, bankgiro: data.bankgiro, plusgiro: data.plusgiro, address: data.address, postalCode: data.postalCode, city: data.city };
        if (Object.values(extra).some((value) => value !== undefined)) {
          const current = await tx.workspaceSettings.findUniqueOrThrow({ where: { organizationId: ctx.organizationId }, select: { profile: true } });
          await tx.workspaceSettings.update({ where: { organizationId: ctx.organizationId }, data: { profile: mergeCompanyDetails(current.profile, extra) as Prisma.InputJsonValue } });
        }
      });
      return NextResponse.json({ ok: true });
    }
    // Arbetet är redan utfört (2026-11-02): the company's admin allows or turns off the exception from the risk step; what has
    // been done stays. In the profile JSON, locked as work_areas does, and audited. The task route refuses a new exception while it is off.
    if (action === "risk_exception") {
      requireAdmin(ctx);
      const data = z.object({ on: z.boolean() }).strict().parse(input.data);
      await prisma.$transaction(async (tx) => {
        await tx.$queryRaw`SELECT id FROM "Organization" WHERE id=${ctx.organizationId} FOR UPDATE`;
        const current = await tx.workspaceSettings.findUnique({ where: { organizationId: ctx.organizationId }, select: { profile: true } });
        const organization = await tx.organization.findUniqueOrThrow({ where: { id: ctx.organizationId }, select: { name: true } });
        const { riskExceptionOff: _old, ...rest } = (current?.profile ?? {}) as Record<string, unknown>;
        void _old;
        const profile = { ...rest, ...(data.on ? {} : { riskExceptionOff: true }) } as Prisma.InputJsonObject;
        await tx.workspaceSettings.upsert({ where: { organizationId: ctx.organizationId }, create: { organizationId: ctx.organizationId, companyName: organization.name, contactEmail: "", profile }, update: { profile } });
        await tx.administrationEvent.create({ data: { actorId: ctx.user.id, organizationId: ctx.organizationId, action: "company_risk_exception", detail: data.on ? "Undantaget från riskbedömningen tillåts." : "Undantaget från riskbedömningen är avstängt." } });
      });
      return NextResponse.json({ ok: true, riskException: data.on });
    }
    // Underhåll (2026-10-06, decision B1): the company's admin turns the module on or off; the data stays either way.
    if (action === "maintenance") {
      requireAdmin(ctx);
      const data = z.object({ on: z.boolean() }).strict().parse(input.data);
      await writeMaintenance(ctx.organizationId, data.on);
      return NextResponse.json({ ok: true, maintenance: data.on });
    }
    requireCloudStorage(ctx);
    await requireCloudWriteAccess(ctx);
    // Företagets platser (2026-10-24): the company's own record, made on first use; its places are then the same page
    // as a customer's. For those who may edit the company.
    if (action === "own_company") {
      requireAdmin(ctx);
      return NextResponse.json(await ensureOwnCompany(ctx.organizationId));
    }
    if (action === "customer_save") {
      requireModule(ctx, "customers");
      const data = customerSchema.parse(input.data);
      const id = input.id ? idSchema.parse(input.id) : undefined;
      if (id && await prisma.customer.count({ where: { id, organizationId: ctx.organizationId, ownCompany: true } })) throw new ApiError(409, OWN_COMPANY_REFUSAL);
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
      requireModule(ctx, "customers");
      requireAdmin(ctx);
      const id = idSchema.parse(input.id);
      const customer = await prisma.customer.findFirst({
        where: { id, organizationId: ctx.organizationId },
      });
      if (!customer) throw new ApiError(404, "Kunden hittades inte.");
      if (customer.ownCompany) throw new ApiError(409, OWN_COMPANY_REFUSAL);
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
