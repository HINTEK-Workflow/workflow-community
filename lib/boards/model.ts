import { z } from "zod";
import { METRIC_KEYS, type MetricKey } from "./metrics";
import { clampRect, firstFree, GRID_COLUMNS, ROWS_BY_ORIENTATION, type Orientation, type SizeLimits } from "./grid";
import { PERIODS, type Period } from "./period";
import type { ShapeKind } from "./shapes";
import { defaultSource, SOURCE_CARD_TYPES, SOURCE_CARDS, sourceRefSchema, type SourceCardIcon } from "./cards";

/**
 * Tavlans modell (Tavlor och skärmar etapp 1, 2026-11-18). A board is a grid of cards; each card is a type from the register below
 * plus its settings and, for the cards that show data, which source it reads. New card types are entries here, never special
 * cases in the editor: the properties panel is built from what the entry says (lib/boards/card-settings.ts). Pure.
 */
export const CARD_TYPES = ["kpi", "gauge", "chart", "table", "status", "events", "text", "image", "clock", ...SOURCE_CARD_TYPES] as const;
export type CardType = (typeof CARD_TYPES)[number];

export type CardDefinition = {
  type: CardType;
  label: string;
  /** A Lucide icon's name (plain line style); features/boards/card-icons.ts maps it. */
  icon: "Gauge" | "CircleGauge" | "ChartLine" | "Table2" | "CircleDot" | "ListChecks" | "Type" | "Image" | "Clock" | SourceCardIcon;
  description: string;
  /** The shapes the card draws; empty for cards that need no data. */
  shapes: readonly ShapeKind[];
  size: SizeLimits;
  /** The size a new card gets. */
  start: { w: number; h: number };
};

export const CARDS: readonly CardDefinition[] = [
  { type: "kpi", label: "Nyckeltal", icon: "Gauge", description: "Ett stort tal med enhet, trend och egna gränser.", shapes: ["number"], size: { minW: 3, minH: 2 }, start: { w: 6, h: 4 } },
  { type: "gauge", label: "Mätare", icon: "CircleGauge", description: "Andel av ett mål som en ring.", shapes: ["number"], size: { minW: 3, minH: 3 }, start: { w: 6, h: 5 } },
  { type: "chart", label: "Diagram", icon: "ChartLine", description: "Linje, stapel eller yta över tid eller per kategori.", shapes: ["series"], size: { minW: 6, minH: 4 }, start: { w: 12, h: 6 } },
  { type: "table", label: "Tabell", icon: "Table2", description: "Rader och kolumner, högst ett valt antal rader.", shapes: ["table"], size: { minW: 6, minH: 3 }, start: { w: 12, h: 6 } },
  { type: "status", label: "Status", icon: "CircleDot", description: "En lampa per maskin, linje eller system.", shapes: ["status"], size: { minW: 4, minH: 3 }, start: { w: 8, h: 5 } },
  { type: "events", label: "Händelser", icon: "ListChecks", description: "Det senaste som har hänt, nyast först.", shapes: ["events"], size: { minW: 6, minH: 3 }, start: { w: 8, h: 6 } },
  { type: "text", label: "Text", icon: "Type", description: "Rubrik och stycke, till exempel veckans meddelande.", shapes: [], size: { minW: 3, minH: 2 }, start: { w: 8, h: 3 } },
  { type: "image", label: "Bild", icon: "Image", description: "En bild som laddas upp till Workflow.", shapes: [], size: { minW: 2, minH: 2 }, start: { w: 6, h: 5 } },
  { type: "clock", label: "Klocka", icon: "Clock", description: "Tid, datum och veckonummer.", shapes: [], size: { minW: 3, minH: 2 }, start: { w: 6, h: 3 } },
  ...SOURCE_CARDS,
];
const CARD_BY_TYPE = Object.fromEntries(CARDS.map((card) => [card.type, card])) as Record<CardType, CardDefinition>;
export const cardDefinition = (type: CardType) => CARD_BY_TYPE[type];
export const cardTakesData = (type: CardType) => CARD_BY_TYPE[type].shapes.length > 0;
/** The source a new card of the newer kinds reads before anything is chosen (null for the others and for a file card). */
export function defaultSourceRef(type: CardType): DataRef | null {
  const source = (SOURCE_CARD_TYPES as readonly string[]).includes(type) ? defaultSource(type as (typeof SOURCE_CARD_TYPES)[number]) : null;
  return source ? { kind: "source", source } : null;
}

// ---------- the data a card reads ----------

export const TABLE_AGGREGATES = ["sum", "avg", "min", "max", "count", "last"] as const;
export type TableAggregate = (typeof TABLE_AGGREGATES)[number];
export const AGGREGATE_LABEL: Record<TableAggregate, string> = { sum: "Summa", avg: "Medel", min: "Lägsta", max: "Högsta", count: "Antal rader", last: "Sista raden" };

const columnKey = z.string().trim().regex(/^[a-z0-9_]{1,40}$/);
const optionalColumn = columnKey.optional();
export const metricRefSchema = z.object({ kind: z.literal("metric"), metric: z.enum(METRIC_KEYS), period: z.enum(PERIODS).optional() });
export const tableRefSchema = z.object({
  kind: z.literal("table"),
  sourceId: z.string().trim().min(1).max(60),
  aggregate: z.enum(TABLE_AGGREGATES).optional(),
  column: optionalColumn,
  labelColumn: optionalColumn,
  valueColumns: z.array(columnKey).max(6).optional(),
  nameColumn: optionalColumn,
  stateColumn: optionalColumn,
  textColumn: optionalColumn,
  dateColumn: optionalColumn,
  titleColumn: optionalColumn,
});
export const dataRefSchema = z.discriminatedUnion("kind", [metricRefSchema, tableRefSchema, sourceRefSchema]);
export type DataRef = z.infer<typeof dataRefSchema>;
export type MetricRef = { kind: "metric"; metric: MetricKey; period?: Period };

// ---------- the card ----------

const finite = z.number().finite();
export const CHART_KINDS = ["line", "bar", "area"] as const;
export const CHART_KIND_LABEL: Record<(typeof CHART_KINDS)[number], string> = { line: "Linje", bar: "Stapel", area: "Yta" };
export const cardSettingsSchema = z.object({
  unit: z.string().trim().max(12).optional(),
  decimals: z.number().int().min(0).max(3).optional(),
  target: finite.nullable().optional(),
  limits: z.object({ good: finite.nullable(), bad: finite.nullable(), higherIsBetter: z.boolean() }).optional(),
  chart: z.enum(CHART_KINDS).optional(),
  rows: z.number().int().min(1).max(50).optional(),
  heading: z.string().max(120).optional(),
  body: z.string().max(2000).optional(),
  align: z.enum(["left", "center"]).optional(),
  large: z.boolean().optional(),
  imageId: z.string().trim().max(60).optional(),
  fit: z.enum(["contain", "cover"]).optional(),
  alt: z.string().max(200).optional(),
  showDate: z.boolean().optional(),
  showWeek: z.boolean().optional(),
  showSeconds: z.boolean().optional(),
  /** Jämförelse (2026-11-19): a figure of a measure that can compare shows the change against the period before unless turned off. */
  compare: z.enum(["previous", "none"]).optional(),
  /** Färg och framhävning within the design tokens (CARD_ACCENTS); the limits' green, yellow and red still win on a figure. */
  accent: z.enum(["primary", "round", "time", "customer", "quote", "calendar"]).optional(),
  emphasis: z.enum(["normal", "tinted"]).optional(),
  /** Textstorlek: the card's text a step smaller or larger than its size gives, for a screen seen from afar. */
  textSize: z.enum(["small", "normal", "large"]).optional(),
  /** Minutes after which the card's figures count as old ("Gammal data"); the user chooses, none by default. */
  staleMinutes: z.number().int().min(1).max(1440).optional(),
  /** Trend (2026-11-19): a figure shows a small curve of the periods before unless turned off, and its change in percent or as a number. */
  trend: z.enum(["show", "none"]).optional(),
  changeAs: z.enum(["percent", "absolute"]).optional(),
});
export type CardSettings = z.infer<typeof cardSettingsSchema>;
export type CardAccent = NonNullable<CardSettings["accent"]>;
/** The card's colours: the app's own tokens only (docs/design-standard.md), each with a plain name for the editor. */
export const CARD_ACCENTS: readonly { key: CardAccent; label: string; color: string }[] = [
  { key: "primary", label: "Blå", color: "var(--primary)" },
  { key: "round", label: "Grön", color: "var(--type-round)" },
  { key: "time", label: "Lila", color: "var(--type-time)" },
  { key: "customer", label: "Turkos", color: "var(--type-customer)" },
  { key: "quote", label: "Ockra", color: "var(--type-quote)" },
  { key: "calendar", label: "Rosa", color: "var(--type-calendar)" },
];
export const CARD_ACCENT_COLOR = Object.fromEntries(CARD_ACCENTS.map((item) => [item.key, item.color])) as Record<CardAccent, string>;
export const TEXT_SIZE_LABEL: Record<NonNullable<CardSettings["textSize"]>, string> = { small: "Mindre", normal: "Vanlig", large: "Större" };

export const cardIdSchema = z.string().trim().regex(/^[a-z0-9-]{1,40}$/);
export const cardSchema = z.object({
  id: cardIdSchema,
  type: z.enum(CARD_TYPES),
  x: z.number().int().min(0).max(GRID_COLUMNS - 1),
  y: z.number().int().min(0).max(59),
  w: z.number().int().min(1).max(GRID_COLUMNS),
  h: z.number().int().min(1).max(60),
  title: z.string().trim().max(80).default(""),
  data: dataRefSchema.nullable().optional(),
  settings: cardSettingsSchema.default({}),
  /** Not shown on a phone, where the cards are stacked. */
  hideOnPhone: z.boolean().optional(),
});
export type BoardCard = z.infer<typeof cardSchema>;

// ---------- viewing distance (2026-11-19) ----------

/**
 * Avstånd: how far away the board is read. A tv that replaces a whiteboard is read from 1–3 m, one in a production hall from 10 m.
 * The rule: the author's layout is kept exactly (the same cells, the same proportions), and the text of every card is sized as if the
 * board had fewer, larger cells – Nära the whole 24 × 14, Mellan 16 columns, Långt 12. So `scale` is 24 divided by those columns,
 * and a card's text grows by it; a card then shows less (fewer rows in a list, a shorter text) because each thing is larger. The
 * growth stops at `enough`, the text height (in hundredths of a row of the board) that is read well at that distance: a large card
 * already has large text and keeps it, so it is the small cards that grow (app/globals.css .board-card). The board has a base
 * distance; a fixed screen may choose its own (lib/boards/screens.ts). Nära is the default and what boards had before.
 * `most` (2026-11-20, filmed: "Dagens bokningar" as large as a heading on a big card) is the ceiling in the same unit: a large card no
 * longer gets ever larger text, it shows more rows instead. Both are checked against the readable size in lib/boards/capacity.ts
 * (tests/boards-capacity.test.ts): `enough` reaches it on a 55" tv and `most` stays well above it.
 */
export const DISTANCES = ["near", "medium", "far"] as const;
export type Distance = (typeof DISTANCES)[number];
export const DISTANCE: Record<Distance, { label: string; place: string; hint: string; columns: number; scale: number; enough: number; most: number }> = {
  near: { label: "Nära", place: "whiteboard, 1–3 m", hint: "1–3 meter, som en whiteboard. Mest får plats.", columns: 24, scale: 1, enough: 100, most: 40 },
  medium: { label: "Mellan", place: "mötesrum, 3–6 m", hint: "3–6 meter, som ett mötesrum. Större text.", columns: 16, scale: 1.5, enough: 35, most: 60 },
  far: { label: "Långt", place: "produktionshall, upp till 10 m", hint: "Upp till 10 meter, som en produktionshall, med en skärm på 86 tum eller större. Störst text, minst får plats.", columns: 12, scale: 2, enough: 60, most: 90 },
};
export const distanceOf = (value: unknown): Distance => (DISTANCES as readonly string[]).includes(String(value)) ? value as Distance : "near";
/** The distance a screen shows a board at: the screen's own choice when it has one, else the board's. */
export const shownDistance = (board?: Distance | null, screen?: Distance | null): Distance => screen ?? board ?? "near";
/** The grid the text is sized for at a distance, in whole cells (rows rounded): Nära 24 × 14, Mellan 16 × 9, Långt 12 × 7. */
export const distanceGrid = (distance: Distance, rows: number) => ({ columns: DISTANCE[distance].columns, rows: Math.round(rows / DISTANCE[distance].scale) });

export const MAX_CARDS = 40;
export const layoutSchema = z.object({
  version: z.literal(1),
  orientation: z.enum(["landscape", "portrait"]),
  rows: z.number().int().min(6).max(60),
  /** Avstånd; missing is Nära. */
  distance: z.enum(DISTANCES).optional(),
  cards: z.array(cardSchema).max(MAX_CARDS, `En tavla kan ha högst ${MAX_CARDS} kort.`),
}).transform((layout) => normalizeLayout(layout));
export type BoardLayout = { version: 1; orientation: Orientation; rows: number; distance?: Distance; cards: BoardCard[] };

/** Every card inside the board and at least its type's smallest size; ids are unique (a repeated one gets a new id). */
export function normalizeLayout(layout: BoardLayout): BoardLayout {
  const seen = new Set<string>();
  const cards = layout.cards.map((card, index) => {
    let id = card.id;
    while (seen.has(id)) id = `${card.id.slice(0, 30)}-${index}`;
    seen.add(id);
    // A card of the newer kinds starts with its own source (lib/boards/cards) and never keeps a source of another type.
    const data = !cardTakesData(card.type) ? null : card.data?.kind === "source" ? (card.data.source.type === card.type ? card.data : defaultSourceRef(card.type)) : card.data ?? defaultSourceRef(card.type);
    return { ...card, id, data, ...clampRect(card, layout.rows, GRID_COLUMNS, cardDefinition(card.type).size) };
  });
  const distance = distanceOf(layout.distance);
  return { version: 1, orientation: layout.orientation, rows: layout.rows, ...(distance !== "near" ? { distance } : {}), cards };
}

/** Reads a stored layout; anything unreadable becomes an empty board, so a bad row never breaks the page. */
export function readLayout(value: unknown): BoardLayout {
  const parsed = layoutSchema.safeParse(value);
  return parsed.success ? parsed.data : emptyLayout();
}

export const emptyLayout = (orientation: Orientation = "landscape"): BoardLayout => ({ version: 1, orientation, rows: ROWS_BY_ORIENTATION[orientation], cards: [] });

/** Duplicera: the same card with all its settings at the first free place of its size; null when the board has no room. */
export function duplicateCard(layout: BoardLayout, id: string, newId: string): BoardLayout | null {
  const card = layout.cards.find((item) => item.id === id);
  if (!card || layout.cards.length >= MAX_CARDS) return null;
  const spot = firstFree(layout.cards, card.w, card.h, layout.rows);
  if (!spot) return null;
  const copy = JSON.parse(JSON.stringify(card)) as BoardCard;
  return { ...layout, cards: [...layout.cards, { ...copy, id: newId, ...spot }] };
}

/** A new card's id: short and random enough within one board. */
export const newCardId = (random: () => number = Math.random) => `k-${Math.floor(random() * 36 ** 6).toString(36).padStart(6, "0")}`;

// ---------- presets (only layouts, no line of business) ----------

export const BOARD_PRESETS = [
  { key: "empty", label: "Tom tavla", description: "Börja från ett tomt rutnät." },
  { key: "grid", label: "2 × 2", description: "Fyra lika stora kort." },
  { key: "columns", label: "Tre kolumner", description: "Tre höga kort bredvid varandra." },
  { key: "portrait", label: "Stående skärm", description: "För en skärm på högkant." },
] as const;
export type BoardPreset = (typeof BOARD_PRESETS)[number]["key"];

export function presetLayout(preset: BoardPreset): BoardLayout {
  const card = (id: string, type: CardType, x: number, y: number, w: number, h: number): BoardCard => ({ id, type, x, y, w, h, title: "", data: null, settings: {} });
  switch (preset) {
    case "grid": return { ...emptyLayout(), cards: [card("k-1", "kpi", 0, 0, 12, 7), card("k-2", "kpi", 12, 0, 12, 7), card("k-3", "chart", 0, 7, 12, 7), card("k-4", "table", 12, 7, 12, 7)] };
    case "columns": return { ...emptyLayout(), cards: [card("k-1", "kpi", 0, 0, 8, 14), card("k-2", "chart", 8, 0, 8, 14), card("k-3", "table", 16, 0, 8, 14)] };
    case "portrait": return { ...emptyLayout("portrait"), cards: [card("k-1", "clock", 0, 0, 24, 6), card("k-2", "kpi", 0, 6, 12, 8), card("k-3", "kpi", 12, 6, 12, 8), card("k-4", "chart", 0, 14, 24, 12), card("k-5", "table", 0, 26, 24, 14)] };
    default: return emptyLayout();
  }
}

// ---------- names ----------

export const BOARD_NAME_MAX = 80;
export const boardNameSchema = z.string().trim().min(1, "Ge tavlan ett namn.").max(BOARD_NAME_MAX);
/** The card's heading: its own title, else the measure's or the type's name. */
export const cardHeading = (card: Pick<BoardCard, "title" | "type">, sourceLabel?: string | null) => card.title.trim() || sourceLabel || "";
