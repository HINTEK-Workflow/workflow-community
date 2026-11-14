import { z } from "zod";
import type { ListSortKey } from "@/lib/list-filter";
import { formatPrice, formatSek } from "@/lib/workflow/expenses";
import { roundOre } from "@/lib/workflow/material-prices";
import { parseShare, quoteLineNumbers, quoteRotOf, rotDeduction, type QuoteCustomerType, type QuoteLineKind } from "@/lib/quotes/model";
import type { InvoiceBasisLine, InvoiceBasisTax } from "@/lib/invoice-basis/model";
import { parseSwedishIdNumber } from "@/lib/staff-register/model";
import { swedishParts } from "@/lib/swedish-time";
import { blockVersion, fillPlaceholders, type PdfBlockDef, type PdfTemplateOverride, type PdfTexts, type ResolvedPdfDocument } from "@/lib/pdf-templates/model";

/**
 * Fakturor (owner's decision 2026-11-04, docs/beslut/faktura.md). Pure rules shared by the server, the page, the demo and the
 * tests. An invoice is made from an invoice basis only, a credit invoice from an issued invoice. What is issued is a snapshot
 * (`InvoiceContent`): the seller, the buyer, the lines with their selling prices, the sums and the document's texts as they
 * were that day. The identity number of a ROT buyer is never part of the snapshot: `buildInvoice` hands it back on its own,
 * for the sealed column. Purchase prices and markups never reach an invoice: a line's price is the selling price.
 *
 * Which details are required follows the public guidance listed in the decision document, in our own words. The result is to
 * be reviewed by a lawyer or accounting consultant before real use, and asserts nothing about legal correctness.
 */
export const INVOICE_KINDS = ["INVOICE", "CREDIT"] as const;
export type InvoiceKind = (typeof INVOICE_KINDS)[number];

export type InvoiceSeller = {
  name: string; organizationNumber: string; vatNumber: string; fSkatt: boolean; address: string; registeredOffice: string; phone: string; email: string;
  bankgiro: string; plusgiro: string; iban: string; bic: string;
  /** The company sells without VAT (small-business exemption): no VAT number is needed and no VAT is charged. */
  vatExempt: boolean;
};
export type InvoiceBuyer = { name: string; contactName: string; address: string; customerType: QuoteCustomerType };
export type InvoiceSettings = {
  enabled: boolean; nextNumber: number; prefix: string; paymentDays: number | null; lateTerms: string; iban: string; bic: string; useOcr: boolean; vatExempt: boolean;
  /** How many invoices the company has issued; the start number is locked from the first one. */
  issued: number;
};
export const BLANK_INVOICE_SETTINGS: InvoiceSettings = { enabled: true, nextNumber: 1, prefix: "", paymentDays: null, lateTerms: "", iban: "", bic: "", useOcr: false, vatExempt: false, issued: 0 };

export type InvoiceLine = { id: string; kind: QuoteLineKind; name: string; articleNo: string; quantity: number; unit: string; unitPrice: number; amount: number; vatPercent: number; rotLabour: boolean };
export type InvoiceVatRow = { percent: number; net: number; vat: number };
export type InvoiceRot = {
  percent: number; cap: number; labourInclVat: number; otherInclVat: number; deduction: number; capped: boolean;
  propertyDesignation: string; brfOrganizationNumber: string; apartmentNumber: string; workPlace: string;
};
export type FrozenTexts = Record<string, { text: string; shown: boolean }>;
export type InvoiceContent = {
  version: 1; kind: InvoiceKind; number: number; label: string; issuedOn: string; dueOn: string | null; paymentDays: number | null;
  performedFrom: string; performedOn: string; title: string; basisLabel: string;
  seller: InvoiceSeller; buyer: InvoiceBuyer; buyerVatNumber: string;
  lines: InvoiceLine[]; vatRows: InvoiceVatRow[]; net: number; vat: number; gross: number; toPay: number;
  reverseVat: boolean; exemptionText: string; rot: InvoiceRot | null;
  /** What the buyer writes when paying: the OCR number, else the invoice number. */
  reference: string; ocr: boolean; lateTerms: string;
  creditOf: { id: string; label: string; issuedOn: string; reason: string } | null;
  texts: FrozenTexts;
  /** The "common" template's texts that day (footer, signature lines …). Snapshots from before this part print the defaults. */
  common?: FrozenTexts;
};

// ---------- numbers ----------

/** The label of a number: the company's prefix, then the number as it is, "1001" or "2026-1001". */
export const invoiceLabel = (prefix: string, number: number) => `${prefix}${Math.max(0, Math.trunc(number))}`;

/**
 * The next number from the series as it stands under the row's lock (the server takes it in the transaction that writes the
 * invoice). Pure, so the concurrency rule can be tried on its own: each caller sees the state the previous one left.
 */
export function allocateInvoiceNumber(state: Pick<InvoiceSettings, "enabled" | "nextNumber" | "prefix">): { number: number; label: string; nextNumber: number } {
  if (!state.enabled) throw new Error("Fakturering är avstängd.");
  return { number: state.nextNumber, label: invoiceLabel(state.prefix, state.nextNumber), nextNumber: state.nextNumber + 1 };
}

/** Why the start number cannot become `next` ("" when it can): it is free until the first invoice is issued, then it is locked. */
export function startNumberProblem(state: Pick<InvoiceSettings, "nextNumber" | "issued">, next: number): string {
  if (next === state.nextNumber) return "";
  if (!Number.isInteger(next) || next < 1 || next > 2_000_000_000) return "Startnumret ska vara ett heltal, minst 1.";
  return state.issued ? "Startnumret kan inte ändras när företaget har utfärdat fakturor." : "";
}

const luhnDigit = (digits: string) => {
  let sum = 0;
  for (let index = 0; index < digits.length; index += 1) {
    const value = Number(digits[digits.length - 1 - index]) * (index % 2 === 0 ? 2 : 1);
    sum += value > 9 ? value - 9 : value;
  }
  return (10 - (sum % 10)) % 10;
};
/** An OCR number from the invoice number: the number, a length digit and a check digit (modulus 10). */
export function ocrNumber(number: number): string {
  const base = String(Math.max(0, Math.trunc(number)));
  const withLength = `${base}${(base.length + 2) % 10}`;
  return `${withLength}${luhnDigit(withLength)}`;
}
export function ocrIsValid(value: string): boolean {
  if (!/^\d{2,25}$/.test(value)) return false;
  return Number(value.at(-2)) === value.length % 10 && luhnDigit(value.slice(0, -1)) === Number(value.at(-1));
}

// ---------- dates and sums ----------

const DAY = /^\d{4}-\d{2}-\d{2}$/;
const realDay = (value: string) => DAY.test(value) && !Number.isNaN(Date.parse(`${value}T12:00:00Z`)) && new Date(`${value}T12:00:00Z`).toISOString().startsWith(value);
export const addDays = (day: string, days: number) => new Date(Date.parse(`${day}T12:00:00Z`) + days * 86_400_000).toISOString().slice(0, 10);
/** The last day of the second month after the month of `day`: the latest invoice date for construction services. */
export const secondMonthEnd = (day: string) => new Date(Date.UTC(Number(day.slice(0, 4)), Number(day.slice(5, 7)) + 2, 0, 12)).toISOString().slice(0, 10);

const negate = (value: number) => value === 0 ? 0 : -value;

/** Net and VAT per rate, the total, and ROT by the same rule as a quote: a share of the labour incl. VAT, never above the cap. */
export function invoiceSums(lines: readonly Pick<InvoiceLine, "amount" | "vatPercent" | "rotLabour">[], rot: { percent: number; cap: number } | null) {
  const nets = new Map<number, number>();
  const labourNets = new Map<number, number>();
  for (const line of lines) {
    nets.set(line.vatPercent, (nets.get(line.vatPercent) ?? 0) + line.amount);
    if (line.rotLabour) labourNets.set(line.vatPercent, (labourNets.get(line.vatPercent) ?? 0) + line.amount);
  }
  const vatRows = [...nets.entries()].sort((a, b) => b[0] - a[0]).map(([percent, net]) => ({ percent, net: roundOre(net), vat: roundOre(roundOre(net) * percent / 100) }));
  const net = roundOre(vatRows.reduce((sum, row) => sum + row.net, 0));
  const vat = roundOre(vatRows.reduce((sum, row) => sum + row.vat, 0));
  const gross = roundOre(net + vat);
  const labourInclVat = rot ? roundOre([...labourNets.entries()].reduce((sum, [percent, value]) => sum + roundOre(value) * (1 + percent / 100), 0)) : 0;
  const deduction = rotDeduction(labourInclVat, rot);
  return { vatRows, net, vat, gross, labourInclVat, otherInclVat: rot ? roundOre(gross - labourInclVat) : 0, deduction, capped: Boolean(rot && labourInclVat * rot.percent / 100 > rot.cap), toPay: roundOre(gross - deduction) };
}

const HOUR_UNITS = new Set(["h", "tim", "timme", "timmar"]);
/** The unit for hours is "h" everywhere on an invoice; every other unit stays as written. */
export const invoiceUnit = (unit: string) => HOUR_UNITS.has(unit.trim().toLocaleLowerCase("sv")) ? "h" : unit.trim();

// ---------- what the person fills in ----------

const dayText = z.string().trim().max(10).default("");
export const invoiceRotInputSchema = z.object({
  personalNumber: z.string().trim().max(20).default(""),
  propertyDesignation: z.string().trim().max(120).default(""),
  brfOrganizationNumber: z.string().trim().max(20).default(""),
  apartmentNumber: z.string().trim().max(20).default(""),
  workPlace: z.string().trim().max(300).default(""),
});
export const invoiceDetailsSchema = z.object({
  performedFrom: dayText,
  performedOn: dayText,
  paymentDays: z.string().trim().max(4).default(""),
  /** A line's VAT rate where it differs from the basis's: line id → percent as typed. */
  lineVat: z.record(z.string().max(100), z.string().trim().max(20)).default({}),
  exemptionText: z.string().trim().max(200).default(""),
  rot: invoiceRotInputSchema.default({ personalNumber: "", propertyDesignation: "", brfOrganizationNumber: "", apartmentNumber: "", workPlace: "" }),
});
export type InvoiceDetails = z.output<typeof invoiceDetailsSchema>;

/** What stops an invoice from being issued, each saying exactly what is missing. `key` is stable for the page and the tests. */
export type InvoiceProblem = { key: string; text: string };

const COMPANY_PLACE = "Företagsuppgifter";
const SETTINGS_PLACE = "Inställningar → Arbetssätt → Fakturering";
/** A limited company must state its registered office on an invoice; its organisation number starts with 5, and a name may say so. */
export const sellerIsLimitedCompany = (seller: Pick<InvoiceSeller, "name" | "organizationNumber">) => /^5\d{5}-?\d{4}$/.test(seller.organizationNumber.trim()) || /\b(ab|aktiebolag)\b/i.test(seller.name);
const VAT_NUMBER = /^[A-Za-z]{2}[0-9A-Za-z]{2,13}$/;

export function sellerProblems(seller: InvoiceSeller): InvoiceProblem[] {
  const problems: InvoiceProblem[] = [];
  const need = (key: string, ok: boolean, text: string) => { if (!ok) problems.push({ key, text }); };
  need("seller.name", Boolean(seller.name.trim()), `Företagets namn saknas (${COMPANY_PLACE}).`);
  need("seller.address", Boolean(seller.address.trim()), `Företagets adress saknas (${COMPANY_PLACE}).`);
  need("seller.organizationNumber", Boolean(seller.organizationNumber.trim()), `Företagets organisationsnummer saknas (${COMPANY_PLACE}).`);
  if (!seller.vatExempt) need("seller.vatNumber", VAT_NUMBER.test(seller.vatNumber.replace(/\s+/g, "")), seller.vatNumber.trim() ? `Företagets momsregistreringsnummer ser inte rätt ut (${COMPANY_PLACE}).` : `Företagets momsregistreringsnummer saknas (${COMPANY_PLACE}). Säljer företaget utan moms anger du det under ${SETTINGS_PLACE}.`);
  if (sellerIsLimitedCompany(seller)) need("seller.registeredOffice", Boolean(seller.registeredOffice.trim()), `Företagets säte saknas (${COMPANY_PLACE}). Ett aktiebolag ska ange det på fakturan.`);
  need("seller.payment", Boolean(seller.bankgiro.trim() || seller.plusgiro.trim() || seller.iban.trim()), `Bankgiro, plusgiro eller IBAN saknas (${COMPANY_PLACE} eller ${SETTINGS_PLACE}).`);
  return problems;
}

export type InvoiceSource = {
  seller: InvoiceSeller; buyer: InvoiceBuyer; settings: Pick<InvoiceSettings, "prefix" | "paymentDays" | "lateTerms" | "useOcr">;
  basis: { label: string; title: string; vatPercent: number; tax: InvoiceBasisTax; lines: readonly InvoiceBasisLine[] };
  /** Today in Sweden: the invoice date. It is never typed, so the numbers and the dates follow each other. */
  today: string;
  texts: FrozenTexts;
  common?: FrozenTexts;
};

/** A basis line's VAT rate: 0 under reverse charge or when the company sells without VAT, else what was typed, else the basis's. */
const lineVatOf = (source: InvoiceSource, details: InvoiceDetails, line: InvoiceBasisLine): number | null => {
  if (source.basis.tax.reverseVat || source.seller.vatExempt) return 0;
  const typed = details.lineVat[line.id];
  return typed === undefined || typed === "" ? source.basis.vatPercent : parseShare(typed);
};

/**
 * The invoice's content, what stops it and what the person should look at. The number is filled in by the server under the
 * series' lock; `problems` is the same whoever calls: the page while typing, the server again when issuing. The identity
 * number comes back beside the content, never in it.
 */
export function buildInvoice(source: InvoiceSource, details: InvoiceDetails, allocated: { number: number; label: string; reference?: string } | null = null): {
  content: InvoiceContent; problems: InvoiceProblem[]; warnings: string[]; identity: { digits: string; masked: string } | null;
} {
  const { seller, buyer, basis, settings, today } = source;
  const problems = sellerProblems(seller);
  const warnings: string[] = [];
  const need = (key: string, ok: boolean, text: string) => { if (!ok) problems.push({ key, text }); };
  need("buyer.name", Boolean(buyer.name.trim()), "Kundens namn saknas. Välj en kund.");
  need("buyer.address", Boolean(buyer.address.trim()), "Kundens adress saknas (Kundregistret).");

  // Lines: the selling price per unit; a line without a price or with an unreadable VAT rate stops the invoice.
  let unpriced = 0;
  let badVat = 0;
  const lines = basis.lines.map((line): InvoiceLine => {
    const numbers = quoteLineNumbers(line);
    if (numbers.amount === null || numbers.quantity === null || numbers.saleUnitPrice === null) unpriced += 1;
    const vatPercent = lineVatOf(source, details, line);
    if (vatPercent === null) badVat += 1;
    return {
      id: line.id, kind: line.kind, name: line.name, articleNo: (line.articleNo ?? "").trim(), quantity: numbers.quantity ?? 0, unit: invoiceUnit(line.unit),
      unitPrice: numbers.saleUnitPrice ?? 0, amount: numbers.amount ?? 0, vatPercent: vatPercent ?? 0, rotLabour: Boolean(line.rotLabour),
    };
  });
  need("lines.empty", lines.length > 0, "Underlaget har inga rader.");
  need("lines.unpriced", unpriced === 0, `${unpriced} ${unpriced === 1 ? "rad saknar" : "rader saknar"} pris eller antal.`);
  need("lines.vat", badVat === 0, "En momssats är inte en procent mellan 0 och 100.");
  need("lines.names", lines.every((line) => line.name.trim()), "En rad saknar benämning.");

  // Tax choice: reverse charge and ROT come from the basis, and the customer decides which of them can apply.
  const tax = basis.tax;
  if (tax.reverseVat) {
    need("buyer.vatNumber", VAT_NUMBER.test(tax.buyerVatNumber.replace(/\s+/g, "")), tax.buyerVatNumber.trim() ? "Köparens momsregistreringsnummer ser inte rätt ut." : "Köparens momsregistreringsnummer saknas. Det krävs vid omvänd betalningsskyldighet.");
    need("buyer.reverseType", buyer.customerType !== "PRIVATE", "Omvänd betalningsskyldighet gäller inte en privatperson.");
    need("seller.reverse", !seller.vatExempt, "Omvänd betalningsskyldighet gäller inte när företaget säljer utan moms.");
  }
  if (tax.rotEnabled) need("rot.type", buyer.customerType === "PRIVATE", "ROT-avdrag gäller bara en privatperson som kund.");
  const rotShare = quoteRotOf({ customerType: buyer.customerType, rotEnabled: tax.rotEnabled, rotPercent: tax.rotPercent, rotCap: tax.rotCap });
  if (tax.rotEnabled && buyer.customerType === "PRIVATE" && !rotShare) problems.push({ key: "rot.share", text: "ROT-andel och tak saknas på underlaget." });

  let identity: { digits: string; masked: string } | null = null;
  let rot: InvoiceRot | null = null;
  const sums = invoiceSums(lines, rotShare);
  if (rotShare) {
    need("rot.fSkatt", seller.fSkatt, `Företaget är inte angivet som godkänt för F-skatt (${COMPANY_PLACE}). Det krävs på en ROT-faktura.`);
    need("rot.labour", lines.some((line) => line.rotLabour), "Markera vilka rader som är arbete för ROT på underlaget.");
    const parsed = details.rot.personalNumber ? parseSwedishIdNumber(details.rot.personalNumber, new Date(`${today}T12:00:00Z`)) : null;
    if (parsed) identity = { digits: parsed.digits, masked: `${parsed.digits.slice(0, 8)}-••••` };
    need("rot.personalNumber", Boolean(parsed), details.rot.personalNumber ? "Köparens personnummer stämmer inte. Kontrollera siffrorna." : "Köparens personnummer saknas. Det krävs på en ROT-faktura.");
    const property = details.rot.propertyDesignation.trim();
    const brf = details.rot.brfOrganizationNumber.replace(/\D/g, "");
    const apartment = details.rot.apartmentNumber.trim();
    const isBrf = Boolean(brf || apartment);
    need("rot.property", Boolean(property) || isBrf, "Fastighetsbeteckning saknas, eller bostadsrättsföreningens organisationsnummer och lägenhetsnummer.");
    if (!property && isBrf) {
      need("rot.brf", brf.length === 10, "Bostadsrättsföreningens organisationsnummer ska ha tio siffror.");
      need("rot.apartment", Boolean(apartment), "Lägenhetsnummer saknas.");
    }
    const workPlace = details.rot.workPlace.trim() || buyer.address.trim();
    need("rot.workPlace", Boolean(workPlace), "Var arbetet utfördes saknas.");
    rot = {
      percent: rotShare.percent, cap: rotShare.cap, labourInclVat: sums.labourInclVat, otherInclVat: sums.otherInclVat, deduction: sums.deduction, capped: sums.capped,
      propertyDesignation: property, brfOrganizationNumber: property ? "" : details.rot.brfOrganizationNumber.trim(), apartmentNumber: property ? "" : apartment, workPlace,
    };
  }

  // A rate of 0 % outside reverse charge has to say why.
  const zeroOutside = !tax.reverseVat && !seller.vatExempt && lines.some((line) => line.vatPercent === 0);
  need("vat.exemption", !zeroOutside || Boolean(details.exemptionText.trim()), "Skriv varför en rad har 0 % moms.");

  // Dates and terms.
  need("performedOn", realDay(details.performedOn), "Skriv när arbetet utfördes.");
  if (details.performedFrom) need("performedFrom", realDay(details.performedFrom) && details.performedFrom <= details.performedOn, "Startdagen för arbetet stämmer inte.");
  if (realDay(details.performedOn) && details.performedOn > today) problems.push({ key: "performedOn.future", text: "Arbetets slutdag ligger i framtiden." });
  const days = Number.parseInt(details.paymentDays || String(settings.paymentDays ?? ""), 10);
  const daysOk = Number.isInteger(days) && days >= 0 && days <= 365;
  need("paymentDays", daysOk, "Skriv betalningsvillkor i dagar, mellan 0 och 365.");
  need("total", sums.toPay > 0 || lines.length === 0, "Summan att betala måste vara större än noll.");

  if (!seller.fSkatt && !rotShare) warnings.push("Företaget är inte angivet som godkänt för F-skatt, så det står inte på fakturan.");
  if (realDay(details.performedOn) && secondMonthEnd(details.performedOn) < today) warnings.push("Arbetet är gammalt. Bygg- och installationstjänster ska normalt faktureras senast andra månaden efter att de utfördes.");

  const number = allocated?.number ?? 0;
  const content: InvoiceContent = {
    version: 1, kind: "INVOICE", number, label: allocated?.label ?? "", issuedOn: today, dueOn: daysOk ? addDays(today, days) : null, paymentDays: daysOk ? days : null,
    performedFrom: details.performedFrom, performedOn: details.performedOn, title: basis.title, basisLabel: basis.label,
    seller, buyer, buyerVatNumber: tax.reverseVat ? tax.buyerVatNumber.replace(/\s+/g, "").toUpperCase() : "",
    lines, vatRows: sums.vatRows, net: sums.net, vat: sums.vat, gross: sums.gross, toPay: sums.toPay,
    reverseVat: tax.reverseVat, exemptionText: zeroOutside ? details.exemptionText.trim() : "", rot,
    reference: allocated?.reference ?? (allocated ? (settings.useOcr ? ocrNumber(number) : allocated.label) : ""), ocr: settings.useOcr, lateTerms: settings.lateTerms.trim(), creditOf: null, texts: source.texts, ...(source.common ? { common: source.common } : {}),
  };
  return { content, problems, warnings, identity };
}

/** The credit invoice of an issued invoice: its parties and lines, every amount negative, a reference to the original by number and date. */
export function buildCredit(original: InvoiceContent, input: { id: string; number: number; label: string; today: string; reason: string; texts: FrozenTexts; common?: FrozenTexts }): InvoiceContent {
  return {
    ...original, kind: "CREDIT", number: input.number, label: input.label, issuedOn: input.today, dueOn: null, paymentDays: null,
    lines: original.lines.map((line) => ({ ...line, quantity: negate(line.quantity), amount: negate(line.amount) })),
    vatRows: original.vatRows.map((row) => ({ ...row, net: negate(row.net), vat: negate(row.vat) })),
    net: negate(original.net), vat: negate(original.vat), gross: negate(original.gross), toPay: negate(original.toPay),
    rot: original.rot ? { ...original.rot, labourInclVat: negate(original.rot.labourInclVat), otherInclVat: negate(original.rot.otherInclVat), deduction: negate(original.rot.deduction) } : null,
    reference: input.label, ocr: false, lateTerms: "",
    creditOf: { id: input.id, label: original.label, issuedOn: original.issuedOn, reason: input.reason.trim() },
    texts: input.texts, common: input.common,
  };
}

/** The stored content, or null when it cannot be read as an invoice. */
export function invoiceContentOf(value: unknown): InvoiceContent | null {
  const row = value && typeof value === "object" ? value as Partial<InvoiceContent> : null;
  return row?.version === 1 && Array.isArray(row.lines) && row.seller && row.buyer ? row as InvoiceContent : null;
}

// ---------- frozen texts ----------

/** The template's texts as they stand today, to keep in the snapshot: a later change of the template never changes an issued invoice. */
export function freezeInvoiceTexts(resolved: ResolvedPdfDocument): FrozenTexts {
  return Object.fromEntries(resolved.blocks.map((block) => [block.def.id, { text: block.text, shown: block.visible }]));
}
/**
 * The frozen common texts as the overrides the kit reads, or null for a snapshot without them (the defaults, exactly as before).
 * Each text is read back through the template's own rules (`resolvePdfDocument`), so a locked wording stays locked, a required
 * block stays shown and a text that no longer fits its block falls back to the default.
 */
export function frozenCommonTemplates(common: FrozenTexts | undefined, blocks: readonly PdfBlockDef[]): PdfTemplateOverride[] | null {
  if (!common) return null;
  return blocks.flatMap((block): PdfTemplateOverride[] => {
    const kept = common[block.id];
    return kept ? [{ documentType: "common", blockId: block.id, text: kept.text, visible: kept.shown, orderIndex: null, basedOnVersion: blockVersion(block) }] : [];
  });
}

/** A generator's reader over frozen texts; a block that came with a later version reads as its default. */
export function frozenPdfTexts(frozen: FrozenTexts, blocks: readonly PdfBlockDef[]): PdfTexts {
  const entry = (id: string) => {
    const kept = frozen[id];
    if (kept) return kept;
    const block = blocks.find((item) => item.id === id);
    if (!block) throw new Error(`PDF-mallen saknar blocket ${id}.`);
    return { text: block.text, shown: !block.hidden };
  };
  return { text: (id, values) => fillPlaceholders(entry(id).text, values), shown: (id) => entry(id).shown, order: () => [] };
}

// ---------- retention ----------

/**
 * An invoice is kept for seven years (owner's decision 2026-11-04), also when the company is erased. The bookkeeping act counts from
 * the end of the calendar year in which the fiscal year closed, and a broken fiscal year can close the year after the invoice, so the
 * count starts one year later: an invoice from 2026 is kept through 31 December 2034 and can go from 1 January 2035. The same one
 * extra year as the staff register's reason. The database's trigger has the same number of years.
 */
export const INVOICE_RETENTION_YEARS = 7;
/** The count starts this many years after the end of the invoice's calendar year. */
const INVOICE_RETENTION_START = 1;
const INVOICE_KEPT_YEARS = INVOICE_RETENTION_START + INVOICE_RETENTION_YEARS;
/** The invoices of an erased company dated before this day are over their time. */
export const invoiceRetentionCutoff = (now = new Date()) => `${swedishParts(now).year - INVOICE_KEPT_YEARS}-01-01`;
/** The last day an invoice with this date is kept. */
export const invoiceRetainedThrough = (issuedOn: string) => `${Number(issuedOn.slice(0, 4)) + INVOICE_KEPT_YEARS}-12-31`;

// ---------- the customer's page ----------

/** How long a link to the page works, and its address. The token rules are the quote link's (lib/quotes/customer-link.ts). */
export const INVOICE_LINK_DAYS = 60;
export const invoiceLinkPath = (token: string) => `/faktura/${token}`;
export type InvoiceLinkState = "open" | "expired" | "revoked";
export function invoiceLinkState(link: { validUntil: string; revokedAt: Date | string | null }, today: string): InvoiceLinkState {
  if (link.revokedAt) return "revoked";
  return link.validUntil < today ? "expired" : "open";
}
/** What a customer's page may read, built field by field: never the identity number, the property, internal ids or the seller's other data. */
export type PublicInvoiceView = { label: string; credit: boolean; creditedNote: boolean; title: string; issuedOn: string; dueOn: string | null; toPay: number; reference: string; ocr: boolean; payment: { label: string; value: string }[] };
export function publicInvoiceView(content: InvoiceContent, credited: boolean): PublicInvoiceView {
  const { seller } = content;
  return {
    label: content.label, credit: content.kind === "CREDIT", creditedNote: credited, title: content.title, issuedOn: content.issuedOn, dueOn: content.dueOn, toPay: content.toPay, reference: content.reference, ocr: content.ocr,
    payment: content.kind === "CREDIT" ? [] : [...(seller.bankgiro ? [{ label: "Bankgiro", value: seller.bankgiro }] : []), ...(seller.plusgiro ? [{ label: "Plusgiro", value: seller.plusgiro }] : []), ...(seller.iban ? [{ label: "IBAN", value: seller.iban }] : [])],
  };
}
export type PublicInvoicePage = { state: InvoiceLinkState | "limited"; invoice: PublicInvoiceView | null; company: string };

// ---------- payment ----------

export const INVOICE_PAYMENT_STATES = ["UNPAID", "OVERDUE", "PAID", "CREDITED", "CREDIT"] as const;
export type InvoicePaymentState = (typeof INVOICE_PAYMENT_STATES)[number];
export const INVOICE_PAYMENT_LABELS: Record<InvoicePaymentState, string> = { UNPAID: "Obetald", OVERDUE: "Förfallen", PAID: "Betald", CREDITED: "Krediterad", CREDIT: "Kreditfaktura" };
/** Overdue is never stored: an unpaid invoice whose due date has passed. A credited invoice and a credit invoice have no payment to follow. */
export function invoicePaymentState(invoice: { kind: InvoiceKind; paidOn: string | null; dueOn: string | null; credited: boolean }, today: string): InvoicePaymentState {
  if (invoice.kind === "CREDIT") return "CREDIT";
  if (invoice.credited) return "CREDITED";
  if (invoice.paidOn) return "PAID";
  return invoice.dueOn && invoice.dueOn < today ? "OVERDUE" : "UNPAID";
}

// ---------- what the pages read ----------

export const INVOICE_LIST_FILTERS = ["all", "UNPAID", "OVERDUE", "PAID", "CREDIT"] as const;
export type InvoiceListFilter = (typeof INVOICE_LIST_FILTERS)[number];
export const INVOICE_LIST_FILTER_LABELS: Record<InvoiceListFilter, string> = { all: "Alla", UNPAID: "Obetalda", OVERDUE: "Förfallna", PAID: "Betalda", CREDIT: "Kreditfakturor" };
export const INVOICE_PAGE_SIZE = 25;
/** The list's sorts (Lika är rätt, 2026-11-13: the same toppvisning as Fakturaunderlag): the newest number first, the nearest due day, or the title. */
export const INVOICE_LIST_SORTS = ["number", "due", "title"] as const satisfies readonly ListSortKey[];
export type InvoiceListSort = (typeof INVOICE_LIST_SORTS)[number];

export type InvoiceListItem = { id: string; kind: InvoiceKind; number: number; label: string; title: string; buyerName: string; issuedOn: string; dueOn: string | null; toPay: number; state: InvoicePaymentState; paidOn: string | null };
export type InvoicePage = { items: InvoiceListItem[]; total: number; page: number; pageSize: number; canEdit: boolean; counts: Record<InvoiceListFilter, number> | null };
export type InvoiceEventItem = { id: string; action: string; detail: string; actorName: string; createdAt: string };
export type InvoiceView = InvoiceListItem & {
  content: InvoiceContent; identityMasked: string; events: InvoiceEventItem[]; canEdit: boolean; createdByName: string; basisId: string | null; creditId: string | null; creditLabel: string; correctedByBasisId: string | null; /** The customer's address as it stands today, offered when sending. */ buyerEmail?: string;
};
/** What the basis's page reads: nothing at all while invoicing is off (the API answers 404). */
export type InvoiceBasisState = { enabled: true; canIssue: boolean; invoice: { id: string; label: string; state: InvoicePaymentState; sentOn: string | null; sentTo: string } | null; refusal: string };
/** Ny faktura: who it is to and what it is for; the lines are written in the basis view. */
/** Nytt fakturaunderlag (Lika är rätt, 2026-11-14): saved at the first change, so the customer and the title may still be empty. */
export const standaloneInvoiceSchema = z.object({ customerId: z.string().trim().min(1).max(100).nullable().optional(), title: z.string().trim().max(200).default("") });
/** What the page needs to fill in an invoice from a basis, and to count and check it on the way. */
export type InvoicePrepare = { source: InvoiceSource; defaults: { performedFrom: string; performedOn: string; paymentDays: string; workPlace: string; email: string }; connected: string; revision: number; lineVatPercent: number; /** The basis's customer, for the link to what is missing about them. */ customerId?: string | null };
export type InvoiceSettingsView = { settings: InvoiceSettings; connected: string; sellerProblems: InvoiceProblem[]; canEdit: boolean };

/** The sums' words on the page and the PDF share: "Moms 25 %". */
export const vatRowLabel = (percent: number) => `Moms ${formatPrice(percent)} %`;
/** An amount with its sign, the minus as a real minus sign. */
export const signedSek = (value: number) => `${value < 0 ? "−" : ""}${formatSek(Math.abs(value))}`;

const LOG_WORDS: Record<string, string> = { issued: "Utfärdad", credited: "Krediterad", sent: "Skickad", opened: "Öppnad", downloaded: "Nedladdad", corrected: "Nytt underlag", paid: "Markerad som betald", unpaid: "Betald ångrad" };
/** The address in the log line "Till x@y." */
export const sentToOf = (detail: string) => detail.replace(/^Till\s+/, "").replace(/\.$/, "");
export const invoiceEventWord = (action: string) => LOG_WORDS[action] ?? action;
