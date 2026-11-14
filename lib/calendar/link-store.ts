import { prisma } from "@/lib/db";
import { CALENDAR_LINK_KEY, calendarLinkSchema, createCalendarToken, hashCalendarToken, readCalendarLink, type CalendarLink } from "./link";

/**
 * Writing the person's own JSON record (UserPreferences) so the calendar link and the other choices never overwrite each other. A save
 * of choices is built from an earlier read; written as it was, it could drop a new link, or bring back a replaced one and so open the
 * old address again. Each statement here therefore works on the row as it stands when it is written. 'calendarLink' in the SQL is
 * CALENDAR_LINK_KEY (the unit test holds them together).
 */

/** Saves the person's choices (lib/kfid/preferences.ts) and keeps the calendar link the row holds right then. */
export async function writeUserPreferences(userId: string, data: unknown) {
  const json = JSON.stringify(data);
  await prisma.$executeRaw`
    insert into "UserPreferences" ("userId", data) values (${userId}, ${json}::jsonb)
    on conflict ("userId") do update set data = excluded.data || case
      when "UserPreferences".data -> 'calendarLink' is null then '{}'::jsonb
      else jsonb_build_object('calendarLink', "UserPreferences".data -> 'calendarLink')
    end`;
}

/** The person's link, if any. */
export async function storedCalendarLink(userId: string): Promise<CalendarLink | null> {
  const row = await prisma.userPreferences.findUnique({ where: { userId }, select: { data: true } });
  return readCalendarLink(row?.data);
}

/** A new link, which replaces the old one in the same statement: the old address stops working at once. The token leaves here once. */
export async function createCalendarLink(userId: string, organizationId: string, now = new Date()): Promise<string> {
  const token = createCalendarToken(userId);
  const link = calendarLinkSchema.parse({ tokenHash: hashCalendarToken(token), organizationId, createdAt: now.toISOString() });
  const json = JSON.stringify({ [CALENDAR_LINK_KEY]: link });
  await prisma.$executeRaw`
    insert into "UserPreferences" ("userId", data) values (${userId}, ${json}::jsonb)
    on conflict ("userId") do update set data = "UserPreferences".data || excluded.data`;
  return token;
}

/** Removes the link: the address stops working at once. */
export async function removeCalendarLink(userId: string) {
  await prisma.$executeRaw`update "UserPreferences" set data = data - 'calendarLink' where "userId" = ${userId}`;
}
