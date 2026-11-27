import { customerTitle } from "@/lib/kfid/customer-name";
/**
 * Eget företag (2026-10-24: "Bygg likadant – kundföretag har ju också egna objekt, så det ska egentligen se likadant
 * ut"). The company's own places – the workshop, the store, a compressor, a vehicle – are one customer record marked
 * `ownCompany`, so they are the same place tree, page, action card and rules as a customer's. The record is kept apart from
 * the customers: it is never in the customer register or its search, it cannot be edited or removed as a customer, and its
 * places are changed by those who may edit the company. In a work order's customer choice it is "Eget företag", first.
 * Pure, so the pages, the server and the tests share it.
 */
export const OWN_COMPANY_LABEL = "Eget företag";
export const OWN_COMPANY_PLACES_TITLE = "Företagets platser";
export const OWN_COMPANY_REFUSAL = "Företagets egna platser ändras under Företaget, inte som en kund.";
export const OWN_COMPANY_PLACES_REFUSAL = "Bara den som får ändra företaget kan ändra företagets egna platser.";

type CustomerLike = { ownCompany?: boolean | null; name: string; company?: string | null };

export const isOwnCompany = (customer: { ownCompany?: boolean | null } | null | undefined) => customer?.ownCompany === true;

/** The name a customer choice shows: "Eget företag" for the company's own record, else the customer's name. */
export function customerChoiceName(customer: CustomerLike) {
  return isOwnCompany(customer) ? OWN_COMPANY_LABEL : customerTitle(customer);
}

/** The company's own record first, then the customers in the order given; the register itself never lists it. */
export function ownCompanyFirst<T extends { ownCompany?: boolean | null }>(customers: readonly T[]): T[] {
  return [...customers.filter((customer) => isOwnCompany(customer)), ...customers.filter((customer) => !isOwnCompany(customer))];
}

/** The customers of a register or list: the company's own record left out. */
export function withoutOwnCompany<T extends { ownCompany?: boolean | null }>(customers: readonly T[]): T[] {
  return customers.filter((customer) => !isOwnCompany(customer));
}

/** The address of the company's own places: the same page as a customer's places (the customer page of the own record). */
export const ownCompanyPlacesHref = (customerId: string) => `/?view=customers&customerId=${encodeURIComponent(customerId)}`;
