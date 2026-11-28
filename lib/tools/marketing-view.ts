import type { ReleaseNote } from "@/lib/release-notes";
import type { PeriodTotals, Report } from "@/lib/analytics/report";

/**
 * What the posts, release-notes and statistics tools answer with (2026-11-25, lib/tools/catalog-marketing.ts), pure so the tests
 * can read it: the fields an external system needs, never the picture bytes, the newsletter's mail, the publishing token or who
 * in the company did what.
 */

/** The posts' source that an external system's drafts get (SocialPost.source). */
export const API_POST_SOURCE = "api";

type PostLike = {
  id: string; source: string; sourceRef: string | null; status: string; heading: string; body: string; caption: string; hashtags: string; link: string | null;
  instagramText?: string | null; toFacebook: boolean; toInstagram: boolean; toLinkedIn: boolean; toStory: boolean; facebookPostId: string | null; instagramMediaId: string | null;
  linkedInPostId: string | null; publishedAt: string | null; lastError: string | null; campaignLinks?: boolean; aiGenerated?: boolean; createdAt: string; updatedAt: string;
  images?: unknown[];
  /** Innehållsuppdrag (2026-11-25): the instruction behind the draft, when it came from create_content_brief. */
  assignment?: { textSource: string; reason: string | null; createdAt: string; instruction: { topic: string } & Record<string, unknown> } | null;
};
type ScheduleLike = { targetId: string; status: string; runAt: string; publishedAt: string | null; lastError: string | null; channels: string[] };

const channelsOf = (post: PostLike) => [post.toFacebook && "facebook", post.toInstagram && "instagram", post.toLinkedIn && "linkedin"].filter((value): value is string => Boolean(value));

/** One post as the tools give it. */
export function postToolView(post: PostLike, schedule: ScheduleLike | null = null) {
  return {
    id: post.id, source: post.source, externalRef: post.source === API_POST_SOURCE ? post.sourceRef : null, status: post.status,
    heading: post.heading, body: post.body, caption: post.caption, instagramText: post.instagramText ?? "", hashtags: post.hashtags, link: post.link,
    channels: channelsOf(post), story: post.toStory,
    // Which channels got the post (an id from the platform), never the ids themselves: they are the company's own.
    publishedTo: [post.facebookPostId && "facebook", post.instagramMediaId && "instagram", post.linkedInPostId && "linkedin"].filter((value): value is string => Boolean(value)),
    publishedAt: post.publishedAt, lastError: post.lastError, campaignLinks: Boolean(post.campaignLinks), aiGenerated: Boolean(post.aiGenerated),
    images: 1 + (post.images?.length ?? 0), createdAt: post.createdAt, updatedAt: post.updatedAt,
    schedule: schedule ? { status: schedule.status, runAt: schedule.runAt, publishedAt: schedule.publishedAt, lastError: schedule.lastError, channels: schedule.channels } : null,
    assignment: post.assignment ? { textSource: post.assignment.textSource, reason: post.assignment.reason, createdAt: post.assignment.createdAt, instruction: post.assignment.instruction } : null,
    url: `/?view=web_posts&post=${encodeURIComponent(post.id)}`,
  };
}

/** The posts filtered as list_social_posts asks, newest first. */
export function filterPosts<T extends PostLike>(posts: T[], filter: { status?: string; since?: string; externalRef?: string; limit?: number }) {
  return posts
    .filter((post) => !filter.status || post.status === filter.status)
    .filter((post) => !filter.externalRef || (post.source === API_POST_SOURCE && post.sourceRef === filter.externalRef))
    .filter((post) => !filter.since || post.createdAt.slice(0, 10) >= filter.since || (post.publishedAt ?? "").slice(0, 10) >= filter.since)
    .slice(0, filter.limit ?? 50);
}

const parts = (value: string) => value.split(".").map(Number);
const after = (left: string, right: string) => { const a = parts(left); const b = parts(right); for (let index = 0; index < 3; index += 1) if (a[index] !== b[index]) return a[index] > b[index]; return false; };

/** The release notes after `since` (all without it), newest first, at most `limit`. */
export function releaseNotesView(notes: readonly ReleaseNote[], current: string, input: { since?: string; limit?: number }) {
  const shown = notes.filter((note) => !input.since || after(note.version, input.since)).slice(0, input.limit ?? 10);
  return { current, notes: shown.map((note) => ({ version: note.version, date: note.date, summary: note.summary, items: note.items, highlights: note.highlights ?? note.items.slice(0, 3) })), url: "/nytt" };
}

/** The visitor statistics as get_site_analytics gives it: the counts and shares, no settings and no per-browser state. */
export function siteAnalyticsView(report: Report & { previous: PeriodTotals & { from: string; to: string } }, totals: PeriodTotals) {
  return {
    from: report.from, to: report.to, hasData: report.hasData, totals, previous: report.previous,
    website: { views: report.landing.views, pages: report.landing.pages, clicks: report.landing.clicks, sources: report.landing.sources, devices: report.landing.devices, newsletter: report.landing.newsletter,
      // Från AI-tjänster (2026-11-28): visits from AI assistants per service and per week, for Growth Engine.
      aiServices: report.landing.aiServices },
    demo: { starts: report.demo.starts.total, startButtons: report.demo.starts.rows, sources: report.demo.sources, daily: report.demo.daily, time: report.demo.time, devices: report.demo.devices, views: report.demo.views },
    funnel: report.funnel, consent: report.consent, weekly: report.publicWeekly,
    note: "Räknarna är anonyma besök (sidladdningar), aldrig personer. Tratten räknar bara besökare som tillåtit statistik.",
    url: "/?view=superadmin&section=analytics",
  };
}
