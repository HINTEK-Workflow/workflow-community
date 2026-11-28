-- Fler verksamheter (beslut 2026-11-27,"programmet får inte bli större, bara mer flexibelt"): two CHECK constraints get wider,
-- nothing else changes. Every value the running app writes today stays allowed, so the old app keeps working beside the new one.
-- 1. Formulärkategorier: VA och värme, Tillsyn och besiktning, Miljö (lib/workflow/form-publish.ts FORM_CATEGORIES).
-- 2. Avvikelsetyper (lib/self-inspection/incidents.ts): the neutral built-in types Driftfel, Säkerhet och arbetsmiljö, Kvalitet,
--    Miljö and Övrigt, and the company's own types stored as 'OWN:<namn>' (at most 60 characters of name).
-- Its own transaction: Prisma runs a file statement by statement (tests/migration-interrupted.integration.ts).
BEGIN;

ALTER TABLE "FormTemplate" DROP CONSTRAINT "FormTemplate_category_check";
ALTER TABLE "FormTemplate" ADD CONSTRAINT "FormTemplate_category_check" CHECK ("category" IN ('ELECTRICAL', 'POWER', 'INDUSTRY', 'ROUNDS', 'UTILITIES', 'SUPERVISION', 'ENVIRONMENT', 'PROPERTY', 'SAFETY', 'OTHER', 'INSPECTION', 'SERVICE', 'SELF_CHECK'));

ALTER TABLE "SelfInspectionDeviation" DROP CONSTRAINT "SelfInspectionDeviation_type_check";
ALTER TABLE "SelfInspectionDeviation" ADD CONSTRAINT "SelfInspectionDeviation_type_check"
  CHECK ("type" IN ('SELF_INSPECTION', 'RISK_OBSERVATION', 'NEAR_MISS', 'ACCIDENT', 'OPERATING_FAULT', 'SAFETY', 'QUALITY', 'ENVIRONMENT', 'OTHER')
    OR ("type" LIKE 'OWN:%' AND char_length("type") BETWEEN 5 AND 64));

COMMIT;
