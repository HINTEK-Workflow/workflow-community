import { Prisma } from "@prisma/client";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { hashPassword } from "@/lib/auth/password";
import { ApiError, type Context } from "@/lib/kfid/server";
import { absoluteUrl } from "@/lib/env";
import { knownNodeIds, nodePath } from "@/lib/operator/machines";
import { maintenancePort } from "@/lib/operator/maintenance-port";
import { causesSchema, INACTIVITY_MAX, INACTIVITY_MIN, INTAKES, normalizeUsername, operatorPagePath, operatorPasswordProblem, REPORT_STATUS_TONE, reportStatusLabel, SEVERITY_LABELS, type Severity } from "@/lib/operator/rules";
import { ensureOperatorSettings, newPageKey, productOperatorSettings, settingsView } from "@/lib/operator/settings-server";
import { revokeOperatorSessions } from "@/lib/operator/session";
import { isGuid } from "@/lib/auth/microsoft-core";

/**
 * Administration › Operatörskonton (2026-10-30), for the company's admin in Cloud: the accounts, what each sees,
 * passwords, Aktiv/Spärrad and Ta bort, and the page's settings. The caller has checked session, company, admin, Cloud
 * and Origin (app/api/operator-accounts/route.ts). Every change is written to the company's Administrationshistorik.
 */
const audit = (ctx: Context, action: string, detail: string, db: Pick<typeof prisma, "administrationEvent"> = prisma) =>
  db.administrationEvent.create({ data: { actorId: ctx.user.id, organizationId: ctx.organizationId, action, detail: detail.slice(0, 500) } });

const nodeIds = z.array(z.string().min(1).max(120)).max(500);
export const operatorAdminAction = z.discriminatedUnion("action", [
  z.object({ action: z.literal("create"), username: z.string().max(200), password: z.string().max(400), active: z.boolean().default(true), nodeIds: nodeIds.default([]) }),
  z.object({ action: z.literal("update"), id: z.string().min(1).max(64), active: z.boolean().optional(), nodeIds: nodeIds.optional() }),
  z.object({ action: z.literal("password"), id: z.string().min(1).max(64), password: z.string().max(400) }),
  z.object({ action: z.literal("remove"), id: z.string().min(1).max(64) }),
  z.object({ action: z.literal("settings"), causes: causesSchema.optional(), intake: z.enum(INTAKES).optional(),
    inactivityMinutes: z.number().int().min(INACTIVITY_MIN, `Minst ${INACTIVITY_MIN} minuter.`).max(INACTIVITY_MAX, `Högst ${INACTIVITY_MAX} minuter.`).optional(),
    aiTroubleshooting: z.boolean().optional() }),
  z.object({ action: z.literal("microsoft"), enabled: z.boolean().optional(), groupId: z.string().trim().max(64).optional(), groupName: z.string().trim().max(120).optional() }),
  z.object({ action: z.literal("new_address") }),
  z.object({ action: z.literal("approve"), reportId: z.string().min(1).max(64) }),
  z.object({ action: z.literal("reject"), reportId: z.string().min(1).max(64) }),
]);
export type OperatorAdminAction = z.infer<typeof operatorAdminAction>;

async function accountOf(ctx: Context, id: string) {
  const account = await prisma.operatorAccount.findFirst({ where: { id, organizationId: ctx.organizationId }, select: { id: true, username: true, displayName: true, kind: true, active: true } });
  if (!account) throw new ApiError(404, "Operatörskontot hittades inte.");
  return account;
}
const nameOf = (account: { username: string; displayName: string; kind: string }) => account.kind === "microsoft" ? account.displayName || "Microsoft-konto" : account.username;

/** Everything the admin's page shows. */
export async function operatorAdminView(ctx: Context) {
  const [row, product, tree] = await Promise.all([ensureOperatorSettings(ctx.organizationId), productOperatorSettings(), maintenancePort().tree(ctx.organizationId)]);
  const [accounts, pending] = await Promise.all([
    prisma.operatorAccount.findMany({
      where: { organizationId: ctx.organizationId }, orderBy: [{ kind: "asc" }, { usernameKey: "asc" }], take: 500,
      select: { id: true, username: true, displayName: true, kind: true, shared: true, active: true, lastLoginAt: true, createdAt: true, machines: { select: { nodeId: true } } },
    }),
    prisma.operatorFaultReport.findMany({
      where: { organizationId: ctx.organizationId, status: "pending" }, orderBy: { createdAt: "desc" }, take: 100,
      select: { id: true, accountName: true, reporterName: true, machineLabel: true, cause: true, text: true, severity: true, createdAt: true, _count: { select: { photos: true } } },
    }),
  ]);
  const settings = settingsView(row);
  const known = new Set(tree.map((node) => node.id));
  return {
    settings,
    pageUrl: absoluteUrl(operatorPagePath(settings.pageKey)),
    product,
    adapter: maintenancePort().name,
    // In reading order (each node after the one above it): the account's list and Maskiner som syns indent by the path.
    tree: tree.map((node) => ({ ...node, path: nodePath(tree, node.id) })).sort((a, b) => a.path.localeCompare(b.path, "sv")),
    accounts: accounts.map((account) => {
      const chosen = account.machines.map((item) => item.nodeId).filter((id) => known.has(id));
      return {
        id: account.id, name: nameOf(account), username: account.username, kind: account.kind, shared: account.shared, active: account.active,
        lastLoginAt: account.lastLoginAt?.toISOString() ?? null, createdAt: account.createdAt.toISOString(), nodeIds: chosen,
        scopeLabel: chosen.length ? chosen.map((id) => nodePath(tree, id)).join(", ") : "inga maskiner",
        needsMachines: account.kind === "microsoft" && account.active && !chosen.length,
      };
    }),
    pending: pending.map((report) => ({
      id: report.id, machine: report.machineLabel, cause: report.cause, text: report.text, severity: SEVERITY_LABELS[report.severity as Severity] ?? report.severity,
      by: report.reporterName ? `${report.reporterName} (${report.accountName})` : report.accountName, at: report.createdAt.toISOString(), photos: report._count.photos,
      status: reportStatusLabel("pending", null), tone: REPORT_STATUS_TONE["Väntar på godkännande"],
    })),
  };
}

export async function createOperatorAccount(ctx: Context, input: Extract<OperatorAdminAction, { action: "create" }>) {
  const name = normalizeUsername(input.username);
  if (!name.ok) throw new ApiError(400, name.error);
  const problem = operatorPasswordProblem(input.password, { username: name.username, company: ctx.organization.name });
  if (problem) throw new ApiError(400, problem);
  const tree = await maintenancePort().tree(ctx.organizationId);
  const chosen = knownNodeIds(tree, input.nodeIds);
  const passwordHash = await hashPassword(input.password);
  try {
    return await prisma.$transaction(async (tx) => {
      const created = await tx.operatorAccount.create({
        data: { organizationId: ctx.organizationId, username: name.username, usernameKey: name.key, kind: "password", passwordHash, shared: !name.email, active: input.active, createdById: ctx.user.id,
          machines: chosen.length ? { create: chosen.map((nodeId) => ({ nodeId })) } : undefined },
        select: { id: true },
      });
      await audit(ctx, "operator_account_created", `Skapade operatörskontot ”${name.username}” (${input.active ? "aktivt" : "spärrat"}, ${chosen.length ? `ser ${chosen.map((id) => nodePath(tree, id)).join(", ")}` : "inga maskiner"}).`, tx);
      return created;
    });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") throw new ApiError(409, "Det finns redan ett operatörskonto med det namnet.");
    throw error;
  }
}

export async function updateOperatorAccount(ctx: Context, input: Extract<OperatorAdminAction, { action: "update" }>) {
  const account = await accountOf(ctx, input.id);
  const tree = input.nodeIds ? await maintenancePort().tree(ctx.organizationId) : [];
  const chosen = input.nodeIds ? knownNodeIds(tree, input.nodeIds) : null;
  await prisma.$transaction(async (tx) => {
    if (input.active !== undefined && input.active !== account.active) {
      await tx.operatorAccount.updateMany({ where: { id: account.id, organizationId: ctx.organizationId }, data: { active: input.active } });
      await audit(ctx, input.active ? "operator_account_unblocked" : "operator_account_blocked", `${input.active ? "Aktiverade" : "Spärrade"} operatörskontot ”${nameOf(account)}”.`, tx);
    }
    if (chosen) {
      await tx.operatorAccountMachine.deleteMany({ where: { accountId: account.id, organizationId: ctx.organizationId } });
      if (chosen.length) await tx.operatorAccountMachine.createMany({ data: chosen.map((nodeId) => ({ accountId: account.id, organizationId: ctx.organizationId, nodeId })) });
      await audit(ctx, "operator_account_machines", `Operatörskontot ”${nameOf(account)}” ser ${chosen.length ? chosen.map((id) => nodePath(tree, id)).join(", ") : "inga maskiner"}.`, tx);
    }
  });
  // Spärrad: every session of the account ends at once.
  if (input.active === false) await revokeOperatorSessions(ctx.organizationId, account.id);
}

export async function setOperatorPassword(ctx: Context, input: Extract<OperatorAdminAction, { action: "password" }>) {
  const account = await accountOf(ctx, input.id);
  if (account.kind !== "password") throw new ApiError(409, "Ett Microsoft-konto har inget lösenord i Workflow.");
  const problem = operatorPasswordProblem(input.password, { username: account.username, company: ctx.organization.name });
  if (problem) throw new ApiError(400, problem);
  await prisma.operatorAccount.updateMany({ where: { id: account.id, organizationId: ctx.organizationId }, data: { passwordHash: await hashPassword(input.password) } });
  await revokeOperatorSessions(ctx.organizationId, account.id);
  await audit(ctx, "operator_account_password", `Bytte lösenord för operatörskontot ”${nameOf(account)}”.`);
}

/** Ta bort: the account, its machines and sessions go; its reports stay with the account's name. */
export async function removeOperatorAccount(ctx: Context, input: Extract<OperatorAdminAction, { action: "remove" }>) {
  const account = await accountOf(ctx, input.id);
  await prisma.$transaction(async (tx) => {
    await tx.operatorAccount.deleteMany({ where: { id: account.id, organizationId: ctx.organizationId } });
    await audit(ctx, "operator_account_removed", `Tog bort operatörskontot ”${nameOf(account)}”.`, tx);
  });
}

export async function saveOperatorSettings(ctx: Context, input: Extract<OperatorAdminAction, { action: "settings" }>) {
  await ensureOperatorSettings(ctx.organizationId);
  const changes: string[] = [];
  if (input.causes) changes.push(`orsaker: ${input.causes.join(", ")}`);
  if (input.intake) changes.push(input.intake === "approval" ? "felanmälningar till godkännandelistan" : "felanmälningar blir arbetsorder direkt");
  if (input.inactivityMinutes !== undefined) changes.push(`utloggning efter ${input.inactivityMinutes} minuter utan aktivitet`);
  if (input.aiTroubleshooting !== undefined) changes.push(`AI-felsökning ${input.aiTroubleshooting ? "på" : "av"}`);
  if (!changes.length) return;
  await prisma.$transaction(async (tx) => {
    await tx.operatorSettings.update({ where: { organizationId: ctx.organizationId }, data: { causes: input.causes, intake: input.intake, inactivityMinutes: input.inactivityMinutes, aiTroubleshooting: input.aiTroubleshooting, updatedById: ctx.user.id } });
    await audit(ctx, "operator_settings", `Operatörssidan: ${changes.join("; ")}.`, tx);
  });
}

/** Microsoft-grupp: on or off, and which group (the directory is connected through the Microsoft sign-in, never typed). */
export async function saveOperatorMicrosoft(ctx: Context, input: Extract<OperatorAdminAction, { action: "microsoft" }>) {
  const row = await ensureOperatorSettings(ctx.organizationId);
  const groupId = input.groupId !== undefined ? input.groupId.toLowerCase() : undefined;
  if (groupId && !isGuid(groupId)) throw new ApiError(400, "Gruppens id ska vara ett GUID (Objekt-id i Entra).");
  const enabled = input.enabled ?? row.microsoftEnabled;
  const group = groupId === undefined ? row.microsoftGroupId : groupId || null;
  if (enabled && (!row.microsoftTenantId || !row.microsoftConsentAt || !group)) throw new ApiError(409, "Koppla katalogen, ge medgivande och välj grupp innan du slår på.");
  await prisma.$transaction(async (tx) => {
    await tx.operatorSettings.update({ where: { organizationId: ctx.organizationId }, data: {
      microsoftEnabled: enabled, microsoftGroupId: group,
      ...(input.groupName !== undefined ? { microsoftGroupName: input.groupName } : {}),
      ...(groupId !== undefined && groupId !== row.microsoftGroupId ? { microsoftCheck: {} } : {}), updatedById: ctx.user.id,
    } });
    await audit(ctx, "operator_microsoft", `Operatörer via Microsoft: ${enabled ? "på" : "av"}${group ? `, grupp ${input.groupName || row.microsoftGroupName || group}` : ""}.`, tx);
  });
}

/** Ny adress: a new page key – the old address and its QR codes stop working at once; operators stay signed in. */
export async function newOperatorAddress(ctx: Context) {
  await ensureOperatorSettings(ctx.organizationId);
  await prisma.$transaction(async (tx) => {
    await tx.operatorSettings.update({ where: { organizationId: ctx.organizationId }, data: { pageKey: newPageKey(), updatedById: ctx.user.id } });
    await audit(ctx, "operator_address", "Gav operatörssidan en ny adress. Den gamla adressen och dess QR-koder slutade gälla.", tx);
  });
}

export { audit as operatorAudit };
