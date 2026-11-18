import type { RankedRow, Report } from "./report";

/**
 * Beteendeanalys in words (2026-11-16: "så jag förstår vad folk tittar efter och ser"): a few short lines worked out
 * from the same anonymous day sums as the rest of the page, and a line about what they may mean. Nothing here knows of a
 * person; a count is a page load or a press. Pure, so the page and the tests use the same sentences.
 */
export type Insights = { facts: string[]; meaning: string[] };

const share = (part: number, whole: number) => (whole > 0 ? Math.min(100, Math.round((part / whole) * 100)) : null);
const pct = (value: number) => `${value.toLocaleString("sv-SE")} %`;
const count = (value: number) => value.toLocaleString("sv-SE");
const sum = (rows: readonly RankedRow[]) => rows.reduce((total, row) => total + row.count, 0);
const of = (rows: readonly RankedRow[], key: string) => rows.find((row) => row.key === key)?.count ?? 0;

/** The rows the most first, the empty ones left out (a fixed list such as the buttons, ranked for reading). */
export const rankByCount = (rows: readonly RankedRow[]): RankedRow[] => rows.filter((row) => row.count > 0).sort((a, b) => b.count - a.count || a.label.localeCompare(b.label, "sv"));

/** The website: how much is seen, how often a visit goes on to a press, what is pressed and seen most, and on what screen. */
export function siteInsights(landing: Report["landing"]): Insights {
  if (!landing.hasData) return { facts: [], meaning: [] };
  const facts: string[] = [], meaning: string[] = [];
  const devices = sum(landing.devices);
  const mobile = share(of(landing.devices, "device:mobile"), devices);
  facts.push(`${count(landing.views)} sidvisningar${mobile === null ? "" : `, ${pct(mobile)} på mobil`}.`);
  const clicks = sum(landing.clicks);
  const pressed = share(clicks, landing.views);
  const top = rankByCount(landing.clicks)[0];
  facts.push(clicks && top ? `${count(clicks)} knapptryck, motsvarande ${pct(pressed ?? 0)} av sidvisningarna. Mest tryckt: ${top.label} (${count(top.count)}).` : "Ingen av de räknade knapparna trycktes.");
  const feature = landing.pages.find((row) => row.key !== "page:start" && row.count > 0);
  facts.push(feature ? `Mest besökta undersidan: ${feature.label.replace(/^Undersida: /, "")} (${count(feature.count)}).` : "Ingen undersida visades.");
  if (pressed !== null && pressed < 5) meaning.push("Få går vidare från sidan. Knapparna kan behöva synas tydligare.");
  else if (pressed !== null && pressed >= 20) meaning.push("Många går vidare från sidan, så knapparna syns.");
  if (mobile !== null && mobile >= 50) meaning.push("De flesta tittar i mobilen. Sidan bör vara lätt att läsa där.");
  return { facts, meaning };
}

/** The demo: how it is reached, on what screen, whether the tour is gone through and how long a visit stays. */
export function demoInsights(demo: Report["demo"]): Insights {
  if (!demo.hasData) return { facts: [], meaning: [] };
  const facts: string[] = [], meaning: string[] = [];
  const devices = sum(demo.devices);
  const mobile = share(of(demo.devices, "device_mobile"), devices);
  facts.push(`${count(demo.starts.total)} demostarter${mobile === null ? "" : `, ${pct(mobile)} från mobil`}.`);
  const way = rankByCount(demo.starts.rows)[0];
  if (way) facts.push(`Vanligaste vägen in: ${way.label}.`);
  const started = of(demo.flows, "flow_tour_start");
  const done = share(of(demo.flows, "flow_tour_done"), started);
  if (started && done !== null) facts.push(`${pct(done)} av dem som började rundturen gick igenom den.`);
  const timed = sum(demo.time);
  const stayed = share(of(demo.time, "time_3to10") + of(demo.time, "time_gt10"), timed);
  if (stayed !== null) facts.push(`${pct(stayed)} stannade längre än 3 minuter.`);
  const page = demo.views.find((row) => row.count > 0);
  if (page) facts.push(`Mest öppnade sidan i demon: ${page.label}.`);
  if (mobile !== null && mobile >= 40) meaning.push("Många provar demon i mobilen. Mobilens start i demon är viktig.");
  if (stayed !== null && stayed < 25) meaning.push("De flesta lämnar demon snabbt. Det första de ser behöver visa nyttan direkt.");
  if (started && done !== null && done < 30) meaning.push("Få gör klart rundturen. Den kan behöva bli kortare.");
  return { facts, meaning };
}
