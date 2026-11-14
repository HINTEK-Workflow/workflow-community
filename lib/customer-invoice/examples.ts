import { pdfDocumentDef } from "@/lib/pdf-templates/catalog";
import { resolvePdfDocument, type PdfTemplateOverride } from "@/lib/pdf-templates/model";
import type { InvoiceBasisLine } from "@/lib/invoice-basis/model";
import { NO_INVOICE_TAX } from "@/lib/invoice-basis/model";
import { BLANK_INVOICE_SETTINGS, buildCredit, buildInvoice, freezeInvoiceTexts, invoiceDetailsSchema, ocrNumber, type InvoiceContent, type InvoiceSource } from "./model";

/**
 * Invented invoices for the template editor's preview and the tests: an invented company, buyer, numbers and identity number.
 * Never a customer's data.
 */
export const EXAMPLE_PERSONAL_NUMBER = "19121212-1212";
const SELLER = { name: "Exempel El AB", organizationNumber: "556000-0000", vatNumber: "SE556000000001", fSkatt: true, address: "Exempelgatan 1, 123 45 Exempelstad", registeredOffice: "Exempelstad", phone: "010-000 00 00", email: "info@example.invalid", bankgiro: "123-4567", plusgiro: "", iban: "", bic: "", vatExempt: false };
const LINES: InvoiceBasisLine[] = [
  { id: "l1", kind: "LABOUR", name: "Installation av laddbox", quantity: "6", unit: "h", unitPrice: "650", markupPercent: "", rotLabour: true, sources: [] },
  { id: "l2", kind: "MATERIAL", name: "Laddbox 11 kW", quantity: "1", unit: "st", unitPrice: "9800", markupPercent: "", articleNo: "EX-1001", sources: [] },
  { id: "l3", kind: "MATERIAL", name: "Kabel 5G6", quantity: "18", unit: "m", unitPrice: "42,50", markupPercent: "", sources: [] },
  { id: "l4", kind: "OTHER", name: "Resa till arbetsplatsen", quantity: "1", unit: "st", unitPrice: "450", markupPercent: "", sources: [] },
];

export function exampleInvoiceSource(variant: string, templates: readonly PdfTemplateOverride[] | null = null): InvoiceSource {
  const texts = freezeInvoiceTexts(resolvePdfDocument(pdfDocumentDef("invoice")!, templates));
  const rot = variant === "rot";
  const reverse = variant === "reverse";
  return {
    seller: SELLER, today: "2026-11-04", texts, common: freezeInvoiceTexts(resolvePdfDocument(pdfDocumentDef("common")!, templates)),
    buyer: rot ? { name: "Anna Exempel", contactName: "", address: "Exempelvägen 2, 123 45 Exempelstad", customerType: "PRIVATE" } : { name: "Exempel Bygg AB", contactName: "Bo Exempel", address: "Byggvägen 9, 123 45 Exempelstad", customerType: "COMPANY" },
    settings: { ...BLANK_INVOICE_SETTINGS, paymentDays: 30, useOcr: variant === "invoice" },
    basis: {
      label: "F-0042", title: rot ? "Laddbox i garage" : "Laddplats i bostadsfastighet", vatPercent: reverse ? 0 : 25, lines: rot ? LINES : LINES.map((line) => ({ ...line, rotLabour: false })),
      tax: rot ? { ...NO_INVOICE_TAX, rotEnabled: true, rotPercent: 30, rotCap: 50000 } : reverse ? { ...NO_INVOICE_TAX, reverseVat: true, buyerVatNumber: "SE559000000001" } : NO_INVOICE_TAX,
    },
  };
}

export const exampleInvoiceDetails = (variant: string) => invoiceDetailsSchema.parse({
  performedFrom: "2026-10-27", performedOn: "2026-10-30", paymentDays: "30",
  rot: variant === "rot" ? { personalNumber: EXAMPLE_PERSONAL_NUMBER, propertyDesignation: "Exempelstad Exemplet 1:23", workPlace: "Exempelvägen 2, 123 45 Exempelstad" } : {},
});

export function exampleInvoiceContent(variant: string, templates: readonly PdfTemplateOverride[] | null = null): InvoiceContent {
  const invoiceVariant = variant === "credit" ? "rot" : variant;
  const number = 1042;
  const built = buildInvoice(exampleInvoiceSource(invoiceVariant, templates), exampleInvoiceDetails(invoiceVariant), { number, label: String(number), ...(invoiceVariant === "invoice" ? { reference: ocrNumber(number) } : {}) });
  if (variant !== "credit") return built.content;
  const credit = freezeInvoiceTexts(resolvePdfDocument(pdfDocumentDef("credit_invoice")!, templates));
  return buildCredit(built.content, { id: "exempel", number: 1043, label: "1043", today: "2026-11-05", reason: "Fel antal timmar på raden för installation.", texts: credit, common: built.content.common });
}
