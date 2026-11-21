import type { FieldSpec } from "@/lib/import/detect";

/**
 * Artiklar och priser (2026-10-08, steg 1): the fields a price file is mapped to on the Import page, with the
 * column names people commonly use. Generic on purpose – no supplier's file layouts are built in; what differs between
 * suppliers is solved by the mapping the company saves for its own supplier.
 *
 * Prisfil 2026-10-08: a list price (Listpris, Bruttopris) is read as the price when there is no net price; the discount
 * group (Rabattgrupp, Rabattkod, Produktgrupp) is kept on the article for steg 2 (discount file → net price).
 *
 * Prisfiler, etapp 1 (2026-10-12): the trade's own abbreviations may stand as aliases – GNP and GN-pris
 * (grossistnettopris: the wholesaler's base or list price before the customer's discount), Artnr, Artben
 * (artikelbenämning), Sortkod and Enhetskod (the unit), Gdatum (giltighetsdatum), Mg / Materialgrupp / Materialklass
 * (the group the discount applies to). What the headings do not settle, the column suggestion reads from the content
 * (lib/catalogue/columns.ts). An RSK number (VVS) has a field of its own – never an E-nummer – and, like the E-nummer,
 * is a common number that joins the same product across the company's suppliers (lib/catalogue/products.ts).
 */
export const CATALOGUE_FIELDS: FieldSpec[] = [
  { key: "articleNo", label: "Artikelnummer", aliases: ["artikelnummer", "artikelnr", "artikel nr", "art.nr", "art nr", "artnr", "art.nr.", "lev artnr", "lev. artnr", "leverantörens artikelnummer", "artikel", "article number", "article no", "item number", "item no", "sku"] },
  { key: "eNumber", label: "E-nummer", aliases: ["e-nummer", "enummer", "e nummer", "e-nr", "enr", "e nr"] },
  // Tillverkarens artikelnummer (2026-10-09): optional, shown on the material row beside the supplier's number.
  { key: "manufacturerArticleNo", label: "Tillverkarens artikelnummer", aliases: ["tillverkarens artikelnummer", "tillverkarens artnr", "tillverkarens art.nr", "tillv artnr", "tillv. artnr", "tillv art.nr", "tillverkare artikelnummer", "tillverkarnummer", "manufacturer part number", "manufacturer article number", "mfr part number", "mpn"] },
  { key: "name", label: "Benämning", required: true, aliases: ["benämning", "benamning", "artikelnamn", "artikelbenämning", "artben", "benämn", "produktnamn", "produkt", "beskrivning", "namn", "text", "description", "name", "product"] },
  { key: "unit", label: "Enhet", aliases: ["enhet", "enh", "enh.", "enhetskod", "sortkod", "säljenhet", "måttenhet", "unit", "uom"] },
  // A net price first: when a file has both, the net price is what the company pays.
  { key: "price", label: "Pris (kr exkl. moms)", required: true, aliases: ["nettopris", "netto", "ditt pris", "ert pris", "inköpspris", "inkopspris", "pris", "pris exkl moms", "pris sek", "à-pris", "á-pris", "a-pris", "apris", "styckpris", "listpris", "bruttopris", "brutto", "grundpris", "baspris", "gnp", "gn-pris", "gn pris", "gnpris", "grossistnettopris", "grossistpris", "price", "net price", "unit price", "list price", "gross price"] },
  { key: "perQuantity", label: "Pris per antal (t.ex. 100)", aliases: ["prisenhet", "pris per", "per", "per antal", "prisantal", "antal per pris", "price unit", "price per"] },
  { key: "priceDate", label: "Prisdatum", kind: "date", aliases: ["prisdatum", "giltig från", "gäller från", "giltig fr o m", "gdatum", "giltighetsdatum", "datum", "valid from", "price date", "date"] },
  { key: "discountGroup", label: "Rabattgrupp", aliases: ["rabattgrupp", "rabattkod", "rabatt grupp", "rabattgr", "produktgrupp", "materialgrupp", "materialklass", "mg", "varugrupp", "artikelgrupp", "discount group", "discount code"] },
  { key: "rskNumber", label: "RSK-nummer", aliases: ["rsk", "rsk-nr", "rsk nr", "rsknr", "rsk-nummer", "rsk nummer", "rsknummer"] },
  // Samma produkt hos flera leverantörer (2026-10-14): the GTIN/EAN and the manufacturer join a product when there is no E-nummer.
  { key: "gtin", label: "GTIN/EAN", aliases: ["gtin", "ean", "ean-kod", "ean kod", "eankod", "ean13", "ean-nummer", "streckkod", "gtin/ean", "ean/gtin", "barcode"] },
  { key: "manufacturer", label: "Tillverkare", aliases: ["tillverkare", "tillverkarnamn", "fabrikat", "märke", "varumärke", "leverantör tillverkare", "manufacturer", "brand"] },
  // Förpackning, multipel och status (2026-10-15): shown on the hit, never used to recompute a price.
  { key: "packageSize", label: "Antal per förpackning", aliases: ["antal per förpackning", "antal i förpackning", "förpackningsstorlek", "förpackning", "förp", "förp.", "antsort", "pack size", "package size"] },
  { key: "orderMultiple", label: "Beställningsmultipel", aliases: ["beställningsmultipel", "best multipel", "best. multipel", "multipel", "standardförpackning", "stdfp", "order multiple"] },
  { key: "minOrderQuantity", label: "Minsta beställningsantal", aliases: ["minbestkvant", "min best kvant", "minsta beställningsantal", "minsta beställning", "minsta beställningsbara kvantitet", "min order", "minimum order quantity", "moq"] },
  { key: "stocked", label: "Lagerförd (J/N)", aliases: ["lagerförd", "lagerförd (l)", "lagervara", "lagerartikel", "stocked"] },
  { key: "status", label: "Artikelstatus", aliases: ["artikelstatus", "status", "utgående"] },
  { key: "priceOnRequest", label: "Pris på begäran (J/N)", aliases: ["påbeg", "pris på begäran", "prisbegäran", "price on request"] },
];

export const CATALOGUE_FIELD_KEYS = CATALOGUE_FIELDS.map((field) => field.key);
/** The optional extras (2026-10-15): read when a file has them, never counted when a file is judged to be a price list. */
export const CATALOGUE_EXTRA_KEYS = new Set(["packageSize", "orderMultiple", "minOrderQuantity", "stocked", "status", "priceOnRequest"]);

/** How the price column is written: kronor, or whole hundredths/thousandths (a fixed-width file's "skala 100"). */
export const PRICE_SCALES = [1, 100, 1000] as const;
export type PriceScale = (typeof PRICE_SCALES)[number];
