import type { CatalogueSnapshot } from "@/lib/catalogue/snapshot";
import { expenseTotal, formatPrice, formatSek, isExpenseRow, parseAmount, type MaterialRow } from "@/lib/workflow/expenses";
import { materialRowPrice, parsePercent, roundOre } from "@/lib/workflow/material-prices";
import { QUOTE_LINE_DEFAULT_UNIT, quoteLabel, quoteLineNumbers, type QuoteLineView } from "./model";

/**
 * Offert steg C (2026-10-09, docs/proposals/material-pris-offert-2026-10-09.md, avsnitt 6). Pure rules shared by
 * the server, the page and the tests:
 * 1. Materiallista → offert: a project's or a work order's material rows (never the expense rows) become quote lines,
 *    summed per Benämning and Enhet like *Material i projektet*. The price is the row's own copy (à-pris, påslag and
 *    catalogue copy); a line without one gets the company's markup and stays without à-pris until someone prices it.
 *    Antal that is not a number is kept as written, so the person sees it and corrects it before saving.
 * 2. Accepterad offert → arbetsorder: the quote's Material lines become the work order's material rows (benämning,
 *    antal, enhet, à-pris, påslag, catalogue copy) with `quoteRef`, a copy of where the line came from and its selling
 *    price. The work order never changes when the quote does. Since 2026-10-09 ("bygg klart"): the Arbete lines
 *    become the work order's planned work – the lines in hours summed as Uppskattad tid (estimatedMinutes) and every
 *    Arbete line named in an "Offererat arbete" summary in the description (names and antal only, never a price) – and
 *    the Övrigt lines become expense rows at the quote's selling price excl. VAT, each with its `quoteRef`.
 * 3. Offererat mot använt: the accepted quotes' Material lines against the project's work orders' material rows, per
 *    Benämning and Enhet, with antal and amounts at selling price excl. VAT; the Arbete hours against the time reported
 *    on the work orders; the Övrigt lines against the work orders' expense rows. Nothing is changed by the comparison.
 */

/** A material row's link back to the accepted quote it was made from (stored on the row, like `catalogue`). */
export type QuoteRef = { quoteId: string; quoteLabel: string; version: number; lineId: string; unitPrice: string };

const tidy = (text: string | undefined) => (text ?? "").replace(/\s+/g, " ").trim();
const keyOf = (name: string, unit: string) => `${tidy(name).toLocaleLowerCase("sv-SE")}\u0000${tidy(unit).toLocaleLowerCase("sv-SE")}`;
const quantityText = (value: number) => formatPrice(value).replace("−", "-");

type SourceRow = Pick<MaterialRow, "name" | "quantity" | "unit" | "kind" | "unitPrice" | "markupPercent" | "catalogue" | "amount"> & Partial<Pick<MaterialRow, "articleNo" | "articleSource" | "manufacturerArticleNo">>;

/**
 * Material rows (newest work order first) → quote lines of kind Material. Rows with the same Benämning and Enhet are
 * one line; the first row with a price gives the line its à-pris, påslag and catalogue copy. `rows` on the result tells
 * how many material rows were read; `mixedPrices` how many lines had rows with different à-pris (the first was used).
 */
export function quoteLinesFromMaterials(rows: readonly SourceRow[], options: { companyMarkup?: string; newId: () => string }): { lines: QuoteLineView[]; rows: number; mixedPrices: number } {
  type Acc = { name: string; unit: string; sum: number; numeric: boolean; other: string[]; priced: SourceRow | null; prices: Set<string>; numbered: SourceRow | null };
  const groups = new Map<string, Acc>();
  let count = 0;
  for (const row of rows) {
    if (isExpenseRow(row)) continue;
    const name = tidy(row.name);
    if (!name) continue;
    count += 1;
    const unit = tidy(row.unit);
    const key = keyOf(name, unit);
    const acc = groups.get(key) ?? { name, unit, sum: 0, numeric: false, other: [], priced: null, prices: new Set<string>(), numbered: null };
    const quantity = tidy(row.quantity);
    const value = quantity ? parseAmount(quantity) : null;
    if (value !== null) { acc.sum += value; acc.numeric = true; }
    else if (quantity && !acc.other.includes(quantity)) acc.other.push(quantity);
    // Artikelnummer (2026-10-11): the first row of the line that has one gives it to the quote line.
    if (!acc.numbered && tidy(row.articleNo)) acc.numbered = row;
    const price = parseAmount(row.unitPrice);
    if (price !== null) {
      acc.prices.add(String(price));
      if (!acc.priced) acc.priced = row;
    }
    groups.set(key, acc);
  }
  const companyMarkup = parsePercent(options.companyMarkup);
  let mixedPrices = 0;
  const lines = [...groups.values()].map((acc): QuoteLineView => {
    if (acc.prices.size > 1) mixedPrices += 1;
    const total = acc.numeric ? Math.round(acc.sum * 10000) / 10000 : null;
    const priced = acc.priced;
    const ownMarkup = priced ? parsePercent(priced.markupPercent) : null;
    const markup = ownMarkup ?? companyMarkup;
    return {
      id: options.newId(), kind: "MATERIAL", name: acc.name,
      quantity: [...(total === null ? [] : [quantityText(total)]), ...acc.other].join(" + "),
      unit: acc.unit || QUOTE_LINE_DEFAULT_UNIT.MATERIAL,
      unitPrice: priced ? formatPrice(parseAmount(priced.unitPrice)!) : "",
      markupPercent: markup === null ? "" : formatPrice(markup),
      ...(priced?.catalogue ? { catalogue: priced.catalogue as CatalogueSnapshot } : {}),
      ...(acc.numbered ? { articleNo: tidy(acc.numbered.articleNo).slice(0, 60), ...(tidy(acc.numbered.articleSource) ? { articleSource: tidy(acc.numbered.articleSource).slice(0, 200) } : {}), ...(tidy(acc.numbered.manufacturerArticleNo) ? { manufacturerArticleNo: tidy(acc.numbered.manufacturerArticleNo).slice(0, 60) } : {}) } : {}),
    };
  });
  return { lines, rows: count, mixedPrices };
}

/** The quote's Material lines as work order material rows, each with its `quoteRef`. Arbete and Övrigt stay on the quote. */
export function workOrderMaterialsFromQuote(quote: { id: string; number: number; version: number }, lines: readonly QuoteLineView[], newId: () => string): (MaterialRow & { quoteRef: QuoteRef })[] {
  const label = quoteLabel(quote);
  return lines.filter((line) => line.kind === "MATERIAL" && tidy(line.name)).map((line) => {
    const numbers = quoteLineNumbers(line);
    const unitPrice = numbers.unitPrice === null ? "" : formatPrice(numbers.unitPrice);
    const markup = numbers.markup === null ? "" : formatPrice(numbers.markup);
    return {
      id: newId(), kind: "material", name: tidy(line.name).slice(0, 300), quantity: line.quantity.slice(0, 40), unit: line.unit.slice(0, 40),
      ...(unitPrice ? { unitPrice } : {}), ...(markup ? { markupPercent: markup } : {}),
      ...(line.catalogue ? { catalogue: line.catalogue } : {}),
      ...(tidy(line.articleNo) ? { articleNo: tidy(line.articleNo).slice(0, 60), ...(tidy(line.articleSource) ? { articleSource: tidy(line.articleSource).slice(0, 200) } : {}) } : {}),
      ...(tidy(line.manufacturerArticleNo) ? { manufacturerArticleNo: tidy(line.manufacturerArticleNo).slice(0, 60) } : {}),
      quoteRef: { quoteId: quote.id, quoteLabel: label, version: quote.version, lineId: line.id, unitPrice: numbers.saleUnitPrice === null ? "" : formatPrice(numbers.saleUnitPrice) },
    };
  });
}

/**
 * The quote's Övrigt lines as the work order's expense rows: antal and enhet as quoted, à-pris and belopp at the quote's
 * selling price excl. VAT (the expense rows have no markup of their own, and the customer has seen these prices), each
 * with its `quoteRef`. A line without a price becomes a row without à-pris and belopp, to be filled in.
 */
export function workOrderExpensesFromQuote(quote: { id: string; number: number; version: number }, lines: readonly QuoteLineView[], newId: () => string): (MaterialRow & { quoteRef: QuoteRef })[] {
  const label = quoteLabel(quote);
  return lines.filter((line) => line.kind === "OTHER" && tidy(line.name)).map((line) => {
    const numbers = quoteLineNumbers(line);
    const sale = numbers.saleUnitPrice === null ? "" : formatPrice(numbers.saleUnitPrice);
    return {
      id: newId(), kind: "expense", name: tidy(line.name).slice(0, 300), quantity: line.quantity.slice(0, 40), unit: line.unit.slice(0, 40),
      ...(sale ? { unitPrice: sale } : {}), ...(numbers.amount === null ? {} : { amount: formatSek(numbers.amount) }),
      quoteRef: { quoteId: quote.id, quoteLabel: label, version: quote.version, lineId: line.id, unitPrice: sale },
    };
  });
}

/** Units an Arbete line counts as hours ("h", "tim", "timmar"); a line in another unit (st, fast pris) is not time. */
const HOUR_UNITS = new Set(["h", "tim", "timme", "timmar", "timmer"]);
export const isHourUnit = (unit: string) => HOUR_UNITS.has(tidy(unit).toLocaleLowerCase("sv-SE").replace(/\.$/, ""));

export type QuotedWork = {
  /** The Arbete lines with a name, as quoted (antal as written). */
  lines: { name: string; quantity: string; unit: string }[];
  /** The lines in hours, summed, in whole minutes; null when no Arbete line is in hours with a numeric antal. */
  minutes: number | null;
  /** Arbete lines that are not counted as time (another unit, or an antal that is not a number). */
  uncounted: number;
};

/** The quote's Arbete lines: what is planned, and the hours as minutes for the work order's Uppskattad tid. */
export function quotedWork(lines: readonly Pick<QuoteLineView, "kind" | "name" | "quantity" | "unit">[]): QuotedWork {
  const work = lines.filter((line) => line.kind === "LABOUR" && tidy(line.name));
  let hours = 0, counted = 0;
  for (const line of work) {
    const value = parseAmount(line.quantity);
    if (value === null || value < 0 || !isHourUnit(line.unit)) continue;
    hours += value;
    counted += 1;
  }
  return {
    lines: work.map((line) => ({ name: tidy(line.name), quantity: tidy(line.quantity), unit: tidy(line.unit) })),
    minutes: counted ? Math.round(hours * 60) : null,
    uncounted: work.length - counted,
  };
}

/** "Offererat arbete: Montör 8 h, Driftsättning 1 st. Totalt 8 h." – names and antal only, never a price (everyone on the order reads it). */
export function quotedWorkText(work: QuotedWork): string {
  if (!work.lines.length) return "";
  const items = work.lines.map((line) => [line.name, [line.quantity, line.unit].filter(Boolean).join(" ")].filter(Boolean).join(" "));
  const total = work.minutes !== null && work.lines.length > 1 ? ` Totalt ${formatPrice(work.minutes / 60)} h.` : "";
  return `Offererat arbete: ${items.join(", ")}.${total}`;
}

export type WorkOrderPlan = {
  /** Material rows first, then the expense rows, all with their `quoteRef`. */
  rows: (MaterialRow & { quoteRef: QuoteRef })[];
  materials: number; expenses: number;
  /** Uppskattad tid from the Arbete lines in hours; null when none. */
  estimatedMinutes: number | null;
  work: QuotedWork;
  /** The work order's description: the quote it follows, the quoted work and the quote's scope. */
  description: string;
};

/** Accepterad offert → arbetsorder: everything the new work order gets from the quote. */
export function workOrderPlanFromQuote(quote: { id: string; number: number; version: number; description?: string }, lines: readonly QuoteLineView[], newId: () => string): WorkOrderPlan {
  const materials = workOrderMaterialsFromQuote(quote, lines, newId);
  const expenses = workOrderExpensesFromQuote(quote, lines, newId);
  const work = quotedWork(lines);
  const parts = [`Enligt offert ${quoteLabel(quote)}.`, quotedWorkText(work), (quote.description ?? "").trim()].filter(Boolean);
  return { rows: [...materials, ...expenses], materials: materials.length, expenses: expenses.length, estimatedMinutes: work.minutes, work, description: parts.join("\n\n").slice(0, 5000) };
}

/** The agreement per quote number: its latest accepted version (an ÄTA accepted later replaces the one before). */
export function agreedQuoteVersions<T extends { number: number; version: number; status: string }>(rows: readonly T[]): T[] {
  const byNumber = new Map<number, T>();
  for (const row of [...rows].sort((a, b) => a.number - b.number || a.version - b.version)) if (row.status === "ACCEPTED") byNumber.set(row.number, row);
  return [...byNumber.values()];
}

export type QuoteComparisonLine = {
  name: string; unit: string;
  /** Summed Antal; null when nothing numeric was quoted / used. */
  quoted: number | null; used: number | null;
  /** Antal that was used but is not a number ("ca 20"), kept as written. */
  usedOther: string[];
  /** used − quoted, when both are numbers (a line only on one side counts the other as 0). */
  difference: number | null;
  /** Selling amounts excl. VAT; `usedAmount` is null when a used row lacks a price. */
  quotedAmount: number | null; usedAmount: number | null;
};
export type QuoteComparison = {
  lines: QuoteComparisonLine[];
  totals: { quotedAmount: number; usedAmount: number; usedUnpriced: number; quotedUnpriced: number; difference: number };
  /**
   * Arbete: the quoted hours (Arbete lines in hours, as minutes; null when none) against the time reported on the work
   * orders (finished entries, minutes; null when not given). `uncounted` = Arbete lines not in hours; `quotedAmount` =
   * the Arbete lines at selling price excl. VAT.
   */
  labour: { quotedMinutes: number | null; reportedMinutes: number | null; differenceMinutes: number | null; uncounted: number; quotedAmount: number };
  /** Övrigt: the quoted Övrigt lines against the work orders' expense rows, excl. VAT; `usedMissing` = rows with an unreadable belopp. */
  other: { quotedAmount: number; quotedUnpriced: number; usedAmount: number; usedRows: number; usedMissing: number; difference: number };
};

/**
 * Offererat mot använt: Material lines of the accepted quotes against the material rows of the project's work orders,
 * per Benämning and Enhet (case and spacing ignored). Used amounts are the rows' own selling amounts (à-pris with påslag).
 * Arbete is compared as hours against `reportedSec` (the work orders' finished time; leave it out when the caller may
 * not read it) and Övrigt as an amount against the expense rows.
 */
export function compareQuotedUsed(quoted: readonly Pick<QuoteLineView, "kind" | "name" | "quantity" | "unit" | "unitPrice" | "markupPercent">[], used: readonly SourceRow[], reportedSec?: number | null): QuoteComparison {
  type Acc = { name: string; unit: string; quoted: number | null; used: number | null; usedOther: string[]; quotedAmount: number | null; usedAmount: number | null; quotedSeen: boolean; usedSeen: boolean };
  const map = new Map<string, Acc>();
  const entry = (name: string, unit: string) => {
    const key = keyOf(name, unit);
    const acc = map.get(key) ?? { name: tidy(name), unit: tidy(unit), quoted: null, used: null, usedOther: [], quotedAmount: null, usedAmount: null, quotedSeen: false, usedSeen: false };
    map.set(key, acc);
    return acc;
  };
  let quotedUnpriced = 0, usedUnpriced = 0;
  for (const line of quoted) {
    if (line.kind !== "MATERIAL" || !tidy(line.name)) continue;
    const acc = entry(line.name, line.unit);
    const numbers = quoteLineNumbers(line);
    if (numbers.quantity !== null) acc.quoted = Math.round(((acc.quoted ?? 0) + numbers.quantity) * 10000) / 10000;
    if (numbers.amount === null) quotedUnpriced += 1;
    acc.quotedAmount = numbers.amount === null ? acc.quotedAmount : roundOre((acc.quotedAmount ?? 0) + numbers.amount);
    acc.quotedSeen = true;
  }
  for (const row of used) {
    if (isExpenseRow(row) || !tidy(row.name)) continue;
    const acc = entry(row.name, row.unit);
    const quantity = tidy(row.quantity);
    const value = quantity ? parseAmount(quantity) : null;
    if (value !== null) acc.used = Math.round(((acc.used ?? 0) + value) * 10000) / 10000;
    else if (quantity && !acc.usedOther.includes(quantity)) acc.usedOther.push(quantity);
    const price = materialRowPrice(row);
    if (price.sale === null) usedUnpriced += 1;
    else acc.usedAmount = roundOre((acc.usedAmount ?? 0) + price.sale);
    acc.usedSeen = true;
  }
  const lines = [...map.values()].map(({ quotedSeen, usedSeen, ...acc }): QuoteComparisonLine => ({
    ...acc,
    difference: (acc.quoted !== null || !quotedSeen) && (acc.used !== null || !usedSeen) ? Math.round(((acc.used ?? 0) - (acc.quoted ?? 0)) * 10000) / 10000 : null,
  })).sort((a, b) => a.name.localeCompare(b.name, "sv-SE", { sensitivity: "base" }) || a.unit.localeCompare(b.unit, "sv-SE", { sensitivity: "base" }));
  const quotedAmount = roundOre(lines.reduce((sum, line) => sum + (line.quotedAmount ?? 0), 0));
  const usedAmount = roundOre(lines.reduce((sum, line) => sum + (line.usedAmount ?? 0), 0));
  // Arbete: hours against reported time.
  const work = quotedWork(quoted);
  let labourAmount = 0;
  for (const line of quoted) if (line.kind === "LABOUR" && tidy(line.name)) labourAmount += quoteLineNumbers(line).amount ?? 0;
  const reportedMinutes = reportedSec === undefined || reportedSec === null || !Number.isFinite(reportedSec) ? null : Math.max(0, Math.round(reportedSec / 60));
  const labour = {
    quotedMinutes: work.minutes, reportedMinutes, uncounted: work.uncounted, quotedAmount: roundOre(labourAmount),
    differenceMinutes: reportedMinutes === null || work.minutes === null ? null : reportedMinutes - work.minutes,
  };
  // Övrigt: amounts against the expense rows.
  let otherAmount = 0, otherUnpriced = 0;
  for (const line of quoted) {
    if (line.kind !== "OTHER" || !tidy(line.name)) continue;
    const amount = quoteLineNumbers(line).amount;
    if (amount === null) otherUnpriced += 1; else otherAmount += amount;
  }
  const expenses = expenseTotal(used);
  const other = {
    quotedAmount: roundOre(otherAmount), quotedUnpriced: otherUnpriced, usedAmount: roundOre(expenses.total), usedRows: expenses.count, usedMissing: expenses.missing,
    difference: roundOre(expenses.total - otherAmount),
  };
  return { lines, totals: { quotedAmount, usedAmount, quotedUnpriced, usedUnpriced, difference: roundOre(usedAmount - quotedAmount) }, labour, other };
}
