import { editDistance, foldText, typoAllowance } from "./normalize";

/**
 * Words that mean the same thing in this trade (2026-10-05: no AI, so a small maintained table instead). Each
 * group is equivalent both ways: "AO" finds work orders, and "jordfelsbrytare" also finds a row marked "JFB". Write the
 * words as people type them; they are folded (å→a, ö→o) when the table is read. Short abbreviations (three letters or
 * fewer) only match as whole words, so "ao" never matches inside "kaos".
 */
export const SEARCH_SYNONYM_GROUPS: readonly (readonly string[])[] = [
  ["ao", "arbetsorder", "arbetsordrar"],
  ["jfb", "rcd", "jordfelsbrytare", "jordfelsbrytarprov"],
  ["kfid", "kfi", "kontroll före idrifttagning", "idrifttagningskontroll"],
  ["rond", "driftrond", "skyddsrond", "rondering"],
  ["isol", "isolationsmätning", "isolationsresistans", "isolationsprov"],
  ["rb", "riskbedömning", "riskanalys"],
  ["ir", "termografering", "termografi", "värmekamera"],
  ["elc", "elcentral", "gruppcentral"],
  ["zs", "slingimpedans", "impedansmätning"],
  ["ik", "kortslutningsström"],
  ["pe", "skyddsledare", "skyddsjord"],
  ["ups", "avbrottsfri kraft", "reservkraft"],
  ["uh", "underhåll"],
  ["ek", "egenkontroll", "egenkontrollprogram"],
];

type Group = { words: string[] };
const groups: Group[] = SEARCH_SYNONYM_GROUPS.map((group) => ({ words: group.map(foldText) }));

/** A word of at most three letters is an abbreviation and only matches whole words. */
export const isAbbreviation = (word: string) => !word.includes(" ") && word.length <= 3;

/**
 * The other words a folded query word stands for. A word matches a group when it is one of its words, or when it is
 * at least four letters and the beginning of one of the longer words ("jordfel" → jordfelsbrytare, so also JFB).
 */
export function synonymsFor(word: string): string[] {
  const found = new Set<string>();
  for (const group of groups) {
    const hit = group.words.some((candidate) => candidate === word || (word.length >= 4 && candidate.length > word.length && !isAbbreviation(candidate) && candidate.startsWith(word)));
    if (hit) for (const candidate of group.words) if (candidate !== word) found.add(candidate);
  }
  return [...found].slice(0, 6);
}

/**
 * The table's words a misspelt query word was probably meant as ("jordflesbrytare" → jordfelsbrytare, and so JFB and
 * RCD), so a typing error also finds what is only written in long text or as an abbreviation.
 */
export function vocabularyCorrections(word: string): string[] {
  const allowance = typoAllowance(word.length);
  if (word.length < 5 || !allowance || /\d/.test(word) || synonymsFor(word).length) return [];
  const found = new Set<string>();
  for (const group of groups) {
    if (group.words.some((candidate) => !isAbbreviation(candidate) && !candidate.includes(" ") && editDistance(word, candidate, allowance) <= allowance)) group.words.forEach((candidate) => found.add(candidate));
  }
  return [...found].slice(0, 6);
}
