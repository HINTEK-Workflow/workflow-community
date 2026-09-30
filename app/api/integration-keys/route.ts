import { serverExtensions } from "@/lib/extensions/server";
import { randomBytes } from "node:crypto";
import { NextResponse } from "next/server";
import nodemailer from "nodemailer";
import { z } from "zod";
import { isHintekOrganization } from "@/lib/branding";
import { QA_ROLE_EMAILS, localRoleQaEnabled } from "@/lib/auth/access";
import { prisma } from "@/lib/db";
import { env } from "@/lib/env";
import { ApiError, body, checkOrigin, context, failure, requireAdmin } from "@/lib/kfid/server";
import {
  EXPIRY_CHOICES,
  EXTERNAL_PROVIDERS,
  MAX_ACTIVE_KEYS_PER_KIND,
  encryptExternalKey,
  externalHint,
  newIssuedToken,
  validScopes,
} from "@/lib/integrations/keys";
import {
  SERVER_KEY_CHECK_ACTION,
  SERVER_KEY_IDS,
  checkEventDetail,
  formatCheckMessage,
  parseCheckEvent,
  serverKeyStatuses,
  type ServerKeyStatus,
} from "@/lib/integrations/server-keys";

/**
 * API och MCP (Daniel 2026-09-29): every key the company uses, in one place, for the company admin only. Issued keys
 * are shown once and stored as a hash; external keys are stored encrypted and never returned. The server behind the
 * keys (API/MCP) is a separate step; these keys are ready for it.
 */
async function admin() {
  const ctx = await context();
  requireAdmin(ctx);
  if (ctx.organization.storageMode !== "HINTEK_CLOUD")
    throw new ApiError(409, "API och MCP kräver HINTEK Cloud. Local-företag har sina data i den egna filen.");
  return ctx;
}

/** Serverns nycklar: only a superadmin in HINTEK's own organization (or the synthetic QA superadmin on loopback QA). */
const seesServerKeys = (ctx: Awaited<ReturnType<typeof admin>>) =>
  ctx.user.role === "SUPERADMIN" && (isHintekOrganization(ctx.organization) || ctx.testAdmin || (localRoleQaEnabled() && ctx.user.email === QA_ROLE_EMAILS.superadmin));

async function serverKeys(organizationId: string) {
  const events = await prisma.administrationEvent.findMany({
    where: { organizationId, action: { startsWith: `${SERVER_KEY_CHECK_ACTION}:` } },
    orderBy: { createdAt: "desc" }, take: 100, select: { action: true, detail: true, createdAt: true },
  });
  const latest = new Map<string, NonNullable<ReturnType<typeof parseCheckEvent>>>();
  for (const event of events) {
    const parsed = parseCheckEvent(event.action, event.detail, event.createdAt);
    if (parsed && !latest.has(parsed.id)) latest.set(parsed.id, parsed);
  }
  return serverKeyStatuses(env).map((status) => ({ ...status, lastCheck: latest.get(status.id) ?? null }));
}

/** Asks the service whether it accepts the key, without the key or the service's error text leaving the server. */
async function checkServerKey(status: ServerKeyStatus): Promise<{ ok: boolean; message: string }> {
  if (status.check === "format" || !status.configured) return formatCheckMessage(status);
  if (status.id === "stripe_secret")
    // Stripe lives in ee/ (Fas 2); without it the key is only checked for its format.
    return (await serverExtensions.checkStripeSecretKey()) ?? formatCheckMessage(status);
  // SMTP: connect and log in without sending anything.
  const transporter = nodemailer.createTransport({
    host: env.SMTP_HOST, port: env.SMTP_PORT, secure: env.SMTP_SECURE,
    auth: env.SMTP_USER ? { user: env.SMTP_USER, pass: env.SMTP_PASS } : undefined,
    connectionTimeout: 5000, greetingTimeout: 5000, socketTimeout: 5000,
  });
  try {
    await transporter.verify();
    return { ok: true, message: "E-postservern svarar och godkänner anslutningen (inget skickades)." };
  } catch (error) {
    return { ok: false, message: (error as { code?: string }).code === "EAUTH" ? "E-postservern godkände inte inloggningen." : "E-postservern svarade inte." };
  } finally {
    transporter.close();
  }
}

const secret = () => env.INTEGRATION_KEYS_SECRET || env.AUTH_SECRET;
const name = z.string().trim().min(1, "Ge nyckeln ett namn.").max(80);
const input = z.discriminatedUnion("action", [
  // The member the key acts for (2026-09-30): the key gets exactly that person's rights in Workflow; empty = the admin.
  z.object({ action: z.literal("issue"), kind: z.enum(["API", "MCP"]), name, scopes: z.array(z.string().max(40)).max(12), expiresInDays: z.number().int().refine((value) => (EXPIRY_CHOICES as readonly number[]).includes(value)), actingUserId: z.string().min(1).max(100).optional() }),
  z.object({ action: z.literal("add_external"), name, provider: z.enum(EXTERNAL_PROVIDERS.map((item) => item.key) as [string, ...string[]]), value: z.string().trim().min(8, "Klistra in hela nyckeln.").max(4000) }),
  z.object({ action: z.literal("replace_external"), id: z.string().min(1).max(60), value: z.string().trim().min(8, "Klistra in hela nyckeln.").max(4000) }),
  z.object({ action: z.literal("revoke"), id: z.string().min(1).max(60) }),
  z.object({ action: z.literal("check_server"), id: z.enum(SERVER_KEY_IDS) }),
]);

const listSelect = { id: true, kind: true, name: true, provider: true, scopes: true, displayHint: true, expiresAt: true, lastUsedAt: true, revokedAt: true, createdAt: true, updatedAt: true, createdById: true, actingUserId: true } as const;

export async function GET() {
  try {
    const ctx = await admin();
    const [keys, revoked] = await Promise.all([
      prisma.integrationKey.findMany({ where: { organizationId: ctx.organizationId, revokedAt: null }, orderBy: { createdAt: "desc" }, select: listSelect }),
      prisma.integrationKey.findMany({ where: { organizationId: ctx.organizationId, revokedAt: { not: null } }, orderBy: { revokedAt: "desc" }, take: 10, select: listSelect }),
    ]);
    const [creators, members] = await Promise.all([
      prisma.user.findMany({ where: { id: { in: [...new Set([...keys, ...revoked].flatMap((key) => [key.createdById, key.actingUserId ?? key.createdById]))] } }, select: { id: true, name: true, email: true } }),
      prisma.organizationMember.findMany({ where: { organizationId: ctx.organizationId, isActive: true, user: { isActive: true } }, orderBy: { user: { name: "asc" } }, select: { role: true, user: { select: { id: true, name: true, email: true } } } }),
    ]);
    const creator = new Map(creators.map((user) => [user.id, user.name || user.email]));
    const view = (key: (typeof keys)[number]) => ({ ...key, createdById: undefined, actingUserId: undefined, createdBy: creator.get(key.createdById) ?? "Okänd", actsFor: creator.get(key.actingUserId ?? key.createdById) ?? "Okänd" });
    const server = seesServerKeys(ctx) ? await serverKeys(ctx.organizationId) : null;
    return NextResponse.json({ keys: keys.map(view), revoked: revoked.map(view), server, currentUserId: ctx.user.id,
      members: members.map((member) => ({ id: member.user.id, name: member.user.name || member.user.email, admin: member.role === "OWNER" || member.role === "ADMIN" })) }, { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) {
    return failure(error);
  }
}

export async function POST(request: Request) {
  try {
    checkOrigin(request);
    const ctx = await admin();
    const command = input.parse(await body(request));
    const audit = (detail: string) => prisma.administrationEvent.create({ data: { actorId: ctx.user.id, organizationId: ctx.organizationId, action: "integration_key", detail } });
    const activeCount = (kind: "API" | "MCP" | "EXTERNAL") => prisma.integrationKey.count({ where: { organizationId: ctx.organizationId, kind, revokedAt: null } });

    if (command.action === "check_server") {
      if (!seesServerKeys(ctx)) throw new ApiError(403, "Serverns nycklar visas bara för HINTEK:s superadmin.");
      const status = serverKeyStatuses(env).find((item) => item.id === command.id)!;
      const result = await checkServerKey(status);
      const event = await prisma.administrationEvent.create({
        data: { actorId: ctx.user.id, organizationId: ctx.organizationId, action: `${SERVER_KEY_CHECK_ACTION}:${status.id}`, detail: checkEventDetail(status.label, result.ok, result.message) },
        select: { createdAt: true },
      });
      return NextResponse.json({ id: status.id, ...result, at: event.createdAt.toISOString() }, { headers: { "Cache-Control": "no-store" } });
    }
    if (command.action === "issue") {
      const scopes = validScopes(command.kind, command.scopes);
      if (!scopes) throw new ApiError(400, "Välj minst en giltig behörighet för nyckeln.");
      if (await activeCount(command.kind) >= MAX_ACTIVE_KEYS_PER_KIND) throw new ApiError(409, `Företaget har redan ${MAX_ACTIVE_KEYS_PER_KIND} aktiva nycklar av den här typen. Återkalla en först.`);
      const actingUserId = command.actingUserId && command.actingUserId !== ctx.user.id ? command.actingUserId : null;
      const actsFor = actingUserId ? await prisma.organizationMember.findFirst({ where: { organizationId: ctx.organizationId, userId: actingUserId, isActive: true, user: { isActive: true } }, select: { user: { select: { name: true, email: true } } } }) : null;
      if (actingUserId && !actsFor) throw new ApiError(400, "Välj en aktiv medlem i företaget.");
      const id = randomBytes(12).toString("hex");
      const issued = newIssuedToken(command.kind, id);
      const expiresAt = command.expiresInDays ? new Date(Date.now() + command.expiresInDays * 86_400_000) : null;
      await prisma.$transaction([
        prisma.integrationKey.create({ data: { id, organizationId: ctx.organizationId, kind: command.kind, name: command.name, scopes, displayHint: issued.displayHint, secretHash: issued.secretHash, expiresAt, createdById: ctx.user.id, actingUserId } }),
        audit(`Skapade ${command.kind === "API" ? "API-nyckeln" : "MCP-nyckeln"} ”${command.name}” för ${actsFor ? actsFor.user.name || actsFor.user.email : "sig själv"} (${scopes.join(", ")}${expiresAt ? `, gäller till ${expiresAt.toISOString().slice(0, 10)}` : ", utan slutdatum"}).`),
      ]);
      // The only time the token leaves the server.
      return NextResponse.json({ id, token: issued.token, displayHint: issued.displayHint }, { headers: { "Cache-Control": "no-store" } });
    }
    if (command.action === "add_external") {
      if (await activeCount("EXTERNAL") >= MAX_ACTIVE_KEYS_PER_KIND) throw new ApiError(409, `Företaget har redan ${MAX_ACTIVE_KEYS_PER_KIND} externa nycklar. Ta bort en först.`);
      const provider = EXTERNAL_PROVIDERS.find((item) => item.key === command.provider)!;
      const created = await prisma.integrationKey.create({ data: { organizationId: ctx.organizationId, kind: "EXTERNAL", name: command.name, provider: provider.key, displayHint: externalHint(command.value), encryptedValue: encryptExternalKey(command.value, secret()), createdById: ctx.user.id }, select: { id: true, displayHint: true } });
      await audit(`Lade till den externa nyckeln ”${command.name}” (${provider.label}).`);
      return NextResponse.json(created);
    }
    const key = await prisma.integrationKey.findFirst({ where: { id: command.id, organizationId: ctx.organizationId, revokedAt: null } });
    if (!key) throw new ApiError(404, "Nyckeln finns inte eller är redan borttagen.");
    if (command.action === "replace_external") {
      if (key.kind !== "EXTERNAL") throw new ApiError(400, "Bara en extern nyckel kan bytas. Skapa en ny API- eller MCP-nyckel i stället.");
      await prisma.$transaction([
        prisma.integrationKey.update({ where: { id: key.id }, data: { encryptedValue: encryptExternalKey(command.value, secret()), displayHint: externalHint(command.value) } }),
        audit(`Bytte värdet på den externa nyckeln ”${key.name}”.`),
      ]);
      return NextResponse.json({ ok: true });
    }
    // Revoke: an issued key stops working at once and stays in the list as history; an external key's value is erased.
    await prisma.$transaction([
      prisma.integrationKey.update({ where: { id: key.id }, data: { revokedAt: new Date(), revokedById: ctx.user.id, ...(key.kind === "EXTERNAL" ? { encryptedValue: null } : {}) } }),
      audit(key.kind === "EXTERNAL" ? `Tog bort den externa nyckeln ”${key.name}”.` : `Återkallade ${key.kind === "API" ? "API-nyckeln" : "MCP-nyckeln"} ”${key.name}”.`),
    ]);
    return NextResponse.json({ ok: true });
  } catch (error) {
    return failure(error);
  }
}
