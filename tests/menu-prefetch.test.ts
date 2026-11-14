import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { MENU_PREFETCH_LIMIT, menuPrefetchHrefs } from "../lib/workflow/menu-prefetch";
import { defaultWorkflowPermissionProfile, workflowPermissionPresets } from "../lib/workflow/permissions";

// Stabil sidladdning steg 8 (2026-10-22/23): a few common views are prefetched when the menu is shown – never the
// whole menu (VPS traffic, the database) – and a click in the menu or the tab bar is answered at once by a thin line.
test("only a few common views, never the open one or a hidden one", () => {
  const all = menuPrefetchHrefs({ view: "stats", admin: true, permissions: defaultWorkflowPermissionProfile() });
  assert.ok(all.length <= MENU_PREFETCH_LIMIT && MENU_PREFETCH_LIMIT <= 6);
  assert.ok(!all.includes("/?view=stats"));
  assert.deepEqual(all.slice(0, 2), ["/?view=tasks", "/?view=projects"]);
  const hidden = menuPrefetchHrefs({ view: "tasks", hidden: ["projects", "time"], admin: true, permissions: defaultWorkflowPermissionProfile() });
  assert.deepEqual(hidden, ["/?view=stats", "/?view=customers", "/?view=quotes"]);
  assert.ok(!menuPrefetchHrefs({ view: "stats", admin: true, permissions: null, local: true }).includes("/?view=quotes"));
});

test("a member is not prefetched a view their permissions do not let them read", () => {
  const none = { ...defaultWorkflowPermissionProfile(), grants: [] };
  assert.deepEqual(menuPrefetchHrefs({ view: "stats", admin: false, permissions: none }), ["/?view=tasks", "/?view=time"]);
  const field = workflowPermissionPresets.find((preset) => preset.id === "field")!.profile;
  for (const href of menuPrefetchHrefs({ view: "stats", admin: false, permissions: field })) assert.match(href, /^\/\?view=[a-z_]+$/);
});

test("the shell prefetches with the router's default kind, once per person, and marks pressed links", () => {
  const shell = readFileSync("components/app-shell.tsx", "utf8");
  assert.match(shell, /prefetchRouter\.prefetch\(href\)/);
  assert.doesNotMatch(shell, /PrefetchKind|kind: "full"/);
  assert.match(shell, /prefetchedFor\.current === person/);
  assert.match(shell, /<LinkPending edge="left" \/>/);
  assert.match(readFileSync("components/native/tab-bar.tsx", "utf8"), /<LinkPending edge="top" \/><\/Link>/);
  assert.match(readFileSync("components/link-pending.tsx", "utf8"), /useLinkStatus\(\)/);
  // No long router cache for the signed-in page (the proposal's "Vad som inte bör göras").
  assert.doesNotMatch(readFileSync("next.config.ts", "utf8"), /staleTimes/);
  const css = readFileSync("app/globals.css", "utf8");
  const rule = css.slice(css.indexOf(".link-pending {"), css.indexOf(".workspace-bottom-nav > a:has(> .link-pending)"));
  assert.doesNotMatch(rule, /animation|transition/);
});
