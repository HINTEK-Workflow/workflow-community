import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { csvCell } from "@/lib/csv/cell";
import { ApiError, body, checkOrigin, context, failure, requireAdmin } from "@/lib/kfid/server";
import { KEY_SCOPES } from "@/lib/integrations/key-catalog";
import { normalizeWorkflowPermissionProfile, WORKFLOW_PERMISSION_SUBJECTS, workflowPermissionMatrix, workflowPermissionPresets } from "@/lib/workflow/permissions";
import { accessReviewCsv, accessReviewDue, accessReviewDueAt, permissionSummary, ROLE_LABEL, type AccessReviewRow } from "@/lib/security/access-rules";
import { activeSupportGrant } from "@/lib/security/support-access";
import { recordSecurityEvent } from "@/lib/security/security-log";

export const dynamic = "force-dynamic";

/**
 * Granska behörigheter (K2.4, beslut 2026-11-28), under Användare: for the company's own admin and the active company only, in a
 * session (never through a key). Who has which role and permissions, the API and MCP keys, the MCP connections, the machine
 * keys and an open support access, as a list and as CSV. Granskad is a sign-off that is logged; the quarterly reminder on
 * Översikt is off until the admin turns it on.
 */
async function admin() {
  const ctx = await context();
  requireAdmin(ctx);
  if (ctx.integration) throw new ApiError(403, "Granskningen görs inloggad, inte med en nyckel.");
  return ctx;
}

const noStore = { "Cache-Control": "private, no-store" } as const;
const day = (value: Date | null | undefined) => (value ? value.toLocaleDateString("sv-SE", { timeZone: "Europe/Stockholm" }) : "");
const scopeLabel = (kind: "API" | "MCP", scope: string) => (KEY_SCOPES[kind] as readonly { key: string; label: string }[]).find((item) => item.key === scope)?.label ?? scope;
const TOTAL_GRANTS = WORKFLOW_PERMISSION_SUBJECTS.reduce((sum, subject) => sum + workflowPermissionMatrix[subject].length, 0);

async function review(organizationId: string, now = new Date()) {
  const [members, keys, connections, sources, settings, organization, support] = await Promise.all([
    prisma.organizationMember.findMany({ where: { organizationId }, orderBy: { createdAt: "asc" }, take: 500, select: { role: true, isActive: true, workflowPermissions: true, canDeleteControls: true, user: { select: { id: true, name: true, email: true, totpEnabledAt: true, lastLoginAt: true, isActive: true } } } }),
    prisma.integrationKey.findMany({ where: { organizationId, kind: { in: ["API", "MCP"] }, revokedAt: null }, orderBy: { createdAt: "asc" }, take: 200, select: { kind: true, name: true, scopes: true, expiresAt: true, lastUsedAt: true, createdById: true, actingUserId: true } }),
    prisma.oAuthGrant.findMany({ where: { organizationId, revokedAt: null }, orderBy: { createdAt: "asc" }, take: 200, select: { scopes: true, createdAt: true, lastUsedAt: true, userId: true, client: { select: { name: true } } } }),
    prisma.machineSource.findMany({ where: { organizationId }, orderBy: { name: "asc" }, take: 100, select: { name: true, secretHash: true, keyRevokedAt: true, keyExpiresAt: true, isActive: true, lastUsedAt: true, allowedMachinePartIds: true } }),
    prisma.workspaceSettings.findUnique({ where: { organizationId }, select: { accessReviewReminder: true, accessReviewedAt: true, accessReviewedById: true } }),
    prisma.organization.findUniqueOrThrow({ where: { id: organizationId }, select: { createdAt: true } }),
    activeSupportGrant(organizationId, now),
  ]);
  const names = new Map(members.map((member) => [member.user.id, member.user.name || member.user.email]));
  const extra = await prisma.user.findMany({ where: { id: { in: [settings?.accessReviewedById, ...keys.flatMap((key) => [key.actingUserId, key.createdById])].filter((id): id is string => Boolean(id && !names.has(id))) } }, select: { id: true, name: true, email: true } });
  for (const person of extra) names.set(person.id, person.name || person.email);
  const nameOf = (id: string | null | undefined) => (id ? names.get(id) ?? "Borttagen användare" : "");
  const presets = workflowPermissionPresets.map((preset) => ({ label: preset.label, profile: { grants: preset.profile.grants as readonly string[] } }));

  const rows: AccessReviewRow[] = [
    ...members.map((member) => ({
      type: "Användare", name: member.user.name || member.user.email, who: `${member.user.email} · ${ROLE_LABEL[member.role] ?? member.role}`,
      rights: permissionSummary(member.role, normalizeWorkflowPermissionProfile(member.workflowPermissions).grants, presets, TOTAL_GRANTS) + (member.role === "MEMBER" && member.canDeleteControls ? " · får radera kontroller" : ""),
      status: `${member.isActive && member.user.isActive ? "Aktiv" : "Pausad"} · tvåsteg ${member.user.totpEnabledAt ? "på" : "av"}`, validUntil: "", lastUsed: day(member.user.lastLoginAt),
    })),
    ...keys.map((key) => ({
      type: key.kind === "API" ? "API-nyckel" : "MCP-nyckel", name: key.name, who: nameOf(key.actingUserId ?? key.createdById),
      rights: key.scopes.map((scope) => scopeLabel(key.kind as "API" | "MCP", scope)).join(", "),
      status: key.expiresAt && key.expiresAt <= now ? "Har gått ut" : "Aktiv", validUntil: key.expiresAt ? day(key.expiresAt) : "Inget slutdatum", lastUsed: day(key.lastUsedAt),
    })),
    ...connections.map((grant) => ({
      type: "MCP-koppling", name: grant.client.name, who: nameOf(grant.userId), rights: grant.scopes.map((scope) => scopeLabel("MCP", scope)).join(", "),
      status: "Ansluten", validUntil: "Tills den kopplas bort", lastUsed: day(grant.lastUsedAt),
    })),
    ...sources.map((source) => ({
      type: "Maskinnyckel", name: source.name, who: "",
      rights: `Skicka händelser${source.allowedMachinePartIds.length ? ` för ${source.allowedMachinePartIds.length} ${source.allowedMachinePartIds.length === 1 ? "maskin" : "maskiner"}` : " för alla maskiner"}`,
      status: source.keyRevokedAt || !source.secretHash ? "Återkallad" : source.keyExpiresAt && source.keyExpiresAt <= now ? "Har gått ut" : !source.isActive ? "Avstängd" : "Aktiv",
      validUntil: source.keyExpiresAt ? day(source.keyExpiresAt) : "Inget slutdatum", lastUsed: day(source.lastUsedAt),
    })),
    ...(support ? [{ type: "Supportåtkomst", name: "Supporten", who: nameOf(support.grantedById), rights: "Läsa företagets uppgifter", status: "Öppen", validUntil: support.expiresAt.toLocaleString("sv-SE", { timeZone: "Europe/Stockholm" }), lastUsed: "" }] : []),
  ];
  const reminder = { reminderOn: Boolean(settings?.accessReviewReminder), lastReviewedAt: settings?.accessReviewedAt ?? null, since: organization.createdAt };
  return {
    rows,
    review: {
      reminderOn: reminder.reminderOn, lastReviewedAt: reminder.lastReviewedAt?.toISOString() ?? null, reviewedBy: nameOf(settings?.accessReviewedById),
      dueAt: accessReviewDueAt(reminder.lastReviewedAt, reminder.since).toISOString(), due: accessReviewDue(reminder, now),
    },
  };
}

export async function GET(request: Request) {
  try {
    const ctx = await admin();
    const data = await review(ctx.organizationId);
    if (new URL(request.url).searchParams.get("format") === "csv") {
      await prisma.administrationEvent.create({ data: { organizationId: ctx.organizationId, actorId: ctx.user.id, action: "access_review_export", detail: `Exporterade granskningen av behörigheter (${data.rows.length} rader).` } });
      return new Response(accessReviewCsv(data.rows, csvCell), { headers: { ...noStore, "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": `attachment; filename="behorigheter-${new Date().toISOString().slice(0, 10)}.csv"` } });
    }
    return NextResponse.json(data, { headers: noStore });
  } catch (error) {
    return failure(error);
  }
}

const input = z.discriminatedUnion("action", [
  z.object({ action: z.literal("sign_off") }),
  z.object({ action: z.literal("reminder"), on: z.boolean() }),
]);

export async function POST(request: Request) {
  try {
    checkOrigin(request);
    const ctx = await admin();
    const command = input.parse(await body(request));
    const now = new Date();
    if (command.action === "sign_off") {
      const data = await review(ctx.organizationId, now);
      await prisma.$transaction([
        prisma.workspaceSettings.upsert({ where: { organizationId: ctx.organizationId }, update: { accessReviewedAt: now, accessReviewedById: ctx.user.id }, create: { organizationId: ctx.organizationId, accessReviewedAt: now, accessReviewedById: ctx.user.id } }),
        prisma.administrationEvent.create({ data: { organizationId: ctx.organizationId, actorId: ctx.user.id, action: "access_review_signed", detail: `Granskade behörigheterna: ${data.rows.length} rader (användare, nycklar och kopplingar).` } }),
      ]);
      await recordSecurityEvent({ type: "access_review_signed", actorId: ctx.user.id, organizationId: ctx.organizationId, platform: false, detail: `${data.rows.length} rader`, headers: request.headers });
      return NextResponse.json({ ok: true, reviewedAt: now.toISOString() }, { headers: noStore });
    }
    await prisma.$transaction([
      prisma.workspaceSettings.upsert({ where: { organizationId: ctx.organizationId }, update: { accessReviewReminder: command.on }, create: { organizationId: ctx.organizationId, accessReviewReminder: command.on } }),
      prisma.administrationEvent.create({ data: { organizationId: ctx.organizationId, actorId: ctx.user.id, action: "access_review_reminder", detail: command.on ? "Påminnelsen om att granska behörigheterna varje kvartal är på." : "Påminnelsen om att granska behörigheterna är av." } }),
    ]);
    await recordSecurityEvent({ type: "access_review_reminder", actorId: ctx.user.id, organizationId: ctx.organizationId, platform: false, detail: command.on ? "På" : "Av", headers: request.headers });
    return NextResponse.json({ ok: true }, { headers: noStore });
  } catch (error) {
    return failure(error);
  }
}
