CREATE TABLE "WorkflowTaskAttachment" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "taskId" TEXT NOT NULL,
    "filename" TEXT NOT NULL,
    "storagePath" TEXT NOT NULL,
    "mimeType" TEXT NOT NULL,
    "size" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "WorkflowTaskAttachment_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "WorkflowTaskAttachment_storagePath_key" ON "WorkflowTaskAttachment"("storagePath");
CREATE INDEX "WorkflowTaskAttachment_organizationId_taskId_idx" ON "WorkflowTaskAttachment"("organizationId", "taskId");
ALTER TABLE "WorkflowTaskAttachment" ADD CONSTRAINT "WorkflowTaskAttachment_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "WorkflowTaskAttachment" ADD CONSTRAINT "WorkflowTaskAttachment_taskId_organizationId_fkey" FOREIGN KEY ("taskId", "organizationId") REFERENCES "WorkflowTask"("id", "organizationId") ON DELETE CASCADE ON UPDATE CASCADE;
