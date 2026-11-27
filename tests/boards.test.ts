import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { cellsMoved, clampRect, firstFree, placeItem, stackedOrder, usedRows } from "../lib/boards/grid";
import { CARDS, cardDefinition, DISTANCE, distanceGrid, layoutSchema, newCardId, normalizeLayout, presetLayout, readLayout, shownDistance, BOARD_PRESETS, type BoardLayout } from "../lib/boards/model";
import { aggregate, cellValue, columnKeyFor, rowValues, tableShape, type TableColumn, type TableRow } from "../lib/boards/table";
import { axisTicks, changePercent, formatNumber, shareOf, statusStateOf, toneFor, wordFitSize } from "../lib/boards/shapes";
import { cleanVisibility, initialsOf, layoutHasPersonalData, maskPeople, peopleChoiceOf } from "../lib/boards/privacy";
import { METRICS, METRIC_KEYS, metricAccess, metricsFor } from "../lib/boards/metrics";
import { boardsAccess } from "../lib/boards/access";
import { defaultWorkflowPermissionProfile, noWorkflowPermissionProfile, workflowPermissionMatrix, workflowPermissionPresets, hasWorkflowPermission, applyWorkflowPermissionToggle } from "../lib/workflow/permissions";

// ---------- the grid ----------

test("a card is kept inside the board and at least its smallest size", () => {
  assert.deepEqual(clampRect({ x: 22, y: 13, w: 6, h: 4 }, 14), { x: 18, y: 10, w: 6, h: 4 });
  assert.deepEqual(clampRect({ x: -3, y: -1, w: 1, h: 1 }, 14, 24, { minW: 3, minH: 2 }), { x: 0, y: 0, w: 3, h: 2 });
  assert.deepEqual(clampRect({ x: 0, y: 0, w: 99, h: 99 }, 14), { x: 0, y: 0, w: 24, h: 14 });
});

test("the first free place is found row by row, and none on a full board", () => {
  const items = [{ id: "a", x: 0, y: 0, w: 12, h: 7 }];
  assert.deepEqual(firstFree(items, 12, 7, 14), { x: 12, y: 0 });
  assert.deepEqual(firstFree([...items, { id: "b", x: 12, y: 0, w: 12, h: 14 }, { id: "c", x: 0, y: 7, w: 12, h: 7 }], 1, 1, 14), null);
});

test("moving a card pushes what it lands on downwards, and refuses to push a card off the board", () => {
  const items = [{ id: "a", x: 0, y: 0, w: 12, h: 4 }, { id: "b", x: 0, y: 4, w: 12, h: 4 }];
  const moved = placeItem(items, "a", { x: 0, y: 2, w: 12, h: 4 }, 14);
  assert.deepEqual(moved, [{ id: "a", x: 0, y: 2, w: 12, h: 4 }, { id: "b", x: 0, y: 6, w: 12, h: 4 }]);
  assert.equal(placeItem(items, "a", { x: 0, y: 2, w: 12, h: 8 }, 10), null, "b would end below row 10");
  assert.equal(placeItem(items, "x", { x: 0, y: 0, w: 1, h: 1 }, 14), null);
});

test("a drag in pixels snaps to whole cells, and the phone stacks top to bottom", () => {
  assert.deepEqual(cellsMoved(130, -41, 80, 40), { x: 2, y: -1 });
  assert.deepEqual(cellsMoved(10, 10, 0, 0), { x: 0, y: 0 });
  assert.deepEqual(stackedOrder([{ id: "b", x: 12, y: 0, w: 1, h: 1 }, { id: "c", x: 0, y: 3, w: 1, h: 1 }, { id: "a", x: 0, y: 0, w: 1, h: 1 }]).map((item) => item.id), ["a", "b", "c"]);
  assert.equal(usedRows([{ x: 0, y: 2, w: 1, h: 5 }, { x: 0, y: 0, w: 1, h: 1 }]), 7);
});

// ---------- the model ----------

test("every card type has a name, an icon and a start size inside its own limits", () => {
  for (const card of CARDS) {
    assert.ok(card.label && card.description, card.type);
    assert.ok(card.start.w >= card.size.minW && card.start.h >= card.size.minH, card.type);
  }
  assert.deepEqual(cardDefinition("kpi").shapes, ["number"]);
  assert.deepEqual(cardDefinition("text").shapes, []);
});

test("a stored layout is read safely: a bad one is an empty board, cards are clamped, ids made unique and data dropped where no data is shown", () => {
  assert.deepEqual(readLayout({ nonsense: true }).cards, []);
  const layout = layoutSchema.parse({ version: 1, orientation: "landscape", rows: 14, cards: [
    { id: "k-1", type: "kpi", x: 23, y: 0, w: 1, h: 1, data: { kind: "metric", metric: "work_orders_open" } },
    { id: "k-1", type: "text", x: 0, y: 5, w: 4, h: 2, data: { kind: "metric", metric: "work_orders_open" }, settings: { heading: "Hej" } },
  ] });
  assert.equal(layout.cards[0].w, 3, "the kpi card's smallest width");
  assert.equal(layout.cards[0].x, 21);
  assert.notEqual(layout.cards[0].id, layout.cards[1].id);
  assert.equal(layout.cards[1].data, null, "a text card reads no data");
  assert.throws(() => layoutSchema.parse({ version: 1, orientation: "landscape", rows: 14, cards: [{ id: "BAD ID", type: "kpi", x: 0, y: 0, w: 3, h: 2 }] }));
  assert.throws(() => layoutSchema.parse({ version: 1, orientation: "landscape", rows: 14, cards: [{ id: "k-1", type: "kpi", x: 0, y: 0, w: 3, h: 2, data: { kind: "metric", metric: "salaries" } }] }), "only known measures");
});

test("the presets are only layouts and fit their boards", () => {
  for (const preset of BOARD_PRESETS) {
    const layout = presetLayout(preset.key);
    assert.deepEqual(normalizeLayout(layout), layout, preset.key);
    for (const card of layout.cards) assert.equal(card.data, null, "no preset brings a measure or a limit");
  }
  assert.equal(presetLayout("portrait").orientation, "portrait");
  assert.match(newCardId(() => 0.5), /^k-[a-z0-9]{6}$/);
});

// ---------- the own table ----------

const columns: TableColumn[] = [{ key: "linje", label: "Linje", type: "text" }, { key: "antal", label: "Antal", type: "number", unit: "st" }, { key: "lage", label: "Läge", type: "status" }, { key: "dag", label: "Dag", type: "date" }];
const rows: TableRow[] = [
  { id: "1", values: { linje: "Linje 1", antal: 12, lage: "ok", dag: "2026-11-17" } },
  { id: "2", values: { linje: "Linje 2", antal: 8, lage: "Fel", dag: "2026-11-18" } },
  { id: "3", values: { linje: "Linje 3", antal: null, lage: "", dag: null } },
];

test("cells are read by their column's type, with a Swedish comma", () => {
  assert.equal(cellValue({ type: "number" }, "1 234,5"), 1234.5);
  assert.equal(cellValue({ type: "number" }, "abc"), null);
  assert.equal(cellValue({ type: "date" }, "18/11"), null);
  assert.equal(cellValue({ type: "text" }, "  Hej  "), "Hej");
  assert.deepEqual(rowValues(columns, { antal: "3", extra: "x" }), { linje: null, antal: 3, lage: null, dag: null });
  assert.equal(columnKeyFor("Mål för dagen", ["mal_for_dagen"]), "mal_for_dagen_2");
});

test("a table is read in every shape a card asks for", () => {
  assert.equal(aggregate(rows, "antal", "sum"), 20);
  assert.equal(aggregate(rows, "antal", "avg"), 10);
  assert.equal(aggregate(rows, "antal", "last"), 8);
  assert.equal(aggregate(rows, undefined, "count"), 3);
  assert.deepEqual(tableShape(columns, rows, { kind: "table", sourceId: "s", aggregate: "max", column: "antal" }, "number"), { kind: "number", value: 12, unit: "st" });
  const series = tableShape(columns, rows, { kind: "table", sourceId: "s", labelColumn: "linje", valueColumns: ["antal"] }, "series");
  assert.deepEqual(series, { kind: "series", labels: ["Linje 1", "Linje 2", "Linje 3"], series: [{ name: "Antal", values: [12, 8, null] }], unit: "st" });
  const status = tableShape(columns, rows, { kind: "table", sourceId: "s", nameColumn: "linje", stateColumn: "lage" }, "status");
  assert.deepEqual(status?.kind === "status" && status.items.map((item) => item.state), ["ok", "error", "unknown"]);
  const events = tableShape(columns, rows, { kind: "table", sourceId: "s", titleColumn: "linje", dateColumn: "dag" }, "events");
  assert.deepEqual(events?.kind === "events" && events.items.map((item) => item.title), ["Linje 2", "Linje 1", "Linje 3"]);
  assert.equal(tableShape(columns, rows, { kind: "table", sourceId: "s", labelColumn: "saknas", valueColumns: ["antal"] }, "series"), null, "never a guess");
  assert.equal(tableShape(columns, rows, { kind: "table", sourceId: "s" }, "table")?.kind, "table");
});

// ---------- shapes ----------

test("a chart's value axis has even ticks written in Swedish", () => {
  const small = axisTicks([0, 1, 0, 1, 0]);
  assert.deepEqual(small.ticks, [0, 0.25, 0.5, 0.75, 1]);
  assert.deepEqual(small.labels, ["0", "0,25", "0,5", "0,75", "1"], "no \"75\" for 0,75");
  assert.deepEqual(axisTicks([3, 12, 7]).ticks, [0, 5, 10, 15]);
  assert.deepEqual(axisTicks([]).ticks, [0, 0.25, 0.5, 0.75, 1], "nothing yet: still a readable axis");
  assert.deepEqual(axisTicks([-4, 6]).ticks, [-5, -2.5, 0, 2.5, 5, 7.5]);
  assert.equal(axisTicks([2840, 1500]).labels.at(-1)!.replace(/\s/g, " "), "3 000");
  assert.equal(axisTicks([0.3, null, 0.7]).decimals, 1);
});

test("a short text in a narrow box shrinks so its longest word fits instead of breaking", () => {
  assert.equal(wordFitSize("Förfallna", 0.72), "min(0.72em, 17.92cqi)", "nine letters");
  assert.equal(wordFitSize("Pågår", 0.72), "min(0.72em, 32.26cqi)");
  assert.equal(wordFitSize("Elis Hammar", 0.8, 0.66), "min(0.8em, 25.25cqi)", "the longest word counts, the words may wrap");
});

test("figures, changes, shares and the company's own limits", () => {
  assert.equal(formatNumber(1234.5, 1).replace(/\s/g, " "), "1 234,5");
  assert.equal(formatNumber(null), "–");
  assert.equal(changePercent(12, 10), 20);
  assert.equal(changePercent(5, 0), null);
  assert.equal(shareOf(30, 40), 75);
  assert.equal(shareOf(80, 40), 100);
  assert.equal(shareOf(5, 0), null);
  assert.equal(toneFor(10, null), "neutral", "no limits shipped: no colour");
  const up = { good: 90, bad: 50, higherIsBetter: true };
  assert.equal(toneFor(95, up), "success");
  assert.equal(toneFor(70, up), "warning");
  assert.equal(toneFor(40, up), "danger");
  const down = { good: 2, bad: 10, higherIsBetter: false };
  assert.equal(toneFor(1, down), "success");
  assert.equal(toneFor(12, down), "danger");
  assert.equal(toneFor(12, { good: null, bad: null, higherIsBetter: true }), "neutral");
  assert.equal(statusStateOf("Stoppad"), "error");
  assert.equal(statusStateOf("grön"), "ok");
  assert.equal(statusStateOf("?"), "unknown");
});

// ---------- personal data ----------

test("names on a card are hidden outside the app unless the publisher chose otherwise", () => {
  const shape = { kind: "table" as const, columns: [{ key: "person", label: "Person", type: "text" as const }, { key: "when", label: "När", type: "text" as const }], rows: [{ person: "Elna Strömtång", when: "I dag" }, { person: "Elis Hammarström, Elin Kopparlund", when: "I dag" }] };
  const hidden = maskPeople(shape, ["person"], "hidden");
  assert.deepEqual(hidden.kind === "table" && hidden.columns.map((column) => column.key), ["when"]);
  assert.ok(hidden.kind === "table" && !JSON.stringify(hidden.rows).includes("Elna"));
  const initials = maskPeople(shape, ["person"], "initials");
  assert.deepEqual(initials.kind === "table" && initials.rows.map((row) => row.person), ["ES", "EH, EK"]);
  assert.deepEqual(maskPeople(shape, ["person"], "names"), shape);
  assert.equal(initialsOf(""), "");
  assert.equal(peopleChoiceOf({}, "k-1"), "hidden", "hidden is the default");
  const layout: BoardLayout = { version: 1, orientation: "landscape", rows: 14, cards: [
    { id: "k-1", type: "table", x: 0, y: 0, w: 12, h: 6, title: "", data: { kind: "metric", metric: "absence_today" }, settings: {} },
    { id: "k-2", type: "kpi", x: 12, y: 0, w: 6, h: 4, title: "", data: { kind: "metric", metric: "absence_today_count" }, settings: {} },
  ] };
  assert.equal(layoutHasPersonalData(layout), true);
  assert.deepEqual(cleanVisibility(layout, { "k-1": "initials", "k-2": "names", gone: "names" }), { "k-1": "initials" });
});

test("no measure can show a reason for absence", () => {
  const absence = METRICS.filter((metric) => metric.key.startsWith("absence"));
  assert.equal(absence.length, 2);
  for (const metric of absence) assert.match(metric.description, /Aldrig orsaken./, metric.key);
  // The count reads only who and when (lib/boards/metrics-server.ts selects neither type nor note).
  const source = readFileSync("lib/boards/metrics-server.ts", "utf8");
  const reads = source.slice(source.indexOf("async absence_today("), source.indexOf("async planning_today("));
  assert.doesNotMatch(reads, /type: true|note: true/);
});

// ---------- rights ----------

const viewer = (grants: string[], admin = false, off: string[] = []) => ({ userId: "u", admin, workflowPermissions: { version: 1 as const, grants: grants as never[] }, organization: { disabledModules: off } });

test("each measure needs the right of its page and stops with its module", () => {
  assert.equal(METRIC_KEYS.length, METRICS.length);
  assert.equal(metricAccess("hours_week", viewer(["boards:read"])), "forbidden", "Teamet is needed");
  assert.equal(metricAccess("hours_week", viewer(["team:read"])), "ok");
  assert.equal(metricAccess("hours_week", viewer(["team:read"], false, ["time"])), "module_off");
  assert.equal(metricAccess("quotes_sent", viewer(["work-order:read"])), "forbidden");
  assert.equal(metricAccess("machine_status", viewer([], true)), "ok");
  assert.equal(metricAccess("machine_status", viewer([], true, ["upkeep"])), "module_off", "a right never brings a module back");
  assert.equal(metricAccess("deviations_open", viewer([])), "ok", "everyone reads the deviations they may read");
  assert.ok(metricsFor(viewer([], true)).length === METRICS.length);
  assert.ok(metricsFor(viewer(["work-order:read"])).every((metric) => metric.key !== "absence_today"));
});

test("the rights Tavlor and Skärmar: opt-in, admins by role, publishing needs change", () => {
  assert.deepEqual(workflowPermissionMatrix.boards, ["read", "edit", "publish"]);
  assert.deepEqual(workflowPermissionMatrix.screens, ["read", "edit"]);
  for (const preset of workflowPermissionPresets) if (preset.id !== "full") assert.equal(hasWorkflowPermission(preset.profile as never, "boards", "read"), false, preset.id);
  assert.equal(hasWorkflowPermission(defaultWorkflowPermissionProfile(), "boards", "publish"), true);
  const publish = applyWorkflowPermissionToggle(noWorkflowPermissionProfile(), "boards", "publish", true);
  assert.deepEqual([...publish.grants].sort(), ["boards:edit", "boards:publish", "boards:read"]);
  assert.deepEqual(boardsAccess({ admin: true, workflowPermissions: noWorkflowPermissionProfile() }), { read: true, edit: true, publish: true, screens: true, manageScreens: true });
  assert.deepEqual(boardsAccess({ admin: false, workflowPermissions: { version: 1, grants: ["boards:read"] } }), { read: true, edit: false, publish: false, screens: false, manageScreens: false });
});

// ---------- Avstånd (2026-11-19) ----------

test("Avstånd: Nära is the default and not stored, Mellan and Långt are kept; the layout itself never changes", () => {
  const layout = presetLayout("grid");
  assert.equal(readLayout(layout).distance, undefined, "Nära is what boards had before");
  assert.equal(readLayout({ ...layout, distance: "near" }).distance, undefined);
  const far = readLayout({ ...layout, distance: "far" });
  assert.equal(far.distance, "far");
  assert.deepEqual(far.cards, readLayout(layout).cards, "the cards keep their cells at every distance");
  assert.equal(layoutSchema.safeParse({ ...layout, distance: "space" }).success, false);
  assert.equal(readLayout({ ...layout, distance: "space" }).cards.length, 0, "an unreadable row is an empty board");
});

test("Avstånd: the text grows by 24 divided by the columns it is sized for, and a screen's own distance wins", () => {
  assert.deepEqual([DISTANCE.near.scale, DISTANCE.medium.scale, DISTANCE.far.scale], [1, 1.5, 2]);
  for (const key of ["near", "medium", "far"] as const) assert.equal(DISTANCE[key].columns * DISTANCE[key].scale, 24);
  assert.deepEqual(distanceGrid("near", 14), { columns: 24, rows: 14 });
  assert.deepEqual(distanceGrid("medium", 14), { columns: 16, rows: 9 });
  assert.deepEqual(distanceGrid("far", 14), { columns: 12, rows: 7 });
  assert.equal(shownDistance(undefined, null), "near");
  assert.equal(shownDistance("medium", null), "medium");
  assert.equal(shownDistance("medium", "far"), "far");
  assert.equal(shownDistance("far", "near"), "near", "a screen near the viewer may ask for Nära");
});
