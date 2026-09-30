-- Manual project closure (Daniel 2026-09-26). Additive and nullable: existing projects stay open.
ALTER TABLE "Project" ADD COLUMN "closedAt" TIMESTAMP(3);
ALTER TABLE "Project" ADD COLUMN "closedBy" TEXT;
