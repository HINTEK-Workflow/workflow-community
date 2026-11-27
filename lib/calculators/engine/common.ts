/**
 * Shared pieces of the calculation engine (Kalkylator, 2026-10-12): the result shape, the checks of the
 * inputs and the small helpers every calculation uses. Pure TypeScript, SI units (V, A, W, VA, VAr, m, mm², Ω,
 * Ω/m, s, °C) unless a name says otherwise (`…Percent`, `…Milli…`). No React, no database.
 *
 * Nothing here comes from a standard or a manufacturer. Protective devices (trip current, trip time), cable data
 * (impedance per length, current ratings) and the limit values are INPUT given by the technician or the company's own
 * values. The few `SUGGESTED_…` constants are general, formula-based helpers marked as suggestions in their name.
 */
export type Warning = { code: string; message: string };
export type Failure = { ok: false; errors: Warning[] };
export type Success<T> = T & { ok: true; warnings: Warning[] };
/** Every engine function returns this: either `ok: true` with the values and any warnings, or `ok: false` with the errors. */
export type EngineResult<T> = Success<T> | Failure;

export const SQRT3 = Math.sqrt(3);

/** Collects the errors and warnings of one calculation. Errors stop the calculation; warnings come with the result. */
export class Issues {
  readonly errors: Warning[] = [];
  readonly warnings: Warning[] = [];
  error(code: string, message: string) { this.errors.push({ code, message }); }
  warn(code: string, message: string) { this.warnings.push({ code, message }); }
  /** A finite number above zero. */
  positive(value: number | undefined, code: string, label: string): value is number {
    if (value === undefined || !Number.isFinite(value) || value <= 0) { this.error(code, `${label} måste vara ett tal större än noll.`); return false; }
    return true;
  }
  /** A finite number of zero or more. */
  nonNegative(value: number | undefined, code: string, label: string): value is number {
    if (value === undefined || !Number.isFinite(value) || value < 0) { this.error(code, `${label} måste vara noll eller större.`); return false; }
    return true;
  }
  /** cos φ in (0, 1]. */
  cosPhi(value: number | undefined, code = "cosPhi"): value is number {
    if (value === undefined || !Number.isFinite(value) || value <= 0 || value > 1) { this.error(code, "cos φ måste vara större än 0 och högst 1."); return false; }
    return true;
  }
  /** A warning when a value is outside its usual range (most often a unit slip). */
  usual(value: number, min: number, max: number, code: string, label: string, unitHint: string) {
    if (value < min || value > max) this.warn(code, `${label} ligger utanför det vanliga (${unitHint}). Kontrollera enheten.`);
  }
  fail(): Failure { return { ok: false, errors: this.errors }; }
  done<T extends object>(value: T): Success<T> { return { ...value, ok: true, warnings: this.warnings }; }
}

/** A value rounded to `digits` significant digits (default 3). For showing; the engine itself never rounds its results. */
export function roundSig(value: number, digits = 3): number {
  if (!Number.isFinite(value) || value === 0) return value;
  const scale = 10 ** (digits - 1 - Math.floor(Math.log10(Math.abs(value))));
  return Math.round(value * scale) / scale;
}
/** A value rounded to a number of decimals. */
export function roundTo(value: number, decimals: number): number {
  const scale = 10 ** decimals;
  return Math.round(value * scale) / scale;
}

/** A resistance or impedance with its unit stated, so mΩ and Ω are never mixed up. */
export type OhmValue = { value: number; unit: "Ω" | "mΩ" };
export const toOhm = (resistance: OhmValue): number => (resistance.unit === "mΩ" ? resistance.value / 1000 : resistance.value);
export const milliOhm = (ohm: number): number => ohm * 1000;

/** Two numbers are the same within a relative tolerance (used to warn when over-specified inputs disagree). */
export const agrees = (a: number, b: number, relative = 0.02): boolean => Math.abs(a - b) <= relative * Math.max(Math.abs(a), Math.abs(b), 1e-12);
