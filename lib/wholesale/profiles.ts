import type { WholesalerId } from "./model";

/**
 * One small profile per wholesaler (2026-10-12). A profile only says HOW the two columns are written; which
 * article number a row may use and how quantities are checked is the preparation (prepare.ts), the same for all.
 * `verified` and `unverified` are what the profile rests on, repeated in docs/wholesale-export.md.
 */
export type IdentifierRule = "eNumber" | "supplier" | "manufacturer";

export type WholesaleProfile = {
  id: WholesalerId;
  label: string;
  /** What the article column holds, in words ("E-nummer eller RSK-nummer"). */
  identifierLabel: string;
  /** Which of the row's numbers count as this wholesaler's own identifier, in order of preference. */
  identifiers: readonly IdentifierRule[];
  /** Column order in the text and the Excel sheet. */
  columns: readonly ("article" | "quantity")[];
  /** Field separator of the copied text and of the CSV. */
  separator: " " | "\t" | ";";
  /** Line ending of the copied text and of the CSV. */
  lineBreak: "\n" | "\r\n";
  /** First line of the copied text and of the CSV; null = no header line. */
  header: string | null;
  /** First row of the Excel sheet; null = the data starts in A1. */
  xlsxHeader: readonly [string, string] | null;
  /** A CSV file is offered next to Excel (in the same export button's menu). */
  csv: boolean;
  /** Recommended largest number of lines in one order; the export is split in numbered parts. */
  recommendedMaxLines: number | null;
  /** Identifiers with anything but ASCII are not accepted: the encoding is not verified. */
  asciiOnly: boolean;
  /** A short help line shown with Kopiera. */
  copyHint: string | null;
  /** A short line saying where to paste or import. */
  pasteHint: string;
  /** Shown in the documentation. */
  verified: readonly string[];
  unverified: readonly string[];
};

export const WHOLESALE_PROFILES: Record<WholesalerId, WholesaleProfile> = {
  solar: {
    id: "solar", label: "Solar", identifierLabel: "E-nummer eller RSK-nummer", identifiers: ["eNumber"],
    columns: ["article", "quantity"], separator: " ", lineBreak: "\n", header: null, xlsxHeader: null, csv: false, recommendedMaxLines: null, asciiOnly: false,
    copyHint: null, pasteHint: "Klistra in under Lägg till flera rader hos Solar.",
    verified: ["Lägg till flera rader tar E-nummer eller RSK-nummer och antal, med mellanslag eller komma, eller två kolumner kopierade från Excel (skärmbild)."],
    unverified: ["Att varje Solar-artikelnummer fungerar som E-nummer/RSK (därför används bara E-nummer på raden eller ett nummer du anger själv).", "Decimalantal.", "Provimport i varukorgen."],
  },
  ahlsell: {
    id: "ahlsell", label: "Ahlsell", identifierLabel: "fullständigt artikelnummer", identifiers: ["supplier"],
    columns: ["article", "quantity"], separator: "\t", lineBreak: "\n", header: null, xlsxHeader: null, csv: false, recommendedMaxLines: 400, asciiOnly: false,
    copyHint: null, pasteHint: "Klistra in under Beställ via urklipp från Excel hos Ahlsell.",
    verified: ["Beställ via urklipp från Excel: fullständigt artikelnummer i första kolumnen, antal i andra (skärmbild).", "Rekommendation: högst 400 rader i en order (en rekommendation, inte en verifierad hård gräns)."],
    unverified: ["Decimalantal.", "Hur Ahlsell tolkar artikelnummer med inledande nollor vid inklistring.", "Provimport i varukorgen."],
  },
  sonepar: {
    id: "sonepar", label: "Sonepar", identifierLabel: "artikelnummer", identifiers: ["supplier"],
    columns: ["quantity", "article"], separator: " ", lineBreak: "\n", header: null, xlsxHeader: null, csv: false, recommendedMaxLines: null, asciiOnly: false,
    copyHint: null, pasteHint: "Klistra in under Snabborder hos Sonepar.",
    verified: ["Snabborder tar komma, semikolon, tabulator, mellanslag och pipe som separator; exemplen har antal först och artikelnummer sedan (skärmbild)."],
    unverified: ["Att ett E-nummer från en annan källa motsvarar Sonepars artikelnummer (E-prefixet behålls och läggs aldrig till eller tas bort).", "Decimalantal.", "Provimport i varukorgen."],
  },
  rexel: {
    id: "rexel", label: "Rexel", identifierLabel: "artikelnummer eller tillverkarens artikelnummer", identifiers: ["supplier", "manufacturer"],
    columns: ["article", "quantity"], separator: ";", lineBreak: "\r\n", header: "Artikelnummer / Tillv.art.nr;Kvantitet", xlsxHeader: ["Artikelnummer / Tillv.art.nr", "Kvantitet"], csv: true, recommendedMaxLines: null, asciiOnly: true,
    copyHint: "Rexels verifierade väg är filimport av CSV. Att klistra in texten i Rexels webbshop är inte prövat.",
    pasteHint: "Importera CSV-filen hos Rexel (Snabborder).",
    verified: ["Rexels mall 8797250125854.csv: rubrikraden \"Artikelnummer / Tillv.art.nr;Kvantitet\", semikolon, radslut CRLF, en tom exempelrad (exporteras inte)."],
    unverified: ["Teckenkodning för artikelnummer med annat än ASCII (därför stoppas sådana rader).", "Decimalantal.", "Att XLSX kan importeras direkt (Excel är bara en läsbar export).", "Att inklistring i webbshopen fungerar.", "Provimport."],
  },
};

export const profileOf = (id: WholesalerId) => WHOLESALE_PROFILES[id];
