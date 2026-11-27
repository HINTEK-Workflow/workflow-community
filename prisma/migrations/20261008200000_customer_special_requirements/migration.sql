-- Särskilda krav (2026-10-07): a customer's special requirements are a field on the customer card, not a tab in
-- Egenkontroll. Additive and safe to run again: the column is added, the text written under Egenkontroll → Kundkrav is
-- copied into it where the field is still empty, and the old rows stay (nothing is deleted).

ALTER TABLE "Customer" ADD COLUMN IF NOT EXISTS "specialRequirements" TEXT NOT NULL DEFAULT '';

UPDATE "Customer" AS c
SET "specialRequirements" = r."requirements"
FROM "SelfInspectionCustomerRequirement" AS r
WHERE r."customerId" = c."id"
  AND r."organizationId" = c."organizationId"
  AND c."specialRequirements" = ''
  AND btrim(r."requirements") <> '';
