-- Eget företag (2026-10-24): the company's own places are a customer record of its own, marked ownCompany, so they
-- use the same place tree, page and rules as a customer's. Additive: one column with a default and a partial unique index
-- (at most one such record per company). The record is made when the company first opens its places.
ALTER TABLE "Customer" ADD COLUMN IF NOT EXISTS "ownCompany" BOOLEAN NOT NULL DEFAULT false;
CREATE UNIQUE INDEX IF NOT EXISTS "Customer_organizationId_ownCompany_key" ON "Customer"("organizationId") WHERE "ownCompany";
