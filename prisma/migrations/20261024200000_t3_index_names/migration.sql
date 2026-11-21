-- T3 (granskningen 2026-10-20): fyra indexnamn var längre än 63 tecken. Postgres kortade dem genom att klippa slutet,
-- Prisma kortar i mitten och behåller "_idx"/"_key", så en framtida `prisma migrate dev` ville byta namn på dem.
-- Den här migreringen byter bara namn (ingen data, inga kolumner, indexen byggs inte om); efter den stämmer
-- databasen med prisma/schema.prisma utan undantag (tests/migrations-match-schema.integration.ts).
ALTER INDEX "AiConversation_organizationId_createdById_status_lastMessageAt_" RENAME TO "AiConversation_organizationId_createdById_status_lastMessag_idx";
ALTER INDEX "FormLimitProfile_organizationId_templateId_facilityId_objectNam" RENAME TO "FormLimitProfile_organizationId_templateId_facilityId_objec_key";
ALTER INDEX "PlannedActivityAssignment_organizationId_memberId_plannedActivi" RENAME TO "PlannedActivityAssignment_organizationId_memberId_plannedAc_idx";
ALTER INDEX "PlannedActivityEvent_organizationId_plannedActivityId_createdAt" RENAME TO "PlannedActivityEvent_organizationId_plannedActivityId_creat_idx";
