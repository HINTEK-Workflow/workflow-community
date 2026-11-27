#!/usr/bin/env node
/* eslint-disable @typescript-eslint/no-require-imports -- Local helper (CommonJS, no build step). */
// Landningssidans skärmbilder (2026-11-19): takes the pictures in public/landing/ from the public demo (invented data only),
// with the same file names, sizes and webp format, so the page and the editor's library keep working.
//
//   node scripts/qa/dev-server.cjs --port 3014 [--env-from <checkout with .env>]   a local dev server (loopback, kfid_v3_test)
//   node scripts/landing/screenshots.cjs [--base http://localhost:3014] [--out tmp/landing-shots] [--only name,name]
//
// Then look at every picture in --out (both edges, nothing cut, no scrollbars, only demo data) and copy the ones that are
// right into public/landing/. Nothing is written to public/ by the script itself.
//
// The crop (fixed 2026-11-19: the right edge was cut because the viewport was 48 px wider than the clip): the viewport is set
// so that the page's main area (#main-content, with its own equal padding left and right) is exactly the picture's width in
// CSS pixels, measured after the page is open; the clip is the main area itself. Scrollbars are hidden.
// guide-foretaget signs in the local QA owner (/qa, the dev server's synthetic role on kfid_v3_test): use --base with the
// host of APP_URL (localhost), or the sign-in is refused. Nothing in the guide is saved.
const { chromium } = require("playwright");
const sharp = require("sharp");
const path = require("node:path");
const fs = require("node:fs");

const arg = (name, fallback) => { const index = process.argv.indexOf(name); return index > 0 ? process.argv[index + 1] : fallback; };
const base = arg("--base", "http://localhost:3014");
const out = path.resolve(arg("--out", "tmp/landing-shots"));
const only = (arg("--only", "") || "").split(",").filter(Boolean);
const wanted = (name) => !only.length || only.includes(name);
fs.mkdirSync(out, { recursive: true });

const HIDE = ".cookie-notice,nextjs-portal,.workspace-toast{display:none!important}html{scrollbar-width:none!important}::-webkit-scrollbar{display:none!important;width:0!important;height:0!important}";
const hide = (css) => document.addEventListener("DOMContentLoaded", () => { const style = document.createElement("style"); style.textContent = css; document.head.append(style); });

// w/h: the picture; zoom: CSS px are enlarged by this (1.2 for the 1400 px pictures, as before); click/clickText/unfold/scrollTo: what
// to do before; scrollLeft: put every horizontal scroller back at its start (the time plan's chart).
const DESK = [
  { name: "arbetsorder-detalj", w: 1400, h: 973, url: "/?view=workflow_task&taskId=demo-task-garage-laddboxar&taskType=WORK_ORDER" },
  { name: "arbetsorder-riskbedomning", w: 1400, h: 973, url: "/?view=workflow_task&taskId=demo-task-garage-etapp2-risk&taskType=RISK_ASSESSMENT" },
  { name: "driftronder-avvikelser", w: 1400, h: 902, url: "/?view=deviations" },
  { name: "driftronder-ronder", w: 1400, h: 759, url: "/?view=rounds" },
  { name: "egenkontroll-kompetenskort", w: 1400, h: 902, url: "/?view=self_inspection&tab=competence" },
  { name: "egenkontroll-program", w: 1400, h: 973, url: "/?view=self_inspection&tab=program" },
  { name: "kontroller-protokoll-ifylls", w: 1400, h: 973, url: "/?view=workflow_task&taskId=demo-task-rond-reservkraft&taskType=FORM", scrollTo: "text=Säkerhetsavstämning", scrollOffset: 210 },
  { name: "kunder-kundsida", w: 1400, h: 973, url: "/?view=customers&customerId=demo-customer-nollpunkten", unfold: true },
  { name: "kunder-objekt", w: 1400, h: 831, url: "/?view=customers", click: "Alla objekt" },
  { name: "offert-fakturaunderlag", w: 1400, h: 664, url: "/?view=invoice_bases" },
  { name: "offert-inkop", w: 1400, h: 759, url: "/?view=purchases" },
  { name: "offert", w: 1400, h: 973, url: "/?view=quote&quoteId=demo-quote-garage-v2" },
  { name: "planering-kalender", w: 1400, h: 973, url: "/?view=planning" },
  { name: "planering-kapacitet", w: 1400, h: 759, url: "/?view=capacity" },
  { name: "planering-tidplan", w: 1400, h: 902, url: "/?view=project_planning", scrollLeft: true },
  { name: "start-anvandare", w: 1353, h: 500, url: "/?view=administration" },
  { name: "start-oversikt", w: 1353, h: 700, url: "/?view=stats&tab=team" },
  { name: "tid-tidrapport", w: 1400, h: 902, url: "/?view=time" },
  { name: "underhall-anlaggning", w: 1400, h: 902, url: "/?view=maintenance" },
  { name: "underhall-maskinsida", w: 1400, h: 973, url: "/?view=maintenance&part=demo-part-ao-undercentral" },
  // Maskinanalys med AI under Kopplingar › Maskiner, switched off until the company turns HINTEK AI on (closer than the
  // Kopplingar picture, so the switch and its reason are read).
  { name: "ai-maskinanalys-installning", w: 1400, h: 973, zoom: 1.6, url: "/?view=integrations", clickText: "Maskiner", scrollTo: "section[aria-label='Maskinanalys med AI']", scrollOffset: 150 },
];

async function openDemo(browser, viewport) {
  const context = await browser.newContext({ viewport, deviceScaleFactor: 2, locale: "sv-SE", timezoneId: "Europe/Stockholm" });
  await context.addInitScript(hide, HIDE);
  const page = await context.newPage();
  page.setDefaultTimeout(120_000);
  await page.goto(`${base}/demo`, { timeout: 300_000 });
  await page.waitForURL("**/?view=**");
  await page.waitForFunction(() => Boolean(window.next?.router));
  const consent = page.getByTestId("consent-necessary");
  if (await consent.isVisible().catch(() => false)) await consent.click();
  return page;
}
// Client navigation keeps the demo's memory (a page load starts it over).
async function go(page, href) {
  for (let attempt = 0; attempt < 30; attempt += 1) {
    await page.evaluate((target) => window.next.router.push(target), href);
    try { await page.waitForURL((url) => `${url.pathname}${url.search}` === href, { timeout: 2000 }); break; } catch { /* again */ }
  }
  await page.waitForLoadState("networkidle").catch(() => {});
  await page.waitForTimeout(1500);
}
const mainBox = (page) => page.evaluate(() => { const r = document.querySelector("#main-content").getBoundingClientRect(); const header = document.querySelector("header")?.getBoundingClientRect().bottom ?? 0; return { x: r.left, y: Math.max(r.top, header), width: r.width }; });
const save = async (file, name, w, h) => { await sharp(file).resize(w, h, { fit: "cover", position: "top" }).webp({ quality: 82 }).toFile(path.join(out, `${name}.webp`)); console.log("ok", name); };

async function desk(browser) {
  const shots = DESK.filter((shot) => wanted(shot.name));
  if (!shots.length) return;
  const page = await openDemo(browser, { width: 1600, height: 1100 });
  for (const shot of shots) {
    const zoom = shot.zoom ?? (shot.w === 1400 ? 1.2 : 1);
    const cssW = Math.round(shot.w / zoom), cssH = Math.round(shot.h / zoom);
    await go(page, shot.url);
    // The main area starts after the side menu; the viewport ends where the main area is cssW wide (measured on this page).
    for (let round = 0; round < 3; round += 1) {
      const box = await mainBox(page);
      if (Math.abs(box.width - cssW) < 1) break;
      await page.setViewportSize({ width: Math.round(box.x + cssW), height: Math.max(900, cssH + 200) });
      await page.waitForTimeout(800);
    }
    if (shot.unfold) for (const title of ["Kontaktuppgifter", "Projekt", "Uppgifter", "Offerter", "Anläggningar"]) { const toggle = page.locator(`[aria-label="Visa ${title}"]`).first(); if (await toggle.count()) await toggle.click(); }
    if (shot.click) { await page.getByRole("button", { name: shot.click }).or(page.getByRole("tab", { name: shot.click })).or(page.getByRole("link", { name: shot.click })).first().click(); await page.waitForTimeout(2500); }
    if (shot.clickText) { await page.getByText(shot.clickText, { exact: true }).first().click(); await page.waitForTimeout(2500); }
    if (shot.scrollLeft) await page.evaluate(() => { for (const element of document.querySelectorAll("#main-content *")) if (element.scrollLeft) element.scrollLeft = 0; });
    if (shot.scrollTo) {
      const target = page.locator(shot.scrollTo).first();
      await target.waitFor().catch(() => {});
      await target.evaluate((element, offset) => { const header = document.querySelector("header")?.getBoundingClientRect().bottom ?? 0; window.scrollTo(0, element.getBoundingClientRect().top + window.scrollY - header - offset); }, shot.scrollOffset ?? 0).catch(() => {});
    }
    await page.waitForTimeout(800);
    const box = await mainBox(page);
    const file = path.join(out, `${shot.name}.png`);
    await page.screenshot({ path: file, clip: { x: Math.round(box.x), y: Math.round(box.y + (shot.scrollTo ? 0 : 4)), width: Math.round(box.width), height: cssH } });
    await save(file, shot.name, shot.w, shot.h);
  }
  await page.context().close();
}

// The operator terminal at 1400 px from its own header (the demo's note above it is left out), with the demo open first so
// the report becomes a work order there.
async function operator(browser) {
  if (!wanted("felanmalan-operatorsterminal") && !wanted("felanmalan-skickad-blir-arbetsorder")) return;
  const context = await browser.newContext({ viewport: { width: 1400, height: 1000 }, deviceScaleFactor: 1, locale: "sv-SE", timezoneId: "Europe/Stockholm" });
  await context.addInitScript(hide, HIDE);
  const workflow = await context.newPage();
  await workflow.goto(`${base}/demo`, { timeout: 300_000 });
  await workflow.waitForURL("**/?view=**");
  await workflow.waitForTimeout(3000);
  const page = await context.newPage();
  page.setDefaultTimeout(120_000);
  await page.goto(`${base}/operator/demo?demokoppling=1`, { timeout: 300_000 });
  await page.getByTestId("op-report").waitFor();
  await page.getByTestId("op-tree").first().locator("[data-place-id='m-flakt-f1']").first().click();
  await page.getByTestId("op-cause-1").click();
  await page.getByTestId("op-text-input").fill("Fläkten låter ovanligt och vibrerar mer än vanligt.");
  await page.getByTestId("op-severity-HIGH").click();
  await page.waitForTimeout(800);
  await page.mouse.move(5, 5);
  const headerTop = () => page.getByTestId("operator-company").evaluate((element) => (element.closest("header")?.getBoundingClientRect().top ?? 0) + window.scrollY);
  let file = path.join(out, "felanmalan-operatorsterminal.png");
  await page.screenshot({ path: file, clip: { x: 0, y: await headerTop(), width: 1400, height: 904 } });
  await save(file, "felanmalan-operatorsterminal", 1400, 904);
  await page.getByTestId("op-send").click();
  for (let tries = 0; tries < 60 && !(await page.getByTestId("op-receipt").count()); tries++) {
    const skip = page.getByTestId("op-ai-skip");
    if (await skip.isVisible().catch(() => false)) await skip.click();
    await page.waitForTimeout(1000);
  }
  await page.getByTestId("op-receipt").waitFor();
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.waitForTimeout(1500);
  file = path.join(out, "felanmalan-skickad-blir-arbetsorder.png");
  await page.screenshot({ path: file, clip: { x: 0, y: await headerTop(), width: 1400, height: 681 } });
  await save(file, "felanmalan-skickad-blir-arbetsorder", 1400, 681);
  await context.close();
}

// Kom igång › Företaget with the demo company's invented facts, the whole step in the picture (1353 × 760): the main area is
// made as wide as the step needs to fit the picture's height, then scaled down.
async function guide(browser) {
  if (!wanted("guide-foretaget")) return;
  const W = 1353, H = 760;
  const context = await browser.newContext({ viewport: { width: 1700, height: 1200 }, deviceScaleFactor: 2, locale: "sv-SE", timezoneId: "Europe/Stockholm" });
  await context.addInitScript(hide, HIDE);
  const page = await context.newPage();
  page.setDefaultTimeout(180_000);
  await page.goto(`${base}/qa`, { timeout: 300_000 });
  await page.getByRole("button", { name: "Öppna testarbetsytan" }).click();
  await page.waitForURL((url) => !url.pathname.startsWith("/qa"));
  await page.goto(`${base}/?view=setup`, { timeout: 300_000 });
  const step = page.getByTestId("setup-guide");
  await step.waitFor();
  for (let index = 0; index < 6 && !(await step.getByLabel("Bankgiro").count()); index++) {
    const skip = step.getByRole("button", { name: "Hoppa över", exact: true });
    if (await skip.count()) await skip.click(); else await step.getByTestId("setup-next").click();
    await page.waitForTimeout(800);
  }
  const fill = async (label, value) => { const field = step.getByLabel(label, { exact: true }); if (await field.count()) await field.first().fill(value); };
  for (const [label, value] of [["Organisationsnummer", ""], ["Företagets namn", "Kopplingsbyrån AB"], ["Adress", "Strömtångsvägen 7"], ["Postnummer", "123 45"], ["Ort", "Exempelstad"], ["Kontaktperson", "Elna Strömtång"], ["E-post", "info@exempelel.invalid"], ["Telefon", "070-174 06 05"]]) await fill(label, value);
  await page.locator("body").click({ position: { x: 5, y: 5 } });
  // From the progress line to the step's buttons; the width that gives the picture's proportions, measured twice.
  const area = async () => page.evaluate(() => {
    const top = document.querySelector("[data-testid=setup-progress]").getBoundingClientRect().top - 12;
    const guideBox = document.querySelector("[data-testid=setup-guide]").getBoundingClientRect();
    const main = document.querySelector("#main-content").getBoundingClientRect();
    return { top: top + window.scrollY, bottom: guideBox.bottom + window.scrollY + 16, x: main.left, width: main.width };
  });
  for (let round = 0; round < 3; round += 1) {
    const box = await area();
    const width = Math.max(W, Math.round((box.bottom - box.top) * W / H));
    if (Math.abs(box.width - width) < 4) break;
    await page.setViewportSize({ width: Math.round(box.x + width), height: Math.round(box.bottom - box.top + 300) });
    await page.waitForTimeout(800);
  }
  const box = await area();
  const file = path.join(out, "guide-foretaget.png");
  await page.screenshot({ path: file, fullPage: true, clip: { x: Math.round(box.x), y: Math.round(box.top), width: Math.round(box.width), height: Math.round(box.width * H / W) } });
  await save(file, "guide-foretaget", W, H);
  await context.close();
}

(async () => {
  const browser = await chromium.launch({ args: ["--no-sandbox"] });
  try {
    await desk(browser);
    await operator(browser);
    await guide(browser);
  } finally { await browser.close(); }
})().catch((error) => { console.error(error); process.exitCode = 1; });
