/**
 * Visningsnivå (2026-10-02: "i mobilen blir det väldigt mycket information"): each person chooses how much is
 * shown on a phone and on a tablet, in three steps. Level 3 shows everything; level 2 leaves out the explaining texts
 * under headings and folds a task page's panels but the current step's (2026-10-08); level 1 also leaves out the
 * header's minor facts, key figures, statistics, earlier protocols, trends and tips. Since 2026-10-11 (plan 1P) the
 * person chooses the level on every device – phone, tablet and computer – and level 1 (the app look) is open to all of
 * them: on a wide screen it is drawn in a narrow app column (lib/workflow/native-mode.ts). Display only: a level never hides a field, a requirement, a button or the job and its safety (risk
 * class, priority, due date, description, place, fault, the customer's requirements), and never changes what the
 * person may do.
 *
 * Telefonen visar alltid appvyn (UX-granskningen A2, 2026-10-21/22): on a phone the layout is always level 1 (the
 * app) while signed in, standing or on its side; Lagom and Allt are no longer another layout there. What they showed –
 * the explaining texts, minor facts, extra panels and rows – comes back with "Visa mer" on the page
 * (lib/workflow/show-more.ts), or on every page with "Visa allt på den här enheten". So two things are kept apart: the
 * layout level (`data-native`: the app look or the ordinary pages) and the content level (`data-detail`: what the style
 * sheet and useDetailLevel leave out); `displayLevelsFor` decides both. A saved 2 or 3 on the phone (before 2026-10-22)
 * reads as the app with Visa allt on, so no stored record needs to change.
 */
export const DETAIL_LEVELS = [1, 2, 3] as const;
export type DetailLevel = (typeof DETAIL_LEVELS)[number];
export type DetailLevels = { phone: DetailLevel; tablet: DetailLevel; desktop: DetailLevel };
// The first time, by device (2026-10-21, UX-granskningen A2; replaces 2026-10-11's Lagom on a phone): the app on a
// phone (Visa allt off) and everything on a computer. A tablet starts in its own app view (appkänslan, produktägarens beslut
// 2026-11-23; replaces Lagom): the app across the window with a rail, standing or on its side – one level for the tablet.
export const defaultDetailLevels: DetailLevels = { phone: 1, tablet: 1, desktop: 3 };
export const DETAIL_LEVEL_EVENT = "hintek:detail-level";
export const DETAIL_LEVEL_LABEL: Record<DetailLevel, string> = {
  1: "Enkel – app: bara det som behövs för att göra jobbet",
  2: "Lagom – aktuellt steg öppet, utan förklarande texter",
  3: "Allt",
};
/** One line under each level's name. */
export const DETAIL_LEVEL_HINT: Record<DetailLevel, string> = { 1: "Appvyn: bara det som behövs för att göra jobbet", 2: "Samma sidor, aktuellt steg öppet och utan förklarande texter", 3: "Samma sidor med allt visat" };
/** "This phone", "this tablet", "this computer". */
export const DEVICE_THIS: Record<DeviceClass, string> = { phone: "den här mobilen", tablet: "den här surfplattan", desktop: "den här datorn" };
/** The short names of the three levels. */
export const DETAIL_LEVEL_NAME: Record<DetailLevel, string> = { 1: "Enkel – app", 2: "Lagom", 3: "Allt" };

/**
 * The levels each device offers: a tablet and a computer every level (2026-10-11; the app look there is drawn as an
 * app column), a phone only the app with Visa allt off (1) or on (3) since 2026-10-21 (A2).
 */
export const DEVICE_LEVELS: Record<DeviceClass, readonly DetailLevel[]> = { phone: [1, 3], tablet: [1, 2, 3], desktop: [1, 2, 3] };

/** Visa allt på telefonen (A2): a saved 2 or 3 on the phone – Lagom or Allt from before 2026-10-22 – is the app with everything shown. */
export const phoneShowsAll = (level: unknown) => level === 2 || level === 3;

/** The level a device's choice stands for: on a phone 1 or 3 (a saved 2 reads as 3), elsewhere the level itself. */
export function choiceLevel(device: DeviceClass, level: DetailLevel): DetailLevel {
  return device === "phone" ? (phoneShowsAll(level) ? 3 : 1) : level;
}

/** A choice's short name: on a phone "Appvyn" or "Appvyn, allt visat"; elsewhere the level's name. */
export function choiceName(device: DeviceClass, level: DetailLevel): string {
  if (device !== "phone") return DETAIL_LEVEL_NAME[level];
  return phoneShowsAll(level) ? "Appvyn, allt visat" : "Appvyn";
}

/** The line under a choice. */
export function choiceHint(device: DeviceClass, level: DetailLevel): string {
  if (device !== "phone") return DETAIL_LEVEL_HINT[level];
  return phoneShowsAll(level) ? "Alla fält, paneler och förklaringar på varje sida" : "Det som behövs för jobbet. Visa mer visar resten på sidan";
}

export type DeviceClass = "phone" | "tablet" | "desktop";
/**
 * A narrow screen is a phone; a touch screen up to a large tablet's width is a tablet; everything else a computer. A touch
 * screen whose short side is a phone's stays a phone when it is turned (2026-10-13: a phone on its side got
 * level 2 with the computer's top bar). `height` is optional so a caller without it reads as before.
 */
export function deviceClass(width: number, touch: boolean, height = width): DeviceClass {
  if (width < 768 || (touch && Math.min(width, height) < 600)) return "phone";
  return touch && width <= 1400 ? "tablet" : "desktop";
}

/**
 * The app column (plan 1P): level 1 on a screen from 640 px up is drawn by the same app as on a phone, in a frame about
 * 560 px wide (components/native/app-column.tsx). The frame is a document of its own, named so that it knows it is the
 * column and which device the person sits at – its own width says "phone" – so level 1 is forced there and a switch of
 * display (Byt visning) changes the right device's level.
 */
export const APP_COLUMN_WIDTH = 560;
const COLUMN_FRAME = "hintek-app-column-";
export const appColumnFrameName = (device: DeviceClass) => COLUMN_FRAME + device;
/** The device a window named by appColumnFrameName stands for; null in an ordinary window. */
export function appColumnDevice(name: string | null | undefined): DeviceClass | null {
  const device = name?.startsWith(COLUMN_FRAME) ? name.slice(COLUMN_FRAME.length) : "";
  return device === "phone" || device === "tablet" || device === "desktop" ? device : null;
}
export const DEVICE_LABEL: Record<DeviceClass, string> = { phone: "Mobil", tablet: "Surfplatta", desktop: "Dator" };

/** The level chosen (or the default) for the device this window is. On a phone it is read by displayLevelsFor. */
export function detailLevelFor(levels: Partial<DetailLevels> | null | undefined, width: number, touch: boolean, height = width): DetailLevel {
  const device = deviceClass(width, touch, height);
  const level = levels?.[device];
  // Nothing chosen for this device: the default for the width. An unknown value is everything.
  if (level === undefined || level === null) return defaultDetailLevels[device];
  return level === 1 || level === 2 ? level : 3;
}

/** Signed out on a phone (the login pages, no app): Lagom, as the phone's default was before A2. */
const SIGNED_OUT_PHONE_LEVEL: DetailLevel = 2;

/**
 * The two levels in force in a window (A2, 2026-10-22): `layout` decides the app look (nativeModeFor, appColumnFor) and
 * `content` what is left out (`data-detail`, useDetailLevel). On a tablet and a computer both are the chosen level. On a
 * phone, signed in, the layout is always the app (1) and the content is everything (3) with Visa allt on or with Visa
 * mer on this page (`showMore`), otherwise 1. Display only: neither ever changes what the person may do.
 */
export function displayLevelsFor(levels: Partial<DetailLevels> | null | undefined, width: number, touch: boolean, height = width,
  { signedIn = true, showMore = false }: { signedIn?: boolean; showMore?: boolean } = {}): { layout: DetailLevel; content: DetailLevel } {
  const level = detailLevelFor(levels, width, touch, height);
  if (deviceClass(width, touch, height) !== "phone") return { layout: level, content: level };
  if (!signedIn) return { layout: SIGNED_OUT_PHONE_LEVEL, content: SIGNED_OUT_PHONE_LEVEL };
  return { layout: 1, content: phoneShowsAll(level) || showMore ? 3 : 1 };
}

/** Whether the pages offer "Visa mer": a signed-in phone with Visa allt off (never the app column's frame, which is not a phone). */
export function offersShowMore(levels: Partial<DetailLevels> | null | undefined, width: number, touch: boolean, height = width, signedIn = true): boolean {
  return signedIn && deviceClass(width, touch, height) === "phone" && !phoneShowsAll(detailLevelFor(levels, width, touch, height));
}

/**
 * Utförande först (proposal 2026-10-08, step 2): on a phone or tablet at level 1 or 2, a saved task whose responsible
 * person is the one looking at it shows the work (Utförande, the form, the current step) directly under Uppdraget,
 * and the planning panels (Grunduppgifter, Om projektet, Underhåll) below it. Everyone else, level 3 and a computer
 * keep the usual order. Order only: no field is removed and nothing about rights changes.
 */
export function executionFirst({ level, saved, responsibleId, viewerId }: { level: DetailLevel; saved: boolean; responsibleId?: string | null; viewerId?: string | null }) {
  return level < 3 && saved && Boolean(responsibleId) && responsibleId === viewerId;
}
