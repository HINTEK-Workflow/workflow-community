import { prisma } from "@/lib/db";
import { ApiError } from "@/lib/kfid/errors";
import { companyGoalsOf, companyGoalsSchema, type CompanyGoals } from "./company-goals";

/** The company's goals (lib/workflow/company-goals.ts); a company without a settings row has none. */
export async function readCompanyGoals(organizationId: string): Promise<CompanyGoals> {
  const row = await prisma.workspaceSettings.findUnique({ where: { organizationId }, select: { goalSettings: true } });
  return companyGoalsOf(row?.goalSettings);
}

/** Only the company's admin changes the goals (Inställningar → Arbetssätt → Mål, 2026-10-28). */
export async function writeCompanyGoals(caller: { organizationId: string; admin: boolean }, input: unknown): Promise<CompanyGoals> {
  if (!caller.admin) throw new ApiError(403, "Företagsadministratör krävs.");
  const goals = companyGoalsSchema.parse(input);
  await prisma.workspaceSettings.upsert({
    where: { organizationId: caller.organizationId },
    create: { organizationId: caller.organizationId, goalSettings: goals },
    update: { goalSettings: goals },
  });
  return goals;
}
