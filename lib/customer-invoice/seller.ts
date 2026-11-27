import { companySenderOf } from "@/lib/kfid/company";
import type { InvoiceSeller, InvoiceSettings } from "./model";

/**
 * The seller's details from the company's data, in one place: Företagsuppgifter (säte, bankgiro and plusgiro too, lib/kfid/company.ts);
 * IBAN, BIC and selling without VAT are the invoicing setting's own.
 */

export function invoiceSellerOf(company: string, profile: unknown, settings: Pick<InvoiceSettings, "iban" | "bic" | "vatExempt">): InvoiceSeller {
  const sender = companySenderOf(profile);
  return {
    name: company.trim(), organizationNumber: sender?.organizationNumber ?? "", vatNumber: settings.vatExempt ? "" : sender?.vatNumber ?? "", fSkatt: sender?.fSkatt ?? false,
    address: sender?.address ?? "", phone: sender?.phone ?? "", email: sender?.email ?? "", registeredOffice: sender?.registeredOffice ?? "",
    bankgiro: sender?.bankgiro ?? "", plusgiro: sender?.plusgiro ?? "", iban: settings.iban.trim(), bic: settings.bic.trim(), vatExempt: settings.vatExempt,
  };
}
