import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  clearWorkspaceCache, currentWorkspaceCacheScope, enterWorkspaceCacheScope, invalidateWorkspaceCache, readWorkspaceCache, resetWorkspaceCacheForTests,
  noteWorkspaceChange, sealWorkspaceCache, subscribeWorkspaceCache, takeWorkspaceChange, WORKSPACE_CACHE_FRESH_MS, WORKSPACE_CACHE_LIMIT, workspaceCacheNeedsRead, workspaceCacheScope, workspaceCacheSize, writeWorkspaceCache,
} from "../lib/workflow/workspace-cache";

// Stabil sidladdning steg 7 (2026-10-22/23, beslut 4): the tab's memory cache is strictly per company and person,
// emptied on sign-out, a company switch, Visa som and changed permissions, and never kept on the server.
const browser = globalThis as { window?: unknown };
function inBrowser(run: () => void) {
  const before = browser.window;
  browser.window = globalThis;
  resetWorkspaceCacheForTests();
  try { run(); } finally { resetWorkspaceCacheForTests(); if (before === undefined) delete browser.window; else browser.window = before; }
}
const anna = { id: "u-anna", organizationId: "org-a", viewAs: null, role: "USER", memberRole: "MEMBER", workflowPermissions: { tasks: ["read"] } };
const bertil = { id: "u-bertil", organizationId: "org-b", viewAs: null, role: "USER", memberRole: "OWNER", workflowPermissions: { tasks: ["read", "write"] } };

test("the scope is the person, the company, Visa som, the role and the permissions", () => {
  const scope = workspaceCacheScope(anna);
  assert.equal(scope, workspaceCacheScope({ ...anna }));
  assert.notEqual(scope, workspaceCacheScope({ ...anna, organizationId: "org-b" }));
  assert.notEqual(scope, workspaceCacheScope({ ...anna, id: "u-other" }));
  assert.notEqual(scope, workspaceCacheScope({ ...anna, viewAs: "member" }));
  assert.notEqual(scope, workspaceCacheScope({ ...anna, memberRole: "ADMIN" }));
  assert.notEqual(scope, workspaceCacheScope({ ...anna, workflowPermissions: { tasks: [] } }));
  // Without a person nothing is kept at all.
  assert.equal(workspaceCacheScope(null), null);
  assert.equal(workspaceCacheScope({ ...anna, id: undefined }), null);
});

test("an answer is read back only in its own scope, and another scope empties the cache", () => inBrowser(() => {
  const a = workspaceCacheScope(anna)!;
  const b = workspaceCacheScope(bertil)!;
  enterWorkspaceCacheScope(a);
  assert.equal(writeWorkspaceCache(a, "/api/work-items?scope=all", { items: ["anna-task"] }), true);
  assert.deepEqual(readWorkspaceCache(a, "/api/work-items?scope=all")?.value, { items: ["anna-task"] });
  // Another person's scope never sees it, even before it is entered.
  assert.equal(readWorkspaceCache(b, "/api/work-items?scope=all"), undefined);
  enterWorkspaceCacheScope(b);
  assert.equal(workspaceCacheSize(), 0);
  assert.equal(readWorkspaceCache(a, "/api/work-items?scope=all"), undefined);
  // A late answer for the scope that left is thrown away.
  assert.equal(writeWorkspaceCache(a, "/api/work-items?scope=all", { items: ["late"] }), false);
  assert.equal(workspaceCacheSize(), 0);
  // Entering the same scope again changes nothing.
  writeWorkspaceCache(b, "/api/quotes", { items: [] });
  enterWorkspaceCacheScope(b);
  assert.equal(workspaceCacheSize(), 1);
}));

test("Visa som and changed permissions are scopes of their own", () => inBrowser(() => {
  const own = workspaceCacheScope(anna)!;
  enterWorkspaceCacheScope(own);
  writeWorkspaceCache(own, "/api/records?kind=customers", { items: ["kund"] });
  enterWorkspaceCacheScope(workspaceCacheScope({ ...anna, viewAs: "member" }));
  assert.equal(workspaceCacheSize(), 0);
  const fewer = workspaceCacheScope({ ...anna, workflowPermissions: {} })!;
  enterWorkspaceCacheScope(fewer);
  assert.equal(currentWorkspaceCacheScope(), fewer);
  assert.equal(readWorkspaceCache(own, "/api/records?kind=customers"), undefined);
  // Teamet and Ekonomi (2026-10-28) are grants like any other: granting or taking one is a scope of its own.
  const plain = workspaceCacheScope({ ...anna, workflowPermissions: { version: 1, grants: ["projects:read"] } });
  assert.notEqual(workspaceCacheScope({ ...anna, workflowPermissions: { version: 1, grants: ["projects:read", "team:read"] } }), plain);
  assert.notEqual(workspaceCacheScope({ ...anna, workflowPermissions: { version: 1, grants: ["projects:read", "economy:read"] } }), plain);
}));

test("sign-out and a company switch seal the cache until the page loads again; clear only empties it", () => inBrowser(() => {
  const a = workspaceCacheScope(anna)!;
  enterWorkspaceCacheScope(a);
  writeWorkspaceCache(a, "/api/time", { tasks: [] });
  clearWorkspaceCache();
  assert.equal(workspaceCacheSize(), 0);
  assert.equal(currentWorkspaceCacheScope(), null);
  enterWorkspaceCacheScope(a);
  assert.equal(writeWorkspaceCache(a, "/api/time", { tasks: [] }), true);
  sealWorkspaceCache();
  assert.equal(workspaceCacheSize(), 0);
  enterWorkspaceCacheScope(a);
  assert.equal(currentWorkspaceCacheScope(), null);
  assert.equal(writeWorkspaceCache(a, "/api/time", { tasks: [] }), false);
  assert.equal(readWorkspaceCache(a, "/api/time"), undefined);
}));

test("nothing is ever kept on the server, where the module is shared by every request", () => {
  resetWorkspaceCacheForTests();
  assert.equal(typeof (globalThis as { window?: unknown }).window, "undefined");
  const a = workspaceCacheScope(anna)!;
  enterWorkspaceCacheScope(a);
  assert.equal(writeWorkspaceCache(a, "/api/work-items", { items: ["x"] }), false);
  assert.equal(readWorkspaceCache(a, "/api/work-items"), undefined);
  resetWorkspaceCacheForTests();
});

test("invalidate marks answers stale and tells the views; fresh answers are not read twice", () => inBrowser(() => {
  const a = workspaceCacheScope(anna)!;
  enterWorkspaceCacheScope(a);
  writeWorkspaceCache(a, "/api/work-items?scope=mine", 1, 1_000);
  writeWorkspaceCache(a, "/api/quotes?filter=open", 2, 1_000);
  assert.equal(workspaceCacheNeedsRead(readWorkspaceCache(a, "/api/work-items?scope=mine"), 1_000 + WORKSPACE_CACHE_FRESH_MS - 1), false);
  assert.equal(workspaceCacheNeedsRead(readWorkspaceCache(a, "/api/work-items?scope=mine"), 1_000 + WORKSPACE_CACHE_FRESH_MS), true);
  assert.equal(workspaceCacheNeedsRead(undefined), true);
  const told: (string | null)[] = [];
  const stop = subscribeWorkspaceCache((prefix) => told.push(prefix));
  invalidateWorkspaceCache("/api/work-items");
  assert.equal(readWorkspaceCache(a, "/api/work-items?scope=mine")?.stale, true);
  assert.equal(readWorkspaceCache(a, "/api/quotes?filter=open")?.stale, false);
  // A stale answer is still shown (stale-while-revalidate) but always read again.
  assert.equal(readWorkspaceCache(a, "/api/work-items?scope=mine")?.value, 1);
  assert.equal(workspaceCacheNeedsRead(readWorkspaceCache(a, "/api/work-items?scope=mine"), 1_001), true);
  invalidateWorkspaceCache();
  assert.deepEqual(told, ["/api/work-items", null]);
  assert.equal(readWorkspaceCache(a, "/api/quotes?filter=open")?.stale, true);
  stop();
  invalidateWorkspaceCache();
  assert.equal(told.length, 2);
}));

test("the cache is bounded: the oldest answer goes first", () => inBrowser(() => {
  const a = workspaceCacheScope(anna)!;
  enterWorkspaceCacheScope(a);
  for (let index = 0; index <= WORKSPACE_CACHE_LIMIT; index += 1) writeWorkspaceCache(a, `/api/records?page=${index}`, index);
  assert.equal(workspaceCacheSize(), WORKSPACE_CACHE_LIMIT);
  assert.equal(readWorkspaceCache(a, "/api/records?page=0"), undefined);
  assert.equal(readWorkspaceCache(a, `/api/records?page=${WORKSPACE_CACHE_LIMIT}`)?.value, WORKSPACE_CACHE_LIMIT);
}));

test("the cache lives only in memory and goes with every way out", () => {
  const withoutComments = (text: string) => text.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
  const source = withoutComments(readFileSync("lib/workflow/workspace-cache.ts", "utf8") + readFileSync("features/kfid/use-workspace-data.ts", "utf8"));
  assert.doesNotMatch(source, /localStorage|sessionStorage|indexedDB|caches\.open|serviceWorker/);
  assert.match(readFileSync("features/auth/sign-out.ts", "utf8"), /sealWorkspaceCache\(\);/);
  assert.match(readFileSync("features/kfid/administration.tsx", "utf8"), /sealWorkspaceCache\(\);\s*\n\s*if \(await perform\(\{ action: "switch"/);
  assert.match(readFileSync("features/workflow/view-as-panel.tsx", "utf8"), /clearWorkspaceCache\(\);/);
  assert.match(readFileSync("components/app-shell.tsx", "utf8"), /api\/view-as[^\n]*\n\s*clearWorkspaceCache\(\);/);
  const workspace = readFileSync("features/kfid/workspace.tsx", "utf8");
  assert.match(workspace, /enterWorkspaceCacheScope\(dataScope\)/);
  assert.match(workspace, /<WorkspaceDataScope scope=\{dataScope\}>/);
  // P7 (steg 8b): the overview is read again only for a new person, company, Visa som or permissions – not for every new user object.
  assert.match(workspace, /\}, \[overviewFor\]\);/);
});

test("a list read again from its first page keeps the pages Visa fler had added", async () => {
  const { keepLoadedPages } = await import("../features/kfid/use-workspace-data");
  const shown = { items: [{ id: "a" }, { id: "b" }, { id: "c" }, { id: "d" }], page: 2, total: 5 };
  const fresh = { items: [{ id: "new" }, { id: "a" }], page: 1, total: 5 };
  assert.deepEqual(keepLoadedPages(fresh, shown), { items: [{ id: "new" }, { id: "a" }, { id: "c" }, { id: "d" }], page: 2, total: 5 });
  // Nothing more shown than the fresh page: the fresh page as it is.
  assert.equal(keepLoadedPages(fresh, { items: [{ id: "a" }], page: 1, total: 1 }), fresh);
});

test("a change marks what is kept stale and makes the next page read the overview once; the person's own choices do not", async () => inBrowser(() => {
  const a = workspaceCacheScope(anna)!;
  enterWorkspaceCacheScope(a);
  writeWorkspaceCache(a, "/api/quotes", 1);
  assert.equal(takeWorkspaceChange(), false);
  noteWorkspaceChange();
  assert.equal(readWorkspaceCache(a, "/api/quotes")?.stale, true);
  assert.equal(takeWorkspaceChange(), true);
  assert.equal(takeWorkspaceChange(), false, "taken once");
  const api = readFileSync("features/kfid/api.ts", "utf8");
  assert.match(api, /if \(change && !\["GET", "HEAD"\]\.includes/);
  assert.match(api, /PERSONAL_ACTIONS = new Set\(\["preferences", "advisor", "tour"\]\)/);
  const workspace = readFileSync("features/kfid/workspace.tsx", "utf8");
  assert.match(workspace, /if \(takeWorkspaceChange\(\)\) queueMicrotask\(\(\) => void refresh\(\)\);/);
}));
