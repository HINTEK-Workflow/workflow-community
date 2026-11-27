-- Agenter, fler mottagare (2026-11-23): besides the owner, chosen colleagues in the same company or a role (all admins, everyone)
-- may get a mission's result by e-mail. Only active members, never an outside address; each run checks again that every recipient
-- may read what the mission reads. One new column with an empty default; nothing else changes.
BEGIN;

ALTER TABLE "AgentMission" ADD COLUMN "recipients" JSONB NOT NULL DEFAULT '{}';

COMMIT;
