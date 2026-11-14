import { prisma } from "@/lib/db";
import { hitRateLimit, RATE_RULES } from "@/lib/security/rate-limit";
import { metaAlertAction, metaAlertState, metaAlertText } from "./alerts";
import { checkMeta } from "./server";

/**
 * The nightly round over every company's Facebook och Instagram connection (run by scripts/integrations/run-key-alerts.ts):
 * Meta is asked about the token (the card's own check, within the company's read ceiling), and the company's admins get one
 * mail per state and token – a week before the token or the data access runs out, and when it has stopped working. The mark
 * is an event in the company's own administration history; nothing about the post or a key is in it or in the mail.
 */
export type MetaAlertMail = { to: string; subject: string; text: string; html: string };

const escape = (text: string) => text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

export async function runMetaAlerts(options: { now?: Date; link: string; brand: string; send: (mail: MetaAlertMail) => Promise<void> }): Promise<{ checked: number; mails: number }> {
  const now = options.now ?? new Date();
  const rows = await prisma.metaConnection.findMany({ where: { userTokenCipher: { not: null }, appSecretCipher: { not: null } }, select: { organizationId: true } });
  let checked = 0;
  let mails = 0;
  for (const { organizationId } of rows) {
    const allowed = await hitRateLimit(RATE_RULES.metaRead, `meta-read:${organizationId}`).then((hit) => hit.allowed).catch(() => true);
    if (allowed) { await checkMeta(organizationId).catch(() => undefined); checked++; }
    const row = await prisma.metaConnection.findUnique({ where: { organizationId }, select: { status: true, userTokenExpiresAt: true, dataAccessExpiresAt: true, pageName: true, userTokenCipher: true } });
    if (!row?.userTokenCipher) continue;
    const state = metaAlertState(row, now);
    if (!state) continue;
    const action = metaAlertAction(organizationId, state, row.userTokenCipher);
    if (await prisma.administrationEvent.findFirst({ where: { organizationId, action }, select: { id: true } })) continue;
    const admins = await prisma.organizationMember.findMany({
      where: { organizationId, isActive: true, role: { in: ["OWNER", "ADMIN"] }, user: { isActive: true } },
      select: { user: { select: { email: true } } },
    });
    const { subject, line } = metaAlertText(state, row);
    const help = "Hämta en ny token i Graph API Explorer och klistra in den under Inställningar → Kopplingar → Webb och sociala medier:";
    for (const admin of admins) {
      if (!admin.user.email) continue;
      await options.send({ to: admin.user.email, subject: `[${options.brand}] ${subject}`, text: `${line}\n\n${help}\n${options.link}`,
        html: `<p>${escape(line)}</p><p>Hämta en ny token i Graph API Explorer och klistra in den under <a href="${escape(options.link)}">Inställningar → Kopplingar → Webb och sociala medier</a>.</p>` });
      mails++;
    }
    await prisma.administrationEvent.create({ data: { actorId: "system:meta-alerts", organizationId, action, detail: `Larm skickat: ${line}`.slice(0, 500) } });
  }
  return { checked, mails };
}
