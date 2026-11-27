/**
 * Schemalägg (2026-11-11): the states, their names and the channels' names – shared by the page, the server and the tests
 * (no server code here, so the page can import it).
 */
export const SCHEDULE_STATUSES = ["scheduled", "needs_approval", "running", "published", "failed", "cancelled"] as const;
export type ScheduleStatus = (typeof SCHEDULE_STATUSES)[number];
export const ACTIVE_STATUSES: readonly ScheduleStatus[] = ["scheduled", "needs_approval", "running"];

export const SCHEDULE_STATUS_LABEL: Record<ScheduleStatus, { label: string; tone: "neutral" | "info" | "success" | "warning" | "danger" }> = {
  scheduled: { label: "Schemalagt", tone: "info" },
  needs_approval: { label: "Behöver godkännas", tone: "warning" },
  running: { label: "Publiceras", tone: "info" },
  published: { label: "Publicerat", tone: "success" },
  failed: { label: "Misslyckades", tone: "danger" },
  cancelled: { label: "Avbrutet", tone: "neutral" },
};

/** What a scheduled item publishes. A channel of its own (LinkedIn) is a post channel, not a kind (lib/schedule/channels.ts). */
// Filmer (2026-11-20): a film to the company's YouTube channel is a kind of its own (its upload runs on in lib/youtube/).
export const SCHEDULE_KINDS = ["post", "website", "video"] as const;
export type ScheduleKind = (typeof SCHEDULE_KINDS)[number];

/** The job runs every five minutes, so a chosen time is published within five minutes after it. */
export const JOB_EVERY_MINUTES = 5;

export const CHANNEL_LABEL: Record<string, string> = { facebook: "Facebook", instagram: "Instagram", facebook_story: "Story på Facebook", instagram_story: "Story på Instagram", website: "Webbplatsen", linkedin: "LinkedIn", newsletter: "Nyhetsbrev", youtube: "YouTube" };
/** What an item is, in the list's and the mail's words: Inlägget, Filmen, Sidan. */
export const scheduleSubject = (kind: string) => (kind === "post" ? "Inlägget" : kind === "video" ? "Filmen" : "Sidan");
export const channelText = (channels: readonly string[]) => channels.map((channel) => CHANNEL_LABEL[channel] ?? channel).join(", ");

/** One scheduled item as the page shows it. */
export type ScheduledView = {
  id: string; kind: ScheduleKind; targetId: string; title: string; status: ScheduleStatus; runAt: string; nextAttemptAt: string;
  attempts: number; channels: string[]; seriesId: string | null; scheduledByName: string | null; scheduledAt: string;
  lastError: string | null; result: string | null; publishedAt: string | null;
  /** A failed post whose channels went out but whose newsletter did not: Skicka nyhetsbrevet runs that part alone. */
  newsletterRetry?: boolean;
  /** Innehållsuppdrag (2026-11-25): approved automatically by the company's rule – which key and when; null when a person approved. */
  autoApproved?: { key: string; at: string } | null;
};
