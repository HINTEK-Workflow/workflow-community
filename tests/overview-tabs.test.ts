import assert from "node:assert/strict";
import test from "node:test";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { normalizeWorkflowPermissionProfile } from "../lib/workflow/permissions";
import { WORK_VIEWS } from "../lib/workflow/work-view";
import { OVERVIEW_TABS, narrowedTabs, overviewChip, overviewStartTab, overviewTabs, shownOverviewTabs, type OverviewTabAccess } from "../lib/overview/tabs";
import { meChip, PLAN_KINDS, planMonth } from "../lib/overview/me";
import { buildPlan, notDoneSummary, weekSummary } from "../lib/overview/me-plan";
import type { ScheduleView } from "../lib/workflow/form-schedule";
import { swedishMonday } from "../lib/swedish-time";
import { viewAsViewer } from "../lib/workflow/view-as";

// Översikten (dashboard etapp 6–7, 2026-10-28): the tab matrix, the start tab by work view (never a grant), Min plan
// from real sources only, and no fictional data in shipped code.

const viewer = (admin: boolean, grants: string[] = []) => ({ admin, workflowPermissions: normalizeWorkflowPermissionProfile({ version: 1, grants }) });

// ---------- the permission matrix ----------

test("the tab matrix: Jag for everyone, the rest only with their right", () => {
  assert.deepEqual(overviewTabs(viewer(true)), { me: true, team: true, economy: true, customers: true }, "owner/admin sees every tab");
  assert.deepEqual(overviewTabs(viewer(false)), { me: true, team: false, economy: false, customers: false }, "a plain member sees only Jag");
  assert.deepEqual(overviewTabs(viewer(false, ["team:read"])), { me: true, team: true, economy: false, customers: false }, "team:read gives Teamet and Statistik");
  assert.deepEqual(overviewTabs(viewer(false, ["economy:read"])), { me: true, team: false, economy: true, customers: false }, "economy:read gives Ekonomi only");
  assert.deepEqual(overviewTabs(viewer(false, ["customers:read"])), { me: true, team: false, economy: false, customers: true }, "customers:read gives Kunder");
  assert.deepEqual(overviewTabs(viewer(false, ["quotes:read", "projects:read", "work-order:read"])), { me: true, team: false, economy: false, customers: false }, "module rights never open the team or economy tabs");
  assert.deepEqual(shownOverviewTabs(overviewTabs(viewer(true))), [...OVERVIEW_TABS], "the tabs keep one fixed order");
});

// ---------- the start tab ----------

test("the work view chooses the start tab but never grants one", () => {
  const all = overviewTabs(viewer(true));
  const member = overviewTabs(viewer(false));
  assert.equal(overviewStartTab(all, "supervisor"), "team", "Arbetsledning opens on Teamet when allowed");
  assert.equal(overviewStartTab(member, "supervisor"), "me", "Arbetsledning without team:read falls back to Jag");
  assert.equal(overviewStartTab(all, "fitter"), "me");
  assert.equal(overviewStartTab(all, "lead"), "me");
  assert.equal(overviewStartTab(all, null), "me", "no work view: Jag");
  assert.equal(overviewStartTab(all, "fitter", "economy"), "economy", "the address wins when allowed");
  assert.equal(overviewStartTab(member, "fitter", "economy"), "me", "an address never opens a tab the person may not see");
  assert.equal(overviewStartTab(member, null, "nonsense"), "me");
  // Exhaustive: whatever the view and the address, the start tab is always one the person may see.
  const matrices: OverviewTabAccess[] = [viewer(true), viewer(false), viewer(false, ["team:read"]), viewer(false, ["economy:read"]), viewer(false, ["customers:read"])].map(overviewTabs);
  for (const access of matrices) for (const view of [...WORK_VIEWS, null]) for (const asked of [...OVERVIEW_TABS, null, "x"]) {
    assert.ok(access[overviewStartTab(access, view, asked)], `${view}/${asked} stays inside the person's tabs`);
  }
});

test("a tab's chip is the short text its answer carries, nothing invented", () => {
  assert.equal(overviewChip({ chip: "3 förfallna" }), "3 förfallna");
  assert.equal(overviewChip({ chip: 1200 }), (1200).toLocaleString("sv-SE"));
  assert.equal(overviewChip({}), null);
  // Kunder and Ekonomi: from their own figures. Teamet (2026-11-18, mobilresan): krockar and förfallna together –
  // the other groups (Hinder, Ej startat …) are not in its figure.
  const team = { riskBeforeStart: { total: 2 }, needsAction: { total: 1 }, deviations: { counts: { overdue: 1 } }, overdueJobs: { total: 2 }, absence: { affected: [{}, {}, {}] }, rounds: { late: 1 } };
  assert.equal(overviewChip(team), "7 att åtgärda", "Teamet: 3 krockar + 4 förfallna");
  assert.equal(overviewChip({ ...team, deviations: { counts: { overdue: 0 } }, overdueJobs: { total: 0 }, absence: { affected: [] }, rounds: { late: 0 } }), null, "Teamet with nothing pressing: no chip");
  assert.equal(overviewChip({ totals: { overdueWorkOrders: 4 } }), "4 förfallna");
  assert.equal(overviewChip({ totals: { overdueWorkOrders: null } }), null, "no work order right: no chip");
  assert.equal(overviewChip({ unbilled: { groups: 5 } }), "5 att fakturera");
  assert.equal(overviewChip(null), null);
  assert.equal(meChip(null), "");
  assert.equal(meChip({ count: 0, tasks: 0, rounds: 0, rows: [], href: "", tasksHref: "", roundsHref: "" }), "");
  assert.equal(meChip({ count: 2, tasks: 1, rounds: 1, rows: [], href: "", tasksHref: "", roundsHref: "" }), "2 förfallna");
});

// ---------- Min plan ----------

const round = (over: Partial<ScheduleView> & { id: string }): ScheduleView => ({
  title: `Rond ${over.id}`, active: true, assignedToUserId: "me",
  rule: { frequency: "WEEKLY", interval: 1, weekdays: [1], startDate: "2026-09-01", endDate: "", time: "07:00" },
  overview: { history: [{ date: "2026-10-19", state: "missed" }, { date: "2026-10-12", state: "not_done" }, { date: "2026-10-05", state: "done" }], today: null, upcoming: [], notDone: 1 },
  ...over,
} as unknown as ScheduleView);

test("Min plan has only the real types: work orders, rounds, activities and end dates", () => {
  const items = buildPlan({
    range: planMonth("2026-10", "2026-10-28"), today: "2026-10-28", user: { id: "me", admin: false },
    workOrders: [
      { id: "wo1", title: "Byte av central", status: "PLANNED", dueDate: "2026-10-30", plannedStartDate: "2026-10-29" },
      { id: "wo2", title: "Bokad arbetsorder", status: "PLANNED", dueDate: "2026-10-30", plannedStartDate: "" },
      { id: "wo3", title: "Sen", status: "IN_PROGRESS", dueDate: "2026-10-20", plannedStartDate: null },
      { id: "wo4", title: "Utgått", status: "CANCELLED", dueDate: "2026-10-21", plannedStartDate: null },
      { id: "wo5", title: "Nästa månad", status: "PLANNED", dueDate: "2026-11-03", plannedStartDate: null },
    ],
    activities: [
      { id: "a1", title: "Montage", status: "PLANNED", startsAt: "2026-10-26T06:00:00Z", endsAt: "2026-10-26T10:00:00Z", workflowTask: { id: "wo2", kind: "WORK_ORDER", title: "Bokad arbetsorder", status: "PLANNED" } },
      { id: "a2", title: "Utbildning", status: "PLANNED", startsAt: "2026-10-27T07:00:00Z", endsAt: "2026-10-28T15:00:00Z", workflowTask: null },
      { id: "a3", title: "Inställd", status: "CANCELED", startsAt: "2026-10-27T07:00:00Z", endsAt: "2026-10-27T08:00:00Z", workflowTask: null },
    ],
    rounds: [round({ id: "r1" }), round({ id: "other", assignedToUserId: "someone" }), round({ id: "off", active: false })],
    projects: [{ id: "p1", name: "Skolan", dueDate: "2026-10-31", closedAt: null }, { id: "p2", name: "Arkiv", dueDate: "2026-10-15", archivedAt: "2026-10-16" }],
  });
  assert.ok(items.every((item) => (PLAN_KINDS as readonly string[]).includes(item.kind)), "only the four real kinds");
  const kinds = new Set(items.map((item) => item.kind));
  assert.deepEqual([...kinds].sort(), ["activity", "milestone", "round", "work-order"]);
  assert.ok(!items.some((item) => item.id === "work-order:wo2"), "a booked work order is shown by its booking, not twice");
  const booking = items.find((item) => item.id === "activity:a1:2026-10-26");
  assert.equal(booking?.kind, "work-order", "a booking of a work order is that work order");
  assert.equal(booking?.start, "07:00");
  assert.equal(items.filter((item) => item.id.startsWith("activity:a2:")).length, 2, "an activity over two days is on both days");
  assert.ok(!items.some((item) => item.id.startsWith("activity:a3")), "a cancelled booking is left out");
  assert.equal(items.find((item) => item.id === "work-order:wo1")?.date, "2026-10-29", "a work order on its Start");
  assert.equal(items.find((item) => item.id === "work-order:wo3")?.state, "missed", "late by the list's rule");
  assert.ok(!items.some((item) => item.id === "work-order:wo4" || item.id === "work-order:wo5"), "cancelled and other months left out");
  const rounds = items.filter((item) => item.kind === "round");
  assert.ok(rounds.every((item) => item.id.startsWith("round:r1:")), "only my active rounds");
  assert.deepEqual(rounds.map((item) => item.date), ["2026-10-05", "2026-10-12", "2026-10-19", "2026-10-26"]);
  assert.deepEqual(rounds.map((item) => item.state), ["done", "not_done", "missed", "planned"]);
  assert.deepEqual(items.filter((item) => item.kind === "milestone").map((item) => item.id), ["milestone:p1"], "an archived project has no end date to show");
  const sorted = [...items].sort((a, b) => a.date.localeCompare(b.date));
  assert.deepEqual(items.map((item) => item.date), sorted.map((item) => item.date), "sorted by day");
});

test("planMonth accepts only a real month", () => {
  assert.deepEqual(planMonth("2026-02", "2026-10-28"), { month: "2026-02", from: "2026-02-01", to: "2026-02-28" });
  assert.deepEqual(planMonth("2026-13", "2026-10-28"), { month: "2026-10", from: "2026-10-01", to: "2026-10-31" });
  assert.deepEqual(planMonth("'; drop", "2026-10-28").month, "2026-10");
});

test("Ej utfört counts only my rounds; the week sums reported time against the ordinary working time", () => {
  const summary = notDoneSummary([round({ id: "r1" }), round({ id: "r2", assignedToUserId: "someone" })], { id: "me", admin: false });
  assert.equal(summary.count, 1);
  assert.deepEqual(summary.rows.map((row) => row.id), ["not-done:r1"]);
  const now = new Date("2026-10-28T12:00:00Z");
  const week = weekSummary([
    { startedAt: "2026-10-26T07:00:00Z", endedAt: "2026-10-26T11:00:00Z", durationSec: 4 * 3600 },
    { startedAt: "2026-10-28T11:00:00Z", endedAt: null, durationSec: 0 },
  ], swedishMonday(now), 2400, now);
  assert.equal(week.from, "2026-10-26");
  assert.equal(week.days.length, 7);
  assert.equal(week.reportedMinutes, 300, "4 h on Monday and the running hour today");
  assert.equal(week.days.find((day) => day.date === "2026-10-28")?.minutes, 60);
  assert.equal(week.ordinaryMinutes, 2400, "40 h is the ordinary working time, passed through, not a goal");
});

// ---------- no fictional data ----------

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return name === "node_modules" || name === "dashboard-lab" ? [] : sourceFiles(path);
    return /\.(ts|tsx)$/.test(name) ? [path] : [];
  });
}

test("no shipped code imports the design lab or its example data", () => {
  const offenders = ["app", "features", "lib", "components"].flatMap((dir) => sourceFiles(dir))
    .filter((file) => /dashboard-lab|from\s+["'][^"']*\/(plan-data|team-data|economy-data)["']/.test(readFileSync(file, "utf8")));
  assert.deepEqual(offenders, [], "the lab's fictional data (features/dashboard-lab/*data*.ts) is never shipped");
});

test("Visa som Medarbetare shows what a real worker sees: Jag only, no Kunder; the preview may only hide tabs (2026-11-06)", () => {
  const member = viewAsViewer("member");
  assert.equal(member.admin, false);
  assert.ok(!member.workflowPermissions.grants.some((grant) => grant.startsWith("customers:")), "no Kunder in the menu");
  assert.ok(member.workflowPermissions.grants.includes("work-order:read"), "the worker still does the work");
  assert.deepEqual(shownOverviewTabs(overviewTabs(member)), ["me"]);
  const real = overviewTabs({ admin: true, workflowPermissions: { version: 1, grants: [] } });
  assert.deepEqual(shownOverviewTabs(narrowedTabs(real, overviewTabs(member))), ["me"]);
  assert.deepEqual(shownOverviewTabs(narrowedTabs(overviewTabs({ admin: false, workflowPermissions: { version: 1, grants: [] } }), overviewTabs(viewAsViewer("owner")))), ["me"], "never opens a tab");
});
