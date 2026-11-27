import assert from "node:assert/strict";
import test from "node:test";
import { platformOf, proposedHomeOrder, splitAddress, splitOpenFromAddress, pullDistance, pullRefreshes, PULL_REFRESH, sameOrder, splitDetailHref, splitListView, splitOpenHref, SPLIT_OPEN_MESSAGE, isSplitFrame, SPLIT_FRAME } from "../lib/workflow/app-feel";
import { appColumnFor, nativeModeFor } from "../lib/workflow/native-mode";
import { firstFrameFor } from "../lib/workflow/first-frame";

// Appkänslan (beslutad 2026-11-23): the platform's own conventions, the tablet's app view, Hem's order and the pull that fetches.
test("platform: Android, iPhone and iPad (also the iPad that says Macintosh); a computer is neither", () => {
  assert.equal(platformOf("Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 Chrome/124 Mobile Safari/537.36"), "android");
  assert.equal(platformOf("Mozilla/5.0 (iPhone; CPU iPhone OS 17_4 like Mac OS X) AppleWebKit/605.1.15 Mobile/15E148"), "ios");
  assert.equal(platformOf("Mozilla/5.0 (iPad; CPU OS 17_4 like Mac OS X) AppleWebKit/605.1.15"), "ios");
  assert.equal(platformOf("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 Version/17.4 Safari/605.1.15", 5), "ios", "an iPad asks for the desktop site by default");
  assert.equal(platformOf("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 Version/17.4 Safari/605.1.15", 0), null, "a Mac");
  assert.equal(platformOf("Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/124"), null);
  assert.equal(platformOf(null), null);
});

test("the tablet's app view: a tablet at level 1 fills its window, a computer keeps the column, levels 2–3 are untouched", () => {
  assert.equal(nativeModeFor(1, 1180, false, true), true);
  assert.equal(appColumnFor(1, 1180, false, true), false);
  assert.equal(nativeModeFor(1, 1440, false, false), false, "a computer");
  assert.equal(appColumnFor(1, 1440, false, false), true, "a computer keeps the column");
  assert.equal(nativeModeFor(2, 1180, false, true), false);
  assert.equal(nativeModeFor(3, 820, false, true), false);
  assert.equal(nativeModeFor(1, 390, true), true, "the phone as before");
  // The server's first frame says the same for an iPad at level 1 – which is a tablet's default since 2026-11-23 – and an
  // iPad set to Lagom gets the ordinary pages, never the column.
  const ipad = { userAgent: "Mozilla/5.0 (iPad; CPU OS 17_4 like Mac OS X) AppleWebKit/605.1.15", viewportWidth: "1180", viewportHeight: "820" };
  const app = firstFrameFor({ hints: ipad, levels: { tablet: 1 }, signedIn: true });
  assert.equal(app.native, true);
  assert.equal(app.column, false);
  const first = firstFrameFor({ hints: ipad, levels: null, signedIn: true });
  assert.equal(first.native, true, "a tablet starts in the app view (produktägarens beslut 2026-11-23)");
  assert.equal(first.column, false);
  const lagom = firstFrameFor({ hints: ipad, levels: { tablet: 2 }, signedIn: true });
  assert.equal(lagom.native, false);
  assert.equal(lagom.column, false);
});

test("list and what is opened beside it: which pages are lists, and which links open in the pane", () => {
  const list = (query: string) => splitListView(new URLSearchParams(query));
  assert.equal(list("view=tasks"), "tasks");
  assert.equal(list("view=customers"), "customers");
  assert.equal(list("view=customers&customerId=c1"), null, "an opened customer is a page of its own");
  assert.equal(list("view=tasks&step=add"), null);
  assert.equal(list("view=time"), null);
  assert.equal(list(""), null, "Hem");
  assert.equal(splitDetailHref("tasks", "/?view=workflow_task&taskId=t1&taskType=WORK_ORDER"), "/?view=workflow_task&taskId=t1&taskType=WORK_ORDER");
  assert.equal(splitDetailHref("tasks", "/?view=new_task"), null, "a form is followed as usual");
  assert.equal(splitDetailHref("customers", "/?view=customers&customerId=c1"), "/?view=customers&customerId=c1");
  assert.equal(splitDetailHref("customers", "/?view=customers"), null);
  assert.equal(splitDetailHref("tasks", "https://example.com/?view=workflow_task&taskId=t1"), null, "only addresses inside Workflow");
  assert.equal(splitDetailHref("time", "/?view=workflow_task&taskId=t1"), null);
  assert.equal(splitDetailHref("tasks", null), null);
  assert.equal(isSplitFrame(SPLIT_FRAME), true);
  assert.equal(isSplitFrame("hintek-app-column-tablet"), false);
  assert.equal(splitOpenHref({ type: SPLIT_OPEN_MESSAGE, href: "/?view=project&projectId=p1" }), "/?view=project&projectId=p1");
  assert.equal(splitOpenHref({ type: SPLIT_OPEN_MESSAGE, href: "//evil.example/" }), null);
  assert.equal(splitOpenHref({ type: "other", href: "/?view=stats" }), null);
  assert.equal(splitOpenHref(null), null);
});

test("the opened thing is kept in the list's address, and only what the list itself would open is read back", () => {
  const job = "/?view=workflow_task&taskId=t1&taskType=WORK_ORDER";
  const address = splitAddress("/", "?view=tasks", job);
  assert.equal(splitListView(new URL(address, "http://local").searchParams), "tasks", "still the list");
  assert.equal(splitOpenFromAddress("tasks", new URL(address, "http://local").searchParams), job);
  assert.equal(splitAddress("/", "?view=tasks&oppnat=x", null), "/?view=tasks");
  assert.equal(splitOpenFromAddress("tasks", new URLSearchParams({ view: "tasks", oppnat: "https://example.com/?view=workflow_task&taskId=t1" })), null, "never outside Workflow");
  assert.equal(splitOpenFromAddress("tasks", new URLSearchParams({ view: "tasks", oppnat: "/?view=settings" })), null, "never another page");
  assert.equal(splitOpenFromAddress("customers", new URLSearchParams({ view: "customers", oppnat: job })), null, "never another list's thing");
});

test("Hem's order: what I am doing now, the day's lists, the shortcuts, the notices last – the same tiles", () => {
  assert.deepEqual(proposedHomeOrder(["jobs", "checkin", "new", "time", "continue", "notices"]), ["continue", "jobs", "checkin", "new", "time", "notices"]);
  assert.deepEqual(proposedHomeOrder(["team", "notices", "next", "jobs", "continue", "overdue"]), ["continue", "next", "overdue", "team", "jobs", "notices"]);
  assert.deepEqual(proposedHomeOrder([]), []);
  assert.equal(sameOrder(["a", "b"], ["a", "b"]), true);
  assert.equal(sameOrder(["a", "b"], ["b", "a"]), false, "a person's own order is theirs");
  assert.equal(sameOrder(["a"], ["a", "b"]), false);
});

test("the pull that fetches: resistance, a ceiling, and a threshold", () => {
  assert.equal(pullDistance(-20), 0);
  assert.equal(pullDistance(40), 20);
  assert.equal(pullDistance(10_000), PULL_REFRESH.max);
  assert.equal(pullRefreshes(100), false);
  assert.equal(pullRefreshes(PULL_REFRESH.threshold * 2), true);
});

