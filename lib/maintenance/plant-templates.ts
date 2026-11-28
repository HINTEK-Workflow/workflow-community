/**
 * Anläggningsmallar som ramverk (2026-11-27, K5.1): a starting point for a machine in Underhåll – the plant with suggested
 * machine parts under it and suggested round points in its notes. Our own plain, generic words: nothing from a standard, a manual or
 * a manufacturer, and no limit values or intervals (the company sets them in its own forms, plans and limit profile). Everything made
 * from a template is an ordinary machine afterwards: renamed, moved or removed like any other. Pure, so the page, the server and the
 * tests read the same.
 */
export type PlantTemplate = { key: string; name: string; description: string; parts: readonly string[]; roundPoints: readonly string[] };

export const PLANT_TEMPLATES: readonly PlantTemplate[] = [
  {
    key: "pump_station", name: "Pumpstation", description: "Pumpstation för vatten eller avlopp.",
    parts: ["Pump A", "Pump B", "Nivågivare", "Elskåp och styrning", "Ventiler och backventiler", "Ventilation", "Larmöverföring"],
    roundPoints: ["Pumparna går och växlar som de ska", "Inga ovanliga ljud, vibrationer eller lukter", "Nivågivaren visar ett rimligt värde", "Inga läckor vid pumpar, rör och ventiler",
      "Elskåpet är torrt och utan larm", "Larmöverföringen fungerar", "Utrymmet är rent, låst och utan skador", "Drifttimmar avlästa"],
  },
  {
    key: "treatment_plant", name: "Reningsverk", description: "Reningsverk för avloppsvatten.",
    parts: ["Inlopp och galler", "Sandfång", "Försedimentering", "Biologisk rening", "Eftersedimentering", "Slambehandling", "Kemikaliedosering", "Blåsmaskiner", "Pumpar", "Styrsystem"],
    roundPoints: ["Gallret är rensat och går fritt", "Flöden och nivåer ser normala ut", "Dosering och kemikalielager kontrollerade", "Blåsmaskiner och omrörare går utan anmärkning",
      "Slamhanteringen fungerar", "Prover tagna enligt företagets provtagningsplan", "Larmen i styrsystemet genomgångna", "Skyddsutrustning och nödduschar på plats"],
  },
  {
    key: "reservoir", name: "Reservoar", description: "Reservoar eller vattentorn för dricksvatten.",
    parts: ["Vattenkammare", "Inlopp och utlopp", "Nivågivare", "Ventiler", "Ventilation och luftfilter", "Luckor och lås", "Larm och övervakning"],
    roundPoints: ["Luckor och lås är hela och låsta", "Inga tecken på intrång eller skadegörelse", "Ventilationens filter är hela", "Nivån följer det vanliga mönstret",
      "Inga läckor vid ventiler och rör", "Larm och övervakning fungerar"],
  },
  {
    key: "grid_station", name: "Nätstation", description: "Nätstation i elnätet.",
    parts: ["Transformator", "Ställverk", "Lågspänningsfördelning", "Skyddsutrustning", "Stationsbyggnad", "Jordning"],
    roundPoints: ["Dörrar och lås är hela och skyltningen på plats", "Inga ovanliga ljud, lukter eller värme", "Transformatorn är utan läckage", "Inga larm eller utlösta skydd",
      "Ventilationen är fri", "Inget vatten och inga djur i stationen"],
  },
  {
    key: "switching_station", name: "Kopplingsstation", description: "Kopplings- eller fördelningsstation i elnätet.",
    parts: ["Ställverk", "Brytare", "Frånskiljare", "Kontrollutrustning", "Batteri och likström", "Stationsbyggnad"],
    roundPoints: ["Brytarlägena stämmer med driftläget", "Inga larm i kontrollutrustningen", "Batteriet är utan anmärkning", "Byggnad, dörrar och lås är hela", "Rent och torrt i stationen"],
  },
  {
    key: "heating_plant", name: "Fjärrvärmecentral", description: "Anläggning som producerar fjärrvärme.",
    parts: ["Panna", "Brännare", "Cirkulationspumpar", "Expansionssystem", "Vattenbehandling", "Rökgasrening", "Styr- och övervakningssystem", "Bränslehantering"],
    roundPoints: ["Panna och brännare är utan larm", "Tryck och temperaturer ser normala ut i styrsystemet", "Pumparna går utan ovanliga ljud", "Inga läckor vid rör och kopplingar",
      "Vattenbehandlingen kontrollerad", "Bränslelagret kontrollerat", "Rökgasreningen är utan anmärkning"],
  },
  {
    key: "heating_substation", name: "Undercentral", description: "Undercentral för fjärrvärme i en byggnad.",
    parts: ["Värmeväxlare för värme", "Värmeväxlare för tappvarmvatten", "Styrventiler", "Cirkulationspumpar", "Reglerutrustning", "Energimätare", "Expansionskärl", "Filter och smutsfångare"],
    roundPoints: ["Inga läckor vid värmeväxlare och kopplingar", "Pumparna går utan ovanliga ljud", "Reglerutrustningen är utan larm", "Energimätaren avläst",
      "Filter och smutsfångare rensade vid behov", "Rummet är torrt och utan skador"],
  },
  {
    key: "power_station", name: "Kraftstation", description: "Vattenkraftstation.",
    parts: ["Intag och grind", "Turbin", "Generator", "Transformator", "Lager och smörjning", "Hydraulsystem", "Kontrollutrustning", "Dammluckor"],
    roundPoints: ["Intagsgrinden är rensad", "Turbin och generator går utan ovanliga ljud eller vibrationer", "Lager och smörjning kontrollerade", "Inga oljeläckage",
      "Inga larm i kontrollutrustningen", "Dammluckor och vattennivå kontrollerade", "Driftdata avlästa"],
  },
];

export const PLANT_TEMPLATE_KEYS = PLANT_TEMPLATES.map((template) => template.key);
export const plantTemplate = (key: string | null | undefined): PlantTemplate | null => PLANT_TEMPLATES.find((template) => template.key === key) ?? null;

/** The line under the round points: the company decides limits and intervals itself. */
export const PLANT_TEMPLATE_NOTE = "Gränsvärden och intervall anger företaget i sina egna formulär och planer.";

/** The machine's notes from a template: the suggested round points, to build the company's own round from. */
export function plantTemplateNotes(template: PlantTemplate): string {
  return ["Förslag på rondpunkter:", ...template.roundPoints.map((point) => `- ${point}`), "", PLANT_TEMPLATE_NOTE].join("\n");
}
