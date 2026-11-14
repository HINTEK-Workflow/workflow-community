import { WHOLESALER_LABELS, type WholesalerId } from "@/lib/wholesale/model";

/**
 * Why a wholesaler has no working article catalogue right now (lib/catalogue/catalogue-gate.ts), as a code the page can word: `no_api` – none in
 * Workflow (Ahlsell, Rexel, Sonepar until their APIs are connected); `inactive` – it exists but its connection is switched off (the search still shows what was fetched before, kundresa 2026-11-07 M38); `not_fetched` – the
 * connection is on but the whole catalogue has not been read yet. A price file works in all three: its rows are stored as the company's own.
 */
export type ImportGateReason = "no_api" | "inactive" | "not_fetched";

/** The refusal when a file does not fit the company's limit on rows from price files: what is wrong and what the person can do. */
export const companyRowLimitMessage = (limit: number) =>
  `Filen får inte plats. Företaget får ha högst ${limit.toLocaleString("sv-SE")} artikelrader från prisfiler. Ta bort en äldre import eller läs in en mindre fil.`;

/** The company's rows after a file: a wholesaler's file takes the place of its supplier's rows of the kind; an own supplier's file only adds its new articles. */
export function companyRowsAfter(input: { stored: number; replaced: number; fileRows: number; newArticles?: number; own: boolean }): number {
  return input.own ? input.stored + (input.newArticles ?? input.fileRows) : Math.max(0, input.stored - input.replaced) + input.fileRows;
}

/**
 * The short line in a wholesaler's box on Import (användartest 2026-10-31, S3: every closed box said "API-koppling saknas",
 * also Solar's, whose shared register was there). Says what is true: prices never come through an API – only from the company's
 * own files, and a file can always be read in.
 */
export function wholesalerBoxText(wholesaler: WholesalerId, reason: ImportGateReason | null | undefined): string {
  const label = WHOLESALER_LABELS[wholesaler];
  if (!reason) return `${label}s artikelkatalog finns – ladda upp prislista eller rabattbrev`;
  if (reason === "inactive") return `${label}s artikelkatalog uppdateras inte just nu – prisfilen läses in som era egna rader`;
  if (reason === "not_fetched") return `${label}s artikelkatalog är inte hämtad än – prisfilen läses in som era egna rader`;
  return `Ingen artikelkatalog från ${label} än – prisfilen läses in som era egna rader`;
}
