import { createHmac, timingSafeEqual } from "node:crypto";
import { prisma } from "@/lib/db";
import { env } from "@/lib/env";
import { publicInstance } from "@/lib/instance";
import { sendSystemEmail } from "@/lib/mail/mailer";
import { mailConfig } from "@/lib/mail/settings-server";
import { parseMailingBody, renderMailing } from "@/lib/mail/mailing-document";

/**
 * Utskick (2026-10-03): the superadmin writes a newsletter to those who said yes, or important information to
 * every company's administrators. The recipients are fixed when it is sent and worked off from a queue, a batch at a
 * time, so a long list never holds up a request. A newsletter always carries a one-click way to say no.
 */
export type MailingAudience = "NEWSLETTER" | "ADMINS";
export const MAILING_AUDIENCES: Record<MailingAudience, { label: string; description: string }> = {
  NEWSLETTER: { label: "Nyhetsbrev", description: "De som har sagt ja till nyheter om Workflow och de som följer nyhetsbrevet från webbplatsen. Varje utskick har en länk för att avböja." },
  ADMINS: { label: "Viktig information", description: "Ägare och administratörer i alla aktiva företag. Bara information om tjänsten, till exempel driftstopp eller ändrade villkor – aldrig marknadsföring." },
};

export type MailingRecipientInput = { id: string | null; subscriberId: string | null; email: string };

/** One recipient per address (case ignored); the first wins, so a user who said yes is mailed as the user. */
export function dedupeRecipients(people: MailingRecipientInput[]) {
  const seen = new Set<string>();
  return people.filter((person) => { const key = person.email.trim().toLowerCase(); if (seen.has(key)) return false; seen.add(key); return true; });
}

/**
 * The recipients of an audience at this moment. A newsletter goes to the users who said yes and – since 2026-11-12 – to the
 * confirmed subscribers from the landing page (never a pending one), each address once.
 */
export async function audienceRecipients(audience: MailingAudience): Promise<MailingRecipientInput[]> {
  if (audience === "NEWSLETTER") {
    const [users, subscribers] = await Promise.all([
      prisma.user.findMany({ where: { isActive: true, newsletterOptInAt: { not: null } }, select: { id: true, email: true } }),
      prisma.newsletterSubscriber.findMany({ where: { status: "active" }, select: { id: true, email: true } }),
    ]);
    return dedupeRecipients([...users.map((user) => ({ id: user.id, subscriberId: null, email: user.email })), ...subscribers.map((row) => ({ id: null, subscriberId: row.id, email: row.email }))]);
  }
  const people = await prisma.user.findMany({
    where: { isActive: true, organizationMemberships: { some: { isActive: true, role: { in: ["OWNER", "ADMIN"] }, organization: { isActive: true } } } },
    select: { id: true, email: true },
  });
  return dedupeRecipients(people.map((person) => ({ id: person.id, subscriberId: null, email: person.email })));
}
/** The rows a mailing's recipients are stored as. */
export const recipientRows = (recipients: MailingRecipientInput[]) => recipients.map((person) => ({ userId: person.id, subscriberId: person.subscriberId, email: person.email }));

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
// A subscriber from the landing page (2026-11-12): its own signed link (?s=), with another purpose in the signature so a user's
// link can never be used for a subscriber or the other way round.
const signSubscriber = (subscriberId: string) => createHmac("sha256", env.AUTH_SECRET).update(`newsletter-unsubscribe-subscriber:${subscriberId}`).digest("base64url");
export function subscriberUnsubscribeUrl(subscriberId: string) {
  const url = new URL("/api/newsletter/unsubscribe", env.APP_URL);
  url.searchParams.set("s", subscriberId);
  url.searchParams.set("t", signSubscriber(subscriberId));
  return url.toString();
}
export function validSubscriberUnsubscribe(subscriberId: string, token: string) {
  if (!subscriberId) return false;
  const expected = Buffer.from(signSubscriber(subscriberId));
  const given = Buffer.from(token);
  return expected.length === given.length && timingSafeEqual(expected, given);
}

// The web version of a sent mailing (2026-10-04): one signed address per mailing, readable without signing in,
// because the mail itself is what it shows. It stops working when the mailing is removed (by hand or after its months).
const signWeb = (mailingId: string) => createHmac("sha256", env.AUTH_SECRET).update(`mailing-web:${mailingId}`).digest("base64url");
export const webVersionPath = (mailingId: string) => `/m/${encodeURIComponent(mailingId)}?t=${signWeb(mailingId)}`;
export const webVersionUrl = (mailingId: string) => new URL(webVersionPath(mailingId), env.APP_URL).toString();
export function validWebVersion(mailingId: string, token: string) {
  const expected = Buffer.from(signWeb(mailingId));
  const given = Buffer.from(token);
  return expected.length === given.length && timingSafeEqual(expected, given);
}

/** The mail from its blocks (or an old plain-text body), with the way to say no for a newsletter and the web version. */
export function buildMailingEmail(input: { subject: string; body: string; unsubscribe: string | null; webVersion?: string | null; newsletter?: boolean }) {
  const name = publicInstance().name;
  const newsletter = input.newsletter ?? Boolean(input.unsubscribe);
  const footer = newsletter ? `Du får det här för att du har sagt ja till nyheter från ${name}.` : `Du får det här som administratör i ${name}.`;
  const { html, text } = renderMailing(parseMailingBody(input.body), { name, footer, unsubscribe: input.unsubscribe, webVersion: input.webVersion ?? null });
  return { html, text: `${input.subject}\n\n${text}`, headers: input.unsubscribe ? { "List-Unsubscribe": `<${input.unsubscribe}>`, "List-Unsubscribe-Post": "List-Unsubscribe=One-Click" } : undefined };
}

export async function queueMailing(input: { subject: string; body: string; audience: MailingAudience; actorId: string; releaseVersion?: string | null }) {
  const recipients = await audienceRecipients(input.audience);
  if (!recipients.length) throw new Error("Det finns inga mottagare för det här utskicket.");
  return prisma.mailing.create({
    data: {
      subject: input.subject, body: input.body, audience: input.audience, createdById: input.actorId, releaseVersion: input.releaseVersion ?? null,
      recipients: { create: recipientRows(recipients) },
    },
    select: { id: true, _count: { select: { recipients: true } } },
  });
}

/** Schemalagt utskick (2026-10-06): kept without recipients until its time; they are fixed when it is queued. */
export async function scheduleMailing(input: { subject: string; body: string; audience: MailingAudience; actorId: string; scheduledAt: Date; releaseVersion?: string | null }) {
  return prisma.mailing.create({
    data: { subject: input.subject, body: input.body, audience: input.audience, createdById: input.actorId, status: "SCHEDULED", scheduledAt: input.scheduledAt, releaseVersion: input.releaseVersion ?? null },
    select: { id: true },
  });
}

/**
 * Queues the scheduled mailings whose time has come, with the recipients of that moment. Only a mailing that a person
 * scheduled (or approved from a draft with a chosen time) is ever here: nothing is scheduled by itself.
 */
export async function queueDueMailings(now = new Date()) {
  const due = await prisma.mailing.findMany({ where: { status: "SCHEDULED", scheduledAt: { lte: now } }, select: { id: true, audience: true } });
  let queued = 0;
  for (const mailing of due) {
    const recipients = await audienceRecipients(mailing.audience);
    // Claimed and given its recipients in one transaction, so two workers never queue the same mailing twice and a
    // worker that finishes queued mailings never sees one without its recipients.
    const claimed = await prisma.$transaction(async (tx) => {
      const result = await tx.mailing.updateMany({ where: { id: mailing.id, status: "SCHEDULED" }, data: { status: "QUEUED" } });
      if (!result.count) return false;
      if (recipients.length) await tx.mailingRecipient.createMany({ data: recipientRows(recipients).map((row) => ({ ...row, mailingId: mailing.id })), skipDuplicates: true });
      return true;
    });
    if (claimed) queued++;
  }
  return queued;
}

/**
 * Torrkörning (T5, 2026-10-24: `npm run mailings:send -- --dry-run`): what `processMailings` would do now, only read –
 * nothing is queued, claimed or sent. The scheduled mailings whose time has come are counted with today's recipients,
 * and a run takes at most `limit` of what then waits. Counts only, never an address.
 */
export async function previewMailings(limit = 200, now = new Date()) {
  const config = await mailConfig();
  const due = await prisma.mailing.findMany({ where: { status: "SCHEDULED", scheduledAt: { lte: now } }, select: { id: true, audience: true } });
  let dueRecipients = 0;
  for (const mailing of due) dueRecipients += (await audienceRecipients(mailing.audience)).length;
  const waiting = await prisma.mailingRecipient.count({ where: { status: "PENDING", mailing: { status: "QUEUED" } } });
  return { blocked: Boolean(config.blockedReason), dueMailings: due.length, dueRecipients, waiting, thisRun: Math.min(limit, waiting + dueRecipients) };
}

let running = false;
/** Sends what waits in the queue, at most `limit` mails per call; safe to call from cron and after a new mailing. */
export async function processMailings(limit = 200) {
  if (running) return { sent: 0, failed: 0, skipped: 0 };
  running = true;
  const result = { sent: 0, failed: 0, skipped: 0 };
  try {
    await queueDueMailings();
    const config = await mailConfig();
    const pending = await prisma.mailingRecipient.findMany({
      where: { status: "PENDING", mailing: { status: "QUEUED" } }, orderBy: { id: "asc" }, take: limit,
      select: { id: true, userId: true, subscriberId: true, email: true, mailing: { select: { id: true, subject: true, body: true, audience: true } } },
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
      if (recipient.mailing.audience === "NEWSLETTER" && recipient.subscriberId) {
        const still = await prisma.newsletterSubscriber.count({ where: { id: recipient.subscriberId, status: "active" } });
        if (!still) { await prisma.mailingRecipient.update({ where: { id: recipient.id }, data: { status: "SKIPPED", sentAt: null } }); result.skipped++; continue; }
      }
      try {
        const mail = buildMailingEmail({ subject: recipient.mailing.subject, body: recipient.mailing.body, webVersion: webVersionUrl(recipient.mailing.id),
          newsletter: recipient.mailing.audience === "NEWSLETTER",
          unsubscribe: recipient.mailing.audience !== "NEWSLETTER" ? null : recipient.userId ? unsubscribeUrl(recipient.userId) : recipient.subscriberId ? subscriberUnsubscribeUrl(recipient.subscriberId) : null });
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
