import { createHmac, timingSafeEqual } from "node:crypto";
import { prisma } from "@/lib/db";
import { env } from "@/lib/env";
import { publicInstance } from "@/lib/instance";
import { sendSystemEmail } from "@/lib/mail/mailer";
import { mailConfig } from "@/lib/mail/settings-server";

/**
 * Utskick (2026-10-03): the superadmin writes a newsletter to those who said yes, or important information to
 * every company's administrators. The recipients are fixed when it is sent and worked off from a queue, a batch at a
 * time, so a long list never holds up a request. A newsletter always carries a one-click way to say no.
 */
export type MailingAudience = "NEWSLETTER" | "ADMINS";
export const MAILING_AUDIENCES: Record<MailingAudience, { label: string; description: string }> = {
  NEWSLETTER: { label: "Nyhetsbrev", description: "De som har sagt ja till nyheter om Workflow. Mejlet får en länk för att avböja." },
  ADMINS: { label: "Viktig information", description: "Ägare och administratörer i alla aktiva företag. Bara information om tjänsten, till exempel driftstopp eller ändrade villkor – aldrig marknadsföring." },
};

export async function audienceRecipients(audience: MailingAudience) {
  const people = audience === "NEWSLETTER"
    ? await prisma.user.findMany({ where: { isActive: true, newsletterOptInAt: { not: null } }, select: { id: true, email: true } })
    : await prisma.user.findMany({
      where: { isActive: true, organizationMemberships: { some: { isActive: true, role: { in: ["OWNER", "ADMIN"] }, organization: { isActive: true } } } },
      select: { id: true, email: true },
    });
  const seen = new Set<string>();
  return people.filter((person) => !seen.has(person.email.toLowerCase()) && seen.add(person.email.toLowerCase()));
}

const sign = (userId: string) => createHmac("sha256", env.AUTH_SECRET).update(`newsletter-unsubscribe:${userId}`).digest("base64url");
export function unsubscribeUrl(userId: string) {
  const url = new URL("/api/newsletter/unsubscribe", env.APP_URL);
  url.searchParams.set("u", userId);
  url.searchParams.set("t", sign(userId));
  return url.toString();
}
export function validUnsubscribe(userId: string, token: string) {
  const expected = Buffer.from(sign(userId));
  const given = Buffer.from(token);
  return expected.length === given.length && timingSafeEqual(expected, given);
}

const escapeHtml = (value: string) => value.replace(/[&<>"']/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#039;" })[character]!);

/** Plain text written by the superadmin: a blank line starts a new paragraph, and addresses become links. */
export function buildMailingEmail(input: { subject: string; body: string; unsubscribe: string | null }) {
  const name = publicInstance().name;
  const paragraphs = input.body.trim().split(/\n\s*\n/).map((part) => part.trim()).filter(Boolean);
  const linked = (text: string) => escapeHtml(text).replace(/https?:\/\/[^\s<]+/g, (url) => `<a href="${url}" style="color:#135bec;">${url}</a>`).replace(/\n/g, "<br>");
  const footer = input.unsubscribe
    ? `Du får det här för att du har sagt ja till nyheter från ${escapeHtml(name)}. <a href="${escapeHtml(input.unsubscribe)}" style="color:#6b7280;">Avböj fler nyhetsbrev</a>.`
    : `Du får det här som administratör i ${escapeHtml(name)}.`;
  const html = `<div style="margin:0;background:#f3f7ff;padding:32px 16px;font-family:'Segoe UI',Arial,sans-serif;color:#172033;">
  <table role="presentation" cellpadding="0" cellspacing="0" style="width:100%;max-width:600px;margin:0 auto;background:#ffffff;border:1px solid #dbe4f0;border-radius:24px;overflow:hidden;">
    <tr><td style="padding:28px 28px 8px;"><p style="margin:0 0 10px;font-size:12px;letter-spacing:0.2em;text-transform:uppercase;color:#7b8798;">${escapeHtml(name)}</p><h1 style="margin:0;font-size:26px;line-height:1.2;">${escapeHtml(input.subject)}</h1></td></tr>
    <tr><td style="padding:8px 28px 16px;font-size:15px;line-height:1.7;color:#384458;">${paragraphs.map((part) => `<p style="margin:0 0 14px;">${linked(part)}</p>`).join("")}</td></tr>
    <tr><td style="padding:16px 28px 28px;font-size:12px;line-height:1.6;color:#6b7280;border-top:1px solid #eef2f7;">${footer}</td></tr>
  </table>
</div>`;
  const text = `${input.subject}\n\n${paragraphs.join("\n\n")}\n\n${input.unsubscribe ? `Avböj fler nyhetsbrev: ${input.unsubscribe}` : `Du får det här som administratör i ${name}.`}\n`;
  return { html, text, headers: input.unsubscribe ? { "List-Unsubscribe": `<${input.unsubscribe}>`, "List-Unsubscribe-Post": "List-Unsubscribe=One-Click" } : undefined };
}

export async function queueMailing(input: { subject: string; body: string; audience: MailingAudience; actorId: string }) {
  const recipients = await audienceRecipients(input.audience);
  if (!recipients.length) throw new Error("Det finns inga mottagare för det här utskicket.");
  return prisma.mailing.create({
    data: {
      subject: input.subject, body: input.body, audience: input.audience, createdById: input.actorId,
      recipients: { create: recipients.map((person) => ({ userId: person.id, email: person.email })) },
    },
    select: { id: true, _count: { select: { recipients: true } } },
  });
}

let running = false;
/** Sends what waits in the queue, at most `limit` mails per call; safe to call from cron and after a new mailing. */
export async function processMailings(limit = 200) {
  if (running) return { sent: 0, failed: 0, skipped: 0 };
  running = true;
  const result = { sent: 0, failed: 0, skipped: 0 };
  try {
    const config = await mailConfig();
    const pending = await prisma.mailingRecipient.findMany({
      where: { status: "PENDING", mailing: { status: "QUEUED" } }, orderBy: { id: "asc" }, take: limit,
      select: { id: true, userId: true, email: true, mailing: { select: { subject: true, body: true, audience: true } } },
    });
    for (const recipient of pending) {
      // A loopback QA instance never sends: the recipients are marked as skipped so the queue still finishes.
      if (config.blockedReason) {
        await prisma.mailingRecipient.updateMany({ where: { id: recipient.id, status: "PENDING" }, data: { status: "SKIPPED" } });
        result.skipped++;
        continue;
      }
      // Claimed before sending, so two workers never send the same mail.
      const claimed = await prisma.mailingRecipient.updateMany({ where: { id: recipient.id, status: "PENDING" }, data: { status: "SENT", sentAt: new Date() } });
      if (!claimed.count) continue;
      // Someone who said no after the mailing was queued is not sent the newsletter.
      if (recipient.mailing.audience === "NEWSLETTER" && recipient.userId) {
        const still = await prisma.user.count({ where: { id: recipient.userId, isActive: true, newsletterOptInAt: { not: null } } });
        if (!still) { await prisma.mailingRecipient.update({ where: { id: recipient.id }, data: { status: "SKIPPED", sentAt: null } }); result.skipped++; continue; }
      }
      try {
        const mail = buildMailingEmail({ subject: recipient.mailing.subject, body: recipient.mailing.body,
          unsubscribe: recipient.mailing.audience === "NEWSLETTER" && recipient.userId ? unsubscribeUrl(recipient.userId) : null });
        await sendSystemEmail({ to: recipient.email, subject: recipient.mailing.subject, ...mail });
        result.sent++;
      } catch {
        await prisma.mailingRecipient.update({ where: { id: recipient.id }, data: { status: "FAILED", sentAt: null } });
        result.failed++;
      }
    }
    // A mailing is done when nothing of it waits any more.
    const open = await prisma.mailing.findMany({ where: { status: "QUEUED" }, select: { id: true } });
    for (const mailing of open) {
      if (!(await prisma.mailingRecipient.count({ where: { mailingId: mailing.id, status: "PENDING" } })))
        await prisma.mailing.update({ where: { id: mailing.id }, data: { status: "SENT", finishedAt: new Date() } });
    }
    return result;
  } finally {
    running = false;
  }
}
