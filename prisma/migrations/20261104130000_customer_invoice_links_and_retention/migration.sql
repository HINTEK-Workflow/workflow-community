-- Fakturor (owner's decisions 2026-11-04, docs/beslut/faktura.md): the customer's secure page and the seven-year retention.
-- Additive: one new table and one trigger; no existing table, column or row is touched.
BEGIN;

-- The secure page for an invoice with a personal number: as a quote's customer link, only the token's sha256 is stored.
CREATE TABLE "CustomerInvoiceLink" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "invoiceId" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "validUntil" TEXT NOT NULL,
    "sentById" TEXT,
    "sentAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "openedAt" TIMESTAMP(3),
    "revokedAt" TIMESTAMP(3),

    CONSTRAINT "CustomerInvoiceLink_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "CustomerInvoiceLink_tokenHash_key" ON "CustomerInvoiceLink"("tokenHash");
CREATE INDEX "CustomerInvoiceLink_organizationId_invoiceId_idx" ON "CustomerInvoiceLink"("organizationId", "invoiceId");
ALTER TABLE "CustomerInvoiceLink" ADD CONSTRAINT "CustomerInvoiceLink_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "CustomerInvoiceLink" ADD CONSTRAINT "CustomerInvoiceLink_invoiceId_organizationId_fkey" FOREIGN KEY ("invoiceId", "organizationId") REFERENCES "CustomerInvoice"("id", "organizationId") ON DELETE CASCADE ON UPDATE CASCADE;

-- An issued invoice is kept for seven years, counted from the end of the year after its date (a broken fiscal year can close then, so
-- an invoice from 2026 is kept through 2034-12-31), also when the company is erased, as the staff register is: it can be deleted only by the nightly job, which sets workflow.customer_invoice_purge = 'on' for its own
-- transaction, and then only when it is that old. A company with invoices therefore cannot be deleted before that either.
CREATE OR REPLACE FUNCTION "workflow_customer_invoice_kept"() RETURNS trigger AS $$
BEGIN
  IF current_setting('workflow.customer_invoice_purge', true) IS DISTINCT FROM 'on'
      OR OLD."issuedOn" >= to_char(make_date(EXTRACT(YEAR FROM (now() AT TIME ZONE 'Europe/Stockholm'))::int - 8, 1, 1), 'YYYY-MM-DD') THEN
    RAISE EXCEPTION 'En faktura sparas i åtta år efter utgången av fakturans kalenderår.' USING ERRCODE = '23514';
  END IF;
  RETURN OLD;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "CustomerInvoice_kept" BEFORE DELETE ON "CustomerInvoice"
  FOR EACH ROW EXECUTE FUNCTION "workflow_customer_invoice_kept"();

COMMIT;
