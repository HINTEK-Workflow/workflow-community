ALTER TABLE "CreditWallet"
  ADD COLUMN "purchasedBalance" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "expiryEnabled" BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN "expiryOverrideAt" TIMESTAMP(3);

CREATE TABLE "CreditLot" (
  "id" TEXT NOT NULL,
  "walletId" TEXT NOT NULL,
  "purchaseId" TEXT NOT NULL,
  "credits" INTEGER NOT NULL,
  "remaining" INTEGER NOT NULL,
  "expiresAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "CreditLot_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "CreditLot_credits_positive" CHECK ("credits" > 0),
  CONSTRAINT "CreditLot_remaining_range" CHECK ("remaining" >= 0 AND "remaining" <= "credits")
);

CREATE UNIQUE INDEX "CreditLot_purchaseId_key" ON "CreditLot"("purchaseId");
CREATE INDEX "CreditLot_walletId_expiresAt_idx" ON "CreditLot"("walletId", "expiresAt");

ALTER TABLE "CreditLot" ADD CONSTRAINT "CreditLot_walletId_fkey"
  FOREIGN KEY ("walletId") REFERENCES "CreditWallet"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "CreditLot" ADD CONSTRAINT "CreditLot_purchaseId_fkey"
  FOREIGN KEY ("purchaseId") REFERENCES "CreditPurchase"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
