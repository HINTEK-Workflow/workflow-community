import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import test from "node:test";
import { calendarEvents, workOrderDays } from "../lib/calendar/feed";
import { buildCalendar, escapeIcalText, foldIcalLine, nextCalendarDay, timeProperty, utcStamp } from "../lib/calendar/ical";
import { CALENDAR_LINK_KEY, calendarLinkSchema, calendarTokenMatches, calendarTokenUser, createCalendarToken, hashCalendarToken, readCalendarLink, tokenFromPath } from "../lib/calendar/link";
import { mergePreferences, preferencesSchema } from "../lib/kfid/preferences";
import { RATE_RULES } from "../lib/security/rate-limit";
import { SECURITY_EVENT_TYPES } from "../lib/security/security-log-core";
import { MY_SETTINGS_GROUPS, SETTINGS_SECTIONS, SETTINGS_SECTION_TITLE } from "../lib/workflow/native-mode";

/** The personal calendar link (PL14, 2026-11-01): the file by RFC 5545, the token, and what may reach the file. */
const octets = (line: string) => new TextEncoder().encode(line).length;
const unfold = (text: string) => text.replace(/\r\n /g, "");

test("text values are escaped by RFC 5545", () => {
  assert.equal(escapeIcalText("Byt central; hus 2, plan 3"), "Byt central\\; hus 2\\, plan 3");
  assert.equal(escapeIcalText("rad 1\nrad 2\r\nrad 3"), "rad 1\\nrad 2\\nrad 3");
  assert.equal(escapeIcalText("c:\\temp"), "c:\\\\temp");
  assert.equal(escapeIcalText("a\u0007b\u0000c"), "abc", "other control characters are left out");
  // An injected line cannot start a property of its own.
  assert.equal(unfold(buildCalendar([{ kind: "day", uid: "x", summary: "Jobb\r\nATTENDEE:mailto:a@example.invalid", category: "Arbetsorder", firstDay: "2026-11-02", lastDay: "2026-11-02" }], new Date(0))).split("\r\n").includes("ATTENDEE:mailto:a@example.invalid"), false);
});

test("lines are folded at 75 octets without splitting a character, and unfold to the same", () => {
  assert.equal(foldIcalLine("SUMMARY:kort"), "SUMMARY:kort");
  for (const summary of ["a".repeat(200), "å".repeat(120), "🔌".repeat(60), `${"x".repeat(66)}åäö${"y".repeat(100)}`]) {
    const line = `SUMMARY:${summary}`;
    const folded = foldIcalLine(line);
    const physical = folded.split("\r\n");
    assert.ok(physical.length > 1);
    for (const [index, part] of physical.entries()) {
      assert.ok(octets(part) <= 75, `${octets(part)} octets`);
      if (index > 0) assert.equal(part[0], " ", "a continuation starts with a space");
      assert.equal(part.includes("\ufffd"), false);
    }
    assert.equal(unfold(folded), line);
  }
  assert.equal(octets(foldIcalLine("a".repeat(75))), 75, "exactly 75 stays one line");
});

test("times are in Swedish local time with TZID, also over the clock changes", () => {
  // Winter: 08:00 in Sweden is 07:00 UTC. Summer: 08:00 is 06:00 UTC.
  assert.equal(timeProperty("DTSTART", new Date("2026-11-02T07:00:00Z")), "DTSTART;TZID=Europe/Stockholm:20261102T080000");
  assert.equal(timeProperty("DTEND", new Date("2026-07-01T06:00:00Z")), "DTEND;TZID=Europe/Stockholm:20260701T080000");
  // The spring night 2026-03-29: 00:59 UTC is 01:59, 01:00 UTC is 03:00 (02:xx does not exist).
  assert.equal(timeProperty("DTSTART", new Date("2026-03-29T00:59:00Z")), "DTSTART;TZID=Europe/Stockholm:20260329T015900");
  assert.equal(timeProperty("DTSTART", new Date("2026-03-29T01:00:00Z")), "DTSTART;TZID=Europe/Stockholm:20260329T030000");
  // The autumn night 2026-10-25: 02:30 comes twice. The first (00:30 UTC) is what local time means; the second (01:30 UTC) is written in UTC.
  assert.equal(timeProperty("DTSTART", new Date("2026-10-25T00:30:00Z")), "DTSTART;TZID=Europe/Stockholm:20261025T023000");
  assert.equal(timeProperty("DTSTART", new Date("2026-10-25T01:30:00Z")), "DTSTART:20261025T013000Z");
  assert.equal(utcStamp(new Date("2026-11-01T22:05:09Z")), "20261101T220509Z");
});

test("the whole file: structure, CRLF, the zone's rules once, read only", () => {
  const now = new Date("2026-11-01T12:00:00Z");
  const file = buildCalendar([
    { kind: "time", uid: "bokning-1@workflow.hintek", summary: "Service, hus 2", category: "Bokning", startsAt: new Date("2026-11-02T07:00:00Z"), endsAt: new Date("2026-11-02T09:30:00Z"), url: "https://app.example.invalid/?view=workflow_task&taskId=t1&taskType=WORK_ORDER", lastModified: new Date("2026-11-01T10:00:00Z") },
    { kind: "day", uid: "arbetsorder-2@workflow.hintek", summary: "Byt central", category: "Arbetsorder", firstDay: "2026-12-30", lastDay: "2026-12-31" },
  ], now);
  assert.ok(file.endsWith("END:VCALENDAR\r\n"));
  assert.equal(/[^\r]\n/.test(file), false, "every line ends with CRLF");
  const lines = unfold(file).split("\r\n");
  assert.equal(lines[0], "BEGIN:VCALENDAR");
  assert.ok(lines.includes("VERSION:2.0"));
  assert.ok(lines.includes("METHOD:PUBLISH"));
  assert.equal(lines.filter((line) => line === "BEGIN:VTIMEZONE").length, 1);
  assert.ok(lines.includes("RRULE:FREQ=YEARLY;BYMONTH=3;BYDAY=-1SU"));
  assert.ok(lines.includes("RRULE:FREQ=YEARLY;BYMONTH=10;BYDAY=-1SU"));
  assert.equal(lines.filter((line) => line === "BEGIN:VEVENT").length, 2);
  assert.equal(lines.filter((line) => line === "END:VEVENT").length, 2);
  assert.ok(lines.includes("SUMMARY:Service\\, hus 2"));
  assert.ok(lines.includes("DTSTART;TZID=Europe/Stockholm:20261102T080000"));
  assert.ok(lines.includes("DTEND;TZID=Europe/Stockholm:20261102T103000"));
  assert.ok(lines.includes("DTSTAMP:20261101T120000Z"));
  assert.ok(lines.includes("URL:https://app.example.invalid/?view=workflow_task&taskId=t1&taskType=WORK_ORDER"), "a URL is a URI, not escaped text");
  // An all-day event ends the day after its last, and across the new year too.
  assert.ok(lines.includes("DTSTART;VALUE=DATE:20261230"));
  assert.ok(lines.includes("DTEND;VALUE=DATE:20270101"));
  assert.equal(nextCalendarDay("2028-02-28"), "2028-02-29");
  // Without a time the zone is not needed.
  assert.equal(buildCalendar([{ kind: "day", uid: "a", summary: "b", category: "Arbetsorder", firstDay: "2026-11-02", lastDay: "2026-11-02" }], now).includes("VTIMEZONE"), false);
  assert.ok(buildCalendar([], now).includes("BEGIN:VCALENDAR"), "an empty calendar is still a calendar");
});

const appUrl = (path: string) => `https://app.example.invalid${path}`;
const updatedAt = new Date("2026-11-01T00:00:00Z");

test("a work order's days", () => {
  assert.deepEqual(workOrderDays({ plannedStartDate: "2026-11-02", dueDate: "2026-11-05" }), { firstDay: "2026-11-02", lastDay: "2026-11-05" });
  assert.deepEqual(workOrderDays({ plannedStartDate: null, dueDate: "2026-11-05" }), { firstDay: "2026-11-05", lastDay: "2026-11-05" });
  assert.deepEqual(workOrderDays({ plannedStartDate: "2026-11-02", dueDate: "" }), { firstDay: "2026-11-02", lastDay: "2026-11-02" });
  assert.deepEqual(workOrderDays({ plannedStartDate: "2026-11-09", dueDate: "2026-11-05" }), { firstDay: "2026-11-05", lastDay: "2026-11-05" });
  assert.equal(workOrderDays({ plannedStartDate: "", dueDate: null }), null);
  assert.equal(workOrderDays({ plannedStartDate: "2026-02-30", dueDate: "inte ett datum" }), null);
});

test("the events: the person's own times go first, the same job stands once", () => {
  const events = calendarEvents({
    appUrl,
    bookings: [
      { id: "b1", title: "Bokning A", startsAt: new Date("2026-11-03T07:00:00Z"), endsAt: new Date("2026-11-03T15:00:00Z"), updatedAt, own: { startsAt: new Date("2026-11-03T08:00:00Z"), endsAt: new Date("2026-11-03T10:00:00Z") }, workflowTask: { id: "w1", kind: "WORK_ORDER" } },
      { id: "b2", title: "Möte", startsAt: new Date("2026-11-04T07:00:00Z"), endsAt: new Date("2026-11-04T08:00:00Z"), updatedAt, own: null, workflowTask: null },
    ],
    workOrders: [
      { id: "w1", title: "Har en bokning", plannedStartDate: "2026-11-03", dueDate: "2026-11-03", updatedAt },
      { id: "w2", title: "Utan bokning", plannedStartDate: "2026-11-05", dueDate: "2026-11-06", updatedAt },
      { id: "w3", title: "Tagen från jouren", plannedStartDate: null, dueDate: "2026-11-02", updatedAt },
      { id: "w4", title: "Utan dag", plannedStartDate: null, dueDate: null, updatedAt },
    ],
    onCall: [{ id: "r1", taskId: "w3", title: "Tagen från jouren", at: new Date("2026-11-02T20:00:00Z") }],
  });
  assert.deepEqual(events.map((event) => [event.category, event.summary]), [["Jour", "Jour: Tagen från jouren"], ["Bokning", "Bokning A"], ["Bokning", "Möte"], ["Arbetsorder", "Utan bokning"]]);
  const booking = events[1]!;
  assert.ok(booking.kind === "time");
  assert.equal(booking.startsAt.toISOString(), "2026-11-03T08:00:00.000Z");
  assert.equal(booking.endsAt.toISOString(), "2026-11-03T10:00:00.000Z");
  assert.equal(booking.url, "https://app.example.invalid/?view=workflow_task&taskId=w1&taskType=WORK_ORDER");
  assert.equal(events[2]!.url, undefined);
  const onCall = events[0]!;
  assert.ok(onCall.kind === "time");
  assert.equal(onCall.endsAt.getTime() - onCall.startsAt.getTime(), 3_600_000);
  assert.deepEqual(events.map((event) => event.uid), ["jour-r1@workflow.hintek", "bokning-b1@workflow.hintek", "bokning-b2@workflow.hintek", "arbetsorder-w2@workflow.hintek"], "stable uids");
});

test("nothing but title and times can reach the file: no description, customer note or price is read for it", () => {
  const server = readFileSync("lib/calendar/feed-server.ts", "utf8");
  const select = server.slice(server.indexOf("export async function loadCalendarRows"));
  assert.doesNotMatch(select, /description|customer|facility|\bdata\b|price|unitPrice|materials|\btext\b|cause|reporterName|\bnote\b/i);
  const file = readFileSync("lib/calendar/feed.ts", "utf8");
  assert.doesNotMatch(file.slice(file.indexOf("export type BookingRow")), /description|customerName|price/);
});

test("the token: random, carries only whose record, and is compared as a hash", () => {
  const token = createCalendarToken("cuid_abc-123");
  assert.equal(calendarTokenUser(token), "cuid_abc-123");
  assert.notEqual(createCalendarToken("cuid_abc-123"), token, "never the same twice");
  assert.ok(token.split(".")[1]!.length >= 43, "32 random bytes");
  assert.match(hashCalendarToken(token), /^[0-9a-f]{64}$/);
  assert.equal(calendarTokenMatches(hashCalendarToken(token), token), true);
  assert.equal(calendarTokenMatches(hashCalendarToken(token), `${token}x`), false);
  assert.equal(calendarTokenMatches(hashCalendarToken(createCalendarToken("cuid_abc-123")), token), false);
  assert.equal(calendarTokenMatches(null, token), false, "no stored link: never");
  assert.equal(calendarTokenMatches(undefined, token), false);
  assert.equal(calendarTokenMatches("0".repeat(64), "anything"), false, "the stand-in hash matches nothing");
  for (const bad of ["", "ingenpunkt", "a.b", `${"a".repeat(121)}.${"b".repeat(43)}`, `a.${"b".repeat(43)}.c`, "x".repeat(500), null, 7]) assert.equal(calendarTokenUser(bad), null, String(bad));
  assert.equal(tokenFromPath(`${token}.ics`), token);
  assert.equal(tokenFromPath(token), token);
  const source = readFileSync("lib/calendar/link.ts", "utf8");
  assert.match(source, /timingSafeEqual/);
  assert.match(source, /randomBytes\(SECRET_BYTES\)/);
});

test("the stored link is never in what the browser gets, and a browser's save cannot set it", () => {
  const link = { tokenHash: "a".repeat(64), organizationId: "org1", createdAt: "2026-11-01T00:00:00.000Z" };
  assert.deepEqual(calendarLinkSchema.parse(link), link);
  assert.deepEqual(readCalendarLink({ [CALENDAR_LINK_KEY]: link, theme: "light" }), link);
  assert.equal(readCalendarLink({ [CALENDAR_LINK_KEY]: { tokenHash: "kort" } }), null);
  assert.equal(readCalendarLink(null), null);
  assert.equal(readCalendarLink([]), null);
  assert.equal(CALENDAR_LINK_KEY in preferencesSchema.shape, false, "not in the schema every page reads through");
  assert.equal(CALENDAR_LINK_KEY in preferencesSchema.parse({ [CALENDAR_LINK_KEY]: link }), false);
  assert.equal(CALENDAR_LINK_KEY in mergePreferences({ [CALENDAR_LINK_KEY]: link }, { [CALENDAR_LINK_KEY]: { tokenHash: "b".repeat(64) } }), false);
});

test("every write of the person's choices keeps the link, in the statement itself", () => {
  const route = readFileSync("app/api/workspace/route.ts", "utf8");
  assert.equal(route.includes("userPreferences.upsert"), false, "no write that could drop or bring back a link");
  assert.equal((route.match(/writeUserPreferences\(ctx\.user\.id, data\)/g) ?? []).length, 3);
  const store = readFileSync("lib/calendar/link-store.ts", "utf8");
  assert.ok(store.includes(`'${CALENDAR_LINK_KEY}'`), "the SQL names the same key");
  assert.match(store, /on conflict \("userId"\) do update set data = excluded\.data \|\| case/);
  assert.match(store, /data = "UserPreferences"\.data \|\| excluded\.data/);
  // No other writer of the record outside the two that create a new person's first row.
  for (const file of ["lib/auth/invitations.ts", "lib/auth/registration.ts"]) assert.match(readFileSync(file, "utf8"), /userPreferences\.create/);
});

test("the file's route: no session, limited, one answer for every refusal, and no token in a log", () => {
  const route = readFileSync("app/api/calendar/[token]/route.ts", "utf8");
  assert.doesNotMatch(route, /context\(|getCurrentAuth|cookies/);
  assert.match(route, /text\/calendar; charset=utf-8/);
  assert.match(route, /RATE_RULES\.calendarFeedIp/);
  assert.match(route, /RATE_RULES\.calendarFeedLink/);
  assert.match(route, /RATE_RULES\.calendarRefusedIp/);
  assert.match(route, /no-store/);
  assert.doesNotMatch(route, /console\.[a-z]+\([^)]*token/i);
  assert.equal((route.match(/status: 404/g) ?? []).length, 1);
  assert.ok(RATE_RULES.calendarRefusedIp.limit <= 30);
  const server = readFileSync("lib/calendar/feed-server.ts", "utf8");
  for (const check of ["membership?.isActive", "canAccessTest(membership.user)", "organization.isActive", `storageMode !== "HINTEK_CLOUD"`, "isErasedCompany(organization)", "assertRequiredLegalAccess", "canReadPlannedActivity", `hasWorkflowPermission(access.workflowPermissions, "work-order", "read")`]) assert.ok(server.includes(check), check);
  assert.doesNotMatch(server, /@\/ee|\.\.\/ee|from "ee\//, "works without ee/");
});

test("managing the link: signed in, the page's own origin, Cloud, never through a key", () => {
  const route = readFileSync("app/api/calendar-link/route.ts", "utf8");
  assert.equal((route.match(/checkOrigin\(request\)/g) ?? []).length, 2, "both changes");
  assert.match(route, /requireCloudStorage\(ctx\)/);
  assert.match(route, /ctx\.integration/);
  assert.match(route, /requireFreshAuth\(ctx\.user\.id, ctx\.auth\)/);
  assert.ok("calendar_link_created" in SECURITY_EVENT_TYPES && "calendar_link_removed" in SECURITY_EVENT_TYPES);
});

test("Mina inställningar: the part exists on both looks and is left out in Local", () => {
  assert.ok(SETTINGS_SECTIONS.includes("calendar"));
  assert.equal(SETTINGS_SECTION_TITLE.calendar, "Kalenderlänk");
  assert.equal(MY_SETTINGS_GROUPS.filter((group) => group.sections.includes("calendar")).length, 1);
  const workspace = readFileSync("features/kfid/workspace.tsx", "utf8");
  assert.match(workspace, /calendar: !localMode/);
  assert.match(workspace, /!localMode \? settingsGroup\("Kalender"/);
  // The database and screen tests are not in the Community export.
  if (existsSync("scripts/qa/lib/manifest.cjs")) {
    assert.ok(existsSync("tests/calendar-feed.integration.ts"));
    assert.ok(existsSync("tests/calendar-link.browser.cjs"));
  }
});
