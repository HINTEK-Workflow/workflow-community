import { z } from "zod";
import { QUOTE_LINE_KIND_LABELS, QUOTE_STATUS_LABELS, quoteLineNumbers, type QuoteLineKind, type QuoteRot, type QuoteStatus } from "./model";
import { csvCell } from "@/lib/csv/cell";

/**
 * Export av offert/fakturaunderlag (2026-10-09, steg D, docs/proposals/material-pris-offert-2026-10-09.md).
 * Pure builders shared by the route and the tests; the company's own quotes are core, so nothing here comes from ee/.
 * - CSV: one row per quote line, semicolon, decimal comma, CRLF, UTF-8 with BOM, formulas neutralised for Excel.
 * - SIE 4 (import file, .si): one verification per invoiced fakturaunderlag with the company's own account numbers from
 *   Inställningar → Kopplingar → Bokföring (ACCOUNTS_PLACE; under Arbetssätt → Avancerat until 2026-11-03). Workflow writes no account plan and no account names (#KONTO is
 *   left out, so an import never renames the company's accounts); every account must be set by the company.
 * All sums are counted in whole öre, so a verification always balances.
 * ROT (steg C, 2026-10-09): a private person's quote with ROT splits the receivable into the customer's share
 * (Kundfordran) and the ROT claim (Fordran ROT-avdrag, the company's own account; empty by default and asked for only
 * when a quote with ROT is exported). The deduction is counted like the quote page: share × marked labour incl. VAT,
 * at most the cap, whole öre.
 * Fakturaunderlag från utfört arbete (2026-10-10, lib/invoice-basis): the same builders take a basis of time,
 * material and expenses (`document: "invoice_basis"`). It is named Fakturaunderlag in the files. Since 2026-11-01 a basis may
 * carry ROT like a quote (the claim on its own account). Omvänd byggmoms (2026-11-01): the document has no VAT of its own,
 * the buyer accounts for it, and its sale goes to the company's own account for such sales; the CSV says so in its columns.
 * Bara godkänt underlag bokförs (2026-11-01, användartest 2026-10-31 F1): a quote is never booked (an accepted
 * quote is no sale, and with the basis the same job was booked twice), and a fakturaunderlag only when it is marked as
 * invoiced, never as a draft. `sieRefusal` says so; the routes and quotesSie use it. A quote's CSV is unchanged.
 */

// ---------- the company's account mapping ----------

/**
 * Where the accounts are set, and where the Fortnox key is kept – named the same in every text (användartest 2026-10-31: the
 * texts said Priser och offert → Bokföring and Kopplingar och nycklar, neither of which exists any more).
 */
/**
 * Fortnox-kopplingen (2026-11-01, beslut 16): the one condition that shows Fortnox in the interface. Off until a real
 * connection with its own sign-in exists. The server, the routes and the code stay; a key saved earlier stays too. The customer's
 * Kundnummer i bokföringen, the CSV and the SIE file work without it.
 */
export const FORTNOX_CONNECTION_READY = false as boolean;
export const ACCOUNTS_PLACE = "Inställningar → Kopplingar → Bokföring";
export const FORTNOX_KEY_PLACE = "Inställningar → Kopplingar → Bokföring";

const account = z.string().trim().max(6).refine((value) => !value || /^\d{4,6}$/.test(value), "Ett kontonummer är 4–6 siffror.").default("");
export const accountingSettingsSchema = z.object({
  /** Försäljning per line kind (credit). */
  materialAccount: account,
  labourAccount: account,
  otherAccount: account,
  /** Utgående moms (credit). */
  vatAccount: account,
  /** Kundfordran (debit, the sum to pay incl. VAT). */
  receivableAccount: account,
  /** Fordran för ROT-avdraget (debit, the ROT part of a private person's quote); only needed when ROT is used. */
  rotReceivableAccount: account,
  /** Försäljning med omvänd moms (credit, the whole sale of such a document); only needed when reverse VAT is used. */
  reverseVatAccount: account,
  /** Verifikationsserie in the accounting program (letters or digits). */
  series: z.string().trim().max(10).refine((value) => !value || /^[A-Za-z0-9]+$/.test(value), "Serien skrivs med bokstäver eller siffror, till exempel A.").default(""),
});
export type AccountingSettings = z.infer<typeof accountingSettingsSchema>;
export const ACCOUNTING_FIELDS: { key: keyof AccountingSettings; label: string; placeholder: string }[] = [
  { key: "materialAccount", label: "Försäljning material", placeholder: "Ert konto, t.ex. 3xxx" },
  { key: "labourAccount", label: "Försäljning arbete", placeholder: "Ert konto, t.ex. 3xxx" },
  { key: "otherAccount", label: "Försäljning övrigt", placeholder: "Ert konto, t.ex. 3xxx" },
  { key: "vatAccount", label: "Utgående moms", placeholder: "Ert konto, t.ex. 26xx" },
  { key: "receivableAccount", label: "Kundfordran", placeholder: "Ert konto, t.ex. 15xx" },
  { key: "rotReceivableAccount", label: "Fordran ROT-avdrag", placeholder: "Bara vid ROT, ert konto" },
  { key: "reverseVatAccount", label: "Försäljning omvänd moms", placeholder: "Bara vid omvänd moms" },
  { key: "series", label: "Verifikationsserie", placeholder: "T.ex. A" },
];

/** The mapping as stored; anything unreadable falls back to empty, field by field. */
export function accountingSettingsOf(value: unknown): AccountingSettings {
  const source = value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
  const result = {} as AccountingSettings;
  for (const key of Object.keys(accountingSettingsSchema.shape) as (keyof AccountingSettings)[]) {
    const parsed = accountingSettingsSchema.shape[key].safeParse(source[key]);
    result[key] = parsed.success ? parsed.data : "";
  }
  return result;
}

const KIND_ACCOUNT: Record<QuoteLineKind, keyof AccountingSettings> = { MATERIAL: "materialAccount", LABOUR: "labourAccount", OTHER: "otherAccount" };

// ---------- the quote as exported ----------

/** What is exported: a quote, or a fakturaunderlag from work done (2026-10-10). Absent = a quote. */
export type AccountingDocument = "quote" | "invoice_basis";
export const ACCOUNTING_DOCUMENT_WORD: Record<AccountingDocument, string> = { quote: "Offert", invoice_basis: "Fakturaunderlag" };
const isBasis = (document: { document?: AccountingDocument }) => document.document === "invoice_basis";

export type AccountingQuoteLine = { articleNo?: string; kind: QuoteLineKind; name: string; quantity: string | number; unit: string; unitPrice: string | number | null; markupPercent: string | number | null; rotLabour?: boolean };
export type AccountingQuote = {
  document?: AccountingDocument;
  /** A quote's status; a fakturaunderlag is DRAFT or INVOICED. */
  id: string; label: string; title: string; status: QuoteStatus | "INVOICED";
  /** ÅÅÅÅ-MM-DD: the day it was accepted (the verification date), else sent, else created; a basis: invoiced, else today. */
  date: string;
  customerName: string; projectName: string; vatPercent: number;
  /** The customer in the register (plan 1L: its accounting number is read and kept there); absent when none. */
  customerId?: string | null;
  /** The customer's number in the company's accounting system (Kundnummer i bokföringen); the CSV carries it for the import. */
  customerNumber?: string;
  lines: AccountingQuoteLine[];
  /** ROT on a private person's quote (share % and cap kr, as entered on the quote); absent or null = none. */
  rot?: QuoteRot | null;
  /** Omvänd byggmoms: stated on the document, vatPercent is then 0. */
  reverseVat?: boolean; buyerVatNumber?: string;
};

const toOre = (kronor: number) => Math.round(Number((kronor * 100).toPrecision(12)));
const oreText = (ore: number, decimal: "," | ".") => `${ore < 0 ? "-" : ""}${Math.floor(Math.abs(ore) / 100)}${decimal}${String(Math.abs(ore) % 100).padStart(2, "0")}`;
const numberText = (value: number | null) => value === null ? "" : String(Math.round(value * 10000) / 10000).replace(".", ",");

/** A line's selling numbers in öre: à-pris incl. markup and the amount, null without a price. */
export function lineOre(line: AccountingQuoteLine) {
  const numbers = quoteLineNumbers(line);
  return { quantity: numbers.quantity, unit: numbers.saleUnitPrice === null ? null : toOre(numbers.saleUnitPrice), amount: numbers.amount === null ? null : toOre(numbers.amount) };
}

/**
 * Net per kind, VAT and the sum to pay, all in öre; `unpriced` lines are counted, never as 0 kr in silence. With ROT,
 * `rot` is the deduction and `customer` the customer's own share (gross − rot); without, rot = 0 and customer = gross.
 */
export function quoteOre(quote: Pick<AccountingQuote, "lines" | "vatPercent" | "rot">) {
  const byKind: Record<QuoteLineKind, number> = { MATERIAL: 0, LABOUR: 0, OTHER: 0 };
  let unpriced = 0, rotBase = 0;
  for (const line of quote.lines) {
    const { amount } = lineOre(line);
    if (amount === null) { unpriced += 1; continue; }
    byKind[line.kind] += amount;
    if (line.rotLabour) rotBase += amount;
  }
  const net = byKind.MATERIAL + byKind.LABOUR + byKind.OTHER;
  const vat = Math.round(net * quote.vatPercent / 100);
  const gross = net + vat;
  const rot = quote.rot && rotBase > 0
    ? Math.max(0, Math.min(Math.round(quote.rot.cap * 100), Math.round(Math.round(rotBase * (1 + quote.vatPercent / 100)) * quote.rot.percent / 100)))
    : 0;
  return { byKind, net, vat, gross, unpriced, rot, customer: gross - rot };
}

/** The status as the person reads it in the file. */
export function accountingStatusText(document: Pick<AccountingQuote, "document" | "status">): string {
  if (isBasis(document)) return document.status === "INVOICED" ? "Fakturerat" : "Utkast";
  return QUOTE_STATUS_LABELS[document.status as QuoteStatus] ?? "";
}

// ---------- CSV ----------

// A CSV cell: always quoted; a leading = + - @ is neutralised unless it is a plain number (shared, lib/csv/cell.ts).
export { csvCell };

export const QUOTE_CSV_TAX_HEADER = ["Omvänd moms", "Köparens momsreg.nr", "ROT-arbete", "ROT-avdrag hela dokumentet (kr)"];
export const QUOTE_CSV_HEADER = ["Offert", "Rubrik", "Status", "Datum", "Kund", "Kundnummer", "Projekt", "Rad", "Typ", "Artikelnummer", "Benämning", "Antal", "Enhet", "À-pris exkl. moms (kr)", "Belopp exkl. moms (kr)", "Moms (%)"];

/** One row per quote line; a line without a price has empty price cells. With the BOM, ready for Excel. */
export function quotesCsv(quotes: readonly AccountingQuote[]): string {
  // A file of fakturaunderlag names its first column so; a quote file is unchanged.
  const header = quotes.length && quotes.every(isBasis) ? [ACCOUNTING_DOCUMENT_WORD.invoice_basis, ...QUOTE_CSV_HEADER.slice(1)] : QUOTE_CSV_HEADER;
  // Omvänd moms and ROT get columns of their own only in a file that has them, so every other file reads as before.
  const taxed = quotes.some((quote) => quote.reverseVat || quote.rot);
  const rows: (string | number)[][] = [taxed ? [...header, ...QUOTE_CSV_TAX_HEADER] : header];
  for (const quote of quotes) {
    const rotOre = taxed ? quoteOre(quote).rot : 0;
    quote.lines.forEach((line, index) => {
      const ore = lineOre(line);
      rows.push([quote.label, quote.title, accountingStatusText(quote), quote.date, quote.customerName, quote.customerNumber ?? "", quote.projectName, index + 1, QUOTE_LINE_KIND_LABELS[line.kind], line.articleNo ?? "", line.name,
        numberText(ore.quantity), line.unit, ore.unit === null ? "" : oreText(ore.unit, ","), ore.amount === null ? "" : oreText(ore.amount, ","), numberText(quote.vatPercent),
        ...(taxed ? [quote.reverseVat ? "Ja" : "Nej", quote.buyerVatNumber ?? "", line.rotLabour && quote.rot ? "Ja" : "Nej", quote.rot ? oreText(rotOre, ",") : ""] : [])]);
    });
  }
  return "﻿" + rows.map((row) => row.map(csvCell).join(";")).join("\r\n") + "\r\n";
}

// ---------- SIE 4 ----------

export type VoucherRow = { account: string; ore: number };
/**
 * The verification of one quote: Kundfordran debit (the customer's share; with ROT the ROT part is a debit on Fordran
 * ROT-avdrag), Försäljning per kind credit, Utgående moms credit.
 * Debit is positive and credit negative, as in SIE; the rows always sum to 0. `issues` says what is missing.
 */
export function quoteVoucher(quote: AccountingQuote, settings: AccountingSettings): { rows: VoucherRow[]; issues: string[] } {
  const issues: string[] = [];
  const sums = quoteOre(quote);
  if (sums.unpriced) issues.push(`${quote.label}: ${sums.unpriced} ${sums.unpriced === 1 ? "rad saknar" : "rader saknar"} pris.`);
  if (!quote.lines.length || sums.net === 0) issues.push(`${quote.label}: ${isBasis(quote) ? "underlaget" : "offerten"} har inget belopp.`);
  const need = (key: keyof AccountingSettings) => {
    if (!settings[key]) issues.push(`Ange kontot för ${ACCOUNTING_FIELDS.find((field) => field.key === key)!.label.toLowerCase()} under ${ACCOUNTS_PLACE}.`);
    return settings[key];
  };
  const rows: VoucherRow[] = [];
  if (sums.customer) rows.push({ account: need("receivableAccount"), ore: sums.customer });
  if (sums.rot) rows.push({ account: need("rotReceivableAccount"), ore: sums.rot });
  for (const kind of ["MATERIAL", "LABOUR", "OTHER"] as const) if (sums.byKind[kind]) rows.push({ account: need(quote.reverseVat ? "reverseVatAccount" : KIND_ACCOUNT[kind]), ore: -sums.byKind[kind] });
  if (sums.vat) rows.push({ account: need("vatAccount"), ore: -sums.vat });
  return { rows, issues: [...new Set(issues)] };
}

/** Shown when a quote is asked for as SIE (the API refuses it too). */
export const QUOTE_SIE_REFUSED = "Offerter exporteras inte till bokföringen. Exportera det godkända fakturaunderlaget i stället.";
/** Shown when a draft fakturaunderlag is asked for as SIE. */
export const DRAFT_BASIS_SIE_REFUSED = "Bara ett godkänt fakturaunderlag kan exporteras till bokföringen, inte ett utkast. Markera underlaget som fakturerat först.";

/** Why a document may not go to the accounting as SIE, or "" when it may: only an invoiced fakturaunderlag is booked. */
export function sieRefusal(document: Pick<AccountingQuote, "document" | "status" | "label">): string {
  if (!isBasis(document)) return QUOTE_SIE_REFUSED;
  return document.status === "INVOICED" ? "" : `${document.label}: ${DRAFT_BASIS_SIE_REFUSED}`;
}

/** A SIE text field: always in quotes, a quote inside written as \" and a backslash as \\; no control characters. */
export function sieText(value: string) {
  return `"${value.replace(/[\u0000-\u001f\u007f]+/g, " ").replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
}
const sieDate = (day: string) => day.replace(/-/g, "");
const sieAmount = (ore: number) => oreText(ore, ".");

export type SieMeta = { company: string; organizationNumber: string; generatedOn: string; programVersion: string };

/**
 * SIE 4 import file (#SIETYP 4, extension .si): the header the format requires (#FLAGGA, #PROGRAM, #FORMAT PC8, #GEN,
 * #SIETYP, #FNAMN, #ORGNR when known) and one #VER per invoiced fakturaunderlag with its #TRANS rows. The verification number is
 * left empty so the accounting program numbers it. Returns the text; `sieBytes` encodes it as PC8 (code page 437).
 * Nothing is written while anything is missing: the issues are returned instead.
 */
export function quotesSie(quotes: readonly AccountingQuote[], settings: AccountingSettings, meta: SieMeta): { text: string; issues: string[] } {
  const issues: string[] = [];
  if (!quotes.length) issues.push("Välj ett godkänt fakturaunderlag.");
  for (const quote of quotes) { const refusal = sieRefusal(quote); if (refusal) issues.push(refusal); }
  if (issues.length) return { text: "", issues: [...new Set(issues)] };
  if (!settings.series) issues.push(`Ange verifikationsserie under ${ACCOUNTS_PLACE}.`);
  const vouchers = quotes.map((quote) => ({ quote, ...quoteVoucher(quote, settings) }));
  for (const voucher of vouchers) issues.push(...voucher.issues);
  if (issues.length) return { text: "", issues: [...new Set(issues)] };
  const lines = [
    "#FLAGGA 0",
    `#PROGRAM ${sieText("Workflow")} ${sieText(meta.programVersion)}`,
    "#FORMAT PC8",
    `#GEN ${sieDate(meta.generatedOn)}`,
    "#SIETYP 4",
    `#FNAMN ${sieText(meta.company)}`,
    ...(meta.organizationNumber.trim() ? [`#ORGNR ${meta.organizationNumber.trim().replace(/\s+/g, "")}`] : []),
  ];
  for (const { quote, rows } of vouchers) {
    const text = [`${ACCOUNTING_DOCUMENT_WORD[quote.document ?? "quote"]} ${quote.label}`, quote.title, quote.customerName].filter(Boolean).join(" ").slice(0, 200);
    lines.push(`#VER ${sieText(settings.series)} "" ${sieDate(quote.date)} ${sieText(text)}`, "{");
    for (const row of rows) lines.push(`   #TRANS ${row.account} {} ${sieAmount(row.ore)}`);
    lines.push("}");
  }
  return { text: lines.join("\r\n") + "\r\n", issues: [] };
}

// PC8 = IBM code page 437, which SIE prescribes. ASCII stays as it is; the Swedish letters and a few more are mapped;
// a character the format cannot hold becomes its closest plain text, else "?", so the file is never broken.
const CP437: Record<string, number> = {
  "Ç": 0x80, "ü": 0x81, "é": 0x82, "â": 0x83, "ä": 0x84, "à": 0x85, "å": 0x86, "ç": 0x87, "ê": 0x88, "ë": 0x89, "è": 0x8a, "ï": 0x8b, "î": 0x8c, "ì": 0x8d,
  "Ä": 0x8e, "Å": 0x8f, "É": 0x90, "æ": 0x91, "Æ": 0x92, "ô": 0x93, "ö": 0x94, "ò": 0x95, "û": 0x96, "ù": 0x97, "ÿ": 0x98, "Ö": 0x99, "Ü": 0x9a,
  "á": 0xa0, "í": 0xa1, "ó": 0xa2, "ú": 0xa3, "ñ": 0xa4, "Ñ": 0xa5, "ß": 0xe1, "µ": 0xe6, "°": 0xf8,
};
// Characters the code page lacks that people do type (Fas 2, 2026-10-11: a dash in a title became "?"): the closest plain
// text. A double quote never comes out of a curly one, since the field's own quotes would break.
const PLAIN: Record<string, string> = {
  "–": "-", "—": "-", "‐": "-", "‑": "-", "‒": "-", "−": "-", "‘": "'", "’": "'", "‚": "'", "“": "'", "”": "'", "„": "'", "…": "...", " ": " ", " ": " ", " ": " ",
  "×": "x", "€": "EUR", "•": "-", "·": "-", "™": "TM", "©": "(c)", "®": "(R)", "½": "1/2", "¼": "1/4", "¾": "3/4", "²": "2", "³": "3",
};
/** A character as the code page holds it: itself, its closest plain text, its letter without the accent, else "?". */
function cp437Bytes(char: string): number[] {
  const code = char.codePointAt(0)!;
  if (code < 0x80) return [code];
  if (CP437[char] !== undefined) return [CP437[char]];
  const plain = PLAIN[char] ?? char.normalize("NFD").replace(/[̀-ͯ]/g, "");
  if (plain !== char && plain) return [...plain].flatMap((item) => (item.codePointAt(0)! < 0x80 || CP437[item] !== undefined) ? cp437Bytes(item) : [0x3f]);
  return [0x3f];
}
export function sieBytes(text: string): Uint8Array {
  return Uint8Array.from([...text].flatMap(cp437Bytes));
}
