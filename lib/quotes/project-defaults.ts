import type { QuoteCustomerType } from "./model";

/**
 * A project chosen on a quote fills in what the project already knows (2026-10-10: "skall inte projektets
 * parametrar fylla i de andra fälten"): its customer and place, and the heading and scope when they are still empty.
 * What the person has already written is never overwritten. A project without a customer keeps the quote's customer.
 *
 * Kundtyp från kunden (2026-10-10): when the quote gets a customer – chosen, filled in by the project, or given
 * when a new quote starts for a customer – it takes the customer's type (Företag / Privatperson). It can still be changed
 * on the quote as an exception, and the quote never writes it back to the customer. A company quote has no ROT.
 */
export type QuoteProjectFields = { customerId: string | null; facilityId: string | null; title: string; description: string };
export type QuoteProjectSource = { name: string; description?: string | null; customerId: string | null; facilityId?: string | null };
export type QuoteCustomerTypeFields = { customerType: QuoteCustomerType; rotEnabled: boolean };
/** A customer as the quote reads its type; an older record without one is a company. */
export type QuoteCustomerSource = { customerType?: QuoteCustomerType | null };

/** The quote's type and ROT once a customer is set: the customer's type, and no ROT for a company. */
export function quoteTypeFromCustomer(current: QuoteCustomerTypeFields, customer: QuoteCustomerSource | null | undefined): QuoteCustomerTypeFields {
  if (!customer) return { customerType: current.customerType, rotEnabled: current.rotEnabled };
  const customerType: QuoteCustomerType = customer.customerType === "PRIVATE" ? "PRIVATE" : "COMPANY";
  return { customerType, rotEnabled: customerType === "PRIVATE" ? current.rotEnabled : false };
}

export function quoteFieldsFromProject(current: QuoteProjectFields, project: QuoteProjectSource): QuoteProjectFields;
export function quoteFieldsFromProject(current: QuoteProjectFields & QuoteCustomerTypeFields, project: QuoteProjectSource, customerOf: (id: string) => QuoteCustomerSource | null | undefined): QuoteProjectFields & QuoteCustomerTypeFields;
export function quoteFieldsFromProject(current: QuoteProjectFields & Partial<QuoteCustomerTypeFields>, project: QuoteProjectSource, customerOf?: (id: string) => QuoteCustomerSource | null | undefined) {
  const customerId = project.customerId ?? current.customerId;
  const sameCustomer = customerId === current.customerId;
  const fields: QuoteProjectFields = {
    customerId,
    // The project's place; otherwise the chosen place stays only while the customer is the same.
    facilityId: project.facilityId ?? (sameCustomer ? current.facilityId : null),
    title: current.title.trim() ? current.title : project.name.trim().slice(0, 200),
    description: current.description.trim() ? current.description : (project.description ?? "").trim().slice(0, 5000),
  };
  if (!customerOf) return fields;
  const typed = { customerType: current.customerType ?? "COMPANY", rotEnabled: current.rotEnabled ?? false };
  // The type follows a new customer only; the same customer keeps what the quote says (an exception stays).
  return { ...fields, ...(customerId && !sameCustomer ? quoteTypeFromCustomer(typed, customerOf(customerId)) : typed) };
}
