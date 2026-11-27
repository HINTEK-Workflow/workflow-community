-- AlterTable
ALTER TABLE "Control" ADD COLUMN     "number" SERIAL NOT NULL;

-- CreateTable
CREATE TABLE "SystemSettings" (
    "id" TEXT NOT NULL DEFAULT 'global',
    "suggestions" JSONB NOT NULL DEFAULT '{}',

    CONSTRAINT "SystemSettings_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Control_number_key" ON "Control"("number");

