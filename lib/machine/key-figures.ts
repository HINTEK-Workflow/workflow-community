import { MAX_AGE_MS } from "@/lib/machine/intake";
import { addSwedishDays } from "@/lib/swedish-time";

/**
 * Integrationsmotorn E6 (plan avsnitt 7: "nyckeltal som går att räkna – stilleståndstid, reparationstid, felfrekvens, för
 * lite data när det gäller"; beslut 2026-10-18 punkt 6: sammanfattning 24 månader). Rena regler: ett dygn i siffror ur
 * händelserna, och nyckeltalen för ett objekt (eller en plats med det som ligger under) under en period. Ett tal som inte
 * går att räkna säger varför i stället för att visa noll. Inga gränsvärden: siffrorna är objektets egna.
 *
 * Förval (konstanter här, ändras i koden): perioder 30, 90, 365 och 730 dagar (90 förval); minst 7 dagars underlag för
 * frekvens och MTBF; minst 3 ordrar för median och medel.
 */
export const KEY_FIGURE_PERIODS = [30, 90, 365, 730] as const;
export type KeyFigurePeriod = (typeof KEY_FIGURE_PERIODS)[number];
export const DEFAULT_KEY_FIGURE_PERIOD: KeyFigurePeriod = 90;
export const MIN_COVERAGE_DAYS = 7;
export const MIN_SAMPLES = 3;
/** Dygnssammanfattningen sparas så här länge (beslut 2026-10-18 punkt 6). */
export const DAY_SUMMARY_MONTHS = 24;

export type RunState = "running" | "stopped";
export type SummaryEvent = { at: Date; type: string; state: string | null; severity: string };
export type DaySummary = { events: number; alarms: number; faults: number; stops: number; stoppedMinutes: number; endState: RunState | null };

const minutes = (from: number, to: number) => Math.max(0, to - from) / 60_000;

/**
 * Ett tidsfönster i siffror: händelser, utlösta larm (och de med nivån Fel eller Kritiskt), stopp och minuter stoppad
 * efter maskinens eget driftläge. `startState` är läget när fönstret börjar (föregående dygns slut). Händelser utanför
 * fönstret räknas inte.
 */
export function summariseSpan(input: { events: readonly SummaryEvent[]; startState: RunState | null; from: Date; to: Date }): DaySummary {
  const from = input.from.getTime();
  const to = input.to.getTime();
  const inside = input.events.filter((event) => event.at.getTime() >= from && event.at.getTime() < to).sort((a, b) => a.at.getTime() - b.at.getTime());
  let state: RunState | null = input.startState;
  let cursor = from;
  let stopped = 0;
  const summary = { events: inside.length, alarms: 0, faults: 0, stops: 0 };
  for (const event of inside) {
    if (event.type === "alarm" && event.state === "raised") {
      summary.alarms++;
      if (event.severity === "fault" || event.severity === "critical") summary.faults++;
    }
    if (event.type === "state" && (event.state === "running" || event.state === "stopped")) {
      const at = event.at.getTime();
      if (state === "stopped") stopped += minutes(cursor, at);
      if (event.state === "stopped" && state !== "stopped") summary.stops++;
      state = event.state;
      cursor = at;
    }
  }
  if (state === "stopped") stopped += minutes(cursor, to);
  return { ...summary, stoppedMinutes: Math.round(stopped), endState: state };
}

export type OrderFacts = {
  createdAt: Date;
  /** När ordern skapades (direkt eller när ett förslag godkändes). */
  decidedAt: Date | null;
  acknowledgedAt: Date | null;
  /** Ordern färdigställd (null medan den är öppen eller om den avbröts). */
  completedAt: Date | null;
  /** Ur drift och Åter i drift på ordern (ISO), maskinens eller en persons. */
  stoppedAt: string | null;
  restoredAt: string | null;
};

export type FigureReason = "no_data" | "too_little_data" | "no_state";
export type Figure = { value: number | null; samples: number; reason: FigureReason | null };
export type KeyFigures = {
  periodDays: number;
  /** Dagar med underlag i perioden (från första data i perioden till nu). */
  coverageDays: number;
  /** Sant när underlaget är kortare än perioden (objektet kopplades eller började skicka senare). */
  partialPeriod: boolean;
  alarms: number;
  faults: number;
  stops: number;
  orders: number;
  /** Stilleståndstid i minuter efter maskinens driftläge. */
  downtimeMinutes: Figure;
  /** Median, minuter från order till kvittens. */
  ackMinutes: Figure;
  /** Median, minuter från order till färdigställd. */
  doneMinutes: Figure;
  /** Reparationstid (MTTR): medel av Åter i drift − Ur drift på ordrarna, minuter. */
  repairMinutes: Figure;
  /** Felfrekvens: automatiska ordrar per 30 dagar. */
  ordersPer30Days: Figure;
  /** MTBF: drifttid mellan fel, timmar. */
  mtbfHours: Figure;
};

const figure = (value: number | null, samples: number, reason: FigureReason | null = null): Figure => ({ value: reason ? null : value, samples, reason });
const median = (values: number[]) => {
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
};
const mean = (values: number[]) => values.reduce((sum, value) => sum + value, 0) / values.length;
const round = (value: number, decimals = 0) => Math.round(value * 10 ** decimals) / 10 ** decimals;
const spanMinutes = (from: Date | string | null, to: Date | string | null) => {
  if (!from || !to) return null;
  const start = new Date(from).getTime();
  const end = new Date(to).getTime();
  return Number.isFinite(start) && Number.isFinite(end) && end >= start ? (end - start) / 60_000 : null;
};

/** MAX_AGE_MS in days, and the night after the event: a late event is counted the night after it came. */
const RECOUNT_DAYS = Math.ceil(MAX_AGE_MS / 86_400_000) + 1;

/**
 * Where the night's count starts: at the latest summary's day when that is further back, else RECOUNT_DAYS back, since an event
 * may come a week late. Never before the part's first event, and never further back than the events live. Every later day's end
 * state follows the count.
 */
export function firstDayToCount(input: { lastSummarised: Date | null; firstEvent: Date; earliest: Date; today: Date }) {
  const { lastSummarised, firstEvent, earliest, today } = input;
  const late = addSwedishDays(today, -RECOUNT_DAYS);
  const start = !lastSummarised ? firstEvent : lastSummarised < late ? lastSummarised : late;
  return new Date(Math.max(start.getTime(), earliest.getTime(), firstEvent.getTime()));
}

/**
 * När ordern gavs: när raden beslutades. Rader som stängdes före 0.41.0 fick beslutstiden överskriven med stängningen; en sådan
 * tid ligger efter kvittensen eller färdigställandet, och då gäller radens egen tid.
 */
const orderStart = (order: Pick<OrderFacts, "createdAt" | "decidedAt">, end: Date | null) =>
  order.decidedAt && (!end || order.decidedAt.getTime() <= end.getTime()) ? order.decidedAt : order.createdAt;

/**
 * Nyckeltalen. `totals` är summan av dygnen (och dagens del) för platsen; `hasState` är sant om maskinen alls skickat
 * driftlägen (annars går stillestånd och MTBF inte att räkna på maskinens egna uppgifter). `firstDataAt` är det tidigaste
 * underlaget i perioden; null betyder inga data.
 */
export function machineKeyFigures(input: {
  now: Date; periodDays: number; firstDataAt: Date | null;
  totals: Omit<DaySummary, "endState"> & { hasState: boolean };
  orders: readonly OrderFacts[];
}): KeyFigures {
  const periodStart = input.now.getTime() - input.periodDays * 86_400_000;
  const first = input.firstDataAt ? Math.max(periodStart, input.firstDataAt.getTime()) : null;
  const coverageMinutes = first === null ? 0 : minutes(first, input.now.getTime());
  const coverageDays = round(coverageMinutes / 1440, 1);
  const none = first === null;
  const short = coverageDays < MIN_COVERAGE_DAYS;
  const orders = input.orders.length;

  const ack = input.orders.flatMap((order) => { const value = spanMinutes(orderStart(order, order.acknowledgedAt), order.acknowledgedAt); return value === null ? [] : [value]; });
  const done = input.orders.flatMap((order) => { const value = spanMinutes(orderStart(order, order.completedAt), order.completedAt); return value === null ? [] : [value]; });
  const repair = input.orders.flatMap((order) => { const value = spanMinutes(order.stoppedAt, order.restoredAt); return value === null ? [] : [value]; });
  const sampled = (values: number[], pick: (values: number[]) => number) =>
    none ? figure(null, values.length, "no_data") : values.length < MIN_SAMPLES ? figure(null, values.length, "too_little_data") : figure(round(pick(values)), values.length);

  const downtime = none ? figure(null, 0, "no_data") : !input.totals.hasState ? figure(null, 0, "no_state") : figure(input.totals.stoppedMinutes, input.totals.stops);
  const frequency = none ? figure(null, orders, "no_data") : short ? figure(null, orders, "too_little_data") : figure(round((orders / (coverageMinutes / 1440)) * 30, 1), orders);
  const operatingMinutes = coverageMinutes - (input.totals.hasState ? input.totals.stoppedMinutes : 0);
  const mtbf = none ? figure(null, orders, "no_data") : short || orders < MIN_SAMPLES ? figure(null, orders, "too_little_data") : figure(round(Math.max(0, operatingMinutes) / orders / 60, 1), orders);

  return {
    periodDays: input.periodDays, coverageDays, partialPeriod: !none && first! > periodStart + 86_400_000,
    alarms: input.totals.alarms, faults: input.totals.faults, stops: input.totals.stops, orders,
    downtimeMinutes: downtime, ackMinutes: sampled(ack, median), doneMinutes: sampled(done, median), repairMinutes: sampled(repair, mean),
    ordersPer30Days: frequency, mtbfHours: mtbf,
  };
}

/** Minuter som kort text: "45 min", "3 h 20 min", "2 d 4 h". */
export function durationText(totalMinutes: number) {
  const value = Math.max(0, Math.round(totalMinutes));
  if (value < 60) return `${value} min`;
  const days = Math.floor(value / 1440);
  const hours = Math.floor((value % 1440) / 60);
  const rest = value % 60;
  if (days) return hours ? `${days} d ${hours} h` : `${days} d`;
  return rest ? `${hours} h ${rest} min` : `${hours} h`;
}

export const FIGURE_REASON_TEXT: Record<FigureReason, string> = {
  no_data: "Inga data än",
  too_little_data: "För lite data",
  no_state: "Maskinen skickar inget driftläge",
};

const decimal = (value: number) => value.toLocaleString("sv-SE", { maximumFractionDigits: 1 });

/** Raderna som sidan visar: etikett, värde (eller skälet) och en förklaring av hur talet räknas. */
export function keyFigureRows(figures: KeyFigures): { key: string; label: string; value: string; hint: string; missing: boolean }[] {
  const show = (item: Figure, format: (value: number) => string) => item.value === null ? FIGURE_REASON_TEXT[item.reason ?? "no_data"] : format(item.value);
  const count = (value: number) => value.toLocaleString("sv-SE");
  return [
    { key: "alarms", label: "Larm", value: count(figures.alarms), hint: `Utlösta larm, varav ${count(figures.faults)} med nivån Fel eller Kritiskt.`, missing: false },
    { key: "orders", label: "Automatiska arbetsordrar", value: count(figures.orders), hint: "Larm som blev en märkt arbetsorder (direkt eller efter godkännande).", missing: false },
    { key: "downtime", label: "Stilleståndstid", value: show(figures.downtimeMinutes, durationText), hint: `Tid i läget Stoppad enligt maskinens eget driftläge, ${count(figures.stops)} stopp.`, missing: figures.downtimeMinutes.value === null },
    { key: "ack", label: "Tid till kvittens", value: show(figures.ackMinutes, durationText), hint: `Median från order till Jag tar den (eller att någon blev ansvarig), ${figures.ackMinutes.samples} ordrar.`, missing: figures.ackMinutes.value === null },
    { key: "done", label: "Tid till färdigställd", value: show(figures.doneMinutes, durationText), hint: `Median från order till färdigställd, ${figures.doneMinutes.samples} ordrar.`, missing: figures.doneMinutes.value === null },
    { key: "repair", label: "Reparationstid (MTTR)", value: show(figures.repairMinutes, durationText), hint: `Medel av Åter i drift minus Ur drift på ordrarna, ${figures.repairMinutes.samples} ordrar.`, missing: figures.repairMinutes.value === null },
    { key: "frequency", label: "Felfrekvens", value: show(figures.ordersPer30Days, (value) => `${decimal(value)} per 30 dagar`), hint: `Automatiska arbetsordrar per 30 dagar, räknat på ${decimal(figures.coverageDays)} dagars underlag.`, missing: figures.ordersPer30Days.value === null },
    { key: "mtbf", label: "Tid mellan fel (MTBF)", value: show(figures.mtbfHours, (value) => `${decimal(value)} h`), hint: "Drifttid (underlaget minus stillestånd) delat med antalet automatiska arbetsordrar.", missing: figures.mtbfHours.value === null },
  ];
}
