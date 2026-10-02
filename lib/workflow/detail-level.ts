/**
 * Visningsnivå (2026-10-02: "i mobilen blir det väldigt mycket information"): each person chooses how much is
 * shown on a phone and on a tablet, in three steps. Level 3 shows everything, level 2 leaves out the explaining texts
 * under headings, level 1 also leaves out help texts, facts, key figures, statistics and tips. A computer always shows
 * everything. Display only: a level never hides a field, a requirement or a button, and never changes what the person
 * may do.
 */
export const DETAIL_LEVELS = [1, 2, 3] as const;
export type DetailLevel = (typeof DETAIL_LEVELS)[number];
export type DetailLevels = { phone: DetailLevel; tablet: DetailLevel };
export const defaultDetailLevels: DetailLevels = { phone: 3, tablet: 3 };
export const DETAIL_LEVEL_EVENT = "hintek:detail-level";
export const DETAIL_LEVEL_LABEL: Record<DetailLevel, string> = {
  1: "Enkel – bara det som behövs för att göra jobbet",
  2: "Lagom – utan förklarande texter",
  3: "Allt",
};

export type DeviceClass = "phone" | "tablet" | "desktop";
/** A narrow screen is a phone; a touch screen up to a large tablet's width is a tablet; everything else a computer. */
export function deviceClass(width: number, touch: boolean): DeviceClass {
  if (width < 768) return "phone";
  return touch && width <= 1400 ? "tablet" : "desktop";
}

export function detailLevelFor(levels: Partial<DetailLevels> | null | undefined, width: number, touch: boolean): DetailLevel {
  const device = deviceClass(width, touch);
  const level = device === "desktop" ? 3 : levels?.[device];
  return level === 1 || level === 2 ? level : 3;
}
