import { WHOLESALER_LABELS, type WholesalerId } from "@/lib/wholesale/model";

/** What the verdict reads of a preview: a discount letter, a known layout, or neither. */
export type VerdictInput = {
  rowCount: number; missing: string[]; rebate?: string | null;
  format?: { variant?: { wholesaler: WholesalerId; label: string } };
  rebateFile?: { format: { wholesaler: WholesalerId; label: string }; counts: { groups: number; articles: number; netPrices: number } };
};

export type Verdict = { tone: "success" | "danger" | "warning"; text: string; known: boolean; other?: WholesalerId };

/**
 * Rätt fil eller fel fil (2026-10-14: "antingen är det rätt fil eller inte"): a known price list or discount
 * letter is the right file – unless it came into another wholesaler's box; an unknown file in a box is the wrong file;
 * an unknown file outside the boxes is read as the company's own list, with its columns to check.
 */
export function verdictOf(preview: VerdictInput | undefined, box: WholesalerId | null, count: (value: number) => string): Verdict {
  const letter = preview?.rebateFile;
  const known = letter ? { wholesaler: letter.format.wholesaler, label: letter.format.label, what: `${count(letter.counts.groups + letter.counts.articles + letter.counts.netPrices)} rabatter` }
    : preview?.format?.variant ? { wholesaler: preview.format.variant.wholesaler, label: preview.format.variant.label, what: `${count(preview.rowCount)} artiklar` } : null;
  if (known && box && known.wholesaler !== box) return { tone: "danger", text: `Fel fil – det här är ${known.label}, inte en fil från ${WHOLESALER_LABELS[box]}.`, known: true, other: known.wholesaler };
  if (known) return { tone: "success", text: `Rätt fil – ${known.label}, ${known.what}.`, known: true };
  if (box) return { tone: "danger", text: `Fel fil – det här är inte en prislista eller ett rabattbrev från ${WHOLESALER_LABELS[box]}.`, known: false };
  if (preview?.rebate) return { tone: "warning", text: "Okänt rabattbrev – formen känns inte igen. Be grossisten om filen i deras standardformat.", known: false };
  return { tone: "warning", text: preview?.missing.length ? "Okänd filform – välj kolumner under Detaljer." : `Egen prislista – ${count(preview?.rowCount ?? 0)} artiklar. Kontrollera kolumnerna under Detaljer.`, known: false };
}
