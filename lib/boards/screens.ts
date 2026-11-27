import { z } from "zod";
import { DISTANCES } from "./model";

/**
 * Skärmar och länkar (Tavlor och skärmar etapp 2, 2026-11-18; plan 6–7): the pure rules of the ways in without a person's sign-in.
 * Tested in tests/boards-screens.test.ts; the server parts are lib/boards/screens-server.ts and lib/boards/links-server.ts.
 */

// ---------- the pairing code (the form of RFC 8628, section 6.1) ----------

/** 20 consonants without vowels, so no word can be formed and nothing is mistaken for a digit. */
export const PAIR_ALPHABET = "BCDFGHJKLMNPQRSTVWXZ";
export const PAIR_CODE_LENGTH = 8;
export const PAIR_MINUTES = 10;
/** The screen asks for its answer at most this often; sooner gets "slow_down". */
export const PAIR_POLL_SECONDS = 5;

/** A new code from random bytes (the caller gives crypto's bytes): 8 letters of the alphabet, rejection-free modulo of 20 over 240. */
export function pairCodeFrom(bytes: Uint8Array): string {
  let code = "";
  for (const byte of bytes) {
    if (byte >= 240) continue;
    code += PAIR_ALPHABET[byte % PAIR_ALPHABET.length];
    if (code.length === PAIR_CODE_LENGTH) break;
  }
  return code;
}
/** What a person typed, read leniently: case, spaces and the dash do not matter; anything else makes it no code. */
export function normalizePairCode(input: string): string | null {
  const code = input.toUpperCase().replace(/[\s-]/g, "");
  return code.length === PAIR_CODE_LENGTH && [...code].every((letter) => PAIR_ALPHABET.includes(letter)) ? code : null;
}
export const formatPairCode = (code: string) => `${code.slice(0, 4)}-${code.slice(4)}`;

// ---------- the screen's settings ----------

export const SCREEN_THEMES = ["dark", "light"] as const;
export const screenSettingsSchema = z.object({
  /** Mörkt is the default on screens (fråga 14); the status colours stay the same in both. */
  theme: z.enum(SCREEN_THEMES).default("dark"),
  /** The hour (the device's own clock) at which the player reloads itself each night, against memory leaks in TV browsers; null = never. */
  reloadHour: z.number().int().min(0).max(23).nullable().default(3),
  /** A pixel's shift now and then against burn-in on OLED screens. */
  burnIn: z.boolean().default(false),
  /** Avstånd (2026-11-19): the screen's own viewing distance, for every board it shows; null follows each board's. */
  distance: z.enum(DISTANCES).nullable().default(null),
  /**
   * Skärmstorlek (2026-11-20): the screen's diagonal in inches, for counting what can be read on it (lib/boards/capacity.ts);
   * null is the usual size at the distance (Nära 55", Mellan 65", Långt 86"). It changes nothing in what the screen draws.
   */
  inches: z.number().int().min(20).max(300).nullable().default(null),
});
export type ScreenSettings = z.infer<typeof screenSettingsSchema>;
export const readScreenSettings = (value: unknown): ScreenSettings => {
  const parsed = screenSettingsSchema.safeParse(value ?? {});
  return parsed.success ? parsed.data : screenSettingsSchema.parse({});
};

/** A connected screen stays until it is blocked, but is disconnected after 30 days without contact (fråga 7). */
export const SCREEN_IDLE_DAYS = 30;
export const screenTooQuiet = (lastSeenAt: Date | null, approvedAt: Date, now = new Date()) =>
  now.getTime() - (lastSeenAt ?? approvedAt).getTime() > SCREEN_IDLE_DAYS * 24 * 3600 * 1000;
/** Online when heard from within the last three minutes (the player asks every 30 seconds). */
export const SCREEN_ONLINE_MS = 3 * 60_000;
export const screenOnline = (lastSeenAt: Date | string | null, now = Date.now()) => Boolean(lastSeenAt && now - new Date(lastSeenAt).getTime() < SCREEN_ONLINE_MS);

/** A one-time order from Skärmar to a screen. */
export const SCREEN_COMMANDS = ["reload", "identify"] as const;
export type ScreenCommand = (typeof SCREEN_COMMANDS)[number];

// ---------- what a screen or a link shows ----------

export const targetSchema = z.union([
  z.object({ boardId: z.string().trim().min(1).max(60), playlistId: z.undefined().optional() }),
  z.object({ playlistId: z.string().trim().min(1).max(60), boardId: z.undefined().optional() }),
]);
export type AccessTarget = z.infer<typeof targetSchema>;

export const PLAYLIST_MAX_ITEMS = 10;
export const playlistItemsSchema = z.array(z.object({ boardId: z.string().trim().min(1).max(60), seconds: z.number().int().min(5).max(3600) }))
  .min(1, "Lägg till minst en tavla.").max(PLAYLIST_MAX_ITEMS, `En spellista kan ha högst ${PLAYLIST_MAX_ITEMS} tavlor.`);
export type PlaylistItem = z.infer<typeof playlistItemsSchema>[number];
export const readPlaylistItems = (value: unknown): PlaylistItem[] => { const parsed = playlistItemsSchema.safeParse(value); return parsed.success ? parsed.data : []; };

// ---------- shared links (frågorna 8–9) ----------

export const LINK_DEFAULT_DAYS = 90;
export const LINK_SESSION_HOURS = 12;
export const LINK_CODE_TRIES = 5;
export const LINK_LOCK_MINUTES = 15;
export const linkCodeSchema = z.string().trim().regex(/^\d{6,10}$/, "Koden ska vara 6–10 siffror.");

/**
 * The rule on the server (fråga 8): a link has an end date unless the board shows no personal data; names are shown through a link
 * only when it has both a code and an end date (plan 6.2). Returns the reason a link cannot be made, or null.
 */
export function linkRefusal(input: { expiresAt: Date | null; personal: boolean; now?: Date }): string | null {
  const now = input.now ?? new Date();
  if (input.expiresAt && input.expiresAt.getTime() <= now.getTime()) return "Slutdatumet har redan passerat.";
  if (input.expiresAt && input.expiresAt.getTime() - now.getTime() > 366 * 24 * 3600 * 1000) return "Slutdatumet kan vara högst ett år fram.";
  if (!input.expiresAt && input.personal) return "Tavlan visar namn, så länken behöver ett slutdatum.";
  return null;
}
export const linkShowsNames = (link: { codeHash: string | null; expiresAt: Date | null }) => Boolean(link.codeHash && link.expiresAt);

export type LinkState = "active" | "expired" | "revoked" | "locked";
export function linkState(link: { revokedAt: Date | null; expiresAt: Date | null; lockedUntil: Date | null }, now = new Date()): LinkState {
  if (link.revokedAt) return "revoked";
  if (link.expiresAt && link.expiresAt.getTime() <= now.getTime()) return "expired";
  if (link.lockedUntil && link.lockedUntil.getTime() > now.getTime()) return "locked";
  return "active";
}
export const LINK_STATE_LABEL: Record<LinkState, string> = { active: "Aktiv", expired: "Utgången", revoked: "Spärrad", locked: "Låst en stund" };

/** The secret travels in the address's #-part, which the browser never sends to a server or puts in a Referer (plan 6.4). */
export const linkAddress = (origin: string, secret: string) => `${origin.replace(/\/+$/, "")}/visa#k=${secret}`;
/** The secret from a #-part ("#k=…"), or null. */
export function secretFromHash(hash: string): string | null {
  const value = new URLSearchParams(hash.replace(/^#/, "")).get("k") ?? "";
  return /^[A-Za-z0-9_-]{40,60}$/.test(value) ? value : null;
}
