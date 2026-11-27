import assert from "node:assert/strict";
import test from "node:test";
import { customerFacilityInputSchema, nextPlaceKind, normalizeFacilityInput, PLACE_MAX_DEPTH, placeAddress, placeForest, placeInUseMessage, placeLabel, placeParentError, placePath, placePosition, placeSubtreeHeight, placeTree, placeWithDescendants } from "../lib/workflow/customer-facility";
import { mapLinks, parseCoordinates } from "../lib/workflow/place-position";

// Platser (2026-10-04): a tree under the customer with optional levels; the address on the facility is inherited.
const places = [
  { id: "f", customerId: "c", parentId: null, kind: "FACILITY", name: "Torslandaverken", address: "Torslandavägen 1", postalCode: "405 31", city: "Göteborg" },
  { id: "b", customerId: "c", parentId: "f", kind: "BUILDING", name: "Måleriet", address: "", postalCode: "", city: "" },
  { id: "s", customerId: "c", parentId: "b", kind: "SPACE", name: "Linje 3", address: "", postalCode: "", city: "" },
  { id: "o", customerId: "c", parentId: "s", kind: "OBJECT", name: "Elcentral E12", address: "", postalCode: "", city: "", latitude: null, longitude: null },
  { id: "x", customerId: "other", parentId: null, kind: "FACILITY", name: "Annan kund", address: "", postalCode: "", city: "" },
];

test("the whole way with the customer and the marking", () => {
  assert.equal(placePath(places, "o", "Volvo Cars"), "Volvo Cars › Torslandaverken › Måleriet › Linje 3 › Elcentral E12");
  assert.equal(placePath(places, "f"), "Torslandaverken");
  assert.equal(placePath(places, null, "Volvo Cars"), "Volvo Cars");
});

test("the address is the facility's, inherited downwards, and printed with the way", () => {
  assert.deepEqual(placeAddress(places, "o"), { address: "Torslandavägen 1", postalCode: "405 31", city: "Göteborg" });
  assert.equal(placeLabel(places, "o"), "Torslandaverken › Måleriet › Linje 3 › Elcentral E12, Torslandavägen 1, 405 31 Göteborg");
  const below = normalizeFacilityInput(customerFacilityInputSchema.parse({ name: "Rum 4", parentId: "s", address: "Ignoreras 1" }));
  assert.equal(below.address, "");
  assert.equal(below.kind, "OBJECT", "below an address is an object (2026-10-14)");
  assert.equal(normalizeFacilityInput(customerFacilityInputSchema.parse({ name: "Hus", kind: "BUILDING" })).kind, "FACILITY");
});

test("a parent keeps the tree whole: objects under objects in several levels (2026-10-15)", () => {
  const withSecond = [...places, { id: "f2", customerId: "c", parentId: null, kind: "FACILITY", name: "Annan adress", address: "", postalCode: "", city: "" }];
  assert.equal(placeParentError(places, { customerId: "c", parentId: "f" }), null);
  assert.equal(placeParentError(places, { customerId: "c", parentId: "s" }), null, "a sub-object under an object");
  assert.equal(placeParentError(places, { customerId: "c", parentId: "o" }), null, "and one more level down");
  assert.equal(placeParentError(withSecond, { id: "b", customerId: "c", parentId: "f2" }), null, "an object moves with everything under it");
  assert.match(placeParentError(withSecond, { id: "f", customerId: "c", parentId: "f2" }) ?? "", /har objekt/, "an address with objects stays an address");
  assert.equal(placeParentError(withSecond, { id: "f2", customerId: "c", parentId: "f" }), null, "an empty address may become an object");
  assert.match(placeParentError(places, { customerId: "c", parentId: "x" }) ?? "", /annan kund/);
  assert.match(placeParentError(places, { id: "b", customerId: "c", parentId: "o" }) ?? "", /under sig själv/);
  assert.deepEqual([...placeWithDescendants(places, "b")].sort(), ["b", "o", "s"]);
});

test("the tree in reading order and the next kind down", () => {
  assert.deepEqual(placeTree(places.filter((place) => place.customerId === "c")).map((row) => `${row.depth}:${row.place.id}`), ["0:f", "1:b", "2:s", "3:o"]);
  assert.equal(nextPlaceKind(null), "FACILITY");
  assert.equal(nextPlaceKind("FACILITY"), "OBJECT");
  assert.equal(nextPlaceKind("SPACE"), "OBJECT");
});

test("the depth limit counts the place and everything under it", () => {
  const chain = Array.from({ length: PLACE_MAX_DEPTH }, (_, index) => ({ id: `p${index}`, customerId: "c", parentId: index ? `p${index - 1}` : null, name: `Nivå ${index + 1}` }));
  assert.equal(placeSubtreeHeight(chain, "p0"), PLACE_MAX_DEPTH);
  assert.equal(placeParentError(chain, { customerId: "c", parentId: `p${PLACE_MAX_DEPTH - 2}` }), null, "the last level is allowed");
  assert.match(placeParentError(chain, { customerId: "c", parentId: `p${PLACE_MAX_DEPTH - 1}` }) ?? "", /högst/);
  const loose = [...chain, { id: "a", customerId: "c", parentId: null, name: "Adress" }, { id: "m", customerId: "c", parentId: "a", name: "Mellan" }, { id: "n", customerId: "c", parentId: "m", name: "Under" }];
  assert.match(placeParentError(loose, { id: "m", customerId: "c", parentId: `p${PLACE_MAX_DEPTH - 2}` }) ?? "", /högst/, "a moved branch must fit as a whole");
});

test("the tree as nested nodes for Anläggningar, and why a place cannot be removed", () => {
  const forest = placeForest(places.filter((place) => place.customerId === "c"));
  assert.deepEqual(forest.map((node) => [node.place.id, node.descendants, node.children[0]?.place.id, node.children[0]?.children[0]?.children[0]?.place.id]), [["f", 3, "b", "o"]]);
  assert.match(placeInUseMessage({ children: 2 }) ?? "", /2 objekt under sig/);
  assert.equal(placeInUseMessage({}), null);
});

test("positions: pasted in common forms, inherited from above, and opened in the person's own map", () => {
  assert.deepEqual(parseCoordinates("57.7089, 11.9746"), { latitude: 57.7089, longitude: 11.9746 });
  assert.deepEqual(parseCoordinates("57,7089 11,9746"), { latitude: 57.7089, longitude: 11.9746 });
  assert.deepEqual(parseCoordinates("N 57.7089 E 11.9746"), { latitude: 57.7089, longitude: 11.9746 });
  assert.deepEqual(parseCoordinates("11.9746E 57.7089N"), { latitude: 57.7089, longitude: 11.9746 });
  assert.equal(parseCoordinates("Göteborg"), null);
  assert.equal(parseCoordinates("97, 11"), null);
  assert.equal(customerFacilityInputSchema.safeParse({ name: "A", latitude: 57 }).success, false);
  const mapped = places.map((place) => place.id === "f" ? { ...place, latitude: 57.71, longitude: 11.97 } : place);
  assert.deepEqual(placePosition(mapped, "o"), { latitude: 57.71, longitude: 11.97, own: false });
  assert.match(mapLinks({ latitude: 57.71, longitude: 11.97 }).google, /^https:\/\/www\.google\.com\/maps\/search\/\?api=1&query=57\.71%2C11\.97$/);
});
