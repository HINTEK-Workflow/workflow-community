import { rgb } from "pdf-lib";
import { formatSwedish } from "@/lib/swedish-time";
import { workflowTaskProgress } from "./task-model";
import { CONTENT_WIDTH, createReportKit, isJpeg, isPng, MARGIN, REPORT_TONES, type KitAttachment, type KitIdentity, type ReportKit } from "./report-kit";
import type { WorkflowReportOptions, WorkflowReportTask } from "./report";

/**
 * Work orders, the older risk assessments and the project report's own pages, drawn like the Kontroll före idrifttagning
 * report (Daniel 2026-09-27: the control's report is the model for every report; 2026-09-30: "pdf:er som behöver snyggas
 * till"): the control's heading, fact boxes, tables, cards and footer in the company's report colours with its logo –
 * the same look as the form protocols. Protocols are drawn by form-report and follow a project report as their own parts.
 */
const draft = rgb(0.62, 0.38, 0.02);
const danger = REPORT_TONES.fail;
const RISK_FILL = { low: rgb(0.82, 0.96, 0.88), moderate: rgb(1, 0.95, 0.75), high: rgb(1, 0.88, 0.76), veryHigh: rgb(0.99, 0.83, 0.83) };
const reportTime = (value: string | Date) => formatSwedish(value, { dateStyle: "short", timeStyle: "short" });
const statusLabel = (status: WorkflowReportTask["status"]) => ({ PLANNED: "Planerad", IN_PROGRESS: "Pågår", PAUSED: "Pausad", NEEDS_ACTION: "Behöver åtgärdas", COMPLETED: "Slutförd" } as const)[status];
const riskLabel = (score: number) => score >= 17 ? "Mycket hög" : score >= 10 ? "Hög" : score >= 5 ? "Måttlig" : "Låg";
const riskFill = (score: number) => score >= 17 ? RISK_FILL.veryHigh : score >= 10 ? RISK_FILL.high : score >= 5 ? RISK_FILL.moderate : RISK_FILL.low;
const kindLabel = (task: WorkflowReportTask) => task.data.kind === "FORM" ? task.data.details.templateName : task.kind === "WORK_ORDER" ? "Arbetsorder" : "Riskbedömning";
const duration = (seconds: number) => { const minutes = Math.floor(seconds / 60); return `${Math.floor(minutes / 60)} h ${minutes % 60} min`; };

/**
 * A name without a confirmation (a reopened task keeps the earlier signer's name for the next completion) is marked so
 * the report never reads as signed (totalkontrollen F17, 2026-09-29).
 */
export function signerName(name: string, confirmed: boolean, word: "signerad" | "godkänd") {
  if (!name.trim()) return "";
  return confirmed ? name : `${name} (ej ${word} ännu)`;
}

type Input = {
  identity: KitIdentity; fontBytes: Uint8Array; tasks: WorkflowReportTask[]; options: WorkflowReportOptions; createdAt?: Date;
  title?: string; projectName?: string; projectFields?: (readonly [string, string])[];
  /** A project report whose protocols follow as their own PDFs still counts every chosen task. */
  taskCount?: number;
};

export async function createTaskReportPdf(input: Input) {
  const createdAt = input.createdAt ?? new Date();
  const project = Boolean(input.projectName || input.tasks.length > 1);
  const single = project ? null : input.tasks[0];
  const heading = input.title || (single ? kindLabel(single) : "Projektrapport");
  const overline = project ? "PROJEKTRAPPORT" : heading.toUpperCase();
  const kit = await createReportKit({ identity: input.identity, fontBytes: input.fontBytes, overline, continuation: `${heading} · fortsättning` });
  kit.pdf.setTitle(single ? `${heading} – ${single.title}` : `${heading} – ${input.projectName ?? ""}`);
  kit.pdf.setAuthor(input.identity.company || "HINTEK Workflow");
  kit.pdf.setCreator("HINTEK Workflow");
  kit.pdf.setProducer("HINTEK Workflow");
  kit.pdf.setCreationDate(createdAt);
  const code = `Skapad ${reportTime(createdAt)}`;
  kit.firstPage(heading, code);
  // An unfinished task is marked on the first page like a protocol (reports mark drafts clearly), without moving anything.
  if (single && single.status !== "COMPLETED") kit.text("· ÖGONBLICKSBILD – EJ SLUTFÖRT", MARGIN + kit.font.widthOfTextAtSize(`${code} `, 7), 763, { size: 7, color: draft });

  if (project) {
    kit.factBoxes([
      { label: "Projekt", value: input.projectName || "Projekt", soft: true, span: 8 },
      { label: "Uppgifter i rapporten", value: String(input.taskCount ?? input.tasks.length) },
    ]);
    if (input.projectFields?.length) {
      kit.blockTitle("Projektets uppgifter");
      kit.factBoxes(input.projectFields.map(([label, value]) => ({ label, value, span: factSpan(value) })));
    }
    const listed = input.tasks;
    if (listed.length) {
      kit.blockTitle("Rapportens innehåll", "Pågående uppgifter är ögonblicksbilder. Protokoll och kontroller följer som egna delar efter arbetsordrarna.", 55);
      kit.table("Rapportens innehåll", widths([["title", "Uppgift", 4], ["kind", "Typ", 2], ["status", "Status", 1.6], ["time", "Rapporterad tid", 1.3]]),
        listed.map((task) => [task.title, kindLabel(task), `${statusLabel(task.status)} · ${progress(task)}%`, duration(task.totalDurationSec)]),
        [], listed.map((task) => [undefined, undefined, task.status === "COMPLETED" ? REPORT_TONES.pass : draft, undefined]));
    }
  }
  for (const task of input.tasks) if (task.data.kind !== "FORM") await drawTask(kit, task, input.options, project);
  kit.footer(`${project ? `Projektrapport${input.projectName ? ` · ${input.projectName}` : ""}` : heading} · ${formatSwedish(createdAt, { dateStyle: "short" })}`);
  return kit.pdf.save();
}

const progress = (task: WorkflowReportTask) => task.status === "COMPLETED" ? 100 : workflowTaskProgress(task);
const factSpan = (value: string) => value.length > 60 ? 12 : value.length > 28 ? 8 : 4;
function widths(columns: [key: string, label: string, weight: number, center?: boolean][]) {
  const total = columns.reduce((sum, item) => sum + item[2], 0);
  return columns.map(([key, label, weight, center]) => ({ key, label, width: weight / total * CONTENT_WIDTH, center }));
}

async function drawTask(kit: ReportKit, task: WorkflowReportTask, options: WorkflowReportOptions, project: boolean) {
  // In a project report every task starts its own chapter with its title, kind and state.
  if (project) kit.chapter(task.title, `${kindLabel(task)} · ${statusLabel(task.status)} · ${progress(task)}% klart${task.status === "COMPLETED" ? "" : " · ögonblicksbild, uppgiften är inte slutförd"}`);
  if (options.summary) {
    kit.factBoxes([
      ...(project ? [] : [{ label: "Uppgift", value: task.title, soft: true }, { label: "Projekt", value: task.projectName || "Fristående uppgift" }]),
      { label: "Kund", value: task.customerName || "Ingen kund" },
      ...(task.facilityName ? [{ label: "Anläggning", value: task.facilityName }] : []),
      ...(task.siteName ? [{ label: "Plats", value: task.siteName }] : []),
      { label: "Ansvarig", value: task.assignedToName || "Inte tilldelad" },
      ...(task.dueDate ? [{ label: "Klart senast", value: task.dueDate }] : []),
      { label: "Status", value: `${statusLabel(task.status)} · ${progress(task)}% klart`, tone: task.status === "COMPLETED" ? undefined : draft },
      ...(options.time ? [{ label: "Rapporterad tid", value: duration(task.totalDurationSec) }] : []),
      ...(task.description ? [{ label: "Beskrivning", value: task.description.replace(/\n{2,}/g, "\n"), span: 12 }] : []),
    ]);
    if (!project && task.projectFields?.length) {
      kit.blockTitle("Projektets uppgifter");
      kit.factBoxes(task.projectFields.map(([label, value]) => ({ label, value, span: factSpan(value) })));
    }
  }
  if (task.data.kind === "WORK_ORDER") {
    const details = task.data.details;
    if (options.execution) { kit.blockTitle("Utfört arbete", undefined, 62); kit.textBox([details.executionNotes.trim() || "Inget utfört arbete dokumenterat."]); }
    if (options.materials) {
      kit.blockTitle("Material", undefined, 55);
      const materials = details.materials.filter((item) => item.name.trim());
      if (materials.length) kit.table("Material", widths([["name", "Material", 5], ["quantity", "Mängd", 1.2, true], ["unit", "Enhet", 1.2, true]]), materials.map((item) => [item.name, item.quantity, item.unit]));
      else kit.paragraph("Inget material registrerat.");
    }
    if (options.deviations) {
      kit.blockTitle("Avvikelser och avslut", undefined, 50);
      kit.factBoxes([
        { label: "Avvikelser", value: details.deviations.trim() || "Inga avvikelser dokumenterade.", span: 12, tone: details.deviations.trim() ? danger : undefined },
        { label: "Avslutande kommentar", value: details.closeNotes.trim() || "Ingen avslutande kommentar.", span: 12 },
      ]);
    }
    if (options.approval) {
      kit.blockTitle("Signering", undefined, 50);
      const { signature } = details;
      kit.factBoxes([
        { label: "Signerad av", value: signerName(signature.name, signature.confirmed, "signerad") },
        { label: "Tidpunkt", value: signature.confirmed && signature.signedAt ? reportTime(signature.signedAt) : "" },
        { label: "Signering", value: signature.confirmed ? "Signerad" : "Inte signerad", tone: signature.confirmed ? REPORT_TONES.pass : REPORT_TONES.muted },
      ]);
    }
  } else if (task.data.kind === "RISK_ASSESSMENT") {
    const details = task.data.details;
    if (options.riskMatrix) {
      kit.blockTitle("Riskmatris 5 × 5", undefined, 205);
      kit.matrix({ size: 5, xLabel: "Sannolikhet", yLabel: "Konsekvens", fill: riskFill,
        legend: [["Låg", RISK_FILL.low], ["Måttlig", RISK_FILL.moderate], ["Hög", RISK_FILL.high], ["Mycket hög", RISK_FILL.veryHigh]].map(([label, color]) => ({ label: label as string, color: color as ReturnType<typeof rgb> })) });
    }
    if (options.risks) {
      kit.blockTitle("Identifierade risker", "Faran och skyddsåtgärden, med risken före och efter åtgärden.", 120);
      if (!details.risks.length) kit.paragraph("Inga risker dokumenterade.");
      details.risks.forEach((risk, index) => {
        const before = risk.likelihood * risk.consequence;
        const after = risk.residualLikelihood * risk.residualConsequence;
        const tone = (score: number) => score >= 10 ? danger : undefined;
        kit.card({
          title: `Risk ${index + 1}${risk.hazard.trim() ? `: ${risk.hazard.trim()}` : ""}`,
          result: `Efter: ${after} · ${riskLabel(after)}`,
          metrics: [
            { label: "Sannolikhet före", value: String(risk.likelihood) },
            { label: "Konsekvens före", value: String(risk.consequence) },
            { label: "Risk före", value: `${before} · ${riskLabel(before)}`, tone: tone(before) },
            { label: "Sannolikhet efter", value: String(risk.residualLikelihood) },
            { label: "Konsekvens efter", value: String(risk.residualConsequence) },
            { label: "Kvarvarande risk", value: `${after} · ${riskLabel(after)}`, tone: tone(after) },
          ],
          comment: `Skyddsåtgärd: ${risk.protectiveMeasure.trim() || "Ej angiven"}`,
        }, { resultTone: tone(after) });
      });
    }
    if (options.execution) { kit.blockTitle("Gemensamma skyddsåtgärder", undefined, 62); kit.textBox([details.generalMeasures.trim() || "Inga gemensamma åtgärder dokumenterade."]); }
    if (options.approval) {
      kit.blockTitle("Godkännande", undefined, 50);
      const { approval } = details;
      kit.factBoxes([
        { label: "Godkänd av", value: signerName(approval.name, approval.confirmed, "godkänd") },
        { label: "Tidpunkt", value: approval.confirmed && approval.approvedAt ? reportTime(approval.approvedAt) : "" },
        { label: "Godkännande", value: approval.confirmed ? "Godkänd" : "Inte godkänd", tone: approval.confirmed ? REPORT_TONES.pass : REPORT_TONES.muted },
      ]);
    }
  }
  // Pictures two by two with their names, like a protocol's; other files are named in the list below.
  const images = options.images ? task.attachments.filter((item) => item.mimeType.startsWith("image/") && item.bytes && (isPng(item.bytes) || isJpeg(item.bytes))) : [];
  if (images.length) {
    kit.blockTitle("Bilder", undefined, 200);
    await kit.imageRow(images.map((item) => ({ bytes: item.bytes!, caption: item.filename })));
  }
  if (options.attachments && task.attachments.length) {
    const files: KitAttachment[] = task.attachments.map((item) => ({ filename: item.filename, mimeType: item.mimeType, label: item.mimeType.startsWith("image/") ? "Bild" : "Fil" }));
    kit.attachmentList(files, images.length === task.attachments.length ? "Bilderna visas ovan." : "Filer som hör till uppgiften.");
  }
}
