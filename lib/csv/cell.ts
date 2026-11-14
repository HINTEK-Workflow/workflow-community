/**
 * A CSV cell for Excel: always quoted; a leading = + - @ (or tab, carriage return) is neutralised with an apostrophe
 * unless it is a plain number, so a cell is never run as a formula (CSV injection). Shared by every CSV export
 * (quotes, the newsletter list, the behaviour analysis; R2 in the review 2026-10-20).
 */
export function csvCell(value: string | number) {
  const text = String(value);
  const safe = /^[=+\-@\t\r]/.test(text) && !/^-\d+(,\d+)?$/.test(text) ? `'${text}` : text;
  return `"${safe.replace(/"/g, '""')}"`;
}
