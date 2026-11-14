-- Tenant relations, security hardening step 1 (2026-10-08).
--
-- 1. Checks existing rows first. A row that already points into another organization stops the migration with a clear
--    message and the counts – nothing is deleted or rewritten here; such rows must be investigated by a person.
-- 2. Composite foreign keys [x, organizationId] -> [id, organizationId] where the delete rule allows it:
--    CustomerFacility.customer (CASCADE), CustomerFacility.parent (NO ACTION), RoundReminderDelivery.schedule (CASCADE),
--    FormLimitProfile.facility (CASCADE).
-- 3. Triggers for the FormSchedule links a composite key cannot express: customer and place keep SET NULL on the id
--    only (organizationId is required), templateId may name one of HINTEK's global forms, and a project or membership
--    removed later must not block that removal. The triggers check only when the link itself changes, so existing rows
--    and the SET NULL cascades are never tripped. OAuth codes and grants are bound to a membership the same way.
-- Prisma does not manage triggers, so they are not schema drift (same convention as 20260925180000_tenant_hardening).

-- ---------- 1. Pre-check ----------
DO $$
DECLARE
  facility_customer INT;
  facility_parent INT;
  limit_facility INT;
  delivery_schedule INT;
  schedule_customer INT;
  schedule_facility INT;
  schedule_project INT;
  schedule_template INT;
  code_grant INT;
  schedule_assignee INT;
  oauth_code_member INT;
  oauth_grant_member INT;
BEGIN
  SELECT count(*) INTO facility_customer FROM "CustomerFacility" f JOIN "Customer" c ON c."id" = f."customerId" WHERE c."organizationId" <> f."organizationId";
  SELECT count(*) INTO facility_parent FROM "CustomerFacility" f JOIN "CustomerFacility" p ON p."id" = f."parentId" WHERE p."organizationId" <> f."organizationId";
  SELECT count(*) INTO limit_facility FROM "FormLimitProfile" l JOIN "CustomerFacility" f ON f."id" = l."facilityId" WHERE f."organizationId" <> l."organizationId";
  SELECT count(*) INTO delivery_schedule FROM "RoundReminderDelivery" d JOIN "FormSchedule" s ON s."id" = d."scheduleId" WHERE s."organizationId" <> d."organizationId";
  SELECT count(*) INTO schedule_customer FROM "FormSchedule" s JOIN "Customer" c ON c."id" = s."customerId" WHERE c."organizationId" <> s."organizationId";
  SELECT count(*) INTO schedule_facility FROM "FormSchedule" s JOIN "CustomerFacility" f ON f."id" = s."facilityId" WHERE f."organizationId" <> s."organizationId";
  SELECT count(*) INTO schedule_project FROM "FormSchedule" s JOIN "Project" p ON p."id" = s."projectId" WHERE p."organizationId" <> s."organizationId";
  SELECT count(*) INTO schedule_template FROM "FormSchedule" s JOIN "FormTemplate" t ON t."id" = s."templateId" WHERE t."organizationId" IS NOT NULL AND t."organizationId" <> s."organizationId";
  SELECT count(*) INTO code_grant FROM "OAuthAuthorizationCode" c JOIN "OAuthGrant" g ON g."id" = c."grantId"
    WHERE g."organizationId" <> c."organizationId" OR g."userId" <> c."userId" OR g."clientId" <> c."clientId";

  IF facility_customer + facility_parent + limit_facility + delivery_schedule + schedule_customer + schedule_facility + schedule_project + schedule_template + code_grant > 0 THEN
    RAISE EXCEPTION 'Tenant relations: rows point into another organization – nothing was changed. CustomerFacility.customer=%, CustomerFacility.parent=%, FormLimitProfile.facility=%, RoundReminderDelivery.schedule=%, FormSchedule.customer=%, FormSchedule.facility=%, FormSchedule.project=%, FormSchedule.template=%, OAuthAuthorizationCode.grant=%. Investigate these rows by hand (see docs/proposals/security-hardening-local-2026-10-08.md).',
      facility_customer, facility_parent, limit_facility, delivery_schedule, schedule_customer, schedule_facility, schedule_project, schedule_template, code_grant
      USING ERRCODE = '23503';
  END IF;

  -- Not a cross-tenant link by itself (a person may have left the company since): reported, never a stop.
  SELECT count(*) INTO schedule_assignee FROM "FormSchedule" s WHERE s."assignedToUserId" IS NOT NULL
    AND NOT EXISTS (SELECT 1 FROM "OrganizationMember" m WHERE m."organizationId" = s."organizationId" AND m."userId" = s."assignedToUserId");
  SELECT count(*) INTO oauth_code_member FROM "OAuthAuthorizationCode" c
    WHERE NOT EXISTS (SELECT 1 FROM "OrganizationMember" m WHERE m."organizationId" = c."organizationId" AND m."userId" = c."userId");
  SELECT count(*) INTO oauth_grant_member FROM "OAuthGrant" g
    WHERE NOT EXISTS (SELECT 1 FROM "OrganizationMember" m WHERE m."organizationId" = g."organizationId" AND m."userId" = g."userId");
  IF schedule_assignee + oauth_code_member + oauth_grant_member > 0 THEN
    RAISE NOTICE 'Tenant relations: rows whose person is no longer a member (kept as they are): FormSchedule.assignedToUserId=%, OAuthAuthorizationCode=%, OAuthGrant=%.',
      schedule_assignee, oauth_code_member, oauth_grant_member;
  END IF;
END $$;

-- ---------- 2. Composite foreign keys ----------
CREATE UNIQUE INDEX "Customer_id_organizationId_key" ON "Customer"("id", "organizationId");
CREATE UNIQUE INDEX "FormSchedule_id_organizationId_key" ON "FormSchedule"("id", "organizationId");

ALTER TABLE "CustomerFacility" DROP CONSTRAINT "CustomerFacility_customerId_fkey";
ALTER TABLE "CustomerFacility" ADD CONSTRAINT "CustomerFacility_customerId_organizationId_fkey"
  FOREIGN KEY ("customerId", "organizationId") REFERENCES "Customer"("id", "organizationId") ON DELETE CASCADE ON UPDATE CASCADE;

-- NO ACTION (checked at the end of the statement), as before, so deleting a customer or a company removes its whole tree.
ALTER TABLE "CustomerFacility" DROP CONSTRAINT "CustomerFacility_parentId_fkey";
ALTER TABLE "CustomerFacility" ADD CONSTRAINT "CustomerFacility_parentId_organizationId_fkey"
  FOREIGN KEY ("parentId", "organizationId") REFERENCES "CustomerFacility"("id", "organizationId") ON DELETE NO ACTION ON UPDATE CASCADE;

ALTER TABLE "FormLimitProfile" DROP CONSTRAINT "FormLimitProfile_facilityId_fkey";
ALTER TABLE "FormLimitProfile" ADD CONSTRAINT "FormLimitProfile_facilityId_organizationId_fkey"
  FOREIGN KEY ("facilityId", "organizationId") REFERENCES "CustomerFacility"("id", "organizationId") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "RoundReminderDelivery" DROP CONSTRAINT "RoundReminderDelivery_scheduleId_fkey";
ALTER TABLE "RoundReminderDelivery" ADD CONSTRAINT "RoundReminderDelivery_scheduleId_organizationId_fkey"
  FOREIGN KEY ("scheduleId", "organizationId") REFERENCES "FormSchedule"("id", "organizationId") ON DELETE CASCADE ON UPDATE CASCADE;

-- ---------- 3. Triggers ----------
-- Customer and place of a round: the same functions as for projects, tasks and controls.
CREATE TRIGGER "FormSchedule_customer_tenant" BEFORE INSERT OR UPDATE OF "customerId", "organizationId" ON "FormSchedule"
  FOR EACH ROW EXECUTE FUNCTION "workflow_assert_customer_tenant"();
CREATE TRIGGER "FormSchedule_facility_tenant" BEFORE INSERT OR UPDATE OF "facilityId", "organizationId" ON "FormSchedule"
  FOR EACH ROW EXECUTE FUNCTION "workflow_assert_facility_tenant"();

-- Project, form and responsible person of a round, checked when the link changes.
CREATE OR REPLACE FUNCTION "workflow_assert_form_schedule_tenant"() RETURNS trigger AS $$
DECLARE
  moved BOOLEAN := TG_OP = 'INSERT' OR NEW."organizationId" IS DISTINCT FROM OLD."organizationId";
BEGIN
  IF NEW."projectId" IS NOT NULL AND (moved OR NEW."projectId" IS DISTINCT FROM OLD."projectId") AND NOT EXISTS (
    SELECT 1 FROM "Project" WHERE "id" = NEW."projectId" AND "organizationId" = NEW."organizationId"
  ) THEN
    RAISE EXCEPTION 'Projektet tillhör inte samma organisation.' USING ERRCODE = '23503';
  END IF;
  -- A company's own form, or one of HINTEK's global forms (organizationId NULL).
  IF (moved OR NEW."templateId" IS DISTINCT FROM OLD."templateId") AND NOT EXISTS (
    SELECT 1 FROM "FormTemplate" WHERE "id" = NEW."templateId" AND ("organizationId" IS NULL OR "organizationId" = NEW."organizationId")
  ) THEN
    RAISE EXCEPTION 'Formuläret tillhör inte samma organisation.' USING ERRCODE = '23503';
  END IF;
  IF NEW."assignedToUserId" IS NOT NULL AND (moved OR NEW."assignedToUserId" IS DISTINCT FROM OLD."assignedToUserId") AND NOT EXISTS (
    SELECT 1 FROM "OrganizationMember" WHERE "organizationId" = NEW."organizationId" AND "userId" = NEW."assignedToUserId"
  ) THEN
    RAISE EXCEPTION 'Den ansvariga är inte medlem i organisationen.' USING ERRCODE = '23503';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "FormSchedule_links_tenant" BEFORE INSERT OR UPDATE OF "projectId", "templateId", "assignedToUserId", "organizationId" ON "FormSchedule"
  FOR EACH ROW EXECUTE FUNCTION "workflow_assert_form_schedule_tenant"();

-- OAuth: a code and a grant are for a member of the company they name, and a code's grant is the one it made
-- (same app, company and person). OAuthClient stays global (apps register themselves, RFC 7591).
CREATE OR REPLACE FUNCTION "workflow_assert_oauth_member"() RETURNS trigger AS $$
BEGIN
  IF (TG_OP = 'INSERT' OR NEW."organizationId" IS DISTINCT FROM OLD."organizationId" OR NEW."userId" IS DISTINCT FROM OLD."userId") AND NOT EXISTS (
    SELECT 1 FROM "OrganizationMember" WHERE "organizationId" = NEW."organizationId" AND "userId" = NEW."userId"
  ) THEN
    RAISE EXCEPTION 'Personen är inte medlem i organisationen.' USING ERRCODE = '23503';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "OAuthAuthorizationCode_member" BEFORE INSERT OR UPDATE OF "organizationId", "userId" ON "OAuthAuthorizationCode"
  FOR EACH ROW EXECUTE FUNCTION "workflow_assert_oauth_member"();
CREATE TRIGGER "OAuthGrant_member" BEFORE INSERT OR UPDATE OF "organizationId", "userId" ON "OAuthGrant"
  FOR EACH ROW EXECUTE FUNCTION "workflow_assert_oauth_member"();

CREATE OR REPLACE FUNCTION "workflow_assert_oauth_code_grant"() RETURNS trigger AS $$
BEGIN
  IF NEW."grantId" IS NOT NULL AND (TG_OP = 'INSERT' OR NEW."grantId" IS DISTINCT FROM OLD."grantId") AND NOT EXISTS (
    SELECT 1 FROM "OAuthGrant" WHERE "id" = NEW."grantId" AND "organizationId" = NEW."organizationId" AND "userId" = NEW."userId" AND "clientId" = NEW."clientId"
  ) THEN
    RAISE EXCEPTION 'Anslutningen hör inte till koden.' USING ERRCODE = '23503';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "OAuthAuthorizationCode_grant" BEFORE INSERT OR UPDATE OF "grantId" ON "OAuthAuthorizationCode"
  FOR EACH ROW EXECUTE FUNCTION "workflow_assert_oauth_code_grant"();
