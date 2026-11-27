import { formatDurationSeconds } from "@/lib/workflow/duration";
import { formatSwedish } from "@/lib/swedish-time";
import { workflowTaskProgress } from "./task-model";
import { tempPlaceLabel, tempPlaceOf } from "./temp-place";
import { drawRiskStep } from "./risk-step-report";
import { maintenanceFacts, workOrderStatusLabel } from "./maintenance";
import { expenseTotal, formatPrice, formatSek, isExpenseRow, parseAmount, withoutRate } from "./expenses";
import { customerPriceTotals, materialRowPrice, unpricedText } from "./material-prices";
import { storeRowLabel } from "./store-rows";
import { CONTENT_WIDTH, continuationOf, createReportKit, isJpeg, isPng, mm, REPORT_TONES, type KitAttachment, type KitFact, type KitIdentity, type KitSumRow, type ReportKit } from "./report-kit";
import type { ReportFontBytes } from "./report-fonts";
import type { WorkflowReportOptions, WorkflowReportTask } from "./report";
import { pdfTexts } from "@/lib/pdf-templates/catalog";
import type { PdfTexts } from "@/lib/pdf-templates/model";

/**
 * Work orders, the older risk assessments and the project report's own pages in the design Förslag B (2026-11-03;
 * templates 14-arbetsorderrapport, 11-riskbedömning with the matrix of 10-skyddsrond, 19-projektrapport-omslag): the head
 * with the company's logo, a facts grid, plain section headings, tables with a bold total, the summary box when prices are
 * printed, the risk matrix green → red with the risks' numbers in its cells, and the signature block with the customer's
 * receipt. Protocols are drawn by form-report and follow a project report as their own parts.
 */
const reportTime = (value: string | Date) => formatSwedish(value, { dateStyle: "short", timeStyle: "short" });
const reportDay = (value: string | Date) => formatSwedish(value, { dateStyle: "short" });
const statusText = (status: WorkflowReportTask["status"]) => ({ PLANNED: "Planerad", IN_PROGRESS: "Pågår", PAUSED: "Pausad", NEEDS_ACTION: "Behöver åtgärdas", COMPLETED: "Färdigställd", CANCELLED: "Utgått" } as const)[status];
/** A paused work order says what it waits for ("Väntar på material", Underhåll 2026-10-06). */
const statusLabel = (task: Pick<WorkflowReportTask, "status" | "data">) => workOrderStatusLabel(task.status, task.data.kind === "WORK_ORDER" ? task.data.details : null, statusText(task.status));
/** The risk words and levels of the older risk assessment (1–4 Låg, 5–9 Måttlig, 10–16 Hög, 17–25 Mycket hög). */
export const riskLevel = (score: number) => score >= 17 ? 4 : score >= 10 ? 3 : score >= 5 ? 2 : 1;
export const riskLabel = (score: number) => ["Låg", "Måttlig", "Hög", "Mycket hög"][riskLevel(score) - 1];
export const riskLegend = (r: PdfTexts) => [1, 2, 3, 4].map((level) => ({ level, text: r.text(`legend.${level}`), note: r.text(`legend.${level}.note`) }));
const kindLabel = (task: WorkflowReportTask, p: PdfTexts) => task.data.kind === "FORM" ? task.data.details.templateName : p.text(task.kind === "WORK_ORDER" ? "kind.order" : "kind.risk");
const duration = formatDurationSeconds;


type Input = {
  identity: KitIdentity; fontBytes: ReportFontBytes; tasks: WorkflowReportTask[]; options: WorkflowReportOptions; createdAt?: Date;
  title?: string; projectName?: string; projectFields?: (readonly [string, string])[];
  /** A project report whose protocols follow as their own PDFs still counts every chosen task. */
  taskCount?: number;
  /** Kommentarer (beslut 14, 2026-11-01): the project's own comments chosen "Med i kundrapporten". */
  projectComments?: readonly { authorName: string; body: string; createdAt: string }[];
  /** The company's hourly rate (Priser och offert), for the work in the total when "Visa priser" is chosen; absent = none. */
  hourlyRate?: number | null;
};

export async function createTaskReportPdf(input: Input) {
  const createdAt = input.createdAt ?? new Date();
  const project = Boolean(input.projectName || input.tasks.length > 1);
  const single = project ? null : input.tasks[0];
  // PDF-mallar (2026-11-03): the work order's and the project report's texts, today's words by default.
  const w = pdfTexts("work_order", input.identity.templates);
  const p = pdfTexts("project_report", input.identity.templates);
  const r = pdfTexts("risk_assessment", input.identity.templates);
  const heading = input.title || (single ? (single.kind === "WORK_ORDER" ? w.text("title") : single.data.kind === "FORM" ? single.data.details.templateName : r.text("title")) : p.text("title"));
  const kind = project ? (p.shown("kind") ? p.text("kind") : "") : single?.kind === "WORK_ORDER" ? (w.shown("kind") ? w.text("kind") : "") : r.text("kind");
  const own = single?.kind === "WORK_ORDER" ? w : r;
  const finished = single?.status === "COMPLETED" && single.completedAt ? reportDay(single.completedAt) : null;
  const dates: (readonly [string, string])[] = single
    ? [finished ? [own.text("head.done"), finished] as const : [own.text("head.created"), reportTime(createdAt)] as const, [own.text("head.status"), statusLabel(single)] as const]
    : [[p.text("head.compiled"), reportDay(createdAt)] as const, [p.text("head.tasks"), String(input.taskCount ?? input.tasks.length)] as const];
  const number = single ? single.title : input.projectName || p.text("project.none");
  const kit = await createReportKit({ identity: input.identity, fontBytes: input.fontBytes, createdAt, head: { kind, title: heading, number, dates, continuation: continuationOf(input.identity, number) } });
  kit.pdf.setTitle([heading, single ? single.title : input.projectName].filter(Boolean).join(" – "));
  kit.pdf.setAuthor(input.identity.company || "Workflow");
  kit.pdf.setCreator("Workflow");
  kit.pdf.setProducer("Workflow");
  kit.pdf.setCreationDate(createdAt);
  kit.firstPage();
  // An unfinished task is marked on the first page like a protocol (reports mark drafts clearly).
  if (single && single.status !== "COMPLETED") kit.band(own.text("band.snapshot"));

  if (project) {
    const fields = input.projectFields ?? [];
    const customer = fields.find(([label]) => /beställare|kund/i.test(label))?.[1];
    const site = fields.find(([label]) => /arbetsplats|plats|adress/i.test(label))?.[1];
    kit.facts([
      { label: p.text("fact.project"), value: input.projectName || p.text("project.none"), span: 8 },
      ...(p.shown("fact.count") ? [{ label: p.text("fact.count"), value: String(input.taskCount ?? input.tasks.length) }] : []),
      ...fields.map(([label, value]) => ({ label, value, span: factSpan(value) })),
    ], { cols: 3 });
    kit.coverTitle({ kind: p.shown("cover.kind") ? p.text("cover.kind") : "", title: input.projectName || p.text("project.none"), sub: [customer, site].filter(Boolean).join(" · ") || undefined });
    const listed = input.tasks;
    if (listed.length) {
      kit.section(p.text("section.contents"), { note: p.shown("contents.note") ? p.text("contents.note") : undefined, keep: 30 });
      // "Tid" deselected removes the time too (simulation 2026-10-02); selected, the project's sum follows.
      const withTime = input.options.time;
      kit.toc(listed.map((task, index) => ({ number: String(index + 1), text: `${task.title} · ${kindLabel(task, p)} · ${statusLabel(task)}, ${progress(task)} %`, right: withTime ? duration(task.totalDurationSec) : undefined })));
      if (withTime) kit.facts([{ label: p.text("time.total"), value: duration(listed.reduce((sum, task) => sum + task.totalDurationSec, 0)) }], { cols: 3 });
    }
    kit.customerComments(input.projectComments ?? []);
    kit.signatures([{ label: p.text("sign.manager"), caps: [kit.common.text("sign.name"), kit.common.text("sign.date")] }, { label: p.text("sign.customer"), caps: [kit.common.text("sign.name"), kit.common.text("sign.place-date")] }]);
  }
  for (const task of input.tasks) if (task.data.kind !== "FORM") await drawTask(kit, task, input.options, project, input.hourlyRate ?? null, { w, p, r });
  kit.footer();
  return kit.pdf.save();
}

const progress = (task: WorkflowReportTask) => task.status === "COMPLETED" ? 100 : workflowTaskProgress(task);
const factSpan = (value: string) => value.length > 60 ? 12 : value.length > 28 ? 8 : 4;
const columns = (spec: readonly (readonly [key: string, label: string, widthMm: number | null, align?: "right" | "center"])[]) => {
  const fixed = spec.reduce((sum, item) => sum + (item[2] ?? 0), 0);
  return spec.map(([key, label, width, align]) => ({ key, label, width: width === null ? CONTENT_WIDTH - mm(fixed) : mm(width), align }));
};

async function drawTask(kit: ReportKit, task: WorkflowReportTask, options: WorkflowReportOptions, project: boolean, hourlyRate: number | null, texts: { w: PdfTexts; p: PdfTexts; r: PdfTexts }) {
  const { w, p, r } = texts;
  // The blocks a work order and the older risk assessment share by id; the other kinds of task are not drawn here.
  const own = task.kind === "WORK_ORDER" ? w : r;
  // In a project report every task is a part of its own with its title, kind and state.
  if (project) kit.part(task.title, `${kindLabel(task, p)} · ${statusLabel(task)} · ${p.text("part.progress", { procent: progress(task) })}${task.status === "COMPLETED" ? "" : ` · ${p.text("part.snapshot")}`}`);
  const tempPlace = tempPlaceOf(task.data) ? tempPlaceLabel(tempPlaceOf(task.data)) : "";
  if (options.summary) {
    const facts: KitFact[] = [
      { label: own.text("fact.customer"), span: 8, party: { name: task.customerName || own.text("party.none"), lines: [task.facilityName ?? "", tempPlace ? own.text("party.temp-place", { plats: tempPlace }) : ""].filter(Boolean) } },
      { label: own.text("fact.project"), value: task.projectName || own.text("project.none") },
      ...(project ? [{ label: own.text("fact.task"), value: task.title }] : []),
      // Hör till arbetsorder (Fas 4B): named on the report when the task belongs to one.
      ...(task.workOrderTitle ? [{ label: own.text("fact.order"), value: task.workOrderTitle }] : []),
      { label: task.kind === "WORK_ORDER" ? w.text("fact.doer") : r.text("fact.responsible"), value: task.assignedToName || (task.kind === "WORK_ORDER" ? w.text("doer.none") : r.text("responsible.none")) },
      ...(task.dueDate ? [{ label: own.text("fact.due"), value: task.dueDate }] : []),
      { label: own.text("fact.status"), value: own.text("fact.status.value", { status: statusLabel(task), procent: progress(task) }), tone: task.status === "COMPLETED" ? undefined : REPORT_TONES.warning },
      ...(options.time ? [{ label: own.text("fact.time"), value: duration(task.totalDurationSec) }] : []),
      ...(task.description ? [{ label: task.kind === "WORK_ORDER" ? w.text("fact.description") : r.text("fact.assignment"), value: task.description.replace(/\n{2,}/g, "\n"), span: 12, plain: true }] : []),
    ];
    kit.facts(facts, { cols: 3 });
    if (!project && task.projectFields?.length) {
      kit.section(own.text("section.project"), { keep: 30 });
      kit.facts(task.projectFields.map(([label, value]) => ({ label, value, span: factSpan(value) })), { cols: 3 });
    }
    // Riskbedömning som steg (2026-10-08): the job's risk check, when it has one.
    drawRiskStep(kit, task.data);
  }
  if (task.data.kind === "WORK_ORDER") {
    const details = task.data.details;
    // Underhåll (2026-10-06; on maintenance items since 2026-10-30): each item's facts under its machine part, only the filled-in ones.
    for (const item of options.summary ? task.maintenanceItems ?? [] : []) {
      const maintenance = maintenanceFacts(item.facts);
      kit.section(w.text("section.maintenance", { del: item.partName }), { keep: 40 });
      kit.facts(maintenance.length ? maintenance.map(([label, value]) => ({ label, value, span: label === "Fel eller symptom" ? 12 : factSpan(value), plain: label === "Fel eller symptom" })) : [{ label: w.text("maintenance.label"), value: w.text("maintenance.none"), span: 12 }], { cols: 3 });
    }
    // Utfört arbete and Tid och material in the template's order (the group "body"); a part the owner hid is left out.
    const materialsShown = options.materials && w.shown("section.materials");
    const drawExecution = () => {
      kit.section(w.text("section.execution"), { keep: 30 });
      for (const text of (details.executionNotes.trim() || w.text("execution.empty")).split(/\n{2,}/)) kit.paragraph(text, { after: mm(3) });
    };
    const drawMaterials = () => {
      // Material och utgifter (2026-10-08): the material table, then the expenses with their amounts excluding VAT and a sum.
      const rows = details.materials.filter((item) => item.name.trim());
      const materials = rows.filter((item) => !isExpenseRow(item));
      const expenses = rows.filter(isExpenseRow);
      kit.section(w.text("section.materials"), { note: options.prices && w.shown("materials.note") ? w.text("materials.note") : undefined, keep: 44 });
      // The report goes to the customer, so it shows the price to the customer only (2026-11-01): à-pris with the markup and
      // the amount – never the purchase price, the markup or the price file. Artikelnummer only when a row has one.
      const numbered = materials.some((item) => (item.articleNo ?? "").trim() || (item.manufacturerArticleNo ?? "").trim());
      const nameText = (item: (typeof materials)[number]) => item.storeRef ? `${item.name} · ${storeRowLabel(item)}` : item.name;
      const numberText = (item: { articleNo?: string; manufacturerArticleNo?: string }) => [(item.articleNo ?? "").trim(), (item.manufacturerArticleNo ?? "").trim() ? w.text("row.maker-no", { nr: item.manufacturerArticleNo!.trim() }) : ""].filter(Boolean).join(", ");
      const totals = options.prices ? customerPriceTotals(rows, task.billedLabour?.standardSec ?? task.totalDurationSec, hourlyRate, task.billedLabour?.own) : null;
      const hoursText = (hours: number) => formatPrice(Math.round(hours * 100) / 100);
      if (options.prices) {
        // A row without a price says so with the long dash, as an empty amount does everywhere.
        const money = (value: number | null) => value === null ? "—" : formatSek(value);
        const labourRows = [
          ...(totals && totals.labour.hours > 0 ? [[`${w.text("row.labour")}${totals.labour.rate === null ? ` ${w.text("row.no-rate")}` : ""}`, ...(numbered ? ["—"] : []), hoursText(totals.labour.hours), w.text("row.hours"), money(totals.labour.rate), money(totals.labour.amount)]] : []),
          ...(totals?.ownLabour ?? []).map((line) => [`${line.name}${line.rate === null ? ` ${w.text("row.no-price")}` : ""}`, ...(numbered ? ["—"] : []), hoursText(line.hours), w.text("row.hours"), money(line.rate), money(line.amount)]),
        ];
        const materialRows = materials.map((item) => {
          const price = materialRowPrice(item);
          return [nameText(item), ...(numbered ? [numberText(item) || "—"] : []), item.quantity, item.unit, money(price.saleUnitPrice), money(price.sale)];
        });
        // The total's label has every column but the amount's to stay on one line.
        if (labourRows.length || materialRows.length) kit.table({ title: w.text("section.materials"), columns: columns([["name", w.text("col.name"), null], ...(numbered ? [["articleNo", w.text("col.article"), 22] as const] : []), ["quantity", w.text("col.quantity"), 14, "right"], ["unit", w.text("col.unit"), 12], ["price", w.text("col.price"), 22, "right"], ["amount", w.text("col.amount"), 24, "right"]]),
          rows: [...labourRows, ...materialRows], total: totals ? [{ text: `${w.text("total.work-material")}${totals.material.unpriced ? ` (${unpricedText(totals.material.unpriced)})` : ""}`, span: numbered ? 5 : 4 }, ...(numbered ? [""] : []), "", "", "", formatSek((totals.labour.amount ?? 0) + totals.ownLabour.reduce((sum, line) => sum + (line.amount ?? 0), 0) + totals.material.sale)] : undefined });
        else kit.paragraph(w.text("materials.empty"));
      } else if (materials.length) {
        // Above an expense table its Antal and Enhet stand in the same places; Enhet takes the room of the prices.
        const widths = expenses.length ? { articleNo: 22, quantity: 14, unit: 58 } : { articleNo: 30, quantity: 18, unit: 18 };
        kit.table({ title: w.text("table.material"), columns: columns([["name", w.text("col.name"), null], ...(numbered ? [["articleNo", w.text("col.article"), widths.articleNo] as const] : []), ["quantity", w.text("col.quantity"), widths.quantity, "right"], ["unit", w.text("col.unit"), widths.unit]]), rows: materials.map((item) => [nameText(item), ...(numbered ? [numberText(item) || "—"] : []), item.quantity, item.unit]) });
      }
      else kit.paragraph(w.text("materials.empty"));
      if (expenses.length && !options.prices) {
        // Without prices an expense says what it is and how much of it, no amount and no rate; Antal and Enhet stand where they do in the table above.
        kit.table({ title: w.text("table.expenses"), columns: columns([["name", w.text("col.expense"), null], ["quantity", w.text("expenses.col.quantity"), 14, "right"], ["unit", w.text("expenses.col.unit"), 58]]),
          rows: expenses.map((item) => [withoutRate(item.name), item.quantity, item.unit]) });
      } else if (expenses.length) {
        // À-pris and Belopp in the same form as the material rows; a text that is no readable amount is printed as typed, and the sum counts it as missing.
        const money = (text: string | undefined) => { const value = parseAmount(text); return value === null ? text?.trim() || "—" : formatSek(value); };
        const sum = expenseTotal(expenses);
        kit.table({ title: w.text("table.expenses"), columns: columns([["name", w.text("col.expense"), null], ["quantity", w.text("expenses.col.quantity"), 14, "right"], ["unit", w.text("expenses.col.unit"), 12], ["price", w.text("expenses.col.price"), 22, "right"], ["amount", w.text("expenses.col.amount"), 24, "right"]]),
          rows: expenses.map((item) => [item.name, item.quantity, item.unit, money(item.unitPrice), money(item.amount)]),
          total: [{ text: `${w.text("total.expenses")}${sum.missing ? ` ${sum.missing === 1 ? w.text("total.expenses.one") : w.text("total.expenses.many", { antal: sum.missing })}` : ""}`, span: 4 }, "", "", "", formatSek(sum.total)] });
      }
      if (totals && (rows.length || task.totalDurationSec > 0)) {
        const { labour } = totals;
        const sumRows: KitSumRow[] = [
          ...(labour.hours > 0 ? [{ label: labour.rate === null ? w.text("sum.labour.no-rate") : w.text("sum.labour", { timmar: hoursText(labour.hours) }), value: labour.amount === null ? "—" : formatSek(labour.amount) }] : []),
          ...totals.ownLabour.map((line) => ({ label: `${line.name}, ${hoursText(line.hours)} h`, value: line.amount === null ? "—" : formatSek(line.amount) })),
          { label: w.text("sum.material"), value: formatSek(totals.material.sale) },
          { label: w.text("sum.expenses"), value: formatSek(totals.expenses.total) },
        ];
        kit.sumRow(totals.labourMissing ? { notes: [w.text("sum.note.no-rate")] } : null,
          sumRows, { label: w.text("total.sum"), value: `${formatSek(totals.total)} kr`, small: totals.labourMissing ? w.text("total.small.no-rate") : w.text("total.small") });
      }
    };
    for (const part of w.order("body")) {
      if (part === "section.execution" && options.execution) drawExecution();
      if (part === "section.materials" && materialsShown) drawMaterials();
    }
    kit.customerComments(task.customerComments ?? []);
    // Avvikelser och avslut has one layout and one place in every work order report, with or without prices. It starts where
    // it fits; its last part stands with the signatures.
    if (options.deviations) {
      const drawDeviations = () => kit.block(w.text("closing.deviations"), [details.deviations.trim() || w.text("closing.none")], { tone: details.deviations.trim() ? REPORT_TONES.fail : undefined });
      kit.section(w.text("section.closing"), { keep: kit.measure(drawDeviations).height });
      drawDeviations();
    }
    kit.keep(() => {
      if (options.deviations) kit.block(w.text("closing.comment"), [details.closeNotes.trim() || w.text("closing.no-comment")]);
      if (options.approval) {
        kit.section(w.text("section.signing"), { keep: 70 });
        const { signature } = details;
        // A name kept from before a reopening (F17) stands with "Inte signerad", so the report never reads as signed.
        // Kundens kvittens (beslut 6, 2026-11-01): name and time; a drawn signature comes later.
        kit.signatures([
          { label: w.text("sign.done"), name: signature.name.trim() || undefined, note: signature.confirmed && signature.signedAt ? w.text("sign.signed", { tid: reportTime(signature.signedAt) }) : w.text("sign.unsigned") },
          { label: w.text("sign.receipt"), name: details.customerReceipt?.name || undefined, note: details.customerReceipt?.name ? (details.customerReceipt.at ? w.text("sign.received", { tid: reportTime(details.customerReceipt.at) }) : w.text("sign.received.plain")) : w.text("sign.no-receipt"), caps: [kit.common.text("sign.name"), kit.common.text("sign.date")] },
        ]);
      }
    });
  } else if (task.data.kind === "RISK_ASSESSMENT") {
    const details = task.data.details;
    const level = (s: number, k: number) => riskLevel(s * k);
    if (options.riskMatrix) {
      // The risks' numbers in the cells of their risk before the measures, as the safety round prints its observations.
      const marks = new Map<string, string[]>();
      details.risks.forEach((risk, index) => { const key = `${risk.likelihood},${risk.consequence}`; marks.set(key, [...(marks.get(key) ?? []), String(index + 1)]); });
      kit.riskPanel({ size: 5, levelOf: level, cellText: (s, k) => (marks.get(`${s},${k}`) ?? []).join(" "), caption: r.text("matrix.caption"), legend: riskLegend(r), matrixTitle: r.text("matrix.title") });
    }
    if (options.risks) {
      kit.section(r.text("section.risks"), { note: r.text("risks.note"), keep: 44 });
      if (!details.risks.length) kit.paragraph(r.text("risks.none"));
      else kit.table({ title: r.text("section.risks"), dense: true, columns: columns([["n", r.text("col.number"), 8, "center"], ["hazard", r.text("col.hazard"), 40], ["before", r.text("col.before"), 11, "center"], ["risk", r.text("col.risk"), 26], ["measure", r.text("col.measure"), null], ["after", r.text("col.after"), 14, "center"], ["residual", r.text("col.residual"), 24]]),
        rows: details.risks.map((risk, index) => {
          const before = risk.likelihood * risk.consequence;
          const after = risk.residualLikelihood * risk.residualConsequence;
          return [String(index + 1), risk.hazard.trim() || "—", `${risk.likelihood}×${risk.consequence}`, { mark: { level: riskLevel(before), text: `${before} ${riskLabel(before)}` } }, risk.protectiveMeasure.trim() || r.text("measure.none"), `${risk.residualLikelihood}×${risk.residualConsequence}`, { mark: { level: riskLevel(after), text: `${after} ${riskLabel(after)}` } }];
        }) });
    }
    if (options.execution) {
      kit.section(r.text("section.general"), { keep: 30 });
      for (const text of (details.generalMeasures.trim() || r.text("general.none")).split(/\n{2,}/)) kit.paragraph(text, { after: mm(3) });
    }
    if (options.approval) {
      const { approval } = details;
      kit.keep(() => kit.signatures([
        { label: r.text("sign.approved"), name: approval.name.trim() || undefined, note: approval.confirmed && approval.approvedAt ? r.text("sign.approved.at", { tid: reportTime(approval.approvedAt) }) : r.text("sign.approved.none") },
        { label: r.text("sign.participants"), caps: [kit.common.text("sign.name"), kit.common.text("sign.date")] },
      ]));
    }
  }
  // Pictures two by two with their names, like a protocol's; other files are named in the list below.
  const images = options.images ? task.attachments.filter((item) => item.mimeType.startsWith("image/") && item.bytes && (isPng(item.bytes) || isJpeg(item.bytes))) : [];
  if (images.length) {
    kit.section(w.text("section.images"), { keep: mm(45) + mm(1) + 2 * 8.5 * 1.3 + mm(4) });
    await kit.photos(images.map((item) => ({ bytes: item.bytes!, caption: item.filename })));
  }
  if (options.attachments && task.attachments.length) {
    const files: KitAttachment[] = task.attachments.map((item) => ({ filename: item.filename, mimeType: item.mimeType, label: w.text(item.mimeType.startsWith("image/") ? "attach.image" : "attach.file") }));
    kit.attachmentList(files, images.length === task.attachments.length ? w.text("attach.images-above") : w.text("attach.files"));
  }
}
