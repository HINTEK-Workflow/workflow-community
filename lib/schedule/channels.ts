import { ApiError } from "@/lib/kfid/errors";
import type { RunOutcome } from "./model";

/**
 * Schemalägg (2026-11-11): the channels a scheduled post goes to. A post (Inlägg) is published by every publisher that wants it;
 * Facebook and Instagram are one publisher (lib/meta/server.ts publishPost does both). Another channel – LinkedIn – is one more
 * entry in POST_PUBLISHERS, and its own tick goes into POST_CONTENT_FIELDS (lib/schedule/model.ts), so a change of it asks for
 * a new approval.
 *
 * A publisher must be idempotent: called again for a post where it already published (a retry after another channel failed), it
 * publishes nothing twice. It must also check the company's own publishing switch and its token itself, every time.
 */
export type PostPublisher = {
  key: string;
  /** The channel names this publisher covers (for the list: "Facebook, Instagram"). */
  channels(post: Record<string, unknown>): string[];
  publish(actor: { userId: string; organizationId: string }, postId: string): Promise<RunOutcome>;
  /**
   * Runs also when the post itself is already published (2026-11-12): the newsletter, whose own failure after the channels went
   * out is tried again – alone – until it is sent or the attempts run out.
   */
  afterPublished?: boolean;
};

/** A failure from the app's own checks as an outcome: a refusal (off, missing, invalid) fails; a rate or a server error waits. */
export function outcomeOfError(error: unknown, fallback = "Något gick fel."): RunOutcome {
  if (error instanceof ApiError) {
    const status = (error as ApiError & { status?: number }).status ?? 500;
    if (status === 429 || status >= 500) return { kind: "retry", message: error.message };
    return { kind: "fail", message: error.message };
  }
  return { kind: "retry", message: error instanceof Error && error.message ? error.message.slice(0, 300) : fallback };
}

const meta: PostPublisher = {
  key: "meta",
  // Även som story (2026-11-13): the stories are channels of their own, so the list and the errors say where it went wrong.
  channels: (post) => [post.toFacebook ? "facebook" : null, post.toInstagram ? "instagram" : null,
    post.toStory === true && post.toFacebook ? "facebook_story" : null, post.toStory === true && post.toInstagram ? "instagram_story" : null].filter((value): value is string => Boolean(value)),
  async publish(actor, postId) {
    const { checkMeta, publishPost, metaView } = await import("@/lib/meta/server");
    // The token is asked about at run time (at most every six hours, as on opening the card); an invalid one refuses below.
    await checkMeta(actor.organizationId, { ifStale: true }).catch(() => undefined);
    try {
      // The newsletter has its own publisher below, so a channel's retry never touches it.
      const result = await publishPost(actor, postId, "live", { newsletter: false });
      const failures = [result.facebook?.ok === false ? `Facebook: ${result.facebook.message}` : null, result.instagram?.ok === false ? `Instagram: ${result.instagram.message}` : null,
        result.facebookStory?.ok === false ? `Story på Facebook: ${result.facebookStory.message}` : null, result.instagramStory?.ok === false ? `Story på Instagram: ${result.instagramStory.message}` : null].filter(Boolean).join(" ");
      if (!failures) return { kind: "published", message: result.message };
      // A token that stopped working fails at once (it needs a new one); anything else is tried again.
      const connection = await metaView(actor.organizationId).catch(() => null);
      return { kind: connection?.status === "invalid" ? "fail" : "retry", message: failures.slice(0, 400) };
    } catch (error) { return outcomeOfError(error); }
  },
};

/**
 * Även som nyhetsbrev (2026-11-12): the post as one newsletter mailing at the scheduled time, as the person who scheduled it and
 * only while that person has Utskick. Idempotent by the mailing's unique post (lib/mail/post-newsletter.ts): a retry after a
 * channel failed, Publicera nu or a new time never sends it twice. Sent whatever the channels did, and reported on its own.
 */
const newsletter: PostPublisher = {
  key: "newsletter",
  afterPublished: true,
  channels: (post) => (post.toNewsletter === true ? ["newsletter"] : []),
  async publish(actor, postId) {
    const [{ sendPostAsNewsletter }, { renderImage }, { prisma }] = await Promise.all([import("@/lib/mail/post-newsletter"), import("@/lib/meta/server"), import("@/lib/db")]);
    const post = await prisma.socialPost.findFirst({ where: { id: postId, organizationId: actor.organizationId, toNewsletter: true }, select: { id: true, heading: true, body: true, caption: true, link: true, template: true, logoVariant: true, logoSize: true, newsletterMail: true } });
    if (!post) return { kind: "skip", message: "" };
    try {
      const outcome = await sendPostAsNewsletter(actor, post, () => renderImage(actor.organizationId, post, post.id));
      if (outcome.ok) return { kind: outcome.already ? "skip" : "published", message: outcome.already ? "" : outcome.message };
      // Nobody to send to is nothing to do; a lost right refuses; a queue that failed is tried again.
      return { kind: outcome.problem === "empty" ? "skip" : outcome.problem === "queue" ? "retry" : "fail", message: `Nyhetsbrev: misslyckades – ${outcome.message}` };
    } catch (error) { const outcome = outcomeOfError(error); return { ...outcome, message: `Nyhetsbrev: misslyckades – ${outcome.message}` }; }
  },
};

export const POST_PUBLISHERS: PostPublisher[] = [meta, newsletter];

/** Adds a channel's publisher (once per key). */
export function registerPostPublisher(publisher: PostPublisher) {
  if (!POST_PUBLISHERS.some((entry) => entry.key === publisher.key)) POST_PUBLISHERS.push(publisher);
}

/** The outcome of several publishers: all published → published; any refusal → fail; otherwise a retry. */
export function combineOutcomes(outcomes: RunOutcome[]): RunOutcome {
  if (!outcomes.length) return { kind: "fail", message: "Inlägget har ingen kanal vald." };
  const message = outcomes.map((outcome) => outcome.message).filter(Boolean).join(" ");
  if (outcomes.every((outcome) => outcome.kind === "published" || outcome.kind === "skip")) return { kind: "published", message };
  if (outcomes.some((outcome) => outcome.kind === "fail")) return { kind: "fail", message };
  return { kind: "retry", message };
}
