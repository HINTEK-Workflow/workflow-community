import { normalizeHeader } from "@/lib/import/detect";
import type { WholesalerId } from "@/lib/wholesale/model";

/**
 * Kända prislistor (2026-10-14: "antingen är det rätt fil eller inte"): the four wholesalers' price lists with
 * headings are recognised by their headings alone and read the right way at once – columns, base price and E-nummer –
 * as data, not as importers of their own. Only the field names are used (the headings the files themselves carry).
 * The fixed-width text list without headings is in KNOWN_FIXED_VARIANTS (lib/catalogue/price-kind.ts).
 *
 * The E-nummer: "always" when the wholesaler's article number is the E-nummer for electrical articles (seven digits,
 * optionally E in front; a row with an RSK-nummer never gets one); "share" when the same layout is used for both an
 * electrical list and other lists, so the file decides (most article numbers seven digits); an area rule when a
 * column says which rows are electrical (Solar's Produktområde E or B).
 */
export type ENumberRule = "always" | "share" | { column: string; values: string[] };
export type KnownPriceList = {
  id: string;
  wholesaler: WholesalerId;
  label: string;
  /** Field → the heading as the file writes it. Every heading must be in the file. */
  fields: Record<string, string>;
  /** Headings that only this layout has, so two wholesalers' lists are never confused. */
  marks: string[];
  /** Fields read when the file has the heading, never needed to recognise it (2026-10-15: förpackning, multipel, status). */
  optional?: Record<string, string>;
  eNumber: ENumberRule;
};

export const KNOWN_PRICE_LISTS: KnownPriceList[] = [
  {
    id: "solar-prislista", wholesaler: "solar", label: "Solar prislista",
    fields: { articleNo: "Artikelnr", rskNumber: "RSK", name: "Benämning", discountGroup: "Produktgrupp", unit: "Enhet", price: "Listpris", priceDate: "Datum" },
    marks: ["Produktområde", "Ansvarskod"],
    // Min best kvant: the smallest quantity that can be ordered (Solar's file description). Ansvarskod is a delivery term, not a status.
    optional: { minOrderQuantity: "MinBestKvant" },
    eNumber: { column: "Produktområde", values: ["E", "B"] },
  },
  {
    id: "ahlsell-excel", wholesaler: "ahlsell", label: "Ahlsell prislista",
    fields: { articleNo: "Artikelnr", price: "GNP", discountGroup: "Materialklass", unit: "Enhet", name: "Benämning" },
    marks: ["Multipel", "Lagerförd"],
    optional: { orderMultiple: "Multipel", stocked: "Lagerförd" },
    eNumber: "share",
  },
  {
    id: "sonepar-gnp", wholesaler: "sonepar", label: "Sonepar prislista (GNP)",
    fields: { articleNo: "Artnr", name: "Artben", unit: "Sortkod", priceDate: "Gdatum", discountGroup: "Mg", price: "Gnp" },
    marks: ["Antsort", "Stdfp"],
    // Antsort = pieces in a package (FP), Stdfp = the standard pack in the price unit, Påbeg = price on request (J/N).
    optional: { packageSize: "Antsort", orderMultiple: "Stdfp", priceOnRequest: "Påbeg" },
    eNumber: "always",
  },
  {
    id: "rexel-gn", wholesaler: "rexel", label: "Rexel prislista (GN)",
    fields: { articleNo: "Artikelnummer", name: "Benämning", unit: "Enhet", discountGroup: "Materialgrupp", price: "GN-pris", priceDate: "Prisdatum" },
    marks: ["Status"],
    // Status O normal, UL utgår (stock lasts), PPB price on request (Rexel's description).
    optional: { status: "Status", stocked: "Lagerförd" },
    eNumber: "always",
  },
];

/** The known layout these headings are, or null. Every field's heading and every mark must be there. */
export function recognizePriceList(headers: readonly string[]): KnownPriceList | null {
  const set = new Set(headers.map(normalizeHeader));
  return KNOWN_PRICE_LISTS.find((known) => [...Object.values(known.fields), ...known.marks].every((heading) => set.has(normalizeHeader(heading)))) ?? null;
}

/** The share of seven-digit article numbers (optionally E in front) above which "share" means the E-nummer. */
export const E_NUMBER_SHARE = 0.8;
