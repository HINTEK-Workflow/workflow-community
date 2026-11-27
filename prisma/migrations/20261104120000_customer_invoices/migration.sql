-- Fakturor (owner's decision 2026-11-04, docs/beslut/faktura.md). Additive: three new tables and an enum; no existing table,
-- column or row is touched. Without a row in CustomerInvoiceSeries a company does not issue invoices (off by default).
BEGIN;

CREATE TYPE "CustomerInvoiceKind" AS ENUM ('INVOICE', 'CREDIT');

-- One row per company: the setting and the number series. The row is what serialises numbering: issuing updates it inside
-- the transaction that writes the invoice, so a rolled-back issue leaves no gap and two issues never get the same number.
CREATE TABLE "CustomerInvoiceSeries" (
    "organizationId" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT false,
    "nextNumber" INTEGER NOT NULL DEFAULT 1,
    "prefix" TEXT NOT NULL DEFAULT '',
    "paymentDays" INTEGER,
    "lateTerms" TEXT NOT NULL DEFAULT '',
    "iban" TEXT NOT NULL DEFAULT '',
    "bic" TEXT NOT NULL DEFAULT '',
    "useOcr" BOOLEAN NOT NULL DEFAULT false,
    "vatExempt" BOOLEAN NOT NULL DEFAULT false,
    "updatedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CustomerInvoiceSeries_pkey" PRIMARY KEY ("organizationId"),
    CONSTRAINT "CustomerInvoiceSeries_nextNumber_check" CHECK ("nextNumber" >= 1)
);

CREATE TABLE "CustomerInvoice" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "number" INTEGER NOT NULL,
    "label" TEXT NOT NULL,
    "kind" "CustomerInvoiceKind" NOT NULL DEFAULT 'INVOICE',
    "basisId" TEXT,
    "creditOfId" TEXT,
    "customerId" TEXT,
    "issuedOn" TEXT NOT NULL,
    "dueOn" TEXT,
    "title" TEXT NOT NULL,
    "buyerName" TEXT NOT NULL DEFAULT '',
    "content" JSONB NOT NULL,
    "toPay" DECIMAL(14,2) NOT NULL,
    "identitySealed" TEXT,
    "identityMasked" TEXT NOT NULL DEFAULT '',
    "createdById" TEXT,
    "createdByName" TEXT NOT NULL DEFAULT '',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "paidOn" TEXT,
    "correctedByBasisId" TEXT,

    CONSTRAINT "CustomerInvoice_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "CustomerInvoice_number_check" CHECK ("number" >= 1),
    CONSTRAINT "CustomerInvoice_credit_shape" CHECK (("kind" = 'CREDIT') = ("creditOfId" IS NOT NULL))
);

CREATE UNIQUE INDEX "CustomerInvoice_id_organizationId_key" ON "CustomerInvoice"("id", "organizationId");
-- A number is given once per company, ever.
CREATE UNIQUE INDEX "CustomerInvoice_organizationId_number_key" ON "CustomerInvoice"("organizationId", "number");
-- One invoice per basis and one credit per invoice.
CREATE UNIQUE INDEX "CustomerInvoice_one_per_basis" ON "CustomerInvoice"("organizationId", "basisId") WHERE "kind" = 'INVOICE';
CREATE UNIQUE INDEX "CustomerInvoice_organizationId_creditOfId_key" ON "CustomerInvoice"("organizationId", "creditOfId");
CREATE INDEX "CustomerInvoice_organizationId_basisId_idx" ON "CustomerInvoice"("organizationId", "basisId");
CREATE INDEX "CustomerInvoice_organizationId_dueOn_idx" ON "CustomerInvoice"("organizationId", "dueOn");

-- The log on the invoice: sent (date and recipient), marked paid, the mark undone. Never an identity number.
CREATE TABLE "CustomerInvoiceEvent" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "invoiceId" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "detail" TEXT NOT NULL DEFAULT '',
    "actorId" TEXT,
    "actorName" TEXT NOT NULL DEFAULT '',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CustomerInvoiceEvent_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "CustomerInvoiceEvent_organizationId_invoiceId_createdAt_idx" ON "CustomerInvoiceEvent"("organizationId", "invoiceId", "createdAt");

ALTER TABLE "CustomerInvoiceSeries" ADD CONSTRAINT "CustomerInvoiceSeries_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "CustomerInvoice" ADD CONSTRAINT "CustomerInvoice_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
-- Composite keys keep every link inside the company. A deleted customer clears only its own column: the buyer stands in the content.
ALTER TABLE "CustomerInvoice" ADD CONSTRAINT "CustomerInvoice_customerId_organizationId_fkey" FOREIGN KEY ("customerId", "organizationId") REFERENCES "Customer"("id", "organizationId") ON DELETE SET NULL ("customerId") ON UPDATE CASCADE;
ALTER TABLE "CustomerInvoice" ADD CONSTRAINT "CustomerInvoice_basisId_organizationId_fkey" FOREIGN KEY ("basisId", "organizationId") REFERENCES "InvoiceBasis"("id", "organizationId") ON DELETE SET NULL ("basisId") ON UPDATE CASCADE;
ALTER TABLE "CustomerInvoice" ADD CONSTRAINT "CustomerInvoice_creditOfId_organizationId_fkey" FOREIGN KEY ("creditOfId", "organizationId") REFERENCES "CustomerInvoice"("id", "organizationId") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "CustomerInvoiceEvent" ADD CONSTRAINT "CustomerInvoiceEvent_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "CustomerInvoiceEvent" ADD CONSTRAINT "CustomerInvoiceEvent_invoiceId_organizationId_fkey" FOREIGN KEY ("invoiceId", "organizationId") REFERENCES "CustomerInvoice"("id", "organizationId") ON DELETE CASCADE ON UPDATE CASCADE;

-- An issued invoice is locked: its number, content and sums never change. Only the payment mark, the link to the
-- correcting basis and the sealing of the identity number (a new key) may change, and a deleted link may be cleared.
-- Deleting is stopped by the server: the only way out is the erasure of a whole company.
CREATE OR REPLACE FUNCTION "workflow_customer_invoice_locked"() RETURNS trigger AS $$
BEGIN
  IF NEW."number" IS DISTINCT FROM OLD."number" OR NEW."label" IS DISTINCT FROM OLD."label" OR NEW."kind" IS DISTINCT FROM OLD."kind"
      OR NEW."organizationId" IS DISTINCT FROM OLD."organizationId" OR NEW."issuedOn" IS DISTINCT FROM OLD."issuedOn"
      OR NEW."dueOn" IS DISTINCT FROM OLD."dueOn" OR NEW."title" IS DISTINCT FROM OLD."title" OR NEW."buyerName" IS DISTINCT FROM OLD."buyerName"
      OR NEW."content" IS DISTINCT FROM OLD."content" OR NEW."toPay" IS DISTINCT FROM OLD."toPay" OR NEW."identityMasked" IS DISTINCT FROM OLD."identityMasked"
      OR NEW."createdAt" IS DISTINCT FROM OLD."createdAt" OR NEW."creditOfId" IS DISTINCT FROM OLD."creditOfId"
      OR (NEW."basisId" IS NOT NULL AND NEW."basisId" IS DISTINCT FROM OLD."basisId")
      OR (NEW."customerId" IS NOT NULL AND NEW."customerId" IS DISTINCT FROM OLD."customerId") THEN
    RAISE EXCEPTION 'En utfärdad faktura kan inte ändras.' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "CustomerInvoice_locked" BEFORE UPDATE ON "CustomerInvoice"
  FOR EACH ROW EXECUTE FUNCTION "workflow_customer_invoice_locked"();

-- A number once given is never given again: once the company has an invoice, the series only moves one step at a time.
CREATE OR REPLACE FUNCTION "workflow_customer_invoice_series_forward"() RETURNS trigger AS $$
BEGIN
  IF NEW."nextNumber" IS DISTINCT FROM OLD."nextNumber" AND NEW."nextNumber" <> OLD."nextNumber" + 1
      AND EXISTS (SELECT 1 FROM "CustomerInvoice" WHERE "organizationId" = OLD."organizationId") THEN
    RAISE EXCEPTION 'Startnumret kan inte ändras när företaget har utfärdat fakturor.' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "CustomerInvoiceSeries_forward" BEFORE UPDATE ON "CustomerInvoiceSeries"
  FOR EACH ROW EXECUTE FUNCTION "workflow_customer_invoice_series_forward"();

COMMIT;
