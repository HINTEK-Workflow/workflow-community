import { parseDecimal } from "./number";

/**
 * The compact calculator in the top bar (2026-10-08): active power for a symmetrical three-phase load,
 * P = √3 × U × I × cos φ. Two of P, U and I are typed, the third is calculated with the given cos φ. Which one is the
 * result follows from the order the person filled the fields in: the one not among the last two typed. Typed values
 * and the calculated one are kept apart, so there is never a loop, and clearing a typed field and typing another turns
 * the direction round. Pure functions, no React, so the three directions can be tested against worked examples.
 */
export type ThreePhaseQuantity = "p" | "u" | "i";
export type ThreePhaseField = ThreePhaseQuantity | "pf";
export type PowerUnit = "W" | "kW";
export type ThreePhaseState = {
  /** What the person typed, as typed (a decimal comma is fine). The result's own text is never stored here. */
  texts: Record<ThreePhaseField, string>;
  unit: PowerUnit;
  /** The quantities with a typed value, oldest first. Never longer than two. */
  order: ThreePhaseQuantity[];
};
export type ThreePhaseOutcome = {
  /** The quantity that is calculated, once two are typed; null while fewer than two are. */
  result: ThreePhaseQuantity | null;
  /** The calculated value in the field's own unit (P in the chosen unit), when it can be calculated. */
  value: number | null;
  /** The value with its unit for the result line, e.g. "11,09 kW". */
  text: string | null;
  /** A short note when something stops the calculation (an invalid value, cos φ = 0 …). */
  note: string | null;
  /** Fields whose text cannot be used, with the reason. */
  invalid: Partial<Record<ThreePhaseField, string>>;
};

export const SQRT3 = Math.sqrt(3);
export const THREE_PHASE_STORAGE_KEY = "workflow.calculator.three-phase";
const NBSP = " ";
const QUANTITIES: ThreePhaseQuantity[] = ["p", "u", "i"];
export const THREE_PHASE_LABEL: Record<ThreePhaseQuantity, string> = { p: "P", u: "U", i: "I" };

export const initialThreePhase = (): ThreePhaseState => ({ texts: { p: "", u: "", i: "", pf: "1" }, unit: "kW", order: [] });

/** The result's own quantity: the one not among the (two) typed, or null while fewer than two are typed. */
export const threePhaseResultOf = (order: ThreePhaseQuantity[]): ThreePhaseQuantity | null =>
  order.length >= 2 ? (QUANTITIES.find((key) => !order.slice(-2).includes(key)) ?? null) : null;

/** The person typed in a field. An emptied quantity leaves the order; a filled one joins it (last). */
export function enterThreePhase(state: ThreePhaseState, field: ThreePhaseField, text: string): ThreePhaseState {
  const texts = { ...state.texts, [field]: text };
  if (field === "pf") return { ...state, texts };
  const others = state.order.filter((key) => key !== field);
  const order = text.trim() ? [...others, field].slice(-2) : others;
  // A quantity that is now the result never keeps a typed text (it would come back as a stale input).
  const result = threePhaseResultOf(order);
  if (result) texts[result] = "";
  return { ...state, texts, order };
}

/** W ↔ kW. A typed P is converted so the number keeps its meaning; a calculated P is simply shown anew. */
export function setPowerUnit(state: ThreePhaseState, unit: PowerUnit): ThreePhaseState {
  if (unit === state.unit) return state;
  const typed = state.order.includes("p") ? parseDecimal(state.texts.p) : null;
  const p = typed && typed.state === "ok" ? inputText(unit === "kW" ? typed.value / 1000 : typed.value * 1000) : state.texts.p;
  return { ...state, unit, texts: { ...state.texts, p } };
}

export const resetThreePhase = (): ThreePhaseState => initialThreePhase();

/** A number for an input field: decimal comma, no grouping, no float noise. */
export const inputText = (value: number) => String(Number(value.toPrecision(12))).replace(".", ",");

export const PF_ZERO_NOTE = "Med cos φ = 0 kan U och I inte beräknas (division med noll).";
export const PF_RANGE_NOTE = "cos φ ska vara mellan 0 och 1.";

/** The calculation: what is typed, what is the result, and the result's value or why there is none. */
export function solveThreePhase(state: ThreePhaseState): ThreePhaseOutcome {
  const invalid: Partial<Record<ThreePhaseField, string>> = {};
  const result = threePhaseResultOf(state.order);
  const values: Partial<Record<ThreePhaseField, number>> = {};
  for (const field of [...QUANTITIES, "pf"] as ThreePhaseField[]) {
    if (field === result) continue;
    const parsed = parseDecimal(state.texts[field]);
    if (parsed.state === "invalid") { invalid[field] = "Ange ett tal, till exempel 0,8."; continue; }
    if (parsed.state === "empty") continue;
    const value = parsed.value;
    // Denominators must be above zero: U and I when they divide, cos φ whenever U or I is calculated; P may be 0.
    const divides = field === "pf" ? result === "u" || result === "i" : field !== "p" && result !== null;
    if (value < 0) invalid[field] = field === "pf" ? PF_RANGE_NOTE : "Ange ett tal som inte är negativt.";
    else if (field === "pf" && value > 1) invalid[field] = PF_RANGE_NOTE;
    else if (divides && value === 0) invalid[field] = field === "pf" ? PF_ZERO_NOTE : "Ange ett tal större än noll.";
    else values[field] = value;
  }
  const none = (note: string | null): ThreePhaseOutcome => ({ result, value: null, text: null, note, invalid });
  const issues = Object.values(invalid);
  if (!result) return none(issues[0] ?? null);
  if (issues.length) return none(invalid.pf ?? issues[0]);
  const pf = values.pf;
  if (pf === undefined) return none("Ange cos φ (förvalt 1).");
  const needed = QUANTITIES.filter((key) => key !== result);
  if (needed.some((key) => values[key] === undefined)) return none(null);
  const toWatts = state.unit === "kW" ? 1000 : 1;
  let value: number;
  if (result === "p") value = (SQRT3 * values.u! * values.i! * pf) / toWatts;
  else if (result === "i") value = (values.p! * toWatts) / (SQRT3 * values.u! * pf);
  else value = (values.p! * toWatts) / (SQRT3 * values.i! * pf);
  if (!Number.isFinite(value)) return none("Värdena ger inget resultat.");
  return { result, value, text: formatThreePhase(result, value, state.unit), note: null, invalid };
}

/** A value with a sensible number of decimals and its unit: 11,09 kW · 11 085 W · 16,0 A · 400 V. */
export function formatThreePhase(quantity: ThreePhaseQuantity, value: number, unit: PowerUnit): string {
  const decimals = quantity === "p" ? (unit === "kW" ? (Math.abs(value) < 1 ? 3 : 2) : 0) : quantity === "i" ? (Math.abs(value) < 10 ? 2 : 1) : (Math.abs(value) < 100 ? 1 : 0);
  return `${formatFixed(value, decimals)}${NBSP}${quantity === "p" ? unit : quantity === "i" ? "A" : "V"}`;
}

/** A fixed number of decimals, decimal comma, a no-break space between the thousands. */
export function formatFixed(value: number, decimals: number): string {
  const [whole, fraction] = Math.abs(value).toFixed(decimals).split(".");
  const grouped = whole.replace(/\B(?=(\d{3})+(?!\d))/g, NBSP);
  const text = fraction ? `${grouped},${fraction}` : grouped;
  return value < 0 && /[1-9]/.test(`${whole}${fraction ?? ""}`) ? `-${text}` : text;
}

/** What was saved on this device, when it is sound; otherwise the empty start. */
export function restoreThreePhase(raw: unknown): ThreePhaseState {
  const start = initialThreePhase();
  if (!raw || typeof raw !== "object") return start;
  const saved = raw as Partial<ThreePhaseState>;
  const text = (value: unknown) => (typeof value === "string" ? value.slice(0, 32) : "");
  const unit: PowerUnit = saved.unit === "W" ? "W" : "kW";
  const order = Array.isArray(saved.order) ? saved.order.filter((key): key is ThreePhaseQuantity => QUANTITIES.includes(key as ThreePhaseQuantity)).slice(-2) : [];
  const texts = { p: text(saved.texts?.p), u: text(saved.texts?.u), i: text(saved.texts?.i), pf: saved.texts && typeof saved.texts.pf === "string" ? text(saved.texts.pf) : "1" };
  // The order only lists quantities with a text, and the result never has one.
  const kept = order.filter((key) => texts[key].trim());
  const result = threePhaseResultOf(kept);
  if (result) texts[result] = "";
  return { texts, unit, order: kept };
}
