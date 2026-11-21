-- Kundtyp på kunden (2026-10-10): a customer is a company or a private person, with the quote's own values. Additive
-- and safe to run again: every existing customer starts as a company (COMPANY), which is what every new quote started
-- with before. Nothing else changes.

ALTER TABLE "Customer" ADD COLUMN IF NOT EXISTS "customerType" "QuoteCustomerType" NOT NULL DEFAULT 'COMPANY';
