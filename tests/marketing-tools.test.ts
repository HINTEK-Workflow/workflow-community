import assert from "node:assert/strict";
import { test } from "node:test";
import { keyMayRun, toolScope, TOOL_CATALOG, TOOL_NAMES } from "../lib/tools/catalog";
import { MARKETING_TOOL_CATALOG, MCP_MARKETING_SCOPE } from "../lib/tools/catalog-marketing";
import { KEY_SCOPES } from "../lib/integrations/key-catalog";
import { API_POST_SOURCE, filterPosts, postToolView, releaseNotesView } from "../lib/tools/marketing-view";
import type { ReleaseNote } from "../lib/release-notes";

// Inlägg, versionsnyheter och besöksstatistik för externa system (2026-11-25).

const names = Object.keys(MARKETING_TOOL_CATALOG) as (keyof typeof MARKETING_TOOL_CATALOG)[];

test("the marketing tools are in the shared catalogue, each behind a scope of its own that no existing key has", () => {
  for (const name of names) assert.ok((TOOL_NAMES as readonly string[]).includes(name), name);
  const apiScopes = new Set<string>(KEY_SCOPES.API.map((scope) => scope.key));
  for (const scope of ["posts:read", "posts:write", "releases:read", "analytics:read"]) assert.ok(apiScopes.has(scope), scope);
  assert.ok(KEY_SCOPES.MCP.some((scope) => scope.key === MCP_MARKETING_SCOPE));
  // A key with the old scopes reaches none of them.
  const old = ["projects:read", "projects:write", "tasks:read", "tasks:write", "customers:read", "customers:write", "planning:read", "planning:write", "time:read", "time:write", "catalogue:read", "quotes:read", "invoices:write", "delete"];
  for (const name of names) assert.equal(keyMayRun("API", old, name), false, name);
  for (const name of ["list_social_posts", "get_social_post", "create_social_post_draft", "get_site_analytics"] as const) assert.equal(keyMayRun("MCP", ["mcp:read", "mcp:write", "mcp:invoices", "mcp:delete"], name), false, name);
  assert.equal(toolScope("API", "create_social_post_draft"), "posts:write");
  assert.equal(toolScope("API", "list_social_posts"), "posts:read");
  assert.equal(toolScope("MCP", "list_release_notes"), "mcp:read");
});

test("only the draft tool writes, and no tool publishes, schedules or approves", () => {
  for (const name of names) assert.equal(TOOL_CATALOG[name].effect, name === "create_social_post_draft" || name === "create_content_brief" ? "create" : "read", name);
  const fields = Object.keys(MARKETING_TOOL_CATALOG.create_social_post_draft.input.shape);
  for (const field of fields) assert.doesNotMatch(field, /publish|schedule|approve|status|newsletter|story/i, field);
  assert.match(MARKETING_TOOL_CATALOG.create_social_post_draft.description, /publiceras aldrig av verktyget/);
});

test("the inputs refuse a bad reference or version without a regex pattern in the schema", () => {
  const draft = MARKETING_TOOL_CATALOG.create_social_post_draft.input;
  assert.equal(draft.safeParse({ externalRef: "ge-rec-2026-11-25:1", caption: "Hej" }).success, true);
  assert.equal(draft.safeParse({ externalRef: "bad ref <script>", caption: "Hej" }).success, false);
  assert.equal(draft.safeParse({ caption: "x".repeat(10_000) }).success, false);
  assert.equal(MARKETING_TOOL_CATALOG.list_release_notes.input.safeParse({ since: "0.84.0" }).success, true);
  assert.equal(MARKETING_TOOL_CATALOG.list_release_notes.input.safeParse({ since: "senaste" }).success, false);
});

const post = (over: Record<string, unknown> = {}) => ({
  id: "p1", source: "manual", sourceRef: null as string | null, status: "draft", heading: "R", body: "B", caption: "C", hashtags: "#a", link: null, instagramText: "",
  toFacebook: true, toInstagram: false, toLinkedIn: true, toStory: false, facebookPostId: null as string | null, instagramMediaId: null, linkedInPostId: "urn:li:share:1",
  publishedAt: null as string | null, lastError: null, campaignLinks: true, aiGenerated: true, createdAt: "2026-11-20T10:00:00.000Z", updatedAt: "2026-11-20T10:00:00.000Z", images: [],
  ...over,
});

test("a post is given with its channels and where it went, never the platform ids or the reference of another source", () => {
  const view = postToolView(post(), { targetId: "p1", status: "scheduled", runAt: "2026-11-26T08:00:00.000Z", publishedAt: null, lastError: null, channels: ["facebook"] });
  assert.deepEqual(view.channels, ["facebook", "linkedin"]);
  assert.deepEqual(view.publishedTo, ["linkedin"]);
  assert.equal(view.schedule?.status, "scheduled");
  assert.equal(view.externalRef, null);
  assert.doesNotMatch(JSON.stringify(view), /urn:li:share/);
  assert.equal(postToolView(post({ source: API_POST_SOURCE, sourceRef: "x1" })).externalRef, "x1");
});

test("the post filter: status, day, reference and limit", () => {
  const posts = [post({ id: "a", status: "published", publishedAt: "2026-11-24T08:00:00.000Z" }), post({ id: "b", source: API_POST_SOURCE, sourceRef: "r1" }), post({ id: "c", createdAt: "2026-10-01T00:00:00.000Z" })];
  assert.deepEqual(filterPosts(posts, { status: "published" }).map((item) => item.id), ["a"]);
  assert.deepEqual(filterPosts(posts, { since: "2026-11-01" }).map((item) => item.id), ["a", "b"]);
  assert.deepEqual(filterPosts(posts, { externalRef: "r1" }).map((item) => item.id), ["b"]);
  assert.deepEqual(filterPosts(posts, { limit: 1 }).map((item) => item.id), ["a"]);
});

test("release notes after a version, newest first, with highlights", () => {
  const notes: ReleaseNote[] = [
    { version: "0.10.0", date: "2026-11-24", summary: "Tio", items: ["a", "b", "c", "d"] },
    { version: "0.9.1", date: "2026-11-20", summary: "Nio", items: ["x"], highlights: ["kort"] },
    { version: "0.9.0", date: "2026-11-10", summary: "Gammal", items: ["y"] },
  ];
  const view = releaseNotesView(notes, "0.10.0", { since: "0.9.0" });
  assert.deepEqual(view.notes.map((note) => note.version), ["0.10.0", "0.9.1"], "0.10.0 is after 0.9.1 (numbers, not text)");
  assert.deepEqual(view.notes[0].highlights, ["a", "b", "c"]);
  assert.deepEqual(view.notes[1].highlights, ["kort"]);
  assert.equal(releaseNotesView(notes, "0.10.0", { limit: 1 }).notes.length, 1);
});
