import assert from "node:assert/strict";
import test from "node:test";
import { WORK_ITEM_FILTERS } from "../lib/workflow/work-items";
import {
  compareWork, defaultWorkListView, isMyProject, isMyWork, listWork, parseWorkListPrefs, PROJECT_LIST_FILTERS, projectListTab, resolveWorkListScope,
  workListCountsAllowed, workListPrefKey, workListScopes, workStateMatches, type WorkState,
} from "../lib/workflow/work-list";

const entry = (id: string, extra: Partial<{ title: string; updatedAt: string; date: string; mine: boolean; state: WorkState; status: string; search: string[] }> = {}) => ({
  id, title: `Uppgift ${id}`, updatedAt: `2026-10-0${id}T08:00:00.000Z`, date: "", mine: true, state: "planned" as WorkState, status: "PLANNED", search: [`Uppgift ${id}`], ...extra,
});

test("work lists: scopes follow read permission and a remembered scope is kept only when allowed", () => {
  assert.deepEqual(workListScopes({ canReadArea: true }), ["mine", "all"]);
  assert.deepEqual(workListScopes({ canReadArea: false }), ["mine"], "without read permission only Mina, never an empty choice");
  assert.equal(resolveWorkListScope("all", ["mine", "all"]), "all");
  assert.equal(resolveWorkListScope("all", ["mine"]), "mine", "a remembered Alla falls back when the permission is gone");
  assert.equal(resolveWorkListScope("team", ["mine", "all"]), "mine", "Teamets is not offered");
  assert.equal(resolveWorkListScope(undefined, ["mine", "all"]), "mine");
});

test("work lists: filter counts are team aggregates in Alla and only an admin gets them", () => {
  assert.equal(workListCountsAllowed("mine", false), true);
  assert.equal(workListCountsAllowed("all", false), false);
  assert.equal(workListCountsAllowed("all", true), true);
  const page = listWork([entry("1"), entry("2", { mine: false })], { filters: WORK_ITEM_FILTERS, matches: workStateMatches, filter: "all", scope: "all", sort: "updated", q: "", page: 1, counts: false });
  assert.equal(page.counts, null);
  assert.equal(page.total, 2, "the page total stays so the list can page");
});

test("work lists: Mina is assigned to me, or created by me when nobody is assigned", () => {
  assert.equal(isMyWork({ assignedToUserId: "me", createdBy: "other" }, "me"), true);
  assert.equal(isMyWork({ assignedToUserId: null, createdBy: "me" }, "me"), true);
  assert.equal(isMyWork({ assignedToUserId: "other", createdBy: "me" }, "me"), false, "created by me but given to someone else is theirs");
  assert.equal(isMyWork({ assignedToUserId: null, createdBy: null }, ""), false, "no person, nothing is mine");
  assert.equal(isMyProject({ responsibleUserId: "me" }, "me"), true);
  assert.equal(isMyProject({ responsibleUserId: "other", createdBy: "me" }, "me"), true);
  assert.equal(isMyProject({ responsibleUserId: "other", createdBy: "other" }, "me", true), true, "work assigned in the project");
  assert.equal(isMyProject({ responsibleUserId: "other", createdBy: "other" }, "me"), false);
});

test("work lists: sorting by change, nearest date (undated last) and name", () => {
  const items = [
    entry("1", { title: "Öljett", date: "2026-11-01" }), entry("2", { title: "ankare", date: "" }), entry("3", { title: "Bärling", date: "2026-10-20" }),
  ];
  assert.deepEqual([...items].sort(compareWork("updated")).map((item) => item.id), ["3", "2", "1"]);
  assert.deepEqual([...items].sort(compareWork("due")).map((item) => item.id), ["3", "1", "2"]);
  assert.deepEqual([...items].sort(compareWork("title")).map((item) => item.id), ["2", "3", "1"], "Swedish order, case-insensitive: Ö last");
});

test("work lists: scope, search, filter, counts and pages in memory as on the server", () => {
  const entries = [
    entry("1"), entry("2", { mine: false, state: "active", status: "IN_PROGRESS" }), entry("3", { state: "done", status: "COMPLETED", search: ["Uppgift 3", "Nollpunkten Fastigheter AB"] }),
    entry("4", { mine: false, state: "active", status: "NEEDS_ACTION" }),
  ];
  const input = { filters: WORK_ITEM_FILTERS, matches: workStateMatches, sort: "updated" as const, q: "", page: 1 };
  const mine = listWork(entries, { ...input, filter: "all", scope: "mine" });
  assert.deepEqual(mine.items.map((item) => item.id), ["3", "1"]);
  assert.deepEqual(mine.counts, { open: 1, active: 0, planned: 1, action: 0, blocked: 0, overdue: 0, late_start: 0, done: 1, cancelled: 0, all: 2 });
  const all = listWork(entries, { ...input, filter: "open", scope: "all" });
  assert.deepEqual(all.items.map((item) => item.id), ["4", "2", "1"]);
  assert.equal(all.counts?.action, 1);
  assert.deepEqual(listWork(entries, { ...input, filter: "all", scope: "all", q: "nollpunkten" }).items.map((item) => item.id), ["3"]);
  const many = Array.from({ length: 30 }, (_, index) => entry(String(index), { updatedAt: `2026-09-01T${String(index % 24).padStart(2, "0")}:${String(index).padStart(2, "0")}:00.000Z` }));
  const third = listWork(many, { ...input, filter: "all", scope: "mine", page: 3 });
  assert.equal(third.items.length, 6);
  assert.equal(third.pages, 3);
  const firstTwo = listWork(many, { ...input, filter: "all", scope: "mine", limit: 24 });
  assert.equal(firstTwo.items.length, 24, "Local shows more by raising the limit");
});

test("work lists: projects by lifecycle tab", () => {
  assert.equal(projectListTab({ archivedAt: null, closedAt: null }), "ongoing");
  assert.equal(projectListTab({ archivedAt: null, closedAt: "2026-10-01" }), "closed");
  assert.equal(projectListTab({ archivedAt: "2026-10-02", closedAt: "2026-10-01" }), "archived");
  const projects = [{ ...entry("1"), tab: "ongoing" }, { ...entry("2"), tab: "archived" }, { ...entry("3", { mine: false }), tab: "ongoing" }];
  const page = listWork(projects, { filters: PROJECT_LIST_FILTERS, matches: (item, tab) => item.tab === tab, filter: "ongoing", scope: "all", sort: "updated", q: "", page: 1 });
  assert.deepEqual(page.items.map((item) => item.id), ["3", "1"]);
  assert.deepEqual(page.counts, { ongoing: 2, closed: 0, archived: 1 });
});

test("work lists: remembered choices per person and list, and the first view per device", () => {
  assert.equal(workListPrefKey("projects", "user-1"), "hintek.work-list.projects.user-1");
  assert.notEqual(workListPrefKey("tasks", "user-1"), workListPrefKey("tasks", "user-2"));
  assert.deepEqual(parseWorkListPrefs(JSON.stringify({ view: "cards", scope: "all", sort: "due" })), { view: "cards", scope: "all", sort: "due" });
  assert.deepEqual(parseWorkListPrefs(JSON.stringify({ view: "grid", scope: "team", sort: 3 })), {}, "unknown values are dropped");
  assert.deepEqual(parseWorkListPrefs("not json"), {});
  assert.deepEqual(parseWorkListPrefs(null), {});
  assert.equal(defaultWorkListView("desktop"), "rows");
  assert.equal(defaultWorkListView("tablet"), "cards");
  assert.equal(defaultWorkListView("phone"), "cards");
});
