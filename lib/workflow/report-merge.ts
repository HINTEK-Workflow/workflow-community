import type { PDFDocument } from "pdf-lib";
import { formatSwedish } from "@/lib/swedish-time";
import type { ReportFontBytes } from "./report-fonts";
import { stampFooter, type KitSender } from "./report-kit";
import { pdfTexts } from "@/lib/pdf-templates/catalog";
import type { PdfTemplateOverride } from "@/lib/pdf-templates/model";

/**
 * A project report is put together from separate PDFs (the Workflow report, each protocol, each control), and each one
 * numbered its own pages. After merging, every page gets one common footer with continuous numbering – "Sida 3 av 8", the
 * same two-line footer as every other document (decision 2.3, 2026-10-02; the design Förslag B 2026-11-03) – so the
 * whole report reads as one document (totalkontrollen F5, 2026-09-29). Shared by Cloud and Local.
 */
/** The footer's own note on a project report: nothing but the maker's line, like every other document (the text is the PDF template's). */
export const projectReportFooterLeft = (projectName: string, createdAt = new Date(), templates?: readonly PdfTemplateOverride[] | null) =>
  `${pdfTexts("project_report", templates).text("footer", { projekt: projectName })} · ${formatSwedish(createdAt, { dateStyle: "short" })}`;

/**
 * The merged document's own metadata, set like every other document's (basis-report.ts): each part carried its own, and
 * a new PDFDocument has none, so the project report had no title or author (PDF review 2026-11-03). Shared by Cloud and Local.
 */
export function projectReportMetadata(pdf: PDFDocument, input: { projectName: string; company: string; createdAt?: Date }) {
  pdf.setTitle(`Projektrapport – ${input.projectName}`);
  pdf.setAuthor(input.company || "Workflow");
  pdf.setCreator("Workflow");
  pdf.setProducer("Workflow");
  pdf.setCreationDate(input.createdAt ?? new Date());
  pdf.setLanguage("sv-SE");
}

export async function stampContinuousFooter(pdf: PDFDocument, input: { fontBytes: ReportFontBytes; left: string; company: string; sender?: KitSender | null; createdAt?: Date; templates?: readonly PdfTemplateOverride[] | null }) {
  await stampFooter(pdf, { fontBytes: input.fontBytes, company: input.company, sender: input.sender, templates: input.templates, second: `${input.left.replace(/ · \d{4}-\d{2}-\d{2}$/, "")} · ${pdfTexts("common", input.templates).text("made", { datum: formatSwedish(input.createdAt ?? new Date(), { dateStyle: "short" }) })}` });
}
