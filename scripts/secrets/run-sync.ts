// Centrala nycklar – kontrollen av de förseglade värdena och larm (2026-10-26). Every ten minutes from the server's
// cron file (through scripts/ops/run-job.sh):
//   - every installation: an alarm, at most once a day, when a sealed value cannot be opened (wrong or missing key in the
//     ring);
//   - an installation with the commercial part (HINTEK's own, ee/secrets/central-keys.ts): the comparison with the key vault
//     and its alarms, and once a day the emergency copy of .env and the quarterly restore drill.
// Prints counts and field names only, never a value. Without driftlarm under E-post the alarm is only printed (exit 3).
// Run: npm run secrets:sync
import "dotenv/config";
import { prisma } from "../../lib/db";
import { sendSystemEmail } from "../../lib/mail/mailer";
import { mailConfig } from "../../lib/mail/settings-server";
import { publicInstance } from "../../lib/instance";
import { markSealedCheckAlarm, sealedCheckAlarmedAt } from "../../lib/secrets/central-store";
import { inventory } from "../../lib/secrets/reseal";

const DAY_MS = 24 * 60 * 60 * 1000;
const escape = (text: string) => text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

async function alarm(subject: string, text: string) {
  const config = await mailConfig();
  const full = `[${publicInstance().name}] ${subject}`;
  if (!config.delivery.alerts || !config.alertEmail || config.blockedReason) {
    console.log(`ALERT (inte skickat – larm-e-post är avstängd): ${full}\n${text}`);
    process.exitCode = 3;
    return;
  }
  try {
    await sendSystemEmail({ to: config.alertEmail, subject: full, text, html: `<pre style="font-family:monospace">${escape(text)}</pre>` });
    console.log(`ALERT skickat till driftadressen: ${full}`);
  } catch {
    // Mail itself may be what is missing: the cron log keeps the alarm and monitor.sh sees the failed job.
    console.log(`ALERT (kunde inte skickas med e-post): ${full}\n${text}`);
    process.exitCode = 3;
  }
}

async function main() {
  const now = new Date();
  // The commercial part's own routines (the key vault, the emergency copy); none without it.
  const { serverExtensions } = await import("../../lib/extensions/server");
  const keys = serverExtensions.centralKeys ? await serverExtensions.centralKeys() : null;
  const summary = keys ? await keys.job(now, alarm) : "inget nyckelvalv";

  // Sealed values that cannot be opened (every installation): at most one alarm a day.
  const alarmedAt = await sealedCheckAlarmedAt();
  if (!alarmedAt || now.getTime() - Date.parse(alarmedAt) >= DAY_MS) {
    const unreadable = Object.entries(await inventory()).filter(([, count]) => count.unreadable > 0);
    if (unreadable.length) {
      await alarm("Förseglade värden går inte att öppna", `${unreadable.map(([place, count]) => `${place}: ${count.unreadable}`).join("\n")}\n\nNyckelringen på servern saknar den hemlighet som förseglade dem. Ändra inget i Workflow: lägg tillbaka den hemlighet som användes när värdena sparades.`);
      await markSealedCheckAlarm(now.toISOString());
    }
  }
  console.log(`secrets:sync klar – ${summary}.`);
}

main().catch((error) => { console.error(error instanceof Error ? error.message : "secrets:sync misslyckades."); process.exitCode = 1; }).finally(() => prisma.$disconnect());
