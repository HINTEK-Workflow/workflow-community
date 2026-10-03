-- Utskick: newsletters and important information, sent from a queue.
CREATE TYPE "MailingAudience" AS ENUM ('NEWSLETTER', 'ADMINS');
CREATE TYPE "MailingStatus" AS ENUM ('QUEUED', 'SENT');
CREATE TYPE "MailingRecipientStatus" AS ENUM ('PENDING', 'SENT', 'FAILED', 'SKIPPED');

CREATE TABLE "Mailing" (
    "id" TEXT NOT NULL,
    "subject" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "audience" "MailingAudience" NOT NULL,
    "status" "MailingStatus" NOT NULL DEFAULT 'QUEUED',
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finishedAt" TIMESTAMP(3),
    CONSTRAINT "Mailing_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "MailingRecipient" (
    "id" TEXT NOT NULL,
    "mailingId" TEXT NOT NULL,
    "userId" TEXT,
    "email" TEXT NOT NULL,
    "status" "MailingRecipientStatus" NOT NULL DEFAULT 'PENDING',
    "sentAt" TIMESTAMP(3),
    CONSTRAINT "MailingRecipient_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "Mailing_createdAt_idx" ON "Mailing"("createdAt");
CREATE UNIQUE INDEX "MailingRecipient_mailingId_email_key" ON "MailingRecipient"("mailingId", "email");
CREATE INDEX "MailingRecipient_status_mailingId_idx" ON "MailingRecipient"("status", "mailingId");
ALTER TABLE "MailingRecipient" ADD CONSTRAINT "MailingRecipient_mailingId_fkey" FOREIGN KEY ("mailingId") REFERENCES "Mailing"("id") ON DELETE CASCADE ON UPDATE CASCADE;
