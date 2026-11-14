// Underhåll i två träd och Förrådet (2026-10-31): the rules without a database. The database side is
// tests/maintenance-two-trees.integration.ts, the pages tests/maintenance-module.browser.cjs.
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import test from "node:test";
import {
  itemTotal, nextFreeNumber, nextSeriesStart, rootOf, rootsOf, storeFigures, storeLevelName, storeLocationNames, storeLocationProblem, storeOwnName, STORE_LOCATION_MAX_DEPTH,
} from "../lib/maintenance/model";
import {
  childLevelName, machinesAt, nextPlaceLevel, partLevelName, partRollups, PLACE_ALL, PLACE_LEVEL_LABELS, PLACE_NONE, placeChoice, placeInputSchema, placeLevelsUnder, placePath, placeProblem, placeRollups, placeSubtree, rollupBadges, type RollupPart,
} from "../lib/maintenance/place-model";
import { filterPartTree } from "../lib/maintenance/tree-filter";
import { itemsAtLocations, listStoreItems } from "../lib/maintenance/store-list";
import { asOwnTree, nodePath, openReportsUpward, visibleNodes, type MachineNode } from "../lib/operator/machines";

const load = createRequire(__filename);
// scripts/qa is not in the Community export; only the one test that reads the tool needs it.
const hasTool = existsSync("scripts/qa/migration-check.cjs");
const check = (hasTool ? load("../scripts/qa/migration-check.cjs") : null) as { checkMigrationSql(sql: string): { errors: string[]; warnings: string[] } };

const places = [
  { id: "ort", parentId: null, name: "Mellanstad", level: "CITY" },
  { id: "fabrik", parentId: "ort", name: "Fabriken", level: "SITE" },
  { id: "omrade", parentId: "fabrik", name: "Linje 2", level: "AREA" },
  { id: "avd", parentId: "omrade", name: "Press", level: "DEPARTMENT" },
  { id: "annan", parentId: null, name: "Pumpstationen", level: "SITE" },
];

test("the place tree: fixed names, any number of levels used, always deeper than the parent", () => {
  assert.deepEqual(Object.values(PLACE_LEVEL_LABELS), ["Ort", "Anläggning", "Område", "Avdelning"]);
  assert.deepEqual(placeLevelsUnder(null), ["CITY", "SITE", "AREA", "DEPARTMENT"], "the top may start on any level");
  assert.deepEqual(placeLevelsUnder({ level: "SITE" }), ["AREA", "DEPARTMENT"], "a level may be skipped");
  assert.deepEqual(placeLevelsUnder({ level: "DEPARTMENT" }), [], "nothing under an Avdelning");
  assert.equal(nextPlaceLevel(null), "SITE");
  assert.equal(nextPlaceLevel({ level: "AREA" }), "DEPARTMENT");
  assert.equal(nextPlaceLevel({ level: "DEPARTMENT" }), null);
  assert.equal(placeProblem(places, null, { parentId: "annan", level: "DEPARTMENT" }), "", "an Avdelning directly under an Anläggning");
  assert.match(placeProblem(places, null, { parentId: "omrade", level: "SITE" }), /kan inte ligga under/);
  assert.match(placeProblem(places, null, { parentId: "avd", level: "DEPARTMENT" }), /kan inte ligga under/);
  assert.equal(placeProblem(places, null, { parentId: "finns-inte", level: "AREA" }), "Den överordnade platsen hittades inte.");
  assert.equal(placeProblem(places, "fabrik", { parentId: "avd", level: "SITE" }), "En plats kan inte ligga under sig själv.");
  assert.match(placeProblem(places, "fabrik", { parentId: "ort", level: "DEPARTMENT" }), /Flytta dem först/, "the places under must still be deeper");
  assert.equal(placeProblem(places, "fabrik", { parentId: null, level: "SITE" }), "", "moved to the top");
  assert.deepEqual(placePath(places, "avd"), ["Mellanstad", "Fabriken", "Linje 2", "Press"]);
  assert.deepEqual(placePath(places, null), []);
  assert.deepEqual(placeSubtree(places, "fabrik").sort(), ["avd", "fabrik", "omrade"]);
  assert.equal(placeInputSchema.parse({ name: "  Hall 2 " }).name, "Hall 2");
  assert.throws(() => placeInputSchema.parse({ name: "x", level: "OBJECT" }), "only the fixed levels");
  assert.throws(() => placeInputSchema.parse({ name: " " }));
});

test("the equipment's level names follow the depth: Maskin, Komponent, Del, and parts may have parts", () => {
  assert.deepEqual([0, 1, 2, 3, 9].map(partLevelName), ["Maskin", "Komponent", "Del", "Del", "Del"]);
  assert.deepEqual([0, 1, 2].map(childLevelName), ["Komponent", "Del", "Del"]);
});

const part = (id: string, parentId: string | null, extra: Partial<RollupPart> = {}): RollupPart => ({ id, parentId, status: "IN_SERVICE", isActive: true, reported: 0, ...extra });

test("the worst status upward: a reported part makes the machine Felanmäld with its count; the parts keep their own", () => {
  const parts = [
    part("press", null), part("pump", "press", { reported: 2 }), part("tatning", "pump", { reported: 1 }), part("motor", "press", { status: "SERVICE_SOON" }),
    part("gammal", "press", { status: "DECOMMISSIONED", reported: 5 }), part("pausad", "press", { isActive: false, status: "OUT_OF_SERVICE" }),
    part("band", null, { status: "OUT_OF_SERVICE" }), part("frisk", null),
  ];
  const rollups = partRollups(parts);
  assert.deepEqual(rollups.get("press"), { reported: 3, outOfService: 0, serviceSoon: 1, worst: "REPORTED" }, "a decommissioned or paused part tells nothing upward");
  assert.equal(rollups.get("pump")?.reported, 3, "the part's own and those under it");
  assert.equal(rollups.get("tatning")?.reported, 1, "a part keeps its own");
  assert.equal(rollups.get("motor")?.worst, "SERVICE_SOON");
  assert.equal(rollups.get("gammal")?.reported, 5, "its own card still shows it");
  assert.equal(rollups.get("band")?.worst, "OUT_OF_SERVICE");
  assert.equal(rollups.get("frisk")?.worst, "IN_SERVICE");
  assert.deepEqual(rollupBadges(rollups.get("press")!).map((badge) => badge.label), ["Felanmäld (3)"]);
  assert.deepEqual(rollupBadges({ reported: 1, outOfService: 1, serviceSoon: 4 }).map((badge) => badge.label), ["Ur drift", "Felanmäld"], "the worst first; Service snart only when nothing is worse");
  assert.deepEqual(rollupBadges({ reported: 0, outOfService: 0, serviceSoon: 2 }).map((badge) => badge.label), ["Service snart (2)"]);
  assert.deepEqual(rollupBadges({ reported: 0, outOfService: 0, serviceSoon: 0 }), []);
  assert.equal(partRollups([part("a", "b"), part("b", "a", { reported: 1 })]).size, 2, "a looping parent ends the walk");
});

test("a place shows what is wrong on it and under it; Utan plats and Alla platser sum too", () => {
  const roll = (reported: number, outOfService = 0) => ({ reported, outOfService, serviceSoon: 0, worst: "IN_SERVICE" as const });
  const machines = [
    { id: "press", placeId: "avd", isActive: true, status: "IN_SERVICE" as const, rollup: roll(2) },
    { id: "band", placeId: "omrade", isActive: true, status: "OUT_OF_SERVICE" as const, rollup: roll(0, 1) },
    { id: "pump", placeId: "annan", isActive: true, status: "IN_SERVICE" as const, rollup: roll(0) },
    { id: "gammal", placeId: null, isActive: true, status: "IN_SERVICE" as const, rollup: roll(1) },
    { id: "pausad", placeId: "annan", isActive: false, status: "IN_SERVICE" as const, rollup: roll(9) },
  ];
  const sums = placeRollups(places, machines);
  assert.deepEqual(sums.get("avd"), { machines: 1, reported: 2, outOfService: 0, serviceSoon: 0, worst: "REPORTED" });
  assert.deepEqual(sums.get("ort"), { machines: 2, reported: 2, outOfService: 1, serviceSoon: 0, worst: "OUT_OF_SERVICE" }, "up to the top");
  assert.deepEqual(sums.get("annan"), { machines: 2, reported: 0, outOfService: 0, serviceSoon: 0, worst: "IN_SERVICE" }, "a paused machine is counted but says nothing");
  assert.equal(sums.get(PLACE_NONE)?.machines, 1);
  assert.equal(sums.get(PLACE_ALL)?.machines, 5);
  assert.equal(sums.get(PLACE_ALL)?.reported, 3);
});

test("the machines at a choice: the place and below, Utan plats, or all; a place from the address or the machine", () => {
  const parts = [{ id: "press", parentId: null, placeId: "avd" }, { id: "pump", parentId: "press", placeId: null }, { id: "band", parentId: null, placeId: "fabrik" }, { id: "gammal", parentId: null, placeId: null }, { id: "borta", parentId: null, placeId: "finns-inte" }];
  const ids = (choice: string) => machinesAt(parts, places, choice).map((row) => row.id);
  assert.deepEqual(ids("fabrik"), ["press", "band"], "machines on places under it, never a part");
  assert.deepEqual(ids("avd"), ["press"]);
  assert.deepEqual(ids("annan"), []);
  assert.deepEqual(ids(PLACE_NONE), ["gammal", "borta"]);
  assert.equal(ids(PLACE_ALL).length, 4);
  assert.equal(placeChoice("avd", places, undefined), "avd");
  assert.equal(placeChoice(PLACE_NONE, places, "avd"), PLACE_NONE);
  assert.equal(placeChoice("finns-inte", places, undefined), PLACE_ALL);
  assert.equal(placeChoice(null, places, "omrade"), "omrade", "the chosen machine's place");
  assert.equal(placeChoice(null, places, null), PLACE_NONE, "a chosen machine without a place");
});

test("all roots in one pass give the same answer as rootOf, and a loop ends", () => {
  const parts = [{ id: "a", parentId: null, name: "A" }, { id: "b", parentId: "a", name: "B" }, { id: "c", parentId: "b", name: "C" }, { id: "d", parentId: null, name: "D" }, { id: "x", parentId: "gone", name: "X" }];
  const roots = rootsOf(parts);
  for (const row of parts) assert.equal(roots.get(row.id), rootOf(parts, row.id), row.id);
  assert.equal(rootsOf([{ id: "l", parentId: "m", name: "L" }, { id: "m", parentId: "l", name: "M" }]).size, 2);
});

test("Driftstatus has Felanmäld: a match deep down keeps its machine and says which part", () => {
  const parts = [
    { id: "press", parentId: null, name: "Press 4", partType: "", marking: "", status: "IN_SERVICE" as const, reported: 0 },
    { id: "pump", parentId: "press", name: "Hydraulpump", partType: "", marking: "", status: "IN_SERVICE" as const, reported: 2 },
    { id: "band", parentId: null, name: "Band", partType: "", marking: "", status: "IN_SERVICE" as const, reported: 0 },
  ];
  const listed = filterPartTree(parts, { filter: "REPORTED", q: "" });
  assert.deepEqual(listed.shown.map((row) => row.id), ["press", "pump"]);
  assert.deepEqual([...listed.matched], ["pump"]);
  assert.equal(listed.counts.REPORTED, 1);
  assert.equal(filterPartTree(parts, { filter: "all", q: "" }).matched.size, 0);
});

test("own numbers: a series per store, the next free number, never the wholesaler's", () => {
  assert.equal(nextSeriesStart([]), 100000);
  assert.equal(nextSeriesStart([null, 100000]), 200000);
  assert.equal(nextSeriesStart([100000, 250000]), 300000, "the next whole hundred thousand");
  assert.equal(nextFreeNumber(100000, []), 100000);
  assert.equal(nextFreeNumber(100000, [100000, 100001, 100003]), 100002, "the next free one");
  assert.equal(nextFreeNumber(200000, [100000, null]), 200000);
});

test("the storage tree: any depth, the fixed names, the full way in name, no place under itself", () => {
  assert.deepEqual([0, 1, 2, 3, 6].map((depth) => storeLevelName(depth)), ["Förråd", "Skåp", "Hylla", "Hyllplats", "Hyllplats"]);
  assert.equal(storeLevelName(0, "VEHICLE"), "Servicebil");
  assert.equal(storeLevelName(1, "VEHICLE"), "Skåp");
  const rows = [
    { id: "f", parentId: null, name: "Förråd A", label: "" }, // an older row: no own label yet
    { id: "s", parentId: "f", name: "gammalt", label: "Skåp 1" },
    { id: "h", parentId: "s", name: "gammalt", label: "Hylla 2" },
  ];
  assert.equal(storeOwnName(rows[0]), "Förråd A");
  assert.equal(storeOwnName(rows[1]), "Skåp 1");
  const names = storeLocationNames(rows);
  assert.equal(names.get("h"), "Förråd A › Skåp 1 › Hylla 2");
  assert.equal(names.get("f"), "Förråd A");
  assert.equal(storeLocationProblem(rows, "f", "h"), "En plats kan inte ligga under sig själv.");
  assert.equal(storeLocationProblem(rows, "f", "f"), "En plats kan inte ligga under sig själv.");
  assert.equal(storeLocationProblem(rows, "h", "f"), "");
  assert.equal(storeLocationProblem(rows, null, null), "");
  assert.equal(storeLocationProblem(rows, null, "finns-inte"), "Förrådsplatsen ovanför hittades inte.");
  const deep = Array.from({ length: STORE_LOCATION_MAX_DEPTH }, (_, index) => ({ id: `d${index}`, parentId: index ? `d${index - 1}` : null, name: `D${index}` }));
  assert.match(storeLocationProblem(deep, null, `d${STORE_LOCATION_MAX_DEPTH - 1}`), /högst 8 nivåer/);
});

test("the same article on several places: a balance per place, the total on the article, and the list at a chosen place", () => {
  assert.equal(itemTotal([{ quantity: 2 }, { quantity: 1.5 }]), 3.5);
  const item = (id: string, balances: Record<string, number>, homeStoreId: string | null = null, ownNumber: number | null = null) => ({ id, name: id, articleNo: "", ownNumber, total: Object.values(balances).reduce((sum, value) => sum + value, 0), low: false, balances, homeStoreId });
  const items = [item("a", { hylla: 2, bil: 1 }), item("b", { bil: 4 }), item("ny", {}, "forrad", 100005), item("annan", {}, "bil")];
  assert.deepEqual(itemsAtLocations(items, null).map((row) => row.id), ["a", "b", "ny", "annan"]);
  assert.deepEqual(itemsAtLocations(items, ["forrad", "hylla"]).map((row) => row.id), ["a", "ny"], "a balance there, or numbered from there with no balance anywhere");
  assert.deepEqual(itemsAtLocations(items, ["bil"]).map((row) => row.id), ["a", "b", "annan"]);
  const sorted = listStoreItems([item("x", {}, null, 100002), item("y", {}, null, 100001)], { filter: "all", sort: "articleNo" });
  assert.deepEqual(sorted.items.map((row) => row.id), ["y", "x"], "Artikelnummer follows the store's own number");
});

test("the figures: articles, low, value at the given prices, and what was drawn in 90 days net of what came back", () => {
  const now = new Date("2026-11-01T12:00:00Z");
  const move = (itemId: string, kind: string, change: number, unitPrice: number | null, daysAgo: number) => ({ itemId, kind, change, unitPrice, at: new Date(now.getTime() - daysAgo * 86_400_000) });
  const input = {
    balances: [{ itemId: "a", quantity: 2 }, { itemId: "a", quantity: 1 }, { itemId: "b", quantity: 4 }, { itemId: "c", quantity: 1 }],
    lowItems: new Set(["b", "utanfor"]), prices: new Map<string, number | null>([["a", 100], ["b", 12.5], ["c", null]]),
    moves: [move("a", "WITHDRAWAL", -2, 100, 10), move("a", "RETURN", 1, 100, 9), move("b", "RECEIPT", 4, null, 8), move("b", "WITHDRAWAL", -1, 12.5, 120)],
    now,
  };
  assert.deepEqual(storeFigures(input), { articles: 3, low: 1, value: 350, withdrawals90: 0, withdrawalCost90: 100, withdrawalCostTotal: 112.5 });
  const hidden = storeFigures({ ...input, prices: null });
  assert.deepEqual([hidden.value, hidden.withdrawalCost90, hidden.withdrawalCostTotal], [null, null, null], "no price right: no amounts");
  assert.equal(storeFigures({ ...input, balances: [{ itemId: "c", quantity: 1 }] }).value, null, "no known price: no value, never zero");
});

const node = (id: string, parentId: string | null, reportable = true): MachineNode => ({ id, parentId, name: id, objectType: "", reportable, alarmFacilityId: reportable ? id : null, operatingState: reportable ? "IN_SERVICE" : "" });

test("the operator page's tree: a place only groups, a chosen place holds what is on it, and reports count upward", () => {
  const tree = [node("fabrik", null, false), node("linje", "fabrik", false), node("press", "linje"), node("pump", "press"), node("band", "linje"), node("annan", null)];
  assert.deepEqual(visibleNodes(tree, ["linje"]).map((row) => row.id), ["linje", "press", "pump", "band"], "choosing a place shows what stands on it");
  assert.deepEqual(asOwnTree(visibleNodes(tree, ["press"])).map((row) => row.parentId), [null, "press"], "nothing above what was chosen");
  assert.equal(nodePath(tree, "pump"), "fabrik › linje › press › pump", "the path starts at the place");
  const open = openReportsUpward(tree, new Map([["pump", 2], ["band", 1], ["okand", 7]]));
  assert.equal(open.get("pump"), 2, "a part keeps its own count");
  assert.equal(open.get("press"), 2, "its machine says Felanmäld with the count");
  assert.equal(open.get("fabrik"), 3, "and the place shows it");
  assert.equal(open.get("annan"), undefined);
});

test("the operator adapter builds on the two trees and a place is never reportable", () => {
  const adapter = readFileSync("lib/operator/maintenance-adapter.ts", "utf8");
  assert.match(adapter, /reportable: false, alarmFacilityId: null/);
  assert.match(adapter, /prisma\.maintenancePlace\.findMany\(\{ where: \{ organizationId \}/);
  const server = readFileSync("lib/operator/reports-server.ts", "utf8");
  assert.match(server, /!machine\.reportable/, "a report on a place is refused");
});

test("Underhåll never asks for a customer", () => {
  const page = readFileSync("features/maintenance/maintenance-page.tsx", "utf8");
  assert.match(page, /machine && \(owners\.length \|\| draft\.customerId\)/, "the owner only where the company has customers, and it is optional");
  const model = readFileSync("lib/maintenance/model.ts", "utf8");
  assert.match(model, /customerId: id\.nullable\(\)\.default\(null\)/);
  const source = readFileSync("lib/maintenance/place-server.ts", "utf8");
  assert.doesNotMatch(source, /(prisma|tx|db)\.customer/, "the place tree is apart from the customer register");
  const schema = readFileSync("prisma/schema.prisma", "utf8");
  const places = /^model MaintenancePlace \{([\s\S]*?)^\}/m.exec(schema)?.[1] ?? "";
  assert.ok(places.includes("organizationId"));
  assert.doesNotMatch(places, /customer|facility/i);
});

test("the words: Reservdel only for the store, Objekt no level name, the page's tab Anläggning, the menu Underhåll", () => {
  const header = readFileSync("features/maintenance/maintenance-header.tsx", "utf8");
  assert.match(header, /\["machines", "Anläggning", Factory\]/);
  for (const path of ["features/maintenance/maintenance-page.tsx", "features/maintenance/maintenance-store.tsx", "features/maintenance/store-cards.tsx", "features/maintenance/store-dialogs.tsx", "lib/maintenance/place-model.ts"])
    assert.doesNotMatch(readFileSync(path, "utf8").replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, ""), /["'`>][^"'`<]*\bObjekt\b/, `${path}: no level is called Objekt`);
  const page = readFileSync("features/maintenance/maintenance-page.tsx", "utf8");
  assert.doesNotMatch(page, /Nytt träd|Maskinträd|maintenance-tree-panel/, "the old mixed tree is gone from the page");
});

test("the migrations are additive and match the rules: no drop, no delete, no rewrite; a place only in the same company", () => {
  for (const name of ["20261101230000_maintenance_place_tree", "20261101230100_store_tree_and_numbers"]) {
    const sql = readFileSync(`prisma/migrations/${name}/migration.sql`, "utf8");
    if (hasTool) assert.deepEqual(check.checkMigrationSql(sql), { errors: [], warnings: [] }, name);
    const code = sql.replace(/--.*$/gm, "");
    assert.doesNotMatch(code, /\b(DROP|TRUNCATE)\b|^\s*DELETE\b/im, name);
    assert.doesNotMatch(code, /^\s*UPDATE\b/im, `${name}: no rows are rewritten`);
    assert.doesNotMatch(code, /\bbreaking-approved\b/);
  }
  const place = readFileSync("prisma/migrations/20261101230000_maintenance_place_tree/migration.sql", "utf8");
  assert.match(place, /FOREIGN KEY \("placeId", "organizationId"\) REFERENCES "MaintenancePlace"\("id", "organizationId"\)/);
  assert.match(place, /"MachinePart_place_root_check" CHECK \("parentId" IS NULL OR "placeId" IS NULL\)/);
  assert.match(place, /CREATE TRIGGER "MaintenancePlace_tree"/);
  const store = readFileSync("prisma/migrations/20261101230100_store_tree_and_numbers/migration.sql", "utf8");
  assert.match(store, /FOREIGN KEY \("homeStoreId", "organizationId"\) REFERENCES "StoreLocation"\("id", "organizationId"\)/);
  assert.match(store, /CREATE UNIQUE INDEX "StoreItem_organizationId_ownNumber_key"/, "one number per company");
  assert.match(store, /CREATE TRIGGER "StoreLocation_tree"/);
});

test("the store's and places' server checks: the rights, Origin through the route, and audited changes", () => {
  const route = readFileSync("app/api/maintenance/route.ts", "utf8");
  for (const action of ["create_place", "update_place", "delete_place", "assign_store_number"]) assert.match(route, new RegExp(`z\\.literal\\("${action}"\\)`), action);
  const places = readFileSync("lib/maintenance/place-server.ts", "utf8");
  for (const name of ["createPlace", "updatePlace", "deletePlace"]) assert.match(places, new RegExp(`export async function ${name}\\(caller: MaintenanceCaller[^\\n]*\\n  requireMaintenance\\(caller, "edit"\\);`), name);
  assert.match(places, /maintenance_place_created/);
  assert.match(places, /maintenance_place_removed/);
  const store = readFileSync("lib/maintenance/store-server.ts", "utf8");
  for (const [name, need] of [["storePlaceCard", "read"], ["storeArticleCard", "read"], ["assignStoreNumber", "edit"], ["addStoreItem", "edit"]]) assert.match(store, new RegExp(`export async function ${name}\\(caller: MaintenanceCaller[^\\n]*\\n  (const access = )?requireMaintenance\\(caller, "${need}"\\);`), name);
  assert.match(store, /FOR UPDATE/, "the store's row is locked while a number is taken");
  const server = readFileSync("lib/maintenance/server.ts", "utf8");
  assert.match(server, /maintenance_part_moved/);
});
