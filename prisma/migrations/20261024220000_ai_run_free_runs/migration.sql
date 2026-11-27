-- A run without credits (2026-10-24): the superadmin's trial of the EU provider, charged to no company, and a run in an
-- installation without HINTEK's credit system, are recorded with reservedCredits = 0 (nothing reserved, nothing charged, nothing
-- released). The range check allowed only > 0; it is widened to >= 0, nothing else changes. A paid run still reserves at least its
-- minimum (lib/ai/cost-policy.ts), and AiRun_terminal_state keeps charged + released = reserved.
ALTER TABLE "AiRun" DROP CONSTRAINT "AiRun_credit_ranges";
ALTER TABLE "AiRun"
  ADD CONSTRAINT "AiRun_credit_ranges" CHECK (
    "reservedCredits" >= 0 AND
    ("chargedCredits" IS NULL OR ("chargedCredits" >= 0 AND "chargedCredits" <= "reservedCredits")) AND
    ("releasedCredits" IS NULL OR ("releasedCredits" >= 0 AND "releasedCredits" <= "reservedCredits")) AND
    ("providerCostUsdMicros" IS NULL OR "providerCostUsdMicros" >= 0) AND
    ("providerCostOre" IS NULL OR "providerCostOre" >= 0)
  );
