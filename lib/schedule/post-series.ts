import { postProblem } from "@/lib/meta/text";
import { isTaken, rhythmSlots, scheduleTimeProblem, type Rhythm } from "./rhythm";

/**
 * Ny serie (2026-11-13), pure – shared by the page, the server and the tests. A series is a number of ordinary posts that
 * share a template, a logo, hashtags and channels; each part has its own Rubrik, Kort text and Text and its own time. The times are
 * laid out by the company's publishing rhythm from the next free slot (Monday, Wednesday and Friday at 08:00: twelve parts are about a
 * month) and each may be changed before saving. Saving makes one draft per part and schedules each exactly as Schemalägg does – the
 * press is the admin's approval, a time that has passed is refused, and a time within an hour of another post is pointed out. No AI.
 */
export const SERIES_PARTS_MIN = 2;
export const SERIES_PARTS_MAX = 30;
export const SERIES_PARTS_DEFAULT = 12;

export type SeriesPart = { heading: string; body: string; caption: string; at: string };
export type SeriesShared = { template: string; logoVariant: string; logoSize: string; hashtags: string; toFacebook: boolean; toInstagram: boolean; toLinkedIn: boolean };

/** The count kept within 2–30 (a typed value that is not a whole number gives the default). */
export function seriesCount(value: unknown): number {
  const count = Math.round(Number(value));
  if (!Number.isFinite(count)) return SERIES_PARTS_DEFAULT;
  return Math.min(SERIES_PARTS_MAX, Math.max(SERIES_PARTS_MIN, count));
}

/** The rhythm's next free times for `count` parts, in order, from `fromDay` (or today), never in another post's slot. */
export const seriesTimes = (count: number, rhythm: Rhythm, options: { taken?: readonly Date[]; now?: Date; fromDay?: string | null } = {}) =>
  rhythmSlots(rhythm, { count, ...options });

/** Per part: whether its time is within an hour of another post or of another part of the series (a note, never a refusal). */
export function seriesClashes(times: readonly (Date | null)[], taken: readonly Date[]): boolean[] {
  return times.map((at, index) => Boolean(at) && (isTaken(at!, taken) || isTaken(at!, times.filter((other, position): other is Date => position !== index && Boolean(other)))));
}

/**
 * The first reason the series cannot be saved, with the part it concerns (null: the series as a whole), or null. The same rules
 * as one post: its texts (postProblem) and its time (scheduleTimeProblem – not passed, within a year, a time that exists).
 */
export function seriesProblem(shared: SeriesShared, parts: readonly SeriesPart[], now = new Date()): { part: number | null; message: string } | null {
  if (parts.length < SERIES_PARTS_MIN || parts.length > SERIES_PARTS_MAX) return { part: null, message: `En serie har ${SERIES_PARTS_MIN}–${SERIES_PARTS_MAX} delar.` };
  if (!shared.toFacebook && !shared.toInstagram && !shared.toLinkedIn) return { part: null, message: "Välj Facebook, Instagram, LinkedIn eller flera." };
  for (const [index, part] of parts.entries()) {
    const text = postProblem({ heading: part.heading, body: part.body, caption: part.caption, link: null, hashtags: shared.hashtags, toFacebook: shared.toFacebook, toInstagram: shared.toInstagram, toLinkedIn: shared.toLinkedIn });
    if (text) return { part: index, message: `Del ${index + 1}: ${text}` };
    const time = scheduleTimeProblem(part.at, now);
    if (time) return { part: index, message: `Del ${index + 1}: ${time}` };
  }
  return null;
}
