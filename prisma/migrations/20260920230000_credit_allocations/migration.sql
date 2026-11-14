ALTER TABLE "CreditWallet" ADD CONSTRAINT "CreditWallet_purchasedBalance_range"
  CHECK ("purchasedBalance" >= 0 AND "purchasedBalance" <= 1000);

CREATE TABLE "CreditAllocation" (
  "id" TEXT NOT NULL,
  "lotId" TEXT NOT NULL,
  "entryId" TEXT NOT NULL,
  "amount" INTEGER NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "CreditAllocation_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "CreditAllocation_amount_positive" CHECK ("amount" > 0)
);

CREATE UNIQUE INDEX "CreditAllocation_lotId_entryId_key"
  ON "CreditAllocation"("lotId", "entryId");
CREATE INDEX "CreditAllocation_entryId_idx" ON "CreditAllocation"("entryId");

ALTER TABLE "CreditAllocation" ADD CONSTRAINT "CreditAllocation_lotId_fkey"
  FOREIGN KEY ("lotId") REFERENCES "CreditLot"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "CreditAllocation" ADD CONSTRAINT "CreditAllocation_entryId_fkey"
  FOREIGN KEY ("entryId") REFERENCES "CreditEntry"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
