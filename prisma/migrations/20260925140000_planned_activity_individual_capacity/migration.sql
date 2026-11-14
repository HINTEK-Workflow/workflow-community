ALTER TABLE "PlannedActivityAssignment" ADD COLUMN "plannedMinutes" INTEGER;
ALTER TABLE "PlannedActivityAssignment" ADD COLUMN "startsAt" TIMESTAMP(3);
ALTER TABLE "PlannedActivityAssignment" ADD COLUMN "endsAt" TIMESTAMP(3);

ALTER TABLE "PlannedActivityAssignment" ADD CONSTRAINT "PlannedActivityAssignment_individualTime_check"
CHECK (("startsAt" IS NULL AND "endsAt" IS NULL) OR ("startsAt" IS NOT NULL AND "endsAt" IS NOT NULL AND "endsAt" > "startsAt"));
