/**
 * Hjälp-sökningen in the app (D6, UX punkt 8; svar 5, 2026-10-24): every word typed must be found in a chapter –
 * its title, its line, its search words or, since 2026-10-24, its whole text as the page draws it. Chapters found by
 * their title or words come first; a chapter found in its text shows a short excerpt around the word. Pure, so it is
 * tested on its own; the page hands it the chapters' texts (features/workflow/native-help.tsx).
 */
export type HelpEntry = { key: string; title: string; subtitle?: string; words?: string };
export type HelpHit<T extends HelpEntry> = { entry: T; excerpt?: string };

const lower = (value: string) => value.toLocaleLowerCase("sv");
export const helpWords = (query: string) => lower(query).split(/\s+/).filter(Boolean);
/** Whitespace in a drawn text made single spaces. */
export const helpPlainText = (text: string) => text.replace(/\s+/g, " ").trim();

/** About `radius` characters on each side of the first word found, cut at spaces, with … where the text goes on. */
export function helpExcerpt(text: string, words: readonly string[], radius = 45): string | undefined {
  const plain = helpPlainText(text);
  const haystack = lower(plain);
  const at = words.map((word) => haystack.indexOf(word)).filter((index) => index >= 0).sort((a, b) => a - b)[0];
  if (at === undefined) return undefined;
  let start = Math.max(0, at - radius);
  let end = Math.min(plain.length, at + radius * 2);
  if (start > 0) { const space = plain.indexOf(" ", start); start = space >= 0 && space < at ? space + 1 : start; }
  if (end < plain.length) { const space = plain.lastIndexOf(" ", end); end = space > at ? space : end; }
  return `${start > 0 ? "…" : ""}${plain.slice(start, end).trim()}${end < plain.length ? "…" : ""}`;
}

export function searchHelpEntries<T extends HelpEntry>(entries: readonly T[], query: string, texts?: ReadonlyMap<string, string>): HelpHit<T>[] {
  const words = helpWords(query);
  if (!words.length) return [];
  const byLine: HelpHit<T>[] = [];
  const byText: HelpHit<T>[] = [];
  for (const entry of entries) {
    const line = lower(`${entry.title} ${entry.subtitle ?? ""} ${entry.words ?? ""}`);
    const body = texts?.get(entry.key) ?? "";
    const all = `${line} ${lower(body)}`;
    if (!words.every((word) => all.includes(word))) continue;
    if (words.every((word) => line.includes(word))) byLine.push({ entry });
    else byText.push({ entry, excerpt: helpExcerpt(body, words.filter((word) => !line.includes(word))) });
  }
  return [...byLine, ...byText];
}
