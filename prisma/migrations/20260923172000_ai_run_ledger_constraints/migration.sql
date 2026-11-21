ALTER TABLE "AiRun"
  ADD CONSTRAINT "AiRun_pricing_ranges" CHECK (
    "usdSekRateMicros" > 0 AND
    "inputPriceUsdMicrosPerMillion" > 0 AND
    "cachedInputPriceUsdMicrosPerMillion" > 0 AND
    "cachedInputPriceUsdMicrosPerMillion" <= "inputPriceUsdMicrosPerMillion" AND
    "outputPriceUsdMicrosPerMillion" > 0 AND
    "targetGrossMarginBps" >= 0 AND "targetGrossMarginBps" < 10000 AND
    "creditFloorValueOre" > 0 AND "minimumCredits" > 0
  );

ALTER TABLE "AiRun"
  ADD CONSTRAINT "AiRun_token_ranges" CHECK (
    "estimatedInputTokens" > 0 AND
    "inputTokenLimit" >= "estimatedInputTokens" AND
    "maxOutputTokens" > 0 AND
    ("inputTokens" IS NULL OR "inputTokens" >= 0) AND
    ("cachedInputTokens" IS NULL OR "cachedInputTokens" >= 0) AND
    ("outputTokens" IS NULL OR "outputTokens" >= 0) AND
    ("cachedInputTokens" IS NULL OR "inputTokens" IS NULL OR "cachedInputTokens" <= "inputTokens")
  );

ALTER TABLE "AiRun"
  ADD CONSTRAINT "AiRun_credit_ranges" CHECK (
    "reservedCredits" > 0 AND
    ("chargedCredits" IS NULL OR ("chargedCredits" >= 0 AND "chargedCredits" <= "reservedCredits")) AND
    ("releasedCredits" IS NULL OR ("releasedCredits" >= 0 AND "releasedCredits" <= "reservedCredits")) AND
    ("providerCostUsdMicros" IS NULL OR "providerCostUsdMicros" >= 0) AND
    ("providerCostOre" IS NULL OR "providerCostOre" >= 0)
  );

ALTER TABLE "AiRun"
  ADD CONSTRAINT "AiRun_terminal_state" CHECK (
    (
      "status" IN ('RESERVED', 'RUNNING') AND
      "completedAt" IS NULL AND "failedAt" IS NULL AND
      "providerResponseId" IS NULL AND "failureCode" IS NULL AND
      "chargedCredits" IS NULL AND "releasedCredits" IS NULL
    ) OR (
      "status" = 'COMPLETED' AND
      "completedAt" IS NOT NULL AND "providerResponseId" IS NOT NULL AND
      "inputTokens" IS NOT NULL AND "cachedInputTokens" IS NOT NULL AND "outputTokens" IS NOT NULL AND
      "providerCostUsdMicros" IS NOT NULL AND "providerCostOre" IS NOT NULL AND
      "chargedCredits" IS NOT NULL AND "releasedCredits" IS NOT NULL AND
      "chargedCredits" + "releasedCredits" = "reservedCredits" AND
      "failureCode" IS NULL
    ) OR (
      "status" IN ('FAILED', 'CANCELED') AND
      "failedAt" IS NOT NULL AND "providerResponseId" IS NULL AND
      "chargedCredits" = 0 AND "releasedCredits" = "reservedCredits"
    )
  );
