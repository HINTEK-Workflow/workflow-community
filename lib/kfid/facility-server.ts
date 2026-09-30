import { prisma } from "@/lib/db";
import { ApiError } from "@/lib/kfid/server";
import { facilityLinkError } from "@/lib/workflow/customer-facility";

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
