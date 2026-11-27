import { prisma } from "@/lib/db";
import { env } from "@/lib/env";
import { publicInstance } from "@/lib/instance";
import { audienceRecipients } from "@/lib/mail/mailings";
import { dueWeeklySlot, parseWeeklySettings, releaseNewsletterDraft, weeklyDraftDecision, weeklySettingsSchema, type WeeklySettings } from "@/lib/mail/release-newsletter";
import { highestVersion, releaseNotesSince, type ReleaseNote } from "@/lib/release-notes";

/**
 * Veckobrev (2026-10-06, changed 2026-10-07): the server side – settings, what is new since the last newsletter and
 * the weekly run. The weekly run only ever writes a DRAFT (status DRAFT, no recipients); nothing here queues or sends a
 * mailing. The superadmin approves a draft in lib/mail/mailing-drafts.ts, and only that queues it.
 */
export async function readWeeklySettings(): Promise<WeeklySettings> {
  const row = await prisma.systemSettings.findUnique({ where: { id: "global" }, select: { newsletter: true } });
  return parseWeeklySettings(row?.newsletter);
}

async function writeWeeklySettings(next: WeeklySettings) {
  await prisma.systemSettings.upsert({ where: { id: "global" }, update: { newsletter: next }, create: { id: "global", newsletter: next } });
}

/** Saves on/off, weekday and time. A slot that has already passed this week is counted as handled, so switching it on
 * never makes a draft at once. */
export async function saveWeeklySettings(raw: unknown, now = new Date()) {
  const input = weeklySettingsSchema.pick({ enabled: true, weekday: true, time: true }).parse(raw);
  const current = await readWeeklySettings();
  const next: WeeklySettings = { ...current, ...input };
  const due = dueWeeklySlot({ ...next, lastSlot: undefined }, now);
  if (due) next.lastSlot = due.toISOString();
  await writeWeeklySettings(next);
  return next;
}

/**
 * The newest version an earlier newsletter carried: sent, queued, scheduled, a draft that waits or a draft that was
 * skipped – and a sent one that was later removed from the history (kept in the settings). That is what keeps the same
 * notes from being drafted twice.
 */
export async function releaseBaseline() {
  const [rows, settings] = await Promise.all([
    prisma.mailing.findMany({ where: { releaseVersion: { not: null } }, distinct: ["releaseVersion"], select: { releaseVersion: true } }),
    readWeeklySettings(),
  ]);
  return highestVersion([settings.coveredVersion, ...rows.map((row) => row.releaseVersion)]);
}

/** A sent newsletter's version stays counted as told when its row is removed from the history. */
export async function rememberCoveredVersion(version: string) {
  const current = await readWeeklySettings();
  const covered = highestVersion([current.coveredVersion, version]);
  if (covered !== (current.coveredVersion ?? null)) await writeWeeklySettings({ ...current, coveredVersion: covered ?? undefined });
}

/** The notes and running version a draft is made from; the defaults are the app's own, the options are for tests. */
export type ReleaseSource = { notes?: ReleaseNote[]; current?: string };

/** The newsletter drafted from the notes since the last one, or null when there is nothing new. */
export async function pendingReleaseNewsletter(source: ReleaseSource = {}) {
  const baseline = await releaseBaseline();
  // Community (2026-11-10): no weekly letter of Workflow's release notes.
  if (!publicInstance().features.releaseNewsletter && !source.notes) return { baseline, draft: null };
  const draft = releaseNewsletterDraft(releaseNotesSince(baseline, source.current, source.notes), { appUrl: env.APP_URL, name: publicInstance().name });
  return { baseline, draft };
}

/**
 * Writes the draft for what is new since the last newsletter – the weekly run's whole job, also behind "Skapa utkast nu".
 * It never queues and never sends: the draft has no recipients and waits for the superadmin's approval. At most one
 * draft waits at a time, and notes an earlier mailing carries are not drafted again.
 */
export async function createReleaseDraft(input: { actorId?: string } & ReleaseSource = {}) {
  const { draft } = await pendingReleaseNewsletter(input);
  const [waiting, recipients, owner] = await Promise.all([
    prisma.mailing.count({ where: { status: "DRAFT", audience: "NEWSLETTER" } }),
    audienceRecipients("NEWSLETTER"),
    input.actorId ? { id: input.actorId } : prisma.user.findFirst({ where: { role: "SUPERADMIN", isActive: true }, orderBy: { createdAt: "asc" }, select: { id: true } }),
  ]);
  const decision = weeklyDraftDecision({ due: true, hasNew: Boolean(draft), draftWaiting: waiting > 0, recipients: recipients.length, hasSuperadmin: Boolean(owner) });
  if (decision.action === "skip") return { drafted: false as const, reason: decision.reason };
  // The decision says "draft" only when both exist; stated again so the types follow.
  if (!draft || !owner) return { drafted: false as const, reason: "nothing-new" as const };
  const mailing = await prisma.mailing.create({
    data: { subject: draft.subject, body: JSON.stringify(draft.document), audience: "NEWSLETTER", status: "DRAFT", createdById: owner.id, releaseVersion: draft.version },
    select: { id: true },
  });
  return { drafted: true as const, id: mailing.id, version: draft.version };
}

/** Whether the weekly slot is due now (the dry run of mailings:send, T5 2026-10-24): only read, the slot is not marked. */
export async function weeklyDraftDue(now = new Date()) {
  if (!publicInstance().features.releaseNewsletter) return false;
  return Boolean(dueWeeklySlot(await readWeeklySettings(), now));
}

/**
 * The weekly run (from the mailings job every five minutes): at the chosen slot, a draft with what is new since the last
 * newsletter – only when there is something new. Nothing is sent by itself (2026-10-07): the draft waits for
 * approval and the superadmin sees a notice in the bell.
 */
export async function runWeeklyDraft(now = new Date(), source: ReleaseSource = {}) {
  if (!publicInstance().features.releaseNewsletter && !source.notes) return { drafted: false as const, reason: "not-due" as const };
  const settings = await readWeeklySettings();
  const slot = dueWeeklySlot(settings, now);
  if (!slot) return { drafted: false as const, reason: "not-due" as const };
  // The slot is handled whatever happens next, so one week never gets two drafts.
  await writeWeeklySettings({ ...settings, lastSlot: slot.toISOString() });
  return createReleaseDraft(source);
}
