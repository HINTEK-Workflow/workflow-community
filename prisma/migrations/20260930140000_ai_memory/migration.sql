-- HINTEK AI memory (Daniel 2026-09-30): the company's general AI memory and a pseudonymised memory per user, kept
-- apart from the fixed agent instructions (in code) and the chat history. The user memory is keyed by a keyed hash of
-- company and user, never by the user's id, name or e-mail. Short by design.
CREATE TABLE "AiMemory" (
  "id" TEXT NOT NULL,
  "organizationId" TEXT NOT NULL,
  "scope" TEXT NOT NULL,
  "subject" TEXT NOT NULL,
  "content" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "AiMemory_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "AiMemory_scope_check" CHECK ("scope" IN ('COMPANY', 'USER')),
  CONSTRAINT "AiMemory_content_check" CHECK (char_length("content") <= 2000)
);
CREATE UNIQUE INDEX "AiMemory_organizationId_scope_subject_key" ON "AiMemory"("organizationId", "scope", "subject");
ALTER TABLE "AiMemory" ADD CONSTRAINT "AiMemory_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
