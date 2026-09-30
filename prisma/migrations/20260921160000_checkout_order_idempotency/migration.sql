ALTER TYPE "LegalDocumentType" ADD VALUE 'CREDIT_TERMS';

ALTER TABLE "BillingOrder" ADD COLUMN "requestKey" TEXT;

UPDATE "BillingOrder"
SET "requestKey" = 'legacy:' || "id"
WHERE "requestKey" IS NULL;

ALTER TABLE "BillingOrder" ALTER COLUMN "requestKey" SET NOT NULL;

CREATE UNIQUE INDEX "BillingOrder_requestKey_key" ON "BillingOrder"("requestKey");
