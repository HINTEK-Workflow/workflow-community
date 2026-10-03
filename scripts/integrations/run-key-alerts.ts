// Daily: warns about keys before they stop working (2026-10-03). Each company's admins get one mail per key and
// stage (14 days, 3 days, expired); the operations address under Produktadministration → E-post gets a mail when
// HINTEK's own OpenAI key is no longer accepted. Nothing is sent from a loopback QA instance. Prints counts only.
// Run: npm run keys:alerts
import "dotenv/config";
import { prisma } from "../../lib/db";
import { sendSystemEmail } from "../../lib/mail/mailer";
import { mailConfig } from "../../lib/mail/settings-server";
import { publicInstance } from "../../lib/instance";
import { absoluteUrl, env } from "../../lib/env";
import { keyAlertAction, keyAlertLine, keyAlertStage } from "../../lib/integrations/key-alerts";
import { decryptExternalKey } from "../../lib/integrations/keys";
import { effectiveOpenAiSettings, providerProblem, storedProviderSchema } from "../../lib/ai/provider-settings";

// The job runs outside Next (tsx), so it reads the provider setting itself instead of the server-only modules.
async function openAiSettingsForJob() {
  const row = await prisma.systemSettings.findUnique({ where: { id: "global" }, select: { aiProvider: true } });
  const stored = storedProviderSchema.parse(row?.aiProvider ?? {});
  let key = "";
  try { key = stored.apiKeyCipher ? decryptExternalKey(stored.apiKeyCipher, env.INTEGRATION_KEYS_SECRET ?? env.AUTH_SECRET) : ""; } catch { key = ""; }
  return effectiveOpenAiSettings(stored, env, key);
}

/** Whether OpenAI accepts the key: lists the models, which costs nothing. */
async function checkOpenAiKey(apiKey: string, region: "GLOBAL" | "EU") {
  try {
    const response = await fetch(`${region === "EU" ? "https://eu.api.openai.com/v1" : "https://api.openai.com/v1"}/models`, { headers: { authorization: `Bearer ${apiKey}` }, signal: AbortSignal.timeout(20_000) });
    if (response.ok) return { ok: true, message: "OpenAI godtar nyckeln." };
    return { ok: false, message: response.status === 401 ? "OpenAI godtar inte nyckeln." : response.status === 429 ? "OpenAI svarar att kontot saknar kredit eller har nått sin gräns." : `OpenAI svarade ${response.status}.` };
  } catch { return { ok: false, message: "OpenAI svarade inte." }; }
}

const escape = (text: string) => text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

async function main() {
  const now = new Date();
  const config = await mailConfig();
  const name = publicInstance().name;
  if (config.blockedReason) { console.log(`keys:alerts – inga utskick: ${config.blockedReason}`); return; }

  // ---------- The companies' API and MCP keys ----------
  const keys = await prisma.integrationKey.findMany({
    where: { kind: { in: ["API", "MCP"] }, revokedAt: null, expiresAt: { not: null, lte: new Date(now.getTime() + 14 * 86_400_000), gte: new Date(now.getTime() - 7 * 86_400_000) } },
    select: { id: true, name: true, kind: true, expiresAt: true, organizationId: true, createdById: true },
  });
  const due = keys.flatMap((key) => { const stage = keyAlertStage(key.expiresAt, now); return stage ? [{ key, stage }] : []; });
  const sent = new Set((await prisma.administrationEvent.findMany({ where: { action: { in: due.map(({ key, stage }) => keyAlertAction(key.id, stage)) } }, select: { action: true } })).map((event) => event.action));
  const byCompany = new Map<string, typeof due>();
  for (const item of due) if (!sent.has(keyAlertAction(item.key.id, item.stage))) byCompany.set(item.key.organizationId, [...(byCompany.get(item.key.organizationId) ?? []), item]);
  let mails = 0;
  for (const [organizationId, items] of byCompany) {
    const admins = await prisma.organizationMember.findMany({
      where: { organizationId, isActive: true, role: { in: ["OWNER", "ADMIN"] }, user: { isActive: true } },
      select: { user: { select: { email: true } } },
    });
    const lines = items.map(({ key, stage }) => keyAlertLine({ ...key, expiresAt: key.expiresAt! }, stage));
    const link = absoluteUrl("/?view=integrations");
    const text = `${lines.join("\n")}\n\nSkapa en ny nyckel och byt i det system som använder den, under Inställningar → API och MCP:\n${link}`;
    for (const admin of admins) {
      await sendSystemEmail({ to: admin.user.email, subject: `[${name}] Nycklar som går ut`, text, html: `<p>${lines.map(escape).join("<br>")}</p><p>Skapa en ny nyckel och byt i det system som använder den, under <a href="${link}">Inställningar → API och MCP</a>.</p>` });
      mails++;
    }
    await prisma.administrationEvent.createMany({ data: items.map(({ key, stage }) => ({ actorId: "system:key-alerts", organizationId, action: keyAlertAction(key.id, stage), detail: `Larm skickat: ${keyAlertLine({ ...key, expiresAt: key.expiresAt! }, stage)}` })) });
  }

  // ---------- HINTEK's own OpenAI key ----------
  const ai = await openAiSettingsForJob();
  let openAi = "ej påslaget";
  if (ai.requested && ai.apiKey) {
    const check = await checkOpenAiKey(ai.apiKey, ai.region);
    openAi = check.ok ? "godtas" : check.message;
    if (!check.ok && config.delivery.alerts && config.alertEmail) {
      const text = `HINTEK AI:s OpenAI-nyckel fungerar inte: ${check.message}\nHINTEK AI svarar inte förrän nyckeln är bytt under Produktadministration → AI:\n${absoluteUrl("/?view=ai_admin")}`;
      await sendSystemEmail({ to: config.alertEmail, subject: `[${name}] OpenAI-nyckeln fungerar inte`, text, html: `<pre style="font-family:monospace">${escape(text)}</pre>` });
      mails++;
    }
  } else if (ai.requested && providerProblem(ai)) openAi = providerProblem(ai)!;
  // ---------- SCB's key for the company lookup (2026-10-03: valid two years) ----------
  const lookupRow = await prisma.systemSettings.findUnique({ where: { id: "global" }, select: { companyLookup: true } });
  const lookup = (lookupRow?.companyLookup ?? {}) as { keyCipher?: string; validUntil?: string; alerted?: string[] };
  let scb = "inget slutdatum";
  if (lookup.keyCipher && lookup.validUntil) {
    const stage = keyAlertStage(new Date(`${lookup.validUntil}T23:59:59Z`), now);
    scb = stage ? `${stage} (${lookup.validUntil})` : `gäller till ${lookup.validUntil}`;
    const mark = `${stage}:${lookup.validUntil}`;
    if (stage && !(lookup.alerted ?? []).includes(mark) && config.delivery.alerts && config.alertEmail) {
      const when = stage === "expired" ? `gick ut ${lookup.validUntil}` : `går ut ${lookup.validUntil}`;
      const text = `SCB-nyckeln för företagsuppslag ${when}. Förnya den hos SCB (registreraafr.scb.se) och lägg in den nya under Produktadministration → Inloggning:\n${absoluteUrl("/?view=login_settings")}\nUtan nyckel fyller kunderna i företagsnamnet själva.`;
      await sendSystemEmail({ to: config.alertEmail, subject: `[${name}] SCB-nyckeln ${when}`, text, html: `<pre style="font-family:monospace">${escape(text)}</pre>` });
      await prisma.systemSettings.update({ where: { id: "global" }, data: { companyLookup: { ...lookup, alerted: [...(lookup.alerted ?? []), mark] } } });
      mails++;
    }
  }
  console.log(`keys:alerts klar – ${due.length} nycklar på väg ut, ${mails} mejl skickade, OpenAI: ${openAi}, SCB: ${scb}.`);
}

main().catch((error) => { console.error(error instanceof Error ? error.message : error); process.exitCode = 1; }).finally(() => prisma.$disconnect());
