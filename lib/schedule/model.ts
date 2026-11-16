import { createHash } from "node:crypto";
import { mailContent, resolvePostMail } from "@/lib/mail/post-newsletter-mail";
import { fromSwedishDateTimeInput, NONEXISTENT_TIME_ERROR } from "@/lib/swedish-time";

/**
 * Schemalägg (2026-11-11), pure – shared by the server, the job and the tests.
 *
 * - Pressing Schemalägg is the admin's own approval: nothing is scheduled by Workflow itself, and the job publishes only what
 *   an admin approved, as that admin, with exactly the content that was approved (the content's hash is stored and compared).
 * - A time is a Swedish wall-clock time (Europe/Stockholm). The hour that does not exist the night summer time starts is
 *   refused; the hour that comes twice in October is read as winter time, the second of the two (the datetime-local value has no offset).
 * - An attempt that may succeed later (the network, Meta's or WordPress's server, a rate limit) is tried again after 5, 15 and
 *   45 minutes; everything else fails at once with its reason. An item is claimed before it runs, so two runs never publish
 *   it twice, and one that stopped half-way is never tried again by itself.
 */
export * from "./labels";
import type { ScheduleKind, ScheduleStatus } from "./labels";

/** The earliest time one may choose: a moment ahead, so the choice is a schedule and not a slow Publicera. */
export const MIN_AHEAD_MS = 60_000;
export const MAX_AHEAD_MS = 400 * 86_400_000;
export const MAX_ATTEMPTS = 4;
/** How long a claimed item may run before a later run counts it as stopped half-way. */
export const LOCK_MS = 10 * 60_000;
const BACKOFF_MINUTES = [5, 15, 45];

/** Parses the person's datetime-local value as Swedish time and checks the window; a reason in Swedish when it cannot be used. */
export function parseScheduleTime(value: string, now = new Date()): { at: Date } | { error: string } {
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(value)) return { error: "Välj dag och klockslag." };
  const at = fromSwedishDateTimeInput(value);
  if (!at) return { error: NONEXISTENT_TIME_ERROR };
  if (at.getTime() < now.getTime() + MIN_AHEAD_MS) return { error: "Välj en tid som inte har passerat." };
  if (at.getTime() > now.getTime() + MAX_AHEAD_MS) return { error: "Välj en tid inom ett år." };
  return { at };
}

/** When a failed attempt is tried again, or null when it is the last one. `attempts` counts the attempt just made. */
export function nextAttempt(attempts: number, now = new Date()): Date | null {
  if (attempts >= MAX_ATTEMPTS) return null;
  const minutes = BACKOFF_MINUTES[Math.min(attempts - 1, BACKOFF_MINUTES.length - 1)] ?? BACKOFF_MINUTES[0];
  return new Date(now.getTime() + minutes * 60_000);
}

/** An attempt's outcome: done, a failure that may succeed later, or one that will not (the reason is shown and mailed). */
export type RunOutcome =
  | { kind: "published"; message: string }
  | { kind: "retry"; message: string }
  | { kind: "fail"; message: string }
  /** Nothing to publish any more (already published by hand, removed): the item ends without a failure. */
  | { kind: "skip"; message: string };

/** The item's next state after an attempt. Pure, so the job and the tests agree. */
export function settle(outcome: RunOutcome, attempts: number, now = new Date()): { status: ScheduleStatus; nextAttemptAt: Date | null; error: string | null; result: string | null } {
  if (outcome.kind === "published") return { status: "published", nextAttemptAt: null, error: null, result: outcome.message };
  if (outcome.kind === "skip") return { status: "cancelled", nextAttemptAt: null, error: null, result: outcome.message };
  const retryAt = outcome.kind === "retry" ? nextAttempt(attempts, now) : null;
  if (retryAt) return { status: "scheduled", nextAttemptAt: retryAt, error: outcome.message, result: null };
  return { status: "failed", nextAttemptAt: null, error: outcome.message, result: null };
}

/** The text a stopped run leaves (the job was stopped while it published): never tried again by itself. */
export const STOPPED_HALF_WAY = "Publiceringen avbröts innan den var klar. Kontrollera sidan innan du publicerar igen.";

// ---------- the approved content ----------

/**
 * The post's fields that make its content. A channel that adds its own field (a LinkedIn tick) adds it here, so a change of it
 * also asks for a new approval.
 */
export const POST_CONTENT_FIELDS = ["heading", "body", "caption", "link", "template", "toFacebook", "toInstagram", "backgroundSource"] as const;
export type PostContent = Record<(typeof POST_CONTENT_FIELDS)[number], unknown> & { background?: Uint8Array | null };

const sha = (text: string | Uint8Array) => createHash("sha256").update(text).digest("hex");

/** The hash of a post's content: its fields in a fixed order and the background picture's own bytes. */
export function postContentHash(post: PostContent & Record<string, unknown>): string {
  const fields: Record<string, unknown> = Object.fromEntries(POST_CONTENT_FIELDS.map((key) => [key, post[key] ?? null]));
  // Även som nyhetsbrev (2026-11-12): part of the approved content only when ticked, so the hash of every post scheduled before
  // the tick existed stays the same; ticking or unticking it afterwards asks for a new approval.
  // Hashtaggar (2026-11-12): likewise only when there are any, so earlier approvals stay valid; a change asks for a new one.
  if (typeof post.hashtags === "string" && post.hashtags) fields.hashtags = post.hashtags;
  // Även som story (2026-11-13): likewise only when ticked.
  if (post.toStory === true) fields.toStory = true;
  // Logga (2026-11-13): the logo's variant and size likewise only when not the default (Automatiskt, Mellan).
  if (typeof post.logoVariant === "string" && post.logoVariant && post.logoVariant !== "auto") fields.logoVariant = post.logoVariant;
  if (typeof post.logoSize === "string" && post.logoSize && post.logoSize !== "medium") fields.logoSize = post.logoSize;
  // Bakgrund bakom logotypen (2026-11-15): likewise only when Ingen.
  if (post.logoPlate === "none") fields.logoPlate = "none";
  if (post.toNewsletter === true) {
    fields.toNewsletter = true;
    // The mail exactly as it will be sent: its own fields, or what follows the post (lib/mail/post-newsletter-mail.ts).
    fields.newsletter = mailContent(resolvePostMail({ id: "", heading: String(post.heading ?? ""), body: String(post.body ?? ""), caption: String(post.caption ?? ""), link: (post.link as string | null) ?? null, newsletterMail: post.newsletterMail }, "-"));
  }
  return sha(JSON.stringify({ fields, background: post.background ? sha(post.background) : null }));
}

/** The channels a post goes to, by the post's own ticks. */
export const postChannels = (post: { toFacebook: boolean; toInstagram: boolean } & Record<string, unknown>) =>
  [post.toFacebook ? "facebook" : null, post.toInstagram ? "instagram" : null,
    post.toStory === true && post.toFacebook ? "facebook_story" : null, post.toStory === true && post.toInstagram ? "instagram_story" : null].filter((value): value is string => Boolean(value));

/** A scheduled item as the job sees it. */
export type ScheduleItem = {
  id: string; organizationId: string; kind: ScheduleKind | string; targetId: string; title: string; status: ScheduleStatus | string;
  runAt: Date; nextAttemptAt: Date; attempts: number; contentHash: string; payload: unknown; channels: string[];
  scheduledById: string; lastError: string | null; failureMailedAt: Date | null;
};

export type WebsitePayload ={ pageId: number; content: string; baseModified: string; seo?: unknown; seoBase?: unknown };
export const websiteContentHash = (payload: WebsitePayload) => sha(JSON.stringify({ content: payload.content, seo: payload.seo ?? null }));
