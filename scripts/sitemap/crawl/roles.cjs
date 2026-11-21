/* eslint-disable @typescript-eslint/no-require-imports -- QA helper (CommonJS): the click robot's role probe. */
/* Rollprov (analysen 2026-10-24): varje vy och avsnitt i webbplatskartan öppnas direkt som varje roll, och varje statisk
 * GET-väg i API:t anropas (bara läsning). node scripts/sitemap/crawl/roles.cjs → roles.json */
const fs = require("fs");
const path = require("path");
const { REPO, OUT, SHOTS, BASES, signIn, chromium } = require("./config.cjs");
const map = require("../generate.cjs").buildSitemap({ repo: REPO, observed: false });
// The API's static GET routes (app/api/**/route.ts that export GET, no [parameter] in the path).
const walk = (dir) => fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(path.join(dir, e.name)) : [path.join(dir, e.name)]));
const routes = walk(path.join(REPO, "app", "api")).filter((f) => /route\.ts$/.test(f) && /export (async )?function GET|export const GET/.test(fs.readFileSync(f, "utf8")))
  .map((f) => "/" + path.relative(path.join(REPO, "app"), path.dirname(f)).split(path.sep).join("/")).filter((r) => !r.includes("["))
  .filter((r) => !/\/(auth|oauth|mcp|qa|stripe|v1)(\/|$)|logout|export|download|backup/.test(r));
fs.mkdirSync(SHOTS, { recursive: true });
const ROLES = Object.entries(BASES);

(async () => {
  const browser = await chromium.launch();
  const out = {};
  for (const [role, base] of ROLES) {
    const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, locale: "sv-SE" });
    const page = await context.newPage();
    await signIn(page, base);
    const me = await (await context.request.get(`${base}/api/profile`)).json().catch(() => null);
    const views = [];
    for (const n of map.nodes.filter((x) => x.kind === "view" || x.kind === "section")) {
      if (!n.address || n.address.includes("…")) continue;
      const allowed = (n.roles || []).includes(role);
      await page.goto(base + n.address).catch(() => {});
      await page.locator("h1").first().waitFor({ timeout: 6000 }).catch(() => {});
      await page.waitForTimeout(500);
      const r = await page.evaluate(() => ({ url: location.pathname + location.search, h1: [...document.querySelectorAll("h1")].map((h) => h.textContent.trim()).join(" | "), crumb: document.querySelector("[data-testid=breadcrumb-current]")?.textContent.trim() || "", text: (document.querySelector("main") || document.body).innerText.slice(0, 300).replace(/\s+/g, " ") }));
      const rec = { id: n.id, label: n.label, address: n.address, allowed, ...r };
      if (!allowed) { const f = `roll-${role}-${n.id.replace(/[^a-z0-9]+/gi, "_")}.png`; await page.screenshot({ path: path.join(SHOTS, f) }).catch(() => {}); rec.shot = f; }
      views.push(rec);
    }
    const api = [];
    for (const r of routes) { try { const res = await context.request.get(base + r, { maxRedirects: 0 }); const body = await res.text(); api.push({ route: r, status: res.status(), size: body.length, head: body.slice(0, 160) }); } catch (e) { api.push({ route: r, status: "fel", head: e.message.slice(0, 100) }); } }
    out[role] = { me: me && { role: me.role || me.user?.role, keys: Object.keys(me || {}).slice(0, 12) }, views, api };
    console.log(role, views.length, api.length);
    await context.close();
  }
  fs.writeFileSync(path.join(OUT, "roles.json"), JSON.stringify(out, null, 1));
  await browser.close();
})().catch((e) => { console.error(e); process.exit(1); });
