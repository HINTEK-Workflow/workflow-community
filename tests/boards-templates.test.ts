import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { overlaps } from "../lib/boards/grid";
import { cardDefinition, cardTakesData, duplicateCard, layoutSchema, type BoardLayout } from "../lib/boards/model";
import { METRICS, metricDefinition, metricOption, metricPeriod } from "../lib/boards/metrics";
import { periodDays, periodRange, PERIODS } from "../lib/boards/period";
import { BOARD_TEMPLATES, BOARD_TEMPLATE_KEYS, boardTemplate } from "../lib/boards/templates";
import { machineStatusShape, storeBelowMinShape, withPrevious, workOrderSeries } from "../lib/boards/metric-shapes";
import { appAddress } from "../lib/boards/access";

/**
 * Tavlor, 2026-11-19 (exempeltavlor, perioder och jämförelse, bättre redigering av korten, hela adresser, Tavlor i demon).
 */

test("twelve example boards with plain Swedish names, each a valid board built on Workflow's own measures and sources", () => {
  assert.equal(BOARD_TEMPLATES.length, 12);
  assert.deepEqual(BOARD_TEMPLATES.map((item) => item.key), [...BOARD_TEMPLATE_KEYS]);
  for (const template of BOARD_TEMPLATES) {
    assert.ok(template.label.length > 3 && template.description.length > 20, template.key);
    assert.doesNotMatch(`${template.label} ${template.description}`, /dashboard/i, "never the English word");
    const parsed = layoutSchema.parse(template.layout);
    assert.deepEqual(parsed.cards.map(({ x, y, w, h }) => ({ x, y, w, h })), template.layout.cards.map(({ x, y, w, h }) => ({ x, y, w, h })), `${template.key}: the cards are inside the board and at least their smallest size`);
    for (const [index, card] of template.layout.cards.entries()) {
      for (const other of template.layout.cards.slice(index + 1)) assert.ok(!overlaps(card, other), `${template.key}: ${card.id} and ${other.id} overlap`);
      if (cardTakesData(card.type) && card.data?.kind === "source") {
        assert.equal(card.data.source.type, card.type, `${template.key}: ${card.id} reads its own kind of source`);
      } else if (cardTakesData(card.type)) {
        assert.equal(card.data?.kind, "metric", `${template.key}: ${card.id} reads a Workflow measure`);
        const metric = card.data!.kind === "metric" ? metricDefinition(card.data!.metric) : null;
        assert.ok(metric && cardDefinition(card.type).shapes.includes(metric.shape), `${template.key}: ${card.id} gets the shape it draws`);
        if (card.data!.kind === "metric" && card.data!.period) assert.ok(metric!.periods?.includes(card.data!.period), `${template.key}: ${card.id} asks for a period its measure has`);
      }
      // No limit values ship with Workflow: the company sets its own (the copyright precaution).
      assert.equal(card.settings.limits, undefined, `${template.key}: ${card.id} has no limits of its own`);
    }
  }
  const copy = boardTemplate("week_work");
  copy.layout.cards.pop();
  assert.equal(boardTemplate("week_work").layout.cards.length, copy.layout.cards.length + 1, "a template is copied, never changed by its board");
});

test("a measure that counts over time offers periods, and a card keeps only a period its measure has", () => {
  for (const metric of METRICS) {
    if (!metric.periods) { assert.equal(metricPeriod(metric.key, "month"), null); continue; }
    assert.ok(metric.periods.every((period) => (PERIODS as readonly string[]).includes(period)));
    assert.equal(metricPeriod(metric.key, null), metric.period ?? metric.periods[0]);
    assert.equal(metricPeriod(metric.key, metric.periods.at(-1)), metric.periods.at(-1));
  }
  assert.equal(metricPeriod("hours_week", "30d"), "week", "a period the measure lacks falls back to its own");
  assert.deepEqual(metricOption(metricDefinition("invoiced_amount")).periods, ["week", "today", "month", "year"]);
  assert.equal(metricOption(metricDefinition("invoiced_amount")).period, "month");
  assert.equal(metricOption(metricDefinition("invoiced_amount")).compares, true);
});

test("the periods follow Swedish calendar time, and the one before is the whole period before", () => {
  const now = new Date("2026-11-19T10:00:00Z"); // a Thursday
  const week = periodRange("week", now);
  assert.equal(week.from.toISOString(), "2026-11-15T23:00:00.000Z", "Monday 00:00 in Sweden");
  assert.equal(week.previousFrom.toISOString(), "2026-11-08T23:00:00.000Z");
  assert.deepEqual(periodDays("month", now), { from: "2026-11-01", to: "2026-12-01", previousFrom: "2026-10-01", previousTo: "2026-11-01" });
  assert.deepEqual(periodDays("year", now), { from: "2026-01-01", to: "2027-01-01", previousFrom: "2025-01-01", previousTo: "2026-01-01" });
  assert.deepEqual(periodDays("30d", now), { from: "2026-10-21", to: "2026-11-20", previousFrom: "2026-09-21", previousTo: "2026-10-21" });
  assert.deepEqual(withPrevious("month", 4, 2), { kind: "number", value: 4, previous: 2, note: "Förra månaden" });
});

test("the shared shapes read the same for the server and the demo", () => {
  assert.deepEqual(workOrderSeries(["planned", "active", "active", "done"]).series[0]!.values, [1, 2, 1]);
  const status = machineStatusShape([{ id: "a", name: "Press", status: "IN_SERVICE" }, { id: "b", name: "Fläkt", status: "IN_SERVICE" }], [{ partId: "b", stoppedAt: "2026-11-19T08:00:00Z", restoredAt: null }]);
  assert.deepEqual(status.items.map((item) => item.state), ["ok", "error"]);
  const store = storeBelowMinShape([{ name: "Säkring", min: 10, have: 2 }, { name: "Kabel", min: 5, have: 9 }]);
  assert.equal(store.total, 1);
  assert.equal(store.rows[0]!.name, "Säkring");
});

test("Duplicera puts a copy with all its settings at the first free place, and refuses on a full board", () => {
  const layout: BoardLayout = { version: 1, orientation: "landscape", rows: 14, cards: [{ id: "k-1", type: "kpi", x: 0, y: 0, w: 12, h: 7, title: "Tal", data: { kind: "metric", metric: "work_orders_open" }, settings: { accent: "round", unit: "st" } }] };
  const next = duplicateCard(layout, "k-1", "k-2")!;
  assert.deepEqual(next.cards[1], { ...layout.cards[0], id: "k-2", x: 12, y: 0 });
  next.cards[1]!.settings.unit = "h";
  assert.equal(layout.cards[0]!.settings.unit, "st", "the copy is its own");
  const full = duplicateCard(duplicateCard(next, "k-1", "k-3")!, "k-1", "k-4")!;
  assert.equal(full.cards.length, 4);
  assert.equal(duplicateCard(full, "k-1", "k-5"), null, "four quarters fill the board");
});

test("every address the pages show is written out in full", () => {
  assert.equal(appAddress({ origin: "https://app.example.test/" }, "/skarm"), "https://app.example.test/skarm");
  assert.equal(appAddress({ origin: "https://app.example.test" }, "/visa#k="), "https://app.example.test/visa#k=");
  for (const file of ["features/boards/screens-page.tsx", "features/boards/links-page.tsx"]) {
    const source = readFileSync(file, "utf8");
    assert.doesNotMatch(source, /["`'](Öppna|gå till)[^"`']*\s\/skarm/i, `${file} shows no bare /skarm`);
    assert.match(source, /appAddress\(access/, `${file} builds its addresses from the app's origin`);
  }
});

test("the subtitles say KPI-tavlor and never the English word", () => {
  const sources = ["features/boards/boards-page.tsx", "features/boards/board-view.tsx", "features/boards/screens-page.tsx", "features/boards/links-page.tsx", "features/boards/tables-page.tsx", "features/boards/board-properties.tsx", "lib/boards/templates.ts"]
    .map((file) => readFileSync(file, "utf8")).join("\n");
  assert.match(sources, /KPI-tavlor med nyckeltal, diagram och information för skärmar och möten\./);
  // Only the code's comments may use the English word (none of the visible strings do).
  const visible = [...sources.matchAll(/"([^"\n]*)"/g)].map((match) => match[1]).join("\n");
  assert.doesNotMatch(visible, /dashboard/i);
});
