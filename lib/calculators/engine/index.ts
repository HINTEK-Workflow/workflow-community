/**
 * The calculation engine of the Kalkylator (2026-10-12). One import for the interface:
 *
 *   import { threePhasePower, transformer, ... } from "@/lib/calculators/engine";
 *
 * Every function is pure, takes SI units and returns `{ ok: true, ...values, warnings }` or `{ ok: false, errors }`.
 * Results are not rounded; show them with `roundSig` or the formatters in ../number.ts and ../units.ts.
 *
 * What is input and what is a suggestion: protective-device data (Ia, In, time), cable ratings (Iz), cable
 * impedance data, voltage factors, conductor temperatures and every limit value are INPUT (2026-11-01). The
 * only suggestion left is `SUGGESTED_REACTANCE_OHM_PER_M`, a typical reactance marked so in its text; the neutral
 * defaults are physics (c = 1, 20 °C, the materials' resistivity at 20 °C).
 */
export * from "./common";
export * from "./impedance";
export * from "./three-phase";
export * from "./transformer";
export * from "./short-circuit";
export * from "./disconnection";
export * from "./voltage-drop";
export * from "./branch-length";
export * from "./cable-sizing";
export * from "./device-curve";
