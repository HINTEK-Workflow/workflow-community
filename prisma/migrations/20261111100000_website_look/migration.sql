-- Min webbsida (2026-11-10): the site's typography per connection and the web fonts it uses, copied to Workflow. Only additions:
-- a new nullable column and a new table; the old app never reads them.
BEGIN;

-- AlterTable
ALTER TABLE "WebsiteConnection" ADD COLUMN     "look" JSONB;

-- CreateTable
CREATE TABLE "WebsiteFont" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "family" TEXT NOT NULL,
    "weight" TEXT NOT NULL,
    "style" TEXT NOT NULL,
    "format" TEXT NOT NULL,
    "unicodeRange" TEXT,
    "bytes" BYTEA NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "WebsiteFont_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "WebsiteFont_organizationId_idx" ON "WebsiteFont"("organizationId");

-- AddForeignKey
ALTER TABLE "WebsiteFont" ADD CONSTRAINT "WebsiteFont_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;


COMMIT;
