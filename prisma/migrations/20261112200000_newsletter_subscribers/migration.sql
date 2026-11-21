-- Följ nyhetsbrevet (2026-11-12): addresses from the landing page with double opt-in, and a post (Inlägg) that is also
-- sent as a newsletter. Additive: one new table and nullable or defaulted columns; the old app never reads them.
BEGIN;

-- CreateTable
CREATE TABLE "NewsletterSubscriber" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "tokenHash" TEXT,
    "tokenExpiresAt" TIMESTAMP(3),
    "confirmationSentAt" TIMESTAMP(3),
    "confirmedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "NewsletterSubscriber_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "NewsletterSubscriber_email_key" ON "NewsletterSubscriber"("email");
CREATE UNIQUE INDEX "NewsletterSubscriber_tokenHash_key" ON "NewsletterSubscriber"("tokenHash");
CREATE INDEX "NewsletterSubscriber_status_tokenExpiresAt_idx" ON "NewsletterSubscriber"("status", "tokenExpiresAt");

-- AlterTable
ALTER TABLE "MailingRecipient" ADD COLUMN "subscriberId" TEXT;
ALTER TABLE "Mailing" ADD COLUMN "socialPostId" TEXT;
CREATE UNIQUE INDEX "Mailing_socialPostId_key" ON "Mailing"("socialPostId");
ALTER TABLE "SocialPost" ADD COLUMN "toNewsletter" BOOLEAN NOT NULL DEFAULT false;

COMMIT;
