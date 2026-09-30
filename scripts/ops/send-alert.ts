// Sends one operations alert (drift, 2026-09-30). Runs inside the app container, so it uses the app's SMTP settings:
//   docker compose -p workflowhintekse exec -T app npm run --silent ops:alert -- "Ämne" < meddelande.txt
// Without driftlarm switched on under E-post (or ALERT_EMAIL_DELIVERY_ENABLED; always off on loopback QA) it only prints the alert and exits 3, so the caller
// can log it. The message is plain text from the monitor – never customer data.
import "dotenv/config";
import { sendSystemEmail } from "../../lib/mail/mailer";
import { mailConfig } from "../../lib/mail/settings-server";
import { publicInstance } from "../../lib/instance";

async function main() {
  const subject = `[${publicInstance().name}] ${(process.argv[2] ?? "Driftlarm").slice(0, 150)}`;
  const chunks: Buffer[] = [];
  if (!process.stdin.isTTY) for await (const chunk of process.stdin) chunks.push(Buffer.from(chunk));
  const text = Buffer.concat(chunks).toString("utf8").slice(0, 20_000) || "(inget meddelande)";
  const config = await mailConfig();
  if (!config.delivery.alerts || !config.alertEmail) {
    console.log(`ALERT (inte skickat – larm-e-post är avstängd): ${subject}\n${text}`);
    process.exitCode = 3;
    return;
  }
  const escaped = text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  await sendSystemEmail({ to: config.alertEmail, subject, text, html: `<pre style="font-family:monospace">${escaped}</pre>` });
  console.log(`ALERT skickat till driftadressen: ${subject}`);
}

main().catch((error) => { console.error(error instanceof Error ? error.message : error); process.exitCode = 1; });
