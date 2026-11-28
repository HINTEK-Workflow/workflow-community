import { publicInstance } from "@/lib/instance";
import { sendSystemEmail } from "@/lib/mail/mailer";
import { mailConfig } from "@/lib/mail/settings-server";
import { CHAIN_BREAK_TEXT, PLATFORM_CHAIN } from "./chain";
import { CHAIN_LOG_LABEL, type ChainResult } from "./chain-server";

/**
 * Larm om en bruten loggkedja (K3.1, 2026-11-27): the operations alarm, the same way as the credit
 * check – to the address under Installation → E-post when driftlarm is on, otherwise printed. Only chains found
 * broken this night: a break already told is shown on the pages (the company's admin, the superadmin) but not mailed again.
 * The mail holds the log, the company's id and where – never a row of the log.
 */
export function chainAlertText(broken: ChainResult[]) {
  return [
    `${broken.length === 1 ? "En loggkedja" : `${broken.length} loggkedjor`} stämmer inte efter nattens kontroll:`,
    ...broken.map((chain) => `- ${CHAIN_LOG_LABEL[chain.log]}, ${chain.chainKey === PLATFORM_CHAIN ? "installationen" : `företag ${chain.chainKey}`}: ${chain.reason ? CHAIN_BREAK_TEXT[chain.reason] : "kedjan stämmer inte."}${chain.seq ? ` Rad ${chain.seq}.` : ""}`),
    "",
    "En rad har ändrats eller tagits bort utanför Workflow. Loggen rensas inte förrän någon har tittat på den.",
    "Se Installation → Drift och säkerhet → Loggarnas kedja. Jämför med nattens backup innan något ändras.",
  ].join("\n");
}

/** Sends the alarm; returns whether it went (false: printed, as when driftlarm is off). */
export async function alertBrokenChains(results: ChainResult[]) {
  const broken = results.filter((chain) => !chain.ok && chain.newlyBroken);
  if (!broken.length) return null;
  const subject = `[${publicInstance().name}] Loggkedja stämmer inte (${broken.length})`;
  const text = chainAlertText(broken);
  const config = await mailConfig();
  if (!config.delivery.alerts || !config.alertEmail || config.blockedReason) {
    console.log(`ALERT (inte skickat – larm-e-post är avstängd): ${subject}\n${text}`);
    return false;
  }
  try {
    const html = `<pre style="font-family:monospace">${text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")}</pre>`;
    await sendSystemEmail({ to: config.alertEmail, subject, text, html });
    console.log(`ALERT skickat till driftadressen: ${subject}`);
    return true;
  } catch {
    console.log(`ALERT (kunde inte skickas med e-post): ${subject}\n${text}`);
    return false;
  }
}
