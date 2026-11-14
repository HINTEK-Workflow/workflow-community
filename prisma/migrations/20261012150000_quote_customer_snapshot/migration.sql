-- Offertens kundögonblicksbild (driftklar-plan 1D, 2026-10-11). Additive: the customer's name, contact person
-- and address as they were when the quote was sent. Null until sent; older sent quotes keep reading the register.

ALTER TABLE "Quote" ADD COLUMN "sentCustomerName" TEXT,
ADD COLUMN "sentCustomerContact" TEXT,
ADD COLUMN "sentCustomerAddress" TEXT;
