import { prisma } from "@/lib/db";
import { ApiError } from "@/lib/kfid/server";
import { facilityLabel, facilityLinkError, PLACE_MAX_DEPTH, placeSummary } from "@/lib/workflow/customer-facility";

/**
 * Checks a link from a project, task or control to a customer facility: same organization, same customer, and not
 * paused unless the link already existed. The database trigger additionally enforces the organization.
 */
export async function assertFacilityLink(organizationId: string, input: { facilityId: string | null | undefined; customerId: string | null | undefined; previousFacilityId?: string | null }) {
  if (!input.facilityId) return;
  const facility = await prisma.customerFacility.findFirst({ where: { id: input.facilityId, organizationId }, select: { customerId: true, isActive: true } });
  const error = facilityLinkError(facility, { customerId: input.customerId, previousFacilityId: input.previousFacilityId, facilityId: input.facilityId });
  if (error) throw new ApiError(400, error);
}

/** Read-only facility summary sent with projects and tasks. */
export const facilitySummarySelect = { id: true, name: true, address: true, postalCode: true, city: true } as const;
const placeSelect = { id: true, parentId: true, customerId: true, name: true, address: true, postalCode: true, city: true, latitude: true, longitude: true } as const;

/**
 * A place for a report or a list (Platser, 2026-10-04): the whole way as the name and the address inherited from the
 * facility above, read one level at a time (a tree is at most a dozen levels deep).
 */
export async function loadPlaceSummary(organizationId: string, facilityId: string | null | undefined) {
  if (!facilityId) return null;
  const chain: { id: string; parentId: string | null; name: string; address: string; postalCode: string; city: string; latitude: number | null; longitude: number | null }[] = [];
  let next: string | null = facilityId;
  while (next && chain.length < PLACE_MAX_DEPTH && !chain.some((place) => place.id === next)) {
    const row: (typeof chain)[number] | null = await prisma.customerFacility.findFirst({ where: { id: next, organizationId }, select: placeSelect });
    if (!row) break;
    chain.push(row);
    next = row.parentId;
  }
  return placeSummary(chain, facilityId);
}

/** Many places at once (a list of rounds or projects): every place of the customers they belong to, read once. */
export async function loadPlaceSummaries(organizationId: string, facilityIds: (string | null | undefined)[]) {
  const ids = [...new Set(facilityIds.filter((id): id is string => Boolean(id)))];
  const result = new Map<string, NonNullable<ReturnType<typeof placeSummary>>>();
  if (!ids.length) return result;
  const owners = await prisma.customerFacility.findMany({ where: { id: { in: ids }, organizationId }, select: { customerId: true } });
  const places = await prisma.customerFacility.findMany({ where: { organizationId, customerId: { in: [...new Set(owners.map((row) => row.customerId))] } }, select: placeSelect });
  for (const id of ids) { const summary = placeSummary(places, id); if (summary) result.set(id, summary); }
  return result;
}

/**
 * Plats as the source (approved 2026-10-07): the text that names the installation – the project's "Arbetsplats / anläggning"
 * and a protocol's field filled from the facility – is the chosen place's whole way with the facility's address, the same
 * text the editors fill in. The server fills it when a place is linked through the API too, so reports show it: when the
 * text is empty, or when the link is new or points to another place than before. Text already there is otherwise kept.
 */
export async function placeSourceText(organizationId: string, input: { facilityId: string | null | undefined; previousFacilityId?: string | null; current: string }, maxLength = 300) {
  if (!input.facilityId) return null;
  if (input.current.trim() && input.previousFacilityId === input.facilityId) return null;
  const summary = await loadPlaceSummary(organizationId, input.facilityId);
  return summary ? facilityLabel(summary).slice(0, maxLength) : null;
}
