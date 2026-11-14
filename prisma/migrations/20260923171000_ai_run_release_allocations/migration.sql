CREATE TABLE "AiRunCreditRelease" (
  "id" TEXT NOT NULL,
  "runId" TEXT NOT NULL,
  "lotId" TEXT NOT NULL,
  "amount" INTEGER NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "AiRunCreditRelease_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "AiRunCreditRelease_amount_positive" CHECK ("amount" > 0)
);

CREATE UNIQUE INDEX "AiRunCreditRelease_runId_lotId_key"
ON "AiRunCreditRelease"("runId", "lotId");

CREATE INDEX "AiRunCreditRelease_lotId_idx"
ON "AiRunCreditRelease"("lotId");

ALTER TABLE "AiRunCreditRelease"
  ADD CONSTRAINT "AiRunCreditRelease_runId_fkey"
  FOREIGN KEY ("runId") REFERENCES "AiRun"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "AiRunCreditRelease"
  ADD CONSTRAINT "AiRunCreditRelease_lotId_fkey"
  FOREIGN KEY ("lotId") REFERENCES "CreditLot"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;
