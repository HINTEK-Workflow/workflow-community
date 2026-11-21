import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { DEVICE_KINDS } from "../lib/machine/simulator/surface/devices";

// PLC-simulatorn (the owner 2026-11-04): the devices are one family of hand-written drawings. What the eye checks is in the
// screenshots; what a test can hold is here: every kind has its own drawing, the style is one definition, nothing is embedded,
// and a sheet of 60 devices pays for no filter and no gradient per device.

const drawings = readFileSync("features/plc-simulator/surface/device-drawings.tsx", "utf8");
const parts = readFileSync("features/plc-simulator/surface/parts.tsx", "utf8");
const plc = readFileSync("features/plc-simulator/surface/plc-drawing.tsx", "utf8");

test("all 39 devices have a drawing of their own in the switch", () => {
  assert.equal(DEVICE_KINDS.length, 39);
  for (const kind of DEVICE_KINDS) assert.match(drawings, new RegExp(`case "${kind}"`), kind);
});

test("the style is one definition, with no filters, no raster image and no gradient per instance", () => {
  assert.match(parts, /export const LOOK = \{/);
  for (const [name, text] of [["parts", parts], ["device-drawings", drawings], ["plc-drawing", plc]] as const) {
    assert.doesNotMatch(text, /\bfilter=|<filter\b/, `${name}: a glow is a gradient, never a filter`);
    assert.doesNotMatch(text, /<image\b|data:image|\.jpe?g|\.png/, `${name}: drawn, nothing embedded`);
    if (name !== "parts") assert.doesNotMatch(text, /<(linear|radial)Gradient\b/, `${name}: gradients only in SurfaceDefs, once per sheet`);
  }
  assert.equal(drawings.match(/<SurfaceDefs/g), null, "a device or thumbnail never brings its own defs");
});
