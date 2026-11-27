import fontkit from "@pdf-lib/fontkit";
import sharp, { type OverlayOptions } from "sharp";
import { BODY_MAX, checklistItems, HEADING_MAX, IMAGE_HEIGHT, IMAGE_WIDTH, isLogoSize, isLogoVariant, isTemplate, wrapText, type LogoSize, type PostTemplate } from "./text";

/**
 * Inläggets bild (2026-11-10; stående 4:5 sedan 2026-11-12): 1080 × 1350 px, drawn on the server from the post's heading and short text, the company's colour
 * and its logo, in one of the templates (POST_TEMPLATES). The letters are drawn as outlines from the app's own typeface (Manrope,
 * with DejaVu Sans for what Manrope lacks), so the picture looks the same on every server whatever fonts it has; sharp turns the
 * drawing into a JPEG (the format Instagram takes). No new library: the PDFs use the same typeface and fontkit.
 *
 * Fler mallar (2026-11-12): portrait 4:5 is Instagram's largest feed format and works on Facebook and LinkedIn too (LinkedIn
 * gets the same JPEG). Instagram's profile grid shows 3:4 tiles, so a square lost 135 px per side there and cut the text (
 * 2026-11-12); 4:5 loses 34 px, and text and logo keep SAFE_SIDE from the sides. Text colours are chosen against what lies behind
 * them for a contrast of at least 4.5:1 (planPost, checked by the tests).
 */
export { GRID_CROP, IMAGE_HEIGHT, IMAGE_WIDTH } from "./text";
/**
 * Text and logo keep this far from the left and right edges: Instagram's profile grid shows a 3:4 cut of a 4:5 post, 1012 of
 * 1080 px wide (34 px off each side), and the text keeps a margin inside that.
 */
export const SAFE_SIDE = 132;

/**
 * Även som story (2026-11-13): the same templates in 9:16, 1080 × 1920 – the format Instagram and Facebook recommend for a story.
 * The template's background fills the whole height and its content (text, decor, logo) stands as in the 4:5 picture, moved down
 * by STORY_OFFSET, so it lies wholly inside the story's safe zone: Instagram's own buttons and the progress bar cover about
 * STORY_SAFE px at the top and the bottom (not verified to the pixel, so the margin is kept generous).
 */
export type PostFormat = "feed" | "story";
export const STORY_HEIGHT = 1920;
export const STORY_SAFE = 250;
export const STORY_OFFSET = (STORY_HEIGHT - IMAGE_HEIGHT) / 2;
/** The picture's size in a format. */
export const formatSize = (format: PostFormat = "feed") => ({ width: IMAGE_WIDTH, height: format === "story" ? STORY_HEIGHT : IMAGE_HEIGHT });

/** The logo's variants (2026-11-13), each uploaded by the company under Företag; any may be missing. */
export type LogoFiles = { onDark?: Uint8Array | null; onLight?: Uint8Array | null; black?: Uint8Array | null };
export type PostBrand = { primary: string; companyName: string; logo: Uint8Array | null; logos?: LogoFiles };
export type PostFonts = { regular: Uint8Array; bold: Uint8Array; fallback?: Uint8Array | null };

type Glyph = { path: { toSVG(): string }; advanceWidth: number };
type Face = { unitsPerEm: number; hasGlyphForCodePoint(codePoint: number): boolean; glyphForCodePoint(codePoint: number): Glyph; layout(text: string): { glyphs: Glyph[]; positions: { xAdvance: number }[] } };
type Faces = { main: Face; fallback: Face };

const parsed = new WeakMap<Uint8Array, Face>();
const face = (bytes: Uint8Array) => {
  let found = parsed.get(bytes);
  if (!found) { found = fontkit.create(bytes) as unknown as Face; parsed.set(bytes, found); }
  return found;
};

/** Runs of the text that one face can draw (Manrope first, then DejaVu Sans; what neither has is left out). */
function runs(text: string, faces: Faces) {
  const out: { face: Face; text: string }[] = [];
  for (const char of text) {
    const code = char.codePointAt(0)!;
    const chosen = faces.main.hasGlyphForCodePoint(code) ? faces.main : faces.fallback.hasGlyphForCodePoint(code) ? faces.fallback : null;
    if (!chosen) continue;
    const last = out.at(-1);
    if (last?.face === chosen) last.text += char; else out.push({ face: chosen, text: char });
  }
  return out;
}

/** Widths at size 1, remembered per typeface: fitting tries many sizes and line breaks of the same words. */
const widths = new WeakMap<Face, Map<string, number>>();
function measure(text: string, faces: Faces, size: number) {
  let known = widths.get(faces.main);
  if (!known) { known = new Map(); widths.set(faces.main, known); }
  let unit = known.get(text);
  if (unit === undefined) {
    unit = 0;
    for (const run of runs(text, faces)) unit += run.face.layout(run.text).positions.reduce((sum, position) => sum + position.xAdvance, 0) / run.face.unitsPerEm;
    if (known.size > 20_000) known.clear();
    known.set(text, unit);
  }
  return unit * size;
}

const number = (value: number) => Number(value.toFixed(2));

/** One line as outlines, its baseline at y; `align` places it from x (left) or around x (center). */
function line(text: string, faces: Faces, size: number, x: number, y: number, fill: string, align: "left" | "center" = "left") {
  let cursor = align === "center" ? x - measure(text, faces, size) / 2 : x;
  const paths: string[] = [];
  for (const run of runs(text, faces)) {
    const scale = size / run.face.unitsPerEm;
    const laid = run.face.layout(run.text);
    laid.glyphs.forEach((glyph, index) => {
      const d = glyph.path.toSVG();
      if (d) paths.push(`<path transform="translate(${number(cursor)} ${number(y)}) scale(${scale.toFixed(6)} ${(-scale).toFixed(6)})" d="${d}"/>`);
      cursor += laid.positions[index].xAdvance * scale;
    });
  }
  return `<g fill="${fill}">${paths.join("")}</g>`;
}

/** A line cut with an ellipsis until it is no wider than `width`. */
function clamp(text: string, faces: Faces, size: number, width: number, ellipsis = false) {
  let value = ellipsis ? `${text.replace(/[\s,.;:–-]+$/, "")}…` : text;
  while (measure(value, faces, size) > width && value.length > 1) value = `${value.slice(0, -2).replace(/[\s,.;:–-]+$/, "")}…`;
  return value;
}

/**
 * The biggest size from `sizes` at which the text fits in `maxLines` lines of `width` (`maxLines` may depend on the size); at the
 * last size the lines are cut and the last one ends with an ellipsis. No line is ever wider than `width`.
 */
function fit(text: string, faces: Faces, width: number, sizes: number[], maxLines: number | ((size: number) => number)) {
  const most = (size: number) => Math.max(1, typeof maxLines === "number" ? maxLines : maxLines(size));
  for (const size of sizes) {
    const lines = wrapText(text, width, (value) => measure(value, faces, size));
    if (lines.length <= most(size) && lines.every((value) => measure(value, faces, size) <= width)) return { size, lines, cut: false };
  }
  const size = sizes.at(-1)!;
  const all = wrapText(text, width, (value) => measure(value, faces, size));
  const lines = all.slice(0, most(size)).map((value, index, kept) => clamp(value, faces, size, width, index === kept.length - 1 && all.length > kept.length));
  return { size, lines, cut: true };
}

// ---------- colours ----------

const HEX = /^#([0-9a-f]{6})$/i;
export const brandColour = (value: string | null | undefined, fallback = "#174C72") => (value && HEX.test(value.trim()) ? value.trim().toUpperCase() : fallback);
const channels = (hex: string) => [1, 3, 5].map((at) => parseInt(hex.slice(at, at + 2), 16));
/** Relative luminance (WCAG). */
export function luminance(hex: string) {
  const [r, g, b] = channels(hex).map((value) => { const c = value / 255; return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}
/** WCAG contrast ratio of two colours (1–21). */
export function contrast(a: string, b: string) {
  const [high, low] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (high + 0.05) / (low + 0.05);
}
const DARK_TEXT = "#0F172A";
/** White or near-black on the colour, whichever reads better. */
export const textOn = (hex: string) => (contrast("#FFFFFF", hex) >= contrast(DARK_TEXT, hex) ? "#FFFFFF" : DARK_TEXT);
const mix = (hex: string, other: string, amount: number) => `#${channels(hex).map((value, index) => Math.round(value + (channels(other)[index] - value) * amount).toString(16).padStart(2, "0")).join("")}`.toUpperCase();
/** The colour itself when it reads on `background` at `ratio`, otherwise the nearest shade of it that does (darker on light, lighter on dark). */
export function readable(hex: string, background: string, ratio = 4.5) {
  const toward = luminance(background) > 0.18 ? "#000000" : "#FFFFFF";
  for (let step = 0; step <= 20; step += 1) {
    const value = mix(hex, toward, step / 20);
    if (contrast(value, background) >= ratio) return value;
  }
  return toward;
}
/** The colour as a surface for text: itself when white or near-black reads on it at 4.5:1, otherwise a darker shade (rare). */
export function surfaceOf(hex: string) {
  for (let step = 0; step <= 20; step += 1) {
    const value = mix(hex, "#000000", step / 20);
    if (contrast(textOn(value), value) >= 4.5) return value;
  }
  return "#000000";
}
const DARK_BACKGROUND = "#0F172A";
const BODY_GREY = "#334155";
/** Vit, Blå och Svart (2026-11-13): fixed backgrounds, the same for every company; the company's colour is only an accent. */
const BLUE_BACKGROUND = "#1E3A8A";
const BLACK_BACKGROUND = "#000000";

// ---------- the plan: what is drawn where ----------

type Area = { x: number; y: number; width: number; height: number };
/** A text block: its lines, where they stand, and the colour behind them (for the contrast check). */
export type TextBlock = { role: "heading" | "body" | "label" | "name"; lines: string[]; size: number; bold: boolean; x: number; top: number; lineHeight: number; fill: string; behind: string; align: "left" | "center"; width: number; bottom: number; cut: boolean };
export type PostPlan = { template: PostTemplate; background: string; decor: string; texts: TextBlock[]; logo: { area: Area; plate: string | null; behind: string } };

/** `height`: the canvas (1350 or 1920); `offset`: how far down the 4:5 content stands on it (0 or STORY_OFFSET). */
type Ctx = { primary: string; image: boolean; heading: string; body: string; bold: Faces; regular: Faces; height: number; offset: number };

const X = IMAGE_WIDTH;
const Y = IMAGE_HEIGHT;
const M = SAFE_SIDE;
const W = X - 2 * M;
const HEADING_SIZES = [104, 96, 88, 80, 72, 64, 58, 54];
const BODY_SIZES = [44, 40, 36, 32, 30];
/** The logo's place: 340 × 120 with its bottom 130 px above the lower edge unless told otherwise. */
const logoAt = (y = Y - 250, x = M): Area => ({ x, y, width: 340, height: 120 });
/**
 * Logga liten, mellan, stor (2026-11-13): the box the logo fits inside, its bottom-left corner where the template put it.
 * Mellan is the template's own; Stor grows mostly in width and at most 30 px upwards, so the text above keeps its room.
 */
export const LOGO_BOX: Record<LogoSize, { width: number; height: number }> = { small: { width: 240, height: 84 }, medium: { width: 340, height: 120 }, large: { width: 480, height: 150 } };
function sizedLogo(area: Area, size: LogoSize): Area {
  const box = LOGO_BOX[size];
  return { x: area.x, y: area.y + area.height - box.height, width: box.width, height: box.height };
}

export type LogoKind = "main" | "onDark" | "onLight" | "black";

/**
 * Which logo the picture uses (2026-11-13), pure: Automatiskt takes the variant made for what lies behind the logo – Logga för
 * mörk bakgrund on a dark one, Logga för ljus bakgrund (else Logga i svart) on a light one – and the logo itself when that variant
 * is missing (and any variant that exists when even the logo is missing). A chosen variant that the company has not uploaded is read as Automatiskt. The plate: the logo itself keeps the
 * template's own (a white plate on a dark background); a variant on the background it was made for stands without one, and on the
 * other kind of background it gets a plate it reads on. `plateChoice` none (Bakgrund bakom logotypen Ingen, 2026-11-15): never a
 * plate. Null when there is no logo at all.
 */
export function pickLogo(behind: string, available: Record<LogoKind, boolean>, choice: string | null | undefined, mainPlate: string | null, plateChoice?: string | null): { variant: LogoKind; plate: string | null } | null {
  const dark = textOn(behind) === "#FFFFFF";
  const wanted = choice && isLogoVariant(choice) ? choice : "auto";
  // The variant made for the background first, then the logo itself, then whatever exists (on a plate).
  const order: LogoKind[] = dark ? ["onDark", "main", "onLight", "black"] : ["onLight", "black", "main", "onDark"];
  const automatic = () => order.find((kind) => available[kind]) ?? null;
  const variant = wanted !== "auto" && available[wanted] ? wanted : automatic();
  if (!variant) return null;
  // Bakgrund bakom logotypen Ingen (2026-11-15): whichever variant, straight on the template.
  if (plateChoice === "none") return { variant, plate: null };
  if (variant === "main") return { variant, plate: mainPlate };
  if (variant === "onDark") return { variant, plate: dark ? null : DARK_BACKGROUND };
  return { variant, plate: dark ? "#FFFFFF" : null };
}

/** A wrapped text block from `top` within `width`, at the biggest size that fits above `limit` (and in `maxLines`). */
function block(ctx: Ctx, role: TextBlock["role"], text: string, at: { x: number; top: number; width: number; limit: number }, sizes: number[], maxLines: number, colours: { fill: string; behind: string }, options: { bold?: boolean; lineHeight?: number; align?: "left" | "center" } = {}): TextBlock {
  const bold = options.bold ?? role !== "body";
  const faces = bold ? ctx.bold : ctx.regular;
  const factor = options.lineHeight ?? (role === "body" ? 1.35 : 1.12);
  // n lines take a size, n − 1 line heights and a descender below the top.
  const room = (size: number) => Math.min(maxLines, Math.floor((at.limit - at.top - size * 1.25) / (size * factor) + 1.001));
  const fitted = fit(text, faces, at.width, sizes, (size) => Math.max(1, room(size)));
  const lineHeight = fitted.size * factor;
  const width = Math.max(0, ...fitted.lines.map((value) => measure(value, faces, fitted.size)));
  const bottom = at.top + fitted.size + (fitted.lines.length - 1) * lineHeight + fitted.size * 0.25;
  return { role, lines: fitted.lines, size: fitted.size, bold, x: at.x, top: at.top, lineHeight, fill: colours.fill, behind: colours.behind, align: options.align ?? "left", width, bottom, cut: fitted.cut };
}

const see = (opacity: number, image: boolean) => (image ? ` fill-opacity="${opacity}"` : "");

/** Heading then body below it, down to `limit` – the shape most templates share. */
function stack(ctx: Ctx, top: number, limit: number, colours: { heading: string; body: string; behind: string }, x = M, width = W, headingSizes = HEADING_SIZES, headingLines = 4) {
  // The heading as big as it can be while the whole text still fits below it; else the smallest heading.
  let texts: TextBlock[] = [];
  for (let first = 0; first < headingSizes.length; first += 1) {
    const heading = block(ctx, "heading", ctx.heading, { x, top, width, limit: limit - (ctx.body ? 120 : 0) }, headingSizes.slice(first), headingLines, { fill: colours.heading, behind: colours.behind });
    texts = [heading];
    if (!ctx.body) break;
    const body = block(ctx, "body", ctx.body, { x, top: heading.bottom + 30, width, limit }, BODY_SIZES, 6, { fill: colours.body, behind: colours.behind });
    texts.push(body);
    if (!body.cut) break;
  }
  return texts;
}

/** A check mark in a filled circle, drawn as paths (no glyph needed). */
const check = (cx: number, cy: number, r: number, fill: string, stroke: string) =>
  `<circle cx="${cx}" cy="${cy}" r="${r}" fill="${fill}"/><path d="M ${number(cx - r * 0.42)} ${number(cy + r * 0.02)} L ${number(cx - r * 0.1)} ${number(cy + r * 0.34)} L ${number(cx + r * 0.45)} ${number(cy - r * 0.3)}" fill="none" stroke="${stroke}" stroke-width="${number(r * 0.2)}" stroke-linecap="round" stroke-linejoin="round"/>`;

/**
 * The backgrounds are drawn on the whole canvas (height H); the decor, the texts and the logo in the 4:5 content's coordinates,
 * which planPost moves down by the offset T. Decor that meets the canvas's edge reaches -T (the top) or Y + T (the bottom).
 */
function planOf(template: PostTemplate, ctx: Ctx): PostPlan {
  const { primary, image } = ctx;
  const H = ctx.height;
  const T = ctx.offset;
  const full = (fill: string, extra = "") => `<rect width="${X}" height="${H}" fill="${fill}"${extra}/>`;
  const surface = surfaceOf(primary);
  const on = textOn(surface);
  const soft = mix(primary, "#FFFFFF", 0.9);
  const plateOn = (behind: string) => (textOn(behind) === "#FFFFFF" ? "#FFFFFF" : null);
  const shade = image ? full("#000000", ` fill-opacity="0.18"`) : "";
  switch (template) {
    case "light": {
      const ink = readable(primary, "#FFFFFF");
      return { template, background: `${full("#FFFFFF", see(0.86, image))}<rect width="${X}" height="28" fill="${primary}"/>`,
        decor: `<rect x="${M}" y="${Y - 340}" width="120" height="10" rx="5" fill="${primary}"/>`,
        texts: stack(ctx, 220, Y - 370, { heading: ink, body: BODY_GREY, behind: "#FFFFFF" }), logo: { area: logoAt(), plate: null, behind: "#FFFFFF" } };
    }
    case "frame": {
      const ink = readable(primary, "#FFFFFF");
      return { template, background: `${full(primary, see(0.35, image))}<rect x="56" y="56" width="${X - 112}" height="${H - 112}" rx="36" fill="#FFFFFF"${see(0.9, image)}/>`,
        decor: "", texts: stack(ctx, 230, Y - 330, { heading: ink, body: BODY_GREY, behind: "#FFFFFF" }), logo: { area: logoAt(Y - 290), plate: null, behind: "#FFFFFF" } };
    }
    case "split": {
      const top = 720;
      const heading = block(ctx, "heading", ctx.heading, { x: M, top: 160, width: W, limit: top - 70 }, HEADING_SIZES, 5, { fill: on, behind: surface });
      const texts = [heading];
      if (ctx.body) texts.push(block(ctx, "body", ctx.body, { x: M, top: top + 80, width: W, limit: Y - 290 }, BODY_SIZES, 5, { fill: "#1E293B", behind: soft }));
      return { template, background: `${image ? `<rect width="${X}" height="${top + T}" fill="#000000" fill-opacity="0.18"/>` : full("#FFFFFF")}<rect width="${X}" height="${top + T}" fill="${surface}"${see(0.8, image)}/><rect y="${top + T}" width="${X}" height="${H - top - T}" fill="${soft}"/>`,
        decor: "", texts, logo: { area: logoAt(Y - 240), plate: null, behind: soft } };
    }
    case "tips": {
      // A round "Tips" badge, the heading and text on a light tint of the colour.
      const ink = readable(primary, soft);
      const label = block(ctx, "label", "Tips", { x: M + 90, top: 250, width: 150, limit: 360 }, [46, 40, 34], 1, { fill: on, behind: surface }, { align: "center" });
      return { template, background: full(soft, see(0.9, image)),
        decor: `<circle cx="${X - 40}" cy="${Y - 100 + T}" r="320" fill="${primary}" fill-opacity="0.12"/><circle cx="${M + 90}" cy="282" r="90" fill="${surface}"/>`,
        texts: [label, ...stack(ctx, 440, Y - 300, { heading: ink, body: BODY_GREY, behind: soft })], logo: { area: logoAt(), plate: null, behind: soft } };
    }
    case "figure": {
      // The heading as a key figure, very large, and the text explaining it below a short rule.
      const heading = block(ctx, "heading", ctx.heading, { x: M, top: 190, width: W, limit: ctx.body ? 860 : Y - 320 }, [260, 230, 200, 176, 156, 136, 118, 104, 92, 80, 70, 62], 4, { fill: on, behind: surface }, { lineHeight: 1.04 });
      const texts = [heading];
      let decor = `<rect x="${M}" y="${number(heading.bottom + 36)}" width="140" height="12" rx="6" fill="${on}" fill-opacity="0.55"/>`;
      if (ctx.body) texts.push(block(ctx, "body", ctx.body, { x: M, top: heading.bottom + 86, width: W, limit: Y - 300 }, [48, 44, 40, 36, 32, 30], 5, { fill: on, behind: surface }));
      else decor = "";
      return { template, background: `${shade}${full(surface, see(0.82, image))}`, decor, texts, logo: { area: logoAt(), plate: plateOn(surface), behind: surface } };
    }
    case "quote": {
      // A large quotation mark; the text is the quote and the heading who said it (or the heading is the quote when there is no text).
      const ink = readable(primary, "#FFFFFF");
      const quote = ctx.body || ctx.heading;
      const by = ctx.body ? ctx.heading : "";
      const limit = Y - 300 - (by ? 160 : 0);
      const said = block(ctx, "heading", quote, { x: M, top: 440, width: W, limit }, [72, 66, 60, 54, 48, 42, 38], 8, { fill: "#0F172A", behind: "#FFFFFF" }, { lineHeight: 1.2 });
      const texts = [said];
      if (by) texts.push(block(ctx, "label", `– ${by}`, { x: M, top: said.bottom + 44, width: W, limit: Y - 300 }, [40, 36, 32, 30], 2, { fill: ink, behind: "#FFFFFF" }));
      const mark = line("“", ctx.bold, 440, M - 14, 560, primary);
      return { template, background: `${full("#FFFFFF", see(0.9, image))}<rect y="${H - 28}" width="${X}" height="28" fill="${primary}"/>`,
        decor: mark, texts, logo: { area: logoAt(), plate: null, behind: "#FFFFFF" } };
    }
    case "news": {
      // A "Nytt" tab hanging from the top edge.
      const ink = readable(primary, "#FFFFFF");
      const label = block(ctx, "label", "Nytt", { x: M + 100, top: 96, width: 170, limit: 180 }, [48, 42, 36], 1, { fill: on, behind: surface }, { align: "center" });
      return { template, background: full("#FFFFFF", see(0.88, image)),
        decor: `<path d="M ${M} ${-T} H ${M + 200} V 178 a 26 26 0 0 1 -26 26 H ${M + 26} a 26 26 0 0 1 -26 -26 Z" fill="${surface}"/><rect x="${M}" y="${Y - 340}" width="${W}" height="4" rx="2" fill="${primary}" fill-opacity="0.35"/>`,
        texts: [label, ...stack(ctx, 310, Y - 370, { heading: ink, body: BODY_GREY, behind: "#FFFFFF" })], logo: { area: logoAt(), plate: null, behind: "#FFFFFF" } };
    }
    case "checklist": {
      // The text's lines (or sentences) as up to four ticked rows below the heading.
      const ink = readable(primary, soft);
      const items = checklistItems(ctx.body);
      const heading = block(ctx, "heading", ctx.heading, { x: M, top: 190, width: W, limit: items.length ? 660 : Y - 320 }, [88, 80, 72, 64, 58, 52, 48], items.length ? 4 : 5, { fill: ink, behind: soft });
      const limit = Y - 300;
      // One size for every row: the biggest at which every row fits in two lines (three at the smaller sizes) and all rows stay above the logo.
      let rows: TextBlock[] = [];
      for (const size of [50, 46, 42, 38, 34, 30]) {
        rows = [];
        let top = heading.bottom + 70;
        for (const item of items) {
          const row = block(ctx, "body", item, { x: M + 100, top, width: W - 100, limit: Y }, [size], 3, { fill: BODY_GREY, behind: soft }, { lineHeight: 1.3 });
          rows.push(row);
          top = row.bottom + 40;
        }
        const whole = items.every((item) => wrapText(item, W - 100, (value) => measure(value, ctx.regular, size)).length <= (size > 38 ? 2 : 3));
        if (whole && (rows.at(-1)?.bottom ?? 0) <= limit) break;
      }
      rows = rows.filter((row) => row.bottom <= limit);
      const decor = rows.map((row) => check(M + 34, number(row.top + row.size * 0.62), 34, surface, on)).join("");
      return { template, background: full(soft, see(0.9, image)), decor, texts: [heading, ...rows], logo: { area: logoAt(), plate: null, behind: soft } };
    }
    case "dark": {
      // Dark navy with the colour as an accent; white heading.
      const accent = readable(primary, DARK_BACKGROUND, 3);
      return { template, background: full(DARK_BACKGROUND, see(0.84, image)),
        decor: `<circle cx="${X - 40}" cy="${80 - T}" r="360" fill="${accent}" fill-opacity="0.16"/><rect x="${M}" y="200" width="140" height="14" rx="7" fill="${accent}"/>`,
        texts: stack(ctx, 270, Y - 300, { heading: "#FFFFFF", body: "#CBD5E1", behind: DARK_BACKGROUND }), logo: { area: logoAt(), plate: "#FFFFFF", behind: DARK_BACKGROUND } };
    }
    case "band": {
      // The colour above a diagonal edge, a lighter stripe along it, white below with the logo.
      const stripe = mix(surface, "#FFFFFF", 0.55);
      const texts = stack(ctx, 170, 820, { heading: on, body: on, behind: surface });
      return { template, background: `${shade}${full(surface, see(0.82, image))}`,
        decor: `<polygon points="0,1015 ${X},835 ${X},875 0,1055" fill="${stripe}"/><polygon points="0,1070 ${X},890 ${X},${Y + T} 0,${Y + T}" fill="#FFFFFF"/>`,
        texts, logo: { area: logoAt(Y - 230), plate: null, behind: "#FFFFFF" } };
    }
    case "reminder": {
      // A calendar block and "Påminnelse" above the heading.
      const ink = readable(primary, "#FFFFFF");
      const x = M;
      const y = 180;
      const label = block(ctx, "label", "Påminnelse", { x: M + 210, top: y + 38, width: W - 210, limit: y + 140 }, [46, 42, 38], 1, { fill: ink, behind: "#FFFFFF" });
      const dots = [0, 1, 2].flatMap((column) => [0, 1].map((row) => `<circle cx="${x + 42 + column * 43}" cy="${y + 92 + row * 40}" r="11" fill="${column === 2 && row === 1 ? surface : mix(primary, "#FFFFFF", 0.55)}"/>`)).join("");
      return { template, background: `${full("#FFFFFF", see(0.9, image))}<rect y="${H - 28}" width="${X}" height="28" fill="${primary}"/>`,
        decor: `<rect x="${x}" y="${y}" width="170" height="170" rx="28" fill="${soft}" stroke="${surface}" stroke-width="6"/><path d="M ${x} ${y + 28} a 28 28 0 0 1 28 -28 h 114 a 28 28 0 0 1 28 28 v 34 h -170 Z" fill="${surface}"/><rect x="${x + 44}" y="${y - 18}" width="14" height="40" rx="7" fill="${BODY_GREY}"/><rect x="${x + 112}" y="${y - 18}" width="14" height="40" rx="7" fill="${BODY_GREY}"/>${dots}`,
        texts: [label, ...stack(ctx, 440, Y - 300, { heading: "#0F172A", body: BODY_GREY, behind: "#FFFFFF" })], logo: { area: logoAt(), plate: null, behind: "#FFFFFF" } };
    }
    case "white": {
      // Plain white, near-black heading; the company's colour only as a short rule above it.
      const accent = readable(primary, "#FFFFFF", 3);
      return { template, background: full("#FFFFFF", see(0.9, image)),
        decor: `<rect x="${M}" y="200" width="140" height="14" rx="7" fill="${accent}"/>`,
        texts: stack(ctx, 270, Y - 300, { heading: "#0F172A", body: BODY_GREY, behind: "#FFFFFF" }), logo: { area: logoAt(), plate: null, behind: "#FFFFFF" } };
    }
    case "blue": {
      // A fixed deep blue with white text, a soft circle and a white rule (the same shape as Mörk).
      return { template, background: `${shade}${full(BLUE_BACKGROUND, see(0.84, image))}`,
        decor: `<circle cx="${X - 40}" cy="${80 - T}" r="360" fill="#FFFFFF" fill-opacity="0.08"/><rect x="${M}" y="200" width="140" height="14" rx="7" fill="#FFFFFF"/>`,
        texts: stack(ctx, 270, Y - 300, { heading: "#FFFFFF", body: "#DBEAFE", behind: BLUE_BACKGROUND }), logo: { area: logoAt(), plate: "#FFFFFF", behind: BLUE_BACKGROUND } };
    }
    case "black": {
      // Black with white text; the company's colour as the rule when it reads on black.
      const accent = readable(primary, BLACK_BACKGROUND, 3);
      return { template, background: `${shade}${full(BLACK_BACKGROUND, see(0.84, image))}`,
        decor: `<rect x="${M}" y="200" width="140" height="14" rx="7" fill="${accent}"/>`,
        texts: stack(ctx, 270, Y - 300, { heading: "#FFFFFF", body: "#D4D4D4", behind: BLACK_BACKGROUND }), logo: { area: logoAt(), plate: "#FFFFFF", behind: BLACK_BACKGROUND } };
    }
    default: {
      return { template, background: `${shade}${full(surface, see(0.8, image))}<circle cx="${X - 60}" cy="90" r="300" fill="${on}" fill-opacity="0.07"/>`,
        decor: "", texts: stack(ctx, 210, Y - 300, { heading: on, body: on, behind: surface }), logo: { area: logoAt(), plate: plateOn(surface), behind: surface } };
    }
  }
}

/**
 * `logoVariant` and `logoSize` (2026-11-13): the post's own choice; missing is Automatiskt and Mellan. `logoPlate` (2026-11-15):
 * box (Ruta) or none (Ingen); missing is Ruta.
 */
export type PostImageInput = { heading: string; body: string; template: string; logoVariant?: string | null; logoSize?: string | null; logoPlate?: string | null };

const facesOf = (fonts: PostFonts) => ({ bold: { main: face(fonts.bold), fallback: face(fonts.fallback ?? fonts.bold) }, regular: { main: face(fonts.regular), fallback: face(fonts.fallback ?? fonts.regular) } });

/**
 * What the picture holds and where (pure apart from reading the fonts): the backgrounds, the text blocks with their colours and
 * what lies behind them, and the logo's place. `withName`: the company's name is drawn where the logo goes (no logo).
 */
export function planPost(input: PostImageInput, brand: Pick<PostBrand, "primary" | "companyName">, fonts: PostFonts, options: { image?: boolean; withName?: boolean; format?: PostFormat } = {}): PostPlan {
  const { bold, regular } = facesOf(fonts);
  const template = isTemplate(input.template) ? input.template : "color";
  const ctx: Ctx = { primary: brandColour(brand.primary), image: Boolean(options.image), heading: input.heading.slice(0, HEADING_MAX).trim() || " ", body: input.body.slice(0, BODY_MAX).trim(), bold, regular,
    height: formatSize(options.format).height, offset: options.format === "story" ? STORY_OFFSET : 0 };
  const plan = planOf(template, ctx);
  plan.logo = { ...plan.logo, area: sizedLogo(plan.logo.area, input.logoSize && isLogoSize(input.logoSize) ? input.logoSize : "medium"),
    // Bakgrund bakom logotypen Ingen (2026-11-15): the template's plate is left out; anything else (or nothing) keeps it.
    plate: input.logoPlate === "none" ? null : plan.logo.plate };
  const name = brand.companyName.trim();
  if (options.withName && name) {
    const area = plan.logo.area;
    // Without a logo the name stands on the background itself (no plate).
    const behind = plan.logo.behind;
    const fill = textOn(behind) === "#FFFFFF" ? "#FFFFFF" : readable(ctx.primary, behind);
    const sized = fit(name, bold, area.width + 300, [40, 34, 30], 1);
    plan.texts.push({ role: "name", cut: sized.cut, lines: sized.lines, size: sized.size, bold: true, x: area.x, top: area.y + area.height - 20 - sized.size, lineHeight: sized.size, fill, behind, align: "left", width: measure(sized.lines[0] ?? "", bold, sized.size), bottom: area.y + area.height - 20 + sized.size * 0.25 });
  }
  // A story: the content moves down onto the taller canvas (the backgrounds are already drawn on it).
  if (ctx.offset) {
    const T = ctx.offset;
    plan.decor = plan.decor ? `<g transform="translate(0 ${T})">${plan.decor}</g>` : "";
    plan.texts = plan.texts.map((text) => ({ ...text, top: text.top + T, bottom: text.bottom + T }));
    plan.logo = { ...plan.logo, area: { ...plan.logo.area, y: plan.logo.area.y + T } };
  }
  return plan;
}

/**
 * The picture as JPEG bytes. `background`: a picture (any size) behind the template, under the template's own colours
 * (see-through) so the heading and the text stay readable.
 */
export async function renderPostImage(input: PostImageInput, brand: PostBrand, fonts: PostFonts, background?: Uint8Array | null, format: PostFormat = "feed"): Promise<Buffer> {
  const { bold, regular } = facesOf(fonts);
  const size = formatSize(format);
  const base = background ? await sharp(Buffer.from(background), { limitInputPixels: 60_000_000 }).rotate().resize(size.width, size.height, { fit: "cover" }).png().toBuffer().catch(() => null) : null;

  // The logo (inside its area; the variant that reads on what lies behind it, pickLogo), or the company's name when there is none.
  let logo: { data: Buffer; width: number; height: number; plate: string | null } | null = null;
  const files: Record<LogoKind, Uint8Array | null> = { main: brand.logo, onDark: brand.logos?.onDark ?? null, onLight: brand.logos?.onLight ?? null, black: brand.logos?.black ?? null };
  const probe = planPost(input, brand, fonts, { image: Boolean(base), format });
  let available: Record<LogoKind, boolean> = { main: Boolean(files.main), onDark: Boolean(files.onDark), onLight: Boolean(files.onLight), black: Boolean(files.black) };
  // A file that cannot be read counts as missing, and the next choice is tried.
  for (let tries = 0; tries < 4 && !logo; tries += 1) {
    const chosen = pickLogo(probe.logo.behind, available, input.logoVariant, probe.logo.plate, input.logoPlate);
    if (!chosen) break;
    try {
      const pad = chosen.plate ? 22 : 0;
      const resized = await sharp(Buffer.from(files[chosen.variant]!), { limitInputPixels: 40_000_000 }).resize({ width: probe.logo.area.width - pad * 2, height: probe.logo.area.height - pad * 2, fit: "inside", withoutEnlargement: false }).png().toBuffer({ resolveWithObject: true });
      logo = { data: resized.data, width: resized.info.width, height: resized.info.height, plate: chosen.plate };
    } catch { available = { ...available, [chosen.variant]: false }; }
  }
  const plan = planPost(input, brand, fonts, { image: Boolean(base), withName: !logo, format });
  const parts: string[] = [];
  for (const text of plan.texts) {
    const faces = text.bold ? bold : regular;
    text.lines.forEach((value, index) => parts.push(line(value, faces, text.size, text.x,text.top + text.size + index * text.lineHeight, text.fill, text.align)));
  }
  const composites: OverlayOptions[] = [];
  if (logo) {
    const area = plan.logo.area;
    const pad = logo.plate ? 22 : 0;
    if (logo.plate) parts.push(`<rect x="${area.x}" y="${area.y + area.height - logo.height - pad * 2}" width="${logo.width + pad * 2}" height="${logo.height + pad * 2}" rx="20" fill="${logo.plate}"/>`);
    composites.push({ input: logo.data, left: area.x + pad, top: area.y + area.height - logo.height - pad });
  }

  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${size.width}" height="${size.height}" viewBox="0 0 ${size.width} ${size.height}">${plan.background}${plan.decor}${parts.join("")}</svg>`;
  const canvas = base ? sharp(base).composite([{ input: Buffer.from(svg), left: 0, top: 0 }, ...composites]) : sharp(Buffer.from(svg)).composite(composites);
  return sharp(await canvas.png().toBuffer()).flatten({ background: "#FFFFFF" }).jpeg({ quality: 90, chromaSubsampling: "4:4:4" }).toBuffer();
}

/** For the tests: a text block's left and right edges (a centred block stands around its x). */
export const blockEdges = (text: TextBlock) => (text.align === "center" ? { left: text.x - text.width / 2, right: text.x + text.width / 2 } : { left: text.x, right: text.x + text.width });
