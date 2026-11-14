import { prisma } from "@/lib/db";
import { env } from "@/lib/env";
import { ApiError } from "@/lib/kfid/errors";
import { publicInstance } from "@/lib/instance";
import { postNewsletterDocument, resolvePostMail, type PostForMail } from "@/lib/mail/post-newsletter-mail";
import { audienceRecipients, buildMailingEmail, processMailings, recipientRows } from "@/lib/mail/mailings";
import { storeMailingImage } from "@/lib/mail/mailing-images";

/**
 * Även som nyhetsbrev (2026-11-12: "så det kommer med i samma postning"): a post (Inlägg) that the installation's
 * superadmin ticked is also sent as a newsletter when it is published – by Publicera, or by the schedule at the post's time.
 *
 * - Only where Utskick exists for the person: the same check as Utskick itself (app/api/superadmin/mailings, the user's role
 *   SUPERADMIN), on every tick, every press and at the schedule's run (as the person who scheduled).
 * - Exactly once per post: Mailing.socialPostId is unique, so a retry, a new time, Publicera nu or a partial channel failure
 *   never makes a second mailing. Cancelling the schedule before its time sends nothing, because the mailing is only made then.
 * - The admin's press is the approval, as for the post: the mail is made from the post's heading, text, picture and link and
 *   queued for the newsletter's recipients at that moment (users who said yes and confirmed subscribers, each address once),
 *   each mail with its own way to say no. A loopback QA instance never sends (processMailings skips them).
 */
export type { PostForMail } from "@/lib/mail/post-newsletter-mail";
/** `problem`: why it was not sent – no right (a refusal), no recipients (nothing to send) or the queue failed (try again). */
export type NewsletterOutcome = { ok: boolean; id?: string | null; message: string; already?: boolean; problem?: "right" | "empty" | "queue" };

/** Whether this person has Utskick: the installation's superadmin, active. */
export async function mayMailNewsletter(userId: string) {
  const user = await prisma.user.findUnique({ where: { id: userId }, select: { role: true, isActive: true } });
  return Boolean(user?.isActive && user.role === "SUPERADMIN");
}
export async function requireNewsletterRight(userId: string) {
  if (!(await mayMailNewsletter(userId))) throw new ApiError(403, "Bara systemadministratören kan skicka inlägg som nyhetsbrev.");
}

const fallbackSubject = () => `Nytt från ${publicInstance().name}`;
/** The mail as it will be sent from this post (its own fields, or what the post gives). */
export const postMail = (post: PostForMail) => resolvePostMail(post, fallbackSubject());

/** Visa mejlet: the mail exactly as it is sent, in the newsletter's template (the picture inline, since the preview is not sent). */
export async function previewPostNewsletter(post: PostForMail, image: Uint8Array | null) {
  const placeholder = "https://preview.invalid/post-image.jpg";
  const mail = postMail(post);
  const built = buildMailingEmail({ subject: mail.subject, body: JSON.stringify(postNewsletterDocument(mail, image ? placeholder : null)), unsubscribe: new URL("/api/newsletter/unsubscribe", env.APP_URL).toString(), newsletter: true });
  const html = image ? built.html.replaceAll(placeholder, `data:image/jpeg;base64,${Buffer.from(image).toString("base64")}`) : built.html;
  const recipients = (await audienceRecipients("NEWSLETTER")).length;
  return { subject: mail.subject, html, recipients, mail };
}

export const newsletterRecipientCount = async () => (await audienceRecipients("NEWSLETTER")).length;

const uniqueClash = (error: unknown) => Boolean(error && typeof error === "object" && "code" in error && (error as { code: unknown }).code === "P2002");

/**
 * Sends the post as a newsletter once: queues one mailing for the post (or says it already went). Never throws for an
 * ordinary refusal – it is reported as the newsletter's own outcome beside the channels'.
 */
/** Tests only: a failure thrown where the database would fail, to try the schedule's retry of the newsletter alone. */
let faultForTests: (() => void) | null = null;
export function setNewsletterFaultForTests(fault: (() => void) | null) { faultForTests = fault; }

export async function sendPostAsNewsletter(actor: { userId: string }, post: PostForMail, render: () => Promise<Uint8Array>, options: { kick?: boolean } = {}): Promise<NewsletterOutcome> {
  if (!(await mayMailNewsletter(actor.userId))) return { ok: false, problem: "right", message: "Bara systemadministratören kan skicka inlägg som nyhetsbrev." };
  faultForTests?.();
  const existing = await prisma.mailing.findUnique({ where: { socialPostId: post.id }, select: { id: true } });
  if (existing) return { ok: true, id: existing.id, already: true, message: "Nyhetsbrevet är redan skickat för inlägget." };
  const recipients = await audienceRecipients("NEWSLETTER");
  if (!recipients.length) return { ok: false, problem: "empty", message: "Nyhetsbrevet har inga mottagare ännu." };
  const mail = postMail(post);
  let imageSrc: string | null = null;
  if (mail.image) try { imageSrc = new URL(`/api/mailing-images/${await storeMailingImage(await render())}`, env.APP_URL).toString(); }
  catch { imageSrc = null; }
  try {
    const mailing = await prisma.mailing.create({
      data: { subject: mail.subject, body: JSON.stringify(postNewsletterDocument(mail, imageSrc)), audience: "NEWSLETTER", status: "QUEUED", createdById: actor.userId,
        approvedById: actor.userId, approvedAt: new Date(), socialPostId: post.id, recipients: { create: recipientRows(recipients) } },
      select: { id: true },
    });
    if (options.kick !== false) void processMailings().catch(() => undefined);
    return { ok: true, id: mailing.id, message: `Nyhetsbrevet skickas till ${recipients.length} mottagare.` };
  } catch (error) {
    if (uniqueClash(error)) return { ok: true, already: true, message: "Nyhetsbrevet är redan skickat för inlägget." };
    return { ok: false, problem: "queue", message: "Nyhetsbrevet kunde inte köas. Försök igen." };
  }
}
