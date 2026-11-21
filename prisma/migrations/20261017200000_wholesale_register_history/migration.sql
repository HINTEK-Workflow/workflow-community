-- Gemensamt artikelregister (2026-10-17): the register sync keeps its latest runs as an import history for the product
-- owner (Tjänster och nycklar → Solar). Additive: one nullable column on the new sync table.
ALTER TABLE "WholesaleRegisterSync" ADD COLUMN "history" JSONB;
