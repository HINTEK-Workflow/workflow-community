import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";
import { publicSite, routePublicSite, siteOfHost } from "../lib/public-site";
import {
  APP_ROBOTS_HEADER, CLOSED_ROBOTS_TXT, indexablePaths, indexableSite, PUBLIC_CRAWL_ALLOW, publicRobotsTxt, robotsHeaderFor, sitemapXml,
} from "../lib/seo/indexing";
import { defaultSiteTitle, pageLanguages, publicDocumentMetadata, publicStartMetadata, SITE_DESCRIPTION, sitePreview } from "../lib/site-metadata";

// Sökmotorer (2026-11-10): the rules for robots.txt, the sitemap, X-Robots-Tag and the public pages' metadata.
// Neutral example names: the addresses themselves are the installation's .env.
const APP = "https://app.example.se";
const SITE = "https://example.com";
const site = publicSite({ APP_URL: APP, PUBLIC_SITE_URL: SITE })!;

test("only the public site, with the landing page published, may be indexed", () => {
  assert.equal(indexableSite(site, "public", true), site);
  assert.equal(indexableSite(site, "public", false), null, "a hidden landing page");
  assert.equal(indexableSite(site, "app", true), null, "the app's own address");
  assert.equal(indexableSite(site, "alias", true), null, "the www twin only redirects");
  assert.equal(indexableSite(null, "app", true), null, "no public site (Community, local QA)");
});

test("robots.txt: closed everywhere but on the open public site, which names its sitemap", () => {
  // Only the login may be fetched on the app's address (2026-11-10), so its noindex is seen; nothing else.
  assert.equal(CLOSED_ROBOTS_TXT, "User-agent: *\nAllow: /login$\nDisallow: /\n");
  assert.equal(CLOSED_ROBOTS_TXT.match(/^Allow:/gm)?.length, 1);
  const open = publicRobotsTxt(SITE);
  assert.match(open, /^User-agent: \*\n/);
  assert.match(open, /\nAllow: \/\$\n/);
  assert.match(open, /\nAllow: \/legal\/\n/);
  // Search engines need the styles and scripts to see the page; link previews need the share picture.
  for (const path of ["/_next/", "/landing/", "/landing-images/", "/opengraph-image"]) assert.ok(open.includes(`\nAllow: ${path}\n`), path);
  assert.match(open, /\nDisallow: \/\n/);
  assert.ok(open.endsWith(`Sitemap: ${SITE}/sitemap.xml\n`));
  for (const blocked of ["/api", "/qa", "/login", "/demo", "/m/", "/p/", "/offert/", "/faktura/", "/form-preview", "/design-lab", "/plc-simulator", "/operator"])
    assert.ok(!open.includes(`Allow: ${blocked}`), blocked);
});

test("every path robots.txt allows is one the public site serves itself (never a redirect into the app)", () => {
  for (const allowed of PUBLIC_CRAWL_ALLOW) {
    const path = allowed.replace(/\$$/, "").replace(/\/$/, "/x") || "/";
    const decision = routePublicSite({ host: "example.com", pathname: allowed === "/$" ? "/" : path, search: "" }, site);
    assert.deepEqual(decision, { kind: "pass" }, allowed);
  }
  // The sitemap is the public site's own file.
  assert.deepEqual(routePublicSite({ host: "example.com", pathname: "/sitemap.xml", search: "" }, site), { kind: "pass" });
});

test("X-Robots-Tag: every answer on the app's address says noindex; the public site decides in its pages", () => {
  assert.equal(robotsHeaderFor(siteOfHost("app.example.se", site)), APP_ROBOTS_HEADER);
  assert.equal(robotsHeaderFor(siteOfHost("localhost:3000", null)), APP_ROBOTS_HEADER, "without a public site the app is never indexed");
  assert.equal(robotsHeaderFor(siteOfHost("example.com", site)), null);
  assert.equal(APP_ROBOTS_HEADER, "noindex, nofollow");
});

test("the proxy sets X-Robots-Tag on both of its answers", () => {
  const proxy = readFileSync(join(process.cwd(), "proxy.ts"), "utf8");
  assert.equal(proxy.match(/headers\.set\("X-Robots-Tag", robots\)/g)?.length, 2);
});

test("the sitemap lists absolute addresses on the public site, without duplicates and escaped", () => {
  const xml = sitemapXml(SITE, indexablePaths(["terms", "privacy", "terms"]));
  assert.match(xml, /^<\?xml version="1.0" encoding="UTF-8"\?>\n<urlset xmlns="http:\/\/www.sitemaps.org\/schemas\/sitemap\/0.9">/);
  assert.deepEqual([...xml.matchAll(/<loc>([^<]+)<\/loc>/g)].map((match) => match[1]), [`${SITE}/`, `${SITE}/legal/terms`, `${SITE}/legal/privacy`]);
  assert.match(sitemapXml(SITE, ["/a&b"]), /<loc>https:\/\/example.com\/a&amp;b<\/loc>/);
});

test("the start page: indexable, canonical, Swedish hreflang, default texts and the generated picture", () => {
  const meta = publicStartMetadata("Workflow", SITE, undefined);
  assert.deepEqual(meta.robots, { index: true, follow: true });
  assert.equal(String(meta.metadataBase), `${SITE}/`);
  assert.equal(meta.alternates?.canonical, `${SITE}/`);
  assert.deepEqual(meta.alternates?.languages, { "sv-SE": `${SITE}/`, "x-default": `${SITE}/` });
  assert.equal(meta.title, undefined, "the layout's default title");
  assert.equal(meta.verification, undefined);
  const og = meta.openGraph as { title: string; description: string; url: string; locale: string; images: { url: string; width?: number }[] };
  assert.equal(og.title, defaultSiteTitle("Workflow"));
  assert.equal(og.description, SITE_DESCRIPTION);
  assert.equal(og.url, `${SITE}/`);
  assert.equal(og.locale, "sv_SE");
  assert.deepEqual(og.images.map((image) => [image.url, image.width]), [["/opengraph-image", 1200]]);
});

test("the start page: the landing editor's own title, description, picture and Search Console code", () => {
  const meta = publicStartMetadata("Workflow", SITE, { title: "Egen titel", description: "Egen text.", image: { url: "/landing-images/a.webp", alt: "Bild" }, googleVerification: "abc_123-X" });
  assert.deepEqual(meta.title, { absolute: "Egen titel" });
  assert.equal(meta.description, "Egen text.");
  assert.deepEqual(meta.verification, { google: "abc_123-X" });
  const og = meta.openGraph as { title: string; description: string; images: { url: string; alt: string; width?: number }[] };
  assert.equal(og.title, "Egen titel");
  assert.equal(og.description, "Egen text.");
  assert.deepEqual(og.images, [{ url: "/landing-images/a.webp", alt: "Bild" }]);
  assert.deepEqual((meta.twitter as { images: string[] }).images, ["/landing-images/a.webp"]);
  // Whitespace only is the default, not an empty title.
  assert.equal(publicStartMetadata("Workflow", SITE, { title: "  ", description: "", image: null, googleVerification: "" }).title, undefined);
});

test("a legal document on the public site: indexable on its own address", () => {
  const meta = publicDocumentMetadata("Workflow", SITE, "terms", "Tjänstevillkor");
  assert.deepEqual(meta.robots, { index: true, follow: true });
  assert.equal(meta.alternates?.canonical, `${SITE}/legal/terms`);
  assert.equal(meta.title, "Tjänstevillkor");
  assert.equal(meta.description, "Tjänstevillkor för Workflow.");
  assert.equal((meta.openGraph as { url: string }).url, `${SITE}/legal/terms`);
});

test("the shared preview keeps its defaults for the app", () => {
  const preview = sitePreview("Workflow", `${APP}/`);
  assert.equal((preview.openGraph as { title: string }).title, defaultSiteTitle("Workflow"));
  assert.deepEqual(pageLanguages("https://x.se/"), { "sv-SE": "https://x.se/", "x-default": "https://x.se/" });
});

test("the root layout keeps the whole installation out of search unless a page opens itself", () => {
  const layout = readFileSync(join(process.cwd(), "app/layout.tsx"), "utf8");
  assert.match(layout, /robots: \{ index: false, follow: false \}/);
  // Only the public start page and the legal documents open themselves, through lib/site-metadata.ts.
  const start = readFileSync(join(process.cwd(), "app/page.tsx"), "utf8");
  assert.match(start, /indexablePublicSite\(\)/);
  const legal = readFileSync(join(process.cwd(), "app/(public)/legal/[document]/page.tsx"), "utf8");
  assert.match(legal, /indexablePublicSite\(\)/);
});
