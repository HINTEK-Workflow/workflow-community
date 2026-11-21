import { formatSwedish } from "@/lib/swedish-time";
import { REPORT_TONES, type ReportKit } from "./report-kit";
import { riskStepReportFacts } from "./risk-step";
import { pdfTexts } from "@/lib/pdf-templates/catalog";

/**
 * Riskbedömning som steg in the task's report (2026-10-08): the level, each answer, who confirmed and when, as a
 * facts grid under its own heading (the design Förslag B: the risk assessment's facts band). A task without a risk check
 * (older tasks, risk assessments) gets nothing. Shared by work orders and protocols.
 */
export function drawRiskStep(kit: ReportKit, data: unknown, options: { blank?: boolean } = {}) {
  const facts = riskStepReportFacts(data);
  if (!facts || options.blank) return;
  const t = pdfTexts("risk_assessment", kit.templates);
  // Undantaget (2026-11-02): no assessment was made, and the report says so with the reason, who and when.
  if (facts.exception) {
    kit.section(t.text("step.exception"), { note: facts.exception.reason, keep: 40 });
    kit.facts([
      { label: t.text("step.exception.by"), value: facts.exception.by || t.text("step.exception.unknown") },
      { label: t.text("step.time"), value: facts.exception.at ? formatSwedish(facts.exception.at, { dateStyle: "short", timeStyle: "short" }) : "" },
    ], { cols: 3 });
    return;
  }
  kit.section(t.text("step.heading"), { note: facts.extended ? t.text("step.extended") : undefined, keep: 40 });
  kit.facts([
    { label: t.text("step.level"), value: facts.level },
    { label: t.text("step.confirmed"), value: facts.confirmedBy || t.text(facts.extended ? "step.confirmed.extended" : "step.confirmed.none") },
    { label: t.text("step.time"), value: facts.confirmedAt ? formatSwedish(facts.confirmedAt, { dateStyle: "short", timeStyle: "short" }) : "" },
    ...facts.rows.map((row) => ({ label: row.label, value: row.value, tone: row.risk ? REPORT_TONES.fail : REPORT_TONES.pass })),
  ], { cols: 3 });
}
