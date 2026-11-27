import { pdfTexts } from "@/lib/pdf-templates/catalog";
import { untraced } from "@/lib/pdf-templates/model";
import { formatSwedish } from "@/lib/swedish-time";
import { CONTENT_WIDTH, continuationOf, createReportKit, mm, REPORT_TONES, type KitIdentity } from "@/lib/workflow/report-kit";
import type { ReportFontBytes } from "@/lib/workflow/report-fonts";
import type { RunReport } from "./model";
import { reportTemplate, reportTitleBlock } from "./report-template";

/**
 * Agentrapport som PDF (2026-11-21: "alltså PDF-mallar"): a run's filled report drawn with the shared report kit in the
 * company's look, with the words of the PDF document type Agentrapport – the same editor and the same uniform footer as every other
 * document. The parts follow the editor's order and visibility; Workflow AI's slot always carries its label.
 */
export async function createAgentReportPdf(input: { identity: KitIdentity; fontBytes: ReportFontBytes; missionName: string; report: RunReport; createdAt?: Date }) {
  const createdAt = input.createdAt ?? new Date();
  const t = pdfTexts("agent_report", input.identity.templates);
  const template = reportTemplate(input.report.template);
  const title = t.text(reportTitleBlock(template.key));
  const kit = await createReportKit({ identity: input.identity, fontBytes: input.fontBytes, createdAt, head: {
    kind: t.shown("kind") ? t.text("kind", { uppdrag: input.missionName }) : "", title, number: input.report.title !== untraced(title) ? input.report.title.slice(0, 80) : undefined,
    dates: [[t.text("head.created"), formatSwedish(createdAt, { dateStyle: "short", timeStyle: "short" })], [t.text("head.mission"), input.missionName.slice(0, 80)]],
    continuation: continuationOf(input.identity, title),
  } });
  kit.pdf.setTitle(`${title} – ${input.missionName}`);
  kit.pdf.setAuthor(input.identity.company || "Workflow");
  kit.pdf.setCreator("Workflow");
  kit.pdf.setCreationDate(createdAt);
  kit.firstPage();
  const report = input.report;
  const nothing = !report.sections.length && !report.assessment;
  const parts: Record<string, () => void> = {
    "section.summary": () => { if (!report.summary) return; kit.section(t.text("section.summary"), { keep: 30 }); kit.paragraph(report.summary); },
    "section.facts": () => { if (!report.facts?.length) return; kit.section(t.text("section.facts"), { keep: 30 }); kit.facts(report.facts.slice(0, 12).map((fact) => ({ label: fact.label, value: fact.value })), { cols: 3 }); },
    "section.assessment": () => {
      if (!report.assessment) return;
      kit.section(t.text("section.assessment"), { note: t.text(template.ai?.kind === "assessment" ? "ai.assessment" : "ai.summary"), keep: 40 });
      kit.paragraph(report.assessment.text, { maxWidth: CONTENT_WIDTH });
    },
    "section.next": () => { if (!report.nextSteps?.length) return; kit.section(t.text("section.next"), { keep: 30 }); kit.list(report.nextSteps.map((step) => `• ${step}`)); },
  };
  const order = t.order("parts").filter((id) => parts[id]);
  for (const key of order) if (t.shown(key)) parts[key]!();
  if (nothing) kit.paragraph(t.text("empty"));
  for (const section of report.sections) {
    kit.section(section.heading, { keep: 40 });
    kit.table({ dense: true, columns: [{ key: "title", label: section.heading, width: CONTENT_WIDTH - mm(60) }, { key: "detail", label: "", width: mm(60) }],
      rows: section.rows.slice(0, 200).map((row) => [row.title, row.detail ? { text: row.detail, tone: REPORT_TONES.muted } : ""]) });
  }
  kit.footer({ note: t.text("footer") });
  return kit.pdf.save();
}
