import { ACCOUNTING_DOCUMENT_WORD, lineOre, type AccountingQuote, type AccountingSettings } from "./accounting";

/**
 * Fortnox (2026-10-09, steg D): an accepted quote as an invoice draft (fakturaunderlag) in the company's own
 * Fortnox, through the company's own key under Företagsnycklar. This file is the pure payload builder – the page shows
 * exactly this as "Visa vad som skickas" – and the HTTP call lives alone in fortnox-client.ts. Nothing is booked: the
 * draft is checked and sent from Fortnox by the company. The unit is left out (Fortnox only takes its own unit codes);
 * the quantity and the selling price excl. VAT per unit are sent, and the account only when the company has set one.
 * TODO (ROT, steg C 2026-10-09): the ROT/labour marking (rotLabour lines, the quote's share and cap) is not sent yet.
 * Fortnox has its own house-work fields on invoice rows and a tax-reduction part on the invoice; mapping them needs
 * their documentation and a test account, so the invoice draft is completed in Fortnox for now.
 */
export const FORTNOX_DESCRIPTION_MAX = 50;

export type FortnoxInvoiceRow = { Description: string; DeliveredQuantity: string; Price: number; VAT: number; AccountNumber?: number };
export type FortnoxInvoicePayload = {
  Invoice: {
    CustomerNumber: string;
    InvoiceDate: string;
    ExternalInvoiceReference1: string;
    Remarks: string;
    InvoiceRows: FortnoxInvoiceRow[];
  };
};

/** The customer's number in Fortnox, as the person writes it. */
export function fortnoxCustomerNumberProblem(value: string): string {
  const text = value.trim();
  if (!text) return "Skriv kundnumret som kunden har i Fortnox.";
  if (!/^[A-Za-z0-9._-]{1,50}$/.test(text)) return "Kundnumret skrivs med bokstäver, siffror, punkt eller bindestreck.";
  return "";
}

const quantityText = (value: number | null) => value === null ? "0" : String(Math.round(value * 10000) / 10000);

export function fortnoxInvoicePayload(quote: AccountingQuote, settings: AccountingSettings, customerNumber: string): { payload: FortnoxInvoicePayload | null; issues: string[] } {
  const issues: string[] = [];
  // Fakturaunderlag från utfört arbete (2026-10-10): a basis is sent in any status; the rule is the quote's own.
  const basis = quote.document === "invoice_basis";
  if (!basis && quote.status !== "ACCEPTED") issues.push("Bara en accepterad offert skickas som fakturaunderlag.");
  const customerProblem = fortnoxCustomerNumberProblem(customerNumber);
  if (customerProblem) issues.push(customerProblem);
  if (!quote.lines.length) issues.push(basis ? "Underlaget har inga rader." : "Offerten har inga rader.");
  // The rows here carry no reverse-VAT mark, so such a document would reach Fortnox looking like one at 0 % VAT.
  if (quote.reverseVat) issues.push("Omvänd moms skickas inte till Fortnox ännu. Använd CSV eller SIE.");
  const accountOf = { MATERIAL: settings.materialAccount, LABOUR: settings.labourAccount, OTHER: settings.otherAccount } as const;
  const rows: FortnoxInvoiceRow[] = [];
  for (const line of quote.lines) {
    const ore = lineOre(line);
    if (ore.unit === null) { issues.push(`Raden ”${line.name}” saknar pris.`); continue; }
    const account = accountOf[line.kind];
    rows.push({
      Description: line.name.replace(/\s+/g, " ").trim().slice(0, FORTNOX_DESCRIPTION_MAX),
      DeliveredQuantity: quantityText(ore.quantity),
      Price: ore.unit / 100,
      VAT: quote.vatPercent,
      ...(account ? { AccountNumber: Number(account) } : {}),
    });
  }
  if (issues.length) return { payload: null, issues };
  return {
    payload: { Invoice: {
      CustomerNumber: customerNumber.trim(),
      InvoiceDate: quote.date,
      ExternalInvoiceReference1: `${ACCOUNTING_DOCUMENT_WORD[quote.document ?? "quote"]} ${quote.label}`.slice(0, 80),
      Remarks: [quote.title, quote.projectName ? `Projekt: ${quote.projectName}` : ""].filter(Boolean).join("\n").slice(0, 1024),
      InvoiceRows: rows,
    } },
    issues: [],
  };
}
