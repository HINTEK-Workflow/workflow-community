import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import test from "node:test";
import {
  CHECK_CACHE_MS, CHECK_TIMEOUT_MS, describeAge, newerRelease, parseReleases, resolveUpdateCheckSetting, shouldFetch, updateCheckAvailable, versionAge,
} from "../lib/updates/version-check";
import { RELEASE_NOTES } from "../lib/release-notes";

// Besked om uppdateringar i Community (kvalitetsmålen K4.8, 2026-11-28): the version's age, the list of releases, and the
// switch that is off from the start and never on in Cloud.
const NOTES = [
  { version: "0.90.0", date: "2026-11-27", summary: "", items: [] },
  { version: "0.80.0", date: "2026-11-23", summary: "", items: [] },
];
const release = (tag: string, extra: Record<string, unknown> = {}) => ({
  tag_name: tag, html_url: `https://github.com/Workflow-Workflow/workflow-community/releases/tag/${tag}`, draft: false, prerelease: false,
  published_at: "2026-11-28T00:30:00Z", ...extra,
});

test("the running version's age comes from its own day in the release notes, in whole days", () => {
  assert.deepEqual(versionAge("0.90.0", new Date("2026-11-27T23:59:00Z"), NOTES), { version: "0.90.0", releasedOn: "2026-11-27", days: 0 });
  assert.deepEqual(versionAge("0.80.0", new Date("2026-11-28T08:00:00Z"), NOTES), { version: "0.80.0", releasedOn: "2026-11-23", days: 5 });
  assert.equal(versionAge("0.1.0", new Date("2026-11-28T08:00:00Z"), NOTES), null, "no note, no age");
  assert.equal(versionAge("0.90.0", new Date("2026-11-01T00:00:00Z"), NOTES)?.days, 0, "a clock behind the note is never negative");
  // Every real note has a day the age can be read from.
  for (const note of RELEASE_NOTES) assert.ok(versionAge(note.version, new Date(), RELEASE_NOTES), note.version);
});

test("the age reads naturally in Swedish", () => {
  assert.equal(describeAge(0), "från i dag");
  assert.equal(describeAge(1), "1 dag gammal");
  assert.equal(describeAge(12), "12 dagar gammal");
  assert.equal(describeAge(95), "3 månader gammal");
  assert.equal(describeAge(800), "2 år gammal");
});

test("the release list: published vX.Y.Z only, links on the repository's own pages, newest first, nothing else trusted", () => {
  const parsed = parseReleases([
    release("v0.89.0"), release("v0.91.0"), release("v0.90.0"),
    release("v0.92.0", { draft: true }), release("v0.93.0", { prerelease: true }),
    release("app-1.0.0"), release("v0.94.0-rc1"),
    release("v0.95.0", { html_url: "https://evil.example/releases/tag/v0.95.0" }),
    release("v0.96.0", { html_url: "https://github.com/someone/else/releases/tag/v0.96.0" }),
    release("v0.91.0", { published_at: "not a date" }), null, "text", 7,
  ]);
  assert.deepEqual(parsed.map((item) => item.version), ["0.91.0", "0.90.0", "0.89.0"]);
  assert.equal(parsed[0].url, "https://github.com/Workflow-Workflow/workflow-community/releases/tag/v0.91.0");
  assert.equal(parsed[0].publishedAt, "2026-11-28T00:30:00.000Z");
  assert.equal(parseReleases(release("v1.0.0") as unknown).length, 0, "an object is no list");
  assert.deepEqual(parseReleases({ message: "API rate limit exceeded" }), []);
  assert.deepEqual(parseReleases(null), []);
  assert.equal(newerRelease("0.90.0", parsed)?.version, "0.91.0");
  assert.equal(newerRelease("0.91.0", parsed), null);
  assert.equal(newerRelease("0.100.0", parsed), null, "numbers, not text");
  assert.equal(newerRelease("0.90.0", []), null);
});

test("Kontrollera nya versioner is off from the start: only an explicit true turns it on", () => {
  for (const stored of [undefined, null, {}, [], "true", { enabled: "true" }, { enabled: 1 }, { enabled: false }]) assert.deepEqual(resolveUpdateCheckSetting(stored), { enabled: false }, JSON.stringify(stored));
  assert.deepEqual(resolveUpdateCheckSetting({ enabled: true }), { enabled: true });
});

test("only Community offers it; the server asks at most once a day and never when it is off or in Cloud", () => {
  assert.equal(updateCheckAvailable(false), true, "Community (no ee/)");
  assert.equal(updateCheckAvailable(true), false, "Cloud never");
  const now = new Date("2026-11-28T12:00:00Z");
  assert.equal(shouldFetch({ available: true, enabled: false, lastCheckedAt: null, now }), false, "off: never");
  assert.equal(shouldFetch({ available: false, enabled: true, lastCheckedAt: null, now }), false, "Cloud: never, whatever is stored");
  assert.equal(shouldFetch({ available: true, enabled: true, lastCheckedAt: null, now }), true);
  assert.equal(shouldFetch({ available: true, enabled: true, lastCheckedAt: now.getTime() - CHECK_CACHE_MS + 1000, now }), false, "cached a day");
  assert.equal(shouldFetch({ available: true, enabled: true, lastCheckedAt: now.getTime() - CHECK_CACHE_MS, now }), true);
  assert.equal(CHECK_CACHE_MS, 86_400_000);
  assert.ok(CHECK_TIMEOUT_MS <= 10_000, "a short time limit");
});

test("the check runs on the server only, without anything about the installation, behind a superadmin route", () => {
  const server = readFileSync("lib/updates/version-check-server.ts", "utf8");
  assert.match(server, /^import "server-only";/);
  assert.match(server, /updateCheckAvailable\(EE_PRESENT\)/);
  assert.match(server, /AbortSignal\.timeout\(CHECK_TIMEOUT_MS\)/);
  assert.match(server, /"https:\/\/api\.github\.com\/repos\/Workflow-Workflow\/workflow-community\/releases\?per_page=20"/);
  // No version, address, name or id of the installation goes out: a fixed URL and a generic User-Agent.
  assert.doesNotMatch(server, /RELEASES_URL\s*\+|`\$\{RELEASES_URL\}|instanceAppUrl|INSTANCE_NAME|organizationId/);
  // The browser never calls GitHub: no client file names the host.
  for (const file of ["features/workflow/update-check.tsx", "lib/updates/version-check.ts", "features/kfid/workspace.tsx"])
    assert.doesNotMatch(readFileSync(file, "utf8"), /api\.github\.com/, file);
  const route = readFileSync("app/api/superadmin/update-check/route.ts", "utf8");
  assert.match(route, /user\.role !== "SUPERADMIN"/);
  assert.match(route, /checkOrigin\(request\)/);
  assert.match(route, /if \(!before\.available\) throw new ApiError\(404/);
  assert.match(route, /administrationEvent\.create/);
  // Om Workflow shows the age to everyone and the switch to the Community administrator only.
  const workspace = readFileSync("features/kfid/workspace.tsx", "utf8");
  assert.match(workspace, /data-testid="app-version-age"/);
  assert.match(workspace, /instance\.community && !demo && user\?\.role === "SUPERADMIN" && !user\.viewAs \? <UpdateCheck \/>/);
});

test("SECURITY.md states the support policy in both languages (K4.4)", () => {
  // In the repo the file is the Community overlay; in the exported core it is SECURITY.md at the root.
  const policy = readFileSync(existsSync("community/overlay/SECURITY.md") ? "community/overlay/SECURITY.md" : "SECURITY.md", "utf8");
  for (const rule of [/### Supportpolicy/, /### Support policy/,
    /kan uppgraderas gratis till den senaste/, /can be upgraded free of charge to the latest/,
    /provas från alla versioner från de senaste fem åren/, /tested from every version of the last five years/,
    /görs i den senaste versionen/, /made in the latest version/,
    /inom 7 dagar/, /within 7 days/, /inom 30 dagar/, /within 30 days/,
    /Kontrollera nya versioner/, /av från början/, /off by default/])
    assert.match(policy, rule);
});
