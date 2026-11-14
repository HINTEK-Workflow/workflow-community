import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { NEXT_REASON_CHIP, NEXT_REASONS, nextReasonOf, rankNextActions, type NextCandidate } from "../lib/workflow/next-actions";
import { deviationSummary, MY_DAY_OVERDUE_HREF, MY_DAY_ROWS, myDayJobHref, myRounds, nextSummary, overdueSummary, parseMyDayTiles, type MyDayDeviation, type MyDayTask } from "../lib/workflow/my-day";
import { addableTiles, DEFAULT_HOME_TILES, HOME_TILE_KEYS, MY_DAY_TILES, nativeLayoutAllowed, normalizeNativeLayout, WIDE_HOME_TILES, homeGridColumns } from "../lib/workflow/native-layout";
import type { ScheduleView } from "../lib/workflow/form-schedule";
import { OBSTACLE_REASONS } from "../lib/workflow/obstacles";

// Dashboard etapp 2 (2026-10-28): Gör detta nu, Förfallet and Mina avvikelser on Hem – off from the start, chosen
// by each person, only for those who may use them, counted by the same rules as the lists.

const TODAY = "2026-10-28";
const task = (over: Partial<MyDayTask> & { id: string }): MyDayTask => ({
  kind: "WORK_ORDER", title: over.id, status: "PLANNED", progress: 0, dueDate: "", plannedStartDate: "", updatedAt: "2026-10-01T08:00:00.000Z",
  isMine: true, priority: null, obstacle: null, waitingOn: null, ...over,
});
const noFacts = { running: new Set<string>(), alarms: new Set<string>(), bookedToday: new Set<string>() };

// ---------- the layout ----------

test("the three new tiles exist, are off by default and are wide", () => {
  for (const key of MY_DAY_TILES) {
    assert.ok((HOME_TILE_KEYS as readonly string[]).includes(key), key);
    assert.ok(!DEFAULT_HOME_TILES.includes(key), `${key} is off by default`);
    assert.ok(WIDE_HOME_TILES.includes(key), `${key} takes the whole row`);
  }
  assert.deepEqual(normalizeNativeLayout(undefined).home, [...DEFAULT_HOME_TILES], "a person who never chose gets the old default");
  assert.equal(homeGridColumns(DEFAULT_HOME_TILES.filter((key) => !WIDE_HOME_TILES.includes(key)).length, false), 2, "the default grid is unchanged");
});

test("stored layouts are read unchanged: nothing is added, a chosen new tile is kept", () => {
  const old = { home: ["jobs", "time", "notices"], tabs: ["home", "jobs"] };
  assert.deepEqual(normalizeNativeLayout(old), old);
  assert.deepEqual(normalizeNativeLayout({ home: [], tabs: ["home"] }).home, [], "an emptied Hem stays empty");
  assert.deepEqual(normalizeNativeLayout({ home: ["overdue", "jobs", "next", "deviations", "next"], tabs: ["home"] }).home, ["overdue", "jobs", "next", "deviations"]);
});

test("the tiles are offered in Cloud to whoever may use them, never in Local or the demo", () => {
  const owner = nativeLayoutAllowed({ memberRole: "OWNER", workflowPermissions: { version: 1, grants: [] } });
  for (const key of MY_DAY_TILES) assert.ok(owner.allowedHome.includes(key), key);
  assert.deepEqual(addableTiles(DEFAULT_HOME_TILES, owner.allowedHome).filter((key) => (MY_DAY_TILES as readonly string[]).includes(key)), [...MY_DAY_TILES], "addable from the edit mode");
  const reader = nativeLayoutAllowed({ memberRole: "MEMBER", workflowPermissions: { version: 1, grants: ["work-order:read"] } as never });
  assert.ok(reader.allowedHome.includes("next") && reader.allowedHome.includes("overdue"));
  const none = nativeLayoutAllowed({ memberRole: "MEMBER", workflowPermissions: { version: 1, grants: [] } });
  assert.ok(!none.allowedHome.includes("next") && !none.allowedHome.includes("overdue"), "no job or round to read: no Gör detta nu or Förfallet");
  assert.ok(none.allowedHome.includes("deviations"), "every active member reads the deviation log (selfInspectionAccess)");
  for (const access of [{ localStorageMode: true }, { demo: true }]) {
    const allowed = nativeLayoutAllowed({ memberRole: "OWNER", workflowPermissions: { version: 1, grants: [] }, ...access }).allowedHome;
    for (const key of MY_DAY_TILES) assert.ok(!allowed.includes(key), `${key} not in ${JSON.stringify(access)}`);
    for (const key of DEFAULT_HOME_TILES) assert.ok(allowed.includes(key) || key === "ai", `${key} stays`);
  }
  assert.ok(!nativeLayoutAllowed(null).allowedHome.some((key) => (MY_DAY_TILES as readonly string[]).includes(key)));
});

// ---------- the ranking ----------

test("the rule order: alarm, timer, late, booked today, round, obstacle, deviation, the rest", () => {
  assert.deepEqual([...NEXT_REASONS], ["alarm", "urgent", "running", "overdue", "booked_today", "round_late", "round_today", "obstacle", "needs_action", "immediate_deviation", "in_progress", "open"]);
  const candidates: NextCandidate[] = [
    { id: "open", title: "A", href: "/a", signals: { open: true } },
    { id: "dev", title: "B", href: "/b", signals: { immediate_deviation: true } },
    { id: "obstacle", title: "C", href: "/c", signals: { obstacle: true, open: true } },
    { id: "round", title: "D", href: "/d", signals: { round_today: true } },
    { id: "booked", title: "E", href: "/e", signals: { booked_today: true, open: true } },
    { id: "late", title: "F", href: "/f", signals: { overdue: true, booked_today: true } },
    { id: "running", title: "G", href: "/g", signals: { running: true, overdue: true } },
    { id: "alarm", title: "H", href: "/h", signals: { alarm: true, running: true } },
  ];
  assert.deepEqual(rankNextActions(candidates, 99).map((row) => [row.id, row.chip]), [
    ["alarm", "Larm"], ["running", "Tiden går"], ["late", "Förfallen"], ["booked", "Bokad idag"], ["round", "Rond idag"], ["obstacle", "Hinder"], ["dev", "Avvikelse"], ["open", "Öppen"],
  ]);
  assert.equal(rankNextActions(candidates).length, 3, "three rows by default");
  assert.equal(nextReasonOf({}), null);
  assert.equal(NEXT_REASON_CHIP.running, "Tiden går");
});

test("ties go by Klart senast (none last), then title, then id; doubles are one row; no reason is no row", () => {
  const rows = rankNextActions([
    { id: "x", title: "Beta", href: "/x", dueDate: "", signals: { overdue: true } },
    { id: "y", title: "Alfa", href: "/y", dueDate: "2026-10-20", signals: { overdue: true } },
    { id: "z", title: "Alfa", href: "/z", dueDate: "2026-10-20", signals: { overdue: true } },
    { id: "w", title: "Åsa", href: "/w", dueDate: "2026-10-21", signals: { overdue: true } },
    { id: "y", title: "Alfa", href: "/y", signals: { alarm: true } },
    { id: "q", title: "Q", href: "/q", signals: { open: false } },
  ], 10);
  assert.deepEqual(rows.map((row) => row.id), ["y", "z", "w", "x"]);
  assert.equal(rows[0].reason, "alarm", "the same job twice keeps its strongest reason");
  assert.equal(rows[0].pressing, true);
});

test("Gör detta nu from the server's rows: timer, late, booked, rounds, obstacles and immediate deviations", () => {
  const tasks = [
    task({ id: "plain" }),
    task({ id: "late", dueDate: "2026-10-27" }),
    task({ id: "today", plannedStartDate: TODAY }),
    task({ id: "timed", isMine: false }),
    task({ id: "waiting", status: "NEEDS_ACTION", obstacle: { reason: OBSTACLE_REASONS[0], text: "", since: "2026-10-27T08:00:00.000Z", byName: "", previousStatus: "IN_PROGRESS" } }),
    task({ id: "other", isMine: false }),
    task({ id: "done", status: "COMPLETED", dueDate: "2026-10-01" }),
  ];
  const deviations: MyDayDeviation[] = [{ id: "d1", number: 4, title: "Jordfel", status: "OPEN", category: "IMMEDIATE", dueDate: "" }];
  const rounds = [{ id: "round:r1:2026-10-27", title: "Rond", date: "2026-10-27", late: true, href: "/r" }];
  const all = nextSummary(tasks, rounds, deviations, { ...noFacts, running: new Set(["timed"]) }, TODAY).rows;
  assert.deepEqual(all.map((row) => row.reason), ["running", "overdue", "booked_today"]);
  assert.equal(all[0].href, myDayJobHref("timed", "WORK_ORDER"));
  const quiet = nextSummary(tasks.filter((item) => !["timed", "late", "today"].includes(item.id)), rounds, deviations, noFacts, TODAY).rows;
  assert.deepEqual(quiet.map((row) => [row.id, row.chip]), [["round:r1:2026-10-27", "Förfallen rond"], ["waiting", "Hinder"], ["deviation:d1", "Avvikelse"]]);
  assert.ok(!nextSummary([task({ id: "other", isMine: false })], [], [], noFacts, TODAY).rows.length, "someone else's job is never suggested");
});

// ---------- Förfallet ----------

test("Förfallet counts the person's late jobs by isLateTask and their late rounds, oldest first, three rows", () => {
  const tasks = [
    task({ id: "a", dueDate: "2026-10-27" }), task({ id: "b", dueDate: "2026-10-01" }), task({ id: "c", dueDate: TODAY }),
    task({ id: "d", dueDate: "2026-10-02", status: "CANCELLED" }), task({ id: "e", dueDate: "2026-10-03", isMine: false }), task({ id: "f", dueDate: "2026-10-20" }),
  ];
  const rounds = [{ id: "r", title: "Rond", date: "2026-10-10", late: true, href: "/r" }, { id: "s", title: "Rond i dag", date: TODAY, late: false, href: "/s" }];
  const summary = overdueSummary(tasks, rounds, TODAY);
  assert.equal(summary.count, 4);
  assert.equal(summary.tasks, 3);
  assert.equal(summary.rounds, 1);
  assert.equal(summary.rows.length, MY_DAY_ROWS);
  assert.deepEqual(summary.rows.map((row) => row.id), ["b", "r", "f"]);
  // The second line says what it is and how late (Översiktens lyft, 2026-10-29).
  assert.equal(summary.rows[1].detail, "Driftrond · missad 10 okt (18 dagar)");
  assert.match(summary.rows[0].detail, /Förfallen sedan 1 okt \(27 dagar\)$/);
  assert.equal(summary.href, "/?view=tasks&type=all&filter=overdue&scope=mine");
  assert.equal(MY_DAY_OVERDUE_HREF, summary.href);
});

test("the person's rounds: their own, or with nobody responsible an admin's; late or due today", () => {
  const view = (id: string, assignedToUserId: string | null, current: { date: string; state: string } | null, active = true) => ({
    id, title: id, templateId: "t", active, templateMissing: false, assignedToUserId,
    overview: { current, next: null, nextTaskId: null, upcoming: [] },
  }) as unknown as ScheduleView;
  const views = [view("mine", "me", { date: "2026-10-27", state: "missed" }), view("today", "me", { date: TODAY, state: "due" }), view("theirs", "other", { date: "2026-10-27", state: "missed" }),
    view("nobody", null, { date: TODAY, state: "due" }), view("paused", "me", { date: "2026-10-20", state: "missed" }, false), view("calm", "me", null)];
  assert.deepEqual(myRounds(views, { id: "me", admin: false }, TODAY).map((round) => [round.title, round.late]), [["mine", true], ["today", false]]);
  assert.deepEqual(myRounds(views, { id: "me", admin: true }, TODAY).map((round) => round.title), ["mine", "today", "nobody"], "an admin is not given the others' rounds");
  assert.ok(myRounds(views, { id: "me", admin: false }, TODAY)[0].href.startsWith("/?"), "a link that starts the round");
});

// ---------- Mina avvikelser ----------

test("Mina avvikelser: open entries, late first, with how many are late", () => {
  const entries: MyDayDeviation[] = [
    { id: "1", number: 1, title: "Gammal", status: "OPEN", category: "ROUTINE", dueDate: "" },
    { id: "2", number: 2, title: "Sen", status: "IN_PROGRESS", category: "ROUTINE", dueDate: "2026-10-20" },
    { id: "3", number: 3, title: "Snart", status: "OPEN", category: "ROUTINE", dueDate: "2026-11-02" },
    { id: "4", number: 4, title: "Klar", status: "DONE", category: "ROUTINE", dueDate: "2026-10-01" },
    { id: "5", number: 5, title: "Senare", status: "OPEN", category: "IMMEDIATE", dueDate: "2026-10-27" },
  ];
  const summary = deviationSummary(entries, TODAY);
  assert.equal(summary.count, 4);
  assert.equal(summary.overdue, 2);
  assert.deepEqual(summary.rows.map((row) => [row.id, row.late]), [["2", true], ["5", true], ["3", false]]);
  assert.equal(summary.rows[0].href, "/?view=deviations&deviation=2");
  assert.deepEqual(deviationSummary([], TODAY), { count: 0, overdue: 0, rows: [], href: "/?view=deviations" });
});

// ---------- the endpoint ----------

test("the endpoint reads only asked, known tiles, and Hem asks only for the tiles it shows", () => {
  assert.deepEqual(parseMyDayTiles("deviations,next,bogus,next"), ["next", "deviations"]);
  assert.deepEqual(parseMyDayTiles(""), []);
  assert.deepEqual(parseMyDayTiles(null), []);
  const route = readFileSync("app/api/my-day/route.ts", "utf8");
  assert.ok(route.includes("await context()") && route.includes("requireCloudStorage(ctx)"), "session, membership and Cloud");
  const server = readFileSync("lib/workflow/my-day-server.ts", "utf8");
  for (const rule of ["readableTaskSql(can)", "canReadRounds(", "selfInspectionAccess(", "responsibleUserId: ctx.user.id", "organizationId: ctx.organizationId", "t.\"organizationId\" = ${ctx.organizationId}"])
    assert.ok(server.includes(rule), rule);
  const home = readFileSync("features/workflow/native-home.tsx", "utf8");
  assert.ok(home.includes("myDayTiles.length ? `/api/my-day?tiles="), "no read when none of the tiles is on Hem");
  assert.equal(myDayJobHref("a b", "WORK_ORDER"), "/?view=workflow_task&taskId=a%20b&taskType=WORK_ORDER");
  assert.ok(home.includes("const jobHref = (id: string, kind: string) => `/?view=workflow_task&taskId=${encodeURIComponent(id)}&taskType=${encodeURIComponent(kind)}`;"), "the same link as Fortsätt");
});
