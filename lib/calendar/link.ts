import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { z } from "zod";

/**
 * The personal calendar link (PL14, 2026-11-01), on the server only. The token is `<person>.<secret>`: the first part only says
 * whose record to read (base64url of the id, so no search over everyone's), the second is 32 random bytes and is what the link rests
 * on. Only the whole token's sha256 is stored, in the person's own JSON record (UserPreferences, key `calendarLink`), and it is
 * compared in constant time. The record names the company the link was made in: the file shows that company only.
 *
 * The key is not in preferencesSchema on purpose: every page that reads the preferences gets them through that schema, which drops
 * the key, so the hash never reaches a browser, and a browser's save can never set it (lib/calendar/link-store.ts keeps it).
 */
export const CALENDAR_LINK_KEY = "calendarLink";
const SECRET_BYTES = 32;
/** Longer than any real token; anything longer is not looked at. */
const MAX_TOKEN_LENGTH = 200;
const TOKEN = /^([A-Za-z0-9_-]{1,120})\.([A-Za-z0-9_-]{43})$/;

export const calendarLinkSchema = z.object({
  tokenHash: z.string().regex(/^[0-9a-f]{64}$/),
  organizationId: z.string().min(1).max(100),
  createdAt: z.string().min(1).max(40),
});
export type CalendarLink = z.infer<typeof calendarLinkSchema>;

/** The link in a stored record; anything else is no link. */
export function readCalendarLink(stored: unknown): CalendarLink | null {
  if (!stored || typeof stored !== "object" || Array.isArray(stored)) return null;
  const parsed = calendarLinkSchema.safeParse((stored as Record<string, unknown>)[CALENDAR_LINK_KEY]);
  return parsed.success ? parsed.data : null;
}

export const hashCalendarToken = (token: string) => createHash("sha256").update(token, "utf8").digest("hex");

export function createCalendarToken(userId: string): string {
  return `${Buffer.from(userId, "utf8").toString("base64url")}.${randomBytes(SECRET_BYTES).toString("base64url")}`;
}

/** Whose record a token points at, or null when it cannot be a token. Says nothing about whether it is right. */
export function calendarTokenUser(raw: unknown): string | null {
  if (typeof raw !== "string" || raw.length > MAX_TOKEN_LENGTH) return null;
  const match = TOKEN.exec(raw);
  return match ? Buffer.from(match[1]!, "base64url").toString("utf8") : null;
}

/** The address's last part without the file ending a calendar program likes to see. */
export const tokenFromPath = (segment: string) => segment.replace(/\.ics$/i, "");

const NOTHING = "0".repeat(64);
/** Constant time: both are sha256 in hex, always the same length. Without a stored hash the same work is done, and the answer is no. */
export function calendarTokenMatches(storedHash: string | null | undefined, raw: string): boolean {
  const expected = Buffer.from(storedHash ?? NOTHING, "utf8");
  const given = Buffer.from(hashCalendarToken(raw), "utf8");
  return expected.length === given.length && timingSafeEqual(expected, given) && Boolean(storedHash);
}
