import { prisma } from "@/lib/db";
import { ensureOwnCompany } from "@/lib/kfid/own-company-server";
import { CLOSED_TASK_STATUSES } from "./task-cancel";
import { applyModuleChanges, moduleChangeDetail, type ModuleChanges, type ModuleKey } from "./modules";

export type ModuleImpactRow = { label: string; count: number };

/**
 * What a module holds right now, for the question before it goes off ("12 öppna offerter, 3 aktiva ronder"). Counts of the company's
 * own rows and nothing else, for its admin. In Local the data is in the file, so these are zero and the dialog says so.
 */
export async function moduleImpact(organizationId: string, key: ModuleKey, now = new Date()): Promise<ModuleImpactRow[]> {
  const where = { organizationId };
  switch (key) {
    case "customers": return rows(["Kunder", prisma.customer.count({ where: { ...where, ownCompany: false, deletedAt: null } })]);
    case "projects": return rows(["Öppna projekt", prisma.project.count({ where: { ...where, archivedAt: null, closedAt: null } })]);
    case "planning": return rows(["Kommande bokningar", prisma.plannedActivity.count({ where: { ...where, deletedAt: null, status: { not: "CANCELED" }, endsAt: { gte: now } } })]);
    case "rounds": return rows(["Aktiva ronder", prisma.formSchedule.count({ where: { ...where, deletedAt: null, active: true } })]);
    case "upkeep": return rows(
      ["Maskinkällor", prisma.machineSource.count({ where })],
      ["Underhållsplaner", prisma.maintenancePlan.count({ where: { ...where, isActive: true } })],
      ["Öppna underhållsposter", prisma.maintenanceItem.count({ where: { ...where, status: "OPEN" } })],
      ["Arbetsordrar som väntar på sin dag", prisma.workflowTask.count({ where: { ...where, maintenancePlanId: { not: null }, maintenanceActivatedAt: null, status: { notIn: [...CLOSED_TASK_STATUSES] } } })],
    );
    case "time": return rows(
      ["Tid som går just nu", prisma.workflowTimeEntry.count({ where: { endedAt: null, OR: [{ task: { organizationId } }, { project: { organizationId } }] } })],
      ["Månader som väntar på godkännande", prisma.timePeriod.count({ where: { ...where, status: "SUBMITTED" } })],
    );
    case "quotes": return rows(["Öppna offerter", prisma.quote.count({ where: { ...where, supersededAt: null, status: { in: ["DRAFT", "SENT"] } } })]);
    case "invoicing": return rows(["Utkast till fakturaunderlag", prisma.invoiceBasis.count({ where: { ...where, status: "DRAFT" } })]);
    case "purchasing": return rows(["Inköp", prisma.purchase.count({ where })]);
    case "staff_register": return rows(["Rader i personalliggaren", prisma.staffRegisterEvent.count({ where })]);
    case "self_inspection": return rows(["Personer med kompetenskort", prisma.selfInspectionCompetenceCard.count({ where: { ...where, leftAt: null } })]);
    case "boards": return rows(
      ["Publicerade tavlor", prisma.board.count({ where: { ...where, deletedAt: null, publishedVersionId: { not: null } } })],
      ["Kopplade skärmar", prisma.screen.count({ where: { ...where, status: "active" } })],
      ["Aktiva delade länkar", prisma.boardAccess.count({ where: { ...where, kind: "link", revokedAt: null, OR: [{ expiresAt: null }, { expiresAt: { gt: now } }] } })],
    );
    case "web_posts": return rows(
      ["Schemalagda inlägg och sidor", prisma.scheduledPublish.count({ where: { ...where, status: { in: ["scheduled", "needs_approval"] } } })],
      ["Inlägg", prisma.socialPost.count({ where })],
      ["Filmer", prisma.youTubeVideo.count({ where })],
    );
    case "news": return rows(
      ["Publicerade nyheter", prisma.companyNewsPost.count({ where: { ...where, deletedAt: null, status: "published" } })],
      ["Utkast", prisma.companyNewsPost.count({ where: { ...where, deletedAt: null, status: "draft" } })],
    );
  }
}
async function rows(...parts: [string, Promise<number>][]): Promise<ModuleImpactRow[]> {
  const counts = await Promise.all(parts.map(([, count]) => count));
  return parts.map(([label], index) => ({ label, count: counts[index] }));
}

/**
 * One change of the company's modules, by its admin: locked per company, so two choices at once cannot undo each other, written with
 * its line in the administration history. When Kunder goes off the company's own record is made if it is missing, so its places can
 * be reached at once. The route has checked the session, the origin and the role. Returns the list in force.
 */
export async function saveModuleChanges(ctx: { organizationId: string; user: { id: string } }, changes: ModuleChanges) {
  const result = await prisma.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT id FROM "Organization" WHERE id=${ctx.organizationId} FOR UPDATE`;
    const organization = await tx.organization.findUniqueOrThrow({ where: { id: ctx.organizationId }, select: { disabledModules: true } });
    const change = applyModuleChanges(organization.disabledModules, changes);
    if (!change.turnedOff.length && !change.turnedOn.length) return change;
    await tx.organization.update({ where: { id: ctx.organizationId }, data: { disabledModules: change.disabled } });
    await tx.administrationEvent.create({ data: { actorId: ctx.user.id, organizationId: ctx.organizationId, action: "company_modules", detail: moduleChangeDetail(change) } });
    return change;
  });
  if (result.turnedOff.includes("customers")) await ensureOwnCompany(ctx.organizationId);
  return result;
}
