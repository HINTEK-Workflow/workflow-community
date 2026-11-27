-- Organisation och ansvar som en fri yta med kort (2026-11-24): each role's card has a place – the column of a fixed
-- grid (0–23) and the row – and its line upwards is still parentId. Only additions: two nullable columns; null = not on the chart.
-- Safe to run again; one transaction.

BEGIN;

ALTER TABLE "SelfInspectionRole" ADD COLUMN IF NOT EXISTS "chartX" INTEGER;
ALTER TABLE "SelfInspectionRole" ADD COLUMN IF NOT EXISTS "chartY" INTEGER;

COMMIT;
