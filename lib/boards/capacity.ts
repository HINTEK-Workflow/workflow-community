import { GRID_COLUMNS, type Orientation } from "./grid";
import { cardDefinition, DISTANCE, MAX_CARDS, type BoardCard, type BoardLayout, type CardType, type Distance } from "./model";

/**
 * Hur mycket ryms läsbart (2026-11-20: "Räkna ut hur många kort du får plats maximalt per skärmstorlek, varna användaren om det
 * är för liten text eller för stor text"). For each screen of Förhandsgranska and each Avstånd: the text size a card gets there – the
 * same formula as app/globals.css .board-card, so the warning and the screen agree – the smallest text that can still be read at
 * that distance, and how many cards of the smallest readable size fit. The editor warns from it (features/boards/board-editor.tsx)
 * and never stops a publication. Pure; tests/boards-capacity.test.ts holds the table.
 *
 * The readable size is a rule of thumb, not a standard and not a promise for every eye: text whose letters (the CSS font size) are
 * about 1/300 of the reading distance can be read by someone with normal sight; about 1/200 is comfortable, and signage advice for a
 * quick glance is larger still. We warn below 1/300, so the warning means "kan bli svår att läsa", never "går att läsa för alla".
 * A big figure is read at a glance and from further away, so it gets twice that (1/150).
 */
export const READABLE_TEXT_RATIO = 1 / 300;
export const READABLE_FIGURE_RATIO = 1 / 150;

/**
 * Where the board is read from at each Avstånd: the middle of Nära's 1–3 m and Mellan's 3–6 m, and 8 m for Långt (a production hall,
 * "upp till 10 m": at the far end a larger screen than 55" is needed). A tablet or a computer at Nära is read where it stands, at arm's
 * length – nobody reads an iPad from 2 m.
 */
export const READING_DISTANCE_M: Record<Distance, number> = { near: 2, medium: 4.5, far: 8 };

/**
 * The screens of Förhandsgranska: an iPad of 9,7" and a computer of 15,6" (assumed, common sizes), and a tv with 1080p or 4K whose
 * size is chosen (`TV_INCHES`). `hand` is the distance in metres a tablet or a computer is read from at Nära.
 */
export const SCREEN_SIZES = [
  { key: "ipad", label: "iPad", w: 1024, h: 768, inches: 9.7, hand: 0.5, tv: false },
  { key: "laptop", label: "Dator", w: 1440, h: 900, inches: 15.6, hand: 0.7, tv: false },
  { key: "tv1080", label: "TV 1080p", w: 1920, h: 1080, inches: null, hand: null, tv: true },
  { key: "tv4k", label: "TV 4K", w: 3840, h: 2160, inches: null, hand: null, tv: true },
] as const;
export type ScreenSizeKey = (typeof SCREEN_SIZES)[number]["key"];
export type ScreenTurn = Orientation;

/**
 * Skärmstorlek (2026-11-20: "På jobbet finns det ännu större skärmar idag – kontrollera vad som är brukligt"): the tv sizes the
 * professional displays are sold in (55–98"; Samsung and LG name the 85/86" size differently), and the size a tv gets when none is
 * chosen, after the distance. Signage advice puts about 55" at a few metres, 65–75"
 * at 3–4,5 m and 85–98" at 4,5–7,5 m; further away an LED wall. We take the middle of that: Nära 55", Mellan 65", Långt 86".
 */
export const TV_INCHES = [55, 65, 75, 86, 98] as const;
export const DEFAULT_TV_INCHES: Record<Distance, number> = { near: 55, medium: 65, far: 86 };
/** A tv's size in inches: the one chosen (any sensible size), else the distance's default. */
export const tvInches = (distance: Distance, chosen?: number | null) => chosen && chosen >= 20 && chosen <= 300 ? chosen : DEFAULT_TV_INCHES[distance];

export const screenSize = (key: ScreenSizeKey) => SCREEN_SIZES.find((item) => item.key === key) ?? SCREEN_SIZES[0];
export function screenPixels(key: ScreenSizeKey, turn: ScreenTurn) {
  const found = screenSize(key);
  const [long, short] = [Math.max(found.w, found.h), Math.min(found.w, found.h)];
  return turn === "portrait" ? { w: short, h: long } : { w: long, h: short };
}
/** The screen's diagonal in inches: a tablet's and a computer's assumed size, a tv's chosen one (or the distance's default). */
export const screenInches = (key: ScreenSizeKey, distance: Distance, inches?: number | null) => screenSize(key).inches ?? tvInches(distance, inches);
/** Millimetres per CSS pixel on the screen. */
export const millimetresPerPixel = (key: ScreenSizeKey, distance: Distance = "near", inches?: number | null) => { const found = screenSize(key); return (screenInches(key, distance, inches) * 25.4) / Math.hypot(found.w, found.h); };
/** The metres the board is read from on this screen at this distance. */
export const readingDistance = (key: ScreenSizeKey, distance: Distance) => distance === "near" && screenSize(key).hand ? screenSize(key).hand! : READING_DISTANCE_M[distance];
/** The smallest card text (CSS pixels) that can be read on the screen at the distance; `figure` for a large figure; `inches` a tv's size. */
export function readablePx(key: ScreenSizeKey, distance: Distance, figure = false, inches?: number | null) {
  return (readingDistance(key, distance) * 1000 * (figure ? READABLE_FIGURE_RATIO : READABLE_TEXT_RATIO)) / millimetresPerPixel(key, distance, inches);
}

/** A card's box in pixels on a screen, as the player draws it: 0.6 vmin around the board and 0.45 vmin around each card. */
export function cardPixels(rect: { w: number; h: number }, rows: number, screen: { w: number; h: number }) {
  const vmin = Math.min(screen.w, screen.h) / 100;
  const pad = 0.6 * vmin;
  const gap = 0.45 * vmin;
  return { w: Math.max(0, (rect.w * (screen.w - 2 * pad)) / GRID_COLUMNS - 2 * gap), h: Math.max(0, (rect.h * (screen.h - 2 * pad)) / rows - 2 * gap) };
}

export const TEXT_SCALE: Record<"small" | "normal" | "large", number> = { small: 0.82, normal: 1, large: 1.25 };

/**
 * The card's text in pixels: app/globals.css .board-card written out. 6 % of the card's smaller side, grown by the distance up to
 * `enough` of a row, never below Nära, at most 11 % of the card's height and `most` of a row, and within 11–128 px.
 */
export function cardTextPx(box: { w: number; h: number }, cardRows: number, distance: Distance, scale = 1) {
  const { scale: grow, enough, most } = DISTANCE[distance];
  const text = 0.06 * Math.min(box.w, box.h) * scale;
  const perRow = box.h / Math.max(1, cardRows);
  const sized = Math.max(text, Math.min(text * grow, (enough / 100) * perRow * scale));
  return Math.max(11, Math.min(sized, 0.11 * box.h, (most / 100) * perRow * scale, 128));
}
/**
 * The size of a card's large figure (app/globals.css): Nyckeltal's figure a third of the card's height, the clock's 42 %, a machine's
 * state 24 %, each never wider than the card allows; a ring's figure is 1.9 times the card's text.
 */
export function figurePx(box: { w: number; h: number }, scale = 1, type: CardType = "kpi", options: { seconds?: boolean; text?: number } = {}) {
  switch (type) {
    case "gauge": return 1.9 * (options.text ?? 14);
    case "clock": return Math.max(18, Math.min(0.42 * box.h * scale, (options.seconds ? 0.12 : 0.17) * box.w, 900));
    case "machine": return Math.max(14, Math.min(0.24 * box.h * scale, 0.11 * box.w, 400));
    default: return Math.max(18, Math.min(0.34 * box.h * scale, 0.19 * box.w, 760));
  }
}

/** The cards that are mostly one large figure: a figure, a ring, the clock and a machine's state. */
const FIGURE_CARDS: readonly CardType[] = ["kpi", "gauge", "clock", "machine"];
/** A card of one figure that takes this share of the board shows one thing very large (2026-11-20: "ett nyckeltal som fyller en halv tv"). */
export const LARGE_SHARE = 0.25;
/** …when its figure is also this many times what the distance needs. */
export const LARGE_FIGURE_TIMES = 3;

export type Capacity = { cards: number; card: { w: number; h: number } | null; textPx: number; readablePx: number };

/**
 * How many cards of the smallest readable size fit on the screen at the distance: every card size from the smallest a card may be
 * (3 × 2) is tried, the one that fits most cards side by side wins (never more than a board may hold). `card` is that size in cells and
 * `textPx` the text it gets; none fits when even the whole board is too small to read (`cards` 0).
 */
export function screenCapacity(key: ScreenSizeKey, turn: ScreenTurn, distance: Distance, rows: number, inches?: number | null): Capacity {
  const screen = screenPixels(key, turn);
  const need = readablePx(key, distance, false, inches);
  let best: Capacity = { cards: 0, card: null, textPx: 0, readablePx: need };
  for (let h = 2; h <= rows; h += 1) {
    for (let w = 3; w <= GRID_COLUMNS; w += 1) {
      const text = cardTextPx(cardPixels({ w, h }, rows, screen), h, distance);
      if (text < need) continue;
      const cards = Math.min(MAX_CARDS, Math.floor(GRID_COLUMNS / w) * Math.floor(rows / h));
      if (cards > best.cards) best = { cards, card: { w, h }, textPx: text, readablePx: need };
    }
  }
  return best;
}

export type ReadabilityIssue = { cardId: string; kind: "small" | "large"; textPx: number; needPx: number };
export type Readability = { capacity: Capacity; tooMany: boolean; issues: ReadabilityIssue[]; readable: boolean };

/**
 * Is the board readable on this screen at this distance? Too many cards (more than fit readably), a card whose text (for a card of one
 * figure: its figure) is smaller than the distance needs, or a card of one figure that takes a quarter of the board with a figure far
 * larger than needed. `readable` is
 * false only for the first two: a large card is a hint, it can still be read.
 */
export function boardReadability(layout: Pick<BoardLayout, "rows" | "cards">, key: ScreenSizeKey, turn: ScreenTurn, distance: Distance, inches?: number | null): Readability {
  const capacity = screenCapacity(key, turn, distance, layout.rows, inches);
  const screen = screenPixels(key, turn);
  const need = readablePx(key, distance, false, inches);
  const needFigure = readablePx(key, distance, true, inches);
  const issues: ReadabilityIssue[] = [];
  for (const card of layout.cards) {
    const box = cardPixels(card, layout.rows, screen);
    const scale = TEXT_SCALE[card.settings.textSize ?? "normal"];
    if (card.type === "image") continue;
    const text = cardTextPx(box, card.h, distance, scale);
    // A card of one figure is read by its figure (its title is read on the way closer); the others by their text.
    if (FIGURE_CARDS.includes(card.type)) {
      const figure = figurePx(box, scale, card.type, { seconds: Boolean(card.settings.showSeconds), text });
      if (figure < needFigure - 0.05) issues.push({ cardId: card.id, kind: "small", textPx: round(figure), needPx: round(needFigure) });
      else if ((card.w * card.h) / (GRID_COLUMNS * layout.rows) >= LARGE_SHARE && figure >= needFigure * LARGE_FIGURE_TIMES) issues.push({ cardId: card.id, kind: "large", textPx: round(figure), needPx: round(needFigure) });
      continue;
    }
    if (text < need - 0.05) issues.push({ cardId: card.id, kind: "small", textPx: round(text), needPx: round(need) });
  }
  const tooMany = layout.cards.length > capacity.cards;
  return { capacity, tooMany, issues, readable: !tooMany && !issues.some((issue) => issue.kind === "small") };
}

const round = (value: number) => Math.round(value * 10) / 10;

/** The card's name in a warning: its own title, its source's name, or its type's. */
export const issueCardName = (card: Pick<BoardCard, "title" | "type">, label?: string | null) => card.title.trim() || label || cardDefinition(card.type).label;
