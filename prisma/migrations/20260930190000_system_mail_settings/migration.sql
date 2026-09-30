-- E-post settings made in the app (2026-09-30): SMTP, sender and which mail is sent; additive, empty = the server's .env.
ALTER TABLE "SystemSettings" ADD COLUMN "mail" JSONB NOT NULL DEFAULT '{}';
