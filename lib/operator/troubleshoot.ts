import type { MachineHistory } from "@/lib/operator/machines";

/**
 * AI-felsökning före felanmälan (2026-10-30) – PREPARED and OFF. Shown and asked only when both the product
 * owner's switch (Installation) and the company's (Administration › Operatörskonton) are on; with either off,
 * the page shows nothing and the server asks nothing (app/operator/api/troubleshoot answers 404).
 *
 * This first step is rules only – no language model is called and nothing leaves Workflow: the company's own finished work
 * on the machine (what was done last time) and the machine connection's alarms in the last day. Every suggestion carries
 * its basis, the operator can skip it, and it never decides anything: safety decisions stay with a person. A model may
 * later phrase the same suggestions (rules first, lib/ai), behind the same two switches.
 */
export type TroubleshootSuggestion = { text: string; basis: string };
export const SUGGESTION_LIMIT = 3;

const short = (value: string, max: number) => value.replace(/\s+/g, " ").trim().slice(0, max);
const day = (iso: string) => iso.slice(0, 10);

export function troubleshootSuggestions(input: { cause: string; history: MachineHistory }): TroubleshootSuggestion[] {
  const cause = input.cause.trim().toLowerCase();
  const suggestions: TroubleshootSuggestion[] = [];
  // The same cause before, with what was done: the most direct hint.
  const same = input.history.work.filter((item) => item.done && cause && item.cause.toLowerCase().includes(cause));
  if (same.length) {
    suggestions.push({
      text: `Förra gången: ${short(same[0].done, 160)}`,
      basis: `${same.length === 1 ? "Arbetsorder" : `${same.length} arbetsordrar`} med samma orsak: ${same.slice(0, 3).map((item) => `${item.label} (${day(item.at)})`).join(", ")}.`,
    });
  }
  // The machine itself said something in the last day.
  if (input.history.alarms.length) {
    const latest = input.history.alarms[0];
    suggestions.push({
      text: `Maskinen larmade: ${short(latest.text || latest.code, 120)}. Kontrollera det först.`,
      basis: `${input.history.alarms.length} larm från maskinen senaste dygnet (senast ${latest.at.slice(11, 16)}).`,
    });
  }
  // Otherwise the latest finished work on the machine, whatever it was.
  const other = input.history.work.find((item) => item.done && !same.includes(item));
  if (other && suggestions.length < SUGGESTION_LIMIT)
    suggestions.push({ text: `Senast gjort på maskinen: ${short(other.done, 160)}`, basis: `${other.label} (${day(other.at)}).` });
  return suggestions.slice(0, SUGGESTION_LIMIT);
}
