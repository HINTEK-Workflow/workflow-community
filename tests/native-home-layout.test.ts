import assert from "node:assert/strict";
import test from "node:test";
import { addableTiles, DEFAULT_HOME_TILES, HOME_NOTICE_MAX, HOME_TILE, HOME_TILE_KEYS, homeGridColumns, nativeLayoutAllowed, normalizeNativeLayout, noticeRowsThatFit, placeAt, removeTile, TAB, TAB_KEYS, type HomeTileKey } from "../lib/workflow/native-layout";
import { nativeMoreSections } from "../lib/workflow/native-mode";

// Hem without scrolling and edited in place (2026-10-21, UX-granskningen A1 and avsnitt 3–4).

test("two tiles in a row, three from seven small tiles, four on a phone held sideways", () => {
  assert.equal(homeGridColumns(4, false), 2);
  assert.equal(homeGridColumns(6, false), 2);
  assert.equal(homeGridColumns(7, false), 3);
  assert.equal(homeGridColumns(9, false), 3);
  assert.equal(homeGridColumns(2, true), 4);
  assert.equal(homeGridColumns(9, true), 4);
});

test("at most three notices, fewer when the screen is lower, and Visa alla only when some are left out", () => {
  assert.equal(HOME_NOTICE_MAX, 3);
  assert.equal(noticeRowsThatFit(1000, 52, 6), 3, "room for many: three");
  assert.equal(noticeRowsThatFit(1000, 52, 2), 2, "two notices: both, no Visa alla");
  assert.equal(noticeRowsThatFit(4 * 52, 52, 6), 3, "three rows and Visa alla");
  assert.equal(noticeRowsThatFit(4 * 52 - 1, 52, 6), 2);
  assert.equal(noticeRowsThatFit(3 * 52, 52, 3), 3, "all three fit without Visa alla");
  assert.equal(noticeRowsThatFit(52, 52, 6), 0, "only Visa alla fits");
  assert.equal(noticeRowsThatFit(0, 52, 0), 0);
  assert.equal(noticeRowsThatFit(Number.NaN, 52, 6), 3, "unmeasured: the most");
});

test("the add sheet offers only allowed tiles the person does not show", () => {
  const chosen: HomeTileKey[] = ["jobs", "new", "time"];
  assert.deepEqual(addableTiles(chosen, ["jobs", "new", "time", "ai", "rounds"]), ["ai", "rounds"]);
  assert.deepEqual(addableTiles(chosen, ["jobs"]), []);
});

test("a removed tile says where it stood, and Ångra puts it back there", () => {
  const { home, index } = removeTile(["jobs", "checkin", "new", "time"], "new");
  assert.deepEqual(home, ["jobs", "checkin", "time"]);
  assert.equal(index, 2);
  assert.deepEqual(placeAt(home, "new", index), ["jobs", "checkin", "new", "time"]);
});

test("a member without rights to read jobs is never offered the jobs or rounds tiles", () => {
  const member = nativeLayoutAllowed({ memberRole: "MEMBER", workflowPermissions: { version: 1, grants: [] }, ai: false });
  assert.ok(!member.allowedHome.includes("jobs"));
  assert.ok(!member.allowedHome.includes("rounds"));
  assert.ok(!member.allowedHome.includes("ai"));
  const owner = nativeLayoutAllowed({ memberRole: "OWNER", workflowPermissions: { version: 1, grants: [] }, ai: true });
  for (const key of DEFAULT_HOME_TILES) assert.ok(owner.allowedHome.includes(key), key);
});

test("Mer has a row that opens the edit mode on Hem, for whoever does not hold a tile", () => {
  const rows = nativeMoreSections([]).flatMap((section) => section.rows);
  const row = rows.find((item) => item.key === "home_edit");
  assert.ok(row);
  assert.equal(row.href, "/?view=stats&edit=home");
  assert.equal(row.label, "Redigera hemskärmen");
});

// Point 5 (2026-10-23): Jobb is the one job list, so the Arbetsorder tile and the Order tab are no choices any more;
// a layout saved with them reads as Jobb (once).
test("the old Arbetsorder tile and Order tab are read as Jobb", () => {
  assert.ok(!(HOME_TILE_KEYS as readonly string[]).includes("work_orders"));
  assert.ok(!(TAB_KEYS as readonly string[]).includes("work_orders"));
  assert.deepEqual(normalizeNativeLayout({ home: ["work_orders", "time"], tabs: ["home", "work_orders", "time"] }), { home: ["jobs", "time"], tabs: ["home", "jobs", "time"] });
  assert.deepEqual(normalizeNativeLayout({ home: ["jobs", "work_orders"], tabs: ["jobs", "work_orders"] }), { home: ["jobs"], tabs: ["jobs"] }, "no doubles");
  assert.equal(HOME_TILE.planning.hint, "Teamets vecka");
  assert.equal(TAB.planning.hint, "Teamets vecka");
});

// After the test on an iPhone (2026-10-24): Hem fits a low screen too, a page that fits does not bounce, and a tile
// in Mer closes the sheet also when it leads to the page already open.
test("Hem fits a low screen, a page that fits does not bounce, and a tile in Mer closes the sheet", async () => {
  const { readFileSync } = await import("node:fs");
  const css = readFileSync("app/globals.css", "utf8");
  const low = css.slice(css.indexOf("@media (max-height: 620px) {"));
  assert.ok(low.includes("flex-direction: row") && low.indexOf("}\n}") > 0, "the small tiles lie down on a low screen");
  assert.ok(css.includes("html[data-native][data-fits], html[data-native][data-fits] body { overscroll-behavior-y: none; }"), "no bounce where the page fits");
  assert.ok(readFileSync("components/app-shell.tsx", "utf8").includes("root.dataset.fits"), "the shell marks a page that fits");
  assert.ok(readFileSync("components/native/tab-bar.tsx", "utf8").includes('onClick: () => { markOpenedFromSheet("more"); setOpen(null); } }))}'), "a tile closes Mer");
});
