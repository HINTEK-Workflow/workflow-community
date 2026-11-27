-- Offert per e-post, steg E (2026-10-09).
--
-- Additive only: one new enum and two new tables. Nothing existing is changed or removed.
--
-- 1. QuoteLink: a link mailed to the customer. Only the sha256 of the random token (32 bytes) is stored. The link is
--    bound to the company and to one quote version through the composite key [quoteId, organizationId] and carries the
--    version and a fingerprint of the customer-facing contents (lib/quotes/customer-link.ts). Its identity never
--    changes; it can be marked opened, used once, or revoked once (a newer link, or the e-mail could not be sent).
-- 2. QuoteResponse: the customer's answer (accepted / declined) through a link – one per quote and one per link, bound to
--    the same company through composite keys. It is the evidence of the agreement (method, name, statement, time, IP
--    address, browser, version and fingerprint) and is never changed: a trigger refuses UPDATE. Deleting is not blocked,
--    so removing a company in a cascade always works.
-- The quote's own status moves SENT -> ACCEPTED / DECLINED under the existing lock trigger (workflow_quote_locked).
-- Prisma does not manage triggers, so they are not schema drift (same convention as 20260925180000_tenant_hardening).

-- CreateEnum
CREATE TYPE "QuoteDecision" AS ENUM ('ACCEPTED', 'DECLINED');

-- CreateTable
CREATE TABLE "QuoteLink" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "quoteId" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "quoteVersion" INTEGER NOT NULL,
    "contentHash" TEXT NOT NULL,
    "acceptanceMethod" TEXT NOT NULL DEFAULT 'simple',
    "email" TEXT NOT NULL,
    "validUntil" TEXT NOT NULL,
    "sentById" TEXT,
    "sentAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "openedAt" TIMESTAMP(3),
    "revokedAt" TIMESTAMP(3),
    "usedAt" TIMESTAMP(3),

    CONSTRAINT "QuoteLink_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "QuoteResponse" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "quoteId" TEXT NOT NULL,
    "linkId" TEXT NOT NULL,
    "decision" "QuoteDecision" NOT NULL,
    "acceptanceMethod" TEXT NOT NULL,
    "signerName" TEXT NOT NULL DEFAULT '',
    "reason" TEXT NOT NULL DEFAULT '',
    "evidence" JSONB NOT NULL DEFAULT '{}',
    "quoteVersion" INTEGER NOT NULL,
    "contentHash" TEXT NOT NULL,
    "ipAddress" TEXT NOT NULL DEFAULT '',
    "userAgent" TEXT NOT NULL DEFAULT '',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "QuoteResponse_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "QuoteLink_tokenHash_key" ON "QuoteLink"("tokenHash");

-- CreateIndex
CREATE INDEX "QuoteLink_organizationId_quoteId_idx" ON "QuoteLink"("organizationId", "quoteId");

-- CreateIndex
CREATE UNIQUE INDEX "QuoteLink_id_organizationId_key" ON "QuoteLink"("id", "organizationId");

-- CreateIndex
CREATE UNIQUE INDEX "QuoteResponse_quoteId_key" ON "QuoteResponse"("quoteId");

-- CreateIndex
CREATE UNIQUE INDEX "QuoteResponse_linkId_key" ON "QuoteResponse"("linkId");

-- CreateIndex
CREATE INDEX "QuoteResponse_organizationId_createdAt_idx" ON "QuoteResponse"("organizationId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "QuoteResponse_quoteId_organizationId_key" ON "QuoteResponse"("quoteId", "organizationId");

-- CreateIndex
CREATE UNIQUE INDEX "QuoteResponse_linkId_organizationId_key" ON "QuoteResponse"("linkId", "organizationId");

-- AddForeignKey
ALTER TABLE "QuoteLink" ADD CONSTRAINT "QuoteLink_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "QuoteLink" ADD CONSTRAINT "QuoteLink_quoteId_organizationId_fkey" FOREIGN KEY ("quoteId", "organizationId") REFERENCES "Quote"("id", "organizationId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "QuoteResponse" ADD CONSTRAINT "QuoteResponse_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "QuoteResponse" ADD CONSTRAINT "QuoteResponse_quoteId_organizationId_fkey" FOREIGN KEY ("quoteId", "organizationId") REFERENCES "Quote"("id", "organizationId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "QuoteResponse" ADD CONSTRAINT "QuoteResponse_linkId_organizationId_fkey" FOREIGN KEY ("linkId", "organizationId") REFERENCES "QuoteLink"("id", "organizationId") ON DELETE CASCADE ON UPDATE CASCADE;


-- ---------- A link's identity never changes; used and revoked are set once ----------
CREATE OR REPLACE FUNCTION "workflow_quote_link_locked"() RETURNS trigger AS $$
BEGIN
  IF NEW."organizationId" IS DISTINCT FROM OLD."organizationId"
    OR NEW."quoteId" IS DISTINCT FROM OLD."quoteId"
    OR NEW."tokenHash" IS DISTINCT FROM OLD."tokenHash"
    OR NEW."quoteVersion" IS DISTINCT FROM OLD."quoteVersion"
    OR NEW."contentHash" IS DISTINCT FROM OLD."contentHash"
    OR NEW."acceptanceMethod" IS DISTINCT FROM OLD."acceptanceMethod"
    OR NEW."email" IS DISTINCT FROM OLD."email"
    OR NEW."validUntil" IS DISTINCT FROM OLD."validUntil"
    OR NEW."sentAt" IS DISTINCT FROM OLD."sentAt"
    OR (OLD."usedAt" IS NOT NULL AND NEW."usedAt" IS DISTINCT FROM OLD."usedAt")
    OR (OLD."revokedAt" IS NOT NULL AND NEW."revokedAt" IS DISTINCT FROM OLD."revokedAt") THEN
    RAISE EXCEPTION 'Offertlänken kan inte ändras.' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "QuoteLink_locked" BEFORE UPDATE ON "QuoteLink"
  FOR EACH ROW EXECUTE FUNCTION "workflow_quote_link_locked"();

-- ---------- The customer's answer is never changed ----------
CREATE OR REPLACE FUNCTION "workflow_quote_response_append_only"() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'Kundens svar på offerten kan inte ändras.' USING ERRCODE = '23514';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "QuoteResponse_append_only" BEFORE UPDATE ON "QuoteResponse"
  FOR EACH ROW EXECUTE FUNCTION "workflow_quote_response_append_only"();
