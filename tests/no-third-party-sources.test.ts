import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import { createElement as h } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { cspDirectives } from "../lib/security/csp";
import { frameCsp, NO_STYLES } from "../lib/website/frame";
import { frameMayLoad, SiteFrame } from "../features/website/website-frame";

// Samtycke (2026-11-11, docs/regler/samtycke.md): nothing from a third party is loaded by the browser before the person
// has consented to exactly that purpose, and what needs no consent is served by the app itself. This test stops new external
// addresses for fonts, scripts, styles, pictures, frames and connection hints in the source and in the content policy;
// tests/no-third-party-before-consent.browser.cjs checks the running pages.

const ROOTS = ["app", "components", "features", "lib", "ee", "public", "community"];
const FILES = ["next.config.ts", "proxy.ts", "instrumentation-client.ts", "instrumentation.ts"];
const SKIP_DIRS = new Set(["node_modules", "tests", "fixtures", ".next", "scripts"]);
const EXTENSIONS = /\.(tsx?|jsx?|mjs|cjs|css|html?|svg|webmanifest|json)$/;

/**
 * Where an address on the lists below may stand, and why. Server code only: the browser never sees these addresses.
 * Each entry is a file (relative, forward slashes) and the host it may name.
 */
const ALLOWED: { file: string; host: string; why: string }[] = [
  { file: "lib/website/look-server.ts", host: "fonts.googleapis.com", why: "the server reads the connected site's font css once and copies the fonts to Workflow; the browser never loads them" },
];

/** Hosts that serve fonts, scripts, styles, pictures, embeds or tracking to browsers. */
const ASSET_HOSTS = [
  "fonts.googleapis.com", "fonts.gstatic.com", "use.typekit.net", "p.typekit.net", "fast.fonts.net", "kit.fontawesome.com", "use.fontawesome.com",
  "cdn.jsdelivr.net", "unpkg.com", "cdnjs.cloudflare.com", "ajax.googleapis.com", "code.jquery.com", "cdn.tailwindcss.com", "esm.sh", "cdn.skypack.dev",
  "googletagmanager.com", "google-analytics.com", "connect.facebook.net", "static.cloudflareinsights.com", "plausible.io", "hotjar.com", "clarity.ms",
  "gravatar.com", "s.w.org", "youtube.com/embed", "youtube-nocookie.com", "player.vimeo.com", "maps.googleapis.com", "maps.gstatic.com",
  "tile.openstreetmap.org", "api.mapbox.com", "api.maptiler.com", "js.stripe.com", "m.stripe.network", "www.google.com/recaptcha", "hcaptcha.com", "challenges.cloudflare.com",
];

/** Patterns that make the browser contact another host by themselves, wherever the address points. */
const LOADING_PATTERNS: [string, RegExp][] = [
  ["connection hint", /\b(preconnect|dns-prefetch)\b/i],
  ["css @import from the web", /@import\s+(url\()?\s*["']?(https?:)?\/\//i],
  ["css url() from the web", /url\(\s*["']?(https?:)?\/\/[a-z0-9]/i],
  ["external script", /<script\b[^>]*\bsrc=["'](https?:)?\/\//i],
  ["external stylesheet", /<link\b[^>]*\bhref=["'](https?:)?\/\/[^"']+["'][^>]*\brel=["']stylesheet|<link\b[^>]*\brel=["']stylesheet["'][^>]*\bhref=["'](https?:)?\/\//i],
  ["external picture", /<img\b[^>]*\bsrc=["'](https?:)?\/\//i],
  ["external frame", /<iframe\b[^>]*\bsrc=["'](https?:)?\/\//i],
];
/** Lines where a loading pattern is not the browser loading anything (the file, the reason). */
// Empty on purpose: add { file, match, why } only for server code that parses such text and never hands it to a browser.
const PATTERN_EXCEPTIONS: { file: string; match: RegExp; why: string }[] = [];

function walk(dir: string, out: string[]) {
  for (const name of readdirSync(dir)) {
    if (SKIP_DIRS.has(name)) continue;
    const full = path.join(dir, name);
    const stat = statSync(full);
    if (stat.isDirectory()) walk(full, out);
    else if (EXTENSIONS.test(name) && stat.size < 2_000_000) out.push(full);
  }
}

const files = (() => {
  const out: string[] = [];
  for (const root of ROOTS) { try { walk(root, out); } catch { /* a root missing in an edition */ } }
  return [...out, ...FILES].map((file) => file.split(path.sep).join("/"));
})();

const stripComments = (text: string) => text.replace(/\/\*[\s\S]*?\*\//g, (block) => block.replace(/[^\n]/g, " ")).replace(/(^|[^:"'`])\/\/.*$/gm, "$1");

test("no source file names a host that serves fonts, scripts, styles, pictures, embeds or tracking to browsers", () => {
  const found: string[] = [];
  for (const file of files) {
    const text = readFileSync(file, "utf8").toLowerCase();
    for (const host of ASSET_HOSTS) {
      if (!text.includes(host)) continue;
      if (ALLOWED.some((entry) => entry.file === file && entry.host === host)) continue;
      found.push(`${file}: ${host}`);
    }
  }
  assert.deepEqual(found, [], "a third-party asset host in the source – self-host it, or gate it behind consent and add it to ALLOWED with a reason");
});

test("no source line makes the browser fetch from another host by itself (hints, @import, url(), script, stylesheet, img, iframe)", () => {
  const found: string[] = [];
  for (const file of files) {
    const lines = stripComments(readFileSync(file, "utf8")).split("\n");
    lines.forEach((line, index) => {
      for (const [what, pattern] of LOADING_PATTERNS) {
        if (!pattern.test(line)) continue;
        if (PATTERN_EXCEPTIONS.some((entry) => entry.file === file && entry.match.test(line))) continue;
        found.push(`${file}:${index + 1}: ${what}`);
      }
    });
  }
  assert.deepEqual(found, [], "the browser would contact another host on its own");
});

test("the app's content policy allows no outside host for scripts, styles, pictures, fonts, connections, media or frames", () => {
  for (const development of [false, true]) {
    for (const [name, sources] of cspDirectives({ nonce: "abc123", development })) {
      if (name === "report-uri" || name === "report-to") continue;
      const outside = sources.filter((source) => !/^'[a-z0-9+/=_-]+'$/i.test(source) && !["data:", "blob:"].includes(source) && !(development && ["ws:", "wss:"].includes(source)));
      assert.deepEqual(outside, [], `${name} (development=${development}) allows an outside source`);
    }
  }
  const header = readFileSync("next.config.ts", "utf8").match(/Content-Security-Policy", value: "([^"]+)"/g) ?? [];
  for (const value of header) assert.doesNotMatch(value, /https?:\/\//, "next.config.ts names an outside host in a policy");
});

test("the website editor's preview frame allows only the connected site itself, and nothing to fetch or frame", () => {
  const policy = frameCsp("https://kund.example", { header: true });
  const hosts = [...new Set(policy.match(/https?:\/\/[^\s;]+/g) ?? [])];
  assert.deepEqual(hosts, ["https://kund.example"]);
  assert.match(policy, /connect-src 'none'/);
  assert.match(policy, /frame-src 'none'/);
  assert.doesNotMatch(frameCsp("https://evil.example; script-src *"), /\*/, "a malformed origin is never put in the policy");
});

test("Min webbsida's preview asks nothing of the connected site before the click (2026-11-11, option b)", () => {
  const site = { origin: "https://kund.example", styles: NO_STYLES };
  const draw = (env: Parameters<typeof SiteFrame>[0]["env"]) => renderToStaticMarkup(h(SiteFrame, { html: "<p>x</p>", env, title: "HTML-kod", testId: "site-html-frame" }));
  assert.equal(frameMayLoad(site), false);
  assert.equal(frameMayLoad({ ...site, allowed: false }), false);
  const before = draw(site);
  assert.doesNotMatch(before, /<iframe|kund\.example/, "no frame and no address of the site before the click");
  assert.match(before, /data-testid="site-html-frame-gate"/);
  assert.match(before, /Visa förhandsvisning/);
  assert.match(before, /Hämtar från din webbplats/);
  assert.equal(frameMayLoad({ ...site, allowed: true }), true);
  assert.match(draw({ ...site, allowed: true }), /<iframe[^>]*sandbox="allow-scripts"/);
  // Without a connected site there is nothing to fetch from, so nothing to ask.
  assert.equal(frameMayLoad({ origin: null, styles: NO_STYLES }), true);
});

test("every allow-list entry still matches a file that names the host, and says why", () => {
  for (const entry of ALLOWED) {
    assert.ok(entry.why.length > 20, entry.file);
    assert.ok(readFileSync(entry.file, "utf8").toLowerCase().includes(entry.host), `${entry.file} no longer names ${entry.host}: remove it from ALLOWED`);
  }
});
