-- Nyhetsutskick: when the person said yes to news about changes and improvements; null = no.
ALTER TABLE "User" ADD COLUMN "newsletterOptInAt" TIMESTAMP(3);
