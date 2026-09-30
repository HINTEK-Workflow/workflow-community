import ExcelJS from "exceljs";
import {
  type ControlData,
  type Measurement,
  type SectionKey,
  RULE_VERSION,
  evaluate,
  sectionKeys,
  sections,
  totals,
  validateForCompletion,
  visualFields,
} from "./model";
import { type ReportBranding, reportBranding } from "./report-branding";
import { REPORT_TONES, assessmentCell, clean, CONTENT_WIDTH, createReportKit, type KitColumn } from "@/lib/workflow/report-kit";

export type ReportIdentity = {
  company: string;
  branding?: Partial<ReportBranding> | null;
  logoBytes?: Uint8Array | null;
};

export type ReportFile = {
  filename: string;
  mimeType: string;
  section: string;
  rowId: string | null;
  label?: string;
  bytes?: Uint8Array;
};

/**
 * The Kontroll före idrifttagning report (V1 layout). It is drawn with the shared report kit, which every form report
 * uses too (Daniel 2026-09-27: this report is the model); tests/report-reference.test.ts keeps it exactly as it was.
 */
export async function createPdfReport(
  data: ControlData,
  identity: ReportIdentity,
  files: ReportFile[],
  template: boolean,
  fontBytes: Uint8Array,
) {
  const kit = await createReportKit({ identity, fontBytes, overline: "KONTROLL FÖRE IDRIFTTAGNING", continuation: "Kontrollprotokoll · fortsättning" });
  const { pdf } = kit;
  pdf.setTitle(template ? "KFID – tom kontrollprotokollmall" : `KFID – ${data.meta.proj || "kontrollprotokoll"}`);
  pdf.setAuthor(identity.company || "HINTEK Workflow");
  pdf.setCreator("HINTEK Workflow");
  pdf.setProducer("HINTEK Workflow");
  pdf.setSubject(`Kontroll före idrifttagning · ${RULE_VERSION}`);
  pdf.setCreationDate(new Date());

  kit.firstPage("Kontrollprotokoll", RULE_VERSION);
  kit.factBoxes([
    ["Projekt / anläggning", data.meta.proj],
    ["Utfört av", data.meta.perf],
    ["Datum", data.meta.date],
    ["Kontaktperson", data.meta.client],
    ["E-post", data.meta.addr],
    ["Kontrollerat av", data.meta.ctrl],
    ["Instrument (typ)", data.meta.instr],
    ["Instrument S/N", data.meta.sn],
    ["Kalibrering (datum)", data.meta.cal],
  ].map(([label, value], index) => ({ label, value: template ? "" : value, soft: index === 0 })), { fixedLines: 2 });

  // Widths in the V1 proportions (515 pt), fitted to the content width; Godkänd holds "Ej godkänd" on one line (2026-09-28).
  const fit = (list: KitColumn[]) => list.map((column) => ({ ...column, width: column.width * CONTENT_WIDTH / 515 }));
  const columns: Record<Exclude<SectionKey, "rcd">, KitColumn[]> = {
    iso: [
      { key: "objekt", label: "Krets / objekt", width: 118 },
      { key: "u", label: "Testspänning", width: 72 },
      { key: "mohm", label: "Uppmätt Riso (MΩ)", width: 82 },
      { key: "limit", label: "Min. gräns (MΩ)", width: 74 },
      { key: "comment", label: "Kommentar", width: 115 },
      { key: "ok", label: "Godkänd", width: 54, center: true },
    ],
    cont: [
      { key: "name", label: "Ledare / sträcka", width: 135 },
      { key: "ohm", label: "Uppmätt R low (Ω)", width: 87 },
      { key: "limit", label: "Gräns (Ω)", width: 75 },
      { key: "comment", label: "Kommentar", width: 164 },
      { key: "ok", label: "Godkänd", width: 54, center: true },
    ],
    volt: [
      { key: "name", label: "Mätpunkt", width: 130 },
      { key: "status", label: "Uppmätt spänning", width: 100 },
      { key: "rotation", label: "Rotationsriktning", width: 95 },
      { key: "comment", label: "Kommentar", width: 136 },
      { key: "ok", label: "Godkänd", width: 54, center: true },
    ],
  };
  // A row with nothing in it (the empty row of a chosen moment) has not been judged: printed empty, never Ej godkänd.
  const started = (row: Measurement) => Object.keys(row).some((name) => name !== "id");
  // By hand an unticked Godkänd is an assessment not made: printed empty like an untouched row (docs/rapportprinciper.md, F7).
  const passed = (key: SectionKey, row: Measurement) => data.meta.autoOn ? evaluate(key, row) : row.ok === true ? true : null;
  for (const key of sectionKeys) {
    if (!data.active[key]) continue;
    // A heading never stands alone at the foot of a page (2026-09-28): it keeps the table header and a row, or the first card.
    kit.blockTitle(sections[key].title, sections[key].description, key === "rcd" ? 116 : 55);
    const rows = data[key].rows.length ? data[key].rows : template ? ([{}, {}] as Measurement[]) : ([{}] as Measurement[]);
    if (key === "rcd") {
      for (const [index, row] of rows.entries()) {
        // The card always names its judgement (Daniel 2026-09-30): "Godkänd: —" in grey until the test is judged.
        const judged = assessmentCell(started(row) ? passed("rcd", row) : null);
        const value = (name: string, unit: string) => {
          if (template) return "";
          if (name === "t1p") return `${clean(row.t1p)} / ${clean(row.t1n)} ${unit}`;
          if (name === "t5p") return `${clean(row.t5p)} / ${clean(row.t5n)} ${unit}`;
          const text = clean(row[name]);
          return typeof row[name] !== "boolean" && text !== "—" ? `${text}${unit ? ` ${unit}` : ""}` : text;
        };
        kit.card({
          title: template ? `Prov ${index + 1}` : `${clean(row.place)} · ${clean(row.std)} · typ ${clean(row.type)} · ${clean(row.idn)} mA`,
          result: template ? "Godkänd ☐" : judged.text || "Godkänd: —",
          metrics: ([
            ["Utlösn.ström +", "idp", "mA"],
            ["Utlösn.ström −", "idn_measured", "mA"],
            ["t 1× + / −", "t1p", "ms"],
            ["t 5× + / −", "t5p", "ms"],
            ["Uc uppmätt", "uc", "V"],
            ["0,5× IΔn", "ntrip05", ""],
            ["Testknapp", "btnok", ""],
          ] as const).map(([label, name, unit]) => ({ label, value: value(name, unit) })),
          comment: `Kommentar: ${template ? "" : clean(row.comment)}`,
        }, { resultTone: template ? undefined : judged.text ? judged.tone : REPORT_TONES.muted });
      }
    } else kit.table(sections[key].title, fit(columns[key]), rows.map((row) => columns[key].map((column) => {
      if (column.key === "comment") return `${row.example === true && !template ? "EXEMPELDATA – " : ""}${template ? "" : clean(row.comment)}`;
      if (column.key === "ok") return template ? "☐" : assessmentCell(started(row) ? passed(key, row) : null).text;
      return template ? "" : clean(row[column.key]);
    })), [], rows.map((row) => columns[key].map((column) => column.key === "ok" && !template ? assessmentCell(started(row) ? passed(key, row) : null).tone : undefined)));
  }

  if (data.active.vis) {
    kit.blockTitle("Visuell kontroll");
    kit.checkBoxes(visualFields.map((field) => ({ label: field.label, checked: !template && data.vis.checks[field.key] === true })));
  }

  kit.blockTitle("Sammanfattning / avvikelser");
  const completion = validateForCompletion(data, { attachmentCount: files.length });
  kit.textBox(template ? [""] : [
    ...totals(data).map((item) => `${item.title}: ${item.ok}/${item.total} godkända`),
    data.vis.comment || "Inga ytterligare kommentarer.",
    `Kompletteringsgrad: ${completion.progress.percent}%`,
  ]);

  const listed = files.map((file, index) => ({ ...file, label: file.label || file.section, number: index + 1 }));
  if (!template) kit.attachmentList(listed);

  kit.chapter("Stöd vid bedömning", `KFID:s konfigurerade regelprofil ${RULE_VERSION}. Kontrollera alltid mot gällande standard, projekteringsunderlag, nätform och tillverkarens anvisningar.`);
  kit.infoCard("Isolation", ["Valbara testspänningar i KFID: 250 V, 500 V och 1000 V.", "Godkänd när uppmätt Riso är lika med eller högre än det gränsvärde som registrerats på kontrollraden."]);
  kit.infoCard("Kontinuitet", ["Godkänd när uppmätt resistans är lika med eller lägre än det registrerade gränsvärdet.", "Bedöm valt gränsvärde utifrån ledarlängd, area och aktuella förutsättningar."]);
  kit.infoCard("Spänningsprovning", ["KFID:s autobedömning godkänner registrerad 230 Vac eller 400 Vac.", "Rotationsriktning registreras separat och ska bedömas för den aktuella installationen."]);
  kit.infoCard("Jordfelsbrytarprov", ["1× IΔn: EN högst 300 ms, TNIT högst 400 ms, TT högst 200 ms.", "5× IΔn: högst 40 ms. Testknappen ska vara bekräftad.", "Övriga registrerade provvärden ska granskas mot vald utrustning och aktuella krav."]);

  await kit.attachmentPages(listed);
  kit.footer(`${RULE_VERSION} · ${data.meta.date || "odaterad"}`);
  return pdf.save();
}

const excelColor = (value: string) =>
  `FF${value.replace("#", "").toUpperCase()}`;

export async function createExcelReport(
  data: ControlData,
  identity: ReportIdentity,
  template = false,
  attachmentCount?: number,
) {
  const brand = reportBranding(identity.branding);
  const primary = excelColor(brand.primary);
  const accent = excelColor(brand.accent);
  const soft = excelColor(brand.soft);
  const book = new ExcelJS.Workbook();
  book.creator = "HINTEK Workflow";
  book.company = identity.company || "HINTEK";
  book.subject = `Kontroll före idrifttagning · ${RULE_VERSION}`;
  book.title = template ? "Tom kontrollprotokollmall" : data.meta.proj || "Kontrollprotokoll";
  book.created = new Date();
  const styleSheet = (sheet: ExcelJS.Worksheet, count: number) => {
    sheet.pageSetup = {
      paperSize: 9,
      orientation: count > 7 ? "landscape" : "portrait",
      fitToPage: true,
      fitToWidth: 1,
      fitToHeight: 0,
      margins: { left: 0.3, right: 0.3, top: 0.5, bottom: 0.5, header: 0.2, footer: 0.2 },
    };
    sheet.headerFooter.oddFooter = `KFID · ${RULE_VERSION} · &P / &N`;
  };
  const titleRow = (sheet: ExcelJS.Worksheet, title: string, count: number) => {
    sheet.mergeCells(1, 1, 1, count);
    const heading = sheet.getCell(1, 1);
    heading.value = title;
    heading.font = { bold: true, color: { argb: "FFFFFFFF" }, size: 15 };
    heading.fill = { type: "pattern", pattern: "solid", fgColor: { argb: primary } };
    heading.alignment = { vertical: "middle" };
    sheet.getRow(1).height = 30;
    sheet.mergeCells(2, 1, 2, count);
    sheet.getCell(2, 1).value = identity.company || "HINTEK";
    sheet.getCell(2, 1).font = { bold: true, color: { argb: accent } };
  };
  const styleHeader = (row: ExcelJS.Row) => {
    row.font = { bold: true, color: { argb: primary } };
    row.fill = { type: "pattern", pattern: "solid", fgColor: { argb: soft } };
    row.alignment = { vertical: "middle", wrapText: true };
    row.height = 30;
    row.eachCell((current) => {
      current.border = {
        top: { style: "thin", color: { argb: accent } },
        bottom: { style: "thin", color: { argb: accent } },
        left: { style: "thin", color: { argb: accent } },
        right: { style: "thin", color: { argb: accent } },
      };
    });
  };

  const meta = book.addWorksheet("Grunduppgifter");
  styleSheet(meta, 2);
  meta.columns = [{ width: 28 }, { width: 65 }];
  titleRow(meta, "Kontrollprotokoll", 2);
  const labels: Record<string, string> = {
    proj: "Projekt / anläggning",
    perf: "Utfört av",
    ctrl: "Kontrollerat av",
    client: "Kontaktperson",
    addr: "E-post",
    date: "Datum",
    instr: "Instrument (typ)",
    sn: "Instrument S/N",
    cal: "Kalibrering (datum)",
  };
  for (const [key, label] of Object.entries(labels))
    meta.addRow([label, template ? "" : clean(data.meta[key as keyof typeof data.meta])]);
  meta.eachRow((row, index) => {
    if (index < 3) return;
    row.getCell(1).font = { bold: true, color: { argb: primary } };
    row.getCell(1).fill = { type: "pattern", pattern: "solid", fgColor: { argb: soft } };
    row.alignment = { vertical: "top", wrapText: true };
  });

  for (const key of sectionKeys) {
    if (!data.active[key]) continue;
    const sheet = book.addWorksheet(sections[key].title);
    const fields = sections[key].fields;
    const count = fields.length + 2;
    styleSheet(sheet, count);
    titleRow(sheet, sections[key].title, count);
    styleHeader(sheet.addRow([...fields.map((field) => field.label), "Kommentar", "Godkänd"]));
    sheet.views = [{ state: "frozen", ySplit: 3 }];
    sheet.columns.forEach((column, index) => {
      column.width = index === fields.length ? 34 : index === fields.length + 1 ? 13 : 19;
    });
    const rows = data[key].rows.length
      ? data[key].rows
      : template
        ? ([{}, {}] as Measurement[])
        : ([{}] as Measurement[]);
    for (const row of rows) {
      const added = sheet.addRow([
        ...fields.map((field) => (template ? "" : (row[field.key] ?? ""))),
        template ? "" : `${row.example === true ? "EXEMPELDATA – " : ""}${row.comment || ""}`,
        template
          ? ""
          : data.meta.autoOn
            ? (evaluate(key, row) ? "Godkänd" : "Ej godkänd")
            : row.ok === true ? "Godkänd" : "",
      ]);
      added.alignment = { vertical: "top", wrapText: true };
      added.height = 30;
      added.eachCell((current) => {
        current.border = { bottom: { style: "hair", color: { argb: "FFCBD5E1" } } };
      });
    }
    sheet.autoFilter = { from: { row: 3, column: 1 }, to: { row: 3, column: count } };
  }

  const summary = book.addWorksheet("Sammanfattning");
  styleSheet(summary, 2);
  summary.columns = [{ width: 60 }, { width: 28 }];
  titleRow(summary, "Sammanfattning / avvikelser", 2);
  for (const field of visualFields)
    summary.addRow([field.label, template ? "" : data.vis.checks[field.key] ? "Kontrollerad" : "Ej kontrollerad"]);
  summary.addRow(["Kommentar", template ? "" : data.vis.comment]);
  if (!template) {
    const completion = validateForCompletion(data, { attachmentCount });
    summary.addRow(["Kompletteringsgrad", `${completion.progress.percent}%`]);
    for (const issue of completion.errors) summary.addRow(["Måste kompletteras", issue.message]);
    for (const issue of completion.warnings) summary.addRow(["Observera", issue.message]);
  }
  summary.eachRow((row, index) => {
    if (index < 3) return;
    row.alignment = { vertical: "top", wrapText: true };
    row.getCell(1).font = { bold: true, color: { argb: primary } };
  });
  return new Uint8Array(await book.xlsx.writeBuffer());
}
