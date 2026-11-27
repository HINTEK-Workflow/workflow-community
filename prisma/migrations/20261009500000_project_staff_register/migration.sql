-- Personalliggare, steg 0 (2026-10-08): the project records whether the building site keeps a staff register, its
-- id number, the byggherre and the system on site. Additive; existing projects read as "not required".
ALTER TABLE "Project" ADD COLUMN "staffRegister" JSONB NOT NULL DEFAULT '{}';
