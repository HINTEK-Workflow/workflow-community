-- Personalliggare, steg 1 (2026-10-09, docs/proposals/personalliggare-krav-2026-10-11.md): the company's own
-- electronic staff register for building sites. Additive: two new tables and an enum; nothing existing is changed.
-- Every link is a composite [x, organizationId] key, so a row can never point into another company. The register
-- (StaffRegisterEvent) is append-only, enforced by triggers below; Prisma does not manage triggers, so they are not
-- schema drift (same convention as 20260925180000_tenant_hardening and 20261009400000_article_catalogue).

-- CreateEnum
CREATE TYPE "StaffRegisterEventKind" AS ENUM ('IN', 'OUT', 'VOID');

-- CreateTable
CREATE TABLE "StaffRegisterPerson" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "userId" TEXT,
    "name" TEXT NOT NULL,
    "idNumberSealed" TEXT NOT NULL,
    "idNumberMasked" TEXT NOT NULL,
    "idNumberHash" TEXT NOT NULL,
    "employerName" TEXT NOT NULL,
    "employerOrgNo" TEXT NOT NULL,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "lastUsedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "StaffRegisterPerson_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "StaffRegisterEvent" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "siteId" TEXT NOT NULL,
    "personId" TEXT NOT NULL,
    "personName" TEXT NOT NULL,
    "idNumberSealed" TEXT NOT NULL,
    "idNumberMasked" TEXT NOT NULL,
    "employerName" TEXT NOT NULL,
    "employerOrgNo" TEXT NOT NULL,
    "kind" "StaffRegisterEventKind" NOT NULL,
    "occurredAt" TIMESTAMP(3) NOT NULL,
    "registeredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "registeredById" TEXT NOT NULL,
    "registeredByName" TEXT NOT NULL,
    "correctsId" TEXT,
    "reason" TEXT NOT NULL DEFAULT '',

    CONSTRAINT "StaffRegisterEvent_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "StaffRegisterPerson_organizationId_name_idx" ON "StaffRegisterPerson"("organizationId", "name");

-- CreateIndex
CREATE UNIQUE INDEX "StaffRegisterPerson_id_organizationId_key" ON "StaffRegisterPerson"("id", "organizationId");

-- CreateIndex
CREATE UNIQUE INDEX "StaffRegisterPerson_organizationId_userId_key" ON "StaffRegisterPerson"("organizationId", "userId");

-- CreateIndex
CREATE UNIQUE INDEX "StaffRegisterPerson_organizationId_idNumberHash_key" ON "StaffRegisterPerson"("organizationId", "idNumberHash");

-- CreateIndex
CREATE INDEX "StaffRegisterEvent_organizationId_projectId_occurredAt_idx" ON "StaffRegisterEvent"("organizationId", "projectId", "occurredAt");

-- CreateIndex
CREATE INDEX "StaffRegisterEvent_organizationId_personId_occurredAt_idx" ON "StaffRegisterEvent"("organizationId", "personId", "occurredAt");

-- CreateIndex
CREATE INDEX "StaffRegisterEvent_organizationId_occurredAt_idx" ON "StaffRegisterEvent"("organizationId", "occurredAt");

-- CreateIndex
CREATE INDEX "StaffRegisterEvent_correctsId_idx" ON "StaffRegisterEvent"("correctsId");

-- CreateIndex
CREATE UNIQUE INDEX "StaffRegisterEvent_id_organizationId_key" ON "StaffRegisterEvent"("id", "organizationId");

-- AddForeignKey
ALTER TABLE "StaffRegisterPerson" ADD CONSTRAINT "StaffRegisterPerson_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StaffRegisterEvent" ADD CONSTRAINT "StaffRegisterEvent_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StaffRegisterEvent" ADD CONSTRAINT "StaffRegisterEvent_projectId_organizationId_fkey" FOREIGN KEY ("projectId", "organizationId") REFERENCES "Project"("id", "organizationId") ON DELETE NO ACTION ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StaffRegisterEvent" ADD CONSTRAINT "StaffRegisterEvent_personId_organizationId_fkey" FOREIGN KEY ("personId", "organizationId") REFERENCES "StaffRegisterPerson"("id", "organizationId") ON DELETE NO ACTION ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StaffRegisterEvent" ADD CONSTRAINT "StaffRegisterEvent_correctsId_organizationId_fkey" FOREIGN KEY ("correctsId", "organizationId") REFERENCES "StaffRegisterEvent"("id", "organizationId") ON DELETE NO ACTION ON UPDATE CASCADE;

-- The register is append-only (SKVFS 2015:6 6 §: a change is an addition that shows who made it and when).
--  * INSERT: registeredAt is always the database server's time (UTC, like every Prisma DateTime), whatever the client
--    sent; a work period may not be registered ahead of time (occurredAt more than five minutes after registeredAt);
--    VOID exists only as a correction.
--  * UPDATE: always refused.
--  * DELETE: refused, except for the nightly retention purge (lib/staff-register/server.ts), which sets
--    workflow.staff_register_purge = 'on' for its own transaction, and then only for rows from before 1 January two
--    years back. The purge itself waits one year longer (brutet räkenskapsår); this is the floor the database guards.
--    A project, a person or a company with register rows therefore cannot be deleted before that either.
CREATE OR REPLACE FUNCTION staff_register_event_insert() RETURNS trigger AS $$
BEGIN
  NEW."registeredAt" := (now() AT TIME ZONE 'UTC');
  IF NEW."occurredAt" > NEW."registeredAt" + interval '5 minutes' THEN
    RAISE EXCEPTION 'StaffRegisterEvent: a work period cannot be registered ahead of time.' USING ERRCODE = '23514';
  END IF;
  IF NEW."kind" = 'VOID' AND NEW."correctsId" IS NULL THEN
    RAISE EXCEPTION 'StaffRegisterEvent: VOID is only a correction.' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "StaffRegisterEvent_insert" BEFORE INSERT ON "StaffRegisterEvent"
  FOR EACH ROW EXECUTE FUNCTION staff_register_event_insert();

CREATE OR REPLACE FUNCTION staff_register_event_append_only() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'DELETE'
    AND current_setting('workflow.staff_register_purge', true) = 'on'
    AND OLD."occurredAt" < make_timestamp(extract(year FROM (now() AT TIME ZONE 'UTC'))::int - 2, 1, 1, 0, 0, 0) THEN
    RETURN OLD;
  END IF;
  RAISE EXCEPTION 'StaffRegisterEvent is append-only: a correction is a new row.' USING ERRCODE = '55000';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "StaffRegisterEvent_append_only" BEFORE UPDATE OR DELETE ON "StaffRegisterEvent"
  FOR EACH ROW EXECUTE FUNCTION staff_register_event_append_only();
