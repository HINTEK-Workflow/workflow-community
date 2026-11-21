import { prisma } from "@/lib/db";
import { companyValueView } from "@/lib/kfid/company-values-server";
import type { CompanyValue } from "@/lib/workflow/company-values";
import { CALC_KEY_PREFIX } from "./company-data";

/**
 * The company's own values the Räkneverktyg read (2026-10-07): only the rows under the calculators' key
 * namespace, only the session's company – never another company's and never the form limits the page does not need.
 * The most there can be is the single values, three tables of two materials with thirty rows each, up to 120 protective devices and 40 cable types.
 */
export async function calculatorValues(organizationId: string): Promise<CompanyValue[]> {
  const rows = await prisma.companyReferenceValue.findMany({
    where: { organizationId, key: { startsWith: CALC_KEY_PREFIX } },
    orderBy: { key: "asc" },
    take: 600,
  });
  return rows.map(companyValueView);
}
