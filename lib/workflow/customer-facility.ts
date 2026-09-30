import { z } from "zod";

/**
 * Customer facilities (Daniel 2026-09-26, decision 11/D9 B): a property, switchgear or other object under a customer.
 * Projects, work orders, risk assessments and controls may be linked to one. Shared by Cloud, Local and the demo.
 */
export const customerFacilityInputSchema = z.object({
  name: z.string().trim().min(1, "Ange anläggningens namn.").max(160),
  address: z.string().trim().max(200).default(""),
  postalCode: z.string().trim().max(20).default(""),
  city: z.string().trim().max(120).default(""),
  description: z.string().trim().max(2000).default(""),
});
export type CustomerFacilityInput = z.input<typeof customerFacilityInputSchema>;

export type FacilityItem = {
  id: string;
  customerId: string;
  name: string;
  address: string;
  postalCode: string;
  city: string;
  description: string;
  isActive: boolean;
};

/** "Ställverk 1, Strömgatan 1, 123 45 Elstad" – the name followed by the address, for lists, tasks and reports. */
export function facilityLabel(facility: Pick<FacilityItem, "name" | "address" | "postalCode" | "city">) {
  const place = [facility.postalCode, facility.city].filter(Boolean).join(" ");
  return [facility.name, facility.address, place].filter(Boolean).join(", ");
}

/**
 * A link to a facility must match the item's customer, and a paused facility cannot be newly linked. An existing
 * link to a facility that was paused later is kept. Returns an error message, or null when the link is allowed.
 */
export function facilityLinkError(facility: Pick<FacilityItem, "customerId" | "isActive"> | null | undefined, input: { customerId: string | null | undefined; previousFacilityId?: string | null; facilityId: string }) {
  if (!facility) return "Anläggningen hittades inte.";
  if (!input.customerId || facility.customerId !== input.customerId) return "Anläggningen tillhör en annan kund. Välj kundens anläggning eller ingen.";
  if (!facility.isActive && input.previousFacilityId !== input.facilityId) return "Anläggningen är pausad och kan inte väljas.";
  return null;
}
