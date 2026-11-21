/**
 * A dash written straight against what follows it ("plan –1", "–20 °C") is a minus sign or a prefix, not a pause: the
 * browser may break a line after an en dash, which left "plan –" on one line and "1" alone on the next (QA 2026-10-10).
 * Such a dash is kept with the word after it (a word joiner, U+2060, invisible and never copied as a space) and with the
 * word before it (a no-break space instead of the space), so "plan –1" moves to the next line as a whole. A dash with a
 * space after it ("Kund – plats") and a dash inside a word or a span ("08:00–09:30") break as before.
 */
const WORD_JOINER = "⁠";
const NO_BREAK_SPACE = " ";

export function glueDashes(text: string): string {
  return text.replace(/(^|[ \t])([–—−-])(?=[^\s⁠])/gu, (_match, space: string, dash: string) => `${space ? NO_BREAK_SPACE : ""}${dash}${WORD_JOINER}`);
}
