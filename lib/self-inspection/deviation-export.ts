import { csvCell } from "@/lib/csv/cell";
import { formatSwedish, formatSwedishDate, swedishDayKey } from "@/lib/swedish-time";
import { continuationOf, createReportKit, isJpeg, isPng, mm, REPORT_TONES, type KitIdentity } from "@/lib/workflow/report-kit";
import type { ReportFontBytes } from "@/lib/workflow/report-fonts";
import { deviationClosedText, deviationOrderText } from "./deviation-link";
import { DEVIATION_PHOTO_PHASES, DEVIATION_SEVERITIES, DEVIATION_SEVERITY_STEP, DEVIATION_TYPES, deviationSeverity, deviationType, isIncidentType, mayReadDeviation, type DeviationViewer } from "./incidents";
import { DEVIATION_CATEGORIES, DEVIATION_KINDS, DEVIATION_STATUSES, type DeviationView } from "./model";
import { pdfTexts } from "@/lib/pdf-templates/catalog";
import type { PdfTexts } from "@/lib/pdf-templates/model";

/**
 * Exportera på Avvikelser (2026-10-30: "På Rapportera avvikelse vill jag ha exportfunktionen som finns på vissa
 * sidor som genererar PDF m.m."): the log's entries as a PDF report (the report kit, like every document in Workflow) or a
 * CSV with one row per entry. Pure functions, so Cloud draws on the server (app/api/self-inspection/deviation-export) and
 * Local and the demo draw the same file in the browser. The read rule of ./incidents.ts is applied here again whoever
 * calls it: an entry the reader may not read is never part of a file. No text from any authority, only the marks the
 * company set (Allvarlig, Personskada, Gäller el, anmäld) – never a diagnosis.
 */

/** The parts a person can leave out (ExportMenu "Ta med"); the head of each entry – type, status, people, dates – is always there. */
export const DEVIATION_EXPORT_SECTIONS = [
  { key: "description", label: "Beskrivning" },
  { key: "action", label: "Åtgärd" },
  { key: "investigation", label: "Utredning" },
  { key: "history", label: "Anmälan och avslut" },
  { key: "photos", label: "Bilder" },
] as const;
export type DeviationExportSection = (typeof DEVIATION_EXPORT_SECTIONS)[number]["key"];
export type DeviationExportSections = Partial<Record<DeviationExportSection, boolean>>;
export const DEVIATION_EXPORT_FORMATS = ["pdf", "csv"] as const;
export type DeviationExportFormat = (typeof DEVIATION_EXPORT_FORMATS)[number];
/** As many as the log's page reads (the latest 200). */
export const DEVIATION_EXPORT_MAX = 200;
/** Photos drawn in one PDF at most (the rest are counted), so a report never grows without end. */
export const DEVIATION_EXPORT_PHOTO_MAX = 60;

export type DeviationExportEntry = Omit<DeviationView, "mine"> & { mine?: boolean };

/** "Tillbud 4", "Avvikelse 2" (an Elinstallation entry keeps its kind's name), "Förbättring 3". */
export const deviationEntryLabel = (item: { kind: keyof typeof DEVIATION_KINDS; number: number; type?: string | null }) =>
  `${item.kind === "IMPROVEMENT" || deviationType(item.type) === "SELF_INSPECTION" ? DEVIATION_KINDS[item.kind] : DEVIATION_TYPES[deviationType(item.type)]} ${item.number}`;

/**
 * The entries a file holds: those asked for, in the log's order, and only those the reader may read. The list the page
 * shows is already read this way; this is the second lock, so a crafted id never reaches a file.
 */
export function exportableDeviations<T extends DeviationExportEntry>(entries: readonly T[], ids: readonly string[], viewer: DeviationViewer): T[] {
  const wanted = new Set(ids);
  return entries.filter((entry) => wanted.has(entry.id) && mayReadDeviation(viewer, { type: entry.type, reportedById: entry.reportedById, responsibleId: entry.responsibleId })).slice(0, DEVIATION_EXPORT_MAX);
}

const on = (sections: DeviationExportSections, key: DeviationExportSection) => sections[key] !== false;
const day = (value: string | null | undefined) => value ? (/^\d{4}-\d{2}-\d{2}$/.test(value) ? value : swedishDayKey(value)) : "";
const when = (value: string | null | undefined) => value ? formatSwedish(value, { dateStyle: "short", timeStyle: "short" }) : "";
const yes = (value: boolean | null | undefined) => value ? "Ja" : "Nej";
/** Anmälningspliktig · Personskada · Gäller el – the marks the reporter set, nothing more. */
const marks = (entry: DeviationExportEntry, t: PdfTexts) => [entry.serious ? t.text("mark.serious") : "", entry.personalInjury ? t.text("mark.injury") : "", entry.electrical ? t.text("mark.electrical") : ""].filter(Boolean).join(" · ");
/** Anmäld 2026-10-30 av Berit Chef; empty when nothing is to be reported. */
export function authorityText(entry: Pick<DeviationExportEntry, "type" | "serious" | "reportedToAuthorityAt" | "reportedToAuthorityByName">, t: PdfTexts = pdfTexts("deviation")) {
  if (!isIncidentType(entry.type) || !entry.serious) return "";
  if (!entry.reportedToAuthorityAt) return t.text("history.not-reported");
  const by = entry.reportedToAuthorityByName?.trim();
  return by ? t.text("history.reported.by", { datum: day(entry.reportedToAuthorityAt), namn: by }) : t.text("history.reported", { datum: day(entry.reportedToAuthorityAt) });
}

/** Allvarlighetsgrad as written in a file; a Förbättring has none. */
export const severityText = (entry: Pick<DeviationExportEntry, "kind" | "severity">) => entry.kind === "IMPROVEMENT" ? "" : DEVIATION_SEVERITIES[deviationSeverity(entry.severity)];

/** The CSV's columns for the chosen parts (Excel, semicolons, a BOM so å/ä/ö read right). */
export function deviationCsvHeader(sections: DeviationExportSections): string[] {
  return [
    "Nummer", "Typ", "Rubrik", "Allvarlighetsgrad", "Status", "Klass", "Rapporterad", "Rapporterad av", "Ansvarig", "Klart senast", "Åtgärdad",
    ...(on(sections, "description") ? ["Beskrivning"] : []),
    ...(on(sections, "action") ? ["Åtgärd", "Uppföljning"] : []),
    ...(on(sections, "investigation") ? ["Hände", "Vad hände", "Varför", "Anmälningspliktig", "Personskada", "Gäller el"] : []),
    ...(on(sections, "history") ? ["Anmälan", "Notering vid klar", "Arbetsorder", "Från protokoll"] : []),
    ...(on(sections, "photos") ? ["Bilder"] : []),
  ];
}

/** One entry as one CSV row, in the header's order. */
export function deviationCsvRow(entry: DeviationExportEntry, sections: DeviationExportSections): string[] {
  const type = deviationType(entry.type);
  const incident = isIncidentType(type);
  return [
    deviationEntryLabel(entry), entry.kind === "IMPROVEMENT" ? DEVIATION_KINDS.IMPROVEMENT : DEVIATION_TYPES[type], entry.title, severityText(entry), DEVIATION_STATUSES[entry.status],
    type === "SELF_INSPECTION" && entry.kind !== "IMPROVEMENT" ? DEVIATION_CATEGORIES[entry.category] : "", day(entry.createdAt), entry.reportedByName ?? "", entry.responsibleName ?? "",
    entry.dueDate ?? "", entry.status === "DONE" ? day(entry.closedAt) : "",
    ...(on(sections, "description") ? [entry.description] : []),
    ...(on(sections, "action") ? [entry.action, entry.followUp] : []),
    ...(on(sections, "investigation") ? (incident ? [when(entry.occurredAt), entry.whatHappened ?? "", entry.cause ?? "", yes(entry.serious), yes(entry.personalInjury), yes(entry.electrical)] : ["", "", "", "", "", ""]) : []),
    ...(on(sections, "history") ? [authorityText(entry), entry.doneNote ?? "", entry.workOrder ? deviationOrderText(entry.workOrder) : "", entry.source ? entry.source.title || "Protokoll" : ""] : []),
    ...(on(sections, "photos") ? [String(entry.attachments?.length ?? 0)] : []),
  ];
}

export function deviationsCsv(entries: readonly DeviationExportEntry[], sections: DeviationExportSections): string {
  const rows = [deviationCsvHeader(sections), ...entries.map((entry) => deviationCsvRow(entry, sections))];
  return "﻿" + rows.map((row) => row.map(csvCell).join(";")).join("\r\n") + "\r\n";
}

const safeName = (value: string) => value.replace(/[<>:"/\\|?*\u0000-\u001f]+/g, "-").replace(/\s+/g, " ").trim().slice(0, 120) || "avvikelser";
/** avvikelser-2026-10-30.pdf, or "Tillbud 4 - Stege gled.pdf" for one entry. */
export function deviationExportFilename(entries: readonly DeviationExportEntry[], format: DeviationExportFormat, today = swedishDayKey(new Date())) {
  const base = entries.length === 1 ? `${deviationEntryLabel(entries[0]!)} - ${entries[0]!.title}` : `avvikelser-${today}`;
  return `${safeName(base)}.${format}`;
}

/** A photo's bytes for the PDF, keyed by the attachment's id; missing or another format is counted, never drawn. */
export type DeviationPhotoBytes = ReadonlyMap<string, Uint8Array>;
/** The photos a PDF draws: JPG and PNG, at most DEVIATION_EXPORT_PHOTO_MAX, in the log's order. */
export function exportPhotoIds(entries: readonly DeviationExportEntry[]): string[] {
  return entries.flatMap((entry) => (entry.attachments ?? []).filter((photo) => photo.mimeType === "image/jpeg" || photo.mimeType === "image/png").map((photo) => photo.id)).slice(0, DEVIATION_EXPORT_PHOTO_MAX);
}

/**
 * The PDF (the design Förslag B 2026-11-03, template 15-avvikelserapport): one entry is a report of its own – the head
 * with its number, a facts grid with who, when, severity (as a risk mark) and the type as choices, then Beskrivning,
 * Åtgärd, Uppföljning, Utredning and Anmälan och avslut as plain sections, the pictures, the status in the one framed
 * box and the signature block. A list of entries is a log: a summary grid, then each entry under its own heading with
 * the same parts. `scope` says which selection it is ("Öppna · Tillbud").
 */
export async function createDeviationsPdf(input: { identity: KitIdentity; fontBytes: ReportFontBytes; entries: readonly DeviationExportEntry[]; sections: DeviationExportSections; /** Kommentarer: per entry, only those chosen "Med i kundrapporten". */ comments?: ReadonlyMap<string, readonly { authorName: string; body: string; createdAt: string }[]>;
  photos?: DeviationPhotoBytes; scope?: string; createdAt?: Date; /** Cloud: the line on how long the log is kept (./retention.ts); a Local file is the company's own. */ retentionNote?: boolean }) {
  const createdAt = input.createdAt ?? new Date();
  const { entries, sections } = input;
  const single = entries.length === 1 ? entries[0]! : null;
  const made = formatSwedish(createdAt, { dateStyle: "short", timeStyle: "short" });
  // PDF-mallar (2026-11-03): the product owner's texts and the order of the parts, today's by default.
  const t = pdfTexts("deviation", input.identity.templates);
  const reportTitle = (entry: DeviationExportEntry) => t.text(entry.kind === "IMPROVEMENT" ? "title.improvement" : deviationType(entry.type) === "NEAR_MISS" ? "title.near-miss" : deviationType(entry.type) === "ACCIDENT" ? "title.accident" : deviationType(entry.type) === "RISK_OBSERVATION" ? "title.risk" : "title.deviation");
  const kindId = (entry: DeviationExportEntry | null) => entry ? (isIncidentType(entry.type) ? "kind.incident" : "kind.deviation") : "kind.log";
  const title = single ? reportTitle(single) : t.text("title.log");
  const kit = await createReportKit({ identity: input.identity, fontBytes: input.fontBytes, createdAt, head: {
    kind: t.shown(kindId(single)) ? t.text(kindId(single)) : "", title,
    number: single ? `${deviationEntryLabel(single)} · ${single.title}` : [entries.length === 1 ? t.text("head.posts.one") : t.text("head.posts.many", { antal: entries.length }), input.scope ?? ""].filter(Boolean).join(" · "),
    dates: single ? [[t.text("head.reported"), day(single.createdAt)], [t.text("head.status"), DEVIATION_STATUSES[single.status]]] : [[t.text("head.created"), made]],
    continuation: continuationOf(input.identity, single ? deviationEntryLabel(single) : t.text("head.posts.many", { antal: entries.length })),
  } });
  kit.pdf.setTitle(single ? `${deviationEntryLabel(single)} · ${single.title}` : "Avvikelser");
  kit.pdf.setAuthor(input.identity.company || "Workflow");
  kit.pdf.setCreator("Workflow");
  kit.pdf.setProducer("Workflow");
  kit.pdf.setCreationDate(createdAt);
  kit.firstPage();
  if (!single) {
    const open = entries.filter((entry) => entry.status !== "DONE").length;
    const overdue = entries.filter((entry) => entry.status !== "DONE" && entry.dueDate && entry.dueDate < swedishDayKey(createdAt)).length;
    // No "Företag" fact: the name stands in the head (PDF review 2026-11-03, finding 11).
    kit.facts([
      { label: t.text("log.count"), value: String(entries.length) },
      { label: t.text("log.scope"), value: input.scope || t.text("log.scope.all") },
      { label: t.text("log.open"), value: String(open) },
      { label: t.text("log.overdue"), value: overdue ? String(overdue) : t.text("log.overdue.none"), tone: overdue ? REPORT_TONES.fail : undefined },
      { label: t.text("log.incidents"), value: String(entries.filter((entry) => isIncidentType(entry.type)).length) },
      { label: t.text("log.created"), value: made },
    ], { cols: 3 });
  }

  const labelled = (id: string, value: string | null | undefined) => {
    if (!value?.trim() || !t.shown(id)) return;
    const label = t.text(id);
    if (single) kit.section(label, { keep: 30 }); else kit.subTitle(label, 20);
    for (const text of value.trim().split(/\n{2,}/)) kit.paragraph(text, { after: mm(2) });
  };
  let skipped = 0;
  for (const entry of entries) {
    const type = deviationType(entry.type);
    const incident = isIncidentType(type);
    // In a log every part of an entry may land on a new page: the page then says whose part it is.
    kit.running = "";
    if (!single) {
      kit.section(`${deviationEntryLabel(entry)} · ${entry.title}`, { note: [entry.kind === "IMPROVEMENT" ? DEVIATION_KINDS.IMPROVEMENT : DEVIATION_TYPES[type], DEVIATION_STATUSES[entry.status], marks(entry, t)].filter(Boolean).join(" · "), keep: 60 });
      kit.running = `${deviationEntryLabel(entry)} · ${entry.title}`;
    }
    const late = entry.status !== "DONE" && entry.dueDate && entry.dueDate < swedishDayKey(createdAt);
    const step = DEVIATION_SEVERITY_STEP[deviationSeverity(entry.severity)];
    kit.facts([
      { label: t.text("fact.reporter"), value: `${entry.reportedByName || t.text("reporter.none")}, ${formatSwedishDate(entry.createdAt)}` },
      { label: t.text("fact.responsible"), value: entry.responsibleName || t.text("responsible.none") },
      { label: t.text("fact.due"), value: entry.dueDate ? `${entry.dueDate}${late ? ` · ${t.text("due.late")}` : ""}` : t.text("due.none"), tone: late ? REPORT_TONES.fail : undefined },
      ...(entry.kind === "IMPROVEMENT" ? [] : [{ label: t.text("fact.severity"), mark: { level: step, text: `${step} ${severityText(entry)}` } }]),
      // The closed text starts with the status word ("Åtgärdad 2026-10-28 av …"), so it stands instead of the word.
      { label: t.text("fact.status"), value: deviationClosedText(entry) || DEVIATION_STATUSES[entry.status], span: deviationClosedText(entry) ? 8 : undefined, tone: entry.status === "DONE" ? REPORT_TONES.pass : undefined },
      ...(type === "SELF_INSPECTION" && entry.kind !== "IMPROVEMENT" ? [{ label: t.text("fact.class"), value: DEVIATION_CATEGORIES[entry.category] }] : []),
      ...(entry.workOrder || entry.source ? [{ label: t.text("fact.related"), value: [entry.workOrder ? deviationOrderText(entry.workOrder) : "", entry.source ? t.text("related.protocol", { titel: entry.source.title || t.text("source.none") }) : ""].filter(Boolean).join(" · ") }] : []),
      // The type as choices, as the template prints "Typ av avvikelse" – the chosen one ticked.
      { label: t.text(entry.kind === "IMPROVEMENT" ? "fact.type" : "fact.type.deviation"), span: 12, choices: entry.kind === "IMPROVEMENT" ? [{ text: DEVIATION_KINDS.IMPROVEMENT, checked: true }] : (Object.keys(DEVIATION_TYPES) as (keyof typeof DEVIATION_TYPES)[]).map((key) => ({ text: DEVIATION_TYPES[key], checked: key === type })) },
    ], { cols: 3 });
    // The parts in the template's order (the group "parts"); a part the owner hid is never printed.
    for (const part of t.order("parts")) {
      if (part === "section.description" && on(sections, "description")) labelled(part, entry.description);
      if (part === "section.action" && on(sections, "action")) {
        labelled(part, entry.action);
        labelled("section.follow-up", entry.followUp);
      }
      if (part === "section.investigation" && on(sections, "investigation") && incident) {
        if (single) kit.section(t.text(part), { keep: 30 }); else kit.subTitle(t.text(part), 30);
        kit.facts([{ label: t.text("investigation.occurred"), value: entry.occurredAt ? when(entry.occurredAt) : t.text("occurred.none") }, { label: t.text("investigation.marks"), value: marks(entry, t) || t.text("marks.none") }], { cols: 3 });
        labelled("section.what", entry.whatHappened);
        labelled("section.why", entry.cause);
      }
      if (part === "section.history" && on(sections, "history")) {
        const lines = [
          authorityText(entry, t),
          entry.doneNote?.trim() ? t.text("history.done-note", { text: entry.doneNote.trim() }) : "",
          entry.workOrder ? deviationOrderText(entry.workOrder) : "",
          entry.source ? t.text("history.source", { titel: entry.source.title || t.text("source.none") }) : "",
        ].filter(Boolean);
        if (lines.length) {
          if (single) kit.section(t.text(part), { keep: 20 }); else kit.subTitle(t.text(part), 20);
          for (const line of lines) kit.paragraph(line, { after: mm(0.8) });
        }
      }
      if (part === "section.photos" && on(sections, "photos") && entry.attachments?.length) {
        const drawn = entry.attachments.flatMap((photo) => {
          const bytes = input.photos?.get(photo.id);
          return bytes && (isJpeg(bytes) || isPng(bytes)) ? [{ bytes, caption: `${DEVIATION_PHOTO_PHASES[photo.phase]} · ${photo.filename}` }] : [];
        });
        if (drawn.length) {
          skipped += entry.attachments.length - drawn.length;
          if (single) kit.section(t.text(part), { keep: 100 }); else kit.subTitle(t.text(part), 100);
          await kit.photos(drawn);
        } else kit.paragraph(entry.attachments.length === 1 ? t.text("photos.one") : t.text("photos.many", { antal: entry.attachments.length }), { color: kit.colors.muted, size: 9 });
      }
    }
    kit.customerComments(input.comments?.get(entry.id) ?? []);
    if (single) kit.keep(() => {
      kit.decision({ label: t.text("decision.label"), choices: [{ text: t.text("decision.done"), checked: entry.status === "DONE" }, { text: t.text("decision.closed"), checked: entry.status === "DONE" && Boolean(entry.closedAt) }], lines: [entry.status === "DONE" ? deviationClosedText(entry) || t.text("decision.done") : t.text("decision.closed-date")] });
      kit.signatures([
        { label: t.text("sign.reported"), name: entry.reportedByName || undefined, note: t.text("sign.reported.at", { tid: when(entry.createdAt) }) },
        { label: t.text("sign.closed"), name: entry.status === "DONE" ? entry.closedByName?.trim() || undefined : undefined, note: entry.status === "DONE" && entry.closedAt ? t.text("sign.closed.at", { datum: day(entry.closedAt) }) : undefined },
      ]);
    });
  }
  kit.running = "";
  if (!entries.length) kit.paragraph(t.text("empty"));
  if (skipped) kit.paragraph(skipped === 1 ? t.text("skipped.one") : t.text("skipped.many", { antal: skipped }), { color: kit.colors.muted, size: 9 });
  if (input.retentionNote && entries.length && t.shown("retention.note")) kit.paragraph(t.text("retention.note"), { color: kit.colors.muted, size: 9 });
  kit.footer();
  return kit.pdf.save();
}
