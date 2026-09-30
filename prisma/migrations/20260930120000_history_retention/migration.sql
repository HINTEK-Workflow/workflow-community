-- History kept for a selectable time (2026-09-30): NULL keeps the history until it is deleted by hand.
ALTER TABLE "Organization" ADD COLUMN "historyRetentionMonths" INTEGER;
ALTER TABLE "Organization" ADD CONSTRAINT "Organization_historyRetentionMonths_check"
  CHECK ("historyRetentionMonths" IS NULL OR "historyRetentionMonths" IN (6, 12, 24, 36, 60, 84, 120));
