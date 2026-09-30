-- The project as the frame (Daniel 2026-09-26): start date and fixed project fields. Additive with empty defaults;
-- existing projects keep working without a frame until someone sets one.
ALTER TABLE "Project" ADD COLUMN "startDate" TEXT NOT NULL DEFAULT '';
ALTER TABLE "Project" ADD COLUMN "client" TEXT NOT NULL DEFAULT '';
ALTER TABLE "Project" ADD COLUMN "contactPerson" TEXT NOT NULL DEFAULT '';
ALTER TABLE "Project" ADD COLUMN "reference" TEXT NOT NULL DEFAULT '';
ALTER TABLE "Project" ADD COLUMN "workSite" TEXT NOT NULL DEFAULT '';
