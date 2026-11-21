/**
 * Text normalisation for Sök (2026-10-05: "en förbättrad sökfunktion … utan AI"). Shared by the browser (Local,
 * demo, highlighting), the server and the SQL function search_fold() from migration 20261005160000_search_indexes, so
 * every side folds text the same way: lower case, and Swedish and other Latin diacritics to their base letter.
 *
 * Folding is one code unit to one code unit, so a position in the folded text is the same position in the original;
 * highlighting relies on that.
 */
const FOLD_PAIRS: readonly (readonly [string, string])[] = [
  ["å", "a"], ["ä", "a"], ["à", "a"], ["á", "a"], ["â", "a"], ["ã", "a"], ["æ", "a"],
  ["ö", "o"], ["ø", "o"], ["ó", "o"], ["ò", "o"], ["ô", "o"], ["õ", "o"],
  ["é", "e"], ["è", "e"], ["ê", "e"], ["ë", "e"],
  ["í", "i"], ["ì", "i"], ["î", "i"], ["ï", "i"],
  ["ú", "u"], ["ù", "u"], ["û", "u"], ["ü", "u"],
  ["ý", "y"], ["ÿ", "y"], ["ç", "c"], ["ñ", "n"],
];

/** Upper and lower case of every folded letter; SQL lower() may leave non-ASCII capitals alone under a C locale. */
const foldEntries = FOLD_PAIRS.flatMap(([from, to]) => {
  const upper = from.toUpperCase();
  return upper.length === 1 && upper !== from ? [[from, to], [upper, to]] : [[from, to]];
});
/** translate() arguments of search_fold(); tests/search.test.ts checks that the migration uses exactly these. */
export const SEARCH_FOLD_FROM = foldEntries.map(([from]) => from).join("");
export const SEARCH_FOLD_TO = foldEntries.map(([, to]) => to).join("");
const FOLD_MAP = new Map(foldEntries.map(([from, to]) => [from, to]));

export function foldText(value: string | null | undefined): string {
  if (!value) return "";
  let result = "";
  for (let index = 0; index < value.length; index += 1) {
    const char = value[index];
    const lower = char.toLowerCase();
    const single = lower.length === 1 ? lower : char;
    result += FOLD_MAP.get(single) ?? single;
  }
  return result;
}

/** Letters and digits only: "E-12" and "e12", "070-123 45 67" and "0701234567" become the same. */
export const compactText = (folded: string) => folded.replace(/[^\p{L}\p{N}]+/gu, "");

/** The words of a folded text with their start positions. */
export function wordsOf(folded: string): { word: string; start: number }[] {
  const words: { word: string; start: number }[] = [];
  for (const match of folded.matchAll(/[\p{L}\p{N}]+/gu)) words.push({ word: match[0], start: match.index ?? 0 });
  return words;
}

const isWordChar = (char: string | undefined) => Boolean(char && /[\p{L}\p{N}]/u.test(char));
export const startsWord = (text: string, index: number) => index === 0 || !isWordChar(text[index - 1]);
export const endsWord = (text: string, end: number) => end >= text.length || !isWordChar(text[end]);

/** Common Swedish words that say nothing on their own; dropped when the query has other words. */
export const SEARCH_STOPWORDS = new Set(["och", "i", "pa", "av", "for", "med", "till", "den", "det", "en", "ett", "som", "vid", "fran"]);

/** Splits a folded query into words; separators inside a word (E-12, 1.5, 4/2) are kept. */
export function tokenize(folded: string): string[] {
  return folded
    .split(/[\s,;!?()"'[\]{}<>|]+/u)
    .map((token) => token.replace(/^[.\-_#*:/\\]+|[.\-_#*:/\\]+$/gu, ""))
    .filter(Boolean);
}

/**
 * Optimal string alignment distance (Damerau–Levenshtein with adjacent swaps), stopping early once it exceeds `max`.
 * O(a·b) for two short words; returns max + 1 when the distance is larger.
 */
export function editDistance(a: string, b: string, max: number): number {
  if (Math.abs(a.length - b.length) > max) return max + 1;
  if (a === b) return 0;
  const rows = a.length + 1, cols = b.length + 1;
  let previousPrevious = new Array<number>(cols).fill(0);
  let previous = Array.from({ length: cols }, (_, index) => index);
  for (let i = 1; i < rows; i += 1) {
    const current = new Array<number>(cols).fill(0);
    current[0] = i;
    let rowMin = current[0];
    for (let j = 1; j < cols; j += 1) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      let value = Math.min(previous[j] + 1, current[j - 1] + 1, previous[j - 1] + cost);
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) value = Math.min(value, previousPrevious[j - 2] + 1);
      current[j] = value;
      if (value < rowMin) rowMin = value;
    }
    if (rowMin > max) return max + 1;
    previousPrevious = previous;
    previous = current;
  }
  return Math.min(previous[cols - 1], max + 1);
}

/** How many typing errors a word of this length may have and still count: none below 4 letters, 1 up to 7, then 2. */
export const typoAllowance = (length: number) => (length < 4 ? 0 : length < 8 ? 1 : 2);
