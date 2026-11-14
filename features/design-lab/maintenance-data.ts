import type { FacilityItem } from "@/lib/workflow/customer-facility";

/**
 * Förslag: Underhållsmodulen (2026-10-30) – example data only, invented names, nothing stored. The machines are a
 * tree of their own in the place tree's shape (only the look is shared with the customer card).
 */

export type Status = "I drift" | "Ur drift" | "Service snart";
export type MachineEvent = { at: string; text: string; alarm: boolean; order?: string };
export type PartImage = { id: string; url: string; name: string };
export type IntervalKind = "Kalender" | "Drifttimmar" | "Det som kommer först";
export type CalendarUnit = "dag" | "vecka" | "månad" | "år";
/** One occurrence of a recurring job = one work order, made in advance as Vilande (2026-10-30). */
export type JobOccurrence = { date: string; status: "Klar" | "Aktiv" | "Vilande"; order: string; approx?: boolean };
export type RecurringJob = {
  id: string;
  name: string;
  kind: IntervalKind;
  every: number;
  unit: CalendarUnit;
  hours: number;
  who: string;
  estimate: string;
  spares: { article: string; qty: number }[];
  form: string;
  occurrences: JobOccurrence[];
};
export type CostRow = { order: string; item: string; hours: number; time: number; material: number; purchases: number; downtime: number };
export type Part = {
  id: string;
  name: string;
  path: string;
  tree: string;
  status: Status;
  runHours: number;
  interval: number;
  lastService: number;
  signals: string[];
  events: MachineEvent[];
  images: PartImage[];
  mainImage: string | null;
  jobs: RecurringJob[];
  articles: string[];
  costs: CostRow[];
};
export type MachineItem = FacilityItem & { part?: string; owner?: string };
export type Article = { id: string; artNo: string; name: string; unit: string; min: number; stock: Record<string, number> };

export const TODAY = "2026-10-30";
export const PEOPLE = ["Anna Nilsson", "Erik Lund", "Sara Holm"];
export const FORMS = ["Hydraulkontroll", "Pumpservice", "Filterbyte", "Smörjschema", "Vibrationskontroll"];
export const LOCATIONS = ["Förråd A", "Servicebil 1"];
export const TREES = ["Fabriken Mellanstad", "Pumpstation 2"];

// ---------- Dates (plain ISO days, counted at noon UTC so no clock change moves a day) ----------

const day = (value: string) => new Date(`${value}T12:00:00Z`);
const iso = (date: Date) => date.toISOString().slice(0, 10);
export function addInterval(from: string, every: number, unit: CalendarUnit): string {
  const date = day(from);
  if (unit === "dag") date.setUTCDate(date.getUTCDate() + every);
  else if (unit === "vecka") date.setUTCDate(date.getUTCDate() + every * 7);
  else if (unit === "månad") date.setUTCMonth(date.getUTCMonth() + every);
  else date.setUTCFullYear(date.getUTCFullYear() + every);
  return iso(date);
}
export const addDays = (from: string, days: number) => addInterval(from, days, "dag");
export const shortDate = (value: string) => day(value).toLocaleDateString("sv-SE", { weekday: "short", day: "numeric", month: "short", timeZone: "UTC" });
export function isoWeek(value: string): number {
  const date = day(value);
  date.setUTCDate(date.getUTCDate() + 3 - ((date.getUTCDay() + 6) % 7));
  const yearStart = Date.UTC(date.getUTCFullYear(), 0, 1);
  return Math.ceil(((date.getTime() - yearStart) / 86400000 + 1) / 7);
}

let orderNumber = 1080;
/** The coming occurrences of a job from a first date: the first within a week is Aktiv, the rest Vilande – each its own work order. */
export function planAhead(first: string, every: number, unit: CalendarUnit, count = 12, approx = false): JobOccurrence[] {
  const list: JobOccurrence[] = [];
  let date = first;
  for (let index = 0; index < count; index += 1) {
    list.push({ date, status: index === 0 && date <= addDays(TODAY, 7) ? "Aktiv" : "Vilande", order: `AO-${orderNumber++}`, approx });
    date = addInterval(date, every, unit);
  }
  return list;
}

/** A made-up drawing as the example photo (no real picture of any product). */
function drawing(label: string, hue: number, shape: "pump" | "motor" | "band"): string {
  const body = shape === "pump"
    ? `<rect x="120" y="230" width="400" height="40" rx="8" fill="hsl(${hue} 20% 55%)"/><circle cx="300" cy="190" r="95" fill="hsl(${hue} 45% 45%)"/><circle cx="300" cy="190" r="40" fill="hsl(${hue} 30% 80%)"/><rect x="380" y="150" width="150" height="34" fill="hsl(${hue} 20% 60%)"/>`
    : shape === "motor"
      ? `<rect x="150" y="110" width="300" height="160" rx="18" fill="hsl(${hue} 45% 42%)"/>${[0, 1, 2, 3, 4, 5].map((i) => `<rect x="${175 + i * 45}" y="95" width="16" height="190" rx="4" fill="hsl(${hue} 35% 55%)"/>`).join("")}<rect x="450" y="175" width="80" height="26" fill="hsl(${hue} 15% 60%)"/>`
      : `<rect x="70" y="170" width="500" height="44" rx="22" fill="hsl(${hue} 15% 35%)"/>${[110, 230, 350, 470].map((x) => `<circle cx="${x + 20}" cy="192" r="18" fill="hsl(${hue} 15% 70%)"/>`).join("")}<rect x="180" y="120" width="80" height="50" fill="hsl(${hue} 45% 50%)"/><rect x="330" y="128" width="70" height="42" fill="hsl(${hue} 45% 60%)"/>`;
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 640 400"><rect width="640" height="400" fill="hsl(${hue} 30% 92%)"/><rect y="300" width="640" height="100" fill="hsl(${hue} 15% 80%)"/>${body}<text x="24" y="376" font-family="sans-serif" font-size="26" fill="hsl(${hue} 30% 25%)">${label}</text></svg>`;
  return `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`;
}

const job = (id: string, name: string, kind: IntervalKind, every: number, unit: CalendarUnit, hours: number, who: string, estimate: string, spares: RecurringJob["spares"], form: string, occurrences: JobOccurrence[]): RecurringJob =>
  ({ id, name, kind, every, unit, hours, who, estimate, spares, form, occurrences });
const done = (date: string, order: string): JobOccurrence => ({ date, status: "Klar", order });

export const INITIAL_PARTS: Part[] = [
  {
    id: "pump", name: "Hydraulpump", path: "Linje 2 › Press 4", tree: TREES[0], status: "Service snart", runHours: 4440, interval: 500, lastService: 4000, signals: ["tryck_p4", "temp_olja_p4"],
    events: [{ at: "29/10 03:12", text: "Larm: oljetemperatur hög", alarm: true, order: "AO-1050" }, { at: "29/10 07:40", text: "Driftläge: i drift", alarm: false }],
    images: [{ id: "i1", url: drawing("Hydraulpump, Press 4", 210, "pump"), name: "Hydraulpump framsida" }, { id: "i2", url: drawing("Typskylt", 30, "pump"), name: "Typskylt" }],
    mainImage: "i1",
    jobs: [
      // Run hours: the dates are estimated from how much the press runs (about 500 h in five weeks).
      job("j1", "Service", "Drifttimmar", 5, "vecka", 500, PEOPLE[0], "3 h", [{ article: "a2", qty: 1 }, { article: "a3", qty: 1 }], "Pumpservice", [done("2026-09-25", "AO-1041"), ...planAhead("2026-11-06", 5, "vecka", 11, true)]),
      job("j2", "Byt filter", "Det som kommer först", 3, "månad", 1000, PEOPLE[1], "45 min", [{ article: "a1", qty: 2 }], "Filterbyte", [done("2026-08-14", "AO-1030"), ...planAhead("2026-11-16", 3, "månad", 4)]),
    ],
    articles: ["a1", "a2", "a3"],
    costs: [
      { order: "AO-1050", item: "Underhåll · Hydraulpump (larm)", hours: 3.5, time: 2450, material: 1180, purchases: 0, downtime: 268 },
      { order: "AO-1041", item: "Service", hours: 3, time: 2100, material: 860, purchases: 0, downtime: 0 },
      { order: "AO-1031", item: "Underhåll · Hydraulpump (läckage)", hours: 6, time: 4200, material: 2340, purchases: 3900, downtime: 410 },
    ],
  },
  {
    id: "motor", name: "Huvudmotor", path: "Linje 2 › Press 4", tree: TREES[0], status: "I drift", runHours: 4440, interval: 2000, lastService: 4000, signals: ["ström_m4"],
    events: [{ at: "28/10 14:05", text: "Driftläge: i drift", alarm: false }],
    images: [{ id: "i3", url: drawing("Huvudmotor, Press 4", 150, "motor"), name: "Huvudmotor" }], mainImage: "i3",
    jobs: [job("j3", "Vibrationsmätning", "Kalender", 3, "månad", 0, PEOPLE[2], "30 min", [], "Vibrationskontroll", planAhead("2026-12-02", 3, "månad", 4))],
    articles: ["a4"],
    costs: [{ order: "AO-1022", item: "Vibrationsmätning", hours: 2, time: 1400, material: 0, purchases: 0, downtime: 0 }],
  },
  {
    id: "band", name: "Transportband 1", path: "Linje 2", tree: TREES[0], status: "I drift", runHours: 12100, interval: 1000, lastService: 12000, signals: [],
    events: [], images: [{ id: "i4", url: drawing("Transportband 1", 260, "band"), name: "Transportband" }], mainImage: "i4",
    // Smörjning was due yesterday and is not done: it stays Aktiv and is shown as late until it is done.
    jobs: [job("j4", "Smörjning", "Kalender", 1, "vecka", 0, PEOPLE[1], "20 min", [], "Smörjschema", [done("2026-10-22", "AO-1047"), ...planAhead("2026-10-29", 1, "vecka", 12)])],
    articles: ["a4"], costs: [],
  },
  {
    id: "p1", name: "Pump P1", path: "Pumpstation 2", tree: TREES[1], status: "Ur drift", runHours: 980, interval: 500, lastService: 500, signals: ["larm_p1"],
    events: [{ at: "30/10 05:51", text: "Larm: pumpen stoppad", alarm: true, order: "AO-1058" }],
    images: [], mainImage: null,
    jobs: [job("j5", "Byt tätning", "Kalender", 6, "månad", 0, PEOPLE[0], "1 h", [{ article: "a2", qty: 1 }], "Pumpservice", planAhead("2026-11-20", 6, "månad", 2))],
    articles: ["a2"], costs: [{ order: "AO-1058", item: "Underhåll · Pump P1 (larm)", hours: 1.5, time: 1050, material: 0, purchases: 0, downtime: 95 }],
  },
];

export const ARTICLES: Article[] = [
  { id: "a1", artNo: "HF-010", name: "Hydraulfilter 10 µm", unit: "st", min: 4, stock: { "Förråd A": 2, "Servicebil 1": 1 } },
  { id: "a2", artNo: "TP-40", name: "Tätningssats pump 40 mm", unit: "sats", min: 2, stock: { "Förråd A": 5, "Servicebil 1": 0 } },
  { id: "a3", artNo: "HO-46", name: "Hydraulolja 46, 20 l", unit: "dunk", min: 2, stock: { "Förråd A": 6, "Servicebil 1": 1 } },
  { id: "a4", artNo: "KL-12", name: "Kilrem 12,5 × 1000", unit: "st", min: 2, stock: { "Förråd A": 3, "Servicebil 1": 0 } },
];

const machine = (id: string, name: string, parentId: string | null, objectType: string, extra: Partial<MachineItem> = {}): MachineItem =>
  ({ id, customerId: "", parentId, name, objectType, address: "", postalCode: "", city: "", description: "", isActive: true, ...extra });
export const MACHINES: MachineItem[] = [
  machine("r1", TREES[0], null, "", { owner: "Eget" }),
  machine("l2", "Linje 2", "r1", "Linje"),
  machine("p4", "Press 4", "l2", "Maskin"),
  machine("n-pump", "Hydraulpump", "p4", "Pump", { part: "pump" }),
  machine("n-motor", "Huvudmotor", "p4", "Motor", { part: "motor" }),
  machine("n-band", "Transportband 1", "l2", "Maskin", { part: "band" }),
  machine("r2", TREES[1], null, "", { owner: "Exempelkund Industri AB" }),
  machine("n-p1", "Pump P1", "r2", "Pump", { part: "p1" }),
];

/** A maintenance round over several parts: the Driftrond engine with machine parts as stops; one work order per period, as today. */
export const ROUNDS = [
  { name: "Veckorond Linje 2", rule: "Varje måndag", who: PEOPLE[1], form: "Hydraulkontroll", order: "AO-1055", tree: TREES[0], dates: ["2026-11-02", "2026-11-09", "2026-11-16"], stops: ["Press 4 › Hydraulpump", "Press 4 › Huvudmotor", "Transportband 1"] },
  { name: "Månadsrond Pumpstation 2", rule: "Första måndagen i månaden", who: PEOPLE[0], form: "Hydraulkontroll", order: "AO-1057", tree: TREES[1], dates: ["2026-11-02"], stops: ["Pump P1"] },
];

/** The operator's fault causes: the company's own list (settings later). */
export const FAULT_CAUSES = ["Läckage", "Ovanligt ljud", "Stannar", "Överhettning", "Larm på panelen", "Annat"];
export const SEVERITIES = [
  { id: "Låg", text: "Låg – kan vänta" },
  { id: "Normal", text: "Normal" },
  { id: "Hög", text: "Hög – påverkar produktionen" },
  { id: "Akut", text: "Akut – maskinen står eller risk" },
] as const;
export type Severity = (typeof SEVERITIES)[number]["id"];
export type FaultReport = { id: string; part: string; cause: string; severity: Severity; at: string; order: string; status: "Mottagen" | "Pågår" | "Åtgärdad" };
export const MY_REPORTS: FaultReport[] = [
  { id: "f1", part: "Linje 2 › Transportband 1", cause: "Ovanligt ljud", severity: "Normal", at: "27/10 10:15", order: "AO-1046", status: "Åtgärdad" },
  { id: "f2", part: "Press 4 › Huvudmotor", cause: "Överhettning", severity: "Hög", at: "29/10 14:40", order: "AO-1051", status: "Pågår" },
];
