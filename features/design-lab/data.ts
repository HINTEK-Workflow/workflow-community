/**
 * Designlabbet (2026-10-16): example data only. Nothing here is read from or written to a database or the browser's
 * storage; every name is made up (no real suppliers, manufacturers or customers).
 */

export type LabView = 1 | 2 | 3;
export type LabSection = "inkop" | "arbetsorder" | "lista";

export const LAB_SECTIONS: { id: LabSection; label: string }[] = [
  { id: "inkop", label: "Inköp" },
  { id: "arbetsorder", label: "Arbetsorder" },
  { id: "lista", label: "Ny uppgift" },
];

export type PurchaseRow = { id: string; artNo: string; name: string; supplier: string; qty: string; unit: string; price: string };

export const SUPPLIERS = ["Grossist Nord", "Grossist Syd", "Lokal elbutik"];
export const UNITS = ["st", "m", "förp", "rulle", "h"];
export const PROJECTS = ["P-1042 Ombyggnad kontor plan 3", "P-1038 Laddplatser garage", "P-1031 Belysning trapphus"];
export const CUSTOMERS = ["Exempelkund Fastigheter AB", "Brf Exempelgården", "Testbolaget i Mellanstad AB"];
export const PLACES = ["Kontorshuset, plan 3", "Garage B, nivå −1", "Trapphus 2"];
export const PEOPLE = ["Anna Nilsson", "Erik Lund", "Sara Holm"];

export const INITIAL_PURCHASE_ROWS: PurchaseRow[] = [
  { id: "r1", artNo: "100-2451", name: "Installationskabel 3G1,5", supplier: SUPPLIERS[0], qty: "100", unit: "m", price: "6,90" },
  { id: "r2", artNo: "220-0310", name: "Downlight LED 10 W, vit", supplier: SUPPLIERS[0], qty: "12", unit: "st", price: "189,00" },
  { id: "r3", artNo: "310-7782", name: "Kopplingsdosa infälld", supplier: SUPPLIERS[1], qty: "12", unit: "st", price: "14,50" },
  { id: "r4", artNo: "", name: "Dvärgbrytare 10 A", supplier: SUPPLIERS[1], qty: "4", unit: "st", price: "" },
  { id: "r5", artNo: "", name: "Buntband, svart 200 mm", supplier: SUPPLIERS[2], qty: "1", unit: "förp", price: "" },
];

export const WORK_ORDER_STEPS = ["Beställning", "Planering", "Riskbedömning", "Utförande", "Signering", "Färdigställd"];

export const RISK_QUESTIONS = [
  "Kan arbetet ske med anläggningen spänningslös?",
  "Behövs arbete på höjd, till exempel stege eller ställning?",
  "Är arbetsplatsen avspärrad mot obehöriga?",
  "Finns det andra som arbetar i samma utrymme?",
];
export type RiskAnswer = "Ja" | "Nej" | "Osäker";

/** Two working weeks from Monday 19 October 2026. */
export const SCHEDULE_DAYS = [19, 20, 21, 22, 23, 26, 27, 28, 29, 30].map((day, index) => ({ day, weekday: ["M", "T", "O", "T", "F"][index % 5] }));

export const TASK_CATEGORIES = ["Elinstallation", "Elkraft", "Underhåll och driftronder", "Arbetsmiljö och säkerhet"] as const;
export type TaskCategory = (typeof TASK_CATEGORIES)[number];

export type TaskTypeRow = { id: string; title: string; description: string; version: number; category: TaskCategory; level: number; hours: number; action: string };

export const TASK_TYPES: TaskTypeRow[] = [
  { id: "t1", title: "Arbetsorder", description: "Beställning, planering, utförande och material för ett jobb.", version: 9, category: "Elinstallation", level: 1, hours: 4, action: "Skapa arbetsorder" },
  { id: "t2", title: "Kontroll före idrifttagning", description: "Mätvärden och bedömning innan en anläggning tas i drift.", version: 14, category: "Elinstallation", level: 2, hours: 6, action: "Skapa protokoll" },
  { id: "t3", title: "Egenkontroll", description: "Företagets egen kontroll av ett utfört arbete.", version: 5, category: "Elinstallation", level: 1, hours: 2, action: "Skapa protokoll" },
  { id: "t4", title: "Felsökning och åtgärd", description: "Felbeskrivning, orsak och vidtagen åtgärd.", version: 3, category: "Elkraft", level: 2, hours: 3, action: "Skapa protokoll" },
  { id: "t5", title: "Driftrond", description: "Återkommande kontrollpunkter på en plats.", version: 7, category: "Underhåll och driftronder", level: 1, hours: 1, action: "Skapa rond" },
  { id: "t6", title: "Serviceprotokoll", description: "Service och underhåll med anteckningar och bilder.", version: 4, category: "Underhåll och driftronder", level: 1, hours: 2, action: "Skapa protokoll" },
  { id: "t7", title: "Riskbedömning", description: "Risker, skyddsåtgärder och kvarvarande risk före arbetet.", version: 11, category: "Arbetsmiljö och säkerhet", level: 1, hours: 1, action: "Skapa riskbedömning" },
  { id: "t8", title: "Skyddsrond", description: "Arbetsmiljöns brister och vem som åtgärdar dem.", version: 2, category: "Arbetsmiljö och säkerhet", level: 2, hours: 2, action: "Skapa protokoll" },
];
export const MAX_TASK_HOURS = 8;

/** "1 234,50 kr" – the Swedish format, no rounding of the öre. */
export const kronor = (value: number) => `${value.toLocaleString("sv-SE", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} kr`;

/** A typed amount ("189,00", "1 200.5") as a number; null when empty or not a number. */
export function parseAmount(text: string): number | null {
  const cleaned = text.replace(/\s/g, "").replace(",", ".");
  if (!cleaned) return null;
  const value = Number(cleaned);
  return Number.isFinite(value) ? value : null;
}
