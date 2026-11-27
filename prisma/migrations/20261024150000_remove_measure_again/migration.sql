-- "Mät igen" bort (2026-10-24): "ta bort mät igen funktionen, den kommer inte att användas". The company's
-- on/off choice (WorkspaceSettings.measureAgain) is dropped. Nothing is moved: older protocol rows that carry
-- "remeasures"/"remeasureAction" in their JSON are read without them (lib/workflow/form-document.ts).
ALTER TABLE "WorkspaceSettings" DROP COLUMN IF EXISTS "measureAgain";
