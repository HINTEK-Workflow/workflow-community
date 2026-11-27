-- Prisfiler utan grossistens katalog (produktägaren 2026-11-01): en manuell prisfil ska fungera när grossistens API saknas, i både
-- Cloud och Community, utan att en hel kopia av grossistens artikelregister hamnar hos varje kund.
--
-- En ny tabell, helt additiv: ingen befintlig tabell, kolumn eller rad ändras och ingenting tas bort. Den gamla appen läser inte
-- tabellen. En rad är en rad ur företagets egen fil: leverantör, artikelnummer, namn, enhet och pris. Den pekar aldrig på
-- WholesaleArticle; kopplingen till grossistens artikel görs när raden läses (lib/catalogue/file-prices.ts), så att en katalog som
-- slås på senare inte ger dubbletter och inte kräver någon omskrivning. En ny fil av samma slag från samma leverantör ersätter den
-- förra i en transaktion. Offerter och materialrader har egna kopior och påverkas inte.

BEGIN;

CREATE TABLE "CatalogueFilePrice" (
    "id" BIGSERIAL NOT NULL,
    "organizationId" TEXT NOT NULL,
    "supplierId" TEXT NOT NULL,
    "importId" TEXT NOT NULL,
    "wholesaler" TEXT NOT NULL,
    "articleNo" TEXT NOT NULL DEFAULT '',
    "articleKey" TEXT NOT NULL,
    "articleNoNorm" TEXT NOT NULL DEFAULT '',
    "eNumber" TEXT NOT NULL DEFAULT '',
    "rskNumber" TEXT NOT NULL DEFAULT '',
    "gtin" TEXT NOT NULL DEFAULT '',
    "manufacturer" TEXT NOT NULL DEFAULT '',
    "manufacturerArticleNo" TEXT NOT NULL DEFAULT '',
    "productKey" TEXT NOT NULL DEFAULT '',
    "name" TEXT NOT NULL,
    "unit" TEXT NOT NULL DEFAULT '',
    "searchText" TEXT NOT NULL DEFAULT '',
    "amount" DECIMAL(14,4) NOT NULL,
    "perQuantity" INTEGER NOT NULL DEFAULT 1,
    "unitPrice" DECIMAL(14,4) NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'SEK',
    "priceKind" TEXT NOT NULL DEFAULT 'NET',
    "priceDate" DATE NOT NULL,
    "discountGroup" TEXT NOT NULL DEFAULT '',
    "packageSize" TEXT NOT NULL DEFAULT '',
    "orderMultiple" TEXT NOT NULL DEFAULT '',
    "minOrderQuantity" TEXT NOT NULL DEFAULT '',
    "stocked" TEXT NOT NULL DEFAULT '',
    "status" TEXT NOT NULL DEFAULT '',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CatalogueFilePrice_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "CatalogueFilePrice_priceKind_check" CHECK ("priceKind" IN ('NET', 'BASE')),
    CONSTRAINT "CatalogueFilePrice_perQuantity_check" CHECK ("perQuantity" >= 1)
);

-- One article once per file (the parser reports a second row), and the swap's "was it in the new file?".
CREATE UNIQUE INDEX "CatalogueFilePrice_importId_articleKey_key" ON "CatalogueFilePrice"("importId", "articleKey");
-- Every read starts at the company, so the size of one company's search is bounded by the company's own limit and never by the others'.
-- No trigram index on the search text: shared by every company it would grow with all of them and hit their rows first.
CREATE INDEX "CatalogueFilePrice_org_supplier_kind_key_idx" ON "CatalogueFilePrice"("organizationId", "supplierId", "priceKind", "articleKey");
CREATE INDEX "CatalogueFilePrice_organizationId_wholesaler_articleNo_idx" ON "CatalogueFilePrice"("organizationId", "wholesaler", "articleNo");
CREATE INDEX "CatalogueFilePrice_organizationId_productKey_idx" ON "CatalogueFilePrice"("organizationId", "productKey");

ALTER TABLE "CatalogueFilePrice" ADD CONSTRAINT "CatalogueFilePrice_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
-- The composite keys make the database itself refuse a row whose supplier or import belongs to another company.
ALTER TABLE "CatalogueFilePrice" ADD CONSTRAINT "CatalogueFilePrice_supplierId_organizationId_fkey" FOREIGN KEY ("supplierId", "organizationId") REFERENCES "CatalogueSupplier"("id", "organizationId") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "CatalogueFilePrice" ADD CONSTRAINT "CatalogueFilePrice_importId_organizationId_fkey" FOREIGN KEY ("importId", "organizationId") REFERENCES "CatalogueImport"("id", "organizationId") ON DELETE CASCADE ON UPDATE CASCADE;

-- A row is written once and goes with its file: a new price is a new file. The same refusal as WholesalePrice.
CREATE TRIGGER "CatalogueFilePrice_no_update" BEFORE UPDATE ON "CatalogueFilePrice"
  FOR EACH ROW EXECUTE FUNCTION wholesale_price_append_only();

COMMIT;
