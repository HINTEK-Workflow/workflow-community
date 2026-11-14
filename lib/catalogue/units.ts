/**
 * Enheter från grossisternas API:er (2026-10-16: "rätt fakta i rätt ruta"): Solar sends the international unit
 * codes (UN/ECE Recommendation 20, e.g. PCE, MTR), the trade's own short forms are Swedish. One translation for every
 * supplier; an unknown code is shown as written, in small letters.
 */
const UNIT_CODES: Record<string, string> = {
  PCE: "st", PCS: "st", EA: "st", C62: "st", H87: "st", ST: "st", STK: "st", PC: "st",
  MTR: "m", M: "m", MTK: "m²", M2: "m²", MTQ: "m³", M3: "m³", KMT: "km", CMT: "cm", MMT: "mm",
  KGM: "kg", KG: "kg", GRM: "g", TNE: "t",
  LTR: "l", L: "l", MLT: "ml",
  PK: "förp", PA: "förp", PAK: "förp", PKT: "förp", BX: "förp", CT: "förp", CTN: "förp", BG: "förp",
  RO: "rulle", RL: "rulle", ROL: "rulle", SET: "sats", SE: "sats", PR: "par", PAR: "par",
  HUR: "h", MIN: "min", DAY: "dag",
};

/** "PCE" → "st", "MTR" → "m"; anything else as written in small letters ("" stays ""). */
export function tradeUnit(code: string | null | undefined): string {
  const value = (code ?? "").trim();
  if (!value) return "";
  return UNIT_CODES[value.toUpperCase()] ?? value.toLowerCase();
}
