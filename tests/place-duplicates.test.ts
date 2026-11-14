import assert from "node:assert/strict";
import { test } from "node:test";
import { DUPLICATE_PLACE_MESSAGE, duplicatePlace, normalizePlaceName } from "../lib/workflow/customer-facility";
import { createLocalWorkspace, saveLocalCustomerFacility, saveLocalCustomerRecord } from "../features/kfid/local-workspace-store";

const places = [
  { id: "f1", customerId: "c1", parentId: null, name: "Torslandaverken", isActive: true },
  { id: "b1", customerId: "c1", parentId: "f1", name: "Måleriet", isActive: true },
  { id: "b2", customerId: "c1", parentId: "f1", name: "Gjuteriet", isActive: false },
  { id: "f2", customerId: "c2", parentId: null, name: "Torslandaverken", isActive: true },
];

test("normalised names: case, surrounding and doubled spaces do not make a new place", () => {
  assert.equal(normalizePlaceName("  Torslanda   Verken "), "torslanda verken");
  assert.equal(normalizePlaceName("MÅLERIET"), "måleriet");
});

test("a duplicate is the same name on the same level under the same customer", () => {
  assert.equal(duplicatePlace(places, { customerId: "c1", parentId: null, name: "torslandaverken " })?.id, "f1");
  assert.equal(duplicatePlace(places, { customerId: "c1", parentId: "f1", name: "Måleriet" })?.id, "b1");
  // Another level, another customer, a paused place, or the place itself: no duplicate.
  assert.equal(duplicatePlace(places, { customerId: "c1", parentId: "f1", name: "Torslandaverken" }), null, "a building may carry the facility's name");
  assert.equal(duplicatePlace(places, { customerId: "c3", parentId: null, name: "Torslandaverken" }), null);
  assert.equal(duplicatePlace(places, { customerId: "c1", parentId: "f1", name: "Gjuteriet" }), null, "a paused place does not block");
  assert.equal(duplicatePlace(places, { id: "f1", customerId: "c1", parentId: null, name: "Torslandaverken" }), null, "renaming with the same spelling passes");
  assert.equal(duplicatePlace(places, { customerId: "c1", parentId: null, name: "   " }), null);
  // The marking left the place (2026-10-24): two objects on the same level need names of their own.
  const pumps = [...places, { id: "o1", customerId: "c1", parentId: "f1", name: "Pump P1", isActive: true }];
  assert.equal(duplicatePlace(pumps, { customerId: "c1", parentId: "f1", name: "Pump P2" }), null);
  assert.equal(duplicatePlace(pumps, { customerId: "c1", parentId: "f1", name: "pump  p1" })?.id, "o1");
});

test("Local refuses a duplicate with the existing place's id, like Cloud's 409", () => {
  let workspace = createLocalWorkspace({ id: "dup-local", name: "Testföretaget" });
  workspace = saveLocalCustomerRecord(workspace, { name: "Kund AB", company: "Kund AB" }).workspace;
  const customerId = workspace.customers[0].id;
  workspace = saveLocalCustomerFacility(workspace, customerId, { facility: { name: "Fabriken", address: "Industrigatan 1", postalCode: "123 45", city: "Elstad" } });
  const existing = workspace.customerFacilities[0];
  assert.throws(() => saveLocalCustomerFacility(workspace, customerId, { facility: { name: " fabriken" } }), (error: Error & { status?: number; details?: { existingId?: string } }) => {
    assert.equal(error.message, DUPLICATE_PLACE_MESSAGE);
    assert.equal(error.status, 409);
    assert.equal(error.details?.existingId, existing.id);
    return true;
  });
  // Editing the place itself – a new address and pin, same name – is not a duplicate, and its id stays.
  const edited = saveLocalCustomerFacility(workspace, customerId, { id: existing.id, facility: { name: "Fabriken", address: "Industrigatan 2", postalCode: "123 46", city: "Elstad", latitude: 57.7, longitude: 11.97 } });
  const after = edited.customerFacilities.find((place) => place.id === existing.id)!;
  assert.equal(after.address, "Industrigatan 2");
  assert.equal(after.latitude, 57.7);
  assert.equal(after.version, existing.version + 1);
  // Under the facility the same name is fine.
  const below = saveLocalCustomerFacility(workspace, customerId, { facility: { name: "Fabriken", kind: "BUILDING", parentId: existing.id } });
  assert.equal(below.customerFacilities.length, 2);
});
