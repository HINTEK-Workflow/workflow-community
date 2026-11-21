import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { BULK_LIMIT, bulkOutcomeMessage, limitIds, planBulk, selectedLabel, selectionState, toggleAllOnPage, toggleOne } from "../lib/kfid/bulk-selection";

// Flerval i papperskorgen (2026-10-19): the rules the shared record-archive component and the records route use.
const ids = (n: number) => Array.from({ length: n }, (_, i) => `id${i}`);

test("selectionState tells none, some and all on the page", () => {
  assert.equal(selectionState([], ["a", "b"]), "none");
  assert.equal(selectionState(["a"], ["a", "b"]), "some");
  assert.equal(selectionState(["a", "b", "x"], ["a", "b"]), "all");
  assert.equal(selectionState(["a"], []), "none");
});

test("Markera alla på sidan keeps marks from other pages and never passes the limit", () => {
  assert.deepEqual(toggleAllOnPage(["x"], ["a", "b"], true), ["x", "a", "b"]);
  assert.deepEqual(toggleAllOnPage(["x", "a", "b"], ["a", "b"], false), ["x"]);
  assert.equal(toggleAllOnPage(ids(90), ids(150), true).length, BULK_LIMIT);
  assert.equal(limitIds(ids(300)).length, BULK_LIMIT);
  assert.deepEqual(toggleOne(["a"], "a", true), ["a"]);
  assert.deepEqual(toggleOne(["a"], "b", true), ["a", "b"]);
  assert.deepEqual(toggleOne(["a", "b"], "a", false), ["b"]);
});

test("the count reads 1 vald / N valda", () => {
  assert.equal(selectedLabel(1), "1 vald");
  assert.equal(selectedLabel(3), "3 valda");
});

test("planBulk checks every post: missing and wrong-state posts fail, the rest goes through", () => {
  const found = [{ id: "a", deletedAt: new Date() }, { id: "b", deletedAt: null }];
  const purge = planBulk("purge", ["a", "b", "zz", "a"], found);
  assert.deepEqual(purge.apply, ["a"]);
  assert.deepEqual(purge.failed.map((f) => f.id), ["b", "zz"]);
  assert.deepEqual(planBulk("restore", ["a", "b"], found).apply, ["a"]);
  assert.deepEqual(planBulk("delete", ["a", "b"], found).apply, ["b"]);
  assert.deepEqual(planBulk("delete", [], found), { apply: [], failed: [] });
});

test("the message says how many went through when something failed", () => {
  assert.deepEqual(bulkOutcomeMessage("restore", { ok: 3, failed: [] }), { text: "3 poster återställda.", error: false });
  assert.deepEqual(bulkOutcomeMessage("purge", { ok: 1, failed: [] }, ["kund", "kunder"]), { text: "1 kund raderad.", error: false });
  const part = bulkOutcomeMessage("purge", { ok: 2, failed: [{ id: "x", reason: "Posten finns inte." }] }, ["kund", "kunder"]);
  assert.equal(part.error, true);
  assert.match(part.text, /^2 av 3 kunder raderade\. 1 gick inte\./);
  assert.match(bulkOutcomeMessage("delete", { ok: 0, failed: [{ id: "x", reason: "Nej." }] }).text, /^Ingen post blev flyttad till papperskorgen\./);
});

test("the records route keeps session, origin, admin and the 100 limit, and the screens share the component", () => {
  const route = readFileSync("app/api/records/route.ts", "utf8");
  assert.match(route, /checkOrigin\(request\)/);
  assert.match(route, /requireAdmin\(ctx\)/);
  assert.match(route, /max\(BULK_LIMIT\)/);
  assert.match(route, /organizationId: ctx\.organizationId/);
  for (const file of ["features/kfid/record-archive.tsx", "features/kfid/local-records.tsx"]) {
    const source = readFileSync(file, "utf8");
    assert.match(source, /BulkBar|<BulkBar/, `${file} uses the shared bar`);
    assert.doesNotMatch(source, /window\.(confirm|alert)\(/);
  }
});
