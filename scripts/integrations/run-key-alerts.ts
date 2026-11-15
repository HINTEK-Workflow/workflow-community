// Daily: warns about keys before they stop working (2026-10-03). Each company's admins get one mail per key and
// stage (14 days, 3 days, expired); the operations address under Produktadministration → E-post och utskick gets a mail when
// HINTEK's own OpenAI key is no longer accepted (daily while it lasts), a key card with a Gäller till date is on its way out
// (2026-11-14: 30, 14, 7 and 1 day(s) before, then weekly once gone; SCB's own Giltig till among them), Lantmäteriet's map fails (at once, then weekly), and – 2026-10-26 – the servers wait for
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
import { centralFieldInfo, centralSecret, keyExpiry, markKeyExpiryAlarms } from "../../lib/secrets/central-store";
import { BILLING_EXPIRY_IDS, KEY_EXPIRY_LABELS, OWN_EXPIRY_IDS, dueExpiryAlarms, expiryAlarmText, expiryDateProblem, isKeyExpiryId, type KeyExpiryId } from "../../lib/secrets/key-expiry";
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
  // ---------- Gäller till (2026-11-14): every key card with a last day, SCB's own date among them ----------
  // 30, 14, 7 and 1 day(s) before, each stage once, then once a week while expired (lib/secrets/key-expiry.ts); one mail.
  const expiry = await keyExpiry(true);
  const lookupRow = await prisma.systemSettings.findUnique({ where: { id: "global" }, select: { companyLookup: true } });
  const lookup = (lookupRow?.companyLookup ?? {}) as { validUntil?: string };
  const billing = publicInstance().features.billing;
  const dated = [
    ...Object.entries(expiry.dates).filter(([id]) => isKeyExpiryId(id) && !OWN_EXPIRY_IDS.includes(id) && (billing || !BILLING_EXPIRY_IDS.includes(id)))
      .map(([id, date]) => ({ id, label: KEY_EXPIRY_LABELS[id as KeyExpiryId], on: date.on })),
    ...((await centralFieldInfo("scb.apiKey")).present && lookup.validUntil && !expiryDateProblem(lookup.validUntil) ? [{ id: "scb", label: KEY_EXPIRY_LABELS.scb, on: lookup.validUntil }] : []),
  ];
  const expiryDue = dueExpiryAlarms(dated, expiry.alarmed, now);
  if (expiryDue.length && config.delivery.alerts && config.alertEmail) {
    const mail = expiryAlarmText(expiryDue);
    const text = `${mail.text}\n${absoluteUrl("/?view=server_keys")}`;
    await sendSystemEmail({ to: config.alertEmail, subject: `[${name}] ${mail.subject}`, text, html: `<pre style="font-family:monospace">${escape(text)}</pre>` });
    await markKeyExpiryAlarms(Object.fromEntries(expiryDue.map((alarm) => [alarm.id, alarm.mark])));
    mails++;
  }
  const scb = lookup.validUntil ? `gäller till ${lookup.validUntil}` : "inget slutdatum";
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
  console.log(`keys:alerts klar – ${due.length} nycklar på väg ut, ${mails} mejl skickade, OpenAI: ${openAi}, SCB: ${scb}, Gäller till: ${dated.length} med datum och ${expiryDue.length} att larma om, karta: ${map}, servrar: ${serverLines.length ? `${serverLines.length} att åtgärda` : "inget att åtgärda"}, Meta: ${meta.checked} kontrollerade, LinkedIn: ${linkedin.checked} kontrollerade.`);
}

main().catch((error) => { console.error(error instanceof Error ? error.message : error); process.exitCode = 1; }).finally(() => prisma.$disconnect());
