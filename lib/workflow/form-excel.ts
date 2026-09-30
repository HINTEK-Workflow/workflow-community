import ExcelJS from "exceljs";
import { reportBranding, type ReportBranding } from "@/lib/kfid/report-branding";
import { evaluateForm, formActiveLeafBlocks, formApprovalTotals, formBand, formCompletion, formRowStarted, type FormColumn, type FormTableBlock, type FormValues } from "./form-document";
import { formatResultValue } from "./form-formula";
import { formAnswer } from "./form-report";
import type { WorkflowReportTask } from "./report";

/**
 * A protocol as an Excel workbook (2026-09-27, decision B: the control's Excel export for every form): the facts
 * and simple answers, one sheet per table, the checklists and the summary, styled like the control's workbook. `blank`
 * gives the empty form to fill in by hand, like the control's "tom mall".
 */
const color = (value: string) => `FF${value.replace("#", "").toUpperCase()}`;
const sheetName = (name: string, taken: Set<string>) => {
  const base = name.replace(/[[\]:*?/\\]/g, " ").trim().slice(0, 28) || "Blad";
  let candidate = base;
  for (let index = 2; taken.has(candidate.toLowerCase()); index++) candidate = `${base.slice(0, 25)} ${index}`;
  taken.add(candidate.toLowerCase());
  return candidate;
};

export async function createFormExcel(input: { company: string; branding?: Partial<ReportBranding> | null; task: WorkflowReportTask; blank?: boolean }) {
  const { task } = input;
  if (task.data.kind !== "FORM") throw new Error("Excel-exporten gäller bara formulärprotokoll.");
  const { document, values, templateName, templateVersion } = task.data.details;
  const blank = input.blank === true;
  const brand = reportBranding(input.branding);
  const primary = color(brand.primary), accent = color(brand.accent), soft = color(brand.soft);
  const evaluation = evaluateForm(document, values);
  const book = new ExcelJS.Workbook();
  book.creator = "HINTEK Workflow";
  book.company = input.company || "HINTEK";
  book.subject = `${templateName} · ${document.report.code || `version ${templateVersion}`}`;
  book.title = blank ? `${templateName} – tom mall` : task.title;
  book.created = new Date();
  const taken = new Set<string>();

  const sheet = (name: string, columns: number[]) => {
    const current = book.addWorksheet(sheetName(name, taken));
    current.columns = columns.map((width) => ({ width }));
    current.pageSetup = { paperSize: 9, orientation: columns.length > 7 ? "landscape" : "portrait", fitToPage: true, fitToWidth: 1, fitToHeight: 0, margins: { left: 0.3, right: 0.3, top: 0.5, bottom: 0.5, header: 0.2, footer: 0.2 } };
    current.headerFooter.oddFooter = `${templateName} · &P / &N`;
    current.mergeCells(1, 1, 1, columns.length);
    const heading = current.getCell(1, 1);
    heading.value = name;
    heading.font = { bold: true, color: { argb: "FFFFFFFF" }, size: 15 };
    heading.fill = { type: "pattern", pattern: "solid", fgColor: { argb: primary } };
    heading.alignment = { vertical: "middle" };
    current.getRow(1).height = 30;
    current.mergeCells(2, 1, 2, columns.length);
    current.getCell(2, 1).value = input.company || "HINTEK";
    current.getCell(2, 1).font = { bold: true, color: { argb: accent } };
    return current;
  };
  const headerRow = (row: ExcelJS.Row) => {
    row.font = { bold: true, color: { argb: primary } };
    row.fill = { type: "pattern", pattern: "solid", fgColor: { argb: soft } };
    row.alignment = { vertical: "middle", wrapText: true };
    row.height = 30;
  };
  const labelled = (current: ExcelJS.Worksheet) => current.eachRow((row, index) => {
    if (index < 3) return;
    row.getCell(1).font = { bold: true, color: { argb: primary } };
    row.getCell(1).fill = { type: "pattern", pattern: "solid", fgColor: { argb: soft } };
    row.alignment = { vertical: "top", wrapText: true };
  });
  const show = (text: string) => blank ? "" : text === "–" ? "" : text;
  const blocks = formActiveLeafBlocks(document, values);

  // Grunduppgifter: the task's facts and the form's simple answers.
  const facts = sheet("Grunduppgifter", [32, 70]);
  const factRows: [string, string][] = [
    ["Formulär", `${templateName} · ${document.report.code || `version ${templateVersion}`}`],
    ["Uppgift", show(task.title)], ["Projekt", show(task.projectName || "")], ["Kund", show(task.customerName || "")],
    ...(task.facilityName ? [["Anläggning", show(task.facilityName)] as [string, string]] : []),
    ["Ansvarig", show(task.assignedToName)], ["Status", show(task.status === "COMPLETED" ? "Slutförd" : "Utkast")],
  ];
  for (const block of blocks) {
    if (block.type === "field" && block.visibility.pdf) factRows.push([`${block.label}${block.unit ? ` (${block.unit})` : ""}`, show(formAnswer(values.fields[block.key]))]);
    if (block.type === "computed" && block.visibility.pdf) { const value = evaluation.computed[block.key] ?? null; const band = formBand(block.bands, value); factRows.push([block.label, show(`${formatResultValue(value, block.unit, block.passCondition)}${band?.label ? ` · ${band.label}` : ""}`)]); }
    if (block.type === "signature" && block.visibility.pdf) { const signature = values.signatures[block.key]; factRows.push([block.label, show(signature?.name ? `${signature.name}${signature.confirmed ? " · bekräftad" : ""}` : "")]); }
  }
  for (const row of factRows) facts.addRow(row);
  labelled(facts);

  // One sheet per table, with the columns as the PDF shows them.
  const cell = (table: FormTableBlock, row: FormValues["tables"][string][number], column: FormColumn) => {
    if (blank) return "";
    // docs/rapportprinciper.md: an assessment reads Godkänd / Ej godkänd (empty until the row holds something); a tick box is a fact.
    if (column.input === "assessment") { const value = evaluation.cells[table.key]?.[row.id]?.[column.key]; return !formRowStarted(table, row) || typeof value !== "boolean" ? "" : value ? "Godkänd" : "Ej godkänd"; }
    if (column.input === "check") return row.cells[column.key] === true ? "Ja" : "Nej";
    if (column.input === "formula") { const value = evaluation.cells[table.key]?.[row.id]?.[column.key] ?? null; const band = formBand(column.bands, value); return `${formatResultValue(value, column.unit, column.passCondition)}${band?.label ? ` · ${band.label}` : ""}`; }
    if (column.input === "scale") { const step = Number(row.cells[column.key]); return Number.isInteger(step) && step >= 1 ? `${step} · ${column.options[step - 1] ?? ""}` : ""; }
    if (column.input === "images") { const ids = row.cells[column.key]; return Array.isArray(ids) && ids.length ? `${ids.length} ${ids.length === 1 ? "bild" : "bilder"}` : ""; }
    return show(formAnswer(row.cells[column.key]));
  };
  for (const table of blocks.filter((block): block is FormTableBlock => block.type === "table" && block.visibility.pdf)) {
    const columns = table.columns.filter((column) => column.pdf !== "hide");
    const current = sheet(table.label, [...(table.rowMode === "fixed" ? [16] : []), ...columns.map((column) => column.input === "textarea" ? 34 : column.input === "text" ? 24 : 16)]);
    headerRow(current.addRow([...(table.rowMode === "fixed" ? ["Rad"] : []), ...columns.map((column) => column.pdfLabel || `${column.label}${column.unit && column.input !== "formula" ? ` (${column.unit})` : ""}`)]));
    current.views = [{ state: "frozen", ySplit: 3 }];
    const rows: FormValues["tables"][string] = values.tables[table.key]?.length ? values.tables[table.key] : Array.from({ length: blank ? 2 : 1 }, (_, index) => ({ id: `tom-${index}`, label: "", cells: {} }));
    for (const row of rows) {
      const added = current.addRow([...(table.rowMode === "fixed" ? [row.label] : []), ...columns.map((column) => (!blank && row.example && column === columns.find((item) => item.input === "textarea") ? "EXEMPELDATA – " : "") + cell(table, row, column))]);
      added.alignment = { vertical: "top", wrapText: true };
      added.eachCell((item) => { item.border = { bottom: { style: "hair", color: { argb: "FFCBD5E1" } } }; });
    }
  }

  // Checklists.
  const checklists = blocks.filter((block) => block.type === "checklist" && block.visibility.pdf);
  if (checklists.length) {
    const current = sheet("Kontrollpunkter", [26, 50, 16, 40]);
    headerRow(current.addRow(["Lista", "Punkt", "Bedömning", "Kommentar"]));
    for (const block of checklists) if (block.type === "checklist") for (const item of block.items) {
      const answer = values.checklists[block.key]?.[item.id];
      const state = blank ? "" : block.mode === "check" ? (answer?.state === "OK" ? "Kontrollerad" : answer?.state === "NOT_OK" ? "Ej kontrollerad" : "") : answer?.state === "OK" ? "OK" : answer?.state === "NOT_OK" ? "Ej OK" : answer?.state === "NA" ? "Ej aktuellt" : "";
      current.addRow([block.label, item.text, state, blank ? "" : answer?.comment ?? ""]).alignment = { vertical: "top", wrapText: true };
    }
  }

  // Sammanfattning.
  const summary = sheet("Sammanfattning", [44, 60]);
  if (!blank) {
    for (const total of formApprovalTotals(document, values, evaluation)) summary.addRow([total.title, `${total.ok}/${total.total} godkända`]);
    for (const deviation of evaluation.deviations.filter((item) => item.kind !== "assessment")) summary.addRow(["Avvikelse", deviation.message]);
    summary.addRow(["Kommentar", values.deviationComment]);
    const completion = formCompletion(document, values);
    summary.addRow(["Kompletteringsgrad", `${completion.percent}%`]);
    for (const issue of completion.issues) summary.addRow(["Måste kompletteras", issue.message]);
  } else summary.addRow(["Kommentar", ""]);
  labelled(summary);
  return new Uint8Array(await book.xlsx.writeBuffer());
}
