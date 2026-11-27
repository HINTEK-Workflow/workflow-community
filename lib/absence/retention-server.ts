import { prisma } from "@/lib/db";
import { absenceRetentionCutoff } from "./retention";

/**
 * Nightly (history:retention): removes each company's absence that ended longer ago than the company keeps it
 * (Organization.absenceRetentionMonths, 2026-10-30), and the absence history lines older than the same limit. Every
 * removal leaves one counted line in the company's administration history; counts only, never names. A dry run counts.
 */
export async function purgeExpiredAbsence(now = new Date(), options: { dryRun?: boolean } = {}) {
  // Only companies that have any absence or history: the oldest absence decides whether there is anything to look at.
  const [absenceCompanies, eventCompanies] = await Promise.all([
    prisma.absence.groupBy({ by: ["organizationId"], _min: { toDate: true } }),
    prisma.absenceEvent.groupBy({ by: ["organizationId"], _min: { createdAt: true } }),
  ]);
  const organizationIds = [...new Set([...absenceCompanies.map((item) => item.organizationId), ...eventCompanies.map((item) => item.organizationId)])];
  if (!organizationIds.length) return [];
  const companies = await prisma.organization.findMany({ where: { id: { in: organizationIds } }, select: { id: true, absenceRetentionMonths: true } });
  const results: { organizationId: string; absences: number; events: number }[] = [];
  for (const company of companies) {
    const cutoff = absenceRetentionCutoff(company.absenceRetentionMonths, now);
    const oldestAbsence = absenceCompanies.find((item) => item.organizationId === company.id)?._min.toDate;
    const oldestEvent = eventCompanies.find((item) => item.organizationId === company.id)?._min.createdAt;
    if (!(oldestAbsence && oldestAbsence < cutoff.day) && !(oldestEvent && oldestEvent < cutoff.instant)) continue;
    const absenceWhere = { organizationId: company.id, toDate: { lt: cutoff.day } };
    const eventWhere = { organizationId: company.id, createdAt: { lt: cutoff.instant } };
    if (options.dryRun) {
      const [absences, events] = await Promise.all([prisma.absence.count({ where: absenceWhere }), prisma.absenceEvent.count({ where: eventWhere })]);
      if (absences || events) results.push({ organizationId: company.id, absences, events });
      continue;
    }
    const result = await prisma.$transaction(async (tx) => {
      const absences = await tx.absence.deleteMany({ where: absenceWhere });
      const events = await tx.absenceEvent.deleteMany({ where: eventWhere });
      if (absences.count || events.count) await tx.administrationEvent.create({ data: { actorId: "system:absence-retention", organizationId: company.id, action: "absence_retention",
        detail: `Frånvaro rensades efter lagringstiden (${company.absenceRetentionMonths} mån): ${absences.count} ${absences.count === 1 ? "frånvaro" : "frånvaror"} som slutade före ${cutoff.day} och ${events.count} ${events.count === 1 ? "historikrad" : "historikrader"}.` } });
      return { absences: absences.count, events: events.count };
    }, { timeout: 120_000 });
    if (result.absences || result.events) results.push({ organizationId: company.id, ...result });
  }
  return results;
}
