-- A binding records the Cloud member value that the exported Local file started
-- from. This lets the dedicated schedule sync fail closed on divergent edits.
ALTER TABLE "LocalWorkspaceBinding"
  ADD COLUMN "memberWeeklyWorkMinutesAtBinding" INTEGER,
  ADD COLUMN "scheduleBaselineCapturedAt" TIMESTAMP(3),
  ADD COLUMN "lastLocalScheduleUpdatedAt" TIMESTAMP(3),
  ADD COLUMN "lastScheduleSyncedAt" TIMESTAMP(3);
