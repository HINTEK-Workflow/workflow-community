ALTER TABLE "AiRun"
  ADD COLUMN "subjectType" TEXT NOT NULL DEFAULT 'KFID_CONTROL',
  ADD COLUMN "subjectId" TEXT;

UPDATE "AiRun" SET "subjectId" = "controlId";

ALTER TABLE "AiRun"
  ALTER COLUMN "subjectId" SET NOT NULL,
  ALTER COLUMN "subjectType" DROP DEFAULT,
  ALTER COLUMN "controlId" DROP NOT NULL;

ALTER TABLE "AiRun"
  ADD CONSTRAINT "AiRun_subject_shape" CHECK (
    (
      "subjectType" = 'KFID_CONTROL' AND
      "controlId" IS NOT NULL AND
      "subjectId" = "controlId"
    ) OR (
      "subjectType" IN ('WORKFLOW_ASSISTANT', 'DOCUMENT') AND
      "controlId" IS NULL
    )
  );

CREATE INDEX "AiRun_organizationId_subjectType_subjectId_createdAt_idx"
  ON "AiRun"("organizationId", "subjectType", "subjectId", "createdAt");
