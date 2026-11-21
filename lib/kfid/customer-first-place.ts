import type { CustomerFacilityInput } from "@/lib/workflow/customer-facility";

/**
 * "Skapa en plats med samma adress" (2026-10-10): a new customer saved with an address may get its first place at
 * once – a facility (Anläggning) with the customer's address, named after the address (or the customer when only the
 * postal code and town are written). Offered only for a new customer, never when an existing one is edited, and the place
 * is saved through the ordinary place rules (Cloud's /api/customer-card, the Local file, the demo), so a duplicate is
 * refused there as everywhere else. Pure rules, shared by the customer forms and their tests.
 */
export type CustomerAddress = { name: string; company: string; address: string; postalCode: string; city: string };

/** Whether the form holds an address to copy: a street, a postal code or a town. */
export const customerHasAddress = (customer: Pick<CustomerAddress, "address" | "postalCode" | "city">) =>
  Boolean(customer.address.trim() || customer.postalCode.trim() || customer.city.trim());

/** The first place for a new customer, or null when there is no address to copy. */
export function firstPlaceOf(customer: CustomerAddress): CustomerFacilityInput | null {
  if (!customerHasAddress(customer)) return null;
  const address = customer.address.trim();
  const name = (address || customer.company.trim() || customer.name.trim()).slice(0, 160);
  if (!name) return null;
  return { name, kind: "FACILITY", parentId: null, address: address.slice(0, 200), postalCode: customer.postalCode.trim().slice(0, 20), city: customer.city.trim().slice(0, 120) };
}

/** The words beside the tick box, and what the person is told when the place could not be made. */
export const FIRST_PLACE_LABEL = "Skapa en plats med samma adress";
export const FIRST_PLACE_HELP = "Kunden får en anläggning med adressen, som kan väljas direkt i jobb och projekt.";
export const firstPlaceFailed = (reason: string) => `Kunden är sparad, men platsen kunde inte skapas: ${reason}`;
