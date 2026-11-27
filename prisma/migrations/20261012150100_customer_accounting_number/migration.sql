-- Kundnummer i bokföringen på kunden (driftklar-plan, 2026-10-11). Additive: the customer's number in the
-- company's accounting system, so the Fortnox export never asks for it again.

ALTER TABLE "Customer" ADD COLUMN "accountingCustomerNumber" TEXT NOT NULL DEFAULT '';
