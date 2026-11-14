import { publicInstance } from "@/lib/instance";
import { hitRateLimit, RATE_RULES, type RateRule } from "@/lib/security/rate-limit";

/**
 * Kvot per företag för AI (2026-11-02). With credits (features.credits) every company pays for its own use, so nothing is
 * counted here. Without them (the Community edition) every company shares the installation's own key: this keeps one company
 * from using up the whole budget. Answers from the rules are free and not counted, as in lib/ai/rate-limit.ts.
 *
 * AI_COMPANY_CALLS_PER_HOUR sets the limit for an installation; 0 turns it off (for example with one company).
 */
export function aiCompanyRule(setting = process.env.AI_COMPANY_CALLS_PER_HOUR): RateRule | null {
  const raw = setting?.trim();
  if (!raw) return RATE_RULES.aiOrganization;
  const limit = Number(raw);
  if (!Number.isInteger(limit) || limit < 0) return RATE_RULES.aiOrganization;
  return limit === 0 ? null : { ...RATE_RULES.aiOrganization, limit };
}

/** Counts one AI call for the company; false when the hour's allowance is used up. */
export async function allowCompanyAiCall(organizationId: string): Promise<boolean> {
  if (publicInstance().features.credits) return true;
  const rule = aiCompanyRule();
  return rule ? (await hitRateLimit(rule, organizationId)).allowed : true;
}

export const AI_COMPANY_LIMIT_REASON = "Företaget har använt AI mycket den senaste timmen och gränsen är nådd. Försök igen om en stund, eller be den som driver installationen att höja gränsen.";
