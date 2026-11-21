import { customerNames } from "@/lib/kfid/customer-name";
/**
 * Kunden i offerten (2026-10-10): the quote's PDF and the customer's own page show the customer's name, contact
 * person and address – what the customer may see about itself. Never the notes, the special requirements, e-mail or
 * phone, which are the company's own working information. Read from the customer register when the quote is shown.
 */
export type QuoteCustomerDetails = { name: string; contactName: string; address: string };
type CustomerRecord = { name: string; company: string; customerType?: string | null; address?: string | null; postalCode?: string | null; city?: string | null };

const clean = (value: string | null | undefined, max: number) => (value ?? "").replace(/\s+/g, " ").trim().slice(0, max);

export function quoteCustomerDetails(customer: CustomerRecord | null | undefined): QuoteCustomerDetails {
  if (!customer) return { name: "", contactName: "", address: "" };
  const names = customerNames(customer);
  const town = [clean(customer.postalCode, 20), clean(customer.city, 120)].filter(Boolean).join(" ");
  return {
    // 2026-11-01, beslut 18: the company first and the contact person under it; a private customer keeps their name.
    name: clean(names.title, 200),
    contactName: clean(names.contact, 200),
    address: [clean(customer.address, 200), town].filter(Boolean).join(", "),
  };
}
