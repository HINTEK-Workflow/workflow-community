import { LANGUAGE_LEVELS, type CompetenceCardView, type CredentialView } from "./model";

/**
 * Kompetenskort v2 (2026-10-08): the competence cards as a CSV file, one row per training. The first six columns
 * are the ones the Import page's target "Kompetens" reads (lib/import/detect.ts), so an exported file can be imported
 * again; the last four describe the rest of the card and are only read by people. Made in the browser from what the
 * reader may see (admins), so Cloud, Local and the demo export alike. Semicolons and a BOM, as the Import page's templates.
 */
export const COMPETENCE_EXPORT_COLUMNS = ["Person", "Utbildning", "Utbildare", "Genomförd", "Giltig till", "Anteckning", "Kompetensgrupper", "Körkort", "Körkort giltigt till", "Språk"] as const;

export function competenceRows(credentials: readonly CredentialView[], cards: readonly CompetenceCardView[]): string[][] {
  const cardOf = new Map(cards.map((card) => [card.personId, card]));
  const names = new Map<string, string>([...credentials.map((item) => [item.personId, item.name] as const), ...cards.map((card) => [card.personId, card.name] as const)]);
  const people = [...names].sort((a, b) => a[1].localeCompare(b[1], "sv"));
  const rows: string[][] = [];
  for (const [personId, name] of people) {
    const card = cardOf.get(personId);
    const rest = card ? [card.groupNames.join(", "), card.licenceClasses.join(", "), card.licenceValidUntil ?? "", card.languages.map((item) => `${item.language} (${LANGUAGE_LEVELS[item.level].toLocaleLowerCase("sv")})`).join(", ")] : ["", "", "", ""];
    const lines = credentials.filter((item) => item.personId === personId).sort((a, b) => a.title.localeCompare(b.title, "sv"));
    if (!lines.length) rows.push([name, "", "", "", "", "", ...rest]);
    for (const line of lines) rows.push([name, line.title, line.provider ?? "", line.issuedAt ?? "", line.validUntil ?? "", line.note, ...rest]);
  }
  return rows;
}

/** The rows as a CSV text with a header; a cell that could be read as a formula is written as text. */
export function competenceCsv(credentials: readonly CredentialView[], cards: readonly CompetenceCardView[]) {
  const quote = (value: string) => `"${(/^[=+\-@\t\r]/.test(value) ? `'${value}` : value).replace(/"/g, "\"\"")}"`;
  const lines = [[...COMPETENCE_EXPORT_COLUMNS], ...competenceRows(credentials, cards)].map((row) => row.map(quote).join(";"));
  return `﻿${lines.join("\r\n")}\r\n`;
}
