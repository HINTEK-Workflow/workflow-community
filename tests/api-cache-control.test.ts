import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import { getPathMatch } from "next/dist/shared/lib/router/utils/path-match";
import nextConfig from "../next.config";

// S3 (review 2026-10-20): every /api/ answer carries "Cache-Control: private, no-store", set once in next.config.ts. A
// header there replaces the route's own (next/dist/server/send-response.js keeps the first value), so the routes that
// choose their own caching are left out of the rule – and only those.

async function cacheRule() {
  const rules = await nextConfig.headers!();
  const rule = rules.find((entry) => entry.headers.some((header) => header.key === "Cache-Control"));
  assert.ok(rule, "next.config.ts sets Cache-Control");
  assert.deepEqual(rule.headers, [{ key: "Cache-Control", value: "private, no-store" }]);
  const match = getPathMatch(rule.source);
  return (pathname: string) => match(pathname) !== false;
}

function routeFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const full = path.join(dir, name);
    return statSync(full).isDirectory() ? routeFiles(full) : name === "route.ts" ? [full] : [];
  });
}

test("every API answer with customer data, sessions or downloads gets private, no-store", async () => {
  const covered = await cacheRule();
  for (const pathname of ["/api/workspace", "/api/records", "/api/workflow-tasks", "/api/projects", "/api/work-orders", "/api/profile",
    "/api/cloud-workspace/export", "/api/quotes/export", "/api/workflow-tasks/snapshot-report", "/api/files/abc", "/api/health/ready"])
    assert.ok(covered(pathname), `${pathname} is covered`);
  assert.equal(covered("/"), false, "pages are not touched");
  assert.equal(covered("/kunder"), false);
});

test("the routes that set their own caching keep it, and no other route sets one", async () => {
  const covered = await cacheRule();
  for (const pathname of ["/api/mailing-images/k1", "/api/map/status", "/api/map/tiles/1/2/3", "/api/places/qr", "/api/product-image", "/api/workflow-tasks/live", "/api/oauth/token", "/api/oauth/register"])
    assert.equal(covered(pathname), false, `${pathname} keeps its own Cache-Control`);
  // A route that sets anything but no-store must be in the exception list, or next.config.ts silently replaces it.
  const own = routeFiles("app/api").filter((file) => /Cache-Control["']?\s*:\s*["'](?![^"']*no-store)/i.test(readFileSync(file, "utf8")));
  for (const file of own) {
    const pathname = `/${path.relative("app", path.dirname(file)).split(path.sep).join("/")}`.replace(/\[([^\]]+)\]/g, "x");
    assert.equal(covered(pathname), false, `${file} sets its own Cache-Control but next.config.ts replaces it`);
  }
  assert.ok(own.length >= 5, "the scan finds the routes with their own caching");
});
