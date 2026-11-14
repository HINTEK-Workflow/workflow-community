// Daily: warns about keys before they stop working (2026-10-03). Each company's admins get one mail per key and
// stage (14 days, 3 days, expired); the operations address under Produktadministration → E-post och utskick gets a mail when
// HINTEK's own OpenAI key is no longer accepted (daily while it lasts), SCB's key is on its way out (14 and 3 days, then
// weekly once gone), Lantmäteriet's map fails (at once, then weekly), and – 2026-10-26 – the servers wait for
// security updates or a restart, have their automatic updates off or no fresh status (lib/ops/host-status.ts
// serverAlarmLines; daily while it lasts). Facebook och Instagram (2026-11-10): each company's admins a week before its Meta
// token or data access runs out and when it stops working, once per state and token (lib/meta/alerts-server.ts). Nothing is sent from a loopback QA instance. Prints counts only.
// Run: npm run keys:alerts
import "dotenv/config";
import { prisma } from "../../lib/db";
import { sendSystemEmail } from "../../lib/mail/mailer";
import { mailConfig } from "../../lib/mail/settings-server";
import { publicInstance } from "../../lib/instance";
import { absoluteUrl, env } from "../../lib/env";
import { keyAlertAction, keyAlertLine, keyAlertStage } from "../../lib/integrations/key-alerts";
import { centralFieldInfo, centralSecret } from "../../lib/secrets/central-store";
import { effectiveOpenAiSettings, providerProblem, storedProviderSchema } from "../../lib/ai/provider-settings";
import { checkMap, mapAlarmDue, mapSettingsView, markMapAlarmSent } from "@/lib/map/topowebb";
import { readServerViews } from "@/lib/ops/host-status-server";
import { serverAlarmLines, SERVER_UPDATES_HREF } from "@/lib/ops/host-status";

// The job runs outside Next (tsx), so it reads the provider setting itself instead of the server-only modules.
async function openAiSettingsForJob() {
  const row = await prisma.systemSettings.findUnique({ where: { id: "global" }, select: { aiProvider: true } });
  const stored = storedProviderSchema.parse(row?.aiProvider ?? {});
  return effectiveOpenAiSettings(stored, env, await centralSecret("openai.apiKey"));
}

/** Whether OpenAI accepts the key: lists the models, which costs nothing. */
async function checkOpenAiKey(apiKey: string) {
  try {
    const response = await fetch("https://api.openai.com/v1/models", { headers: { authorization: `Bearer ${apiKey}` }, signal: AbortSignal.timeout(20_000) });
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
    const link = absoluteUrl("/?view=advanced");
    const text = `${lines.join("\n")}\n\nSkapa en ny nyckel och byt i det system som använder den, under Inställningar → Kopplingar:\n${link}`;
    for (const admin of admins) {
      await sendSystemEmail({ to: admin.user.email, subject: `[${name}] Nycklar som går ut`, text, html: `<p>${lines.map(escape).join("<br>")}</p><p>Skapa en ny nyckel och byt i det system som använder den, under <a href="${link}">Inställningar → Kopplingar</a>.</p>` });
      mails++;
    }
    await prisma.administrationEvent.createMany({ data: items.map(({ key, stage }) => ({ actorId: "system:key-alerts", organizationId, action: keyAlertAction(key.id, stage), detail: `Larm skickat: ${keyAlertLine({ ...key, expiresAt: key.expiresAt! }, stage)}` })) });
  }

  // ---------- Facebook och Instagram (2026-11-10): each company's token, a week before and when it stops working ----------
  const { runMetaAlerts } = await import("../../lib/meta/alerts-server");
  const meta = await runMetaAlerts({ now, link: absoluteUrl("/?view=advanced&section=web"), brand: name,
    send: async (mail) => { await sendSystemEmail(mail); } }).catch(() => ({ checked: 0, mails: 0 }));
  mails += meta.mails;

  // ---------- LinkedIn (2026-11-11): the same for each company's LinkedIn token (renewed by itself where LinkedIn allows) ----------
  const { runLinkedInAlerts } = await import("../../lib/linkedin/alerts-server");
  const linkedin = await runLinkedInAlerts({ now, link: absoluteUrl("/?view=advanced&section=web"), brand: name,
    send: async (mail) => { await sendSystemEmail(mail); } }).catch(() => ({ checked: 0, mails: 0 }));
  mails += linkedin.mails;

  // ---------- HINTEK's own OpenAI key ----------
  const ai = await openAiSettingsForJob();
  let openAi = "ej påslaget";
  if (ai.requested && ai.apiKey) {
    const check = await checkOpenAiKey(ai.apiKey);
    openAi = check.ok ? "godtas" : check.message;
    if (!check.ok && config.delivery.alerts && config.alertEmail) {
      const text = `HINTEK AI:s OpenAI-nyckel fungerar inte: ${check.message}\nHINTEK AI svarar inte förrän nyckeln är bytt under Produktadministration → Priser och AI:\n${absoluteUrl("/?view=ai_admin")}`;
      await sendSystemEmail({ to: config.alertEmail, subject: `[${name}] OpenAI-nyckeln fungerar inte`, text, html: `<pre style="font-family:monospace">${escape(text)}</pre>` });
      mails++;
    }
  } else if (ai.requested && providerProblem(ai)) openAi = providerProblem(ai)!;
  // ---------- SCB's key for the company lookup (2026-10-03: valid two years) ----------
  const lookupRow = await prisma.systemSettings.findUnique({ where: { id: "global" }, select: { companyLookup: true } });
  const lookup = (lookupRow?.companyLookup ?? {}) as { keyCipher?: string; validUntil?: string; alerted?: string[] };
  let scb = "inget slutdatum";
  if ((await centralFieldInfo("scb.apiKey")).present && lookup.validUntil) {
    const end = new Date(`${lookup.validUntil}T23:59:59Z`);
    const stage = keyAlertStage(end, now) ?? (end.getTime() < now.getTime() ? "expired" : null);
    scb = stage ? `${stage} (${lookup.validUntil})` : `gäller till ${lookup.validUntil}`;
    // Gone: once more every week until a new key is in (the mark carries the week since the last day).
    const weeks = stage === "expired" ? Math.floor((now.getTime() - end.getTime()) / (7 * 86_400_000)) : 0;
    const mark = `${stage}:${lookup.validUntil}${weeks ? `:${weeks}` : ""}`;
    if (stage && !(lookup.alerted ?? []).includes(mark) && config.delivery.alerts && config.alertEmail) {
      const when = stage === "expired" ? `gick ut ${lookup.validUntil}` : `går ut ${lookup.validUntil}`;
      const text = `SCB-nyckeln för företagsuppslag ${when}. Förnya den hos SCB (registreraafr.scb.se) och lägg in den nya under Produktadministration → Tjänster och nycklar:\n${absoluteUrl("/?view=server_keys&section=scb")}\nUtan nyckel fyller kunderna i företagsnamnet själva.`;
      await sendSystemEmail({ to: config.alertEmail, subject: `[${name}] SCB-nyckeln ${when}`, text, html: `<pre style="font-family:monospace">${escape(text)}</pre>` });
      await prisma.systemSettings.update({ where: { id: "global" }, data: { companyLookup: { ...lookup, alerted: [...(lookup.alerted ?? []), mark].slice(-20) } } });
      mails++;
    }
  }
  // ---------- Lantmäteriet's map (2026-10-04): the sign-in is checked every morning, an alarm once per failure ----------
  let map = "ingen inloggning";
  if ((await mapSettingsView()).configured) {
    const check = await checkMap();
    map = check.ok ? "fungerar" : check.message;
    const due = await mapAlarmDue(now);
    if (due && config.delivery.alerts && config.alertEmail) {
      const text = `Kartan från Lantmäteriet fungerar inte: ${due.message}\nKartan visas inte förrän inloggningen fungerar. Kontrollera behörigheten i Geotorget och inloggningen under Produktadministration → Tjänster och nycklar:\n${absoluteUrl("/?view=server_keys&section=map")}\nAllt annat i Workflow fungerar som vanligt.`;
      await sendSystemEmail({ to: config.alertEmail, subject: `[${name}] Kartan från Lantmäteriet fungerar inte`, text, html: `<pre style="font-family:monospace">${escape(text)}</pre>` });
      await markMapAlarmSent();
      mails++;
    }
  }
  // ---------- The servers (2026-10-26): updates, restart, automatic updates, a fresh status – daily while it lasts ----------
  const serverLines = serverAlarmLines(await readServerViews(now));
  if (serverLines.length && config.delivery.alerts && config.alertEmail) {
    const text = `${serverLines.join("\n")}\n\nSe Produktadministration → Drift och säkerhet → Servrar och uppdateringar:\n${absoluteUrl(SERVER_UPDATES_HREF)}\nSå uppdaterar och startar du om: docs/drift/SERVERUPPDATERINGAR.md. Mejlet kommer varje morgon tills det är åtgärdat.`;
    await sendSystemEmail({ to: config.alertEmail, subject: `[${name}] Servrarna behöver åtgärd (${serverLines.length})`, text, html: `<pre style="font-family:monospace">${escape(text)}</pre>` });
    mails++;
  }
  console.log(`keys:alerts klar – ${due.length} nycklar på väg ut, ${mails} mejl skickade, OpenAI: ${openAi}, SCB: ${scb}, karta: ${map}, servrar: ${serverLines.length ? `${serverLines.length} att åtgärda` : "inget att åtgärda"}, Meta: ${meta.checked} kontrollerade, LinkedIn: ${linkedin.checked} kontrollerade.`);
}

main().catch((error) => { console.error(error instanceof Error ? error.message : error); process.exitCode = 1; }).finally(() => prisma.$disconnect());
