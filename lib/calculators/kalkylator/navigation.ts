import { quantityText } from "../present";
import type { Outcome, Tone } from "../types";
import { CALC_ENTRIES, DEFAULT_ENTRY, entryById, partOf, type CalcEntry, type CalcPart } from "./list";

/**
 * The address and the summary of the Kalkylator page (2026-10-12): which calculator and which part of it is open
 * (`?view=calculators&tool=<entry>&part=<part>`, so a link, a reload and the browser's Bakåt open the same one), and the few
 * figures the phone's result bar shows under the fields. Plain functions, so they are tested without a browser.
 */
export const CALC_VIEW = "calculators";
/** The phone's screen "Företagets värden" (2026-10-12): the Kalkylator's own values, last in the list at display level 1. */
export const COMPANY_VALUES_TOOL = "company-values";
export const companyValuesOpen = (params: { get(name: string): string | null }) => params.get("tool") === COMPANY_VALUES_TOOL;

export function calcHref(entryId?: string | null, partId?: string | null): string {
  const query = [entryId ? `&tool=${encodeURIComponent(entryId)}` : "", entryId && partId ? `&part=${encodeURIComponent(partId)}` : ""].join("");
  return `/?view=${CALC_VIEW}${query}`;
}

export type CalcSelection = { entry: CalcEntry | null; part: CalcPart | null };
/** The open calculator from the address: none (the list) when `tool` is missing or unknown. */
export function readSelection(params: { get(name: string): string | null }): CalcSelection {
  const entry = entryById(params.get("tool")) ?? null;
  return { entry, part: entry ? partOf(entry, params.get("part")) : null };
}
/** On a computer the list is the row of tabs, so there is always one open calculator. */
export function readSelectionOrDefault(params: { get(name: string): string | null }): { entry: CalcEntry; part: CalcPart } {
  const { entry, part } = readSelection(params);
  const chosen = entry ?? entryById(DEFAULT_ENTRY) ?? CALC_ENTRIES[0]!;
  return { entry: chosen, part: part ?? partOf(chosen, null) };
}

export type DockItem = { label: string; text: string; tone: Tone };
export type DockSummary = { state: "waiting" | "invalid" | "ok"; items: DockItem[]; message: string };
/**
 * What the result bar under the fields shows: the main figures (at most two, with their short labels so nothing breaks mid-word)
 * and the verdict's first words ("Klarar kravet · baserat på förslag"), or why there is none yet. A row with `dock: false` leaves
 * its place to the next one.
 */
export function dockSummary(outcome: Outcome | null): DockSummary {
  if (!outcome) return { state: "ok", items: [], message: "" };
  if (outcome.status === "incomplete") return { state: "waiting", items: [], message: outcome.message };
  if (outcome.status === "invalid") return { state: "invalid", items: [], message: outcome.errors[0]?.message ?? "Rätta de markerade fälten." };
  const items: DockItem[] = [];
  for (const row of outcome.rows) {
    if (row.kind === "verdict") items.unshift({ label: "Bedömning", text: row.text.split(/[:.]/)[0]!.trim(), tone: row.tone });
    else if (row.primary && row.dock !== false && items.filter((item) => item.label !== "Bedömning").length < 2) items.push({ label: row.short ?? row.label, text: quantityText(row), tone: row.tone ?? "neutral" });
  }
  return { state: "ok", items: items.slice(0, 3), message: "" };
}
