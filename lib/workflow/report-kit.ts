import { PDFDocument, type PDFFont, type PDFImage, type PDFPage, rgb, setCharacterSpacing } from "pdf-lib";
import fontkit from "@pdf-lib/fontkit";
import { formatSwedish } from "@/lib/swedish-time";
import { type ReportBranding, hexRgb, reportBranding } from "@/lib/kfid/report-branding";
import { reportFontSet, type ReportFontBytes } from "./report-fonts";
import { pdfTexts } from "@/lib/pdf-templates/catalog";
import { traceMarkIn, traceOf, untraced, type PdfTemplateOverride, type PdfTexts, type PdfTrace } from "@/lib/pdf-templates/model";

/**
 * The report kit: every PDF in Workflow is drawn with these primitives, and they follow one design – Förslag B "Lugnt
 * blad" (2026-11-03; the measurement sheet is docs/rapportprinciper.md): body text 10 pt with line height 1,45,
 * labels 8,5 pt, plain bold section headings with air above, a label-above-value facts grid without boxes, tables with a
 * tinted heading row and a bold total row, at most one framed box per page (the summary or the decision), words instead
 * of pills, a short signature block and a quiet two-line footer. Blue only in headings, the table head and the final
 * total; 20 mm margins. From Förslag A: the payment box on the economy documents and the status marks per row in long
 * control tables. Every measure is the CSS of the approved templates converted exactly (1 mm = 72/25,4 pt).
 */
export const mm = (value: number) => (value * 72) / 25.4;
export const PAGE_WIDTH = 595.28;
export const PAGE_HEIGHT = 841.89;
/** 20 mm side margins; the content width is 170 mm. */
export const MARGIN = mm(20);
export const CONTENT_WIDTH = PAGE_WIDTH - MARGIN * 2;
/** The first line box starts 16 mm from the top edge. */
export const TOP = PAGE_HEIGHT - mm(16);
/** Nothing but the footer is drawn below 25 mm from the bottom edge. */
export const BOTTOM = mm(25);
/** Hairlines are 0,75 pt everywhere. */
export const RULE = 0.75;
/** Running text is at most 150 mm wide (≈ 80 characters per line). */
export const TEXT_WIDTH = mm(150);

export const TYPE = { body: 10, table: 9.5, dense: 9, label: 8.5, small: 9, h1: 20, h2: 11.5, h3: 10.5, total: 13, foot: 8 } as const;
/** Line heights as factors of the size: the templates' 1,45 for text, 1,35 in tables and values, 1,3 on labels, 1,25 on headings. */
export const LEADING = { body: 1.45, table: 1.35, label: 1.3, head: 1.25, party: 1.4, foot: 1.4 } as const;

const hex = (value: string) => { const c = hexRgb(value); return rgb(c.r, c.g, c.b); };
export const INK = hex("#18181B");
export const MUTED = hex("#46566B");
export const LINE_COLOR = hex("#B9C3CF");
export const LINE_SOFT = hex("#DCE2EA");
export const WHITE = rgb(1, 1, 1);
/**
 * Answers and assessments in every report (docs/rapportprinciper.md): a Ja/Nej answer is a fact and is printed in ink; an
 * assessment says whether a result is approved and is printed with its word and colour. An assessment that has not been
 * made is left empty (the long dash), never "Nej". The colours are the templates' (ok, dev, warn, na, critical).
 */
export const REPORT_TONES = { pass: hex("#126B38"), fail: hex("#9E2924"), warning: hex("#7A4B00"), muted: hex("#5B6B7F"), critical: hex("#4A1210") };
/** The light tints behind a word: a deviation row, an approved mark, a warning mark. */
export const REPORT_FILLS = { pass: hex("#E6F4EA"), fail: hex("#FBECEC"), warning: hex("#FFF4DC") };
/** Risk levels, always green → yellow → red → dark red, low to high, with distinct lightness (works in greyscale). */
export const RISK_COLORS = [hex("#D7EEDC"), hex("#F4CF4F"), hex("#C0392B"), hex("#6E1811")] as const;
/** The text colour on each risk level: ink on the light levels, white on the dark. */
export const RISK_TEXT = [INK, INK, WHITE, WHITE] as const;
/** The word colour of a risk level beside its square. */
export const RISK_WORD = [REPORT_TONES.pass, REPORT_TONES.warning, REPORT_TONES.fail, hex("#6E1811")] as const;
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
/** The status mark (from Förslag A) an assessment word gets in a long control table; none while nothing is judged. */
export function badgeOf(tone: KitColor | undefined, text: string): KitBadge | undefined {
  if (!text) return undefined;
  if (tone === REPORT_TONES.pass) return "pass";
  if (tone === REPORT_TONES.fail) return "fail";
  if (tone === REPORT_TONES.warning) return "warning";
  if (tone === REPORT_TONES.muted) return "na";
  return undefined;
}
/** The tallest table cell (about 13 lines): longer texts end in an ellipsis rather than growing a row over a page. */
const CELL_MAX_LINES = 13;
/** What a following page holds under its small head: the most a block kept together can be (a taller one flows). */
export const CONTINUED_ROOM = TOP - (14 * LEADING.head + mm(0.5) + 11.5 * LEADING.body) - mm(3) - mm(4) - BOTTOM;

/** Avsändaren (2026-11-01, beslut 5): the company's details on a customer document – the address line in the head, the legal line in the footer. */
export type KitSender = { organizationNumber?: string; vatNumber?: string; fSkatt?: boolean; address?: string; phone?: string; email?: string;
  /** Säte (footer's legal line) and bankgiro / plusgiro (the payment box) – 2026-11-04; empty prints nothing. */
  registeredOffice?: string; bankgiro?: string; plusgiro?: string };
export type KitIdentity = { company: string; branding?: Partial<ReportBranding> | null; logoBytes?: Uint8Array | null; sender?: KitSender | null;
  /** PDF-mallar (2026-11-03): the product owner's changes to the documents' texts; none = the defaults (lib/pdf-templates). */
  templates?: readonly PdfTemplateOverride[] | null };
/** The head of the first page: the family ("Ekonomi"), the title, the document's number and up to two dates. */
export type KitHead = { kind: string; title: string; number?: string; dates?: readonly (readonly [string, string])[]; /** The number line of every following page; the number when left out. */ continuation?: string };

/** The sender's lines as the older sender box printed them; kept for the tests that read them. */
export function senderLines(company: string, sender: KitSender | null | undefined): string[] {
  if (!sender) return [];
  const first = [sender.organizationNumber?.trim() ? `Org.nr ${sender.organizationNumber.trim()}` : "", sender.vatNumber?.trim() ? `Momsreg.nr ${sender.vatNumber.trim()}` : "", sender.fSkatt ? "Godkänd för F-skatt" : ""].filter(Boolean);
  const second = [sender.address?.trim() ?? "", sender.phone?.trim() ? `Tel ${sender.phone.trim()}` : "", sender.email?.trim() ?? ""].filter(Boolean);
  if (!first.length && !second.length) return [];
  return [[company, ...first].filter(Boolean).join(" · "), ...(second.length ? [second.join(" · ")] : [])];
}
/** The footer's legal pieces: org.nr, säte, momsreg.nr and F-skatt, each only when filled in; the address never repeats there. */
export function senderLegal(sender: KitSender | null | undefined, common: PdfTexts = pdfTexts("common")): string[] {
  if (!sender) return [];
  return [sender.organizationNumber?.trim() ? common.text("legal.org", { nr: sender.organizationNumber.trim() }) : "", sender.registeredOffice?.trim() ? common.text("legal.seat", { nr: sender.registeredOffice.trim() }) : "", sender.vatNumber?.trim() ? common.text("legal.vat", { nr: sender.vatNumber.trim() }) : "", sender.fSkatt ? common.text("legal.f-tax") : ""].filter(Boolean);
}
/** Where to pay (the payment box's second row): the bankgiro and the plusgiro that are filled in, with the document's own labels; none when neither is. */
export function senderPayTo(sender: KitSender | null | undefined, labels: { bankgiro: string; plusgiro: string }): { label: string; value: string }[] {
  if (!sender) return [];
  return [
    ...(sender.bankgiro?.trim() ? [{ label: labels.bankgiro, value: sender.bankgiro.trim() }] : []),
    ...(sender.plusgiro?.trim() ? [{ label: labels.plusgiro, value: sender.plusgiro.trim() }] : []),
  ];
}
/** The address line under the logo: address · phone · e-mail. */
export function senderAddressLine(sender: KitSender | null | undefined): string {
  if (!sender) return "";
  return [sender.address?.trim() ?? "", sender.phone?.trim() ?? "", sender.email?.trim() ?? ""].filter(Boolean).join(" · ");
}

export type KitColor = ReturnType<typeof rgb>;
export type KitAlign = "left" | "right" | "center";
export type KitColumn = { key: string; label: string; width: number; align?: KitAlign; /** Older name for align: "center". */ center?: boolean };
export type KitBadge = "pass" | "fail" | "warning" | "critical" | "na";
export type KitMark = { level: number; text: string };
export type KitCell = string | { text?: string; tone?: KitColor; bold?: boolean; muted?: boolean; /** A status mark (Förslag A) instead of the bare word. */ badge?: KitBadge; /** A risk level: colour square and word. */ mark?: KitMark; /** A box to tick by hand. */ box?: "off" | "on" | "na"; align?: KitAlign; /** The cell spans this many columns (a transport row). */ span?: number };
export type KitRow = KitCell[] | { cells: KitCell[]; /** A deviation row: light red behind the whole row. */ dev?: boolean; bold?: boolean; muted?: boolean };
export type KitFact = { label: string; value?: unknown; /** Width in twelfths of the row (a third = 4, a half = 6, the whole row = 12); the grid's column when left out. */ span?: number; tone?: KitColor; /** Regular weight instead of bold. */ plain?: boolean; /** A party: the name larger, then its lines. */ party?: { name: string; lines: string[] }; /** A line to write on by hand. */ blank?: boolean; choices?: { text: string; checked: boolean }[]; mark?: KitMark; /** A status mark instead of the word. */ badge?: KitBadge };
export type KitSignature = { label: string; name?: string; note?: string; caps?: readonly [string, string] };
export type KitAttachment = { filename: string; label: string; mimeType: string; bytes?: Uint8Array };
export type KitSumRow = { label: string; value: string; bold?: boolean };
export type KitSumTotal = { label: string; value: string; small?: string; /** Rows under the total that are not part of its sum (an ÄTA's change). */ after?: readonly KitSumRow[] };
/** An object's values as a block (the older card): a heading with the result, a dense facts grid and the comment. */
export type KitObject = { title: string; result: { text: string; tone?: KitColor; /** A drawn box to tick after the word (a blank form). */ box?: "off" } | null; metrics: { label: string; value: string; tone?: KitColor }[]; comment: string | null };

export function clean(value: unknown) {
  if (value == null || value === "") return "—";
  if (typeof value === "boolean") return value ? "Ja" : "Nej";
  // Line breaks are kept; other control characters become spaces.
  return String(value).replace(/\r\n?/g, "\n").replace(/[\u0000-\u0009\u000b-\u001f]/g, " ").trim() || "—";
}

/** Anything that measures text, so `wrap` serves the kit's faces and the tests' plain fonts alike. */
export type TextMeasurer = { widthOfTextAtSize(text: string, size: number): number };

/** The units a number keeps beside it at a line break, with the punctuation that may follow them. */
const UNIT_AFTER_NUMBER = /^(?:kr(?:\/[\p{L}.]+)?|SEK|öre|%|‰|°C?|[mkMG]?Ω|[mkM]?V(?:ac|dc)?|[mkM]?A|[kM]?W|[kM]?Wh|k?VA|k?Hz|ms|s|min|h|tim|st|mm|cm|km|m|mil|m²|mm²|m³|kg|g|ton|bar|[kM]?Pa|lux|lm|K|kap\.|§§?|dag|dagar|mån|år)[.,;:!?)]*$/u;
const NUMBER_WORD = /^[(+\-−–]?\d[\d.,]*$/;
const SEPARATOR = "·";
/** Two words that never part at a line break: a number and its unit ("695 kr/h", "0,27 Ω", "3 kap. 13 §") and the groups of a number ("22 287,50"). */
function staysTogether(word: string, next: string) {
  if (word === "kap." || word === "à") return /^\d/.test(next);
  if (/^rad$/i.test(word)) return /^\d+[.,:;)]*$/.test(next);
  // A regulation's name with its number ("ELSÄK-FS 2017:3"); a date with its time, in the register's legal form too.
  if (/-FS$/.test(word)) return /^\d{4}:\d+/.test(next);
  if (/^\d{4}[:-]\d{2}[:-]\d{2}$/.test(word)) return /^\d{2}:\d{2}/.test(next);
  if (!NUMBER_WORD.test(word)) return false;
  return UNIT_AFTER_NUMBER.test(next) || (/^[(+\-−–]?\d{1,3}$/.test(word) && /^\d{3}(?:[.,]\d+)?[.,;:!?)]*$/.test(next));
}

/** Words joined where they must not part; `fits` says whether a joined piece may be as long as that. */
function unbroken(words: readonly string[], fits: (piece: string) => boolean) {
  const atoms: string[] = [];
  words.forEach((word, index) => {
    const joined = index && staysTogether(untraced(words[index - 1]), untraced(word)) ? `${atoms.at(-1)} ${word}` : "";
    if (joined && fits(joined)) atoms[atoms.length - 1] = joined;
    else atoms.push(word);
  });
  return atoms;
}

/**
 * Word wrap like a browser's: words break at spaces, a word too wide for the line breaks after a hyphen or slash when it
 * can, else letter by letter. `slack` lets a single word that is only a little too wide stay whole (a table cell's word may
 * run into its padding, as CSS lets it). A number stays with its unit, and the separator "·" never starts or ends a line:
 * at a line break the break itself separates.
 */
export function wrap(font: TextMeasurer, value: unknown, size: number, maxWidth: number, slack = 0) {
  const lines: string[] = [];
  for (const paragraph of clean(value).split(/\r?\n/)) {
    const words = paragraph.split(/\s+/).filter(Boolean);
    if (!words.length) {
      lines.push("");
      continue;
    }
    const atoms = unbroken(words, (piece) => font.widthOfTextAtSize(piece, size) <= maxWidth);
    const first = lines.length;
    let current = "";
    for (const source of atoms) {
      let word = source;
      while (font.widthOfTextAtSize(word, size) > maxWidth + slack && word.length > 1) {
        let split = 1;
        while (split < word.length && font.widthOfTextAtSize(word.slice(0, split + 1), size) <= maxWidth) split += 1;
        // Break after the last hyphen or slash that fits, so "2026-0987" becomes "2026-" and "0987".
        const soft = Math.max(word.lastIndexOf("-", split - 1), word.lastIndexOf("/", split - 1), word.lastIndexOf("–", split - 1));
        if (soft > 0 && soft < word.length - 1) split = soft + 1;
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
    const tidied = lines.splice(first).map((line) => {
      const parts = line.split(" ");
      while (parts.length > 1 && untraced(parts.at(-1)!) === SEPARATOR) parts.pop();
      while (parts.length > 1 && untraced(parts[0]) === SEPARATOR) parts.shift();
      return parts.join(" ");
    }).filter((line, _, all) => untraced(line) !== SEPARATOR || all.length === 1);
    lines.push(...tidied);
  }
  return lines.length ? lines : [""];
}

/**
 * A list item's lines: the mark ("•", "1.") to the left, the text wrapped under itself (a hanging indent). Text without a
 * mark has no indent.
 */
export function wrapHanging(font: TextMeasurer, value: unknown, size: number, maxWidth: number) {
  const item = /^(•|\d{1,3}\.)\s+([\s\S]+)$/.exec(clean(value));
  if (!item) return { marker: "", indent: 0, lines: wrap(font, value, size, maxWidth) };
  const indent = font.widthOfTextAtSize(`${item[1]} `, size);
  return { marker: item[1], indent, lines: wrap(font, item[2], size, maxWidth - indent) };
}

/** Cuts `value` with an ellipsis until it fits `maxWidth` at the text size (the footer's by default). */
export function fitFooterText(font: TextMeasurer, value: string, maxWidth: number, size: number = TYPE.foot) {
  if (font.widthOfTextAtSize(value, size) <= maxWidth) return value;
  let cut = value;
  while (cut.length > 1 && font.widthOfTextAtSize(`${cut}…`, size) > maxWidth) cut = cut.slice(0, -1);
  return `${cut.trimEnd()}…`;
}

export const isJpeg = (bytes: Uint8Array) => bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
export const isPng = (bytes: Uint8Array) => bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e;

/** Column widths in points from relative weights, filling `total`. */
export function columnWidths(columns: readonly (readonly [key: string, label: string, weight: number, align?: KitAlign | boolean])[], total = CONTENT_WIDTH): KitColumn[] {
  const sum = columns.reduce((acc, item) => acc + item[2], 0);
  return columns.map(([key, label, weight, align]) => ({ key, label, width: (weight / sum) * total, align: align === true ? "center" : align === false ? undefined : align }));
}

type GlyphFont = { hasGlyphForCodePoint(codePoint: number): boolean; ascent: number; descent: number; unitsPerEm: number };

/**
 * A face: Manrope with DejaVu Sans behind it. Text is split into runs by which font has the glyph, so Ω, ≥ and ☐ print
 * whatever the typeface lacks; measuring sums the runs. The line box uses the primary font's metrics, as a browser does.
 */
/** The most widths kept before starting over. */
const WIDTHS_LIMIT = 50_000;

class Face implements TextMeasurer {
  readonly ascent: number;
  readonly content: number;
  /** `plain`: the editor's trace is on, so its marks in a text neither print nor take room. */
  constructor(readonly font: PDFFont, private readonly glyphs: GlyphFont, private readonly fallback: { font: PDFFont; glyphs: GlyphFont } | null, private readonly plain = false, private readonly widths: Map<string, number> = new Map()) {
    this.ascent = glyphs.ascent / glyphs.unitsPerEm;
    this.content = (glyphs.ascent + Math.abs(glyphs.descent)) / glyphs.unitsPerEm;
  }
  runs(text: string): { text: string; font: PDFFont }[] {
    const out: { text: string; font: PDFFont }[] = [];
    for (const char of text) {
      const code = char.codePointAt(0)!;
      if (this.plain && code >= 0xe000 && code <= 0xf8ff) continue;
      let font = this.font;
      let piece = char;
      if (!this.glyphs.hasGlyphForCodePoint(code)) {
        if (this.fallback?.glyphs.hasGlyphForCodePoint(code)) font = this.fallback.font;
        else piece = this.glyphs.hasGlyphForCodePoint(0xfffd) ? "�" : "?";
      }
      const last = out.at(-1);
      if (last && last.font === font) last.text += piece;
      else out.push({ text: piece, font });
    }
    return out.length ? out : [{ text: "", font: this.font }];
  }
  // The font's layout is by far the slowest step of a document (2026-11-05: 90 % of the time), and wrapping asks for the same
  // lines again and again. A width depends only on the font, the text and the size, so the answer can be kept.
  widthOfTextAtSize(text: string, size: number) {
    const key = `${size}|${this.plain ? untraced(text) : text}`;
    const known = this.widths.get(key);
    if (known !== undefined) return known;
    const width = this.runs(text).reduce((sum, run) => sum + run.font.widthOfTextAtSize(run.text, size), 0);
    if (this.widths.size >= WIDTHS_LIMIT) this.widths.clear();
    this.widths.set(key, width);
    return width;
  }
  /** The baseline's distance from the top of a line box of `size × leading`, as CSS places it. */
  baseline(size: number, leading: number) {
    return (size * leading - size * this.content) / 2 + size * this.ascent;
  }
}

const colorHex = (color: KitColor) => `#${[color.red, color.green, color.blue].map((part) => Math.round(part * 255).toString(16).padStart(2, "0")).join("")}`;

/**
 * Where the words of a template block landed on this line (the editor's click targets): the line's words are measured with the
 * same face and size they are drawn with, and neighbouring words of one block become one rectangle.
 */
function traceLine(trace: PdfTrace, face: Face, line: string, x: number, baseline: number, size: number, look: { page: number; bold: boolean; color: KitColor; align: KitAlign; spacing?: number; footer?: boolean }) {
  const spacing = look.spacing ?? 0;
  const widthOf = (text: string) => face.widthOfTextAtSize(text, size) + untraced(text).length * spacing;
  const space = widthOf(" ");
  const height = size * face.content;
  const bottom = baseline + size * face.ascent - height;
  let cursor = x;
  let open: { code: number; x: number; end: number } | null = null;
  const close = () => {
    const block = open && trace.block(open.code);
    if (open && block) trace.targets.push({ doc: block.doc, id: block.id, page: look.page, x: open.x, y: bottom, width: open.end - open.x, height, size, bold: look.bold, color: colorHex(look.color), align: look.align, ...(look.footer ? { footer: true } : {}) });
    open = null;
  };
  for (const word of line.split(" ")) {
    const width = widthOf(word);
    const code = traceMarkIn(word);
    if (code !== null && open !== null && (open as { code: number }).code === code) (open as { end: number }).end = cursor + width;
    else {
      close();
      if (code !== null) open = { code, x: cursor, end: cursor + width };
    }
    cursor += width + space;
  }
  close();
}

const parsedFonts = new WeakMap<Uint8Array, GlyphFont>();
/**
 * The editor's examples (only they run with a trace, `plain`) hold invented data, so their widths are kept per font across
 * drawings: typing one word measures that word only. A real document's widths live and die with the document, so a company's
 * texts never stay in the server's memory.
 */
const exampleWidths = new WeakMap<Uint8Array, Map<string, number>>();
const exampleWidthsOf = (font: Uint8Array) => {
  let widths = exampleWidths.get(font);
  if (!widths) { widths = new Map(); exampleWidths.set(font, widths); }
  return widths;
};

async function faces(pdf: PDFDocument, bytes: ReportFontBytes, plain = false) {
  const fonts = reportFontSet(bytes);
  const glyphs = (data: Uint8Array) => {
    let parsed = parsedFonts.get(data);
    if (!parsed) { parsed = fontkit.create(data) as unknown as GlyphFont; parsedFonts.set(data, parsed); }
    return parsed;
  };
  const fallbackBytes = fonts.fallback && fonts.fallback !== fonts.regular ? fonts.fallback : null;
  const fallback = fallbackBytes ? { font: await pdf.embedFont(fallbackBytes, { subset: true }), glyphs: glyphs(fallbackBytes) } : null;
  const regularFont = await pdf.embedFont(fonts.regular, { subset: true });
  const regular = new Face(regularFont, glyphs(fonts.regular), fallback, plain, plain ? exampleWidthsOf(fonts.regular) : undefined);
  const bold = fonts.bold === fonts.regular ? regular : new Face(await pdf.embedFont(fonts.bold, { subset: true }), glyphs(fonts.bold), fallback, plain, plain ? exampleWidthsOf(fonts.bold) : undefined);
  return { regular, bold };
}

export type TextOptions = { size?: number; maxWidth?: number; /** A word this much wider than `maxWidth` stays whole (table cells). */ slack?: number; /** Line height as a factor of the size (1,45 for text). */ leading?: number; color?: KitColor; bold?: boolean; align?: KitAlign; maxLines?: number; /** End the last line with … when `maxLines` cut the text. */ ellipsis?: boolean; /** Start at this wrapped line (the continuation of a value on the next page). */ fromLine?: number };

const badgeStyle = (kind: KitBadge): { text: KitColor; fill: KitColor; border: KitColor } => kind === "pass" ? { text: REPORT_TONES.pass, fill: REPORT_FILLS.pass, border: REPORT_TONES.pass }
  : kind === "warning" ? { text: REPORT_TONES.warning, fill: REPORT_FILLS.warning, border: REPORT_TONES.warning }
    : kind === "fail" ? { text: WHITE, fill: REPORT_TONES.fail, border: REPORT_TONES.fail }
      : kind === "critical" ? { text: WHITE, fill: REPORT_TONES.critical, border: REPORT_TONES.critical }
        : { text: REPORT_TONES.muted, fill: WHITE, border: REPORT_TONES.muted };
const BADGE_SIZE = TYPE.label;
const BADGE_PAD_Y = mm(1.1);
const BADGE_PAD_X = mm(2);
const BADGE_HEIGHT = BADGE_SIZE + BADGE_PAD_Y * 2;
const MARK_SQUARE = mm(3.4);
const BOX = mm(4.4);
const BOX_LARGE = mm(5.5);
/** The flow's starting point while a block is measured: so high that nothing breaks. */
const MEASURE_Y = 1e7;
/** Stands in for the page while a block is measured: every drawing call does nothing. */
const NULL_PAGE = new Proxy({}, { get: () => () => undefined }) as unknown as PDFPage;

/** A document in the design: the faces, the colours and the page frame. */
export async function createReportKit(input: { identity: KitIdentity; fontBytes: ReportFontBytes; head: KitHead; createdAt?: Date }) {
  const pdf = await PDFDocument.create();
  // Swedish document language for screen readers (PDF review 2026-11-03, finding 17); a tagged PDF is not possible with pdf-lib.
  pdf.setLanguage("sv-SE");
  pdf.registerFontkit(fontkit);
  // Only the editor's preview has a trace (lib/pdf-templates/model.ts): its marks never reach the file, not the metadata either.
  const trace = traceOf(input.identity.templates);
  if (trace) {
    const setTitle = pdf.setTitle.bind(pdf);
    const setSubject = pdf.setSubject.bind(pdf);
    pdf.setTitle = (title, options) => setTitle(untraced(title), options);
    pdf.setSubject = (subject) => setSubject(untraced(subject));
  }
  const common = pdfTexts("common", input.identity.templates);
  const { regular, bold } = await faces(pdf, input.fontBytes, Boolean(trace));
  const brand = reportBranding(input.identity.branding);
  const colors = {
    /** Headings, the title, the table head and the total: the company's primary colour (Workflow navy by default). */
    navy: hex(brand.primary),
    /** The payment box's key figures (Workflow's clear blue by default). */
    accent: hex(brand.accent),
    /** The tinted table head and the payment box. */
    soft: hex(brand.soft),
    ink: INK, muted: MUTED, line: LINE_COLOR, lineSoft: LINE_SOFT, white: WHITE,
    // Older names kept for the documents: primary is the heading colour, border the hairline.
    primary: hex(brand.primary), border: LINE_COLOR,
  };
  const company = input.identity.company || "Workflow";
  const createdAt = input.createdAt ?? new Date();
  let logo: PDFImage | null = null;
  const logoBytes = input.identity.logoBytes;
  if (logoBytes?.length) {
    try { logo = isPng(logoBytes) ? await pdf.embedPng(logoBytes) : await pdf.embedJpg(logoBytes); } catch { logo = null; }
  }
  const addressLine = senderAddressLine(input.identity.sender);
  const legal = senderLegal(input.identity.sender, common);
  const embedded = new Map<Uint8Array, PDFImage>();
  /** The letter spacing of the capitals being drawn, which the click targets count. */
  let letterSpacing = 0;

  type Last = "page" | "facts" | "band" | "section" | "other";
  const kit = {
    pdf, colors, company, createdAt,
    /** The texts every document shares (the template "common"); a document's generator reads them here too. */
    common, templates: input.identity.templates ?? null,
    /** The regular face (measures like a PDFFont) and the bold one. */
    font: regular as TextMeasurer, bold: bold as TextMeasurer,
    page: undefined as unknown as PDFPage,
    y: 0,
    head: input.head,
    /** The flow's left edge and width: the whole content width, or a column inside `columns`. */
    frame: { x: MARGIN, width: CONTENT_WIDTH },
    /** What was drawn last, so a section heading right after the head, the facts or a band gets no air above. */
    last: "page" as Last,
    /** The bottom margin the last element left, so the next element's top margin collapses with it like CSS margins. */
    gapBelow: 0,
    pageNumber: 0,
    /** The latest heading, which names a table that starts on the next page without its own heading. */
    lastHeading: "",
    /** Said at the top of every following page while set: what the page continues ("Tillbud 2 · Stege gled"). */
    running: "",
    /** Above zero while a block is measured: nothing is drawn and no page is added. */
    measuring: 0,
    /** The page breaks a measured block forces itself (a part, a chapter). */
    forcedBreaks: 0,

    /** Measure `draw` without drawing: its height and the page breaks it forces. Asynchronous drawing uses `measureAsync`. */
    measure(draw: () => void) {
      const restore = kit.startMeasure();
      try { draw(); return restore(); } catch (error) { restore(); throw error; }
    },
    async measureAsync(draw: () => void | Promise<void>) {
      const restore = kit.startMeasure();
      try { await draw(); return restore(); } catch (error) { restore(); throw error; }
    },
    startMeasure() {
      const saved = { page: kit.page, y: kit.y, last: kit.last, gapBelow: kit.gapBelow, frame: kit.frame, pageNumber: kit.pageNumber, lastHeading: kit.lastHeading, running: kit.running, forcedBreaks: kit.forcedBreaks };
      kit.page = NULL_PAGE;
      kit.y = MEASURE_Y;
      kit.forcedBreaks = 0;
      kit.measuring += 1;
      return () => {
        const result = { height: MEASURE_Y - kit.y, breaks: kit.forcedBreaks };
        kit.measuring -= 1;
        Object.assign(kit, saved);
        return result;
      };
    },
    /** Starts a new page when a block of this height does not fit here but fits on a page of its own; a taller one flows from here. */
    makeRoom(block: { height: number; breaks: number }) {
      if (!kit.measuring && !block.breaks && kit.last !== "page" && block.height > kit.room() && block.height <= CONTINUED_ROOM) kit.addPage();
    },
    /**
     * Draws `draw` whole: it moves to the next page rather than splitting, when a page can hold it. `extra` is room kept
     * under it for what must follow on the same page.
     */
    keep(draw: () => void, extra = 0) {
      if (!kit.measuring) {
        const block = kit.measure(draw);
        kit.makeRoom({ ...block, height: block.height + extra });
      }
      draw();
    },
    async keepAsync(draw: () => void | Promise<void>) {
      if (!kit.measuring) kit.makeRoom(await kit.measureAsync(draw));
      await draw();
    },

    /** Air above an element: `wanted` less what the element before already left. */
    space(wanted: number) {
      const extra = Math.max(0, wanted - kit.gapBelow);
      kit.y -= extra;
      kit.gapBelow = 0;
      return extra;
    },

    /** Text in line boxes like CSS: `top` is the top of the first line box; returns the height used. */
    text(value: unknown, x: number, top: number, options: TextOptions = {}) {
      const size = options.size ?? TYPE.body;
      const leading = options.leading ?? LEADING.body;
      const face = options.bold ? bold : regular;
      const maxWidth = options.maxWidth ?? kit.frame.width;
      const wrapped = wrap(face, value, size, maxWidth, options.slack ?? 0);
      const start = options.fromLine ?? 0;
      const lines = wrapped.slice(start, options.maxLines === undefined ? undefined : start + options.maxLines);
      if (options.ellipsis && options.maxLines && wrapped.length - start > options.maxLines) {
        let last = lines[options.maxLines - 1];
        while (last.length > 1 && face.widthOfTextAtSize(`${last}…`, size) > maxWidth) last = last.slice(0, -1);
        lines[options.maxLines - 1] = `${last.trimEnd()}…`;
      }
      const lineHeight = size * leading;
      const base = face.baseline(size, leading);
      lines.forEach((line, index) => kit.drawLine(face, line, x, top - index * lineHeight - base, size, options.color ?? colors.ink, options.align ?? "left", maxWidth));
      return lines.length * lineHeight;
    },

    /** One line of runs on a baseline, split per font for the fallback glyphs; `x` is the left edge, with `align` inside `maxWidth`. */
    drawLine(face: Face, line: string, x: number, baseline: number, size: number, color: KitColor, align: KitAlign = "left", maxWidth = 0) {
      if (!line) return;
      const width = face.widthOfTextAtSize(line, size);
      let cursor = align === "right" ? x + maxWidth - width : align === "center" ? x + (maxWidth - width) / 2 : x;
      if (trace && !kit.measuring) traceLine(trace, face, line, cursor, baseline, size, { page: kit.pageNumber - 1, bold: face === bold, color, align, spacing: letterSpacing });
      for (const run of face.runs(line)) {
        kit.page.drawText(run.text, { x: cursor, y: baseline, size, font: run.font, color });
        cursor += run.font.widthOfTextAtSize(run.text, size);
      }
    },

    /** Mixed runs on one line (the dates line: "Datum **2026-11-03** · Giltig till **2026-12-03**"); returns the width. */
    runs(parts: readonly { text: string; bold?: boolean; color?: KitColor }[], x: number, top: number, options: { size?: number; leading?: number; align?: KitAlign; maxWidth?: number } = {}) {
      const size = options.size ?? TYPE.body;
      const leading = options.leading ?? LEADING.body;
      const width = parts.reduce((sum, part) => sum + (part.bold ? bold : regular).widthOfTextAtSize(part.text, size), 0);
      const maxWidth = options.maxWidth ?? kit.frame.width;
      let cursor = options.align === "right" ? x + maxWidth - width : options.align === "center" ? x + (maxWidth - width) / 2 : x;
      const baseline = top - regular.baseline(size, leading);
      for (const part of parts) {
        const face = part.bold ? bold : regular;
        kit.drawLine(face, part.text, cursor, baseline, size, part.color ?? colors.ink);
        cursor += face.widthOfTextAtSize(part.text, size);
      }
      return width;
    },

    /** Letter-spaced capitals (the band "INTERNT UNDERLAG – EJ FAKTURA"): 0,08 em between the letters. */
    spaced(value: string, x: number, top: number, options: { size: number; color: KitColor; bold?: boolean; leading?: number }) {
      const face = options.bold ? bold : regular;
      const baseline = top - face.baseline(options.size, options.leading ?? LEADING.body);
      const text = value.toUpperCase();
      // One text object with character spacing, so the words stay whole for text extraction.
      kit.page.pushOperators(setCharacterSpacing(options.size * 0.08));
      letterSpacing = options.size * 0.08;
      kit.drawLine(face, text, x, baseline, options.size, options.color);
      letterSpacing = 0;
      kit.page.pushOperators(setCharacterSpacing(0));
      return face.widthOfTextAtSize(text, options.size) + untraced(text).length * options.size * 0.08;
    },

    /** A hairline from `x` over `width` at `y`. */
    hairline(x: number, y: number, width: number, color: KitColor = colors.lineSoft, thickness = RULE) {
      kit.page.drawLine({ start: { x, y }, end: { x: x + width, y }, thickness, color });
    },

    /** A rectangle with 1,5 mm rounded corners (the summary, the decision, the payment box); `top` is its upper edge. */
    roundedBox(x: number, top: number, width: number, height: number, options: { fill?: KitColor; border?: KitColor; radius?: number }) {
      const r = Math.min(options.radius ?? mm(1.5), width / 2, height / 2);
      const path = `M ${r} 0 H ${width - r} A ${r} ${r} 0 0 1 ${width} ${r} V ${height - r} A ${r} ${r} 0 0 1 ${width - r} ${height} H ${r} A ${r} ${r} 0 0 1 0 ${height - r} V ${r} A ${r} ${r} 0 0 1 ${r} 0 Z`;
      kit.page.drawSvgPath(path, { x, y: top, color: options.fill, borderColor: options.border, borderWidth: options.border ? RULE : 0 });
    },

    /** A box to tick: a square with a 0,75 pt ink border, a cross in ink when ticked, a short dash when not applicable. */
    checkbox(x: number, top: number, state: "off" | "on" | "na" = "off", size = BOX) {
      kit.roundedBox(x, top, size, size, { fill: colors.white, border: colors.ink, radius: mm(0.4) });
      if (state === "on") {
        const inset = size * 0.26;
        const stroke = mm(0.55);
        kit.page.drawLine({ start: { x: x + inset, y: top - inset }, end: { x: x + size - inset, y: top - size + inset }, thickness: stroke, color: colors.ink });
        kit.page.drawLine({ start: { x: x + inset, y: top - size + inset }, end: { x: x + size - inset, y: top - inset }, thickness: stroke, color: colors.ink });
      } else if (state === "na") {
        kit.page.drawLine({ start: { x: x + size * 0.25, y: top - size / 2 }, end: { x: x + size * 0.75, y: top - size / 2 }, thickness: mm(0.55), color: REPORT_TONES.muted });
      }
    },

    /** A status mark (Förslag A): the word on a tinted, bordered pill, 8,5 pt bold; returns its width. */
    badge(kind: KitBadge, text: string, x: number, top: number, align: KitAlign = "left", maxWidth = 0) {
      const style = badgeStyle(kind);
      const width = bold.widthOfTextAtSize(text, BADGE_SIZE) + BADGE_PAD_X * 2;
      const left = align === "right" ? x + maxWidth - width : align === "center" ? x + (maxWidth - width) / 2 : x;
      kit.roundedBox(left, top, width, BADGE_HEIGHT, { fill: style.fill, border: style.border, radius: mm(1) });
      // The word sits in the middle of the pill: half the pad plus the distance from the content box's top to the baseline.
      kit.drawLine(bold, text, left + BADGE_PAD_X, top - BADGE_PAD_Y - (BADGE_SIZE - BADGE_SIZE * bold.content) / 2 - BADGE_SIZE * bold.ascent, BADGE_SIZE, style.text);
      return width;
    },

    /** A risk level as its colour square and bold word ("12 Hög"); returns the width. */
    mark(mark: KitMark, x: number, top: number, size: number = TYPE.table, leading: number = LEADING.body) {
      const level = Math.min(4, Math.max(1, Math.round(mark.level)));
      const lineHeight = size * leading;
      kit.roundedBox(x, top - (lineHeight - MARK_SQUARE) / 2, MARK_SQUARE, MARK_SQUARE, { fill: RISK_COLORS[level - 1], border: colors.ink, radius: mm(0.5) });
      const textX = x + MARK_SQUARE + mm(1.5);
      kit.text(mark.text, textX, top, { size, leading, bold: true, color: RISK_WORD[level - 1], maxWidth: 999, maxLines: 1 });
      return MARK_SQUARE + mm(1.5) + bold.widthOfTextAtSize(mark.text, size);
    },

    /** The head of the first page: logo or company name with the address line to the left; kind, title, number and dates to the right; a hairline under. */
    firstPage() {
      kit.page = pdf.addPage([PAGE_WIDTH, PAGE_HEIGHT]);
      kit.pageNumber += 1;
      const head = input.head;
      const gap = mm(8);
      // The title column takes what it needs; the sender column keeps at least a third of the width.
      const titleMax = CONTENT_WIDTH - gap - CONTENT_WIDTH * 0.34;
      let titleSize = TYPE.h1;
      while (titleSize > 14 && bold.widthOfTextAtSize(head.title, titleSize) > titleMax) titleSize -= 0.5;
      const title = fitFooterText(bold, head.title, titleMax, titleSize);
      const numberLines = head.number ? wrap(bold, head.number, 11.5, titleMax).slice(0, 2) : [];
      const dateParts = (head.dates ?? []).flatMap((pair, index) => [...(index ? [{ text: " · ", color: colors.muted }] : []), { text: `${pair[0]} `, color: colors.muted }, { text: pair[1], bold: true, color: colors.ink }]);
      const titleWidth = Math.max(bold.widthOfTextAtSize(title, titleSize), ...numberLines.map((line) => bold.widthOfTextAtSize(line, 11.5)), regular.widthOfTextAtSize(head.kind, TYPE.label),
        dateParts.reduce((sum, part) => sum + (part.bold ? bold : regular).widthOfTextAtSize(part.text, TYPE.small), 0));
      const titleHeight = TYPE.label * LEADING.body + titleSize * LEADING.head + (numberLines.length ? mm(0.5) + numberLines.length * 11.5 * LEADING.body : 0) + (dateParts.length ? mm(0.5) + TYPE.small * LEADING.body : 0);
      const senderWidth = Math.max(mm(60), CONTENT_WIDTH - gap - Math.min(titleMax, titleWidth));
      const addressWidth = Math.min(mm(95), senderWidth);
      const addressLines = addressLine ? wrap(regular, addressLine, TYPE.small, addressWidth) : [];
      const logoSize = logo ? logo.scaleToFit(addressWidth, mm(11)) : null;
      const nameLines = logo ? [] : wrap(bold, company, 14, senderWidth).slice(0, 2);
      const senderHeight = (logoSize ? logoSize.height : nameLines.length * 14 * LEADING.body) + (addressLines.length ? mm(1.5) + addressLines.length * TYPE.small * LEADING.party : 0);
      const rowHeight = Math.max(titleHeight, senderHeight);
      const bottom = TOP - rowHeight;
      // Both columns stand on the row's bottom edge (align-items: end). A logo without an address line (a project report's
      // protocols) keeps the place it has over a two-line address on every other first page, so it does not jump.
      let y = addressLines.length ? bottom + senderHeight : Math.min(TOP, bottom + senderHeight + mm(1.5) + 2 * TYPE.small * LEADING.party);
      if (logoSize) { kit.page.drawImage(logo!, { x: MARGIN, y: y - logoSize.height, width: logoSize.width, height: logoSize.height }); y -= logoSize.height; }
      else y -= kit.text(nameLines.join("\n"), MARGIN, y, { size: 14, bold: true, maxWidth: senderWidth, maxLines: 2 });
      if (addressLines.length) { y -= mm(1.5); kit.text(addressLines.join("\n"), MARGIN, y, { size: TYPE.small, leading: LEADING.party, color: colors.muted, maxWidth: addressWidth }); }
      y = bottom + titleHeight;
      y -= kit.text(head.kind, MARGIN, y, { size: TYPE.label, color: colors.muted, align: "right", maxWidth: CONTENT_WIDTH, maxLines: 1 });
      y -= kit.text(title, MARGIN, y, { size: titleSize, leading: LEADING.head, bold: true, color: colors.navy, align: "right", maxWidth: CONTENT_WIDTH, maxLines: 1 });
      if (numberLines.length) { y -= mm(0.5); y -= kit.text(numberLines.join("\n"), MARGIN, y, { size: 11.5, bold: true, align: "right", maxWidth: CONTENT_WIDTH }); }
      if (dateParts.length) { y -= mm(0.5); kit.runs(dateParts, MARGIN, y, { size: TYPE.small, align: "right", maxWidth: CONTENT_WIDTH }); }
      const lineY = bottom - mm(3.5);
      kit.hairline(MARGIN, lineY, CONTENT_WIDTH, colors.line);
      kit.y = lineY - mm(4.5);
      kit.last = "page";
      kit.gapBelow = mm(4.5);
      kit.frame = { x: MARGIN, width: CONTENT_WIDTH };
    },

    /** A following page: the small head – logo or name, the title at 14 pt and the number line – and a hairline. */
    addPage(continued = true) {
      if (kit.measuring) { kit.forcedBreaks += 1; kit.last = "page"; return; }
      kit.page = pdf.addPage([PAGE_WIDTH, PAGE_HEIGHT]);
      kit.pageNumber += 1;
      kit.frame = { x: MARGIN, width: CONTENT_WIDTH };
      kit.last = "page";
      kit.gapBelow = mm(4);
      if (!continued) { kit.y = TOP; return; }
      const head = input.head;
      const number = head.continuation ?? head.number ?? "";
      const titleMax = CONTENT_WIDTH - mm(8) - mm(50);
      const title = fitFooterText(bold, head.title, titleMax, 14);
      // A long number line keeps its "· fortsättning": the document's own part is shortened, never the word.
      const suffix = continuedSuffix(common);
      const numberText = number.endsWith(suffix) ? `${fitFooterText(bold, number.slice(0, -suffix.length), titleMax - bold.widthOfTextAtSize(suffix, 11.5), 11.5)}${suffix}` : fitFooterText(bold, number, titleMax, 11.5);
      const titleHeight = 14 * LEADING.head + (numberText ? mm(0.5) + 11.5 * LEADING.body : 0);
      const logoSize = logo ? logo.scaleToFit(mm(60), mm(8)) : null;
      const senderHeight = logoSize ? logoSize.height : 14 * LEADING.body;
      const rowHeight = Math.max(titleHeight, senderHeight);
      const bottom = TOP - rowHeight;
      if (logoSize) kit.page.drawImage(logo!, { x: MARGIN, y: bottom + senderHeight - logoSize.height, width: logoSize.width, height: logoSize.height });
      else kit.text(fitFooterText(bold, company, mm(60), 14), MARGIN, bottom + senderHeight, { size: 14, bold: true, maxWidth: mm(60), maxLines: 1 });
      let y = bottom + titleHeight;
      y -= kit.text(title, MARGIN, y, { size: 14, leading: LEADING.head, bold: true, color: colors.navy, align: "right", maxWidth: CONTENT_WIDTH, maxLines: 1 });
      if (numberText) { y -= mm(0.5); kit.text(numberText, MARGIN, y, { size: 11.5, bold: true, align: "right", maxWidth: CONTENT_WIDTH, maxLines: 1 }); }
      const lineY = bottom - mm(3);
      kit.hairline(MARGIN, lineY, CONTENT_WIDTH, colors.line);
      kit.y = lineY - mm(4);
      if (kit.running) kit.continuationLine(kit.running);
    },

    /** The quiet line at the top of a page that goes on with something from the page before. */
    continuationLine(what: string) {
      kit.y -= kit.text(common.text("continued.line", { vad: what }), kit.frame.x, kit.y, { size: TYPE.small, color: colors.muted, maxLines: 1, ellipsis: true }) + mm(2.5);
      kit.gapBelow = mm(2.5);
    },

    ensure(height: number) {
      if (kit.y - height < BOTTOM) kit.addPage();
    },

    /** The room left on this page above the footer. */
    room() {
      return kit.y - BOTTOM;
    },

    /** A band: letter-spaced capitals in the warning colour ("UTKAST – INTE SKICKAD", "INTERNT UNDERLAG – EJ FAKTURA"). */
    band(text: string) {
      const height = 11 * LEADING.body;
      kit.ensure(height + mm(4));
      kit.spaced(text, kit.frame.x, kit.y, { size: 11, bold: true, color: REPORT_TONES.warning });
      kit.y -= height + mm(4);
      kit.gapBelow = mm(4);
      kit.last = "band";
    },

    /** A section heading: 11,5 pt bold in the primary colour with 4,2 mm of air above (none right after the head or the facts) and an optional note under it. */
    section(title: string, options: { note?: string; keep?: number } = {}) {
      const above = kit.last === "page" || kit.last === "facts" || kit.last === "band" ? 0 : Math.max(0, mm(4.2) - kit.gapBelow);
      const titleLines = wrap(bold, title, TYPE.h2, kit.frame.width);
      const noteLines = options.note ? wrap(regular, options.note, TYPE.small, kit.frame.width) : [];
      const height = titleLines.length * TYPE.h2 * LEADING.head + (noteLines.length ? mm(0.5) + noteLines.length * TYPE.small * LEADING.body : 0) + mm(1.6);
      if (kit.y - above - height - (options.keep ?? 0) < BOTTOM) kit.addPage();
      kit.y -= kit.last === "page" ? 0 : above;
      kit.gapBelow = 0;
      kit.lastHeading = title;
      kit.y -= kit.text(titleLines.join("\n"), kit.frame.x, kit.y, { size: TYPE.h2, leading: LEADING.head, bold: true, color: colors.navy });
      if (noteLines.length) { kit.y -= mm(0.5); kit.y -= kit.text(noteLines.join("\n"), kit.frame.x, kit.y, { size: TYPE.small, color: colors.muted }); }
      kit.y -= mm(1.6);
      kit.gapBelow = mm(1.6);
      kit.last = "section";
    },

    /** A heading inside a section: 10,5 pt bold in the primary colour, 4 mm above and 1,5 mm under. */
    subTitle(title: string, keep = 20) {
      const lines = wrap(bold, title, TYPE.h3, kit.frame.width).slice(0, 2);
      const above = kit.last === "page" || kit.last === "section" ? 0 : Math.max(0, mm(4) - kit.gapBelow);
      const height = lines.length * TYPE.h3 * LEADING.head + mm(1.5);
      if (kit.y - above - height - keep < BOTTOM) kit.addPage();
      kit.y -= kit.last === "page" ? 0 : above;
      kit.lastHeading = title;
      kit.y -= kit.text(lines.join("\n"), kit.frame.x, kit.y, { size: TYPE.h3, leading: LEADING.head, bold: true, color: colors.navy, maxLines: 2, ellipsis: true });
      kit.y -= mm(1.5);
      kit.gapBelow = mm(1.5);
      kit.last = "section";
    },

    /**
     * Running text, 10 pt on 14,5 pt, at most 150 mm wide, line by line so a long text continues on the next page – but no
     * line stands alone there: a short text and a list item stay whole, and a longer text parts with at least two lines on
     * each side. A list item ("• …") hangs under its own text.
     */
    paragraph(value: string, options: { size?: number; color?: KitColor; bold?: boolean; maxWidth?: number; after?: number; leading?: number } = {}) {
      const size = options.size ?? TYPE.body;
      const leading = options.leading ?? LEADING.body;
      const maxWidth = Math.min(options.maxWidth ?? TEXT_WIDTH, kit.frame.width);
      const face = options.bold ? bold : regular;
      const lineHeight = size * leading;
      const { marker, indent, lines } = wrapHanging(face, value, size, maxWidth);
      const color = options.color ?? colors.ink;
      const whole = lines.length * lineHeight;
      if ((marker || lines.length <= 3) && whole <= CONTINUED_ROOM) kit.ensure(whole);
      else kit.ensure(Math.min(2, lines.length) * lineHeight);
      lines.forEach((line, index) => {
        kit.ensure((lines.length - index === 2 ? 2 : 1) * lineHeight);
        // The mark and the first line are one text, so copying from the PDF gives "• text"; the indent is exactly the mark's width.
        if (marker && !index) kit.text(`${marker} ${line}`, kit.frame.x, kit.y, { size, leading, bold: options.bold, color, maxWidth, maxLines: 1 });
        else kit.text(line, kit.frame.x + indent, kit.y, { size, leading, bold: options.bold, color, maxWidth: maxWidth - indent, maxLines: 1 });
        kit.y -= lineHeight;
      });
      kit.y -= options.after ?? mm(2.5);
      kit.gapBelow = options.after ?? mm(2.5);
      kit.last = "other";
    },

    /**
     * A list: tight items with a paragraph's air after the last, and the last two items together, so none stands alone on a
     * page. `keepAfter` is room those last items keep under them for what must follow them on the same page.
     */
    list(items: readonly string[], options: { size?: number; color?: (item: string) => KitColor | undefined; keepAfter?: number } = {}) {
      const after = options.keepAfter ?? 0;
      items.forEach((item, index) => {
        const draw = () => kit.paragraph(item, { size: options.size, color: options.color?.(item), after: index === items.length - 1 ? mm(2.5) : mm(0.8) });
        const last = index === items.length - 1;
        if (last && items.length === 1 && after) kit.keep(draw, after);
        else if (index === items.length - 2 && (index > 0 || after)) kit.keep(draw, kit.measure(() => kit.paragraph(items[index + 1], { size: options.size })).height + after);
        else draw();
      });
    },

    /** A bold line and its text lines without a frame ("Kvarstående arbete", "Noteringar till fakturering"). */
    block(title: string, lines: readonly string[], options: { tone?: KitColor; size?: number } = {}) {
      const size = options.size ?? TYPE.body;
      const first = lines.length ? wrap(regular, lines[0], size, Math.min(TEXT_WIDTH, kit.frame.width)).length : 0;
      kit.ensure(size * LEADING.body + mm(0.8) + Math.min(first, 2) * size * LEADING.body);
      kit.y -= kit.text(title, kit.frame.x, kit.y, { size, bold: true });
      kit.y -= mm(0.8);
      for (const line of lines) kit.paragraph(line, { size, color: options.tone, after: mm(0.6) });
      kit.y -= mm(3.5) - mm(0.6);
      kit.gapBelow = mm(3.5);
      kit.last = "other";
    },

    /**
     * The facts grid: label above value, no boxes, two columns – three with more than four facts – with 2,6 mm between
     * the rows and 8 mm between the columns. A fact may span several columns (twelfths), be a party (the name larger with
     * its lines), a blank line to write on, a row of choices or a risk mark. A row that does not fit moves to the next page;
     * one taller than a page continues there under the same label.
     */
    facts(items: readonly KitFact[], options: { cols?: 2 | 3 | 4; after?: number } = {}) {
      if (!items.length) return;
      const cols = options.cols ?? (items.length > 4 ? 3 : 2);
      const unit = 12 / cols;
      const gapX = mm(8);
      const gapY = mm(2.6);
      const colWidth = (kit.frame.width - gapX * (cols - 1)) / cols;
      const labelLine = TYPE.label * LEADING.label;
      const valueLine = TYPE.body * LEADING.table;
      type Placed = { item: KitFact; x: number; width: number; labelLines: string[]; valueLines: string[]; fixed: number };
      const rows: Placed[][] = [];
      let column = 0;
      for (const item of items) {
        const span = Math.min(cols, Math.max(1, Math.ceil((item.span ?? unit) / unit)));
        if (!rows.length || column + span > cols) { rows.push([]); column = 0; }
        const width = colWidth * span + gapX * (span - 1);
        const x = kit.frame.x + column * (colWidth + gapX);
        const labelLines = wrap(regular, item.label, TYPE.label, width).slice(0, 2);
        let valueLines: string[] = [];
        let fixed = 0;
        if (item.party) fixed = 11.5 * LEADING.table + item.party.lines.flatMap((line) => wrap(regular, line, TYPE.body, width)).length * TYPE.body * LEADING.party;
        else if (item.blank) fixed = mm(7);
        else if (item.choices) fixed = mm(1) + kit.choicesHeight(item.choices, width);
        else if (item.mark || item.badge) fixed = valueLine;
        else valueLines = wrap(item.plain ? regular : bold, item.value, TYPE.body, width);
        rows.at(-1)!.push({ item, x, width, labelLines, valueLines, fixed });
        column += span;
      }
      const heightOf = (row: Placed[], count: (cell: Placed) => number) => Math.max(...row.map((cell) => cell.labelLines.length * labelLine + (cell.fixed || count(cell) * valueLine)));
      const pageLines = Math.floor((TOP - mm(40) - BOTTOM - 2 * labelLine) / valueLine);
      for (const [index, row] of rows.entries()) {
        const total = heightOf(row, (cell) => cell.valueLines.length);
        if (index) kit.y -= gapY;
        let from = 0;
        for (;;) {
          const longest = Math.max(1, ...row.map((cell) => cell.valueLines.length));
          const whole = kit.y - total >= BOTTOM;
          if (!whole && from === 0 && longest <= pageLines) { kit.addPage(); continue; }
          const roomLines = Math.floor((kit.y - BOTTOM - 2 * labelLine) / valueLine);
          if (!whole && roomLines < 3 && from === 0) { kit.addPage(); continue; }
          const count = whole ? longest : Math.max(1, roomLines);
          const height = heightOf(row, (cell) => Math.max(0, Math.min(cell.valueLines.length - from, count)));
          for (const cell of row) {
            if (from > 0 && cell.valueLines.length <= from) continue;
            const label = from > 0 ? common.text("continued.label", { etikett: cell.item.label }) : cell.labelLines.join("\n");
            let y = kit.y - kit.text(label, cell.x, kit.y, { size: TYPE.label, leading: LEADING.label, color: colors.muted, maxWidth: cell.width, maxLines: 2, ellipsis: true });
            const item = cell.item;
            if (item.party) {
              y -= kit.text(item.party.name, cell.x, y, { size: 11.5, leading: LEADING.table, bold: true, maxWidth: cell.width });
              for (const line of item.party.lines) y -= kit.text(line, cell.x, y, { size: TYPE.body, leading: LEADING.party, maxWidth: cell.width });
            } else if (item.blank) {
              kit.hairline(cell.x, y - mm(7), cell.width, colors.ink);
            } else if (item.choices) {
              kit.drawChoices(item.choices, cell.x, y - mm(1), cell.width);
            } else if (item.mark) {
              kit.mark(item.mark, cell.x, y, TYPE.body, LEADING.table);
            } else if (item.badge) {
              kit.badge(item.badge, clean(item.value), cell.x, y - (valueLine - BADGE_HEIGHT) / 2);
            } else {
              kit.text(cell.valueLines.join("\n"), cell.x, y, { size: TYPE.body, leading: LEADING.table, bold: !item.plain, color: item.tone, maxWidth: cell.width, fromLine: from, maxLines: count });
            }
          }
          kit.y -= height;
          from += count;
          if (whole || from >= longest) break;
          kit.addPage();
        }
      }
      kit.y -= options.after ?? mm(4.5);
      kit.gapBelow = options.after ?? mm(4.5);
      kit.last = "facts";
    },

    /** The height of a row of choices (box + word, wrapping) in `width`. */
    choicesHeight(choices: readonly { text: string; checked: boolean }[], width: number, large = false) {
      const box = large ? BOX_LARGE : BOX;
      const lineHeight = Math.max(TYPE.body * LEADING.body, box);
      let x = 0;
      let rows = 1;
      for (const choice of choices) {
        const w = box + mm(1) + bold.widthOfTextAtSize(choice.text, TYPE.body) + (large ? mm(7) : mm(3.5));
        if (x > 0 && x + w > width) { rows += 1; x = 0; }
        x += w;
      }
      return rows * lineHeight + (rows - 1) * mm(1.5);
    },

    /** Boxes with their words in a row that wraps ("☐ Utan spänning ☐ Nära spänning …"); returns the height. */
    drawChoices(choices: readonly { text: string; checked: boolean }[], x0: number, top: number, width: number, large = false) {
      const box = large ? BOX_LARGE : BOX;
      const lineHeight = Math.max(TYPE.body * LEADING.body, box);
      let x = 0;
      let y = top;
      for (const choice of choices) {
        const w = box + mm(1) + bold.widthOfTextAtSize(choice.text, TYPE.body);
        if (x > 0 && x + w > width) { y -= lineHeight + mm(1.5); x = 0; }
        kit.checkbox(x0 + x, y - (lineHeight - box) / 2, choice.checked ? "on" : "off", box);
        kit.text(choice.text, x0 + x + box + mm(1), y, { size: TYPE.body, leading: lineHeight / TYPE.body, bold: true, maxWidth: width, maxLines: 1 });
        x += w + (large ? mm(7) : mm(3.5));
      }
      return top - y + lineHeight;
    },

    /** A list of boxes with their words, two to a row (equipment, visual checks); a tick means done. */
    checkList(items: readonly { text: string; checked: boolean }[], options: { cols?: 1 | 2 | 3 } = {}) {
      const cols = options.cols ?? 2;
      const gap = mm(8);
      const width = (kit.frame.width - gap * (cols - 1)) / cols;
      const textWidth = width - BOX - mm(1.8);
      for (let index = 0; index < items.length; index += cols) {
        const row = items.slice(index, index + cols);
        const height = Math.max(...row.map((item) => wrap(regular, item.text, TYPE.body, textWidth).length)) * TYPE.body * LEADING.body;
        kit.ensure(height + mm(0.6));
        row.forEach((item, column) => {
          const x = kit.frame.x + column * (width + gap);
          kit.checkbox(x, kit.y - (TYPE.body * LEADING.body - BOX) / 2, item.checked ? "on" : "off");
          kit.text(item.text, x + BOX + mm(1.8), kit.y, { size: TYPE.body, maxWidth: textWidth });
        });
        kit.y -= height + mm(0.6);
      }
      kit.y -= mm(3.5) - mm(0.6);
      kit.gapBelow = mm(3.5);
      kit.last = "other";
    },

    /**
     * A table: a tinted heading row (8,5 pt bold in the primary colour, a 0,75 pt line under it), rows of 9,5 pt on hairlines
     * (dense: 9 pt), numbers right-aligned by the column, a deviation row tinted light red, and a bold total row over a line
     * in the primary colour. After a page break the heading row is repeated under "…, fortsättning från föregående sida", which
     * stays true when the document is merged into a project report. Cells may carry a status mark, a risk mark or a box to tick.
     */
    table(input: { title?: string; columns: KitColumn[]; rows: readonly KitRow[]; total?: KitCell[]; dense?: boolean; /** Rows at least 6,6 mm high, text centred vertically (to fill in by hand). */ hand?: boolean; sizes?: { header: number; body: number }; after?: number; /** Room kept under the last row for what sums up the table (its computed facts). */ keepAfter?: number; /** Side padding of the cells instead of the design's, for a table that needs the room. */ padX?: number }) {
      const dense = input.dense ?? false;
      const bodySize = input.sizes?.body ?? (dense ? TYPE.dense : TYPE.table);
      const headSize = input.sizes?.header ?? TYPE.label;
      const padY = dense ? mm(1.15) : mm(1.5);
      const padX = input.padX ?? (dense ? mm(1.8) : mm(2.2));
      const lineHeight = bodySize * LEADING.table;
      const scale = Math.min(1, kit.frame.width / input.columns.reduce((sum, column) => sum + column.width, 0));
      const columns = input.columns.map((column) => ({ ...column, width: column.width * scale, align: column.align ?? ((column.center ? "center" : "left") as KitAlign) }));
      const width = columns.reduce((sum, column) => sum + column.width, 0);
      const cellOf = (cell: KitCell): Exclude<KitCell, string> => typeof cell === "string" ? { text: cell } : cell;
      const rowOf = (row: KitRow) => Array.isArray(row) ? { cells: row } : row;
      // An empty cell stays empty (the templates leave a blank comment blank); the callers write "—" where a dash is meant.
      const spanWidth = (index: number, span = 1) => columns.slice(index, index + Math.max(1, span)).reduce((sum, column) => sum + column.width, 0);
      const linesOf = (cell: Exclude<KitCell, string>, index: number, boldText: boolean) => cell.badge || cell.mark || cell.box ? [] : !(cell.text ?? "").trim() ? [""] : wrap(boldText || cell.bold ? bold : regular, cell.text ?? "", bodySize, spanWidth(index, cell.span) - padX * 2, padX * 1.6).slice(0, CELL_MAX_LINES);
      const heightOf = (cells: KitCell[], boldText: boolean) => {
        const inner = Math.max(lineHeight, ...cells.map((raw, index) => {
          const cell = cellOf(raw);
          if (cell.badge) return Math.max(lineHeight, BADGE_HEIGHT + 1);
          if (cell.box) return Math.max(lineHeight, BOX);
          return Math.max(1, linesOf(cell, index, boldText).length) * lineHeight;
        }));
        // The collapsed 0,75 pt border belongs to the row, as in the templates.
        return Math.max(input.hand ? mm(6.6) : 0, inner + padY * 2) + RULE;
      };
      // The heading row's words never break in the middle (white-space: nowrap): a long word overflows its padding instead.
      // The last column has the table's edge beside it, and a right-aligned label a left-aligned one, so their words wrap rather than run into the padding there.
      const tight = (index: number) => index === columns.length - 1 || (columns[index].align === "right" && columns[index + 1].align !== "right");
      const headLines = columns.map((column, index) => wrap(bold, column.label, headSize, Math.max(column.width - padX * 2, tight(index) ? 0 : Math.min(column.width - 2, bold.widthOfTextAtSize(column.label, headSize)), ...column.label.split(/\s+/).map((word) => bold.widthOfTextAtSize(word, headSize)))).slice(0, 2));
      const headHeight = Math.max(...headLines.map((lines) => lines.length)) * headSize * LEADING.table + padY * 2;
      const drawHead = () => {
        kit.page.drawRectangle({ x: kit.frame.x, y: kit.y - headHeight, width, height: headHeight, color: colors.soft });
        let x = kit.frame.x;
        columns.forEach((column, index) => {
          const lines = headLines[index];
          const top = kit.y - padY - (headHeight - padY * 2 - lines.length * headSize * LEADING.table) / 2;
          const inner = Math.max(column.width - padX * 2, ...lines.map((line) => bold.widthOfTextAtSize(line, headSize)));
          kit.text(lines.join("\n"), x + padX - (inner - (column.width - padX * 2)) / 2, top, { size: headSize, leading: LEADING.table, bold: true, color: colors.navy, maxWidth: inner, align: column.align });
          x += column.width;
        });
        kit.y -= headHeight;
        kit.hairline(kit.frame.x, kit.y, width, colors.navy);
      };
      const drawCells = (cells: KitCell[], height: number, options: { bold?: boolean; muted?: boolean; tone?: KitColor }) => {
        let x = kit.frame.x;
        let skip = 0;
        columns.forEach((column, index) => {
          if (skip > 0) { skip -= 1; x += column.width; return; }
          const cell = cellOf(cells[index] ?? "");
          const align = cell.align ?? column.align;
          const inner = spanWidth(index, cell.span) - padX * 2;
          skip = Math.max(0, (cell.span ?? 1) - 1);
          // A status mark never leaves its column: one wider than the padded room gives up the padding on its right first.
          if (cell.badge) { const mark = bold.widthOfTextAtSize(cell.text ?? "", BADGE_SIZE) + BADGE_PAD_X * 2; kit.badge(cell.badge, cell.text ?? "", x + Math.min(padX, Math.max(0, column.width - mark)), kit.y - padY - (input.hand ? (height - padY * 2 - BADGE_HEIGHT) / 2 : 0.5), align, inner); }
          else if (cell.mark) kit.mark(cell.mark, x + padX, kit.y - padY - (input.hand ? (height - padY * 2 - lineHeight) / 2 : 0), bodySize, LEADING.table);
          else if (cell.box) kit.checkbox(x + padX + (align === "center" ? (inner - BOX) / 2 : align === "right" ? inner - BOX : 0), kit.y - padY - (height - padY * 2 - BOX) / 2, cell.box);
          else {
            const lines = linesOf(cell, index, Boolean(options.bold));
            const top = kit.y - padY - (input.hand ? (height - padY * 2 - lines.length * lineHeight) / 2 : 0);
            if (lines.join("").trim()) kit.text(lines.join("\n"), x + padX, top, { size: bodySize, leading: LEADING.table, bold: options.bold || cell.bold, color: cell.tone ?? options.tone ?? (cell.muted || options.muted ? colors.muted : colors.ink), maxWidth: inner, align, maxLines: CELL_MAX_LINES, ellipsis: true, slack: padX * 1.6 });
          }
          x += column.width;
        });
      };
      const rows = input.rows.map(rowOf);
      const totalHeight = input.total ? heightOf(input.total, true) : 0;
      // The heading keeps the first row with it; the total keeps the last. A table of a section that starts on the next page
      // says what it goes on with, like a table that continues there.
      if (kit.y - headHeight - (rows.length ? heightOf(rows[0].cells, Boolean(rows[0].bold)) : totalHeight) < BOTTOM) {
        const stranded = kit.last === "section" || !input.title || input.title === kit.lastHeading;
        const named = input.title || kit.lastHeading;
        kit.addPage();
        if (stranded && named) kit.continuationLine(named);
      }
      drawHead();
      rows.forEach((row, index) => {
        const height = heightOf(row.cells, Boolean(row.bold || row.dev));
        const needed = height + (index === rows.length - 1 ? totalHeight + (input.keepAfter ?? 0) : 0);
        if (kit.y - needed < BOTTOM) {
          kit.addPage();
          kit.continuationLine(input.title || kit.lastHeading || common.text("continued.table"));
          drawHead();
        }
        // A deviation row as the templates print it: light red behind the row, the row bold in the deviation colour.
        if (row.dev) kit.page.drawRectangle({ x: kit.frame.x, y: kit.y - height, width, height, color: REPORT_FILLS.fail });
        drawCells(row.cells, height, { bold: row.bold || row.dev, muted: row.muted, tone: row.dev ? REPORT_TONES.fail : undefined });
        kit.y -= height;
        kit.hairline(kit.frame.x, kit.y, width, colors.lineSoft);
      });
      if (input.total) {
        kit.hairline(kit.frame.x, kit.y, width, colors.navy);
        drawCells(input.total, totalHeight, { bold: true });
        kit.y -= totalHeight;
      }
      kit.y -= input.after ?? mm(3.5);
      kit.gapBelow = input.after ?? mm(3.5);
      kit.last = "other";
    },

    /**
     * Column widths where no word is broken in the middle: a column narrower than its longest word gets that width from
     * columns with room to spare. A table too wide for that is printed smaller, in steps, never under 8 pt; `sizes` is
     * then passed on to `table`.
     */
    fitColumns(columns: KitColumn[], rows: readonly (readonly KitCell[])[], dense = false, options: { padX?: number } = {}): { columns: KitColumn[]; sizes?: { header: number; body: number } } {
      const textOf = (cell: KitCell | undefined) => typeof cell === "string" ? cell : cell?.text ?? "";
      // What must not part counts as one word: a number with its unit, a date with its time.
      const longest = (value: unknown, size: number, face: Face) => Math.max(0, ...unbroken(clean(value).split(/\s+/), () => true).map((word) => face.widthOfTextAtSize(word, size)));
      // A status mark is one piece, never wrapped: its whole word and its own padding count.
      const cellNeed = (cell: KitCell | undefined, body: number) => typeof cell !== "string" && cell?.badge ? bold.widthOfTextAtSize(cell.text ?? "", BADGE_SIZE) + BADGE_PAD_X * 2 : longest(textOf(cell), body, regular);
      const steps: [number, number][] = dense ? [[8.5, 9], [8, 8.5], [8, 8]] : [[8.5, 9.5], [8.5, 9], [8, 8.5], [8, 8]];
      const total = kit.frame.width;
      for (const [index, [header, body]] of steps.entries()) {
        const padX = (options.padX ?? (index > 0 || dense ? mm(1.8) : mm(2.2))) * 2 + 1;
        const need = columns.map((column, c) => Math.min(total / 3, padX + Math.max(longest(column.label, header, bold), ...rows.map((row) => cellNeed(row[c], body)))));
        const sum = need.reduce((acc, value) => acc + value, 0);
        if (sum > total && index < steps.length - 1) continue;
        const sizes = index ? { header, body } : undefined;
        if (sum > total) return { columns: columns.map((column, c) => ({ ...column, width: (need[c] / sum) * total })), sizes };
        const deficit = columns.reduce((acc, column, c) => acc + Math.max(0, need[c] - column.width), 0);
        const slack = columns.map((column, c) => Math.max(0, column.width - need[c]));
        const spare = slack.reduce((acc, value) => acc + value, 0);
        return { columns: columns.map((column, c) => ({ ...column, width: column.width < need[c] ? need[c] : column.width - (spare ? (slack[c] / spare) * deficit : 0) })), sizes };
      }
      return { columns };
    },

    /** A summary row's label as lines: all of it, beside the value and over more lines when it needs them. */
    sumRowLines(row: KitSumRow, width: number) {
      const face = row.bold ? bold : regular;
      return wrap(face, row.label, TYPE.table, Math.max(width * 0.4, width - mm(7) - face.widthOfTextAtSize(row.value, TYPE.table) - mm(3)));
    },

    /** The total's label as lines: all of it, beside the amount and over more lines when it needs them. */
    sumTotalLines(total: KitSumTotal, width: number) {
      return wrap(bold, total.label, TYPE.total, Math.max(width * 0.3, width - mm(7) - bold.widthOfTextAtSize(total.value, TYPE.total) - mm(3)));
    },

    /** The height of a summary box with these rows, in a box of `width` (the summary row's 80 mm by default). */
    sumBoxHeight(rows: readonly KitSumRow[], total: KitSumTotal | null, width = mm(80)) {
      const lineHeight = TYPE.table * LEADING.body;
      const body = rows.reduce((sum, row) => sum + kit.sumRowLines(row, width).length * lineHeight + mm(1.6) * 2, 0);
      const after = (total?.after ?? []).reduce((sum, row) => sum + mm(1) + kit.sumRowLines(row, width).length * lineHeight, 0);
      return mm(1) + body + (total ? mm(1) + RULE + mm(2.4) + kit.sumTotalLines(total, width).length * TYPE.total * LEADING.body + (total.small ? TYPE.small * LEADING.body : 0) + after + mm(2.6) : mm(1));
    },

    /** The summary box at a place: rows of label and value, then the total over a line in the primary colour; returns the height. */
    sumBoxAt(x: number, top: number, width: number, rows: readonly KitSumRow[], total: KitSumTotal | null) {
      const lineHeight = TYPE.table * LEADING.body;
      const height = kit.sumBoxHeight(rows, total, width);
      kit.roundedBox(x, top, width, height, { fill: colors.white, border: colors.line });
      let y = top - mm(1);
      for (const row of rows) {
        const lines = kit.sumRowLines(row, width);
        kit.text(lines.join("\n"), x + mm(3.5), y - mm(1.6), { size: TYPE.table, bold: row.bold, maxWidth: width - mm(7) });
        kit.text(row.value, x + mm(3.5), y - mm(1.6), { size: TYPE.table, bold: row.bold, maxWidth: width - mm(7), align: "right", maxLines: 1 });
        y -= lines.length * lineHeight + mm(1.6) * 2;
      }
      if (total) {
        y -= mm(1);
        kit.hairline(x, y, width, colors.navy);
        y -= RULE + mm(2.4);
        const labelLines = kit.sumTotalLines(total, width);
        kit.text(labelLines.join("\n"), x + mm(3.5), y, { size: TYPE.total, bold: true, color: colors.navy, maxWidth: width - mm(7) });
        kit.text(total.value, x + mm(3.5), y, { size: TYPE.total, bold: true, color: colors.navy, maxWidth: width - mm(7), align: "right", maxLines: 1 });
        y -= labelLines.length * TYPE.total * LEADING.body;
        if (total.small) { kit.text(total.small, x + mm(3.5), y, { size: TYPE.small, color: colors.muted, maxWidth: width - mm(7), maxLines: 1, ellipsis: true }); y -= TYPE.small * LEADING.body; }
        for (const row of total.after ?? []) {
          const lines = kit.sumRowLines(row, width);
          y -= mm(1);
          kit.text(lines.join("\n"), x + mm(3.5), y, { size: TYPE.table, bold: row.bold, maxWidth: width - mm(7) });
          kit.text(row.value, x + mm(3.5), y, { size: TYPE.table, bold: row.bold, maxWidth: width - mm(7), align: "right", maxLines: 1 });
          y -= lines.length * TYPE.table * LEADING.body;
        }
      }
      return height;
    },

    /**
     * The summary row of the economy documents: text to the left (a heading with its lines and small notes), the framed
     * summary 80 mm wide to the right. The box never breaks over a page; the callers keep the left text short.
     */
    sumRow(left: { title?: string; lines?: readonly string[]; notes?: readonly string[] } | null, rows: readonly KitSumRow[], total: KitSumTotal | null) {
      const boxWidth = mm(80);
      const gap = mm(8);
      const leftWidth = kit.frame.width - boxWidth - gap;
      const boxHeight = kit.sumBoxHeight(rows, total);
      const leftLines = (left?.lines ?? []).flatMap((line) => wrap(regular, line, TYPE.body, leftWidth)).length;
      const noteLines = (left?.notes ?? []).flatMap((line) => wrap(regular, line, TYPE.small, leftWidth)).length;
      const leftHeight = (left?.title ? TYPE.h2 * LEADING.head + mm(1.6) : 0) + leftLines * TYPE.body * LEADING.body + mm(2.5) + noteLines * TYPE.small * LEADING.body;
      kit.ensure(Math.max(boxHeight, Math.min(leftHeight, kit.room())) + mm(4));
      const top = kit.y;
      const height = kit.sumBoxAt(kit.frame.x + leftWidth + gap, top, boxWidth, rows, total);
      const frame = kit.frame;
      kit.frame = { x: frame.x, width: leftWidth };
      kit.last = "facts";
      if (left?.title) kit.section(left.title);
      for (const line of left?.lines ?? []) kit.paragraph(line, { maxWidth: leftWidth });
      for (const note of left?.notes ?? []) kit.paragraph(note, { size: TYPE.small, color: colors.muted, maxWidth: leftWidth, after: mm(1) });
      kit.frame = frame;
      kit.y = Math.min(kit.y, top - height) - mm(4);
      kit.gapBelow = mm(4);
      kit.last = "other";
    },

    /**
     * The payment box (Förslag A): four or five facts on a soft tint – the key figures (due date, amount) in the accent colour. The
     * columns are equal while every word fits; otherwise each gets its longest word and shares the rest, and a value that
     * is still too long wraps, so nothing is cut.
     */
    payBox(items: readonly { label: string; value: string; key?: boolean }[], payTo: readonly { label: string; value: string }[] = []) {
      const padY = mm(3);
      const padX = mm(3.5);
      const gap = mm(4);
      const cols = Math.max(1, Math.min(5, items.length));
      const shown = items.slice(0, cols);
      const room = kit.frame.width - padX * 2 - gap * (cols - 1);
      const need = shown.map((item) => Math.max(regular.widthOfTextAtSize(item.label, TYPE.label), ...item.value.split(/\s+/).map((word) => bold.widthOfTextAtSize(word, 11))));
      const needed = need.reduce((sum, value) => sum + value, 0);
      const widths = need.some((value) => value > room / cols) && needed <= room ? need.map((value) => value + (room - needed) / cols) : need.map(() => room / cols);
      const values = shown.map((item, index) => wrap(bold, item.value, 11, widths[index]));
      // Where to pay: a second row in the same box, under the first row's columns (a bankgiro or plusgiro that is filled in).
      const payRow = payTo.slice(0, cols);
      const payRowHeight = payRow.length ? mm(2.5) + TYPE.label * LEADING.label + mm(0.3) + 11 * LEADING.body : 0;
      const height = padY * 2 + TYPE.label * LEADING.label + mm(0.3) + Math.max(...values.map((lines) => lines.length)) * 11 * LEADING.body + payRowHeight;
      kit.ensure(height + mm(5));
      kit.roundedBox(kit.frame.x, kit.y, kit.frame.width, height, { fill: colors.soft, border: colors.line });
      let x = kit.frame.x + padX;
      const columnX: number[] = [];
      const top = kit.y;
      shown.forEach((item, index) => {
        columnX.push(x);
        const y = top - padY - kit.text(item.label, x, top - padY, { size: TYPE.label, leading: LEADING.label, color: colors.muted, maxWidth: widths[index], maxLines: 1, ellipsis: true });
        kit.text(values[index].join("\n"), x, y - mm(0.3), { size: 11, bold: true, color: item.key ? colors.accent : colors.navy, maxWidth: widths[index] });
        x += widths[index] + gap;
      });
      if (payRow.length) {
        const rowTop = top - height + padY + payRowHeight - mm(2.5);
        payRow.forEach((item, index) => {
          const y = rowTop - kit.text(item.label, columnX[index], rowTop, { size: TYPE.label, leading: LEADING.label, color: colors.muted, maxWidth: widths[index], maxLines: 1, ellipsis: true });
          kit.text(item.value, columnX[index], y - mm(0.3), { size: 11, bold: true, color: colors.navy, maxWidth: widths[index], maxLines: 1, ellipsis: true });
        });
      }
      kit.y -= height + mm(5);
      kit.gapBelow = mm(5);
      kit.last = "other";
    },

    /**
     * The decision box (the only frame on a protocol page): its label in the primary colour and either large boxes to tick
     * ("Godkänd – frisläpps", "Godkänd med anmärkning") or a verdict word with a note ("Godkänd · 1 avvikelse, åtgärdad").
     */
    decision(input: { label: string; choices?: readonly { text: string; checked: boolean }[]; word?: { text: string; tone?: KitColor }; note?: string; lines?: readonly string[] }) {
      const padX = mm(4);
      const inner = kit.frame.width - padX * 2;
      const wordLine = Math.max(14 * LEADING.head, TYPE.body * LEADING.body);
      const noteLines = input.note && !input.word ? wrap(regular, input.note, TYPE.body, inner) : [];
      const extraLines = (input.lines ?? []).flatMap((line) => wrap(regular, line, TYPE.body, inner));
      const height = mm(2.6) + TYPE.h3 * LEADING.head + (input.choices ? mm(1.5) + kit.choicesHeight(input.choices, inner, true) : 0) + (input.word ? mm(1) + wordLine : 0)
        + noteLines.length * TYPE.body * LEADING.body + extraLines.length * TYPE.body * LEADING.body + (extraLines.length ? mm(1.5) : 0) + mm(2.8);
      kit.ensure(height + mm(4));
      kit.roundedBox(kit.frame.x, kit.y, kit.frame.width, height, { fill: colors.white, border: colors.line });
      let y = kit.y - mm(2.6);
      y -= kit.text(input.label, kit.frame.x + padX, y, { size: TYPE.h3, leading: LEADING.head, bold: true, color: colors.navy, maxWidth: inner, maxLines: 1, ellipsis: true });
      if (input.choices) { y -= mm(1.5); y -= kit.drawChoices(input.choices, kit.frame.x + padX, y, inner, true); }
      if (input.word) {
        y -= mm(1);
        const wordWidth = bold.widthOfTextAtSize(input.word.text, 14);
        kit.text(input.word.text, kit.frame.x + padX, y, { size: 14, leading: wordLine / 14, bold: true, color: input.word.tone ?? colors.ink, maxWidth: inner, maxLines: 1 });
        if (input.note) kit.text(input.note, kit.frame.x + padX + wordWidth + mm(4), y, { size: TYPE.body, leading: wordLine / TYPE.body, maxWidth: inner - wordWidth - mm(4), maxLines: 1, ellipsis: true });
        y -= wordLine;
      } else if (noteLines.length) y -= kit.text(noteLines.join("\n"), kit.frame.x + padX, y, { size: TYPE.body, maxWidth: inner });
      if (extraLines.length) { y -= mm(1.5); kit.text(extraLines.join("\n"), kit.frame.x + padX, y, { size: TYPE.body, maxWidth: inner }); }
      kit.y -= height + mm(4);
      kit.gapBelow = mm(4);
      kit.last = "other";
    },

    /**
     * The signature block: for each signer a label, the name in bold with a short line ("Signerat 2026-11-03 09:14") on a
     * 10 mm line – empty when it is signed by hand – and the captions (Namnförtydligande · Datum) under it.
     */
    signatures(items: readonly KitSignature[], options: { cols?: 2 | 3 } = {}) {
      if (!items.length) return;
      const cols = options.cols ?? (items.length >= 3 ? 3 : 2);
      const gap = cols === 3 ? mm(8) : mm(10);
      const width = (kit.frame.width - gap * (cols - 1)) / cols;
      const labelLine = TYPE.label * LEADING.label;
      for (let index = 0; index < items.length; index += cols) {
        const row = items.slice(index, index + cols);
        const content = row.map((item) => (item.name ? TYPE.h3 * LEADING.table : 0) + (item.note ? wrap(regular, item.note, TYPE.small, width).length * TYPE.small * LEADING.table : 0) + mm(1));
        const lineBox = Math.max(mm(10), ...content);
        const height = labelLine + mm(1) + lineBox + RULE + mm(1) + labelLine;
        // Right under its heading the block has the design's 2 mm; after running text it needs more air to be read as its own.
        const above = kit.last === "section" || kit.last === "page" ? mm(2) : mm(4);
        kit.ensure(height + above + mm(3));
        if (index === 0) kit.space(above);
        row.forEach((item, column) => {
          const x = kit.frame.x + column * (width + gap);
          kit.text(item.label, x, kit.y, { size: TYPE.label, leading: LEADING.label, color: colors.muted, maxWidth: width, maxLines: 1, ellipsis: true });
          const lineY = kit.y - labelLine - mm(1) - lineBox;
          // Names and notes stand on the same lines across the row, whatever each signer has.
          let y = lineY + Math.max(...content);
          if (item.name) y -= kit.text(item.name, x, y, { size: TYPE.h3, leading: LEADING.table, bold: true, maxWidth: width, maxLines: 1, ellipsis: true });
          else if (row.some((other) => other.name)) y -= TYPE.h3 * LEADING.table;
          if (item.note) kit.text(item.note, x, y, { size: TYPE.small, leading: LEADING.table, color: colors.muted, maxWidth: width });
          kit.hairline(x, lineY, width, colors.ink);
          const caps = item.caps ?? [common.text("sign.name"), common.text("sign.date")];
          kit.text(caps[0], x, lineY - mm(1), { size: TYPE.label, leading: LEADING.label, color: colors.muted, maxWidth: width * 0.6, maxLines: 1, ellipsis: true });
          kit.text(caps[1], x, lineY - mm(1), { size: TYPE.label, leading: LEADING.label, color: colors.muted, maxWidth: width, align: "right", maxLines: 1 });
        });
        kit.y -= height + mm(3);
      }
      kit.gapBelow = mm(3);
      kit.last = "other";
    },

    /** Columns side by side (the matrix and its legend, two small tables): each draws from the same top; the flow continues under the taller. */
    columns(parts: readonly { width: number; draw: () => void }[], options: { gap?: number } = {}) {
      const gap = options.gap ?? mm(8);
      const frame = kit.frame;
      const top = kit.y;
      const page = kit.page;
      let x = frame.x;
      let lowest = top;
      for (const part of parts) {
        kit.frame = { x, width: part.width };
        kit.y = top;
        kit.last = "page";
        part.draw();
        lowest = kit.page === page ? Math.min(lowest, kit.y) : kit.y;
        x += part.width + gap;
      }
      kit.frame = frame;
      kit.y = lowest;
      kit.gapBelow = 0;
      kit.last = "other";
    },

    /**
     * The risk matrix: rows S (probability) from the top, columns K (consequence), 8,5 mm cells coloured by level – always
     * green, yellow, red, dark red from low to high – with white hairlines between them and the given numbers in the cells.
     * Returns the height; the caller sets the heading and the caption.
     */
    riskMatrix(input: { size: number; levelOf: (s: number, k: number) => number; cellText?: (s: number, k: number) => string; rowLabel?: string; colLabel?: string }) {
      const cell = mm(8.5);
      const axis = mm(7);
      const size = input.size;
      const height = (size + 1) * cell;
      kit.ensure(height);
      const top = kit.y;
      const left = kit.frame.x + axis;
      for (let s = size; s >= 1; s--) {
        const rowTop = top - (size - s) * cell;
        kit.text(`${input.rowLabel ?? "S"}${s}`, kit.frame.x, rowTop - (cell - TYPE.label * LEADING.label) / 2, { size: TYPE.label, leading: LEADING.label, bold: true, color: colors.muted, maxWidth: axis, align: "center", maxLines: 1 });
        for (let k = 1; k <= size; k++) {
          const level = Math.min(4, Math.max(1, input.levelOf(s, k)));
          const x = left + (k - 1) * cell;
          kit.page.drawRectangle({ x, y: rowTop - cell, width: cell, height: cell, color: RISK_COLORS[level - 1], borderColor: colors.white, borderWidth: RULE });
          const label = input.cellText?.(s, k) ?? "";
          if (label) kit.text(label, x, rowTop - (cell - TYPE.body * LEADING.body) / 2, { size: TYPE.body, bold: true, color: RISK_TEXT[level - 1], maxWidth: cell, align: "center", maxLines: 1 });
        }
      }
      const axisTop = top - size * cell;
      for (let k = 1; k <= size; k++) kit.text(`${input.colLabel ?? "K"}${k}`, left + (k - 1) * cell, axisTop - (cell - TYPE.label * LEADING.label) / 2, { size: TYPE.label, leading: LEADING.label, bold: true, color: colors.muted, maxWidth: cell, align: "center", maxLines: 1 });
      kit.y = top - height;
      kit.last = "other";
      return height;
    },

    /** The risk levels as marks with their meaning, one per line ("1–4 Låg  Åtgärda vid tillfälle"). */
    riskLegend(items: readonly { level: number; text: string; note: string }[]) {
      const markWidth = Math.max(...items.map((item) => MARK_SQUARE + mm(1.5) + bold.widthOfTextAtSize(item.text, TYPE.table)));
      const lineHeight = TYPE.table * LEADING.body;
      for (const item of items) {
        const noteWidth = kit.frame.width - markWidth - mm(4);
        const lines = item.note ? wrap(regular, item.note, TYPE.table, noteWidth).length : 1;
        kit.ensure(lines * lineHeight);
        kit.mark({ level: item.level, text: item.text }, kit.frame.x, kit.y, TYPE.table);
        if (item.note) kit.text(item.note, kit.frame.x + markWidth + mm(4), kit.y, { size: TYPE.table, maxWidth: noteWidth });
        kit.y -= lines * lineHeight + mm(1.8);
      }
      kit.last = "other";
    },

    /** The matrix and the legend side by side, as the safety round prints them: the matrix 58 mm wide to the left. */
    riskPanel(input: { size: number; levelOf: (s: number, k: number) => number; cellText?: (s: number, k: number) => string; caption: string; legend: readonly { level: number; text: string; note: string }[]; matrixTitle?: string; legendTitle?: string; rowLabel?: string; colLabel?: string }) {
      const matrixHeight = (input.size + 1) * mm(8.5);
      kit.ensure(mm(4.2) + TYPE.h2 * LEADING.head + mm(1.6) + matrixHeight + 2 * TYPE.small * LEADING.body + mm(3) + mm(4));
      if (kit.last !== "page" && kit.last !== "facts") kit.space(mm(4.2));
      kit.columns([
        { width: mm(58), draw: () => { kit.section(input.matrixTitle ?? common.text("risk.matrix")); kit.riskMatrix(input); kit.y -= mm(1.5); kit.paragraph(input.caption, { size: TYPE.small, color: colors.muted, after: 0 }); } },
        { width: kit.frame.width - mm(58) - mm(8), draw: () => { kit.section(input.legendTitle ?? common.text("risk.legend")); kit.riskLegend(input.legend); } },
      ]);
      kit.y -= mm(3);
      kit.gapBelow = mm(3);
    },

    /**
     * An object's block (the older card): a sub heading with the result word to the right, a dense facts grid, the comment and
     * a hairline. It stays whole when a page can hold it; `keepAfter` is room kept under it for what sums up the blocks.
     */
    object(card: KitObject, options: { cols?: 2 | 3 | 4; /** A blank form: every value a line to write on. */ blank?: boolean; keepAfter?: number } = {}) {
      kit.keep(() => kit.drawObject(card, options), options.keepAfter ?? 0);
    },
    drawObject(card: KitObject, options: { cols?: 2 | 3 | 4; blank?: boolean }) {
      const titleHeight = TYPE.h3 * LEADING.head + mm(1.5);
      kit.ensure(mm(4) + titleHeight + TYPE.label * LEADING.label + TYPE.body * LEADING.table + mm(4));
      if (kit.last !== "page" && kit.last !== "section") kit.space(mm(4));
      const boxed = card.result?.box ? BOX + mm(1.5) : 0;
      const resultWidth = card.result?.text ? bold.widthOfTextAtSize(card.result.text, TYPE.body) + boxed + mm(4) : 0;
      kit.text(card.title, kit.frame.x, kit.y, { size: TYPE.h3, leading: LEADING.head, bold: true, color: colors.navy, maxWidth: kit.frame.width - resultWidth, maxLines: 1, ellipsis: true });
      if (card.result?.text) kit.text(card.result.text, kit.frame.x, kit.y, { size: TYPE.body, leading: (TYPE.h3 * LEADING.head) / TYPE.body, bold: true, color: card.result.tone ?? colors.ink, maxWidth: kit.frame.width - boxed, align: "right", maxLines: 1 });
      if (card.result?.box) kit.checkbox(kit.frame.x + kit.frame.width - BOX, kit.y - (TYPE.h3 * LEADING.head - BOX) / 2, card.result.box);
      kit.y -= titleHeight;
      kit.last = "section";
      if (card.metrics.length) kit.facts(card.metrics.map((metric) => ({ label: metric.label, value: metric.value, tone: metric.tone, blank: options.blank })), { cols: options.cols ?? 4, after: mm(2) });
      if (card.comment !== null && card.comment.trim()) for (const line of card.comment.split("\n")) kit.paragraph(line, { after: mm(1) });
      kit.ensure(mm(2));
      // A divider divides what stands above from what follows: nothing to do right after a page break.
      if ((kit.last as Last) !== "page") {
        kit.y -= mm(1);
        kit.hairline(kit.frame.x, kit.y, kit.frame.width, colors.lineSoft);
        kit.y -= mm(2.5);
        kit.gapBelow = mm(2.5);
      }
      kit.last = "other";
    },

    /** Pictures two to a row with a caption under each (8,5 pt, muted), kept together with their caption; damaged ones are named. */
    async photos(images: readonly { bytes: Uint8Array; caption: string }[], options: { cols?: 1 | 2 | 3; maxHeight?: number } = {}) {
      const cols = options.cols ?? 2;
      const gap = mm(5);
      const cellWidth = (kit.frame.width - gap * (cols - 1)) / cols;
      const maxHeight = options.maxHeight ?? mm(45);
      for (let index = 0; index < images.length; index += cols) {
        const row = await Promise.all(images.slice(index, index + cols).map(async (item) => {
          try {
            if (!isPng(item.bytes) && !isJpeg(item.bytes)) return { item, image: null, size: null };
            // One embedding per picture, also when a block was measured first.
            let image = embedded.get(item.bytes);
            if (!image) { image = isPng(item.bytes) ? await pdf.embedPng(item.bytes) : await pdf.embedJpg(item.bytes); embedded.set(item.bytes, image); }
            return { item, image, size: image.scaleToFit(cellWidth, maxHeight) };
          } catch { return { item, image: null, size: null }; }
        }));
        const imageHeight = Math.max(...row.map((entry) => entry.size?.height ?? mm(6)));
        const captionLines = Math.max(...row.map((entry) => wrap(regular, entry.image ? entry.item.caption : common.text("image.failed", { bildtext: entry.item.caption }), TYPE.label, cellWidth).length));
        const height = imageHeight + mm(1) + Math.min(2, captionLines) * TYPE.label * LEADING.label;
        kit.ensure(height + mm(4));
        row.forEach((entry, column) => {
          const x = kit.frame.x + column * (cellWidth + gap);
          if (entry.image && entry.size) kit.page.drawImage(entry.image, { x, y: kit.y - entry.size.height, width: entry.size.width, height: entry.size.height });
          kit.text(entry.image ? entry.item.caption : common.text("image.failed", { bildtext: entry.item.caption }), x, kit.y - imageHeight - mm(1), { size: TYPE.label, leading: LEADING.label, color: colors.muted, maxWidth: cellWidth, maxLines: 2, ellipsis: true });
        });
        kit.y -= height + mm(4);
      }
      kit.gapBelow = mm(4);
      kit.last = "other";
    },

    /** Kommentarer (beslut 14, 2026-11-01): the comments chosen "Med i kundrapporten", with who wrote and when. Nothing is drawn without any. */
    customerComments(comments: readonly { authorName: string; body: string; createdAt: string }[]) {
      if (!comments.length) return;
      kit.section(common.text("section.comments"), { keep: 40 });
      for (const comment of comments) kit.block(`${comment.authorName} · ${formatSwedish(comment.createdAt, { dateStyle: "short", timeStyle: "short" })}`, comment.body.split(/\r?\n/).filter((line) => line.trim()));
    },

    /** "Bilagor": the numbered list of attached files. */
    attachmentList(files: readonly KitAttachment[], description?: string) {
      if (!files.length) return;
      kit.section(common.text("section.attachments"), { note: description ?? (files.length === 1 ? common.text("attachments.one") : common.text("attachments.many", { antal: files.length })), keep: 20 });
      for (const [index, file] of files.entries()) {
        kit.ensure(TYPE.body * LEADING.body);
        kit.text(`${index + 1}. ${file.filename} · ${file.label}`, kit.frame.x, kit.y, { maxLines: 1, ellipsis: true });
        kit.y -= TYPE.body * LEADING.body;
      }
      kit.y -= mm(3.5);
      kit.gapBelow = mm(3.5);
      kit.last = "other";
    },

    /** A part of its own (a task in a project report, an appendix): a new page with the small head, then the part's title at 20 pt and its note. */
    part(title: string, note?: string) {
      kit.addPage();
      kit.lastHeading = title;
      let titleSize = TYPE.h1;
      while (titleSize > 14 && bold.widthOfTextAtSize(title, titleSize) > kit.frame.width) titleSize -= 0.5;
      kit.y -= kit.text(fitFooterText(bold, title, kit.frame.width, titleSize), kit.frame.x, kit.y, { size: titleSize, leading: LEADING.head, bold: true, color: colors.navy, maxLines: 1 });
      if (note) { kit.y -= mm(0.5); kit.y -= kit.text(note, kit.frame.x, kit.y, { size: TYPE.small, color: colors.muted, maxLines: 2, ellipsis: true }); }
      kit.y -= mm(4.5);
      kit.gapBelow = mm(4.5);
      kit.last = "page";
    },

    /** The cover's title block (a project report): the family, the title at 26 pt and a line under it. */
    coverTitle(input: { kind: string; title: string; sub?: string }) {
      const titleLines = wrap(bold, input.title, 26, kit.frame.width).slice(0, 3);
      const height = mm(10) + TYPE.label * LEADING.body + mm(1) + titleLines.length * 26 * LEADING.head + mm(2) + (input.sub ? 12 * LEADING.body : 0) + mm(8);
      kit.ensure(height);
      kit.y -= mm(10);
      kit.y -= kit.text(input.kind, kit.frame.x, kit.y, { size: TYPE.label, color: colors.muted, maxLines: 1 });
      kit.y -= mm(1);
      kit.y -= kit.text(titleLines.join("\n"), kit.frame.x, kit.y, { size: 26, leading: LEADING.head, bold: true, color: colors.navy });
      kit.y -= mm(2);
      if (input.sub) kit.y -= kit.text(input.sub, kit.frame.x, kit.y, { size: 12, maxLines: 2, ellipsis: true });
      kit.y -= mm(8);
      kit.gapBelow = mm(8);
      kit.last = "facts";
    },

    /** A table of contents: number in the primary colour, the entry and a right-aligned note, on hairlines. */
    toc(rows: readonly { number: string; text: string; right?: string }[]) {
      // The number column is as wide as its longest number ("Bilaga A"), so every entry starts at the same place.
      const numberWidth = Math.max(mm(8), ...rows.map((row) => bold.widthOfTextAtSize(row.number, TYPE.body)));
      const gap = mm(3);
      for (const row of rows) {
        const rightWidth = row.right ? regular.widthOfTextAtSize(row.right, TYPE.body) : 0;
        const textWidth = kit.frame.width - numberWidth - gap - (rightWidth ? rightWidth + gap : 0);
        const lines = wrap(regular, row.text, TYPE.body, textWidth);
        const height = mm(1.8) * 2 + lines.length * TYPE.body * LEADING.body;
        kit.ensure(height);
        kit.text(row.number, kit.frame.x, kit.y - mm(1.8), { bold: true, color: colors.navy, maxWidth: numberWidth, maxLines: 1 });
        kit.text(lines.join("\n"), kit.frame.x + numberWidth + gap, kit.y - mm(1.8), { maxWidth: textWidth });
        if (row.right) kit.text(row.right, kit.frame.x, kit.y - mm(1.8), { maxWidth: kit.frame.width, align: "right", maxLines: 1 });
        kit.y -= height;
        kit.hairline(kit.frame.x, kit.y, kit.frame.width, colors.lineSoft);
      }
      kit.y -= mm(3.5);
      kit.gapBelow = mm(3.5);
      kit.last = "other";
    },

    /** A field to fill in by hand: the label and ruled lines 7,2 mm apart. */
    handLines(label: string, height = mm(14.4)) {
      const labelLine = TYPE.label * LEADING.label;
      kit.ensure(labelLine + mm(1) + height + mm(4));
      if (label) kit.y -= kit.text(label, kit.frame.x, kit.y, { size: TYPE.label, leading: LEADING.label, color: colors.muted, maxLines: 1, ellipsis: true }) + mm(1);
      for (let y = kit.y - mm(7.2); y >= kit.y - height - 0.1; y -= mm(7.2)) kit.hairline(kit.frame.x, y, kit.frame.width, colors.line);
      kit.y -= height + mm(4);
      kit.gapBelow = mm(4);
      kit.last = "other";
    },

    /** Every attached picture on its own page after the document; damaged pictures stay in the list only. */
    async attachmentPages(files: readonly (KitAttachment & { number: number })[]) {
      for (const file of files) {
        if (!file.bytes?.length || (!isJpeg(file.bytes) && !isPng(file.bytes))) continue;
        try {
          const image = isPng(file.bytes) ? await pdf.embedPng(file.bytes) : await pdf.embedJpg(file.bytes);
          kit.addPage();
          kit.y -= kit.text(common.text("attachment.page", { nr: file.number, fil: file.filename }), kit.frame.x, kit.y, { size: TYPE.h2, leading: LEADING.head, bold: true, color: colors.navy, maxLines: 1, ellipsis: true });
          kit.y -= mm(0.5);
          kit.y -= kit.text(file.label, kit.frame.x, kit.y, { size: TYPE.small, color: colors.muted, maxLines: 2, ellipsis: true });
          kit.y -= mm(4);
          const room = kit.y - BOTTOM;
          const dimensions = image.scaleToFit(kit.frame.width, room);
          kit.page.drawImage(image, { x: kit.frame.x + (kit.frame.width - dimensions.width) / 2, y: kit.y - dimensions.height, width: dimensions.width, height: dimensions.height });
          kit.y -= dimensions.height;
        } catch {
          // Damaged images remain visible in the attachment list.
        }
      }
    },

    /**
     * The footer on every page, two quiet lines over a hairline: the company in bold with org.nr, momsreg.nr and F-skatt,
     * "Sida n av N" to the right; then the document's own note and "Skapad i Workflow" with the date.
     */
    footer(options: { note?: string } = {}) {
      const pages = pdf.getPages();
      const date = formatSwedish(createdAt, { dateStyle: "short" });
      pages.forEach((page, index) => drawFooter(page, { regular, bold }, { company, legal, common, trace, page: index, second: [options.note ?? "", common.text("made", { datum: date })].filter(Boolean).join(" · "), pageCount: pages.length }));
    },
  };
  return kit;
}

/** The footer strip, shared with the project report's continuous footer (report-merge.ts). */
function drawFooter(page: PDFPage, faces: { regular: Face; bold: Face }, input: { company: string; legal: readonly string[]; common: PdfTexts; trace: PdfTrace | null; page: number; pageCount: number; second: string }) {
  const { regular, bold } = faces;
  const size = TYPE.foot;
  const lineHeight = size * LEADING.foot;
  const lineY = mm(10) + lineHeight * 2 + mm(2);
  page.drawLine({ start: { x: MARGIN, y: lineY }, end: { x: PAGE_WIDTH - MARGIN, y: lineY }, thickness: RULE, color: LINE_SOFT });
  const base = regular.baseline(size, LEADING.foot);
  const firstBaseline = lineY - mm(2) - base;
  const secondBaseline = firstBaseline - lineHeight;
  const pageText = input.common.text("page", { sida: input.page + 1, sidor: input.pageCount });
  const pageWidth = bold.widthOfTextAtSize(pageText, size);
  const draw = (face: Face, text: string, x: number, baseline: number, color: KitColor) => {
    let cursor = x;
    if (input.trace) traceLine(input.trace, face, text, x, baseline, size, { page: input.page, bold: face === bold, color, align: "left", footer: true });
    for (const run of face.runs(text)) { page.drawText(run.text, { x: cursor, y: baseline, size, font: run.font, color }); cursor += run.font.widthOfTextAtSize(run.text, size); }
    return cursor - x;
  };
  const room = CONTENT_WIDTH - pageWidth - mm(6);
  // The legal details matter more than the name, which the head already shows: a long line shortens the name first.
  const legalWidth = input.legal.length ? regular.widthOfTextAtSize(` · ${input.legal.join(" · ")}`, size) : 0;
  const companyText = fitFooterText(bold, input.company, Math.max(room * 0.2, Math.min(room * 0.6, room - legalWidth)), size);
  const companyWidth = bold.widthOfTextAtSize(companyText, size);
  const tail = input.legal.length ? fitFooterText(regular, ` · ${input.legal.join(" · ")}`, room - companyWidth, size) : "";
  draw(bold, companyText, MARGIN, firstBaseline, INK);
  if (tail) draw(regular, tail, MARGIN + companyWidth, firstBaseline, MUTED);
  draw(regular, fitFooterText(regular, input.second, CONTENT_WIDTH, size), MARGIN, secondBaseline, MUTED);
  // The page number is drawn last, so a page's text ends with "Sida n av N" (the tests read it there).
  draw(bold, pageText, PAGE_WIDTH - MARGIN - pageWidth, firstBaseline, INK);
}

/** The footer for pages drawn elsewhere (the merged project report): the same strip from the same faces. */
export async function stampFooter(pdf: PDFDocument, input: { fontBytes: ReportFontBytes; company: string; sender?: KitSender | null; second: string; templates?: readonly PdfTemplateOverride[] | null }) {
  pdf.registerFontkit(fontkit);
  const trace = traceOf(input.templates);
  const common = pdfTexts("common", input.templates);
  const { regular, bold } = await faces(pdf, input.fontBytes, Boolean(trace));
  const pages = pdf.getPages();
  // The strips the parts drew are painted over below; what the click targets said about them goes too.
  if (trace) trace.targets.splice(0, trace.targets.length, ...trace.targets.filter((target) => !target.footer));
  pages.forEach((page, index) => {
    const { width } = page.getSize();
    // The strip each part drew is painted over, hairline included, and drawn again with the running numbers.
    page.drawRectangle({ x: 0, y: 0, width, height: mm(10) + TYPE.foot * LEADING.foot * 2 + mm(2) + 1, color: WHITE });
    drawFooter(page, { regular, bold }, { company: input.company, legal: senderLegal(input.sender, common), common, trace, page: index, pageCount: pages.length, second: input.second });
  });
}

export type ReportKit = Awaited<ReturnType<typeof createReportKit>>;

const continuedSuffix = (common: PdfTexts) => ` · ${common.text("continued.suffix")}`;
/** The number line of a following page ("Offert O-1042 · fortsättning"): the kit keeps the word whole when it shortens the rest. */
export const continuationOf = (identity: KitIdentity, text: string) => `${text}${continuedSuffix(pdfTexts("common", identity.templates))}`;
