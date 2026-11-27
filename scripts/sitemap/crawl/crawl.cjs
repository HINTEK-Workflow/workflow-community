/* eslint-disable @typescript-eslint/no-require-imports -- QA helper (CommonJS): the click robot. */
/* Klickroboten (analysen 2026-10-24, webbplatskartan): bara läsning – goto, länkar, flikar, hopfällning och popupar som bara
 * visar. Per sida: rubrik, konsolfel, HTTP 4xx/5xx, axe-core, text utanför skärmen, små pekytor (telefon); sist Bakåt-prov.
 *   node scripts/sitemap/crawl/crawl.cjs <role> <device> [max]   role: superadmin|admin|member  device: desktop|phone
 * Utdata: <SITEMAP_CRAWL_OUT>/<role>-<device>.json (se config.cjs); sammanfattas med summarize.cjs. */
const fs = require("fs");
const path = require("path");
const { OUT, SHOTS, BASES, DEVICES, chromium, axeSource, signIn } = require("./config.cjs");
const AXE = axeSource();

const role = process.argv[2], device = process.argv[3], MAX = Number(process.argv[4] || 250);
const BASE = BASES[role];
if (!BASE || !DEVICES[device]) { console.error("node crawl.cjs <superadmin|admin|member> <desktop|phone> [max]"); process.exit(2); }
const RUN = `${role}-${device}`;
fs.mkdirSync(SHOTS, { recursive: true });

// Knappar som aldrig klickas (skapar, raderar, skickar, betalar, loggar ut, byter företag, ändrar inställningar).
const DENY = /spara|skapa|ta bort|radera|släng|papperskorg|töm|skicka|mejla|betala|köp|beställ|logga ut|byt företag|bjud in|starta|avsluta|godkänn|signera|importera|exportera|ladda|kopiera|arkivera|återställ|nollställ|generera|koppla|lägg till|^\+|^ny\b|^nytt|ny |lås|aktivera|inaktivera|stäng av|slå på|tillämpa|bekräfta|klar|markera|ändra|redigera|byt|välj fil|uppdatera|synka|testa|prova|kör|beräkna|skanna|foto|kamera|ring|visa som|säg upp|spärra|återkalla|förnya|rotera|ersätt|flytta|dela|publicera|släpp|skriv ut|pdf|fortsätt|nästa|föregående|avböj|acceptera|tillåt|neka|godta|anslut|logga in|registrera|hämta|sök efter|fyll|rensa|ångra|stäng|avbryt|tillbaka|bakåt|framåt|kakor|nödvändiga|alla kakor|tema|mörkt|ljust|textstorlek|spela|stoppa|pausa|fäst|lossa|följ|prenumerera|klistra|svara|ai fyller|tips|förslag|tolka|analysera|översätt|ring|sms|bifoga|filtrera bort|dölj|visa inte/i;
// Knappar som får klickas: hopfällning, visande popupar, flikar, menyer.
const ALLOW = /^(visa|öppna|mer|hjälp|om |info|detaljer|kalkylator|sök|hintek ai|filter|sortera|teamet|jag|uppgifter|projekt|meny|profilmeny|visa verktygen|verktyg|vad betyder|förklaring|läs mer|›|⌄)/i;

const norm = (u) => {
  let url; try { url = new URL(u, BASE); } catch { return null; }
  const keys = [...url.searchParams.keys()].sort();
  const q = keys.map((k) => { const v = url.searchParams.get(k); return `${k}=${/^(c[a-z0-9]{20,}|[0-9a-f-]{20,}|\d{3,}|[A-Za-z0-9_-]{24,})$/.test(v) || /Id$|^edit$|^id$/.test(k) && v !== "1" ? "…" : v}`; }).join("&");
  return url.pathname + (q ? "?" + q : "") + (url.hash && url.hash !== "#main-content" ? url.hash : "");
};
const skipHref = (h) => !h || /^(mailto:|tel:|javascript:|#)/.test(h) || /\/(qa|login|logout|signout|demo|invite|forgot-password|reset-password)(\/|\?|$)|\/api\/auth|logout|signout/.test(h);

(async () => {
  const browser = await chromium.launch();
  const context = await browser.newContext({ ...DEVICES[device], locale: "sv-SE", timezoneId: "Europe/Stockholm" });
  const page = await context.newPage();
  page.setDefaultTimeout(8000);
  const rawGoto = page.goto.bind(page);
  page.goto = async (u, o) => { for (let i = 0; ; i++) { try { return await rawGoto(u, o); } catch (e) { if (i < 3 && /ERR_ABORTED|interrupted/.test(e.message)) { await new Promise((r) => setTimeout(r, 1200)); continue; } throw e; } } };
  let cur = { console: [], pageerrors: [], http: [] };
  page.on("console", (m) => { if (m.type() === "error") cur.console.push(m.text().slice(0, 400)); });
  page.on("pageerror", (e) => cur.pageerrors.push(String(e && e.message || e).slice(0, 400)));
  page.on("response", (r) => { const s = r.status(); if (s >= 400) cur.http.push(`${r.request().method()} ${s} ${r.url().replace(BASE, "")}`.slice(0, 300)); });
  page.on("dialog", (d) => d.dismiss().catch(() => {}));

  await signIn(page, BASE);
  await page.waitForTimeout(1500);
  const cookie = page.getByRole("button", { name: "Bara nödvändiga" });
  if (await cookie.count()) await cookie.first().click().catch(() => {});
  const start = page.url();

  const timing = []; const clickErrors = []; const triedViews = new Set(); const queue = []; const seen = new Map(); // pattern → {url, from, via}
  const edges = []; const pages = []; const popups = []; const backChecks = []; const apiChecks = [];
  const enqueue = (href, from, via, how) => {
    if (skipHref(href)) return;
    let abs; try { abs = new URL(href, BASE); } catch { return; }
    if (abs.origin !== new URL(BASE).origin) return;
    const key = norm(abs.href); if (!key) return;
    edges.push({ from, to: key, via: (via || "").replace(/\s+/g, " ").trim().slice(0, 60), how });
    if (abs.pathname.startsWith("/api/")) { if (!apiChecks.find((a) => a.key === key)) apiChecks.push({ key, url: abs.href }); return; }
    if (!seen.has(key)) { seen.set(key, { url: abs.href, from, via }); queue.push(key); }
  };
  enqueue(start, "(inloggning)", "start", "start");

  const settle = async () => {
    await page.waitForLoadState("domcontentloaded").catch(() => {});
    await page.locator("h1, [data-testid='native-top-title']").first().waitFor({ timeout: 6000 }).catch(() => {});
    await page.waitForTimeout(700);
  };

  const collectLinks = async () => page.evaluate(() => [...document.querySelectorAll("a[href]")].filter((a) => {
    const b = a.getBoundingClientRect(); const s = getComputedStyle(a); return b.width > 0 && b.height > 0 && s.visibility !== "hidden";
  }).map((a) => ({ href: a.getAttribute("href"), text: (a.getAttribute("aria-label") || a.textContent || "").trim().slice(0, 60), where: a.closest("nav")?.getAttribute("aria-label") || (a.closest("[role=dialog]") ? "dialog" : "") })));

  const measure = async (phone) => page.evaluate((phone) => {
    const vw = document.documentElement.clientWidth;
    const vis = (e) => { const s = getComputedStyle(e); const b = e.getBoundingClientRect(); return s.visibility !== "hidden" && s.display !== "none" && b.width > 0 && b.height > 0 && !e.closest("[aria-hidden=true],[inert]"); };
    const sel = (e) => { const t = e.getAttribute("data-testid"); return e.tagName.toLowerCase() + (t ? `[data-testid=${t}]` : "") + (e.id ? "#" + e.id : "") + (typeof e.className === "string" && e.className ? "." + e.className.split(/\s+/).slice(0, 3).join(".") : ""); };
    const h1 = [...document.querySelectorAll("h1")].filter((h) => vis(h) || h.classList.contains("sr-only")).map((h) => h.textContent.trim());
    const topTitle = [...document.querySelectorAll("[data-testid='native-top-title']")].filter(vis).map((h) => (h.getAttribute("aria-label") || h.textContent).trim());
    const crumbs = [...document.querySelectorAll("[data-testid=breadcrumbs]")].filter(vis).map((n) => [...n.querySelectorAll("li")].map((l) => l.textContent.trim()).filter(Boolean).join(" › "));
    const crumbCurrent = [...document.querySelectorAll("[data-testid=breadcrumb-current]")].filter(vis).map((n) => n.textContent.trim());
    const hScroll = document.documentElement.scrollWidth - vw;
    const outside = []; const clipped = [];
    for (const e of document.querySelectorAll("body *")) {
      if (!vis(e) || e.closest("[data-testid=sitemap-svg],svg,canvas,[data-scroll-x],.overflow-x-auto,[class*=overflow-x-auto],[class*=snap-x]")) continue;
      const own = [...e.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim());
      if (!own) continue;
      const b = e.getBoundingClientRect();
      if (b.right > vw + 1 || b.left < -1) { if (b.top < 20000) outside.push({ sel: sel(e), text: e.textContent.trim().slice(0, 60), right: Math.round(b.right) }); continue; }
      const s = getComputedStyle(e);
      if (e.scrollWidth > e.clientWidth + 2 && s.textOverflow !== "ellipsis" && /hidden|clip/.test(s.overflowX + s.overflow) && !/sr-only/.test(e.className)) clipped.push({ sel: sel(e), text: e.textContent.trim().slice(0, 60), sw: e.scrollWidth, cw: e.clientWidth });
      if (e.scrollHeight > e.clientHeight + 3 && s.textOverflow !== "ellipsis" && /hidden|clip/.test(s.overflowY) && !s.webkitLineClamp?.match(/\d/) && e.clientHeight > 0 && !/sr-only/.test(e.className)) clipped.push({ sel: sel(e), text: e.textContent.trim().slice(0, 60), sh: e.scrollHeight, ch: e.clientHeight, axis: "y" });
    }
    const small = [];
    if (phone) {
      for (const e of document.querySelectorAll("a[href],button,input:not([type=hidden]),select,[role=button],[role=tab],[role=switch],[role=radio],[role=checkbox],summary")) {
        if (!vis(e)) continue;
        const b = e.getBoundingClientRect();
        if (b.bottom < 0 || b.top > 4000) continue;
        const a = getComputedStyle(e, "::after");
        let w = b.width, h = b.height;
        if (a.content && a.content !== "none" && a.position === "absolute") { const t = parseFloat(a.top) || 0, l = parseFloat(a.left) || 0; w = b.width - 2 * Math.min(0, l); h = b.height - 2 * Math.min(0, t); }
        if (e.tagName === "INPUT" && /checkbox|radio/.test(e.type) && e.closest("label")) continue;
        const inline = e.tagName === "A" && e.closest("p,li") && getComputedStyle(e).display === "inline";
        if ((w < 43.5 || h < 43.5) && !inline) small.push({ sel: sel(e), text: (e.getAttribute("aria-label") || e.textContent || "").trim().slice(0, 40), w: Math.round(w), h: Math.round(h) });
      }
    }
    const back = !!document.querySelector("[data-testid$='-back'],[data-testid=floating-nav-back]");
    const crumbLink = !!document.querySelector("[data-testid=breadcrumb-link]");
    const tabbar = !!(document.querySelector("[data-testid=native-tab-bar]") && vis(document.querySelector("[data-testid=native-tab-bar]")));
    const sidebar = !!document.querySelector("aside nav a[href]");
    const text = (document.querySelector("main") || document.body).innerText.slice(0, 600);
    return { h1, topTitle, crumbs, crumbCurrent, hScroll, outside: outside.slice(0, 10), outsideCount: outside.length, clipped: clipped.slice(0, 10), clippedCount: clipped.length, small: small.slice(0, 15), smallCount: small.length, back, crumbLink, tabbar, sidebar, native: document.documentElement.dataset.native || null, title: document.title, text };
  }, phone);

  const axe = async () => {
    try {
      if (!(await page.evaluate(() => !!window.axe))) await page.addScriptTag({ content: AXE });
      return await page.evaluate(async () => { const r = await window.axe.run(document, { runOnly: { type: "tag", values: ["wcag2a", "wcag2aa", "wcag21aa", "wcag22aa"] }, resultTypes: ["violations"] }); return r.violations.map((v) => ({ id: v.id, impact: v.impact, help: v.help, nodes: v.nodes.slice(0, 4).map((n) => ({ target: n.target.join(" "), html: n.html.slice(0, 160), summary: (n.failureSummary || "").slice(0, 200) })), count: v.nodes.length })); });
    } catch (e) { return [{ id: "axe-error", help: String(e.message).slice(0, 200) }]; }
  };

  // Popupar/fällningar som bara visar: klickas, mäts, stängs med Escape.
  const tryPopups = async (key, phone) => {
    const cands = await page.evaluate(({ allow, deny }) => {
      const A = new RegExp(allow, "i"), D = new RegExp(deny, "i");
      const vis = (e) => { const b = e.getBoundingClientRect(); return b.width > 0 && b.height > 0 && getComputedStyle(e).visibility !== "hidden" && !e.closest("[aria-hidden=true],[inert]"); };
      const out = [];
      document.querySelectorAll("button,[role=tab],summary").forEach((e, i) => {
        if (!vis(e) || e.disabled) return;
        const name = (e.getAttribute("aria-label") || e.textContent || "").trim().replace(/\s+/g, " ");
        const isTab = e.getAttribute("role") === "tab";
        const toggles = e.getAttribute("aria-expanded") === "false" || e.hasAttribute("aria-haspopup") || e.tagName === "SUMMARY";
        if (!name || D.test(name)) return;
        if (!(isTab || (toggles && (A.test(name) || e.closest("[data-collapsible],[data-slot=card-header],section header,.card-header"))) || A.test(name))) return;
        e.setAttribute("data-robot", String(i)); out.push({ id: String(i), name: name.slice(0, 60), isTab, toggles });
      });
      return out;
    }, { allow: ALLOW.source, deny: DENY.source });
    const found = [];
    const remark = () => page.evaluate(() => { document.querySelectorAll("button,[role=tab],summary").forEach((e, i) => e.setAttribute("data-robot", String(i))); }, { allow: ALLOW.source, deny: DENY.source });
    for (const c of cands.slice(0, 7)) {
      const before = page.url();
      try {
        const el = page.locator(`[data-robot="${c.id}"]`);
        if (!(await el.count())) continue;
        const t0 = Date.now(); await el.first().click({ timeout: 1500 }); timing.push(Date.now() - t0);
        await page.waitForTimeout(600);
        const after = page.url();
        if (norm(after) !== norm(before)) { enqueue(after, key, c.name, c.isTab ? "flik" : "knapp"); await page.goto(before).catch(() => {}); await settle(); continue; }
        const dlg = await page.evaluate(() => { const d = [...document.querySelectorAll("[role=dialog],[role=alertdialog],[role=menu],[role=listbox]")].filter((e) => e.getBoundingClientRect().width > 0); return d.map((e) => ({ label: e.getAttribute("aria-label") || document.getElementById(e.getAttribute("aria-labelledby") || "")?.textContent || e.querySelector("h1,h2,h3,[role=heading]")?.textContent || "", role: e.getAttribute("role"), links: [...e.querySelectorAll("a[href]")].map((a) => ({ href: a.getAttribute("href"), text: a.textContent.trim().slice(0, 50) })), hOver: e.scrollWidth - e.clientWidth, right: Math.round(e.getBoundingClientRect().right) })); });
        if (dlg.length) {
          const m = await measure(phone);
          popups.push({ page: key, button: c.name, dialogs: dlg.map((d) => ({ ...d, links: d.links.length })), clipped: m.clipped, outside: m.outside, small: phone ? m.small : [], hScroll: m.hScroll, console: cur.console.slice(-3) });
          for (const d of dlg) for (const l of d.links) enqueue(l.href, key, `${c.name} → ${l.text}`, "popup");
          await page.goto(before).catch(() => {}); await settle(); await remark();
          found.push(c.name);
        } else if (c.toggles || c.isTab) {
          for (const l of await collectLinks()) enqueue(l.href, key, `${c.name} → ${l.text}`, c.isTab ? "flik" : "fällning");
        }
        if (norm(page.url()) !== norm(before)) { await page.goto(before).catch(() => {}); await settle(); }
      } catch (e) { clickErrors.push(c.name + ": " + String(e.message).split(/\n/)[0].slice(0, 120)); await page.goto(before).catch(() => {}); await settle(); await remark(); }
    }
    return found;
  };

  const phone = device === "phone";
  // Telefonens Mer och Ny: raderna är länkar.
  if (phone) {
    for (const [tab, label] of [["native-tab-more", "Mer"], ["native-tab-new", "Ny"]]) {
      try { await page.getByTestId(tab).click(); await page.waitForTimeout(600); for (const l of await collectLinks()) enqueue(l.href, `${norm(start)} [${label}]`, `${label} → ${l.text}`, label === "Mer" ? "mer" : "ny"); await page.keyboard.press("Escape"); await page.goto(start); await settle(); } catch (e) { console.error(tab, e.message); }
    }
  }

  let n = 0;
  while (queue.length && n < MAX) {
    const key = queue.shift(); const info = seen.get(key); n++;
    cur = { console: [], pageerrors: [], http: [] };
    let status = "ok", finalUrl = info.url, err = null;
    try {
      const r = await page.goto(info.url, { timeout: 20000 });
      if (r && r.status() >= 400) status = `http ${r.status()}`;
      await settle();
      finalUrl = page.url();
    } catch (e) { status = "fel"; err = e.message.slice(0, 200); }
    const m = await measure(phone).catch((e) => ({ error: e.message }));
    const links = await collectLinks().catch(() => []);
    for (const l of links) enqueue(l.href, key, l.text, l.where || "länk");
    const ax = n <= 120 || n % 2 === 0 ? await axe() : null;
    const vkey = (() => { const u = new URL(info.url); return u.pathname + "|" + (u.searchParams.get("view") || "") + "|" + (u.searchParams.get("section") || "") + "|" + (u.searchParams.get("step") || "") + "|" + (u.searchParams.get("taskType") || ""); })();
    const tp = Date.now(); const pop = triedViews.has(vkey) ? [] : (triedViews.add(vkey), await tryPopups(key, phone).catch(() => []));
    const popMs = Date.now() - tp;
    const rec = { n, key, url: info.url, from: info.from, via: info.via, status, err, final: norm(finalUrl), redirected: norm(finalUrl) !== key, ...m, links: links.length, popMs, axe: ax, popups: pop, console: cur.console, pageerrors: cur.pageerrors, http: cur.http };
    const bad = rec.pageerrors.length || rec.console.length || rec.http.length || (m.hScroll > 1) || (!m.h1?.length && !m.topTitle?.length) || m.outsideCount;
    if (bad) { const f = `${RUN}-${String(n).padStart(3, "0")}.png`; await page.screenshot({ path: path.join(SHOTS, f) }).catch(() => {}); rec.shot = f; }
    pages.push(rec);
    process.stdout.write(`${RUN} ${n}/${n + queue.length} ${key} ${status} pop=${popMs}ms${rec.redirected ? " → " + rec.final : ""}\n`);
  }

  // Bakåt: klick på en länk från A till B, sedan webbläsarens Bakåt (och appens ‹ på telefon) på ett urval.
  const sample = pages.filter((p) => p.status === "ok").filter((_, i) => i % Math.max(1, Math.floor(pages.length / 30)) === 0).slice(0, 30);
  for (const p of sample) {
    try {
      await page.goto(p.url); await settle();
      const a = await page.evaluate(() => { const l = [...document.querySelectorAll("main a[href^='/?'], main a[href^='?']")].filter((a) => a.getBoundingClientRect().width > 0 && !/logout/.test(a.href)); const x = l[Math.floor(l.length / 2)]; if (!x) return null; x.setAttribute("data-robot-back", "1"); return { href: x.getAttribute("href"), text: x.textContent.trim().slice(0, 50) }; });
      if (!a) continue;
      const A = norm(page.url());
      await page.locator("[data-robot-back]").first().click({ timeout: 4000 }); await settle();
      const B = norm(page.url());
      if (B === A) continue;
      await page.goBack(); await settle();
      const back = norm(page.url());
      const rec = { from: A, via: a.text, to: B, browserBack: back, ok: back === A };
      if (phone) {
        await page.goForward(); await settle();
        const btn = page.locator("[data-testid='native-top-back'],[data-testid$='-back']:not([data-testid^=floating-nav])").first();
        if (await btn.count() && await btn.isVisible()) { const label = await btn.innerText().catch(() => ""); await btn.click(); await settle(); rec.appBack = norm(page.url()); rec.appBackLabel = label.trim(); await page.waitForTimeout(1200); }
      }
      backChecks.push(rec);
    } catch (e) { backChecks.push({ from: p.key, error: e.message.slice(0, 120) }); }
  }

  // API-länkar (GET): bara status.
  for (const a of apiChecks.slice(0, 40)) { try { const r = await context.request.get(a.url, { maxRedirects: 0 }); a.status = r.status(); a.type = r.headers()["content-type"]; } catch (e) { a.status = "fel " + e.message.slice(0, 80); } }

  fs.writeFileSync(path.join(OUT, `${RUN}.json`), JSON.stringify({ run: RUN, base: BASE, start, visited: pages.length, queued: queue.length, pages, edges, popups, backChecks, apiChecks, clickErrors }, null, 1));
  console.log(`KLAR ${RUN}: ${pages.length} sidor, ${queue.length} kvar i kön, ${edges.length} kanter, ${popups.length} popupar`);
  await browser.close();
})().catch((e) => { console.error("FEL", RUN, e); process.exit(1); });
