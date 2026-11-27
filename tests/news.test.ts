import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import {
  cleanNewsBody, compareNews, NEWS_BODY_MAX, NEWS_NOTICE_DAYS, NEWS_TITLE_MAX, newsAuditDetail, newsAuthorLabel, newsEvents, newsExcerpt, newsHref, newsNotifications,
  newsPublishProblem, newsPublishSchema, newsSaveSchema, newsTextSchema, newsToastText, newsView, parseNewsFilter,
} from "../lib/news/model";
import { noticeKey, noticeKindsOf, noticeStateText } from "../lib/workflow/notice-channels";
import { metricAccess, metricDefinition } from "../lib/boards/metrics";
import { breadcrumbTrail } from "../lib/workflow/navigation";
import { MODULE_ROUTES } from "../lib/workflow/modules";

// Nyheter (2026-11-21): the pure rules. tests/news.integration.ts runs the server against a database; tests/news.browser.cjs the page.

test("a post's text: one-line title within its limit, the text with its line breaks, never more than three empty lines", () => {
  assert.deepEqual(newsTextSchema.parse({ title: "  Ny   rutin \n för nycklar ", body: "Rad ett\r\n\r\n\r\n\r\n\r\nRad två  \n" }), { title: "Ny rutin för nycklar", body: "Rad ett\n\n\nRad två" });
  assert.equal(newsTextSchema.parse({ title: "Bara rubrik" }).body, "");
  assert.throws(() => newsTextSchema.parse({ title: "   " }), /Skriv en rubrik/);
  assert.throws(() => newsTextSchema.parse({ title: "x".repeat(NEWS_TITLE_MAX + 1) }), /högst 120/);
  assert.throws(() => newsTextSchema.parse({ title: "Lång", body: "x".repeat(NEWS_BODY_MAX + 1) }), /högst 5000/);
  assert.equal(cleanNewsBody("  a \t\nb  "), "a\nb");
});

test("the admin's save is a draft unless it says published, and not pinned unless it says so", () => {
  assert.deepEqual(newsSaveSchema.parse({ title: "T" }), { title: "T", body: "", pinned: false, status: "draft" });
  assert.equal(newsSaveSchema.parse({ title: "T", status: "published", pinned: true }).status, "published");
  assert.throws(() => newsSaveSchema.parse({ title: "T", status: "archived" }));
});

test("the contract of publishCompanyNews: published by an agent unless said otherwise, a key is required", () => {
  const value = newsPublishSchema.parse({ title: "Veckans planering", body: "12 bokningar.", sourceRef: "mission-1:2026-11-23", mission: { id: "m1", name: "  Veckans   planering " } });
  assert.equal(value.status, "published");
  assert.equal(value.source, "agent");
  assert.equal(value.pinned, false);
  assert.equal(value.mission?.name, "Veckans planering");
  assert.throws(() => newsPublishSchema.parse({ title: "T", sourceRef: " " }), /Nyckeln saknas/);
  assert.throws(() => newsPublishSchema.parse({ title: "T" }));
  assert.throws(() => newsPublishSchema.parse({ title: "T", sourceRef: "x".repeat(201) }));
  assert.equal(newsPublishSchema.parse({ title: "T", sourceRef: "k", status: "draft" }).status, "draft");
});

test("who wrote it: the person, or the agent mission by name", () => {
  assert.equal(newsAuthorLabel({ source: "manual", authorName: "Elna Strömtång" }), "Elna Strömtång");
  assert.equal(newsAuthorLabel({ source: "agent", agentName: "Veckans planering", authorName: "Elna Strömtång" }), "Agent: Veckans planering");
  assert.equal(newsAuthorLabel({ source: "agent", agentName: null }), "Agent: Agentuppdrag");
  assert.equal(newsAuthorLabel({ source: "manual", authorName: " " }), "En kollega");
});

test("the short text is the start of the text on one line, cut with an ellipsis", () => {
  assert.equal(newsExcerpt("Rad ett\n\nRad två"), "Rad ett Rad två");
  const long = newsExcerpt("ord ".repeat(100), 40);
  assert.ok(long.length <= 40 && long.endsWith("…"));
  assert.equal(newsExcerpt(""), "");
});

const row = (id: string, values: Partial<Parameters<typeof newsView>[0]> = {}) => ({
  id, title: `Nyhet ${id}`, body: "Text", status: "published", pinned: false, source: "manual", agentName: null, authorUserId: "anna",
  publishedAt: new Date("2026-11-20T08:00:00Z"), createdAt: new Date("2026-11-20T07:00:00Z"), updatedAt: new Date("2026-11-20T08:00:00Z"), ...values,
});

test("a post as the page receives it, with its link in the app", () => {
  const view = newsView(row("p1", { source: "agent", agentName: "Veckans planering" }), "Anna");
  assert.equal(view.author, "Agent: Veckans planering");
  assert.equal(view.href, "/?view=news&post=p1");
  assert.equal(newsHref("a b"), "/?view=news&post=a%20b");
  assert.equal(view.publishedAt, "2026-11-20T08:00:00.000Z");
  assert.equal(newsView(row("p2", { status: "weird" }), "Anna").status, "draft", "an unknown status is never shown as published");
});

test("the list's order: pinned first, then newest first", () => {
  const views = [row("old", { publishedAt: new Date("2026-11-01T00:00:00Z") }), row("pinned", { pinned: true, publishedAt: new Date("2026-10-01T00:00:00Z") }), row("new", { publishedAt: new Date("2026-11-21T00:00:00Z") })].map((item) => newsView(item, "Anna"));
  assert.deepEqual(views.sort(compareNews).map((item) => item.id), ["pinned", "new", "old"]);
});

test("the bell: a week of news by someone else, newest first, never one's own", () => {
  const now = new Date("2026-11-21T12:00:00Z");
  const items = newsNotifications([
    { ...row("mine", { authorUserId: "me" }) },
    { ...row("fresh", { publishedAt: new Date("2026-11-21T07:00:00Z") }), authorName: "Anna" },
    { ...row("agent", { source: "agent", agentName: "Veckans planering", publishedAt: new Date("2026-11-21T06:00:00Z") }) },
    { ...row("old", { publishedAt: new Date(now.getTime() - (NEWS_NOTICE_DAYS + 1) * 86_400_000) }) },
    { ...row("draft", { publishedAt: null }) },
  ], { userId: "me", now });
  assert.deepEqual(items.map((item) => item.id), ["NEWS:fresh", "NEWS:agent"]);
  assert.equal(items[0]!.kind, "NEWS");
  assert.equal(items[0]!.href, "/?view=news&post=fresh");
  assert.equal(items[0]!.assignedBy, "Anna");
  assert.equal(items[1]!.assignedBy, "Agent: Veckans planering");
  assert.equal(items[0]!.needsAction, false, "news never stands under Kräver åtgärd");
  assert.equal(noticeKey(items[0]!), "NEWS:fresh", "read once per post");
  assert.deepEqual(noticeKindsOf(items[0]!), ["NEWS"]);
  assert.equal(noticeStateText(items[0]!, "2026-11-21"), "Nyhet från Anna");
  assert.equal(newsToastText(items[0]!), "Ny nyhet från Anna: Nyhet fresh");
});

test("the board's measure: the latest published posts as events, the text's start as the line, no name", () => {
  const shape = newsEvents([{ title: "A", body: "Första raden\nandra", pinned: false, publishedAt: "2026-11-20T08:00:00.000Z" }, { title: "Utkast", body: "", pinned: false, publishedAt: null }]);
  assert.deepEqual(shape, { kind: "events", items: [{ at: "2026-11-20T08:00:00.000Z", title: "A", level: "info", detail: "Första raden andra" }] });
  const viewer = { userId: "u", admin: false, workflowPermissions: { version: 1 as const, grants: [] }, organization: { disabledModules: [] } };
  assert.equal(metricDefinition("news_latest").shape, "events", "the card Händelser shows it");
  assert.equal(metricAccess("news_latest", viewer), "ok", "every member reads the news");
  assert.equal(metricAccess("news_latest", { ...viewer, organization: { disabledModules: ["news"] } }), "module_off");
});

test("the audit names the title or the mission, never the text", () => {
  assert.equal(newsAuditDetail("published", { title: "Ny rutin" }), 'Publicerade nyheten "Ny rutin".');
  assert.equal(newsAuditDetail("published", { title: "Veckans planering", source: "agent", agentName: "Måndagsplanering" }), 'Agentuppdraget Måndagsplanering publicerade nyheten "Veckans planering".');
  assert.equal(newsAuditDetail("draft", { title: "T", source: "agent", agentName: "M" }), 'Agentuppdraget M sparade nyheten "T" som utkast.');
  assert.equal(newsAuditDetail("deleted", { title: "T" }), 'Tog bort nyheten "T".');
});

test("small rules of the page: the filter, what stops Publicera, the breadcrumbs", () => {
  assert.equal(parseNewsFilter("draft"), "draft");
  assert.equal(parseNewsFilter("x"), "published");
  assert.equal(newsPublishProblem({ title: " " }), "Skriv en rubrik först.");
  assert.equal(newsPublishProblem({ title: "T" }), null);
  assert.deepEqual(breadcrumbTrail({ view: "news" }).map((crumb) => crumb.label), ["Översikt", "Mer", "Nyheter"]);
  assert.deepEqual(breadcrumbTrail({ view: "news", params: { post: "p1" }, labels: { heading: "Ny rutin" } }).map((crumb) => crumb.label), ["Översikt", "Mer", "Nyheter", "Ny rutin"]);
  assert.deepEqual(breadcrumbTrail({ view: "news", params: { new: "1" } }).map((crumb) => crumb.label), ["Översikt", "Mer", "Nyheter", "Ny nyhet"]);
});

test("the page follows the list template: the shared filter row, a post as its own page, Ny nyhet and Redigera as a form page", () => {
  // 2026-11-22: "sida nyheter skall följa övriga struktur som finns på liknande sidor" (Tavlor, Offerter, Avvikelser).
  const page = readFileSync("features/news/news-page.tsx", "utf8");
  assert.equal(/SplitPane/.test(page), false, "no editor or post beside the list");
  assert.match(page, /<ListFilterBar[\s\S]*chips=\{chips\}[\s\S]*search=\{[\s\S]*view=\{\{ value: prefs\.view/, "Publicerade | Utkast, the search and Rader | Kort in the shared row");
  assert.match(page, /useListPrefs\("news", personId/, "Rader | Kort remembered per person, as the other lists");
  assert.match(page, /<ListCardGrid[\s\S]*<ListCard /, "Kort is the shared card");
  assert.match(page, /<Empty title=/, "the shared empty box");
  assert.match(page, /<FormPage title=\{editing \? "Redigera nyheten" : "Ny nyhet"\}/, "the form is the shared form page");
  assert.match(page, /<DialogActions cancel=\{\{ onClick: onCancel \}\}[\s\S]*testId: "news-publish"[\s\S]*data-testid="news-save-draft"/, "Avbryt, Spara utkast and Publicera in the form's row (top right)");
  assert.match(page, /<PageHeader title=\{post\.title\}[\s\S]*data-testid="news-delete"[\s\S]*\{back\}[\s\S]*data-testid="news-pin"[\s\S]*data-testid="news-edit"/, "the post's page: Ta bort, Tillbaka, Fäst överst, Redigera last");
  assert.match(page, /canWrite \? <Button asChild><Link href=\{NEW_HREF\} data-testid="news-new">/, "Ny nyhet top right only for the one who may write");
});

test("the route and the server function keep the rules: Origin, module, role, idempotency on the key", () => {
  assert.deepEqual(MODULE_ROUTES.news, { write: ["news"], read: [] });
  const route = readFileSync("app/api/news/route.ts", "utf8");
  assert.match(route, /export async function POST[\s\S]*checkOrigin\(request\)[\s\S]*requireCloudWriteAccess\(ctx\)[\s\S]*requireModule\(ctx, "news"\)/);
  const server = readFileSync("lib/news/server.ts", "utf8");
  assert.match(server, /async function requireNewsWrite[\s\S]*requireCloudStorage\(actor\)[\s\S]*requireCloudWriteAccess\(actor\)[\s\S]*requireModule\(actor, "news"\)[\s\S]*if \(!actor\.admin\)/);
  assert.match(server, /export async function publishCompanyNews\(actor: NewsActor, input: NewsPublishInput\)[\s\S]*await requireNewsWrite\(actor\)/, "an agent meets the same checks");
  assert.match(server, /organizationId_source_sourceRef/, "found again by its key");
  // A post is only ever found within the actor's company; update and delete go by the row found that way.
  assert.equal(/companyNewsPost\.(update|delete)\(\{ where: \{ id(?!: before\.id)/.test(server), false, "no change by an id from outside");
});
