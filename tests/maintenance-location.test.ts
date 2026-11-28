import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { machinePins, machinePosition, machinePositionText, nextPosition, POSITION_PAIR_PROBLEM, placePositionUp, positionOf, positionProblem } from "../lib/maintenance/location";
import { partInputSchema } from "../lib/maintenance/model";
import { placeInputSchema } from "../lib/maintenance/place-model";

const text = (path: string) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");

// Kartnål på plats och maskin (0.92.0): both or neither, within WGS 84, left out = unchanged.
test("maintenance location: a position is both coordinates or none, within WGS 84", () => {
  assert.equal(positionProblem({}), "", "left out is unchanged");
  assert.equal(positionProblem({ latitude: null, longitude: null }), "", "null clears it");
  assert.equal(positionProblem({ latitude: 57.7, longitude: 11.97 }), "");
  assert.equal(positionProblem({ latitude: 57.7 }), POSITION_PAIR_PROBLEM, "a latitude without its longitude");
  assert.equal(positionProblem({ latitude: 57.7, longitude: null }), POSITION_PAIR_PROBLEM);
  assert.equal(positionProblem({ latitude: null, longitude: 11.97 }), POSITION_PAIR_PROBLEM);

  assert.equal(placeInputSchema.safeParse({ name: "Hall 2", latitude: 57.7, longitude: 11.97 }).success, true);
  assert.equal(placeInputSchema.safeParse({ name: "Hall 2" }).success, true, "a place without a pin");
  assert.equal(placeInputSchema.safeParse({ name: "Hall 2", latitude: 91, longitude: 11 }).success, false, "outside the globe");
  assert.equal(placeInputSchema.safeParse({ name: "Hall 2", latitude: 57, longitude: 181 }).success, false);
  assert.equal(placeInputSchema.safeParse({ name: "Hall 2", latitude: 57 }).success, false, "half a position");
  assert.equal(placeInputSchema.parse({ name: "Hall 2" }).latitude, undefined, "left out stays left out, so a drag keeps the pin");

  assert.equal(partInputSchema.safeParse({ name: "Press 4", latitude: 57.7, longitude: 11.97 }).success, true);
  assert.equal(partInputSchema.safeParse({ name: "Press 4", latitude: Number.NaN, longitude: 11.97 }).success, false);
  assert.equal(partInputSchema.safeParse({ name: "Press 4", longitude: 11.97 }).success, false);
});

test("maintenance location: a save keeps, sets or clears the pin, and a part under a machine never has one", () => {
  const current = { latitude: 57.7, longitude: 11.97 };
  assert.deepEqual(nextPosition(current, {}, true), current, "Flytta sends no pin: unchanged");
  assert.deepEqual(nextPosition(current, { latitude: null, longitude: null }, true), { latitude: null, longitude: null }, "Samma som platsen");
  assert.deepEqual(nextPosition(current, { latitude: 59.3, longitude: 18.06 }, true), { latitude: 59.3, longitude: 18.06 });
  assert.deepEqual(nextPosition(current, { latitude: 59.3, longitude: 18.06 }, false), { latitude: null, longitude: null }, "a part follows its machine");
  assert.equal(positionOf({ latitude: 1, longitude: null }), null);
});

test("maintenance location: a machine is where its own pin is, else where its place or the place above is", () => {
  const places = [
    { id: "city", parentId: null, name: "Mellanstad", latitude: 58, longitude: 15 },
    { id: "site", parentId: "city", name: "Fabriken", latitude: null, longitude: null },
    { id: "hall", parentId: "site", name: "Hall 2", latitude: 58.1, longitude: 15.1 },
    { id: "loop", parentId: "loop", name: "Slinga", latitude: null, longitude: null },
  ];
  assert.deepEqual(placePositionUp(places, "site"), { latitude: 58, longitude: 15, placeId: "city", placeName: "Mellanstad", own: false }, "inherited from above");
  assert.equal(placePositionUp(places, "hall")?.own, true);
  assert.equal(placePositionUp(places, "loop"), null, "a looping parent ends the walk");
  assert.equal(placePositionUp(places, null), null);

  const own = machinePosition({ latitude: 58.2, longitude: 15.2, placeId: "hall" }, places);
  assert.deepEqual(own, { latitude: 58.2, longitude: 15.2, from: "machine", placeName: "" });
  assert.equal(machinePositionText(own), "Egen kartnål.");
  const same = machinePosition({ latitude: null, longitude: null, placeId: "site" }, places);
  assert.deepEqual(same, { latitude: 58, longitude: 15, from: "place", placeName: "Mellanstad" });
  assert.equal(machinePositionText(same), "Samma som platsen Mellanstad.");
  assert.equal(machinePosition({ latitude: null, longitude: null, placeId: null }, places), null, "Utan plats and no pin");
  assert.match(machinePositionText(null), /Ingen position/);

  const pins = machinePins([
    { id: "m1", parentId: null, placeId: "hall", name: "Press 4", latitude: null, longitude: null },
    { id: "m2", parentId: null, placeId: null, name: "Kompressor", latitude: 58.3, longitude: 15.3 },
    { id: "p1", parentId: "m1", placeId: null, name: "Pump", latitude: 1, longitude: 1 },
    { id: "m3", parentId: null, placeId: null, name: "Utan", latitude: null, longitude: null },
  ], places);
  assert.deepEqual(pins.map((pin) => [pin.id, pin.label, pin.muted]), [["m1", "Press 4 · Hall 2", true], ["m2", "Kompressor", false]], "only machines with a position; a part is never a pin");
});

test("maintenance location: the map is our own server's, never Lantmäteriet's in the browser", () => {
  const ui = text("features/maintenance/maintenance-location.tsx");
  assert.match(ui, /from "@\/features\/workflow\/map-view"/, "the shared map");
  assert.match(ui, /usePlaceLocationFields/, "the shared position fields");
  assert.doesNotMatch(ui, /https?:\/\//, "no outside address in the browser");
  const migration = text("prisma/migrations/20261128230000_machine_location/migration.sql");
  assert.match(migration, /^BEGIN;/m);
  assert.match(migration, /^COMMIT;/m);
  assert.doesNotMatch(migration, /DROP|UPDATE "|DELETE FROM/i, "additive only");
  assert.match(migration, /"parentId" IS NULL AND "latitude"/, "only a machine has a pin of its own");
});
