import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { contrastRatio } from "../lib/theme";
import { panelAreaColor, panelAreaOfTask, panelAreaOfView, type PanelArea } from "../lib/workflow/panel-area";
import { PRODUCT_VIEWS, SETTINGS_VIEWS } from "../lib/workflow/settings-tabs";

// Korten ser likadana ut (UX-punkt 6, 2026-10-22): the icon left of every card's title has the same colour per
// area (the page's function), from the app's --type-* tokens; Inställningar and Installation use Workflow Blue,
// the ordinary colour (no-accent-colours-for-admin), never an accent of their own and never grey.

test("every page has an area, and the same function has the same colour", () => {
  const expected: Record<string, PanelArea> = {
    work_orders: "work-order", tasks: "control", rounds: "round", time: "time", planning: "calendar", customers: "customer", place: "customer",
    projects: "project", project_planning: "project", quotes: "quote", quote: "quote", purchases: "purchase", articles: "purchase",
    // Verktyg and all its pages share one colour (2026-10-24, answer 7).
    tools: "tools", import: "tools", instruments: "tools", self_inspection: "tools", report_archive: "tools", forms: "tools", calculators: "tools",
  };
  for (const [view, area] of Object.entries(expected)) assert.equal(panelAreaOfView(view), area, view);
});

test("a job takes its kind's colour: work order, risk assessment, protocol", () => {
  assert.equal(panelAreaOfView("workflow_task", "WORK_ORDER"), "work-order");
  assert.equal(panelAreaOfView("workflow_task", "RISK_ASSESSMENT"), "risk");
  assert.equal(panelAreaOfView("workflow_task", "FORM"), "control");
  assert.equal(panelAreaOfView("new_task"), "control");
});

test("a risk assessment made as the risk form is orange like the old kind; another protocol stays violet", () => {
  assert.equal(panelAreaOfTask({ kind: "FORM", data: { kind: "FORM", details: { templateId: "hintek-riskbedomning" } } }), "risk");
  assert.equal(panelAreaOfTask({ kind: "FORM", formArea: "risk-assessment", data: { kind: "FORM", details: { templateId: "company-copy" } } }), "risk");
  assert.equal(panelAreaOfTask({ kind: "FORM", data: { kind: "FORM", details: { templateId: "hintek-termografering" } } }), "control");
  assert.equal(panelAreaOfTask({ kind: "RISK_ASSESSMENT", data: {} }), "risk");
  assert.equal(panelAreaOfTask({ kind: "WORK_ORDER", data: {} }), "work-order");
});

test("Inställningar and Installation are one area in Workflow Blue, not grey and no accent", () => {
  for (const view of [...SETTINGS_VIEWS, ...PRODUCT_VIEWS]) assert.equal(panelAreaOfView(view), "admin", view);
  assert.equal(panelAreaColor("admin"), "var(--primary)");
  assert.equal(panelAreaColor("work-order"), "var(--type-work-order)");
  // No page falls back to the grey neutral tone.
  for (const view of ["stats", "notifications", "unknown_page", "help"]) assert.notEqual(panelAreaOfView(view), "neutral", view);
});

// Ikonstandarden (2026-10-24): every function in the main menu has its own icon colour, kept on all its pages, so
// the colour says where you are. Kalender has its own, apart from Tid (answer 14); Verktyg one shared colour (answer 7),
// apart from Inställningar's Workflow Blue.
test("every main-menu function has its own colour; Kalender apart from Tid, Verktyg apart from Inställningar", async () => {
  const { MENU_ITEM_GROUPS } = await import("../lib/workflow/menu-items");
  const work = [...MENU_ITEM_GROUPS[0].items.map((item) => item.key as string), ...MENU_ITEM_GROUPS[1].items.map((item) => item.key as string), ...MENU_ITEM_GROUPS[2].items.map((item) => item.key as string).filter((key) => key !== "customer_invoices"), "tools", "settings"];
  // Fakturor is a page of Offerter's area, so it wears its colour.
  assert.equal(panelAreaOfView("customer_invoices"), panelAreaOfView("quotes"));
  const colours = work.map((key) => panelAreaColor(panelAreaOfView(key)));
  assert.equal(new Set(colours).size, colours.length, JSON.stringify(Object.fromEntries(work.map((key, index) => [key, colours[index]]))));
  assert.notEqual(panelAreaOfView("planning"), panelAreaOfView("time"));
  for (const key of MENU_ITEM_GROUPS[3].items.map((item) => item.key)) assert.equal(panelAreaOfView(key), "tools", key);
  // Their pages keep the colour: a project's page, a quote, a purchase, a place.
  assert.equal(panelAreaOfView("project"), panelAreaOfView("projects"));
  assert.equal(panelAreaOfView("quote"), panelAreaOfView("quotes"));
  assert.equal(panelAreaOfView("purchase"), panelAreaOfView("purchases"));
  assert.equal(panelAreaOfView("place"), panelAreaOfView("customers"));
  // The menu's own entries for new work have an area too (Ny kontroll violet), never a fallback to admin blue.
  assert.equal(panelAreaOfView("new"), "control");
});

test("function colours are never the status colours (green, amber, red pills)", () => {
  const status = ["--success", "--warning", "--destructive", "--danger-text"];
  for (const area of ["work-order", "control", "risk", "round", "time", "customer", "project", "quote", "purchase", "instrument", "tools", "calendar", "admin"] as const) {
    const colour = panelAreaColor(area);
    assert.ok(colour.startsWith("var(--type-") || colour === "var(--primary)", `${area}: ${colour}`);
    for (const token of status) assert.ok(!colour.includes(token), `${area} uses ${token}`);
  }
});

// The colours, measured from app/globals.css as the browser mixes them (color-mix in sRGB). Every function's colour
// (13b, 2026-10-24; first Verktyg and Kalender) reads at least 4.5:1 soft and solid in Light and Dark; the navy menu's
// symbols in Light read at least 3:1 on their square for every function (WCAG 1.4.11; they are measured at 4.7:1 or more).
const css = readFileSync("app/globals.css", "utf8");
const hex = (value: string) => [1, 3, 5].map((at) => parseInt(value.slice(at, at + 2), 16));
const mix = (first: string, share: number, second: string) => "#" + hex(first).map((channel, index) => Math.round(channel * share + hex(second)[index]! * (1 - share)).toString(16).padStart(2, "0")).join("");
const HEX = "(#[0-9a-fA-F]{6})";
function tokenIn(selector: string, name: string): string {
  const start = css.indexOf(`${selector} {`);
  assert.ok(start >= 0, selector);
  const found = new RegExp(`${name}:\\s*${HEX}`).exec(css.slice(start, css.indexOf("\n}", start)));
  assert.ok(found, `${name} in ${selector}`);
  return found[1]!;
}
const LIGHT_ROOT = ':root:not([data-theme="dark"])';
const DARK_ROOT = 'html[data-theme="dark"]';
const LIGHT = { card: tokenIn(LIGHT_ROOT, "--card"), foreground: tokenIn(LIGHT_ROOT, "--foreground") };
const DARK = { card: tokenIn(DARK_ROOT, "--card"), foreground: tokenIn(DARK_ROOT, "--foreground") };
// The --type-* tokens of Light are in the first :root block (Dark overrides them in its own).
const lightTokens = css.slice(css.indexOf("--type-work-order"), css.indexOf("--type-foreground"));
const lightToken = (name: string) => new RegExp(`${name}:\\s*${HEX}`).exec(lightTokens)![1]!;
const FUNCTIONS = ["work-order", "control", "risk", "round", "time", "customer", "project", "quote", "purchase", "instrument", "tools", "calendar", "maintenance", "neutral"];

test("every function's colour reads at least 4.5:1, soft and solid, in Light and Dark", () => {
  assert.ok(css.includes('.area-icon[data-tone="soft"] { background: color-mix(in srgb, var(--area) 14%, var(--card)); color: color-mix(in srgb, var(--area) 78%, var(--foreground)); }'), "the soft rule the measure follows");
  assert.ok(css.includes('html[data-theme="dark"] .area-icon[data-tone="soft"] { color: color-mix(in srgb, var(--area) 65%, var(--foreground)); }'), "Dark's soft symbol");
  for (const name of FUNCTIONS.map((area) => `--type-${area}`)) {
    for (const [theme, colour, surface, share] of [["Light", lightToken(name), LIGHT, 0.78], ["Dark", tokenIn(DARK_ROOT, name), DARK, 0.65]] as const) {
      const soft = contrastRatio(mix(colour, share, surface.foreground), mix(colour, 0.14, surface.card));
      const solid = contrastRatio("#ffffff", colour);
      assert.ok(soft >= 4.5, `${theme} ${name} soft ${soft.toFixed(2)}:1`);
      assert.ok(solid >= 4.5, `${theme} ${name} solid ${solid.toFixed(2)}:1`);
    }
  }
  // Verktyg's slate is not Inställningar's Workflow Blue, nor the grey neutral; Kalender is not Tid's indigo.
  assert.notEqual(lightToken("--type-tools"), tokenIn(LIGHT_ROOT, "--primary"));
  assert.notEqual(lightToken("--type-tools"), lightToken("--type-neutral"));
  assert.notEqual(lightToken("--type-calendar"), lightToken("--type-time"));
});

test("the navy menu in Light shows every function's colour with 3:1 or more for its symbol", () => {
  const rule = 'html:not([data-theme="dark"]) .workspace-sidebar .workspace-menu-item .area-icon { background: color-mix(in srgb, var(--area) 28%, var(--card)); color: color-mix(in srgb, var(--area) 50%, #ffffff); }';
  assert.ok(css.includes(rule), "the menu's icon rule");
  // The menu's icons without colour (2026-10-24): a plain symbol in the row's text colour, no square.
  assert.ok(css.includes('html:not([data-theme="dark"]) .workspace-sidebar .workspace-menu-item .area-icon { background: transparent; color: inherit; }'), "the menu's plain icons");
  const chrome = css.slice(css.indexOf('html:not([data-theme="dark"]) :is(.workspace-sidebar, .workspace-drawer, .workspace-header) {'));
  const navy = new RegExp(`--card: ${HEX};`).exec(chrome)![1]!;
  const menuBlue = new RegExp(`--primary: ${HEX};`).exec(chrome)![1]!;
  assert.equal(navy, "#113351");
  for (const [name, colour] of [...FUNCTIONS.map((name) => [name, lightToken(`--type-${name}`)] as const), ["admin", menuBlue] as const]) {
    const ratio = contrastRatio(mix(colour, 0.5, "#ffffff"), mix(colour, 0.28, navy));
    assert.ok(ratio >= 3, `${name}: ${ratio.toFixed(2)}:1`);
  }
});
