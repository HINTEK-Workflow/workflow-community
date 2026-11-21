/**
 * Ental och flertal i en text (SP5, 2026-11-01): "1 träff", "2 träffar". `format` skriver talet (tusentalsavstånd). Pure and shared
 * by the pages and the server's messages; the words are the caller's, so nothing here guesses Swedish endings.
 */
export function plural(count: number, one: string, many: string, format: (value: number) => string = String): string {
  return `${format(count)} ${count === 1 ? one : many}`;
}

/**
 * Ett namns genitiv (2026-11-10): "Workflows" för en förkortning, "Elfirmans" eller "Workflows" annars, och oförändrat efter
 * s, x och z ("Hans"). Used where the installation's own name stands in a sentence.
 */
export function genitive(name: string): string {
  const trimmed = name.trim();
  if (/[sxzSXZ]$/.test(trimmed)) return trimmed;
  if (/[A-ZÅÄÖ0-9]$/.test(trimmed) && trimmed === trimmed.toUpperCase()) return `${trimmed}:s`;
  return `${trimmed}s`;
}
