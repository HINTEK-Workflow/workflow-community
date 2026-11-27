-- A password change or reset ends every session started before it.
ALTER TABLE "User" ADD COLUMN "passwordChangedAt" TIMESTAMP(3);
