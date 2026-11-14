-- Värden och referenser (2026-10-06): the company's own values for the limits its forms declare, with the source
-- it names. One row per company and limit key; the company is the only owner (cascade). Additive and safe to run again.

CREATE TABLE IF NOT EXISTS "CompanyReferenceValue" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "low" DOUBLE PRECISION,
    "high" DOUBLE PRECISION,
    "warnLow" DOUBLE PRECISION,
    "warnHigh" DOUBLE PRECISION,
    "source" TEXT NOT NULL DEFAULT '',
    "reference" TEXT NOT NULL DEFAULT '',
    "version" INTEGER NOT NULL DEFAULT 1,
    "updatedBy" TEXT NOT NULL,
    "updatedByName" TEXT NOT NULL DEFAULT '',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CompanyReferenceValue_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "CompanyReferenceValue_organizationId_key_key" ON "CompanyReferenceValue"("organizationId", "key");

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'CompanyReferenceValue_organizationId_fkey') THEN
    ALTER TABLE "CompanyReferenceValue" ADD CONSTRAINT "CompanyReferenceValue_organizationId_fkey"
      FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;
