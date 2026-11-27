import assert from "node:assert/strict";
import test from "node:test";
import { plural } from "../lib/plural";
import { mapSearchHref } from "../lib/workflow/contact-links";
import { deviationCandidate, machineCandidate } from "../lib/search/candidates";

test("plural: ental för 1, annars flertal, med valfritt talformat (SP5)", () => {
  assert.equal(plural(1, "träff", "träffar"), "1 träff");
  assert.equal(plural(0, "träff", "träffar"), "0 träffar");
  assert.equal(plural(2, "träff", "träffar"), "2 träffar");
  assert.equal(plural(12000, "rad", "rader", (value) => value.toLocaleString("sv-SE")), `${(12000).toLocaleString("sv-SE")} rader`);
});

test("Visa på karta: an address without a position opens a map search; nothing without an address (UT7)", () => {
  assert.equal(mapSearchHref({ address: "Testgatan 5", postalCode: "123 45", city: "Teststad" }), "https://www.google.com/maps/search/?api=1&query=Testgatan%205%2C%20123%2045%20Teststad");
  assert.equal(mapSearchHref({ address: "", city: "" }), null);
  assert.equal(mapSearchHref(null), null);
});

test("Sök: an entry of Avvikelser and a machine open their own pages (N16)", () => {
  const entry = deviationCandidate({ id: "d 1", number: 3, type: "NEAR_MISS", kind: "DEVIATION", title: "Stege föll", status: "OPEN" });
  assert.equal(entry.href, "/?view=deviations&deviation=d%201");
  assert.match(entry.subtitle, /^Tillbud 3 · Öppen/);
  assert.equal(deviationCandidate({ id: "d", number: 4, title: "Klar", status: "DONE", kind: "IMPROVEMENT" }).state, "done");
  assert.match(deviationCandidate({ id: "d", number: 4, title: "Klar", status: "DONE", kind: "IMPROVEMENT" }).subtitle, /^Förbättring 4 · Åtgärdad/);
  const part = machineCandidate({ id: "m1", name: "Hydraulpump", partType: "Pump", marking: "P4-HP1", isActive: false });
  assert.equal(part.href, "/?view=maintenance&part=m1");
  assert.equal(part.state, "archived");
});
