import { z } from "zod";
import type { MailingBlock, MailingDocument } from "@/lib/mail/mailing-document";
import { formatSwedishDate, swedishDate, swedishDayKey, swedishMonday, swedishParts } from "@/lib/swedish-time";
import type { ReleaseNote } from "@/lib/release-notes";
import type { TaskNotification } from "@/lib/workflow/task-notifications";

/**
 * Veckobrev (2026-10-06): a newsletter drafted from the version notes since the last one, and a weekly slot
 * (weekday and Swedish time) at which a draft is made when there is something new. Since 2026-10-07 the slot only ever
 * makes a DRAFT: the newsletter is never sent by itself, the superadmin gets a notice in the bell, reads the draft and
 * approves it ("Godkänn och skicka"). Pure; the server parts are in lib/mail/release-newsletter-server.ts and
 * lib/mail/mailing-drafts.ts.
 */
export const WEEKDAYS = ["måndag", "tisdag", "onsdag", "torsdag", "fredag", "lördag", "söndag"] as const;

export const weeklySettingsSchema = z.object({
  /** Whether the weekly slot makes a draft (never whether anything is sent: nothing is sent without approval). */
  enabled: z.boolean().default(false),
  /** 0 = Monday … 6 = Sunday. */
  weekday: z.number().int().min(0).max(6).default(0),
  time: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, "Ange en tid som 08:00.").default("08:00"),
  /** The slot last handled (ISO), so one week never gets two. */
  lastSlot: z.string().max(40).optional(),
  /** The newest version a sent newsletter told about, kept when its row is removed from the history, so the same notes are never drafted again. */
  coveredVersion: z.string().max(20).optional(),
});
export type WeeklySettings = z.infer<typeof weeklySettingsSchema>;

export function parseWeeklySettings(raw: unknown): WeeklySettings {
  const parsed = weeklySettingsSchema.safeParse(raw ?? {});
  return parsed.success ? parsed.data : weeklySettingsSchema.parse({});
}

/** The week's slot that `now` falls in: its Monday plus the weekday, at the time, Swedish time. */
export function weeklySlot(settings: Pick<WeeklySettings, "weekday" | "time">, now: Date) {
  const monday = swedishParts(swedishMonday(now));
  const [hour, minute] = settings.time.split(":").map(Number);
  return swedishDate(monday.year, monday.month, monday.day + settings.weekday, hour, minute);
}

/** The next time the weekly draft is made (this week's slot if it is still ahead, otherwise next week's). */
export function nextWeeklySlot(settings: WeeklySettings, now: Date) {
  const slot = weeklySlot(settings, now);
  if (slot.getTime() > now.getTime() && slot.toISOString() !== settings.lastSlot) return slot;
  const later = new Date(now.getTime() + 7 * 86_400_000);
  return weeklySlot(settings, later);
}

/**
 * The slot due now, or null: switched on, the slot has passed by less than a day (a server that was down a whole day
 * skips that week rather than drafting late) and it has not been handled.
 */
export function dueWeeklySlot(settings: WeeklySettings, now: Date) {
  if (!settings.enabled) return null;
  const slot = weeklySlot(settings, now);
  const passed = now.getTime() - slot.getTime();
  if (passed < 0 || passed >= 86_400_000) return null;
  return slot.toISOString() === settings.lastSlot ? null : slot;
}

const noteDate = (note: ReleaseNote) => formatSwedishDate(`${note.date}T12:00:00Z`, { dateStyle: "long" });

/** The newsletter for some notes (newest first): a heading, a greeting, each version with its points, a button. */
export function releaseNewsletterDraft(all: ReleaseNote[], options: { appUrl: string; name: string }) {
  // At most 25 versions, so the mail stays within the editor's 60 blocks.
  const notes = all.slice(0, 25);
  const newest = notes[0];
  if (!newest) return null;
  const versions = notes.length === 1 ? `version ${newest.version}` : `version ${notes.at(-1)!.version}–${newest.version}`;
  const blocks: MailingBlock[] = [
    { id: "r-head", type: "heading", text: `Nytt i ${options.name} ${newest.version}`, size: "large" },
    { id: "r-intro", type: "text", text: `Hej!\n\nHär är det som är nytt i ${options.name} ${versions}.` },
  ];
  for (const note of notes) {
    blocks.push(
      { id: `r-v${note.version}`, type: "heading", text: `Version ${note.version} · ${noteDate(note)}`, size: "medium" },
      { id: `r-t${note.version}`, type: "text", text: `${note.summary}\n\n${note.items.map((item) => `- ${item}`).join("\n")}` },
    );
  }
  blocks.push({ id: "r-button", type: "button", label: `Öppna ${options.name}`, url: options.appUrl });
  const document: MailingDocument = { version: 1, blocks };
  return { subject: `Nytt i ${options.name} ${newest.version}`, document, version: newest.version, versions: notes.map((note) => note.version) };
}

export const describeWeekly = (settings: Pick<WeeklySettings, "weekday" | "time">) => `varje ${WEEKDAYS[settings.weekday]} kl. ${settings.time}`;

/**
 * What the weekly slot does (2026-10-07): at most a DRAFT, never a send. There is no "send" outcome here on
 * purpose, so no rule added later can make the weekly job send by itself; only the superadmin's approval queues a
 * newsletter (lib/mail/mailing-drafts.ts). The same version notes never get a second draft: `hasNew` is false once an
 * earlier mailing (sent, queued, scheduled, a draft or a skipped draft) carries them, and one draft waits at a time.
 */
export type WeeklyDraftDecision =
  | { action: "draft" }
  | { action: "skip"; reason: "not-due" | "nothing-new" | "draft-waiting" | "no-recipients" | "no-superadmin" };

export function weeklyDraftDecision(input: { due: boolean; hasNew: boolean; draftWaiting: boolean; recipients: number; hasSuperadmin: boolean }): WeeklyDraftDecision {
  if (!input.due) return { action: "skip", reason: "not-due" };
  if (!input.hasNew) return { action: "skip", reason: "nothing-new" };
  if (input.draftWaiting) return { action: "skip", reason: "draft-waiting" };
  if (input.recipients < 1) return { action: "skip", reason: "no-recipients" };
  if (!input.hasSuperadmin) return { action: "skip", reason: "no-superadmin" };
  return { action: "draft" };
}

/** The bell's notice for the superadmin while a veckobrev draft waits (also what the notice job mails to one who asked for it). */
export function draftNotice(draft: { id: string; subject: string; createdAt: Date }): TaskNotification {
  return {
    id: `NEWSLETTER_DRAFT:${draft.id}`, title: "Veckobrev väntar på godkännande", kind: "NEWSLETTER_DRAFT",
    detail: `${draft.subject}. Läs utkastet och godkänn det under Utskick – inget skickas förrän du gör det.`,
    href: "/?view=mailings", dueDate: swedishDayKey(draft.createdAt), deadline: null, needsAction: true,
  };
}

/** The line under the weekly settings: when the next draft is made and what it would carry. */
export function describeNextDraft(next: string, versions: string[] | null) {
  return versions?.length
    ? `Nästa utkast: ${next} – med ${versions.map((version) => `version ${version}`).join(", ")}. Du får en notis i klockan och godkänner själv; inget skickas av sig självt.`
    : `Nästa tillfälle: ${next} – inget nytt ännu, då görs inget utkast. Inget skickas av sig självt.`;
}
