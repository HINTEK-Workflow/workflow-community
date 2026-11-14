// Hela trädet i Underhåll och dra och släpp (2026-11-02), utan databas: var en rad ligger, vad en släppt rad betyder enligt samma
// regler som Flytta och servern, att Flytta finns kvar, att inget nytt beroende kom in. Skärmtestet: tests/maintenance-whole-tree.browser.cjs.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { PART_MAX_DEPTH } from "../lib/maintenance/model";
import { PLACE_ALL, PLACE_NONE } from "../lib/maintenance/place-model";
import { moveBody, placesHolding, planTreeDrop, treeAncestors, wholeTreeParent, type WholeTreeItem } from "../lib/maintenance/tree-move";

const part = (id: string, parentId: string | null = null, placeId: string | null = null) => ({ id, parentId, placeId, name: id });
const places = [
  { id: "stad", parentId: null, name: "Stad", level: "CITY" },
  { id: "fabrik", parentId: "stad", name: "Fabrik", level: "SITE" },
  { id: "hall", parentId: "fabrik", name: "Hall", level: "AREA" },
  { id: "annan", parentId: null, name: "Annan", level: "SITE" },
];
const parts = [part("press", null, "hall"), part("pump", "press"), part("motor", "pump"), part("gammal"), part("kvarn", null, "annan")];
const row = (id: string, treeKind: WholeTreeItem["treeKind"]): WholeTreeItem => ({ id, parentId: null, name: id, treeKind });
const drop = (dragged: WholeTreeItem, targetId: string) => planTreeDrop({ parts, places, dragged, targetId });

test("a machine lies under its place or Utan plats, a part under its part", () => {
  const ids = new Set(places.map((place) => place.id));
  assert.equal(wholeTreeParent(part("press", null, "hall"), ids), "hall");
  assert.equal(wholeTreeParent(part("gammal"), ids), PLACE_NONE);
  assert.equal(wholeTreeParent(part("x", null, "borta"), ids), PLACE_NONE, "a place that is gone is Utan plats, as machinesAt says");
  assert.equal(wholeTreeParent(part("pump", "press"), ids), "press");
});

test("what is above a row folds out, nearest first, and a loop ends it", () => {
  const rows = [...places.map(({ id, parentId }) => ({ id, parentId })), { id: "press", parentId: "hall" }, { id: "pump", parentId: "press" }];
  assert.deepEqual(treeAncestors(rows, "pump"), ["press", "hall", "fabrik", "stad"]);
  assert.deepEqual(treeAncestors(rows, "stad"), []);
  assert.deepEqual(treeAncestors([{ id: "a", parentId: "b" }, { id: "b", parentId: "a" }], "a"), ["b"]);
});

test("searching keeps the places above a match and leaves the empty ones", () => {
  assert.deepEqual(placesHolding(places, ["hall"]).map((place) => place.id), ["stad", "fabrik", "hall"]);
  assert.deepEqual(placesHolding(places, [null]).map((place) => place.id), []);
});

test("a machine or a part dropped on a place or Utan plats becomes a machine there", () => {
  assert.deepEqual(drop(row("press", "machine"), "annan"), { act: "part", parentId: null, placeId: "annan" });
  assert.deepEqual(drop(row("pump", "part"), "annan"), { act: "part", parentId: null, placeId: "annan" }, "Flytta can do this too");
  assert.deepEqual(drop(row("press", "machine"), PLACE_NONE), { act: "part", parentId: null, placeId: null });
  assert.deepEqual(drop(row("press", "machine"), "hall"), { act: "same" }, "already there");
  assert.deepEqual(drop(row("gammal", "machine"), PLACE_NONE), { act: "same" });
  assert.equal(drop(row("press", "machine"), PLACE_ALL).act, "refuse", "Alla platser is no place");
});

test("a part moves between machines; the server's rule says no to a loop and to too deep a tree", () => {
  assert.deepEqual(drop(row("motor", "part"), "kvarn"), { act: "part", parentId: "kvarn", placeId: null });
  assert.deepEqual(drop(row("pump", "part"), "press"), { act: "same" }, "already under it");
  assert.deepEqual(drop(row("press", "machine"), "press"), { act: "same" });
  assert.deepEqual(drop(row("press", "machine"), "motor"), { act: "refuse", reason: "En del kan inte ligga under sig själv." });
  const deep = Array.from({ length: PART_MAX_DEPTH }, (_, index) => part(`n${index}`, index ? `n${index - 1}` : null));
  const refused = planTreeDrop({ parts: [...deep, part("lös")], places, dragged: row("lös", "machine"), targetId: `n${PART_MAX_DEPTH - 1}` });
  assert.deepEqual(refused, { act: "refuse", reason: `Trädet kan ha högst ${PART_MAX_DEPTH} nivåer.` });
});

test("a place moves under a place by the levels' own rule, and says why not", () => {
  assert.deepEqual(drop(row("annan", "place"), "stad"), { act: "place", parentId: "stad" });
  assert.deepEqual(drop(row("hall", "place"), PLACE_ALL), { act: "place", parentId: null });
  assert.deepEqual(drop(row("hall", "place"), "fabrik"), { act: "same" });
  assert.deepEqual(drop(row("stad", "place"), "hall"), { act: "refuse", reason: "En plats kan inte ligga under sig själv." });
  assert.match((drop(row("fabrik", "place"), "annan") as { reason: string }).reason, /kan inte ligga under/, "a site under a site");
  assert.deepEqual(drop(row("hall", "place"), "press"), { act: "refuse", reason: "En plats kan inte ligga under en maskin." });
  assert.deepEqual(drop(row("hall", "place"), PLACE_NONE), { act: "refuse", reason: "Utan plats är till för maskiner." });
});

test("a move sends the part's own fields and leaves the run hours out, so a machine's newer value stays", () => {
  const body = moveBody({ customerId: "kund", name: "Press", partType: "Press", marking: "P4", status: "IN_SERVICE", notes: "Text", isActive: true }, { parentId: null, placeId: "hall" });
  assert.equal("runHours" in body, false);
  assert.equal(body.customerId, "kund");
  assert.equal(moveBody({ customerId: "kund", name: "Press", partType: "", marking: "", status: "IN_SERVICE", notes: "", isActive: true }, { parentId: "x", placeId: null }).customerId, null, "only a machine has a customer");
});

test("the page has one tree, Delar and Flytta stay, and the drag uses the same actions and no new dependency", () => {
  const page = readFileSync("features/maintenance/maintenance-page.tsx", "utf8");
  assert.doesNotMatch(page, /maintenance-machines|machineList|Maskiner · /, "the separate list of machines is gone");
  assert.match(page, /"Delar", "Bilder"/, "the tab Delar stays");
  assert.match(page, /testId: "maintenance-move"/, "Flytta stays for touch and keyboard");
  assert.match(page, /function MovePartDialog/);
  assert.match(page, /canEdit && !native \? \{/, "only with the right to change, and never on the phone");
  assert.match(page, /action: "update_part", id: row\.id, version: fresh\.part\.version/, "the same route action, with a fresh version");
  assert.match(page, /action: "update_place", id: place\.id, version: place\.version/);
  assert.match(page, /announce\(plan\.reason, true\)/, "a refused drop says why");
  assert.doesNotMatch(readFileSync("features/workflow/place-tree.tsx", "utf8"), /dnd-kit|react-dnd/, "the browser's own drag: nothing new to load in every tree");
});

test("the tree component carries the drag for every tree, Förråd shares it, and no row gets a colour stripe", () => {
  const tree = readFileSync("features/workflow/place-tree.tsx", "utf8");
  assert.match(tree, /drag\?: PlaceTreeDrag<T>/);
  assert.match(tree, /aria-hidden="true" data-testid="place-drag"/, "the grip is only a picture; Flytta is the way for a screen reader");
  const store = readFileSync("features/maintenance/maintenance-store.tsx", "utf8");
  assert.match(store, /storeLocationProblem\(locations, row\.id, parentId\)/, "the store's own rule");
  assert.match(store, /action: "update_location"/);
  const css = readFileSync("app/globals.css", "utf8");
  const dropRules = css.split("\n").filter((line) => /place-(drag|row\[data-drop)/.test(line));
  assert.ok(dropRules.length >= 3);
  assert.doesNotMatch(dropRules.join("\n"), /border-left|inset \d+px 0/, "lit all around, never a stripe");
});
