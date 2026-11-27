/**
 * Vem som betalar (2026-11-27, 6b punkt 5): a run is never shown or logged as "free". The person sees who pays for it –
 * Ingår (within the subscription, or the installation's own key in Community), Krediter (drawn from the company's credits) or
 * Företagets nyckel (the company's own AI key; the company pays its provider directly, and the run counts against neither Workflow's
 * weekly quota nor its budget). Derived from what every run already stores, so no field of the AI log changes meaning: a run on the
 * company's own key has a pricing version that starts with COMPANY_KEY_PRICING_PREFIX (lib/ai/company-key.ts), a run that reserved
 * credits is Krediter, and every other run is Ingår.
 */
export const AI_PAYERS = ["included", "credits", "company"] as const;
export type AiPayer = (typeof AI_PAYERS)[number];

export const AI_PAYER_LABEL: Record<AiPayer, string> = { included: "Ingår", credits: "Krediter", company: "Företagets nyckel" };

/** The start of a run's pricing version when it was made with the company's own AI key. */
export const COMPANY_KEY_PRICING_PREFIX = "foretagets-nyckel-";

export const isCompanyKeyPricing = (pricingVersion: string | null | undefined) => Boolean(pricingVersion?.startsWith(COMPANY_KEY_PRICING_PREFIX));

/** Who pays for a run, from what the AI log stores about it. */
export function aiRunPayer(run: { pricingVersion: string; reservedCredits: number }): AiPayer {
  if (isCompanyKeyPricing(run.pricingVersion)) return "company";
  return run.reservedCredits > 0 ? "credits" : "included";
}

/** Who pays for a run about to be reserved: its policy's pricing version and whether it is charged in credits. */
export function payerOf(input: { pricingVersion: string; free: boolean }): AiPayer {
  if (isCompanyKeyPricing(input.pricingVersion)) return "company";
  return input.free ? "included" : "credits";
}

/** The short text beside a run: the label, with the credits drawn when they are what paid. */
export function aiPayerText(payer: AiPayer, chargedCredits = 0) {
  return payer === "credits" ? `${AI_PAYER_LABEL.credits}: ${chargedCredits}` : AI_PAYER_LABEL[payer];
}
