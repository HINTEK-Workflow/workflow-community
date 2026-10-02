import { PDFDocument, type PDFFont, type PDFImage, type PDFPage, rgb } from "pdf-lib";
import fontkit from "@pdf-lib/fontkit";
import { type ReportBranding, hexRgb, reportBranding } from "@/lib/kfid/report-branding";

/**
 * The report kit: the drawing of the Kontroll före idrifttagning report (V1 layout), broken out so that every form
 * report is drawn the same way (2026-09-27: the control's PDF must look exactly like today and is the model for
 * all form reports). The measures are the control's own; tests/report-reference.test.ts proves the control is unchanged.
 */
export const PAGE_WIDTH = 595.28;
export const PAGE_HEIGHT = 841.89;
// A4 with 17.6 mm (50 pt) side margins (2026-09-28, docs/rapportprinciper.md): room for hole punching and printers
// that cannot print close to the edge; tables and cards follow the content width.
export const MARGIN = 50;
export const CONTENT_WIDTH = PAGE_WIDTH - MARGIN * 2;
/**
 * Answers and assessments in every report (2026-09-28, docs/rapportprinciper.md): a Ja/Nej answer is a fact and is
 * printed in ink; an assessment says whether a result is approved and is printed with its word and colour. An
 * assessment that has not been made is left empty (the long dash), never "Nej".
 */
export const REPORT_TONES = { pass: rgb(0.07, 0.42, 0.22), fail: rgb(0.62, 0.16, 0.14), warning: rgb(0.62, 0.38, 0.02), muted: rgb(0.35, 0.4, 0.45) };
export const ASSESSMENT_WORDS = { pass: "Godkänd", fail: "Ej godkänd", notApplicable: "Ej aktuell" } as const;
/** An assessment as text and colour: approved, not approved, or not made (empty). */
export function assessmentCell(approved: boolean | null): { text: string; tone?: KitColor } {
  if (approved === null) return { text: "" };
  return approved ? { text: ASSESSMENT_WORDS.pass, tone: REPORT_TONES.pass } : { text: ASSESSMENT_WORDS.fail, tone: REPORT_TONES.fail };
}
/** A checkpoint's assessment (OK, Ej OK, Ej aktuellt) with the same colours. */
export function checkpointCell(state: "OK" | "NOT_OK" | "NA" | null | undefined): { text: string; tone?: KitColor } {
  return state === "OK" ? { text: "OK", tone: REPORT_TONES.pass } : state === "NOT_OK" ? { text: "Ej OK", tone: REPORT_TONES.fail } : state === "NA" ? { text: "Ej aktuellt", tone: REPORT_TONES.muted } : { text: "" };
}
/** The page frame starts 6 pt lower than the V1 layout (2026-09-28): the heading is no longer tight against the top edge. */
const TOP = 6;
/** Nothing is drawn below this line except the footer. */
export const BOTTOM = 49;

export type KitIdentity = { company: string; branding?: Partial<ReportBranding> | null; logoBytes?: Uint8Array | null };
export type KitColor = ReturnType<typeof rgb>;
export type KitColumn = { key: string; label: string; width: number; center?: boolean };
export type KitCard = { title: string; result: string; metrics: { label: string; value: string; tone?: KitColor }[]; comment: string | null };
export type KitAttachment = { filename: string; label: string; mimeType: string; bytes?: Uint8Array };

export function clean(value: unknown) {
  if (value == null || value === "") return "—";
  if (typeof value === "boolean") return value ? "Ja" : "Nej";
  // Line breaks are kept (2026-09-30: a work order's description "Beskrivning: …\nAllvarlighet: …" ran together);
  // other control characters become spaces.
  return String(value).replace(/\r\n?/g, "\n").replace(/[\u0000-\u0009\u000b-\u001f]/g, " ").trim() || "—";
}

export function wrap(font: PDFFont, value: unknown, size: number, maxWidth: number) {
  const lines: string[] = [];
  for (const paragraph of clean(value).split(/\r?\n/)) {
    const words = paragraph.split(/\s+/).filter(Boolean);
    if (!words.length) {
      lines.push("");
      continue;
    }
    let current = "";
    for (const source of words) {
      let word = source;
      while (font.widthOfTextAtSize(word, size) > maxWidth && word.length > 1) {
        let split = 1;
        while (split < word.length && font.widthOfTextAtSize(word.slice(0, split + 1), size) <= maxWidth) split += 1;
        if (current) lines.push(current);
        lines.push(word.slice(0, split));
        current = "";
        word = word.slice(split);
      }
      const candidate = current ? `${current} ${word}` : word;
      if (current && font.widthOfTextAtSize(candidate, size) > maxWidth) {
        lines.push(current);
        current = word;
      } else current = candidate;
    }
    if (current) lines.push(current);
  }
  return lines.length ? lines : [""];
}

function pdfColor(value: string) {
  const c = hexRgb(value);
  return rgb(c.r, c.g, c.b);
}

export const isJpeg = (bytes: Uint8Array) => bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
export const isPng = (bytes: Uint8Array) => bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e;

export type TextOptions = { size?: number; maxWidth?: number; lineHeight?: number; color?: KitColor; maxLines?: number };

/** A document with the control's fonts, colours and page frame. `continuation` is the heading of every following page. */
export async function createReportKit(input: { identity: KitIdentity; fontBytes: Uint8Array; overline: string; continuation: string }) {
  const pdf = await PDFDocument.create();
  pdf.registerFontkit(fontkit);
  const font = await pdf.embedFont(input.fontBytes, { subset: true });
  const brand = reportBranding(input.identity.branding);
  const colors = {
    primary: pdfColor(brand.primary),
    accent: pdfColor(brand.accent),
    soft: pdfColor(brand.soft),
    ink: rgb(0.08, 0.11, 0.14),
    muted: rgb(0.35, 0.4, 0.45),
    border: rgb(0.72, 0.77, 0.81),
    white: rgb(1, 1, 1),
  };
  const company = input.identity.company || "HINTEK";
  let logo: PDFImage | null = null;
  const logoBytes = input.identity.logoBytes;
  if (logoBytes?.length) {
    try { logo = isPng(logoBytes) ? await pdf.embedPng(logoBytes) : await pdf.embedJpg(logoBytes); } catch { logo = null; }
  }

  const kit = {
    pdf, font, colors, company,
    page: undefined as unknown as PDFPage,
    y: 0,
    overline: input.overline,
    continuation: input.continuation,

    text(value: unknown, x: number, top: number, options: TextOptions = {}) {
      const size = options.size ?? 8;
      const lineHeight = options.lineHeight ?? size + 2;
      const lines = wrap(font, value, size, options.maxWidth ?? CONTENT_WIDTH).slice(0, options.maxLines);
      lines.forEach((line, index) => kit.page.drawText(line, { x, y: top - size - index * lineHeight, size, font, color: options.color ?? colors.ink }));
      return lines.length * lineHeight;
    },

    /** A new page; a continued page gets the overline, "… · fortsättning", the company and the accent line. */
    addPage(continued = true) {
      kit.page = pdf.addPage([PAGE_WIDTH, PAGE_HEIGHT]);
      if (!continued) return;
      kit.text(kit.overline, MARGIN, 809 - TOP, { size: 6.8, color: colors.muted });
      kit.text(kit.continuation, MARGIN, 795 - TOP, { size: 13, color: colors.primary });
      kit.page.drawText(company, { x: Math.max(MARGIN, PAGE_WIDTH - MARGIN - font.widthOfTextAtSize(company, 8.5)), y: 783 - TOP, size: 8.5, font, color: colors.ink });
      kit.page.drawLine({ start: { x: MARGIN, y: 772 - TOP }, end: { x: PAGE_WIDTH - MARGIN, y: 772 - TOP }, thickness: 2, color: colors.accent });
      kit.y = 756 - TOP;
    },

    ensure(height: number) {
      if (kit.y - height < BOTTOM) kit.addPage();
    },

    /** The first page's heading: overline, title, code and the company name or logo, then the accent line. */
    firstPage(title: string, code: string, overlineColor: KitColor = colors.muted) {
      kit.addPage(false);
      kit.text(kit.overline, MARGIN, 806 - TOP, { size: 6.8, color: overlineColor });
      kit.text(title, MARGIN, 790 - TOP, { size: 17, color: colors.primary });
      kit.text(code, MARGIN, 769 - TOP, { size: 7, color: colors.muted });
      if (logo) {
        const dimensions = logo.scaleToFit(112, 44);
        kit.page.drawImage(logo, { x: PAGE_WIDTH - MARGIN - dimensions.width, y: 775 - TOP, width: dimensions.width, height: dimensions.height });
      } else {
        wrap(font, company, 11, 155).slice(0, 2).forEach((line, index) =>
          kit.page.drawText(line, { x: PAGE_WIDTH - MARGIN - font.widthOfTextAtSize(line, 11), y: 798 - TOP - index * 13, size: 11, font, color: colors.primary }));
      }
      kit.page.drawLine({ start: { x: MARGIN, y: 752 - TOP }, end: { x: PAGE_WIDTH - MARGIN, y: 752 - TOP }, thickness: 2.2, color: colors.accent });
      kit.y = 740 - TOP;
    },

    /** `keep` is the room the content below needs, so a heading never stands alone at the foot of a page. */
    blockTitle(title: string, description?: string, keep = 0) {
      kit.ensure((description ? 34 : 23) + keep);
      kit.text(title, MARGIN, kit.y, { size: 11.5, color: colors.primary });
      kit.y -= 16;
      if (description) {
        kit.text(description, MARGIN, kit.y, { size: 7, color: colors.muted });
        kit.y -= 13;
      }
    },

    /** `size` overrides the text size (a wide form table prints smaller so its words are not broken). */
    cell(value: unknown, x: number, top: number, width: number, height: number, options: { header?: boolean; center?: boolean; tone?: KitColor; size?: number } = {}) {
      kit.page.drawRectangle({ x, y: top - height, width, height, borderColor: colors.border, borderWidth: 0.55, color: options.header ? colors.soft : colors.white });
      const size = options.size ?? (options.header ? 6.3 : 7.2);
      const lines = wrap(font, value, size, width - 8).slice(0, Math.max(1, Math.floor((height - 6) / (size + 1.5))));
      lines.forEach((line, index) => {
        const lineWidth = font.widthOfTextAtSize(line, size);
        kit.page.drawText(line, { x: options.center ? x + Math.max(4, (width - lineWidth) / 2) : x + 4, y: top - size - 4 - index * (size + 1.5), size, font, color: options.header ? colors.primary : options.tone ?? colors.ink });
      });
    },

    /**
     * Fact boxes like the control's Grunduppgifter: a small label and the value, in a 12-column grid where the
     * control's boxes are thirds (span 4). `soft` tints a box and `tone` colours the value (a deviation).
     */
    factBoxes(items: { label: string; value: unknown; soft?: boolean; span?: number; tone?: KitColor }[], options: { fixedLines?: number } = {}) {
      const gap = 6;
      const third = (CONTENT_WIDTH - gap * 2) / 3;
      const twelfth = (CONTENT_WIDTH + gap) / 12;
      // Whole thirds use the control's own arithmetic, so its boxes stay exactly where they were.
      const place = (column: number, span: number) => column % 4 === 0 && span % 4 === 0
        ? { x: MARGIN + (column / 4) * (third + gap), width: third * (span / 4) + gap * (span / 4 - 1) }
        : { x: MARGIN + column * twelfth, width: twelfth * span - gap };
      // Boxes are laid out row by row; every box in a row gets the row's height and its value on the same line.
      const rows: { item: (typeof items)[number]; span: number; column: number; lines: number; labelShift: number }[][] = [];
      let column = 0;
      for (const item of items) {
        const span = Math.min(12, Math.max(1, item.span ?? 4));
        const { width } = place(0, span);
        // The control keeps every box two lines high and cuts longer values; forms let a long answer grow the box.
        const lines = options.fixedLines ?? Math.max(2, Math.min(8, wrap(font, item.value, 7.5, width - 12).length));
        // A long label wraps to a second line inside the box instead of running past its border (2026-09-30).
        const labelShift = (Math.min(2, wrap(font, item.label, 5.8, width - 12).length) - 1) * 7;
        if (!rows.length || column + span > 12) { rows.push([]); column = 0; }
        rows.at(-1)!.push({ item, span, column, lines, labelShift });
        column += span;
      }
      let top = kit.y;
      let rowHeight = 0;
      for (const [index, row] of rows.entries()) {
        const shift = Math.max(...row.map((box) => box.labelShift));
        const height = Math.max(...row.map((box) => 42 + (box.lines - 2) * 9.5)) + shift;
        if (index) top -= rowHeight + gap;
        if (top - height < BOTTOM) { kit.addPage(); top = kit.y; }
        for (const box of row) {
          const { x, width } = place(box.column, box.span);
          kit.page.drawRectangle({ x, y: top - height, width, height, borderColor: colors.border, borderWidth: 0.7, color: box.item.soft ? colors.soft : colors.white });
          kit.text(box.item.label, x + 6, top - 5, { size: 5.8, maxWidth: width - 12, maxLines: 2, lineHeight: 7, color: colors.muted });
          kit.text(box.item.value, x + 6, top - 19 - shift, { size: 7.5, maxWidth: width - 12, maxLines: box.lines, color: box.item.tone });
        }
        rowHeight = height;
      }
      kit.y = top - rowHeight - 20;
    },

    /**
     * The control's measurement table: a tinted heading row, rows of at least 26 pt and the heading again after a page
     * break. `tones` colours a row's text (a deviation in a form).
     */
    table(title: string, columns: KitColumn[], rows: string[][], tones: (KitColor | undefined)[] = [], cellTones: ((KitColor | undefined)[] | undefined)[] = [], sizes?: { header: number; body: number }) {
      const bodySize = sizes?.body ?? 7.2;
      const headerSize = sizes?.header ?? 6.3;
      // The control's heading row is 27 pt; a heading that needs a third line gets room for it instead of being cut.
      const headerHeight = Math.max(27, ...columns.map((column) => wrap(font, column.label, headerSize, column.width - 8).length * (headerSize + 1.5) + 8));
      const header = () => {
        kit.ensure(headerHeight);
        let x = MARGIN;
        for (const column of columns) {
          kit.cell(column.label, x, kit.y, column.width, headerHeight, { header: true, size: sizes?.header });
          x += column.width;
        }
        kit.y -= headerHeight;
      };
      header();
      for (const [rowIndex, values] of rows.entries()) {
        const height = Math.max(26, ...values.map((value, index) => Math.min(58, wrap(font, value, bodySize, columns[index].width - 8).length * (bodySize + 1.5) + 8)));
        if (kit.y - height < BOTTOM) {
          kit.addPage();
          kit.text(title, MARGIN, kit.y, { size: 10, color: colors.primary });
          kit.y -= 17;
          header();
        }
        let x = MARGIN;
        values.forEach((value, index) => {
          kit.cell(value, x, kit.y, columns[index].width, height, { center: columns[index].center, tone: cellTones[rowIndex]?.[index] ?? tones[rowIndex], size: sizes?.body });
          x += columns[index].width;
        });
        kit.y -= height;
      }
      kit.y -= 13;
    },

    /**
     * Column widths for a form's table where no word is broken in the middle (2026-09-30: "Godkä nd", "Objektty p"):
     * a column narrower than its longest word – in the heading or a cell – gets that width from columns with room to
     * spare. A table too wide for that at the control's text size is printed smaller, in two steps; `sizes` is then
     * passed on to `table`. The control's own tables do not use this and stay exactly as they are.
     */
    fitColumns(columns: KitColumn[], rows: string[][]): { columns: KitColumn[]; sizes?: { header: number; body: number } } {
      const longest = (value: unknown, size: number) => Math.max(0, ...clean(value).split(/\s+/).map((word) => font.widthOfTextAtSize(word, size)));
      const steps = [[6.3, 7.2], [5.8, 6.6], [5.3, 6]] as const;
      for (const [index, [header, body]] of steps.entries()) {
        const need = columns.map((column, column_) => Math.min(CONTENT_WIDTH / 3, 8.5 + Math.max(longest(column.label, header), ...rows.map((row) => longest(row[column_], body)))));
        const total = need.reduce((sum, value) => sum + value, 0);
        if (total > CONTENT_WIDTH && index < steps.length - 1) continue;
        const sizes = index ? { header, body } : undefined;
        if (total > CONTENT_WIDTH) return { columns: columns.map((column, column_) => ({ ...column, width: need[column_] / total * CONTENT_WIDTH })), sizes };
        const deficit = columns.reduce((sum, column, column_) => sum + Math.max(0, need[column_] - column.width), 0);
        const slack = columns.map((column, column_) => Math.max(0, column.width - need[column_]));
        const spare = slack.reduce((sum, value) => sum + value, 0);
        return { columns: columns.map((column, column_) => ({ ...column, width: column.width < need[column_] ? need[column_] : column.width - (spare ? slack[column_] / spare * deficit : 0) })), sizes };
      }
      return { columns };
    },

    /**
     * The control's card (Jordfelsbrytarprov): a tinted title bar with the result, rows of seven measured values and a
     * comment. Forms allow two lines per value (`valueLines`); the control keeps one.
     */
    /** The height of a card, so a caller can keep a card together with the pictures under it. */
    cardHeight(card: KitCard, options: { commentLines?: number } = {}) {
      const rowsOfMetrics = Math.max(1, Math.ceil(card.metrics.length / 7));
      // Two comment lines like the control; a form's longer observation may use more.
      const commentLines = Math.max(2, options.commentLines ?? 2);
      return { rowsOfMetrics, commentLines, height: 24 + 47 * rowsOfMetrics + (card.comment === null ? 0 : 32 + (commentLines - 2) * 8.6) };
    },

    card(card: KitCard, options: { valueLines?: number; resultTone?: KitColor; commentLines?: number } = {}) {
      const { rowsOfMetrics, commentLines, height } = kit.cardHeight(card, options);
      const hasComment = card.comment !== null;
      kit.ensure(height + 9);
      const top = kit.y;
      kit.page.drawRectangle({ x: MARGIN, y: top - height, width: CONTENT_WIDTH, height, borderColor: colors.border, borderWidth: 0.7, color: colors.white });
      kit.page.drawRectangle({ x: MARGIN, y: top - 24, width: CONTENT_WIDTH, height: 24, color: colors.soft });
      kit.text(card.title, MARGIN + 8, top - 5, { size: 8.2, maxWidth: CONTENT_WIDTH - 110, color: colors.primary });
      if (card.result) kit.text(card.result, MARGIN + CONTENT_WIDTH - 85, top - 5, { size: 7.2, maxWidth: 77, color: options.resultTone });
      const perRow = Math.min(7, Math.max(1, card.metrics.length));
      const width = CONTENT_WIDTH / perRow;
      card.metrics.forEach((metric, metricIndex) => {
        const rowTop = top - 24 - Math.floor(metricIndex / 7) * 47;
        const x = MARGIN + (metricIndex % 7) * width;
        kit.page.drawLine({ start: { x, y: rowTop }, end: { x, y: rowTop - 47 }, thickness: 0.45, color: colors.border });
        kit.text(metric.label, x + 4, rowTop - 5, { size: 5.7, maxWidth: width - 8, maxLines: 2, color: colors.muted });
        kit.text(metric.value, x + 4, rowTop - 28, { size: 7, maxWidth: width - 8, maxLines: options.valueLines ?? 1, color: metric.tone });
      });
      for (let row = 1; row <= rowsOfMetrics; row++) {
        if (row === rowsOfMetrics && !hasComment) break;
        const lineY = top - 24 - row * 47;
        kit.page.drawLine({ start: { x: MARGIN, y: lineY }, end: { x: MARGIN + CONTENT_WIDTH, y: lineY }, thickness: 0.45, color: colors.border });
      }
      if (card.comment !== null) {
        // Each paragraph on its own lines (a form may have several texts per object); the control has one.
        let lineTop = top - 24 - rowsOfMetrics * 47 - 7;
        let left = commentLines;
        for (const paragraph of card.comment.split("\n")) {
          if (left <= 0) break;
          const used = kit.text(paragraph, MARGIN + 8, lineTop, { size: 6.8, maxWidth: CONTENT_WIDTH - 16, maxLines: left });
          lineTop -= used;
          left -= Math.round(used / 8.8);
        }
      }
      kit.y -= height + 13;
    },

    /** A heading inside a section: 10 pt in the primary colour, kept together with the `keep` points that follow. */
    subTitle(title: string, size = 10, keep = 20) {
      kit.ensure(size + 7 + keep);
      kit.text(title, MARGIN, kit.y, { size, color: colors.primary, maxLines: 2 });
      kit.y -= size + 7;
    },

    /** Running text such as instructions, line by line so a long text continues on the next page. */
    paragraph(value: string, options: { size?: number; color?: KitColor } = {}) {
      const size = options.size ?? 7.2;
      for (const line of wrap(font, value, size, CONTENT_WIDTH)) {
        kit.ensure(size + 4);
        kit.text(line, MARGIN, kit.y, { size, color: options.color ?? colors.muted, maxLines: 1 });
        kit.y -= size + 2.8;
      }
      kit.y -= 6;
    },

    /** Pictures two by two with their file names, kept with the object they belong to. */
    async imageRow(images: { bytes: Uint8Array; caption: string }[]) {
      const cellWidth = (CONTENT_WIDTH - 12) / 2;
      for (let index = 0; index < images.length; index += 2) {
        const pair = await Promise.all(images.slice(index, index + 2).map(async (item) => {
          try {
            if (!isPng(item.bytes) && !isJpeg(item.bytes)) return { item, image: null, size: null };
            const image = isPng(item.bytes) ? await pdf.embedPng(item.bytes) : await pdf.embedJpg(item.bytes);
            return { item, image, size: image.scaleToFit(cellWidth, 180) };
          } catch { return { item, image: null, size: null }; }
        }));
        const height = Math.max(...pair.map((entry) => entry.size?.height ?? 10)) + 14;
        kit.ensure(height + 4);
        pair.forEach((entry, column) => {
          const x = MARGIN + column * (cellWidth + 12);
          if (entry.image && entry.size) kit.page.drawImage(entry.image, { x, y: kit.y - entry.size.height, width: entry.size.width, height: entry.size.height });
          kit.text(entry.image ? entry.item.caption : `${entry.item.caption} – bilden kunde inte bäddas in`, x, kit.y - height + 10, { size: 6.5, maxWidth: cellWidth, maxLines: 1, color: colors.muted });
        });
        kit.y -= height + 6;
      }
    },

    /**
     * A reference grid of the products of two scales (the risk assessment's 5 × 5), each cell coloured by its level,
     * with the levels as a legend below.
     */
    matrix(input: { size: number; xLabel: string; yLabel: string; fill: (value: number) => KitColor; legend: { label: string; color: KitColor }[] }) {
      const cellSize = input.size > 6 ? 18 : 24;
      const height = 26 + input.size * cellSize + 30;
      kit.ensure(height);
      kit.text(`${input.yLabel} lodrätt · ${input.xLabel.toLowerCase()} vågrätt`, MARGIN, kit.y, { size: 6.8, color: colors.muted });
      const left = MARGIN + 18;
      const top = kit.y - 24;
      for (let x = 1; x <= input.size; x++) kit.text(String(x), left + (x - 1) * cellSize + cellSize / 2 - 3, top + 11, { size: 6.8, color: colors.muted });
      for (let y = input.size; y >= 1; y--) {
        const rowTop = top - (input.size - y) * cellSize;
        kit.text(String(y), MARGIN + 4, rowTop - cellSize / 2 + 5, { size: 6.8, color: colors.muted });
        for (let x = 1; x <= input.size; x++) {
          const value = x * y;
          const cellX = left + (x - 1) * cellSize;
          kit.page.drawRectangle({ x: cellX, y: rowTop - cellSize, width: cellSize - 2, height: cellSize - 2, color: input.fill(value), borderColor: colors.border, borderWidth: 0.45 });
          const label = String(value);
          kit.page.drawText(label, { x: cellX + (cellSize - 2 - font.widthOfTextAtSize(label, 6.8)) / 2, y: rowTop - cellSize / 2 - 2.5, size: 6.8, font, color: colors.ink });
        }
      }
      let legendX = MARGIN;
      const legendY = top - input.size * cellSize - 10;
      for (const item of input.legend) {
        kit.page.drawRectangle({ x: legendX, y: legendY - 8, width: 8, height: 8, color: item.color, borderColor: colors.border, borderWidth: 0.45 });
        kit.text(item.label, legendX + 12, legendY + 1, { size: 6.8, color: colors.muted, maxLines: 1, maxWidth: 110 });
        legendX += 12 + font.widthOfTextAtSize(item.label, 6.8) + 18;
      }
      kit.y = legendY - 22;
    },

    /** Check boxes two by two in a tinted box (Visuell kontroll). */
    checkBoxes(items: { label: string; checked: boolean }[]) {
      const rows = Math.max(1, Math.ceil(items.length / 2));
      const height = 16 + rows * 25;
      kit.ensure(height + 13);
      const top = kit.y;
      kit.page.drawRectangle({ x: MARGIN, y: top - height, width: CONTENT_WIDTH, height, borderColor: colors.border, borderWidth: 0.7, color: colors.soft });
      items.forEach((item, index) => {
        const x = MARGIN + 9 + (index % 2) * (CONTENT_WIDTH / 2);
        const topLine = top - 10 - Math.floor(index / 2) * 25;
        kit.page.drawRectangle({ x, y: topLine - 10, width: 10, height: 10, borderColor: colors.border, borderWidth: 0.8, color: colors.white });
        if (item.checked) kit.page.drawText("X", { x: x + 2, y: topLine - 8.5, size: 7, font, color: colors.primary });
        kit.text(item.label, x + 16, topLine + 1, { size: 7, maxWidth: CONTENT_WIDTH / 2 - 28, maxLines: 2 });
      });
      kit.y -= height + 13;
    },

    /**
     * A bordered box with lines of text, at least 62 pt high (Sammanfattning / avvikelser). A short text keeps the
     * control's box exactly; a longer one grows the box and continues in a new box on the next page instead of running
     * out under the border (2026-09-30: Skyddsrond's summary overflowed).
     */
    textBox(lines: string[]) {
      const measured = lines.reduce((sum, line) => sum + wrap(font, line, 7.4, CONTENT_WIDTH - 16).length * 9.4 + 2, 18);
      if (measured <= 145) {
        const height = Math.max(62, measured);
        kit.ensure(height + 10);
        kit.page.drawRectangle({ x: MARGIN, y: kit.y - height, width: CONTENT_WIDTH, height, borderColor: colors.border, borderWidth: 0.7, color: colors.white });
        let lineY = kit.y - 7;
        for (const line of lines) lineY -= kit.text(line, MARGIN + 8, lineY, { size: 7.4, maxWidth: CONTENT_WIDTH - 16 }) + 2;
        kit.y -= height + 14;
        return;
      }
      // Every wrapped line on its own, in boxes that fill the rest of each page.
      const rows = lines.flatMap((line) => wrap(font, line, 7.4, CONTENT_WIDTH - 16).map((text, index, all) => ({ text, gap: index === all.length - 1 ? 2 : 0 })));
      let next = 0;
      while (next < rows.length) {
        kit.ensure(62);
        const room = kit.y - BOTTOM - 10;
        let height = 18;
        let end = next;
        while (end < rows.length && height + 9.4 + rows[end].gap <= room) { height += 9.4 + rows[end].gap; end++; }
        if (end === next) { kit.addPage(); continue; }
        kit.page.drawRectangle({ x: MARGIN, y: kit.y - height, width: CONTENT_WIDTH, height, borderColor: colors.border, borderWidth: 0.7, color: colors.white });
        let lineY = kit.y - 7;
        for (const row of rows.slice(next, end)) { kit.text(row.text, MARGIN + 8, lineY, { size: 7.4, maxWidth: CONTENT_WIDTH - 16, maxLines: 1 }); lineY -= 9.4 + row.gap; }
        kit.y -= height + 14;
        next = end;
      }
    },

    /** "Bilagor": the numbered list of attached files. */
    attachmentList(files: KitAttachment[], description?: string) {
      if (!files.length) return;
      kit.blockTitle("Bilagor", description ?? (files.length === 1 ? "1 bifogad fil följer efter protokollet." : `${files.length} bifogade filer följer efter protokollet.`));
      for (const [index, file] of files.entries()) {
        kit.ensure(15);
        kit.text(`${index + 1}. ${file.filename} · ${file.label}`, MARGIN, kit.y, { size: 7.2 });
        kit.y -= 14;
      }
    },

    /** A chapter such as "Stöd vid bedömning": on a new page unless most of the page is free, with a large heading. */
    chapter(title: string, description: string) {
      if (kit.y < 535) {
        kit.addPage(false);
        kit.y = 806 - TOP;
      } else kit.y -= 8;
      const top = kit.y;
      kit.text(kit.overline, MARGIN, top, { size: 6.8, color: colors.muted });
      kit.text(title, MARGIN, top - 19, { size: 17, color: colors.primary });
      kit.text(description, MARGIN, top - 48, { size: 7.2, lineHeight: 10, color: colors.muted });
      kit.page.drawLine({ start: { x: MARGIN, y: top - 69 }, end: { x: PAGE_WIDTH - MARGIN, y: top - 69 }, thickness: 2.2, color: colors.accent });
      kit.y = top - 88;
    },

    /** An information card with an accent bar: a title and lines of text. */
    infoCard(title: string, lines: string[]) {
      const lineCount = lines.reduce((count, line) => count + wrap(font, line, 7.2, CONTENT_WIDTH - 24).length, 0);
      const height = 35 + lineCount * 10;
      kit.ensure(height + 11);
      kit.page.drawRectangle({ x: MARGIN, y: kit.y - height, width: CONTENT_WIDTH, height, borderColor: colors.border, borderWidth: 0.7, color: colors.white });
      kit.page.drawRectangle({ x: MARGIN, y: kit.y - 24, width: 5, height: 24, color: colors.accent });
      kit.text(title, MARGIN + 13, kit.y - 5, { size: 10, color: colors.primary });
      let lineY = kit.y - 29;
      for (const line of lines) lineY -= kit.text(line, MARGIN + 13, lineY, { size: 7.2, lineHeight: 10, maxWidth: CONTENT_WIDTH - 25 });
      kit.y -= height + 11;
    },

    /** Every attached picture on its own page after the protocol; damaged pictures stay in the list only. */
    async attachmentPages(files: (KitAttachment & { number: number })[]) {
      for (const file of files) {
        if (!file.bytes?.length || (!isJpeg(file.bytes) && !isPng(file.bytes))) continue;
        try {
          const image = isPng(file.bytes) ? await pdf.embedPng(file.bytes) : await pdf.embedJpg(file.bytes);
          kit.addPage(false);
          kit.text(`BILAGA ${file.number}`, MARGIN, 806 - TOP, { size: 6.8, color: colors.muted });
          kit.text(file.filename, MARGIN, 786 - TOP, { size: 13, color: colors.primary });
          kit.text(file.label, MARGIN, 766 - TOP, { size: 7, color: colors.muted });
          kit.page.drawLine({ start: { x: MARGIN, y: 749 - TOP }, end: { x: PAGE_WIDTH - MARGIN, y: 749 - TOP }, thickness: 2, color: colors.accent });
          const dimensions = image.scaleToFit(CONTENT_WIDTH, 664);
          kit.page.drawImage(image, { x: MARGIN + (CONTENT_WIDTH - dimensions.width) / 2, y: 65 + (664 - dimensions.height) / 2, width: dimensions.width, height: dimensions.height });
        } catch {
          // Damaged images remain visible in the attachment list.
        }
      }
    },

    /** The footer on every page: the code and date to the left, the company and page number to the right. */
    footer(left: string) {
      const pages = pdf.getPages();
      pages.forEach((current, index) => {
        current.drawLine({ start: { x: MARGIN, y: 42 }, end: { x: PAGE_WIDTH - MARGIN, y: 42 }, thickness: 0.45, color: colors.border });
        current.drawText(left, { x: MARGIN, y: 27, size: 6.5, font, color: colors.muted });
        const text = `${company} · ${index + 1} / ${pages.length}`;
        current.drawText(text, { x: PAGE_WIDTH - MARGIN - font.widthOfTextAtSize(text, 6.5), y: 27, size: 6.5, font, color: colors.muted });
      });
    },
  };
  return kit;
}

export type ReportKit = Awaited<ReturnType<typeof createReportKit>>;
