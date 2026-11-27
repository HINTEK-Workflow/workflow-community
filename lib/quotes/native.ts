import { formatPrice, parseAmount } from "@/lib/workflow/expenses";
import { QUOTE_LINE_KIND_LABELS, QUOTE_LINE_KINDS, type QuoteLineKind, type QuoteStatus } from "./model";

/**
 * Offerter på nivå 1 (2026-10-09/10, docs/ui-system.md 9): Mina offerter as the phone's grouped list and a quote as
 * a menu of rows where each row opens a screen of its own (`&step=` in the address, `&line=` for one line). Pure, so the
 * pages and the tests read the same rules. Display only: the server decides every action as before.
 */
export const QUOTE_SCREENS = ["rader", "rad", "uppgifter", "summa", "skicka", "versioner", "andringar"] as const;
export type QuoteScreen = (typeof QUOTE_SCREENS)[number];
export const QUOTE_SCREEN_TITLE: Record<QuoteScreen, string> = {
  rader: "Rader", rad: "Rad", uppgifter: "Uppgifter", summa: "Summa", skicka: "Skicka till kund", versioner: "Versioner", andringar: "Ändringar",
};
export function parseQuoteScreen(value: string | null | undefined): QuoteScreen | null {
  return value && (QUOTE_SCREENS as readonly string[]).includes(value) ? value as QuoteScreen : null;
}

/**
 * The list's groups, in the order the work follows them up: sent quotes waiting for the customer's answer first, then
 * drafts, accepted, and what is over (declined or expired). Inside a group the list's own order (latest change first).
 */
export const QUOTE_GROUP_ORDER = ["waiting", "draft", "accepted", "closed"] as const;
export type QuoteGroupKey = (typeof QUOTE_GROUP_ORDER)[number];
export const QUOTE_GROUP_LABEL: Record<QuoteGroupKey, string> = { waiting: "Väntar på kundens svar", draft: "Utkast", accepted: "Accepterade", closed: "Avböjda och utgångna" };
export function quoteGroupOf(status: QuoteStatus): QuoteGroupKey {
  return status === "SENT" ? "waiting" : status === "DRAFT" ? "draft" : status === "ACCEPTED" ? "accepted" : "closed";
}
export function quoteListGroups<T extends { status: QuoteStatus }>(items: readonly T[]): { key: QuoteGroupKey; label: string; items: T[] }[] {
  const groups = new Map<QuoteGroupKey, T[]>();
  for (const item of items) { const key = quoteGroupOf(item.status); groups.set(key, [...(groups.get(key) ?? []), item]); }
  return QUOTE_GROUP_ORDER.filter((key) => groups.has(key)).map((key) => ({ key, label: QUOTE_GROUP_LABEL[key], items: groups.get(key)! }));
}

/** A quote's lines as groups per kind (Material, Arbete, Övrigt), in the quote's own order inside each kind. */
export function quoteLineGroups<T extends { kind: QuoteLineKind }>(lines: readonly T[]): { kind: QuoteLineKind; label: string; lines: T[] }[] {
  return QUOTE_LINE_KINDS.map((kind) => ({ kind, label: QUOTE_LINE_KIND_LABELS[kind], lines: lines.filter((line) => line.kind === kind) })).filter((group) => group.lines.length);
}

/** One line under a line's name: "4 st", "14 h", or what is missing ("Antal saknas"). Never a price. */
export function quoteLineSubtitle(line: { quantity: string; unit: string }): string {
  const quantity = line.quantity.trim();
  if (!quantity) return "Antal saknas";
  const parsed = parseAmount(quantity);
  return [parsed === null ? quantity : formatPrice(parsed), line.unit.trim()].filter(Boolean).join(" ");
}

/** An amount in whole kronor with the Swedish thousands space ("29 619"), for a row where öre would not fit. */
export function formatKronor(value: number): string {
  if (!Number.isFinite(value)) return "–";
  const rounded = Math.round(value);
  return `${rounded < 0 ? "-" : ""}${String(Math.abs(rounded)).replace(/\B(?=(\d{3})+(?!\d))/g, " ")}`;
}
