import assert from "node:assert/strict";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";
import { parseEnv } from "../lib/env";
import { publicInstance } from "../lib/instance";
import {
  allowedOrigins, appHref, normalizeHost, pricesHref, publicSite, publicSiteProblem, routePublicSite, siteOfHost,
} from "../lib/public-site";

// A separate public address for the landing page (2026-10-15). Neutral example names: the rules are the core's,
// the address itself is set in the installation's .env.
const APP = "https://app.example.se";
const SITE = "https://example.com";
const site = publicSite({ APP_URL: APP, PUBLIC_SITE_URL: SITE })!;
const route = (host: string, pathname: string, search = "") => routePublicSite({ host, pathname, search }, site);

test("without PUBLIC_SITE_URL there is no public site and nothing is routed", () => {
  assert.equal(publicSite({ APP_URL: APP }), null);
  assert.equal(publicSite({ APP_URL: APP, PUBLIC_SITE_URL: "  " }), null);
  assert.deepEqual(routePublicSite({ host: "example.com", pathname: "/login", search: "" }, null), { kind: "pass" });
  assert.equal(siteOfHost("example.com", null), "app");
  assert.equal(appHref("/login", null), "/login");
  assert.equal(pricesHref(""), "/#priser");
});

test("the public site knows the app, its own host and its www twin", () => {
  assert.deepEqual(site, { appOrigin: APP, appHost: "app.example.se", siteOrigin: SITE, siteHost: "example.com", aliasHosts: ["www.example.com"] });
  // A www. site has the apex as its twin; loopback and IP addresses have none.
  assert.deepEqual(publicSite({ APP_URL: APP, PUBLIC_SITE_URL: "https://www.example.com" })!.aliasHosts, ["example.com"]);
  assert.deepEqual(publicSite({ APP_URL: "http://localhost:3000", PUBLIC_SITE_URL: "http://127.0.0.1:3000" })!.aliasHosts, []);
  assert.equal(siteOfHost("Example.COM.", site), "public");
  assert.equal(siteOfHost("www.example.com", site), "alias");
  assert.equal(siteOfHost("app.example.se", site), "app");
  assert.equal(siteOfHost("unknown.example.net", site), "app");
  assert.equal(normalizeHost("Example.com.:443"), "example.com:443");
});

test("an unusable PUBLIC_SITE_URL means no public site, and production refuses to start with it", () => {
  for (const bad of ["not a url", "ftp://example.com", "https://example.com/landing", "https://example.com/?a=1", "https://app.example.se"])
    assert.equal(publicSite({ APP_URL: APP, PUBLIC_SITE_URL: bad }), null, bad);
  assert.match(publicSiteProblem(APP, "http://example.com", true)!, /HTTPS/);
  assert.equal(publicSiteProblem(APP, "http://example.com", false), null);
  assert.equal(publicSiteProblem(APP, "https://example.com/", true), null);
  assert.match(publicSiteProblem(APP, "https://app.example.se", false)!, /another host/);
  assert.throws(() => parseEnv({ NODE_ENV: "development", PUBLIC_SITE_URL: "https://example.com/landing" }), /origin only/);
  assert.equal(parseEnv({ NODE_ENV: "development", PUBLIC_SITE_URL: "http://127.0.0.1:3000" }).PUBLIC_SITE_URL, "http://127.0.0.1:3000");
});

test("the app's own address is never touched", () => {
  for (const path of ["/", "/login", "/api/mcp", "/.well-known/oauth-authorization-server", "/p/abc", "/api/analytics/event", "/sw.js"])
    assert.deepEqual(route("app.example.se", path), { kind: "pass" }, path);
});

test("the www twin redirects permanently to the public site with path and query", () => {
  assert.deepEqual(route("www.example.com", "/", "?utm=x"), { kind: "redirect", location: "https://example.com/?utm=x", status: 308 });
  assert.deepEqual(route("www.example.com", "/login"), { kind: "redirect", location: "https://example.com/login", status: 308 });
});

test("the public site shows its start page, legal documents, files and the beacon", () => {
  for (const path of ["/", "/legal/terms", "/legal/credit-terms", "/_next/static/chunks/a.js", "/_next/image", "/icons/workflow-32.png", "/brand/logo.svg", "/fonts/x.woff2", "/favicon.ico", "/robots.txt", "/opengraph-image", "/api/analytics/event", "/api/csp-report"])
    assert.deepEqual(route("example.com", path), { kind: "pass" }, path);
});

test("the public site shows security.txt (2026-11-21), the one .well-known file that is also the public site's", () => {
  assert.deepEqual(route("example.com", "/.well-known/security.txt"), { kind: "pass" });
  assert.deepEqual(route("example.com", "/.well-known/security.txt/"), { kind: "not-found" });
});

test("the public site has no API, no OAuth/MCP discovery, no service worker and no install manifest", () => {
  for (const path of ["/api", "/api/auth/callback/credentials", "/api/register", "/api/mcp", "/api/oauth/token", "/api/health/ready", "/.well-known/oauth-authorization-server", "/sw.js", "/manifest.webmanifest"])
    assert.deepEqual(route("example.com", path), { kind: "not-found" }, path);
});

test("everything else on the public site is the app's and goes there temporarily, with path and query", () => {
  assert.deepEqual(route("example.com", "/login", "?returnTo=%2F"), { kind: "redirect", location: `${APP}/login?returnTo=%2F`, status: 307 });
  for (const path of ["/register", "/demo", "/p/printed-label-id", "/m/mailing", "/offert/token", "/oauth/authorize", "/cookies", "/dashboard", "/legal/../api"])
    assert.deepEqual(route("example.com", path), { kind: "redirect", location: `${APP}${path}`, status: 307 }, path);
});

test("mutations are accepted from the app only; the public site only for the beacon and only on its own host", () => {
  const base = { appUrl: APP, site };
  assert.deepEqual(allowedOrigins({ ...base, host: "app.example.se" }), [APP]);
  // Without the route's consent the public site is never accepted, whatever host the request came to.
  assert.deepEqual(allowedOrigins({ ...base, host: "example.com" }), [APP]);
  assert.deepEqual(allowedOrigins({ ...base, host: "example.com", publicSite: true }), [APP, SITE]);
  // The beacon on the app's host, or through the www twin, does not accept the public site's origin.
  assert.deepEqual(allowedOrigins({ ...base, host: "app.example.se", publicSite: true }), [APP]);
  assert.deepEqual(allowedOrigins({ ...base, host: "www.example.com", publicSite: true }), [APP]);
  assert.deepEqual(allowedOrigins({ appUrl: APP, site: null, host: "example.com", publicSite: true }), [APP]);
  // NEXTAUTH_URL counts once; a broken one is ignored instead of breaking every mutation.
  assert.deepEqual(allowedOrigins({ ...base, nextAuthUrl: "https://auth.example.se/api/auth" }), [APP, "https://auth.example.se"]);
  assert.deepEqual(allowedOrigins({ ...base, nextAuthUrl: APP }), [APP]);
  assert.deepEqual(allowedOrigins({ ...base, nextAuthUrl: "not a url" }), [APP]);
  assert.ok(!allowedOrigins({ ...base, host: "example.com", publicSite: true }).includes("*"));
});

test("links into the app and to the prices follow the public site", () => {
  assert.equal(appHref("/login", site), `${APP}/login`);
  assert.equal(pricesHref(SITE), `${SITE}/#priser`);
  assert.equal(publicInstance({ APP_URL: APP, PUBLIC_SITE_URL: SITE }).publicSiteUrl, SITE);
  assert.equal(publicInstance({ APP_URL: APP }).publicSiteUrl, "");
});

test("the code is wired: proxy, Origin check, beacon and start page", () => {
  const proxy = readFileSync("proxy.ts", "utf8");
  assert.match(proxy, /export function proxy\(/);
  assert.match(proxy, /routePublicSite\(/);
  const server = readFileSync("lib/kfid/server.ts", "utf8");
  assert.match(server, /allowedOrigins\(\{/);
  const page = readFileSync("app/page.tsx", "utf8");
  assert.match(page, /siteOfHost\(\(await headers\(\)\)\.get\("host"\), site\) !== "app"/, "the public site never renders the app");
  assert.match(page, /if \(site && !user && !params\.view && !params\.id\) redirect\("\/login"\)/, "signed-out visitors on the app meet the login");
  // Only the beacon and the landing page's Följ nyhetsbrevet (ee/, absent in the community edition) opt in to the public site's origin.
  const optIns = ["app", "lib", "features", "components", "ee"].filter((dir) => existsSync(dir))
    .flatMap((dir) => readdirSync(dir, { recursive: true, encoding: "utf8" }).map((file) => join(dir, file)))
    .filter((file) => /\.tsx?$/.test(file) && /publicSite: true/.test(readFileSync(file, "utf8")))
    .map((file) => file.replaceAll("\\", "/"));
  assert.deepEqual(optIns.sort(), existsSync("ee") ? ["ee/api/analytics-event.ts", "ee/api/newsletter-subscribe.ts"] : []);
});
