import { formatNumber } from "./number";
import type { CalcModule, Note, Origin, Outcome, OutputQuantity, OutputRow } from "./types";
import { fromBase, scaleUnit } from "./units";

/**
 * How a result is written (Räkneverktyg, 2026-10-07): a quantity with three significant digits in a readable
 * unit, a note as a sentence, and the whole result as plain text for the clipboard – inputs, results, the way it was
 * calculated and the reminder that it is a basis for a calculation, not a decision.
 */
export function quantityParts(row: OutputQuantity): { value: string; unit: string } {
  const unit = row.unit ?? scaleUnit(row.value, row.dimension);
  return { value: formatNumber(fromBase(row.value, row.dimension, unit)), unit };
}
export function quantityText(row: OutputQuantity): string {
  const { value, unit } = quantityParts(row);
  return unit ? `${value} ${unit}` : value;
}
export const rowText = (row: OutputRow) => (row.kind === "verdict" ? row.text : quantityText(row));

/** A note as one sentence; one that points to Värden och referenser ends with that page's name. */
export function noteText(note: Note): string {
  const body = note.link ? `${note.text} ${note.link.label}.` : note.text;
  return note.detail ? `${body} ${note.detail}` : body;
}

const ORIGIN_NOTE: Record<Origin, string> = { user: "", company: "företagets värde", suggestion: "förslag", default: "" };
export const REMINDER = "Beräkningsunderlag. Dimensionering och säkerhetsbeslut fattas av en behörig person.";

export function resultText(tool: CalcModule, outcome: Extract<Outcome, { status: "ok" }>): string {
  const lines: string[] = [`Räkneverktyg: ${tool.name}`, "", "Indata"];
  for (const input of outcome.inputs) {
    const note = input.origin === "user" ? "" : input.note ?? ORIGIN_NOTE[input.origin];
    lines.push(`- ${input.label}: ${input.text}${note ? ` (${note})` : ""}`);
  }
  lines.push("", "Resultat");
  for (const row of outcome.rows) lines.push(row.kind === "verdict" ? `- ${row.text}` : `- ${row.label}: ${quantityText(row)}${row.note ? ` (${row.note})` : ""}`);
  if (outcome.steps.length) {
    lines.push("", "Så räknades det");
    outcome.steps.forEach((step, index) => lines.push(`${index + 1}. ${step}`));
  }
  if (outcome.notes.length) {
    lines.push("", "Anmärkningar");
    for (const note of outcome.notes) lines.push(`- ${noteText(note)}`);
  }
  lines.push("", REMINDER);
  return lines.join("\n");
}
