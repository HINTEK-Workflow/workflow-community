import { describeIssue, type IssueLike } from "@/lib/tools/issue-text";
import { serverExtensions } from "@/lib/extensions/server";
import { randomBytes } from "node:crypto";
import { NextResponse } from "next/server";
import nodemailer from "nodemailer";
import { z } from "zod";
import { seesServerKeys } from "@/lib/integrations/server-keys-access";
import { prisma } from "@/lib/db";
import { env } from "@/lib/env";
import { ApiError, body, checkOrigin, context, failure, requireAdmin } from "@/lib/kfid/server";
import {
  EXPIRY_CHOICES,
  EXTERNAL_PROVIDERS,
  OFFERED_EXTERNAL_PROVIDERS,
  MAX_ACTIVE_KEYS_PER_KIND,
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
  BILLING_KEY_IDS,
  serverKeyStatuses,
  type ServerKeyStatus,
} from "@/lib/integrations/server-keys";
import { disconnect, listConnections } from "@/lib/oauth/server";
import { openAiSettings, providerSettingsView } from "@/lib/ai/provider-settings-server";
import { checkOpenAiKey } from "@/lib/ai/openai-provider";
import { mailConfig } from "@/lib/mail/settings-server";
import { requireFreshAuth } from "@/lib/auth/fresh-auth";
import { recordSecurityEvent } from "@/lib/security/security-log";
import { SERVER_SECRET_CENTRAL, ServerSecretError, saveServerSecret, saveServerSetting, serverKeysWithChanges, serverSecrets, storedServerKeys } from "@/lib/integrations/server-secrets";
import { CentralStoreError, centralFieldInfo, centralStoreStatus } from "@/lib/secrets/central-store";
import { keyRingStatus, unreadableValues } from "@/lib/security/key-ring";
import { inventory } from "@/lib/secrets/reseal";
import { publicInstance } from "@/lib/instance";
import type { CentralField } from "@/lib/secrets/central-fields";
import { sealCompanyKey } from "@/lib/integrations/company-keys";
import { checkSolarKeys } from "@/lib/integrations/solar";
import { solarCategoryStatus, syncSolarCategories } from "@/lib/catalogue/solar-categories";
import { cancelRegisterImport, registerStatus, requestRegisterImport } from "@/lib/catalogue/register-sync";
import { googleSignInAllowed, setGoogleSignInAllowed } from "@/lib/auth/login-settings";
import { setProviderEnabled } from "@/lib/ai/provider-settings-server";
import { SERVER_SECRET_FIELDS, SERVER_SECRET_LABELS, SERVER_SECRET_ROW, SERVER_SETTING_FIELDS, SERVER_SETTING_LABELS, lastChange, resolvedAsEnv, serverSetting } from "@/lib/integrations/server-secret-values";

/**
 * API och MCP (2026-09-29): every key the company uses, in one place, for the company admin only. Issued keys
 * are shown once and stored as a hash; external keys are stored encrypted and never returned. The server behind the
 * keys (API/MCP) is a separate step; these keys are ready for it.
 */
async function admin() {
  const ctx = await context();
  requireAdmin(ctx);
  if (ctx.organization.storageMode !== "HINTEK_CLOUD")
    throw new ApiError(409, "API och MCP kräver serverlagring. Local-företag har sina data i den egna filen.");
  return ctx;
}

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
  // OpenAI and e-mail are set in their own cards on this page (C6); the rows show what applies wherever it is stored, and a check
  // made before the latest change there no longer counts (2026-10-03: "ser servernycklarna rätt ut?").
  const [ai, aiView, mail, mailRow, secrets, stored, solarCategories, solarRegister] = await Promise.all([openAiSettings(), providerSettingsView(), mailConfig(),
    prisma.systemSettings.findUnique({ where: { id: "global" }, select: { mail: true } }), serverSecrets(), serverKeysWithChanges(), solarCategoryStatus(), registerStatus()]);
  const mailChanged = (mailRow?.mail as { updatedAt?: string } | null)?.updatedAt ?? null;
  const fresh = (id: string, since: string | null) => {
    const check = latest.get(id) ?? null;
    return check && since && check.at < new Date(since).toISOString() ? null : check;
  };
  // Stripe and Google (2026-10-09): entered here in the app first, the environment as fallback; the rows tell which.
  const googleOn = await googleSignInAllowed();
  // Av/på från kortet (2026-10-17): the same setting as where it is changed otherwise.
  const switchOf = (id: string): ServerKeyStatus["serviceSwitch"] =>
    id === "solar" ? { service: "solar", on: solarRegister.apiEnabled, label: "API-anslutning", help: "Av: inga katalogimporter körs. Nya prisfiler läses in som företagens egna rader. Priser som redan är inlästa ligger kvar." }
    : id === "google" ? { service: "google", on: googleOn, label: "Fortsätt med Google", help: "Av: knappen försvinner från inloggningen och servern vägrar Google-inloggning. Nyckeln ligger kvar." }
    : id === "openai" ? { service: "openai", on: ai.requested, label: "Workflow AI", help: "Av: Workflow AI är avstängd för alla företag. Nyckeln ligger kvar." }
    : undefined;
  const storageOf = async (fields: CentralField[]) => {
    for (const field of fields) { const info = await centralFieldInfo(field); if (info.storage) return info.storage; }
    return null;
  };
  const storage: Partial<Record<string, ServerKeyStatus["storage"]>> = {
    stripe_secret: await storageOf([SERVER_SECRET_CENTRAL.stripeSecretKey]), stripe_webhook: await storageOf([SERVER_SECRET_CENTRAL.stripeWebhookSecret]),
    google: await storageOf([SERVER_SECRET_CENTRAL.googleClientId, SERVER_SECRET_CENTRAL.googleClientSecret]),
    solar: await storageOf([SERVER_SECRET_CENTRAL.solarClientId, SERVER_SECRET_CENTRAL.solarClientSecret]),
    openai: await storageOf(["openai.apiKey"]), smtp: await storageOf(["smtp.password"]),
  };
  return serverKeyStatuses({ ...env, ...resolvedAsEnv(secrets) }, { billing: publicInstance().features.billing }).map((status): ServerKeyStatus & { lastCheck: ReturnType<typeof fresh> } => {
    const serviceSwitch = switchOf(status.id);
    if (status.id === "stripe_secret" || status.id === "stripe_webhook" || status.id === "google" || status.id === "solar") {
      const fields = SERVER_SECRET_FIELDS.filter((field) => SERVER_SECRET_ROW[field] === status.id);
      return {
        ...status, ...(serviceSwitch ? { serviceSwitch } : {}),
        source: fields.map((field) => secrets[field].source).find(Boolean) ?? null,
        storage: storage[status.id] ?? null,
        fields: fields.map((field) => ({ id: field, label: SERVER_SECRET_LABELS[field], stored: Boolean(secrets[field].value) })),
        lastCheck: fresh(status.id, lastChange(stored, status.id)),
        // Solar's catalogue number beside the key (2026-10-14): the article search's lookup needs it; never guessed.
        ...(status.id === "solar" ? { settings: [{ id: "solarCatalogId" as const, label: SERVER_SETTING_LABELS.solarCatalogId, value: serverSetting(stored, "solarCatalogId"),
          help: "Numret på Solars svenska katalog. Fråga Solar – utan det hämtar artikelsökningen inga produktuppgifter." }],
          // The country code Kontrollera found and the global categories (2026-10-15).
          solarCatalog: { countryCode: serverSetting(stored, "solarCountryCode"), categories: solarCategories.count, fetchedAt: solarCategories.fetchedAt },
          // Det gemensamma artikelregistret (2026-10-17).
          solarRegister } : {}),
      };
    }
    if (status.id === "openai") return {
      ...status, ...(serviceSwitch ? { serviceSwitch } : {}), configured: Boolean(ai.apiKey), formatOk: ai.apiKey ? /^sk-[A-Za-z0-9_-]{20,}$/.test(ai.apiKey) : null,
      switches: [
        { label: "Workflow AI", on: ai.requested }, { label: "Biträdesavtal bekräftat", on: ai.dpaApproved },
        { label: "Provsvit godkänd", on: ai.evalApproved },
      ],
      note: "Nyckeln och valen för Workflow AI. Gäller alla företag.", check: "service" as const,
      source: aiView.keySource === "none" ? null : aiView.keySource,
      storage: aiView.keySource === "app" ? storage.openai ?? null : null,
      lastCheck: fresh(status.id, aiView.updatedAt),
      ...(aiView.updatedAt ? { changed: { at: aiView.updatedAt, by: aiView.updatedBy } } : {}),
    };
    if (status.id === "smtp") {
      const { host, user, password, secure } = mail.transport;
      const local = ["localhost", "127.0.0.1", "::1"].includes(host.toLowerCase());
      return {
        ...status, configured: !local, mode: local ? ("test" as const) : null, formatOk: local ? true : !user || Boolean(password),
        switches: [
          { label: "Inbjudningar", on: mail.delivery.invitations }, { label: "Påminnelser om ronder", on: mail.delivery.roundReminders },
          { label: "Driftlarm", on: mail.delivery.alerts }, { label: "Faktura-e-post", on: Boolean(env.BILLING_EMAIL_DELIVERY_ENABLED) },
          { label: "Krypterad anslutning", on: secure },
        ],
        note: local ? "Lokal testserver – ingen e-post lämnar datorn." : "Servern som skickar e-post och avsändaren.",
        source: mail.source,
        storage: mail.source === "app" && mail.transport.password ? storage.smtp ?? null : null,
        lastCheck: fresh(status.id, mailChanged),
      };
    }
    // The sign-in secret and the sealing secret are only ever in the server's environment.
    return { ...status, source: "server" as const, lastCheck: latest.get(status.id) ?? null };
  });
}

/** Workflow's own routines around the central keys (the key vault's copy, Kontrollera och synka, the emergency copy); null without ee/. */
const centralKeys = async () => (serverExtensions.centralKeys ? serverExtensions.centralKeys() : null);

/**
 * Central lagring (2026-10-25): where the installation's own keys are kept and the key ring – names, times and
 * counts only, never a value. The sealed values that could not be opened are the ones this process has met. With ee/ the
 * key vault's status, the emergency copy and Kontrollera och synka are added (ee/secrets/central-keys.ts).
 */
async function centralOverview() {
  const keys = await centralKeys();
  return {
    store: await centralStoreStatus(), ring: keyRingStatus(), unreadable: unreadableValues().map((item) => item.where),
    ...(keys ? await keys.overview() : {}),
  };
}

/** Asks the service whether it accepts the key, without the key or the service's error text leaving the server. */
async function checkServerKey(status: ServerKeyStatus, actor: string): Promise<{ ok: boolean; message: string }> {
  if (status.check === "format" || !status.configured) return formatCheckMessage(status);
  if (status.id === "stripe_secret")
    // Stripe lives in ee/ (Fas 2); without it the key is only checked for its format.
    return (await serverExtensions.checkStripeSecretKey()) ?? formatCheckMessage(status);
  // Solar (2026-10-13 natt): a token, the account list and the country code Solar accepts, read only
  // (lib/integrations/solar.ts). The accepted country code is kept for the article search and the categories (2026-10-15).
  if (status.id === "solar") {
    const secrets = await serverSecrets();
    const stored = await storedServerKeys();
    // With Solar's catalogue number (2026-10-16) the check also asks for one product, and the products decide the country code.
    const { countryCode, ...result } = await checkSolarKeys({ clientId: secrets.solarClientId.value, clientSecret: secrets.solarClientSecret.value }, fetch, serverSetting(stored, "solarCatalogId"));
    if (countryCode && serverSetting(stored, "solarCountryCode") !== countryCode) await saveServerSetting("solarCountryCode", countryCode, actor);
    return result;
  }
  // OpenAI: the key that applies, asked without a model call – the same check as under Installation → AI.
  if (status.id === "openai") {
    const ai = await openAiSettings();
    return checkOpenAiKey(ai.apiKey);
  }
  // SMTP: the settings that apply; connect and log in without sending anything.
  const { transport } = await mailConfig();
  const transporter = nodemailer.createTransport({
    host: transport.host, port: transport.port, secure: transport.secure,
    auth: transport.user ? { user: transport.user, pass: transport.password } : undefined,
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

const name = z.string().trim().min(1, "Ge nyckeln ett namn.").max(80);
const input = z.discriminatedUnion("action", [
  // The member the key acts for (2026-09-30): the key gets exactly that person's rights in Workflow; empty = the admin.
  z.object({ action: z.literal("issue"), kind: z.enum(["API", "MCP"]), name, scopes: z.array(z.string().max(40)).max(12), expiresInDays: z.number().int().refine((value) => (EXPIRY_CHOICES as readonly number[]).includes(value)), actingUserId: z.string().min(1).max(100).optional() }),
  z.object({ action: z.literal("add_external"), name, provider: z.enum(OFFERED_EXTERNAL_PROVIDERS as unknown as [string, ...string[]]), value: z.string().trim().min(8, "Klistra in hela nyckeln.").max(4000) }),
  z.object({ action: z.literal("replace_external"), id: z.string().min(1).max(60), value: z.string().trim().min(8, "Klistra in hela nyckeln.").max(4000) }),
  z.object({ action: z.literal("revoke"), id: z.string().min(1).max(60) }),
  z.object({ action: z.literal("check_server"), id: z.enum(SERVER_KEY_IDS) }),
  // Servernycklar (2026-10-09): Stripe's and Google's keys entered or removed in the app.
  z.object({ action: z.literal("save_server_secret"), field: z.enum(SERVER_SECRET_FIELDS), value: z.string().trim().min(1, "Klistra in hela värdet.").max(500) }),
  z.object({ action: z.literal("remove_server_secret"), field: z.enum(SERVER_SECRET_FIELDS) }),
  // Solars katalognummer (2026-10-14): a plain setting beside the key; an empty value removes it.
  z.object({ action: z.literal("save_server_setting"), field: z.enum(SERVER_SETTING_FIELDS), value: z.string().trim().max(40) }),
  // Solars kategorier (2026-10-15): every page of Get Categories into the global table, by the product owner.
  z.object({ action: z.literal("sync_solar_categories") }),
  // Det gemensamma artikelregistret (2026-10-17): the product owner asks for a full import; the scheduled job runs it.
  z.object({ action: z.literal("request_register_import") }),
  // Avbryt (2026-10-18): withdraws a request that has not started or stops a running import, which removes what it added.
  z.object({ action: z.literal("cancel_register_import") }),
  // The switch for Solar's API connection (2026-10-17): off blocks every catalogue import; the price files are untouched.
  z.object({ action: z.literal("set_service_switch"), service: z.enum(["solar", "google", "openai"]), on: z.boolean() }),
  z.object({ action: z.literal("disconnect_app"), id: z.string().min(1).max(60) }),
  // Central lagring (2026-10-25): Kontrollera counts every sealed value and whether it can be opened (and, with ee/, compares
  // the key vault). The key vault's own commands (copy, restore, Kontrollera och synka) are ee/'s (ee/secrets/central-keys.ts).
  z.object({ action: z.literal("check_central_store") }),
]);

const listSelect = { id: true, kind: true, name: true, provider: true, scopes: true, displayHint: true, expiresAt: true, lastUsedAt: true, revokedAt: true, createdAt: true, updatedAt: true, createdById: true, actingUserId: true } as const;

export async function GET(request: Request) {
  try {
    // Installation → Servernycklar asks for the server's keys alone (2026-10-03).
    if (new URL(request.url).searchParams.get("scope") === "server") {
      const ctx = await context();
      if (!seesServerKeys(ctx)) throw new ApiError(403, "Servernycklarna visas bara för installationens superadmin.");
      const server = await serverKeys(ctx.organizationId);
      const alerts = await mailConfig().then((mail) => ({ on: mail.delivery.alerts, email: mail.alertEmail || null, blocked: mail.blockedReason }));
      return NextResponse.json({ server, alerts, central: await centralOverview() }, { headers: { "Cache-Control": "private, no-store" } });
    }
    // Förloppet för registerhämtningen (2026-10-18): a small read the card repeats every few seconds while something runs.
    if (new URL(request.url).searchParams.get("scope") === "register") {
      const ctx = await context();
      if (!seesServerKeys(ctx)) throw new ApiError(403, "Servernycklarna visas bara för installationens superadmin.");
      return NextResponse.json({ solarRegister: await registerStatus() }, { headers: { "Cache-Control": "private, no-store" } });
    }
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
    // Apps connected through OAuth (2026-10-02) are administered here too, beside the keys.
    const connections = await listConnections(ctx.organizationId);
    return NextResponse.json({ keys: keys.map(view), revoked: revoked.map(view), connections, currentUserId: ctx.user.id,
      members: members.map((member) => ({ id: member.user.id, name: member.user.name || member.user.email, admin: member.role === "OWNER" || member.role === "ADMIN" })) }, { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) {
    return failure(error);
  }
}

export async function POST(request: Request) {
  try {
    checkOrigin(request);
    const ctx = await admin();
    const raw = await body(request);
    // The key vault's own commands, with their own checks (Workflow's superadmin, a fresh sign-in); 400 without ee/.
    const keys = await centralKeys();
    const vaultAnswer = keys ? await keys.command(raw, ctx, { serverKeys, checkServerKey, overview: centralOverview }, request.headers) : null;
    if (vaultAnswer) return vaultAnswer;
    const parsedCommand = input.safeParse(raw);
    if (!parsedCommand.success) throw new ApiError(400, describeIssue(parsedCommand.error.issues[0] as IssueLike));
    const command = parsedCommand.data;
    const audit = (detail: string) => prisma.administrationEvent.create({ data: { actorId: ctx.user.id, organizationId: ctx.organizationId, action: "integration_key", detail } });
    const activeCount = (kind: "API" | "MCP" | "EXTERNAL") => prisma.integrationKey.count({ where: { organizationId: ctx.organizationId, kind, revokedAt: null } });

    if (command.action === "check_server") {
      if (!seesServerKeys(ctx)) throw new ApiError(403, "Servernycklarna visas bara för installationens superadmin.");
      const status = (await serverKeys(ctx.organizationId)).find((item) => item.id === command.id);
      // A row the installation does not have (the payment keys without billing) cannot be checked.
      if (!status) throw new ApiError(404, "Nyckeln finns inte i den här installationen.");
      const result = await checkServerKey(status, ctx.user.name || ctx.user.email);
      const event = await prisma.administrationEvent.create({
        data: { actorId: ctx.user.id, organizationId: ctx.organizationId, action: `${SERVER_KEY_CHECK_ACTION}:${status.id}`, detail: checkEventDetail(status.label, result.ok, result.message) },
        select: { createdAt: true },
      });
      return NextResponse.json({ id: status.id, ...result, at: event.createdAt.toISOString() }, { headers: { "Cache-Control": "no-store" } });
    }
    if (command.action === "save_server_secret" || command.action === "remove_server_secret") {
      if (!seesServerKeys(ctx)) throw new ApiError(403, "Servernycklarna visas bara för installationens superadmin.");
      if (!publicInstance().features.billing && (BILLING_KEY_IDS as readonly string[]).includes(SERVER_SECRET_ROW[command.field])) throw new ApiError(404, "Nyckeln finns inte i den här installationen.");
      // Like a new API key: a password or code within ten minutes before a server key is entered or removed.
      await requireFreshAuth(ctx.user.id, ctx.auth);
      const value = command.action === "save_server_secret" ? command.value : null;
      try {
        await saveServerSecret(command.field, value, { userId: ctx.user.id, organizationId: ctx.organizationId, label: ctx.user.name || ctx.user.email });
      } catch (error) {
        if (error instanceof ServerSecretError) throw new ApiError(400, error.message);
        if (error instanceof CentralStoreError) throw new ApiError(error.status, error.message);
        throw error;
      }
      // The history tells what was done and by whom – never the value.
      await prisma.administrationEvent.create({ data: { actorId: ctx.user.id, organizationId: ctx.organizationId, action: "server_key",
        detail: `${value ? "La in" : "Tog bort"} ${SERVER_SECRET_LABELS[command.field]} under Servernycklar.` } });
      return NextResponse.json({ server: await serverKeys(ctx.organizationId) }, { headers: { "Cache-Control": "no-store" } });
    }
    if (command.action === "save_server_setting") {
      if (!seesServerKeys(ctx)) throw new ApiError(403, "Servernycklarna visas bara för installationens superadmin.");
      await requireFreshAuth(ctx.user.id, ctx.auth);
      try {
        await saveServerSetting(command.field, command.value || null, ctx.user.name || ctx.user.email);
      } catch (error) {
        if (error instanceof ServerSecretError) throw new ApiError(400, error.message);
        throw error;
      }
      await prisma.administrationEvent.create({ data: { actorId: ctx.user.id, organizationId: ctx.organizationId, action: "server_key",
        detail: command.value ? `Satte ${SERVER_SETTING_LABELS[command.field]} till ${command.value} under Servernycklar.` : `Tog bort ${SERVER_SETTING_LABELS[command.field]} under Servernycklar.` } });
      return NextResponse.json({ server: await serverKeys(ctx.organizationId) }, { headers: { "Cache-Control": "no-store" } });
    }
    if (command.action === "sync_solar_categories") {
      if (!seesServerKeys(ctx)) throw new ApiError(403, "Servernycklarna visas bara för installationens superadmin.");
      const result = await syncSolarCategories(ctx.user.name || ctx.user.email);
      await prisma.administrationEvent.create({ data: { actorId: ctx.user.id, organizationId: ctx.organizationId, action: "solar_categories",
        detail: `${result.ok ? "OK" : "Fel"}: Hämta kategorier från Solar — ${result.message}` } });
      return NextResponse.json({ ...result, server: await serverKeys(ctx.organizationId) }, { headers: { "Cache-Control": "no-store" } });
    }
    if (command.action === "request_register_import") {
      if (!seesServerKeys(ctx)) throw new ApiError(403, "Servernycklarna visas bara för installationens superadmin.");
      // The connection is checked before the request is kept (switched on, keys, sign-in, the catalogue answering); a refusal says why.
      const asked = await requestRegisterImport(ctx.user.name || ctx.user.email);
      await prisma.administrationEvent.create({ data: { actorId: ctx.user.id, organizationId: ctx.organizationId, action: "solar_register",
        detail: asked.ok ? "Begärde en hämtning av hela Solars katalog till det gemensamma artikelregistret." : `Hämtning av Solars katalog nekades: ${asked.message}` } });
      if (!asked.ok) throw new ApiError(409, asked.message);
      return NextResponse.json({ ok: true, message: `${asked.message} Den tar ungefär en halvtimme.`, server: await serverKeys(ctx.organizationId) }, { headers: { "Cache-Control": "no-store" } });
    }
    if (command.action === "cancel_register_import") {
      if (!seesServerKeys(ctx)) throw new ApiError(403, "Servernycklarna visas bara för installationens superadmin.");
      const cancelled = await cancelRegisterImport();
      if (cancelled.effect !== "none") await prisma.administrationEvent.create({ data: { actorId: ctx.user.id, organizationId: ctx.organizationId, action: "solar_register",
        detail: cancelled.effect === "withdraw" ? "Drog tillbaka begäran om hämtning av Solars katalog." : "Avbröt pågående hämtning av Solars katalog." } });
      return NextResponse.json({ ok: cancelled.effect !== "none", message: cancelled.message, server: await serverKeys(ctx.organizationId) }, { headers: { "Cache-Control": "no-store" } });
    }
    if (command.action === "set_service_switch") {
      if (!seesServerKeys(ctx)) throw new ApiError(403, "Servernycklarna visas bara för installationens superadmin.");
      const actor = ctx.user.name || ctx.user.email;
      const names = { solar: "Solars API-anslutning för katalogimport", google: "Inloggning med Google", openai: "Workflow AI" } as const;
      if (command.service === "solar") await saveServerSetting("solarApiEnabled", command.on ? "on" : "off", actor);
      else if (command.service === "google") await setGoogleSignInAllowed(command.on);
      else await setProviderEnabled(command.on, actor);
      // The history tells what was switched and by whom – never a key.
      await prisma.administrationEvent.create({ data: { actorId: ctx.user.id, organizationId: ctx.organizationId, action: "server_key",
        detail: `${command.on ? "Slog på" : "Stängde av"} ${names[command.service]} under Tjänster och nycklar.` } });
      return NextResponse.json({ ok: true, message: `${names[command.service]} är ${command.on ? "påslagen" : "avstängd"}.`, server: await serverKeys(ctx.organizationId) }, { headers: { "Cache-Control": "no-store" } });
    }
    if (command.action === "check_central_store") {
      if (!seesServerKeys(ctx)) throw new ApiError(403, "Servernycklarna visas bara för installationens superadmin.");
      const counts = await inventory();
      const unreadable = Object.entries(counts).filter(([, count]) => count.unreadable).map(([place, count]) => `${place} (${count.unreadable})`);
      const older = Object.values(counts).reduce((sum, count) => sum + count.older, 0);
      let ok = unreadable.length === 0;
      const parts: string[] = [];
      const vault = keys ? await keys.check() : null;
      if (vault) { ok &&= vault.ok; parts.push(vault.text); }
      else parts.push("Inget nyckelvalv: nycklarna ligger förseglade i databasen.");
      parts.push(unreadable.length ? `Går inte att öppna: ${unreadable.join(", ")}.` : "Alla förseglade värden går att öppna.");
      if (older) parts.push(`${older} värden väntar på omförsegling.`);
      await prisma.administrationEvent.create({ data: { actorId: ctx.user.id, organizationId: ctx.organizationId, action: "central_store_check", detail: `${ok ? "OK" : "Fel"}: ${parts.join(" ")}`.slice(0, 1000) } });
      return NextResponse.json({ ok, message: parts.join(" "), central: await centralOverview() }, { headers: { "Cache-Control": "no-store" } });
    }
    if (command.action === "disconnect_app") {
      const app = await disconnect(ctx.organizationId, command.id, ctx.user.id);
      if (!app) throw new ApiError(404, "Anslutningen finns inte.");
      await prisma.administrationEvent.create({ data: { actorId: ctx.user.id, organizationId: ctx.organizationId, action: "oauth_disconnect", detail: `Kopplade från appen ”${app}” från MCP-servern.` } });
      return NextResponse.json({ ok: true });
    }
    // Färsk inloggning (2026-10-10): a new key or a new key value needs a password or code within ten minutes.
    if (command.action === "issue" || command.action === "add_external" || command.action === "replace_external") await requireFreshAuth(ctx.user.id, ctx.auth);
    const securityEvent = (type: "api_key_created" | "api_key_revoked", kind: string) =>
      recordSecurityEvent({ type, actorId: ctx.user.id, organizationId: ctx.organizationId, platform: false, detail: kind === "API" ? "API" : kind === "MCP" ? "MCP" : "Extern nyckel", headers: request.headers });
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
      await securityEvent("api_key_created", command.kind);
      // The only time the token leaves the server.
      return NextResponse.json({ id, token: issued.token, displayHint: issued.displayHint }, { headers: { "Cache-Control": "no-store" } });
    }
    if (command.action === "add_external") {
      if (await activeCount("EXTERNAL") >= MAX_ACTIVE_KEYS_PER_KIND) throw new ApiError(409, `Företaget har redan ${MAX_ACTIVE_KEYS_PER_KIND} externa nycklar. Ta bort en först.`);
      const provider = EXTERNAL_PROVIDERS.find((item) => item.key === command.provider)!;
      // Sealed with the company's own data key, bound to the company and this key's id (beslut 3a, 2026-10-25).
      const id = randomBytes(12).toString("hex");
      const encryptedValue = await sealCompanyKey(ctx.organizationId, id, command.value);
      const created = await prisma.integrationKey.create({ data: { id, organizationId: ctx.organizationId, kind: "EXTERNAL", name: command.name, provider: provider.key, displayHint: externalHint(command.value), encryptedValue, createdById: ctx.user.id }, select: { id: true, displayHint: true } });
      await audit(`Lade till den externa nyckeln ”${command.name}” (${provider.label}).`);
      await securityEvent("api_key_created", "EXTERNAL");
      return NextResponse.json(created);
    }
    const key = await prisma.integrationKey.findFirst({ where: { id: command.id, organizationId: ctx.organizationId, revokedAt: null } });
    if (!key) throw new ApiError(404, "Nyckeln finns inte eller är redan borttagen.");
    if (command.action === "replace_external") {
      if (key.kind !== "EXTERNAL") throw new ApiError(400, "Bara en extern nyckel kan bytas. Skapa en ny API- eller MCP-nyckel i stället.");
      await prisma.$transaction([
        prisma.integrationKey.update({ where: { id: key.id }, data: { encryptedValue: await sealCompanyKey(ctx.organizationId, key.id, command.value), displayHint: externalHint(command.value) } }),
        audit(`Bytte värdet på den externa nyckeln ”${key.name}”.`),
      ]);
      return NextResponse.json({ ok: true });
    }
    // Revoke: an issued key stops working at once and stays in the list as history; an external key's value is erased.
    await prisma.$transaction([
      prisma.integrationKey.update({ where: { id: key.id }, data: { revokedAt: new Date(), revokedById: ctx.user.id, ...(key.kind === "EXTERNAL" ? { encryptedValue: null } : {}) } }),
      audit(key.kind === "EXTERNAL" ? `Tog bort den externa nyckeln ”${key.name}”.` : `Återkallade ${key.kind === "API" ? "API-nyckeln" : "MCP-nyckeln"} ”${key.name}”.`),
    ]);
    await securityEvent("api_key_revoked", key.kind);
    return NextResponse.json({ ok: true });
  } catch (error) {
    return failure(error);
  }
}
