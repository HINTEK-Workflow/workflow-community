-- Abort before adding constraints if old rows violate tenant ownership.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM "Attachment" a
    LEFT JOIN "Control" c
      ON c."id" = a."controlId"
     AND c."organizationId" = a."organizationId"
    WHERE c."id" IS NULL
  ) THEN
    RAISE EXCEPTION 'Attachment tenant ownership preflight failed';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM "GeneratedResult" r
    LEFT JOIN "Control" c
      ON c."id" = r."controlId"
     AND c."organizationId" = r."organizationId"
    WHERE c."id" IS NULL
  ) THEN
    RAISE EXCEPTION 'GeneratedResult tenant ownership preflight failed';
  END IF;
END $$;

CREATE UNIQUE INDEX "Control_id_organizationId_key"
  ON "Control"("id", "organizationId");

ALTER TABLE "Attachment"
  DROP CONSTRAINT "Attachment_controlId_fkey",
  ADD CONSTRAINT "Attachment_controlId_organizationId_fkey"
    FOREIGN KEY ("controlId", "organizationId")
    REFERENCES "Control"("id", "organizationId")
    ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "GeneratedResult"
  ADD CONSTRAINT "GeneratedResult_controlId_organizationId_fkey"
    FOREIGN KEY ("controlId", "organizationId")
    REFERENCES "Control"("id", "organizationId")
    ON DELETE CASCADE ON UPDATE CASCADE;
