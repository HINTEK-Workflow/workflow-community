import { formatPrice, isExpenseRow, parseAmount, type MaterialRow } from "@/lib/workflow/expenses";
import { materialRowPrice, roundOre, workOrderTotals } from "@/lib/workflow/material-prices";

/**
 * Material i projektet (2026-10-09: "för att veta vilket material som används i projektet"): the material rows
 * of the project's work orders – never the expense rows – summed per Benämning and Enhet, case-insensitively, with the
 * jobs each line comes from. Antal is free text on the row; numbers are summed, anything else is kept as written so
 * nothing is lost or guessed. Cloud (app/api/projects), Local and the demo all call this one function.
 * With `prices` (steg A, only for someone who may see prices) each line also carries its amounts and the summary the
 * project's sums: material at purchase price and with markup, the expenses and the total excl. VAT.
 */

/** A work order as the summary needs it: its id, title and rows (any shape with name, quantity, unit and kind). */
export type MaterialSource = { id: string; title: string; materials: readonly (Pick<MaterialRow, "name" | "quantity" | "unit" | "kind" | "unitPrice" | "markupPercent" | "amount"> & Partial<Pick<MaterialRow, "articleNo" | "articleSource" | "manufacturerArticleNo" | "catalogue">>)[] };
/** The article numbers of a summed line (Grossistexport, 2026-10-12): kept only when every row of the line has the same ones. */
export type ProjectMaterialArticle = { articleNo?: string; articleSource?: string; supplierName?: string; supplierArticleNo?: string; eNumber?: string; manufacturerArticleNo?: string; priceUnit?: string };
/** Amounts in kr excl. VAT; `unpriced` = rows without a readable price, which are not in the sums. */
export type ProjectMaterialPrice = { purchase: number; sale: number; unpriced: number };
export type ProjectMaterialPrices = ProjectMaterialPrice & { expenses: number; expensesMissing: number; total: number };
export type ProjectMaterialLine = {
  /** Only with prices: the line's summed amounts. */
  price?: ProjectMaterialPrice;
  /** Benämning and Enhet as first written (the newest work order first when the caller orders them so). */
  name: string;
  unit: string;
  /** The summed Antal as a person reads it ("12,5"), followed by quantities that are not numbers ("12 + ca 3"); "" when none. */
  quantity: string;
  /** The numeric sum alone, or null when no row had a number. */
  total: number | null;
  /** How many material rows were summed into the line. */
  rows: number;
  /** The work orders the line comes from, each once, in the order given. */
  jobs: { id: string; title: string }[];
  /** The article numbers the rows agree on; absent when the rows differ or have none (the export then asks which article). */
  article?: ProjectMaterialArticle;
};
export type ProjectMaterialSummary = { lines: ProjectMaterialLine[]; total: number; truncated: boolean; prices?: ProjectMaterialPrices };

/** At most this many lines are sent with the project view; the panel shows them 50 at a time. */
export const PROJECT_MATERIAL_LIMIT = 500;
export const PROJECT_MATERIAL_PAGE = 50;

const tidy = (text: string) => text.replace(/\s+/g, " ").trim();
const keyOf = (name: string, unit: string) => `${tidy(name).toLocaleLowerCase("sv-SE")}\u0000${tidy(unit).toLocaleLowerCase("sv-SE")}`;

const articleOf = (row: MaterialSource["materials"][number]): ProjectMaterialArticle => {
  const text = (value: string | undefined) => (value ?? "").replace(/\s+/g, " ").trim();
  const pairs: [keyof ProjectMaterialArticle, string][] = [
    ["articleNo", text(row.articleNo)], ["articleSource", text(row.articleSource)], ["supplierName", text(row.catalogue?.supplierName)], ["supplierArticleNo", text(row.catalogue?.supplierArticleNo)],
    ["eNumber", text(row.catalogue?.eNumber)], ["manufacturerArticleNo", text(row.manufacturerArticleNo ?? row.catalogue?.manufacturerArticleNo)], ["priceUnit", text(row.catalogue?.unit)],
  ];
  return Object.fromEntries(pairs.filter(([, value]) => value));
};

export function summarizeProjectMaterials(orders: readonly MaterialSource[], limit = PROJECT_MATERIAL_LIMIT, options: { prices?: boolean } = {}): ProjectMaterialSummary {
  type Acc = { name: string; unit: string; sum: number; numeric: boolean; other: string[]; rows: number; jobs: Map<string, string>; article: ProjectMaterialArticle | null | undefined; purchase: number; sale: number; unpriced: number };
  const lines = new Map<string, Acc>();
  for (const order of orders) {
    for (const row of order.materials) {
      if (isExpenseRow(row)) continue;
      const name = tidy(row.name ?? "");
      if (!name) continue;
      const unit = tidy(row.unit ?? "");
      const key = keyOf(name, unit);
      const line = lines.get(key) ?? { name, unit, sum: 0, numeric: false, other: [], rows: 0, jobs: new Map<string, string>(), article: undefined, purchase: 0, sale: 0, unpriced: 0 };
      const quantity = tidy(row.quantity ?? "");
      const value = quantity ? parseAmount(quantity) : null;
      if (value !== null) { line.sum += value; line.numeric = true; }
      else if (quantity && !line.other.some((text) => text.toLocaleLowerCase("sv-SE") === quantity.toLocaleLowerCase("sv-SE"))) line.other.push(quantity);
      line.rows += 1;
      const article = articleOf(row);
      // The first row sets the line's article; a row that differs (also one with no number) makes it unknown (null).
      if (line.article === undefined) line.article = article; else if (line.article !== null && JSON.stringify(line.article) !== JSON.stringify(article)) line.article = null;
      const price = materialRowPrice(row);
      if (price.purchase === null || price.sale === null) line.unpriced += 1;
      else { line.purchase += price.purchase; line.sale += price.sale; }
      if (!line.jobs.has(order.id)) line.jobs.set(order.id, order.title);
      lines.set(key, line);
    }
  }
  const all = [...lines.values()].sort((a, b) => a.name.localeCompare(b.name, "sv-SE", { sensitivity: "base" }) || a.unit.localeCompare(b.unit, "sv-SE", { sensitivity: "base" }));
  const max = Math.max(0, Math.floor(limit));
  const summary: ProjectMaterialSummary = {
    total: all.length,
    truncated: all.length > max,
    lines: all.slice(0, max).map((line) => {
      const total = line.numeric ? Math.round(line.sum * 10000) / 10000 : null;
      return {
        name: line.name, unit: line.unit,
        // Swedish formatting writes a typographic minus; a plain hyphen keeps the text the same as what was typed.
        quantity: [...(total === null ? [] : [formatPrice(total).replace("−", "-")]), ...line.other].join(" + "),
        total, rows: line.rows,
        jobs: [...line.jobs].map(([id, title]) => ({ id, title })),
        ...(line.article && Object.keys(line.article).length ? { article: line.article } : {}),
        ...(options.prices ? { price: { purchase: roundOre(line.purchase), sale: roundOre(line.sale), unpriced: line.unpriced } } : {}),
      };
    }),
  };
  if (options.prices) {
    // The sums cover every line, also those past the list's limit; expenses come from the same work orders.
    const totals = workOrderTotals(orders.flatMap((order) => order.materials.map((row) => ({ ...row, name: row.name ?? "" }))));
    summary.prices = { purchase: totals.material.purchase, sale: totals.material.sale, unpriced: totals.material.unpriced, expenses: totals.expenses.total, expensesMissing: totals.expenses.missing, total: totals.total };
  }
  return summary;
}

/** Local and demo tasks (already parsed): the work orders among them with their rows, in the order given. */
export function workOrderMaterialSources(tasks: readonly { id: string; title: string; data: { kind: string; details?: unknown } }[]): MaterialSource[] {
  return tasks.flatMap((task) => {
    const materials = task.data.kind === "WORK_ORDER" ? (task.data.details as { materials?: unknown } | undefined)?.materials : undefined;
    return Array.isArray(materials) ? [{ id: task.id, title: task.title, materials: materials as MaterialSource["materials"] }] : [];
  });
}

/** One CSV cell; a value that a spreadsheet would read as a formula gets a leading apostrophe. */
const csvCell = (value: string) => `"${(/^[=+\-@\t\r]/.test(value) && !/^-\d[\d\s.,]*$/.test(value) ? `'${value}` : value).replaceAll('"', '""')}"`;

/**
 * The summary as CSV for Excel (semicolon, CRLF; the caller adds the BOM): Benämning, Antal, Enhet, Rader, Jobb – and,
 * when the summary carries prices, Inköp and Med påslag (kr exkl. moms).
 */
export function projectMaterialsCsv(summary: ProjectMaterialSummary): string {
  const priced = Boolean(summary.prices);
  const money = (value: number | undefined) => value === undefined ? "" : value.toFixed(2).replace(".", ",");
  const rows = [
    ["Benämning", "Antal", "Enhet", "Rader", "Jobb", ...(priced ? ["Inköp (kr exkl. moms)", "Med påslag (kr exkl. moms)", "Rader utan pris"] : [])],
    ...summary.lines.map((line) => [line.name, line.quantity, line.unit, String(line.rows), line.jobs.map((job) => job.title || "Utan rubrik").join(", "),
      ...(priced ? [money(line.price?.purchase), money(line.price?.sale), String(line.price?.unpriced ?? 0)] : [])]),
  ];
  return rows.map((row) => row.map(csvCell).join(";")).join("\r\n");
}
