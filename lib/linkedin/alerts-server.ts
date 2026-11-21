import { prisma } from "@/lib/db";
import { hitRateLimit, RATE_RULES } from "@/lib/security/rate-limit";
import { linkedInAlertAction, linkedInAlertState, linkedInAlertText } from "./alerts";
import { checkLinkedIn } from "./server";

/**
 * The nightly round over every company's LinkedIn connection (run by scripts/integrations/run-key-alerts.ts, like
 * lib/meta/alerts-server.ts): LinkedIn is asked about the token (the card's own check, within the company's read ceiling),
 * and the company's admins get one mail per state and token. The mark is an event in the company's own history.
 */
export type LinkedInAlertMail = { to: string; subject: string; text: string; html: string };

const escape = (text: string) => text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

export async function runLinkedInAlerts(options: { now?: Date; link: string; brand: string; send: (mail: LinkedInAlertMail) => Promise<void> }): Promise<{ checked: number; mails: number }> {
  const now = options.now ?? new Date();
  const rows = await prisma.linkedInConnection.findMany({ where: { accessTokenCipher: { not: null }, clientSecretCipher: { not: null } }, select: { organizationId: true } });
  let checked = 0;
  let mails = 0;
  for (const { organizationId } of rows) {
    const allowed = await hitRateLimit(RATE_RULES.linkedinRead, `linkedin-read:${organizationId}`).then((hit) => hit.allowed).catch(() => true);
    if (allowed) { await checkLinkedIn(organizationId).catch(() => undefined); checked++; }
    const row = await prisma.linkedInConnection.findUnique({ where: { organizationId }, select: { status: true, accessTokenExpiresAt: true, refreshTokenCipher: true, refreshTokenExpiresAt: true, authorName: true, accessTokenCipher: true } });
    if (!row?.accessTokenCipher) continue;
    const state = linkedInAlertState(row, now);
    if (!state) continue;
    const action = linkedInAlertAction(organizationId, state, row.accessTokenCipher);
    if (await prisma.administrationEvent.findFirst({ where: { organizationId, action }, select: { id: true } })) continue;
    const admins = await prisma.organizationMember.findMany({
      where: { organizationId, isActive: true, role: { in: ["OWNER", "ADMIN"] }, user: { isActive: true } },
      select: { user: { select: { email: true } } },
    });
    const { subject, line } = linkedInAlertText(state, row);
    const help = "Tryck Koppla LinkedIn under Inställningar → Kopplingar → Webb och sociala medier:";
    for (const admin of admins) {
      if (!admin.user.email) continue;
      await options.send({ to: admin.user.email, subject: `[${options.brand}] ${subject}`, text: `${line}\n\n${help}\n${options.link}`,
        html: `<p>${escape(line)}</p><p>Tryck Koppla LinkedIn under <a href="${escape(options.link)}">Inställningar → Kopplingar → Webb och sociala medier</a>.</p>` });
      mails++;
    }
    await prisma.administrationEvent.create({ data: { actorId: "system:linkedin-alerts", organizationId, action, detail: `Larm skickat: ${line}`.slice(0, 500) } });
  }
  return { checked, mails };
}
