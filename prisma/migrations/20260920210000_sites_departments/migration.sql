-- Optional organization structure. No site-level access restrictions are introduced.
CREATE TABLE "Site" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "Site_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "Department" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "siteId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "Department_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "Control" ADD COLUMN "siteId" TEXT;
ALTER TABLE "Control" ADD COLUMN "departmentId" TEXT;
ALTER TABLE "Control" ADD CONSTRAINT "Control_department_requires_site" CHECK ("departmentId" IS NULL OR "siteId" IS NOT NULL);

CREATE UNIQUE INDEX "Site_id_organizationId_key" ON "Site"("id", "organizationId");
CREATE UNIQUE INDEX "Site_organizationId_name_key" ON "Site"("organizationId", "name");
CREATE INDEX "Site_organizationId_isActive_name_idx" ON "Site"("organizationId", "isActive", "name");
CREATE UNIQUE INDEX "Department_id_organizationId_key" ON "Department"("id", "organizationId");
CREATE UNIQUE INDEX "Department_id_siteId_organizationId_key" ON "Department"("id", "siteId", "organizationId");
CREATE UNIQUE INDEX "Department_siteId_name_key" ON "Department"("siteId", "name");
CREATE INDEX "Department_organizationId_siteId_isActive_name_idx" ON "Department"("organizationId", "siteId", "isActive", "name");
CREATE INDEX "Control_organizationId_siteId_departmentId_idx" ON "Control"("organizationId", "siteId", "departmentId");

ALTER TABLE "Site" ADD CONSTRAINT "Site_organizationId_fkey"
  FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Department" ADD CONSTRAINT "Department_organizationId_fkey"
  FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Department" ADD CONSTRAINT "Department_siteId_organizationId_fkey"
  FOREIGN KEY ("siteId", "organizationId") REFERENCES "Site"("id", "organizationId") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "Control" ADD CONSTRAINT "Control_siteId_organizationId_fkey"
  FOREIGN KEY ("siteId", "organizationId") REFERENCES "Site"("id", "organizationId") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "Control" ADD CONSTRAINT "Control_departmentId_siteId_organizationId_fkey"
  FOREIGN KEY ("departmentId", "siteId", "organizationId") REFERENCES "Department"("id", "siteId", "organizationId") ON DELETE RESTRICT ON UPDATE CASCADE;
