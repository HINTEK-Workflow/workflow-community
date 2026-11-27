#!/usr/bin/env node
/* eslint-disable @typescript-eslint/no-require-imports -- Local helper (CommonJS, no build step). */
// Bilden "Dator, surfplatta och mobil" (public/landing/workflow-enheter*.webp, ärende #10, 2026-11-25): real screenshots of the
// public demo (invented data only) placed in our own drawn, generic device frames (no maker's logo, no third party's mockup).
//
//   node scripts/qa/dev-server.cjs --port 3014 [--env-from <checkout with .env>]   a local dev server (loopback, kfid_v3_test)
//   node scripts/landing/render-devices.cjs [--base http://localhost:3014] [--out tmp/landing-devices] [--write]
//
// 1. Screenshots, each at the device's own size: the computer 1440 × 900 (the browser's bar drawn above the page, so the page is
//    1440 × 862), the tablet 834 × 1194 upright (the operator terminal, the status bar drawn above), the phone 390 × 844 in the
//    app's phone view (the status bar drawn above, so the page is 390 × 797). deviceScaleFactor 2 (the phone 3).
// 2. The picture: devices.html is built in --out with each screenshot placed in its screen box in the device's own CSS pixels
//    (no stretching, no padding) and scaled as a whole to its place, rendered by Playwright with a transparent background at
//    2 × 1600 × 1067 = 3200 × 2134 px.
// 3. webp with alpha: the picture itself (3200 px) and copies 800, 1200, 1600 and 2400 px. With --write they are copied to
//    public/landing/workflow-enheter{,-800,-1200,-1600,-2400}.webp (the same names, so the page and the editor keep them); the
//    sizes are in LANDING_IMAGE_LIBRARY (ee/landing/landing-content.ts). Look at devices.png in --out before --write.
const { chromium } = require("playwright");
const sharp = require("sharp");
const path = require("node:path");
const fs = require("node:fs");

const arg = (name, fallback) => { const index = process.argv.indexOf(name); return index > 0 ? process.argv[index + 1] : fallback; };
const base = arg("--base", "http://localhost:3014");
const out = path.resolve(arg("--out", "tmp/landing-devices"));
const write = process.argv.includes("--write");
const reuse = process.argv.includes("--reuse"); // compose again from the screenshots already in --out
fs.mkdirSync(out, { recursive: true });

const W = 1600, H = 1067, SCALE = 2;
const VARIANTS = [800, 1200, 1600, 2400];
const NAME = "workflow-enheter";

// The device screens in their own CSS pixels.
const DESK = { w: 1440, h: 900, bar: 38 };
const TABLET = { w: 834, h: 1194, bar: 24 };
const PHONE = { w: 390, h: 844, bar: 47 };

const HIDE = ".cookie-notice,nextjs-portal,.workspace-toast,[data-testid=demo-header-mark],.floating-nav,.workspace-sidebar-note,div:has(> [data-testid=operator-demo-hint]){display:none!important}html{scrollbar-width:none!important}::-webkit-scrollbar{display:none!important;width:0!important;height:0!important}";
const hide = (css) => document.addEventListener("DOMContentLoaded", () => { const style = document.createElement("style"); style.textContent = css; document.head.append(style); });

async function demoContext(browser, options) {
  const context = await browser.newContext({ locale: "sv-SE", timezoneId: "Europe/Stockholm", ...options });
  await context.addInitScript(hide, HIDE);
  return context;
}
async function openDemo(context) {
  const page = await context.newPage();
  page.setDefaultTimeout(180_000);
  await page.goto(`${base}/demo`, { timeout: 300_000 });
  await page.waitForURL("**/?view=**", { timeout: 300_000 });
  await page.waitForFunction(() => Boolean(window.next?.router));
  const consent = page.getByTestId("consent-necessary");
  if (await consent.isVisible().catch(() => false)) await consent.click();
  return page;
}
async function go(page, href) {
  for (let attempt = 0; attempt < 30; attempt += 1) {
    await page.evaluate((target) => window.next.router.push(target), href);
    try { await page.waitForURL((url) => `${url.pathname}${url.search}` === href, { timeout: 2000 }); break; } catch { /* again */ }
  }
  await page.waitForLoadState("networkidle").catch(() => {});
  await page.waitForTimeout(2500);
}
const settle = async (page) => { await page.mouse.move(2, 2); await page.evaluate(() => { document.activeElement?.blur?.(); window.scrollTo(0, 0); }); await page.waitForTimeout(1200); };

async function shoot(browser) {
  saveClock();
  // The computer: Översikt › Teamet.
  let context = await demoContext(browser, { viewport: { width: DESK.w, height: DESK.h - DESK.bar }, deviceScaleFactor: 2 });
  let page = await openDemo(context);
  await go(page, "/?view=stats&tab=team");
  await settle(page);
  await page.screenshot({ path: path.join(out, "skarm-dator.png") });
  // The tablet: the operator terminal with a report being filled in, the demo open first.
  page = await context.newPage();
  page.setDefaultTimeout(180_000);
  await page.setViewportSize({ width: TABLET.w, height: TABLET.h - TABLET.bar });
  await page.goto(`${base}/operator/demo?demokoppling=1`, { timeout: 300_000 });
  await page.getByTestId("op-report").waitFor();
  await page.getByTestId("op-tree").first().locator("[data-place-id='m-flakt-f1']").first().click();
  await page.getByTestId("op-cause-1").click();
  await page.getByTestId("op-text-input").fill("Fläkten låter ovanligt och vibrerar mer än vanligt.");
  await page.getByTestId("op-severity-HIGH").click();
  await settle(page);
  await page.screenshot({ path: path.join(out, "skarm-surfplatta.png") });
  await context.close();
  // The phone: the app's phone view, Hem.
  context = await demoContext(browser, { viewport: { width: PHONE.w, height: PHONE.h - PHONE.bar }, deviceScaleFactor: 3, isMobile: true, hasTouch: true });
  page = await openDemo(context);
  await go(page, "/?view=stats");
  await settle(page);
  await page.screenshot({ path: path.join(out, "skarm-mobil.png") });
  await context.close();
}

/** The colour of the screenshot's top row, for the status bar drawn above it, and whether its text is light. */
async function topColour(file) {
  const { data } = await sharp(file).extract({ left: 0, top: 0, width: 40, height: 2 }).raw().toBuffer({ resolveWithObject: true });
  const [r, g, b] = [data[0], data[1], data[2]];
  return { css: `rgb(${r},${g},${b})`, light: 0.299 * r + 0.587 * g + 0.114 * b < 140 };
}
// The status bars show the time the screenshots were taken (kept in --out for --reuse), so the clock agrees with the app's greeting.
const clockFile = () => path.join(out, "klocka.txt");
const saveClock = () => fs.writeFileSync(clockFile(), new Intl.DateTimeFormat("sv-SE", { hour: "2-digit", minute: "2-digit", timeZone: "Europe/Stockholm" }).format(new Date()));
const readClock = () => (fs.existsSync(clockFile()) ? fs.readFileSync(clockFile(), "utf8").trim() : "08:00");
const dataUrl = (file) => `data:image/png;base64,${fs.readFileSync(file).toString("base64")}`;

// Small line icons of our own (status bar and browser bar).
const ICON = {
  signal: '<svg viewBox="0 0 18 12" width="18" height="12"><rect x="0" y="8" width="3" height="4" rx="1"/><rect x="5" y="5.5" width="3" height="6.5" rx="1"/><rect x="10" y="3" width="3" height="9" rx="1"/><rect x="15" y="0" width="3" height="12" rx="1"/></svg>',
  wifi: '<svg viewBox="0 0 16 12" width="16" height="12" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><path d="M1.5 4.5a9.5 9.5 0 0 1 13 0"/><path d="M4 7.3a6 6 0 0 1 8 0"/><circle cx="8" cy="10.2" r="1.1" fill="currentColor" stroke="none"/></svg>',
  battery: '<svg viewBox="0 0 27 12" width="27" height="12"><rect x="0.5" y="0.5" width="23" height="11" rx="3" fill="none" stroke="currentColor" stroke-opacity=".45"/><rect x="2" y="2" width="16" height="8" rx="1.6"/><rect x="24.6" y="4" width="1.8" height="4" rx=".9" fill-opacity=".45"/></svg>',
  back: '<svg viewBox="0 0 16 16" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M10 3 5 8l5 5"/></svg>',
  forward: '<svg viewBox="0 0 16 16" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="m6 3 5 5-5 5"/></svg>',
  reload: '<svg viewBox="0 0 16 16" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M13 8a5 5 0 1 1-1.5-3.6"/><path d="M13 2.5v3h-3"/></svg>',
  lock: '<svg viewBox="0 0 16 16" width="13" height="13" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"><rect x="3.5" y="7" width="9" height="6.5" rx="1.5"/><path d="M5.5 7V5a2.5 2.5 0 0 1 5 0v2"/></svg>',
};

function statusBar({ bar }, colour, big) {
  const ink = colour.light ? "#fff" : "#0b1220";
  const size = big ? 17 : 13;
  return `<div style="height:${bar}px;background:${colour.css};color:${ink};fill:${ink};display:flex;align-items:center;justify-content:space-between;padding:${big ? "6px 30px 0 34px" : "0 18px"};font:600 ${size}px/1 system-ui,'Segoe UI',sans-serif;letter-spacing:.01em">
    <span>${readClock()}</span><span style="display:flex;gap:${big ? 7 : 6}px;align-items:center">${ICON.signal}${ICON.wifi}${ICON.battery}</span></div>`;
}

function browserBar() {
  return `<div style="height:${DESK.bar}px;background:#e9ecf1;border-bottom:1px solid #d3d8e0;display:flex;align-items:center;gap:14px;padding:0 14px;color:#5b6472;font:13px/1 system-ui,'Segoe UI',sans-serif">
    <span style="display:flex;gap:10px">${ICON.back}${ICON.forward}${ICON.reload}</span>
    <span style="flex:0 1 560px;height:26px;border-radius:13px;background:#fff;display:flex;align-items:center;gap:7px;padding:0 12px;color:#1f2937">${ICON.lock}app.hintekwork.com</span></div>`;
}

/** A device placed at (x, y) with the screen `screen.w` CSS px drawn `width` wide. */
function device({ x, y, width, screen, bezel, radius, inner, content, kind }) {
  const scale = width / screen.w;
  const bw = bezel / scale, r = radius / scale, ri = inner / scale; // in the device's own pixels, scaled as a whole
  const outerW = screen.w + 2 * bw, outerH = screen.h + 2 * bw;
  const camera = kind === "phone"
    ? `<div style="position:absolute;left:50%;top:${bw + 11}px;width:11px;height:11px;margin-left:-5.5px;border-radius:50%;background:#050608;box-shadow:inset 0 0 0 2px #15181d;z-index:3"></div>`
    : `<div style="position:absolute;left:50%;top:${bw / 2 - 4}px;width:8px;height:8px;margin-left:-4px;border-radius:50%;background:#1b1f26;box-shadow:inset 0 0 0 1.5px #2b3039"></div>`;
  return `<div class="device ${kind}" style="left:${x}px;top:${y}px;width:${outerW}px;height:${outerH}px;transform:scale(${scale});border-radius:${r}px">
    ${camera}
    <div class="screen" style="left:${bw}px;top:${bw}px;width:${screen.w}px;height:${screen.h}px;border-radius:${ri}px">${content}<div class="glass" style="border-radius:${ri}px"></div></div></div>`;
}

async function compose(browser) {
  const shot = (name) => path.join(out, `skarm-${name}.png`);
  const [tabletTop, phoneTop] = [await topColour(shot("surfplatta")), await topColour(shot("mobil"))];
  const img = (file, w, h) => `<img src="${dataUrl(file)}" width="${w}" height="${h}" style="display:block;width:${w}px;height:${h}px">`;

  // The computer: a thin, even bezel, a stand of a neck and a foot.
  const deskWidth = 1010;
  const deskScale = deskWidth / DESK.w;
  const desk = device({ x: 24, y: 60, width: deskWidth, screen: DESK, bezel: 13, radius: 18, inner: 5, kind: "desk",
    content: browserBar() + img(shot("dator"), DESK.w, DESK.h - DESK.bar) });
  const deskBottom = 60 + (DESK.h + 2 * 13 / deskScale) * deskScale;
  const deskCentre = 24 + (DESK.w + 2 * 13 / deskScale) * deskScale / 2;
  const stand = `<div class="neck" style="left:${deskCentre - 72}px;top:${deskBottom - 2}px;width:144px;height:150px"></div>
    <div class="foot" style="left:${deskCentre - 175}px;top:${deskBottom + 146}px;width:350px;height:16px"></div>
    <div class="foot-shadow" style="left:${deskCentre - 230}px;top:${deskBottom + 150}px;width:460px;height:34px"></div>`;
  const tablet = device({ x: 916, y: 392, width: 420, screen: TABLET, bezel: 15, radius: 34, inner: 20, kind: "tablet",
    content: statusBar(TABLET, tabletTop, false) + img(shot("surfplatta"), TABLET.w, TABLET.h - TABLET.bar) });
  const phone = device({ x: 1368, y: 600, width: 200, screen: PHONE, bezel: 9, radius: 40, inner: 31, kind: "phone",
    content: statusBar(PHONE, phoneTop, true) + img(shot("mobil"), PHONE.w, PHONE.h - PHONE.bar) });

  const html = `<!doctype html><html><head><meta charset="utf-8"><style>
    html,body{margin:0;background:transparent}
    .stage{position:relative;width:${W}px;height:${H}px;overflow:hidden}
    .device{position:absolute;transform-origin:0 0;background:linear-gradient(160deg,#1c2027,#0b0d11 55%,#15181e);
      box-shadow:inset 0 0 0 1.5px #3a404a,inset 0 0 0 3px #0a0c0f}
    .screen{position:absolute;overflow:hidden;background:#fff}
    .glass{position:absolute;inset:0;pointer-events:none;background:linear-gradient(118deg,rgba(255,255,255,.07) 0%,rgba(255,255,255,.025) 38%,rgba(255,255,255,0) 38.2%)}
    .desk{filter:drop-shadow(0 24px 34px rgba(15,23,42,.20)) drop-shadow(0 6px 10px rgba(15,23,42,.12))}
    .tablet,.phone{filter:drop-shadow(0 28px 36px rgba(15,23,42,.26)) drop-shadow(0 8px 12px rgba(15,23,42,.16))}
    .neck{position:absolute;clip-path:polygon(14% 0,86% 0,100% 100%,0 100%);background:linear-gradient(90deg,#9aa1ab,#e3e6ea 30%,#f4f5f7 50%,#d4d8dd 72%,#8e959f)}
    .foot{position:absolute;border-radius:8px 8px 6px 6px;background:linear-gradient(180deg,#f2f3f5,#c9cdd3 70%,#a9afb7);z-index:2}
    .foot-shadow{position:absolute;border-radius:50%;background:radial-gradient(closest-side,rgba(15,23,42,.30),rgba(15,23,42,0));z-index:1}
  </style></head><body><div class="stage">${stand}${desk}${tablet}${phone}</div></body></html>`;
  fs.writeFileSync(path.join(out, "devices.html"), html);
  const context = await browser.newContext({ viewport: { width: W, height: H }, deviceScaleFactor: SCALE });
  const page = await context.newPage();
  await page.setContent(html, { waitUntil: "load" });
  await page.evaluate(() => Promise.all([...document.images].map((image) => image.decode())));
  const png = path.join(out, "devices.png");
  await page.screenshot({ path: png, omitBackground: true });
  await context.close();
  const files = [[`${NAME}.webp`, W * SCALE], ...VARIANTS.map((width) => [`${NAME}-${width}.webp`, width])];
  for (const [file, width] of files) {
    await sharp(png).resize({ width }).webp({ quality: width >= 2400 ? 80 : 84, alphaQuality: 90, effort: 6, smartSubsample: true }).toFile(path.join(out, file));
    const meta = await sharp(path.join(out, file)).metadata();
    console.log("ok", file, `${meta.width}x${meta.height}`, `${Math.round(fs.statSync(path.join(out, file)).size / 1024)} kB`);
  }
  if (write) for (const [file] of files) fs.copyFileSync(path.join(out, file), path.resolve(__dirname, "../../public/landing", file));
}

(async () => {
  const browser = await chromium.launch({ args: ["--no-sandbox"] });
  try {
    if (!reuse) await shoot(browser);
    await compose(browser);
  } finally { await browser.close(); }
})().catch((error) => { console.error(error); process.exitCode = 1; });
