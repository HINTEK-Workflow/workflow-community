import { isExpenseRow, type MaterialRow } from "@/lib/workflow/expenses";
import type { ProjectMaterialArticle } from "@/lib/workflow/project-materials";
import type { QuoteLineView } from "@/lib/quotes/model";
import type { WholesaleSourceLine } from "./prepare";

/**
 * Where the export takes its rows from (2026-10-12): the material rows of a work order, the Material lines of a
 * quote and the lines of "Material i projektet". Only name, quantity, unit and the article numbers are read: never
 * prices, discounts, markup or selling prices, and never Arbete, Övrigt, expenses or car costs. Rows without a name or
 * quantity text are still passed on (the review shows them), but a row with nothing at all is skipped.
 */
export type WholesaleSource = {
  lines: WholesaleSourceLine[];
  /** Rows left out because they are not material (work, travel, free text, expenses). */
  skipped: number;
  /** Set when the rows are not the whole list (a cut-off summary): Kopiera and Exportera stop with this reason, so no row is missing in silence. */
  blocked?: string;
};

const isBlank = (line: WholesaleSourceLine) => ![line.name, line.quantity, line.articleNo, line.manufacturerArticleNo].some((value) => value?.trim());

export function fromMaterialRows(rows: readonly MaterialRow[]): WholesaleSource {
  const lines: WholesaleSourceLine[] = [];
  let skipped = 0;
  for (const row of rows) {
    if (isExpenseRow(row)) { skipped += 1; continue; }
    const line: WholesaleSourceLine = {
      id: row.id, name: row.name, quantity: row.quantity, unit: row.unit,
      articleNo: row.articleNo, articleSource: row.articleSource, manufacturerArticleNo: row.manufacturerArticleNo ?? row.catalogue?.manufacturerArticleNo,
      supplierName: row.catalogue?.supplierName, supplierArticleNo: row.catalogue?.supplierArticleNo, eNumber: row.catalogue?.eNumber, priceUnit: row.catalogue?.unit,
      ...(row.catalogue?.wholesaler ? { supplierWholesaler: row.catalogue.wholesaler } : {}),
      wholesale: row.wholesale,
    };
    if (!isBlank(line)) lines.push(line);
  }
  return { lines, skipped };
}

export function fromQuoteLines(quoteLines: readonly QuoteLineView[]): WholesaleSource {
  const lines: WholesaleSourceLine[] = [];
  let skipped = 0;
  for (const row of quoteLines) {
    if (row.kind !== "MATERIAL") { skipped += 1; continue; }
    const line: WholesaleSourceLine = {
      id: row.id, name: row.name, quantity: row.quantity, unit: row.unit,
      articleNo: row.articleNo, articleSource: row.articleSource, manufacturerArticleNo: row.manufacturerArticleNo ?? row.catalogue?.manufacturerArticleNo,
      supplierName: row.catalogue?.supplierName, supplierArticleNo: row.catalogue?.supplierArticleNo, eNumber: row.catalogue?.eNumber, priceUnit: row.catalogue?.unit,
      ...(row.catalogue?.wholesaler ? { supplierWholesaler: row.catalogue.wholesaler } : {}),
      wholesale: row.wholesale,
    };
    if (!isBlank(line)) lines.push(line);
  }
  return { lines, skipped };
}

/** A line of "Material i projektet": summed per name and unit; it carries a number only when all its rows agree on it. */
export type ProjectMaterialSourceLine = { name: string; unit: string; quantity: string; article?: ProjectMaterialArticle };

export function fromProjectMaterials(projectLines: readonly ProjectMaterialSourceLine[]): WholesaleSource {
  const lines = projectLines.map((item, index): WholesaleSourceLine => ({
    id: `project-${index}`, name: item.name, quantity: item.quantity, unit: item.unit, ...(item.article ?? {}),
  })).filter((line) => !isBlank(line));
  return { lines, skipped: 0 };
}
