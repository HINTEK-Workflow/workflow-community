/**
 * Numbers as people type and read them in Swedish (Räkneverktyg, 2026-10-07): a decimal comma or point, spaces
 * between the thousands, and results with three significant digits. Pure functions, so a result reads the same in
 * Cloud, Local and the demo, and so the rounding rule can be tested.
 */
export type ParsedNumber = { state: "empty" } | { state: "ok"; value: number } | { state: "invalid" };

const THOUSANDS_WITH_COMMA = /^\d{1,3}(?:,\d{3})+$/;
const THOUSANDS_WITH_POINT = /^\d{1,3}(?:\.\d{3})+$/;

/** Reads "2,5", "2.5", "1 000,5", "1.000,5" and "−3" as numbers; empty text is empty, anything else invalid. */
export function parseDecimal(text: string): ParsedNumber {
  const trimmed = text.trim();
  if (!trimmed) return { state: "empty" };
  const compact = trimmed.replace(/[−–—]/g, "-").replace(/[\s  ]/g, "");
  const match = /^([+-]?)([\d.,]+)(?:[eE]([+-]?\d+))?$/.exec(compact);
  if (!match) return { state: "invalid" };
  const [, sign, body, exponent] = match;
  const commas = (body.match(/,/g) ?? []).length;
  const points = (body.match(/\./g) ?? []).length;
  let digits: string;
  if (commas && points) {
    // Both appear: the last one is the decimal mark, the other one separates thousands.
    const decimal = body.lastIndexOf(",") > body.lastIndexOf(".") ? "," : ".";
    const thousands = decimal === "," ? "." : ",";
    const [whole, fraction, ...rest] = body.split(decimal);
    if (rest.length || fraction === undefined) return { state: "invalid" };
    const group = decimal === "," ? THOUSANDS_WITH_POINT : THOUSANDS_WITH_COMMA;
    if (!group.test(whole)) return { state: "invalid" };
    digits = `${whole.split(thousands).join("")}.${fraction}`;
  } else if (commas > 1 || points > 1) {
    // The same mark several times can only be thousands: 1,000,000 or 1.000.000.
    if (!(commas ? THOUSANDS_WITH_COMMA : THOUSANDS_WITH_POINT).test(body)) return { state: "invalid" };
    digits = body.replace(/[.,]/g, "");
  } else {
    digits = body.replace(",", ".");
  }
  if (!/^(?:\d+\.?\d*|\.\d+)$/.test(digits)) return { state: "invalid" };
  const value = Number(`${sign}${digits}${exponent ? `e${exponent}` : ""}`);
  return Number.isFinite(value) ? { state: "ok", value } : { state: "invalid" };
}

const NBSP = " ";

/**
 * A number with at least `significant` significant digits but never fewer digits than the whole part has, a decimal
 * comma, no trailing zeros and a no-break space between the thousands: 6.9282 → "6,93", 400 → "400", 1234.5 → "1 235".
 */
export function formatNumber(value: number, significant = 3): string {
  if (!Number.isFinite(value)) return "–";
  if (value === 0) return "0";
  const magnitude = Math.abs(value);
  const exponent = Math.floor(Math.log10(magnitude));
  const decimals = Math.min(8, Math.max(0, significant - 1 - exponent));
  const fixed = magnitude.toFixed(decimals);
  const [whole, fraction = ""] = fixed.split(".");
  const grouped = whole.replace(/\B(?=(\d{3})+(?!\d))/g, NBSP);
  const trimmed = fraction.replace(/0+$/, "");
  const text = trimmed ? `${grouped},${trimmed}` : grouped;
  return value < 0 && /[1-9]/.test(fixed) ? `-${text}` : text;
}

/** Text for an input field: the number with a decimal comma and no grouping, for a starting value. */
export const inputText = (value: number) => String(value).replace(".", ",");
