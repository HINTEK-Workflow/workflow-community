-- The product owner's website edited from Workflow: the connection to its WordPress, the drafts of its pages and
-- the backups taken before Workflow writes a page. Product content only, no company's data. Only additions.
BEGIN;
CREATE TABLE "WebsiteConnection" (
    "id" TEXT NOT NULL DEFAULT 'site',
    "baseUrl" TEXT NOT NULL,
    "username" TEXT,
    "passwordCipher" TEXT,
    "auto" JSONB,
    "updatedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "WebsiteConnection_pkey" PRIMARY KEY ("id")
);
CREATE TABLE "WebsitePageDraft" (
    "pageId" INTEGER NOT NULL,
    "title" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "baseModified" TEXT NOT NULL,
    "revision" INTEGER NOT NULL DEFAULT 1,
    "updatedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "WebsitePageDraft_pkey" PRIMARY KEY ("pageId")
);
CREATE TABLE "WebsitePageBackup" (
    "id" TEXT NOT NULL,
    "pageId" INTEGER NOT NULL,
    "title" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "modified" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "WebsitePageBackup_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "WebsitePageBackup_pageId_createdAt_idx" ON "WebsitePageBackup"("pageId", "createdAt");
COMMIT;
