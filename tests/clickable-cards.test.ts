import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { foldShown, foldWishAfterClick } from "../lib/workflow/fold-when-ready";

// Hela kortet klickbart och innehåll först när det är klart (2026-10-24). The browser half is
// tests/clickable-cards.browser.cjs.

const text = (path: string) => readFileSync(path, "utf8");

test("a fold opens only when its content is ready, and is busy until then", () => {
  assert.deepEqual(foldShown({ asked: false, ready: false }), { open: false, opening: false });
  assert.deepEqual(foldShown({ asked: false, ready: true }), { open: false, opening: false }, "ready but not asked: still folded");
  assert.deepEqual(foldShown({ asked: true, ready: false }), { open: false, opening: true }, "asked, being read: folded and busy");
  assert.deepEqual(foldShown({ asked: true, ready: true }), { open: true, opening: false }, "asked and ready: open in one sweep");
});

test("a click asks for a folded card, folds an open one and takes back a busy one", () => {
  assert.equal(foldWishAfterClick({ asked: false, ready: false }), true, "folded: asked for");
  assert.equal(foldWishAfterClick({ asked: false, ready: true }), true, "folded with content: asked for");
  assert.equal(foldWishAfterClick({ asked: true, ready: true }), false, "open: folds");
  assert.equal(foldWishAfterClick({ asked: true, ready: false }), false, "busy: the wish is taken back, it never opens later by itself");
});

test("the shared Panel folds from its whole header, in both directions, and its toggle is the arrow only", () => {
  const ui = text("features/kfid/ui.tsx");
  // The header's click is wired whenever the panel can fold, not only while it is folded (the rule of 2026-10-16).
  assert.match(ui, /onClick=\{foldable \? \(event\) => \{ if \(!isOwnControl\(event\.target, event\.currentTarget\) && !endsSelection\(\)\) toggleFold\(event\); \} : undefined\}/);
  assert.doesNotMatch(ui, /onClick=\{collapsed \? \(event\)/, "the old open-only header click is gone");
  // The toggle: a button with aria-expanded and aria-controls, Enter and Space, and a busy arrow while the content is read.
  assert.match(ui, /role="button"[\s\S]{0,400}aria-expanded=\{!collapsed\}\s+aria-controls=\{contentId\}\s+aria-busy=\{opening \|\| undefined\}/);
  assert.match(ui, /event\.key === "Enter" \|\| event\.key === " "/);
  assert.match(ui, /opening \? \(\s*\/\/[^\n]*\n\s*<Loader2/);
  // Utfällbar sektion: the row is the button, the arrow at its right end, no "Fäll ihop".
  const section = ui.slice(ui.indexOf("export function CollapsibleSection"), ui.indexOf("export function Empty"));
  assert.doesNotMatch(section, />Fäll ihop</);
});

test("the header's focus ring and hover are drawn for the whole header", () => {
  const css = text("app/globals.css");
  assert.match(css, /\.panel-header\[data-panel-foldable\]:has\(\.panel-fold-toggle:focus-visible\) \{ outline: 2px solid var\(--ring\)/);
  assert.match(css, /\.panel-link \{ cursor: pointer; \}/);
});

test("a pressed stretched link keeps its cover over the card, also after the CSS minifier (QA 2026-10-24)", async () => {
  const css = text("app/globals.css");
  const rule = /\.stretched-link:active \{[^}]*\}/.exec(css)?.[0];
  assert.ok(rule, "the rule is there");
  // lightningcss (Next's minifier) dropped translate: none when transform: none stood beside it; the built rule must keep it.
  const { transform } = await import("lightningcss");
  const built = transform({ filename: "globals.css", code: Buffer.from(rule), minify: true }).code.toString();
  assert.match(built, /translate:none/);
});

test("no card folds with a text button: Statistik, Projekt och uppgifter and Grunduppgifter use the shared Panel", () => {
  const stats = text("features/workflow/task-statistics.tsx");
  assert.doesNotMatch(stats, /Visa statistik"|Dölj statistik/);
  assert.match(stats, /<Panel icon=\{BarChart3\} title="Statistik"[\s\S]{0,300}collapsible collapsed=\{fold\.collapsed\} onCollapsedChange=\{fold\.onCollapsedChange\} opening=\{fold\.opening\}/);
  const overview = text("features/kfid/analytics.tsx");
  assert.doesNotMatch(overview, /Visa alla \(|"Visa färre"/);
  assert.match(overview, /collapsible=\{foldable\}\s+collapsed=\{foldable \? !expanded : undefined\}/);
  assert.match(overview, /foldedContent=\{/);
  const meta = text("features/workflow/form-builder/meta-panel.tsx");
  assert.doesNotMatch(meta, /"Fäll ihop"|: "Visa"/);
  assert.match(meta, /<Panel title="Grunduppgifter"/);
});

test("the overview shows its parts together, and Statistik reads its project tab in the background", () => {
  const overview = text("features/kfid/analytics.tsx");
  assert.match(overview, /<ShowWhenReady ready=\{Boolean\(kpis \|\| kpiError\) && workLoaded\} placeholder=\{<OverviewSkeleton \/>\}/);
  assert.match(overview, /<WorkOverview onLoaded=\{markWorkLoaded\} \/>/);
  const stats = text("features/workflow/task-statistics.tsx");
  assert.match(stats, /\{withProjects && \(data \|\| error\) \? <div hidden=\{tab !== "projects"\}><ProjectStatistics/);
  assert.doesNotMatch(stats, /Hämtar statistik…<\/p>/, "no one-line loading text that the chart pushes down");
  assert.doesNotMatch(text("features/workflow/project-statistics.tsx"), /Hämtar projektstatistik…<\/p>/);
});

test("a card that only leads on is one link: the whole card", () => {
  const workspace = text("features/kfid/workspace.tsx");
  assert.match(workspace, /<Panel link icon=\{Scale\} title="Gränsvärden"[\s\S]{0,200}className="stretched-link"/);
  assert.match(workspace, /<Panel link icon=\{Rocket\} title="Ställ in Workflow"[\s\S]{0,200}className="stretched-link"/);
});
