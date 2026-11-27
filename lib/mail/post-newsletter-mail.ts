import { z } from "zod";
import type { MailingDocument } from "@/lib/mail/mailing-document";

/**
 * Även som nyhetsbrev (2026-11-12): the newsletter's own fields beside a post – pure, so the page (Inlägg) and the server
 * read the same rules. A field that is missing or null follows the post: the subject the post's heading, the text the post's
 * text without hashtags, the link the post's link, the picture the post's picture. A field written in Inlägg is the mail's own
 * ("Egen text") until "Hämta från inlägget igen" clears it. Hashtags never go into the mail. The mail is made in the newsletter's
 * own template (Utskick, lib/mail/mailing-document.ts), not as a copy of the post.
 */
export const NEWSLETTER_SUBJECT_MAX = 150;
export const NEWSLETTER_TEXT_MAX = 8000;
const own = (max: number) => z.string().max(max).nullable().optional();
export const newsletterMailSchema = z.object({
  subject: own(NEWSLETTER_SUBJECT_MAX),
  text: own(NEWSLETTER_TEXT_MAX),
  link: own(500),
  /** false leaves the post's picture out of the mail. */
  image: z.boolean().nullable().optional(),
}).strict();
export type NewsletterMail = z.infer<typeof newsletterMailSchema>;

export type PostForMail = { id: string; heading: string; body: string; caption: string; link: string | null; hashtags?: string | null; newsletterMail?: unknown };

/** The stored own fields, or {} when there are none or they cannot be read. */
export function ownFields(value: unknown): NewsletterMail {
  const parsed = newsletterMailSchema.safeParse(value ?? {});
  return parsed.success ? parsed.data : {};
}

/** The text without hashtags (#ord) and without lines that held only hashtags. */
export function withoutHashtags(text: string) {
  return text
    .split("\n")
    .map((line) => line.replace(/(^|\s)#[\p{L}\p{N}_]+/gu, "$1").replace(/[ \t]{2,}/g, " ").trimEnd())
    .filter((line, index, lines) => line.trim() || (index > 0 && lines[index - 1]!.trim()))
    .join("\n")
    .trim();
}

export type ResolvedMail = { subject: string; text: string; link: string | null; image: boolean; follows: { subject: boolean; text: boolean; link: boolean; image: boolean } };

/** The mail as it will be sent: each own field, or what the post gives. */
export function resolvePostMail(post: PostForMail, fallbackSubject: string): ResolvedMail {
  const fields = ownFields(post.newsletterMail);
  const fromPost = {
    subject: post.heading.trim() || withoutHashtags(post.caption).split("\n")[0]?.trim() || "",
    text: withoutHashtags(post.caption) || post.body.trim(),
    link: post.link?.trim() || null,
  };
  const has = (value: unknown) => value !== undefined && value !== null;
  const subject = (has(fields.subject) ? fields.subject!.trim() : fromPost.subject).slice(0, NEWSLETTER_SUBJECT_MAX);
  return {
    subject: subject.length >= 3 ? subject : fallbackSubject,
    text: (has(fields.text) ? fields.text!.trim() : fromPost.text).slice(0, NEWSLETTER_TEXT_MAX),
    link: has(fields.link) ? fields.link!.trim() || null : fromPost.link,
    image: fields.image !== false,
    follows: { subject: !has(fields.subject), text: !has(fields.text), link: !has(fields.link), image: !has(fields.image) },
  };
}

/** The approved content of the mail (for the schedule's hash): exactly what is sent, never how it was arrived at. */
export const mailContent = (mail: ResolvedMail) => ({ subject: mail.subject, text: mail.text, link: mail.link, image: mail.image });

/** The mail's blocks in the newsletter's template: the subject as heading, the picture, the text and a button to the link. */
export function postNewsletterDocument(mail: ResolvedMail, imageSrc: string | null): MailingDocument {
  const blocks: MailingDocument["blocks"] = [{ id: "p1", type: "heading", text: mail.subject.slice(0, 200), size: "large" }];
  if (imageSrc && mail.image) blocks.push({ id: "p2", type: "image", src: imageSrc, alt: mail.subject.slice(0, 200), link: mail.link ?? "" });
  if (mail.text) blocks.push({ id: "p3", type: "text", text: mail.text });
  if (mail.link) blocks.push({ id: "p4", type: "button", label: "Läs mer", url: mail.link });
  return { version: 1, blocks };
}
