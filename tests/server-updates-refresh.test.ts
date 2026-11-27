import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

// Servrar och uppdateringar läses om av sig själv (2026-11-26): the badge changes without reloading the window, the page
// reads only while the tab is visible, and the route still checks the superadmin on every read.

const page = readFileSync("features/workflow/server-updates.tsx", "utf8");

test("the server cards read again by themselves while the tab is visible, never while hidden", () => {
  assert.match(page, /export const SERVER_UPDATES_POLL_MS = 30_000;/);
  assert.match(page, /window\.setInterval\(again, SERVER_UPDATES_POLL_MS\)/);
  assert.match(page, /const again = \(\) => \{ if \(document\.visibilityState === "visible"\) void load\(true\); \};/, "a hidden tab does not read");
  assert.match(page, /document\.addEventListener\("visibilitychange", again\)/, "read at once when the tab is shown again");
  assert.match(page, /window\.clearInterval\(timer\); document\.removeEventListener\("visibilitychange", again\)/, "stopped when the page closes");
});

test("a background read keeps the cards and the button calm, and an older read never overwrites a newer one", () => {
  assert.match(page, /if \(!quiet\) setState\("loading"\)/);
  assert.match(page, /if \(controller\.signal\.aborted \|\| quiet\) return;/, "an error in the background leaves the last answer");
  assert.match(page, /reading\.current\?\.abort\(\);/);
  assert.match(page, /onClick=\{\(\) => void load\(\)\}/, "Läs igen still reads with its own state");
});

test("the route still refuses everyone but the superadmin, and is never cached", () => {
  const route = readFileSync("app/api/superadmin/server-updates/route.ts", "utf8");
  assert.match(route, /const access = serverStatusAccess\(auth\?\.user \?\? null\);\n\s*if \(!access\.ok\) throw new ApiError\(access\.status, access\.message\);/);
  assert.match(route, /"Cache-Control": "private, no-store"/);
});
