-- "Tillåt nya konton": self-registration and sign-in for everyone with an account (off = invitations and the pilot list only).
ALTER TABLE "SystemSettings" ADD COLUMN "registrationOpen" BOOLEAN NOT NULL DEFAULT false;
-- Företagsuppslag: the sealed SCB key for looking up a company by organisation number.
ALTER TABLE "SystemSettings" ADD COLUMN "companyLookup" JSONB NOT NULL DEFAULT '{}';
