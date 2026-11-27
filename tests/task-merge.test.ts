import assert from "node:assert/strict";
import test from "node:test";
import { changedPaths, keepSentText, mergeKeepingSaved, pathWithin, stableJson, taskPathLabel, threeWayMerge, valueAtPath, withValueAt } from "../lib/workflow/task-merge";

// Calm autosave (2026-10-05): the server trims text, and the reply must not take a space the person just typed.
test("text the server only trimmed is kept as typed; other server changes follow the server", () => {
  const sent = { title: "Byte ", description: "Rad ett\n", status: "PLANNED", data: { details: { executionNotes: "Bytt kabel ", materials: [{ id: "a", name: "Kabel " }, { id: "b", name: "Rör" }] } } };
  const stored = { title: "Byte", description: "Rad ett", status: "IN_PROGRESS", data: { details: { executionNotes: "Bytt kabel", materials: [{ id: "b", name: "Rör" }, { id: "a", name: "Kabel" }] } } };
  const kept = keepSentText(sent, stored);
  assert.equal(kept.title, "Byte ");
  assert.equal(kept.description, "Rad ett\n");
  assert.equal(kept.status, "IN_PROGRESS");
  assert.equal(kept.data.details.executionNotes, "Bytt kabel ");
  assert.deepEqual(kept.data.details.materials, [{ id: "b", name: "Rör" }, { id: "a", name: "Kabel " }]);
  // A real change (a colleague's) is never undone, and with nothing to keep the server's own object comes back.
  assert.equal(keepSentText({ title: "Byte " }, { title: "Byte av lampa" }).title, "Byte av lampa");
  assert.equal(keepSentText(stored, stored), stored);
});

// Live sync (2026-10-04): changes in different fields are merged; the same field changed by both, the latest wins.
const base = { title: "Byte av armatur", description: "", data: { kind: "WORK_ORDER", details: { executionNotes: "", deviations: "", materials: [{ id: "a", name: "Kabel", quantity: "10", unit: "m" }] } } };

test("different fields from two people are both kept", () => {
  const mine = { ...base, description: "Plan 2" };
  const theirs = { ...base, data: { ...base.data, details: { ...base.data.details, executionNotes: "Bytt två armaturer" } } };
  const { value, conflicts } = threeWayMerge(base, mine, theirs);
  assert.equal(value.description, "Plan 2");
  assert.equal(value.data.details.executionNotes, "Bytt två armaturer");
  assert.deepEqual(conflicts, []);
});

test("the same field changed by both: the person saving now wins and the place is reported", () => {
  const mine = { ...base, title: "Byte av armaturer i hall B" };
  const theirs = { ...base, title: "Armaturbyte" };
  const { value, conflicts } = threeWayMerge(base, mine, theirs);
  assert.equal(value.title, "Byte av armaturer i hall B");
  assert.deepEqual(conflicts, [["title"]]);
});

test("rows with ids merge row by row: one adds, the other edits another row", () => {
  const mine = { ...base, data: { ...base.data, details: { ...base.data.details, materials: [...base.data.details.materials, { id: "b", name: "Skruv", quantity: "8", unit: "st" }] } } };
  const theirs = { ...base, data: { ...base.data, details: { ...base.data.details, materials: [{ id: "a", name: "Kabel", quantity: "12", unit: "m" }, { id: "c", name: "Dosa", quantity: "1", unit: "st" }] } } };
  const { value, conflicts } = threeWayMerge(base, mine, theirs);
  assert.deepEqual(value.data.details.materials.map((item) => `${item.id}:${item.quantity}`), ["a:12", "c:1", "b:8"]);
  assert.deepEqual(conflicts, []);
});

test("a row removed on one side stays removed unless the other side changed it", () => {
  const removed = { ...base, data: { ...base.data, details: { ...base.data.details, materials: [] } } };
  assert.deepEqual(threeWayMerge(base, removed, base).value.data.details.materials, []);
  assert.deepEqual(threeWayMerge(base, base, removed).value.data.details.materials, []);
  const edited = { ...base, data: { ...base.data, details: { ...base.data.details, materials: [{ id: "a", name: "Kabel", quantity: "20", unit: "m" }] } } };
  const { value, conflicts } = threeWayMerge(base, edited, removed);
  assert.equal(value.data.details.materials.length, 1);
  assert.equal(conflicts.length, 1);
});

test("changed places and their labels", () => {
  const after = { ...base, data: { ...base.data, details: { ...base.data.details, executionNotes: "Klart", materials: [{ id: "a", name: "Kabel", quantity: "11", unit: "m" }] } } };
  const paths = changedPaths(base, after);
  assert.deepEqual(paths, [["data", "details", "executionNotes"], ["data", "details", "materials", "#a", "quantity"]]);
  assert.equal(taskPathLabel(after, paths[0]), "Utfört arbete");
  assert.equal(taskPathLabel(after, paths[1]), "Material: Kabel");
  assert.equal(taskPathLabel(after, ["title"]), "Rubrik");
  assert.ok(pathWithin(paths[1], ["data", "details", "materials"]));
  assert.ok(!pathWithin(["title"], ["data"]));
});

test("form fields are named by the form's own labels", () => {
  const document = { blocks: [{ id: "b1", type: "field", key: "anl", label: "Anläggning", input: "text" }] };
  const task = { data: { kind: "FORM", details: { document, values: { fields: { anl: "Hall B" } } } } };
  assert.equal(taskPathLabel(task as never, ["data", "details", "values", "fields", "anl"]), "Anläggning");
});

test("stableJson: the same content gives the same text whatever the key order (a stored task never reads as unsaved)", () => {
  const typed = { kind: "WORK_ORDER", details: { executionNotes: "x", materials: [{ id: "a", name: "Kabel", unit: "m" }], signature: { name: "", confirmed: false } } };
  const stored = { details: { signature: { confirmed: false, name: "" }, materials: [{ unit: "m", id: "a", name: "Kabel" }], executionNotes: "x" }, kind: "WORK_ORDER" };
  assert.equal(stableJson(typed), stableJson(stored));
  assert.equal(stableJson({ a: 1, b: undefined }), stableJson({ a: 1, b: null }), "missing, undefined and null are the same once stored");
  assert.notEqual(stableJson({ a: "" }), stableJson({ a: null }), "an emptied text is still a change");
  assert.notEqual(stableJson([1, 2]), stableJson([2, 1]), "a list keeps its order");
});

// F3 (2026-10-28): a save refused because someone saved first never writes over their change in silence. The same
// field keeps what is saved and the person's own value is kept for the notice; fields only one side changed still merge.
test("after a refused save the same field keeps what is saved, and the own value is kept for the notice", () => {
  const withNotes = (notes: string, extra: Record<string, unknown> = {}) => ({ ...base, ...extra, data: { ...base.data, details: { ...base.data.details, executionNotes: notes } } });
  const mine = withNotes("Medarbetaren: bytt kontaktor K3.", { description: "Plan 2" });
  const theirs = withNotes("Ägaren: bytt kontaktor K2.");
  const { value, conflicts } = mergeKeepingSaved(base, mine, theirs);
  assert.equal(value.data.details.executionNotes, "Ägaren: bytt kontaktor K2.");
  assert.equal(value.description, "Plan 2", "a field only the person changed still merges");
  assert.deepEqual(conflicts, [{ path: ["data", "details", "executionNotes"], mine: "Medarbetaren: bytt kontaktor K3.", theirs: "Ägaren: bytt kontaktor K2." }]);
  // The live merge (the person already told) is unchanged: the person's own value wins.
  assert.equal(threeWayMerge(base, mine, theirs).value.data.details.executionNotes, "Medarbetaren: bytt kontaktor K3.");
});

test("after a refused save rows merge by id; a row both changed keeps the saved one, a removed row changed by the other stays", () => {
  const row = (id: string, quantity: string) => ({ id, name: "Kabel", quantity, unit: "m" });
  const start = { ...base, data: { ...base.data, details: { ...base.data.details, materials: [row("a", "10"), row("b", "1")] } } };
  const withRows = (materials: unknown[]) => ({ ...start, data: { ...start.data, details: { ...start.data.details, materials } } });
  const mine = withRows([row("a", "12"), row("c", "3")]); // changed a, removed b, added c
  const theirs = withRows([row("a", "15"), row("b", "2")]); // changed a and b
  const { value, conflicts } = mergeKeepingSaved(start, mine, theirs);
  assert.deepEqual(value.data.details.materials, [row("a", "15"), row("b", "2"), row("c", "3")]);
  assert.deepEqual(conflicts.map((conflict) => conflict.path.join("/")), ["data/details/materials/#a/quantity", "data/details/materials/#b"]);
  assert.equal(conflicts[0].mine, "12");
  assert.equal(conflicts[1].mine, undefined, "the person had removed row b");
  // Different fields from both: no conflict at all.
  assert.deepEqual(mergeKeepingSaved(start, withRows([row("a", "12"), row("b", "1")]), withRows([row("a", "10"), row("b", "2")])).conflicts, []);
});

test("Använd min text puts the own value back at its place, also in a row, and removes a row the person had removed", () => {
  const source = { data: { details: { executionNotes: "Ägaren", materials: [{ id: "a", quantity: "15" }, { id: "b", quantity: "2" }] } } };
  assert.equal(withValueAt(source, ["data", "details", "executionNotes"], "Min").data.details.executionNotes, "Min");
  assert.equal(source.data.details.executionNotes, "Ägaren", "the source is not changed");
  assert.deepEqual(withValueAt(source, ["data", "details", "materials", "#a", "quantity"], "12").data.details.materials, [{ id: "a", quantity: "12" }, { id: "b", quantity: "2" }]);
  assert.deepEqual(withValueAt(source, ["data", "details", "materials", "#b"], undefined).data.details.materials, [{ id: "a", quantity: "15" }]);
  assert.deepEqual(withValueAt(source, ["data", "details", "materials", "#c"], { id: "c", quantity: "3" }).data.details.materials.map((item) => item.id), ["a", "b", "c"]);
  assert.equal(valueAtPath(source, ["data", "details", "materials", "#b", "quantity"]), "2");
  assert.equal(valueAtPath(source, ["data", "details", "materials", "#x", "quantity"]), undefined);
});
