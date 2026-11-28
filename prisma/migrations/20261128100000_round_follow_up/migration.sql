-- Driftronden som tillsyn och uppföljning (beslut 2026-11-27, lib/maintenance/plan-model.ts INTERVAL_MODES):
-- en kalenderplan väljer Räkna från senaste utförda (FROM_DONE, standard: så räknade alla planer före 2026-11-28, så
-- befintliga planer beter sig som förut) eller Fast schema (FIXED). Brister i ronden som blir arbetsordrar (Akut/Planerad) lagras i arbetsorderns JSON (details.roundFollowUp)
-- och i protokollets rader (partId), så de behöver inga kolumner.
--
-- Bara additivt: en ny kolumn med DEFAULT och ett CHECK-villkor som alla befintliga rader uppfyller (de får 'FROM_DONE').
-- Ingen befintlig rad skrivs om på annat sätt; den gamla appen läser och skriver aldrig kolumnen.

BEGIN;

-- AlterTable
ALTER TABLE "MaintenancePlan" ADD COLUMN "intervalMode" TEXT NOT NULL DEFAULT 'FROM_DONE';

-- ---------- Villkor ----------
ALTER TABLE "MaintenancePlan" ADD CONSTRAINT "MaintenancePlan_intervalMode_check" CHECK ("intervalMode" IN ('FIXED', 'FROM_DONE'));

COMMIT;
