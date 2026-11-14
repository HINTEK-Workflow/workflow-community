/* eslint-disable @typescript-eslint/no-require-imports -- Build helper (CommonJS): the robot's raw output as scripts/sitemap/observed.json. */
/*
 * Webbplatskartan mot appen (2026-10-24: "är testet gjort i webbplatskartan?"): reads the click robot's raw output
 * (crawl.cjs, roles.cjs, back.cjs, recheck.cjs → <out>/*.json) and writes the compact, committed scripts/sitemap/observed.json
 * that the generator marks the map with. Only address patterns (ids as "…", free text and titles dropped), roles, devices,
 * statuses, dates and commits are kept – no names, no texts from the pages, no secrets.
 *
 *   node scripts/sitemap/crawl/summarize.cjs <out-dir> [--commit <short sha>] [--date YYYY-MM-DD] [--write <file>]
 *
 * The findings' status (rättat/öppet/avfärdat) comes from STATUS below: a rule per known finding, written after each round
 * of fixes (the analysis report). A finding no rule knows is "öppet".
 */
"use strict";
const fs = require("fs");
const path = require("path");
const { execFileSync } = require("child_process");

const RUNS = ["superadmin-desktop", "superadmin-phone", "admin-desktop", "admin-phone", "member-desktop", "member-phone"];
const ROLE_NAMES = ["superadmin", "admin", "member"];

// Parametrar i adressen: id:n blir "…", strukturen behålls, allt annat (titlar, datum, fri text) tas bort.
const STRUCTURE = new Set(["view", "step", "section", "tab", "tool", "new", "taskType", "type", "link", "scan", "landing", "edit"]);
const isId = (key) => /Id$/.test(key) || ["id", "round", "form", "person", "occurrence"].includes(key) && key !== "occurrence";
function pattern(raw) {
  let url;
  try { url = new URL(raw, "http://x"); } catch { return null; }
  const parts = [];
  for (const key of [...new Set(url.searchParams.keys())].sort()) {
    const value = url.searchParams.get(key) || "";
    if (isId(key)) parts.push(`${key}=…`);
    else if (STRUCTURE.has(key)) parts.push(`${key}=${/^[a-z0-9_-]{1,40}$/i.test(value) && value !== "…" ? value : "…"}`);
  }
  // view= first, the rest sorted: the same order as the app's own addresses.
  parts.sort((a, b) => (a.startsWith("view=") ? -1 : b.startsWith("view=") ? 1 : a.localeCompare(b)));
  return url.pathname + (parts.length ? `?${parts.join("&")}` : "");
}
const denied = (text) => /inte behörighet till den här sidan/.test(text || "");

// Status per känt fynd (analysrapporten 2026-10-24, rättningarna e56676ae, aa1da29e och 4769d86a).
const STATUS = [
  { kind: "axe", match: /^color-contrast .*#task-complete/, status: "rättat", commit: "aa1da29e", note: "Färdigställ som inte är klar är aria-disabled" },
  { kind: "axe", match: /^aria-required-children .*(data-line|space-y-2)/, status: "rättat", commit: "aa1da29e", note: "Offertens och inköpets rader har celler; tom offert är ingen tabell" },
  { kind: "axe", match: /^aria-required-children .*native-mine-empty/, status: "rättat", commit: "aa1da29e", note: "Tom Mina jobb-lista har rätt listroller" },
  { kind: "axe", match: /^aria-required-parent/, status: "rättat", commit: "aa1da29e", note: "Tom platslista har rätt listroller" },
  { kind: "axe", match: /^color-contrast .*bg-white/, status: "rättat", commit: "aa1da29e", note: "Saldo-brickan har kontrast" },
  { kind: "axe", match: /^link-in-text-block/, status: "rättat", commit: "aa1da29e", note: "Länken till Mina inställningar är understruken" },
  { kind: "axe", match: /^aria-prohibited-attr/, status: "rättat", commit: "aa1da29e", note: "Projektets förloppsstapel har roll" },
  { kind: "axe", match: /^scrollable-region-focusable/, status: "rättat", commit: "aa1da29e", note: "Tidslinjen går att rulla med tangentbordet" },
  { kind: "axe", match: /^color-contrast .*view=company/, status: "rättat", commit: "92ff583b", note: "Krediternas kort: primary-foreground, 90 % på de lugnare raderna (syns efter bygge)" },
  { kind: "axe", match: /landing_editor|Flytta|Cloud Team/, status: "rättat", commit: "fc15d093", note: "Släckt plan utan opacitet (streckad kant, mönster); knapptexten 24 px (syns efter bygge)" },
  { kind: "axe", match: /^(document-title|html-has-lang)/, status: "avfärdat", note: "Ren textfil (third-party-licenses.txt), ingen HTML-sida" },
  { kind: "h1", match: /taskType=FORM.*(scheduleId|formId)|Formuläret är inte publicerat/, status: "rättat", commit: "aa1da29e", note: "Protokoll vars formulär inte kan öppnas har rubrik; fråga 2 i rapporten är öppen" },
  { kind: "h1", match: /third-party-licenses/, status: "avfärdat", note: "Ren textfil, ingen HTML-sida" },
  { kind: "h1", match: /view=new_project/, status: "avfärdat", note: "Rollprovet såg rubriken Projekt (laddningstid)" },
  { kind: "h1", match: /behörighetsrutan|view=project$|view=place$/, status: "rättat", commit: "aa1da29e", note: "Behörighetsrutan, Projektet hittades inte och Ingen plats vald har h1" },
  { kind: "http", match: /\/api\/forms/, status: "rättat", commit: "aa1da29e", note: "Felet står direkt på telefonen, toppfältet säger Nytt protokoll; varför ronden erbjuds är fråga 2" },
  { kind: "http", match: /\/api\/catalogue/, status: "öppet", note: "Import hämtar prisfiler för en medarbetare (fråga 6)" },
  { kind: "http", match: /\/api\/map\/tiles/, status: "öppet", note: "Hör till kartgrenen adress-karta" },
  { kind: "console", match: /403/, status: "öppet", note: "Import hämtar prisfiler för en medarbetare (fråga 6)" },
  { kind: "console", match: /404 .*(scheduleId|formId)/, status: "rättat", commit: "aa1da29e", note: "Formulärets 404: felet visas nu direkt (fråga 2 i rapporten är öppen)" },
  { kind: "console", match: /404 .*server_keys/, status: "öppet", note: "Kartrutor 404: hör till kartgrenen adress-karta" },
  { kind: "role", match: /trash=true/, status: "rättat", commit: "e56676ae", note: "Papperskorgen kräver Kunder (customers:read) eller admin" },
  { kind: "role", match: /view=customers.*bara adressen/, status: "öppet", note: "Kundlistan öppnas med adressen fast menyn inte visar Kunder (fråga 1)" },
  { kind: "role", match: /^menyn visar .*view=rounds$/, status: "rättat", commit: "5ac51d9b", note: "Sidan nekar bara utan canReadRounds, samma regel som menyn (syns efter bygge)" },
];
// Fynd som inte syns i robotens rådata men står i rapporten (prövade för hand eller med sökningen).
const MANUAL = [
  { kind: "role", title: "Kundregistrets papperskorg gick att lista via API:t utan Kunder", address: "/api/records?kind=customers&trash=true", page: "/?view=customers", runs: ["member-desktop", "member-phone"] },
  { kind: "search", title: "Sökningen öppnade AI-kostnad på en gammal adress", address: "/?view=ai_admin", runs: ["superadmin-desktop"], status: "rättat", commit: "4769d86a", note: "Nu /?view=pricing_admin&section=ai" },
  { kind: "search", title: "Sökningen öppnade E-postserver (SMTP) på en gammal adress", address: "/?view=mail_settings", runs: ["superadmin-desktop"], status: "rättat", commit: "4769d86a", note: "Nu /?view=server_keys&section=keys-email" },
  { kind: "ui", title: "Driftrond med opublicerat formulär: telefonen visade Ny riskbedömning och Skapa", address: "/?view=workflow_task&formId=…&scheduleId=…&taskType=FORM", runs: ["admin-phone"], status: "rättat", commit: "aa1da29e", note: "Varför ronden alls erbjuds är fråga 2" },
  { kind: "ui", title: "Textknappar med pil", address: "/?view=stats", runs: RUNS, status: "rättat", commit: "aa1da29e", note: "Regeltest tests/ui-analysis-rules.test.ts" },
];
function statusOf(kind, text) {
  const rule = STATUS.find((r) => r.kind === kind && r.match.test(text));
  return rule ? { status: rule.status, ...(rule.commit ? { commit: rule.commit } : {}), note: rule.note } : { status: "öppet" };
}

function summarize(dir, { commit, date } = {}) {
  const read = (name) => { const file = path.join(dir, name); return fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, "utf8")) : null; };
  const runs = [], pages = new Map(), ways = new Map(), popups = new Map(), findings = new Map();
  const add = (map, key, make, run) => { if (!map.has(key)) map.set(key, { ...make(), runs: new Set() }); const item = map.get(key); item.runs.add(run); return item; };
  const finding = (kind, title, address, run, extra = {}) => add(findings, `${kind}|${title}|${address}`, () => ({ kind, title, address, ...extra }), run);
  const recheck = read("recheck.json") || [];
  const ignore = (text) => /favicon|_next\/webpack|hot-update/.test(text);
  for (const run of RUNS) {
    const data = read(`${run}.json`);
    if (!data) continue;
    const [role, device] = run.split("-");
    runs.push({ run, role, device, pages: data.pages.length, links: data.edges.length, popups: data.popups.length });
    for (const page of data.pages) {
      const address = pattern(page.url);
      if (!address) continue;
      // A page the robot could not load in its own tab was loaded again in a new one (recheck.cjs).
      const again = page.status !== "ok" ? recheck.find((r) => r.run === run && r.key === page.key) : null;
      const ok = page.status === "ok" || (again && /^2/.test(again.st));
      const item = add(pages, address, () => ({ address, denied: new Set(), redirect: null }), run);
      if (!ok) item.runs.delete(run);
      if (denied(page.text)) item.denied.add(run);
      if (page.redirected && page.final) item.redirect = pattern(page.final);
      const shown = page.status === "ok" ? page : again;
      if (!shown) continue;
      const h1 = page.status === "ok" ? [...(page.h1 || []), ...(page.topTitle || [])] : [...(again.h1 || []), ...(again.top || [])];
      if (!h1.length && ok) finding("h1", "Sidan saknar rubrik (h1)", address, run, statusOf("h1", `${address} ${String(page.text || "").slice(0, 80)}`));
      // A page that failed in the robot's own tab: what was measured there belongs to the page before; the new tab's counts.
      if (page.status !== "ok") {
        for (const line of again.ax || []) { const [id, ...target] = line.split(" "); finding("axe", id, address, run, statusOf("axe", `${id} ${target.join(" ")} ${address}`)); }
        for (const line of (again.http || []).filter((x) => !ignore(x))) { const [status, rest] = line.split(" "); const api = (pattern(rest || "") || rest || "").replace(/\/\d+\/\d+\/\d+\.png$/, "/…png"); finding("http", `GET ${status} ${api}`, address, run, statusOf("http", api)); }
        continue;
      }
      for (const v of page.axe || []) finding("axe", `${v.id} (${v.impact}): ${v.help}`, address, run, statusOf("axe", `${v.id} ${v.nodes?.[0]?.target || ""} ${address}`));
      for (const line of (page.http || []).filter((x) => !ignore(x))) {
        const [method, status, rest] = line.split(" ");
        const api = pattern(rest || "") || rest;
        const clean = api.replace(/\/\d+\/\d+\/\d+\.png$/, "/…png");
        finding("http", `${method} ${status} ${clean}`, address, run, statusOf("http", clean));
      }
      for (const line of (page.console || []).filter((x) => !ignore(x))) {
        const code = (line.match(/status of (\d{3})/) || [])[1];
        finding("console", code ? `Konsolfel: resurs svarade ${code}` : "Konsolfel", address, run, statusOf("console", `${code || line} ${address}`));
      }
      for (const line of page.pageerrors || []) if (!/ERR_ABORTED/.test(line)) finding("console", "Sidfel (JavaScript)", address, run);
      const fromMenu = data.edges.some((e) => e.to === page.key && ["Huvudmeny", "Flikrad", "mer"].includes(e.how));
      if (denied(page.text) && fromMenu) finding("role", "Menyn visar sidan men den visar behörighetsrutan", address, run, statusOf("role", `menyn visar ${address}`));
    }
    // A link with the same text to the same address from many pages is the shell's (the side menu after a tab click, the top
    // bar, the logo, a menu in a popup): one way from "@skal". The text is the link's own (after the last "→").
    const linkText = (via) => String(via || "").split("→").pop().trim();
    const fromPages = new Map();
    for (const edge of data.edges) if (!["start", "Brödsmulor", "mer", "ny"].includes(edge.how)) { const k = `${edge.to}|${linkText(edge.via)}`; if (!fromPages.has(k)) fromPages.set(k, new Set()); fromPages.get(k).add(edge.from); }
    // The sheets Ny and Mer at the start were read with every link on the screen, the start page's behind them too.
    const startLinks = new Set(data.edges.filter((e) => e.from === data.edges.find((x) => x.how === "start")?.to && e.how === "länk").map((e) => e.to));
    for (const edge of data.edges) {
      // "fällning" is every link on the page again after a toggle: the same ways as "länk". Mer is read from its popup.
      if (["start", "fällning", "mer"].includes(edge.how)) continue;
      if (edge.how === "ny" && startLinks.has(edge.to)) continue;
      const to = pattern(edge.to);
      if (!to || to.startsWith("/api/")) continue;
      // A link inside the phone's Mer, the search or the assistant is a way from that panel, whichever page it was opened on.
      const panel = /^Mer/.test(edge.via || "") ? "@mer" : /^Sök/.test(edge.via || "") ? "@sok" : /^HINTEK AI/.test(edge.via || "") ? "@ai" : /^Kalkylator/.test(edge.via || "") ? "@kalkylator" : null;
      const shell = (fromPages.get(`${edge.to}|${linkText(edge.via)}`)?.size || 0) >= 6;
      const from = panel && ["popup", "dialog"].includes(edge.how) ? panel : edge.how === "ny" ? "@ny" : edge.how === "Flikrad" ? "@flikrad" : edge.how === "Huvudmeny" ? "@meny" : shell ? "@skal" : pattern(String(edge.from).replace(/ \[.*\]$/, ""));
      if (!from || from === to) continue;
      const how = { länk: "länk", Huvudmeny: "meny", Flikrad: "flikrad", mer: "mer", ny: "ny", Brödsmulor: "brödsmula", flik: "flik", fällning: "fällning", popup: "popup", dialog: "popup", knapp: "knapp" }[edge.how] || "flik";
      const way = add(ways, `${from}|${to}`, () => ({ from, to, how: new Set() }), run);
      way.how.add(how);
    }
    for (const popup of data.popups) for (const dialog of popup.dialogs) {
      const page = pattern(popup.page);
      const label = String(dialog.label || "").trim().slice(0, 60);
      if (page && label) add(popups, `${page}|${label}`, () => ({ page, label }), run);
    }
  }
  // Rollprovet: varje adress i kartan öppnad direkt som varje roll.
  const roles = read("roles.json") || {};
  const probe = [];
  for (const role of ROLE_NAMES) for (const view of roles[role]?.views || []) {
    const address = pattern(view.address), final = pattern(view.url);
    const reachedByCrawl = [...pages.values()].some((p) => p.address === address && [...p.runs].some((r) => r.startsWith(`${role}-`)));
    const result = denied(view.text) ? "nekas" : final !== address ? "pekar om" : reachedByCrawl ? "visas" : "bara adressen";
    probe.push({ address, role, result, ...(result === "pekar om" ? { to: final } : {}), mapSaid: view.allowed ? "når" : "når inte" });
    if (!view.h1 && result !== "pekar om") {
      // The permission box as a whole page: one finding, every address it was seen on.
      if (result === "nekas") { const f = finding("h1", "Behörighetsrutan som hel sida saknar rubrik (h1)", "/?view=company", `${role}-desktop`, statusOf("h1", "behörighetsrutan")); (f.also = f.also || new Set()).add(address); }
      else finding("h1", "Sidan saknar rubrik (h1)", address, `${role}-desktop`, statusOf("h1", address));
    }
    if (result === "bara adressen" && view.allowed && /view=customers$/.test(address)) finding("role", "Sidan öppnas med adressen men ingen meny eller länk leder dit för rollen", address, `${role}-desktop`, statusOf("role", `${address} bara adressen`));
  }
  for (const m of MANUAL) for (const run of m.runs) finding(m.kind, m.title, m.address, run, { ...(m.page ? { page: m.page } : {}), ...(m.status ? { status: m.status, ...(m.commit ? { commit: m.commit } : {}), note: m.note } : statusOf(m.kind, m.address)) });
  // Bakåt: klick A → B, webbläsarens Bakåt (och appens ‹ på telefonen) ska ge A.
  const back = { checks: 0, ok: 0, notTried: 0, wrong: 0 };
  for (const run of RUNS) for (const check of read(`back-${run}.json`) || []) {
    back.checks++;
    if (check.error) back.notTried++;
    else if (check.ok && (!check.appBack || check.appBack === check.from)) back.ok++;
    else { back.wrong++; finding("back", "Bakåt gav fel sida", pattern(check.from) || check.from, run); }
  }
  const list = (set) => RUNS.filter((r) => set.has(r));
  return {
    about: "Klickrobotens prov av appen (scripts/sitemap/crawl/). Bara adressmönster (id:n som …), roller, enheter, status och commits. Generera om: se scripts/sitemap/README.md.",
    date: date || new Date().toISOString().slice(0, 10),
    commit: commit || "?",
    target: "QA-bygget på loopback: 3004 produktadmin, 3001 kundföretagets admin, 3002 medarbetare (QA-roller)",
    runs,
    pages: [...pages.values()].filter((p) => p.runs.size).map((p) => ({ address: p.address, runs: list(p.runs), ...(p.denied.size ? { denied: list(p.denied) } : {}), ...(p.redirect ? { redirect: p.redirect } : {}) })).sort((a, b) => a.address.localeCompare(b.address)),
    ways: [...ways.values()].map((w) => ({ from: w.from, to: w.to, how: [...w.how].sort().join(" "), runs: list(w.runs) })).sort((a, b) => `${a.from}|${a.to}`.localeCompare(`${b.from}|${b.to}`)),
    popups: [...popups.values()].map((p) => ({ page: p.page, label: p.label, runs: list(p.runs) })),
    roleProbe: probe,
    back,
    findings: [...findings.values()].map((f) => ({ ...f, runs: list(f.runs), ...(f.also ? { also: [...f.also].sort() } : {}) })),
  };
}

/** One item per line (a page, a way, a finding): compact, and still readable in a diff. */
function stringify(data) {
  const lines = Object.entries(data).map(([key, value]) => Array.isArray(value)
    ? `  ${JSON.stringify(key)}: [\n${value.map((item) => `    ${JSON.stringify(item)}`).join(",\n")}\n  ]`
    : `  ${JSON.stringify(key)}: ${JSON.stringify(value)}`);
  return `{\n${lines.join(",\n")}\n}`;
}

function main(argv) {
  const arg = (name) => { const at = argv.indexOf(name); return at >= 0 ? argv[at + 1] : null; };
  // The raw output: the first argument that is not a flag or a flag's value; else where crawl.cjs writes (config.cjs).
  const dir = argv.find((a, i) => !a.startsWith("--") && !(i > 0 && argv[i - 1].startsWith("--")))
    || process.env.SITEMAP_CRAWL_OUT || path.join(__dirname, "..", "..", "..", ".next", "sitemap-crawl");
  if (!fs.existsSync(path.join(dir, "superadmin-desktop.json"))) { console.error(`Ingen utdata från roboten i ${dir}. Kör crawl.cjs först (scripts/sitemap/README.md).`); process.exit(2); }
  let commit = arg("--commit");
  if (!commit) try { commit = execFileSync("git", ["rev-parse", "--short", "HEAD"], { encoding: "utf8" }).trim(); } catch { commit = "?"; }
  const data = summarize(path.resolve(dir), { commit, date: arg("--date") });
  const out = path.resolve(arg("--write") || path.join(__dirname, "..", "observed.json"));
  fs.writeFileSync(out, `${stringify(data)}\n`, "utf8");
  const open = data.findings.filter((f) => f.status === "öppet").length;
  console.log(`observed.json: ${data.pages.length} adresser, ${data.ways.length} vägar, ${data.findings.length} fynd (${open} öppna), Bakåt ${data.back.ok}/${data.back.checks} → ${out}`);
}

module.exports = { summarize, pattern };
if (require.main === module) main(process.argv.slice(2));
