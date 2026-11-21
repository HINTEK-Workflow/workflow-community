-- Servernycklar i appen (2026-10-09): the Stripe and Google keys entered under Produktadministration →
-- Servernycklar, each sealed with the installation's secret; empty = the server's environment as before. Additive.
ALTER TABLE "SystemSettings" ADD COLUMN "serverKeys" JSONB NOT NULL DEFAULT '{}';
