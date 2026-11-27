import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { DEMO_NOT_AVAILABLE, DEMO_VIEWS, demoVersionText } from "../lib/demo";
import { MENU_HIDEABLE } from "../lib/workflow/menu-items";
import { VIEW_LABEL } from "../lib/workflow/navigation";
import { RELEASE_NOTES, currentAppVersion } from "../lib/release-notes";

// The demo cannot silently fall behind the product (2026-11-04): a menu page without an answer in the demo, or a demo that says
// another version than the build, makes these tests red.
const packageVersion = (JSON.parse(readFileSync("package.json", "utf8")) as { version: string }).version;

test("every page of the menu has an answer in the demo, or is listed with the reason it has none", () => {
  const demo = new Set<string>(DEMO_VIEWS);
  for (const key of MENU_HIDEABLE) {
    assert.ok(demo.has(key) || Object.hasOwn(DEMO_NOT_AVAILABLE, key), `Menysidan ${key} saknar svar i demon: lägg den i DEMO_VIEWS (lib/demo.ts) eller i DEMO_NOT_AVAILABLE med skäl`);
  }
});

test("the demo's lists only name real pages, and no page is in both lists", () => {
  for (const view of DEMO_VIEWS) assert.ok(Object.hasOwn(VIEW_LABEL, view), `${view} är ingen sida`);
  for (const [view, reason] of Object.entries(DEMO_NOT_AVAILABLE)) {
    assert.ok(reason.trim().length > 10, `${view} behöver ett skäl`);
    assert.ok(!(DEMO_VIEWS as readonly string[]).includes(view), `${view} är både i demon och undantagen`);
  }
  assert.equal(new Set(DEMO_VIEWS).size, DEMO_VIEWS.length);
});

test("Tavlor is in the demo (issue #4, 2026-11-19): its figures are counted in the browser, and only Workflow AI and Webb och inlägg stay outside", () => {
  assert.ok((DEMO_VIEWS as readonly string[]).includes("boards"));
  // Webb och inlägg (2026-11-20) publishes on the company's own accounts through the server: not in the demo either.
  assert.deepEqual(Object.keys(DEMO_NOT_AVAILABLE), ["ai", "web_posts"]);
  assert.match(readFileSync("features/demo/demo-backend.ts", "utf8"), /case "\/api\/boards": return demoBoards\(/, "the demo answers /api/boards");
});

test("the demo says the version of package.json", () => {
  assert.equal(RELEASE_NOTES[0].version, packageVersion, "den nyaste versionsnyheten är package.json:s version");
  // The build puts package.json's version into NEXT_PUBLIC_APP_VERSION; the notes are the fallback when it is not set.
  assert.match(readFileSync("next.config.ts", "utf8"), /NEXT_PUBLIC_APP_VERSION:\s*version/);
  assert.equal(currentAppVersion(), process.env.NEXT_PUBLIC_APP_VERSION || packageVersion);
  assert.equal(demoVersionText(packageVersion), `Version ${packageVersion}`);
  const demoApp = readFileSync("features/demo/demo-page.tsx", "utf8");
  assert.match(demoApp, /demoVersionText\(currentAppVersion\(\)\)/, "demons versionstext hämtas från bygget, ingen egen sträng");
  assert.doesNotMatch(demoApp, /Version \d+\.\d+/);
});

test("on the separate public address /demo leads to the app, which serves it", async () => {
  const { publicSite, routePublicSite } = await import("../lib/public-site");
  const site = publicSite({ APP_URL: "https://app.example.test", PUBLIC_SITE_URL: "https://example.test" });
  for (const pathname of ["/demo"]) {
    assert.deepEqual(routePublicSite({ host: "example.test", pathname, search: "" }, site), { kind: "redirect", location: `https://app.example.test${pathname}`, status: 307 });
    assert.deepEqual(routePublicSite({ host: "app.example.test", pathname, search: "" }, site), { kind: "pass" });
  }
});
