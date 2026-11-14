CREATE TYPE "AiConversationStatus" AS ENUM ('ACTIVE', 'ARCHIVED');
CREATE TYPE "AiMessageRole" AS ENUM ('USER', 'ASSISTANT');
CREATE TYPE "AiProposalStatus" AS ENUM ('PENDING', 'ACCEPTED', 'REJECTED', 'APPLIED', 'EXPIRED');

CREATE TABLE "AiConversation" (
  "id" TEXT NOT NULL,
  "organizationId" TEXT NOT NULL,
  "createdById" TEXT NOT NULL,
  "title" TEXT NOT NULL,
  "status" "AiConversationStatus" NOT NULL DEFAULT 'ACTIVE',
  "moduleId" TEXT,
  "resourceType" TEXT,
  "resourceId" TEXT,
  "lastMessageAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "AiConversation_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "AiConversation_context_shape" CHECK (
    ("resourceType" IS NULL AND "resourceId" IS NULL) OR
    ("resourceType" IS NOT NULL AND "resourceId" IS NOT NULL)
  )
);

CREATE TABLE "AiMessage" (
  "id" TEXT NOT NULL,
  "conversationId" TEXT NOT NULL,
  "organizationId" TEXT NOT NULL,
  "authorId" TEXT,
  "role" "AiMessageRole" NOT NULL,
  "content" TEXT NOT NULL,
  "citations" JSONB NOT NULL DEFAULT '[]',
  "model" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "AiMessage_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "AiMessage_author_shape" CHECK (
    ("role" = 'USER' AND "authorId" IS NOT NULL AND "model" IS NULL) OR
    ("role" = 'ASSISTANT' AND "authorId" IS NULL AND "model" IS NOT NULL)
  ),
  CONSTRAINT "AiMessage_content_length" CHECK (char_length("content") BETWEEN 1 AND 12000)
);

CREATE TABLE "AiProposal" (
  "id" TEXT NOT NULL,
  "conversationId" TEXT NOT NULL,
  "organizationId" TEXT NOT NULL,
  "proposedByMessageId" TEXT,
  "moduleId" TEXT NOT NULL,
  "resourceType" TEXT NOT NULL,
  "resourceId" TEXT NOT NULL,
  "kind" TEXT NOT NULL,
  "status" "AiProposalStatus" NOT NULL DEFAULT 'PENDING',
  "payload" JSONB NOT NULL,
  "baseVersion" INTEGER,
  "reviewedById" TEXT,
  "reviewedAt" TIMESTAMP(3),
  "appliedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "AiProposal_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "AiProposal_review_shape" CHECK (
    ("status" = 'PENDING' AND "reviewedById" IS NULL AND "reviewedAt" IS NULL AND "appliedAt" IS NULL) OR
    ("status" IN ('ACCEPTED', 'REJECTED') AND "reviewedById" IS NOT NULL AND "reviewedAt" IS NOT NULL AND "appliedAt" IS NULL) OR
    ("status" = 'APPLIED' AND "reviewedById" IS NOT NULL AND "reviewedAt" IS NOT NULL AND "appliedAt" IS NOT NULL) OR
    ("status" = 'EXPIRED' AND "appliedAt" IS NULL)
  ),
  CONSTRAINT "AiProposal_base_version" CHECK ("baseVersion" IS NULL OR "baseVersion" >= 0)
);

CREATE UNIQUE INDEX "AiConversation_id_organizationId_key" ON "AiConversation"("id", "organizationId");
CREATE INDEX "AiConversation_organizationId_createdById_status_lastMessageAt_idx" ON "AiConversation"("organizationId", "createdById", "status", "lastMessageAt");
CREATE INDEX "AiMessage_conversationId_createdAt_idx" ON "AiMessage"("conversationId", "createdAt");
CREATE INDEX "AiMessage_organizationId_authorId_createdAt_idx" ON "AiMessage"("organizationId", "authorId", "createdAt");
CREATE INDEX "AiProposal_organizationId_status_createdAt_idx" ON "AiProposal"("organizationId", "status", "createdAt");
CREATE INDEX "AiProposal_conversationId_createdAt_idx" ON "AiProposal"("conversationId", "createdAt");
CREATE INDEX "AiProposal_resourceType_resourceId_status_idx" ON "AiProposal"("resourceType", "resourceId", "status");

ALTER TABLE "AiConversation" ADD CONSTRAINT "AiConversation_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "AiConversation" ADD CONSTRAINT "AiConversation_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "AiMessage" ADD CONSTRAINT "AiMessage_conversationId_organizationId_fkey" FOREIGN KEY ("conversationId", "organizationId") REFERENCES "AiConversation"("id", "organizationId") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "AiMessage" ADD CONSTRAINT "AiMessage_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "AiMessage" ADD CONSTRAINT "AiMessage_authorId_fkey" FOREIGN KEY ("authorId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "AiProposal" ADD CONSTRAINT "AiProposal_conversationId_organizationId_fkey" FOREIGN KEY ("conversationId", "organizationId") REFERENCES "AiConversation"("id", "organizationId") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "AiProposal" ADD CONSTRAINT "AiProposal_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "AiProposal" ADD CONSTRAINT "AiProposal_proposedByMessageId_fkey" FOREIGN KEY ("proposedByMessageId") REFERENCES "AiMessage"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "AiProposal" ADD CONSTRAINT "AiProposal_reviewedById_fkey" FOREIGN KEY ("reviewedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
