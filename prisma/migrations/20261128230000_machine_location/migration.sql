-- Kartnål på plats och maskin (0.92.0, lib/maintenance/location.ts): Underhållets platser och maskiner får en valfri position i
-- WGS 84 (decimalgrader), satt på samma Lantmäterikarta som kundregistrets platser (via egen server). En maskin utan egen
-- position visas där dess plats (eller platsen ovanför) är: "Samma som platsen". Bara en maskin (en rot) har en egen position;
-- delarna följer sin maskin.
--
-- Justerbart tak (lib/maintenance/caps.ts): systemadministratören kan sätta ett lägre tak per företag för antalet maskiner och
-- platser i Underhåll. NULL = dagens värde (5 000 delar per företag, 2 000 platser), så inget företag påverkas.
--
-- Bara additivt: nya kolumner som tillåter NULL, utan DEFAULT, och CHECK-villkor som alla befintliga rader uppfyller (alla får NULL).
-- Ingen befintlig rad skrivs om; den gamla appen läser och skriver aldrig kolumnerna.

BEGIN;

-- AlterTable
ALTER TABLE "MaintenancePlace" ADD COLUMN "latitude" DOUBLE PRECISION;
ALTER TABLE "MaintenancePlace" ADD COLUMN "longitude" DOUBLE PRECISION;
ALTER TABLE "MachinePart" ADD COLUMN "latitude" DOUBLE PRECISION;
ALTER TABLE "MachinePart" ADD COLUMN "longitude" DOUBLE PRECISION;
ALTER TABLE "Organization" ADD COLUMN "maintenanceMachineCap" INTEGER;
ALTER TABLE "Organization" ADD COLUMN "maintenancePlaceCap" INTEGER;

-- ---------- Villkor ----------
ALTER TABLE "MaintenancePlace" ADD CONSTRAINT "MaintenancePlace_position_check" CHECK (
  ("latitude" IS NULL AND "longitude" IS NULL)
  OR ("latitude" BETWEEN -90 AND 90 AND "longitude" BETWEEN -180 AND 180)
);
ALTER TABLE "MachinePart" ADD CONSTRAINT "MachinePart_position_check" CHECK (
  ("latitude" IS NULL AND "longitude" IS NULL)
  OR ("parentId" IS NULL AND "latitude" BETWEEN -90 AND 90 AND "longitude" BETWEEN -180 AND 180)
);
ALTER TABLE "Organization" ADD CONSTRAINT "Organization_maintenanceMachineCap_check" CHECK ("maintenanceMachineCap" IS NULL OR "maintenanceMachineCap" BETWEEN 1 AND 5000);
ALTER TABLE "Organization" ADD CONSTRAINT "Organization_maintenancePlaceCap_check" CHECK ("maintenancePlaceCap" IS NULL OR "maintenancePlaceCap" BETWEEN 1 AND 2000);

COMMIT;
