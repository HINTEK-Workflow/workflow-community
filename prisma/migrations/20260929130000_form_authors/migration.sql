-- Who made a form (2026-09-28, the control library): HINTEK, the company itself, or – later – a community author named
-- with a web address and a licence. Additive: new columns with defaults on the form (published versions are immutable
-- and keep their publisher); HINTEK's forms are marked HINTEK.
ALTER TABLE "FormTemplate" ADD COLUMN "origin" TEXT NOT NULL DEFAULT 'COMPANY';
ALTER TABLE "FormTemplate" ADD COLUMN "authorName" TEXT NOT NULL DEFAULT '';
ALTER TABLE "FormTemplate" ADD COLUMN "authorUrl" TEXT NOT NULL DEFAULT '';
ALTER TABLE "FormTemplate" ADD COLUMN "license" TEXT NOT NULL DEFAULT '';
UPDATE "FormTemplate" SET "origin" = 'HINTEK', "authorName" = 'HINTEK' WHERE "organizationId" IS NULL;

-- The control library's categories (2026-09-28): Elinstallation, Elkraft, Industri, Underhåll och driftronder,
-- Fastigheter, Arbetsmiljö och säkerhet and Övrigt. The earlier values stay allowed; they are read as the nearest new one.
ALTER TABLE "FormTemplate" DROP CONSTRAINT "FormTemplate_category_check";
ALTER TABLE "FormTemplate" ADD CONSTRAINT "FormTemplate_category_check" CHECK ("category" IN ('ELECTRICAL', 'POWER', 'INDUSTRY', 'ROUNDS', 'PROPERTY', 'SAFETY', 'OTHER', 'INSPECTION', 'SERVICE', 'SELF_CHECK'));
