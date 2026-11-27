import assert from "node:assert/strict";
import test from "node:test";
import { placeIcon, typeIcon } from "../features/workflow/place-tree";

// Underhåll (2026-11-02: the cog on "Press 4" was "plottrig"): clearer symbols for common machine types; the cog for a motor only.
// Compared by name: the icon module may be loaded twice by the test runner.
const name = (icon: { displayName?: string } | null) => icon?.displayName ?? null;

test("machine types: press, compressor and conveyor have their own symbols, a motor keeps the cog", () => {
  assert.equal(name(typeIcon("Press 4")), "Hammer");
  assert.equal(name(typeIcon("Stansmaskin")), "Hammer");
  assert.equal(name(typeIcon("Kompressor")), "Wind");
  assert.equal(name(typeIcon("Transportband 2")), "ArrowRightLeft");
  assert.equal(name(typeIcon("Motor M1")), "Cog");
  assert.equal(typeIcon("Okänd sak"), null, "nothing matches: the caller's own default");
  assert.equal(name(placeIcon({ name: "Maskin 3", objectType: "" }, "object")), "Boxes", "a plain machine is no longer a cog");
});
