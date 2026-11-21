-- Inloggning: whether "Fortsätt med Google" is offered and accepted.
ALTER TABLE "SystemSettings" ADD COLUMN "googleSignIn" BOOLEAN NOT NULL DEFAULT true;
