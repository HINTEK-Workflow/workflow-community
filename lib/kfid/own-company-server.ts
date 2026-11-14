import { prisma } from "@/lib/db";
import { ApiError } from "@/lib/kfid/errors";
import { OWN_COMPANY_PLACES_REFUSAL } from "@/lib/workflow/own-company";
import { moduleOffText, organizationModuleOn } from "@/lib/workflow/modules";

/**
 * The company's own customer record (Eget företag, 2026-10-24), made the first time the company opens its places and
 * named after the company (kept in step with the company's name). At most one per company: the database's partial unique
 * index decides when two requests race, and the loser reads the winner's record.
 */
export async function ensureOwnCompany(organizationId: string): Promise<{ id: string }> {
  const organization = await prisma.organization.findUnique({ where: { id: organizationId }, select: { name: true } });
  if (!organization) throw new ApiError(404, "Företaget hittades inte.");
  const existing = await prisma.customer.findFirst({ where: { organizationId, ownCompany: true }, select: { id: true, name: true, deletedAt: true } });
  if (existing) {
    if (existing.name !== organization.name || existing.deletedAt)
      await prisma.customer.updateMany({ where: { id: existing.id, organizationId }, data: { name: organization.name, company: organization.name, deletedAt: null } });
    return { id: existing.id };
  }
  try {
    return await prisma.customer.create({ data: { organizationId, ownCompany: true, name: organization.name, company: organization.name, customerType: "COMPANY" }, select: { id: true } });
  } catch (error) {
    const raced = await prisma.customer.findFirst({ where: { organizationId, ownCompany: true }, select: { id: true } });
    if (raced) return raced;
    throw error;
  }
}

/**
 * Företagets moduler (0.39.0): with Kunder off the register closes, but the company's own places stay, so an industrial company can
 * work with its own machines and sites. A customer that is not the company's own record is refused; nothing is read while Kunder is on.
 */
export async function requireCustomersOrOwn(ctx: { organizationId: string; organization: { disabledModules?: readonly string[] | null }; seesAll?: boolean }, customerId: string | null | undefined) {
  if (organizationModuleOn(ctx.organization, "customers") || ctx.seesAll) return;
  const own = customerId ? await prisma.customer.count({ where: { id: customerId, organizationId: ctx.organizationId, ownCompany: true } }) : 0;
  if (!own) throw new ApiError(409, moduleOffText("customers"));
}

/** The company's own record, if it has one yet. */
export async function findOwnCompany(organizationId: string): Promise<{ id: string } | null> {
  return prisma.customer.findFirst({ where: { organizationId, ownCompany: true }, select: { id: true } });
}

/**
 * The places of the company's own record are changed by those who may edit the company (its admin); a customer's places
 * follow the customers permission as before. The caller has already checked the customers permission.
 */
export async function requireOwnPlaceEdit(ctx: { organizationId: string; admin: boolean }, customerId: string | null | undefined) {
  if (!customerId || ctx.admin) return;
  const own = await prisma.customer.findFirst({ where: { id: customerId, organizationId: ctx.organizationId, ownCompany: true }, select: { id: true } });
  if (own) throw new ApiError(403, OWN_COMPANY_PLACES_REFUSAL);
}
