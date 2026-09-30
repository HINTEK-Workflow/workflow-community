-- Round reminders (Daniel 2026-09-30): per round a bell notice (on by default) and an e-mail (chosen per round), and
-- one delivery row per round, day and recipient so an e-mail is never sent twice. Additive.
ALTER TABLE "FormSchedule" ADD COLUMN "reminders" JSONB NOT NULL DEFAULT '{}';

-- CreateTable
CREATE TABLE "RoundReminderDelivery" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "scheduleId" TEXT NOT NULL,
    "occurrence" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "failure" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RoundReminderDelivery_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "RoundReminderDelivery_scheduleId_occurrence_userId_key" ON "RoundReminderDelivery"("scheduleId", "occurrence", "userId");
CREATE INDEX "RoundReminderDelivery_organizationId_createdAt_idx" ON "RoundReminderDelivery"("organizationId", "createdAt");

-- AddForeignKey
ALTER TABLE "RoundReminderDelivery" ADD CONSTRAINT "RoundReminderDelivery_scheduleId_fkey" FOREIGN KEY ("scheduleId") REFERENCES "FormSchedule"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "RoundReminderDelivery" ADD CONSTRAINT "RoundReminderDelivery_status_check" CHECK ("status" IN ('SENT', 'FAILED'));
