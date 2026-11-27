import { prisma } from "@/lib/db";
import { cardDefinition, defaultSourceRef, type BoardCard, type BoardLayout } from "./model";
import { sourceFileIds, sourceOfCard } from "./cards";
import { readSourceCard } from "./cards/server";
import { withTrend } from "./cards/trend-server";
import { countMetric, type MetricCaller } from "./metrics-server";
import { metricDefinition, metricPeriod } from "./metrics";
import { maskPeople, peopleChoiceOf, personalColumns, type Visibility } from "./privacy";
import { tableShape, type TableColumn, type TableRow, MAX_ROWS } from "./table";
import { tableColumnsSchema } from "./table";
import type { CardData, Shape } from "./shapes";

/**
 * Tavlans siffror (Tavlor etapp 1, 2026-11-18): every card's data counted on the server, in the shape the card draws. Inside the app
 * the viewer is the signed-in person; for a screen or a link it is the person who published the board (lib/boards/viewer-server.ts),
 * and personal data follows the publisher's choice per card. A board's figures are kept 30 seconds per version and viewer, so twenty
 * screens showing one board cause one count (plan 4.3); a saved table or a new version empties what it touched.
 */
export type FeedMode = { outside: false } | { outside: true; visibility: Visibility; namesAllowed: boolean };
export type BoardFeed = Record<string, CardData>;

const TTL_MS = 30_000;
type Entry = { at: number; feed: BoardFeed; sources: string[]; boardId: string };
const globalCache = globalThis as typeof globalThis & { __boardFeedCache?: Map<string, Entry> };
const cache: Map<string, Entry> = globalCache.__boardFeedCache ??= new Map();

/** Empties the kept figures of a board (published again, removed) or of a table (saved). */
export function forgetBoardFeeds(match: { boardId?: string; sourceId?: string }) {
  for (const [key, entry] of cache) {
    if ((match.boardId && entry.boardId === match.boardId) || (match.sourceId && entry.sources.includes(match.sourceId))) cache.delete(key);
  }
}

async function loadTables(organizationId: string, ids: readonly string[]) {
  if (!ids.length) return new Map<string, { name: string; columns: TableColumn[]; rows: TableRow[] }>();
  const sources = await prisma.boardDataSource.findMany({
    where: { organizationId, id: { in: [...ids] }, deletedAt: null },
    select: { id: true, name: true, columns: true, rows: { orderBy: [{ position: "asc" }, { createdAt: "asc" }], take: MAX_ROWS, select: { id: true, values: true } } },
  });
  return new Map(sources.map((source) => {
    const columns = tableColumnsSchema.safeParse(source.columns);
    return [source.id, { name: source.name, columns: columns.success ? columns.data : [], rows: source.rows.map((row) => ({ id: row.id, values: (row.values ?? {}) as TableRow["values"] })) }];
  }));
}

/** The table shape cut to the card's number of rows (a table card's choice). */
function limitRows(shape: Shape, card: BoardCard): Shape {
  if (shape.kind !== "table" || !card.settings.rows) return shape;
  return { ...shape, rows: shape.rows.slice(0, card.settings.rows) };
}

export async function boardFeed(viewer: MetricCaller, layout: BoardLayout, mode: FeedMode, options: { cacheKey?: string; boardId?: string; now?: Date } = {}): Promise<BoardFeed> {
  const now = options.now ?? new Date();
  if (options.cacheKey) {
    const kept = cache.get(options.cacheKey);
    if (kept && now.getTime() - kept.at < TTL_MS) return kept.feed;
  }
  const at = now.toISOString();
  const dataCards = layout.cards.map((card) => card.data ? card : { ...card, data: defaultSourceRef(card.type) }).filter((card) => card.data && cardDefinition(card.type).shapes.length > 0);
  const tableIds = [...new Set(dataCards.flatMap((card) => card.data?.kind === "table" ? [card.data.sourceId] : []))];
  const tables = await loadTables(viewer.organizationId, tableIds);
  const metrics = new Map<string, Promise<Awaited<ReturnType<typeof countMetric>> | null>>();
  const feed: BoardFeed = {};
  await Promise.all(dataCards.map(async (card) => {
    const wanted = cardDefinition(card.type).shapes;
    const ref = card.data!;
    let label = ref.kind === "metric" ? metricDefinition(ref.metric).label : ref.kind === "table" ? tables.get(ref.sourceId)?.name : undefined;
    const put = (value: CardData) => { feed[card.id] = label ? { ...value, label } : value; };
    try {
      let shape: Shape | null = null;
      if (ref.kind === "metric") {
        const period = metricPeriod(ref.metric, ref.period);
        const key = `${ref.metric}:${period ?? ""}`;
        if (!metrics.has(key)) metrics.set(key, countMetric(viewer, ref.metric, now, period).catch(() => null));
        const result = await metrics.get(key)!;
        if (!result) { put({ ok: false, at, reason: "failed" }); return; }
        if (!result.ok) { put({ ok: false, at, reason: result.reason }); return; }
        shape = wanted.includes(result.data.kind) ? result.data : null;
        if (shape?.kind === "number") shape = await withTrend(viewer, ref, card, shape, now);
      } else if (ref.kind === "source") {
        const result = await readSourceCard(viewer, ref.source, now);
        if (!result.ok) { put({ ok: false, at, reason: result.reason }); return; }
        label = result.label;
        shape = wanted.includes(result.data.kind) ? result.data : null;
      } else {
        const table = tables.get(ref.sourceId);
        if (!table) { put({ ok: false, at, reason: "missing" }); return; }
        shape = tableShape(table.columns, table.rows, ref, wanted[0]!);
      }
      if (!shape) { put({ ok: false, at, reason: "missing" }); return; }
      shape = limitRows(shape, card);
      if (mode.outside) shape = maskPeople(shape, personalColumns(card), mode.namesAllowed ? peopleChoiceOf(mode.visibility, card.id) : "hidden");
      put({ ok: true, at, data: shape });
    } catch {
      put({ ok: false, at, reason: "failed" });
    }
  }));
  if (options.cacheKey) {
    cache.set(options.cacheKey, { at: now.getTime(), feed, sources: tableIds, boardId: options.boardId ?? "" });
    if (cache.size > 500) for (const [key, entry] of cache) if (now.getTime() - entry.at > TTL_MS) cache.delete(key);
  }
  return feed;
}

/** The pictures a layout shows, so an image route answers only for a picture on the board it serves. */
export const layoutImageIds = (layout: BoardLayout) => layout.cards.flatMap((card) => card.type === "image" && card.settings.imageId ? [card.settings.imageId] : sourceFileIds(sourceOfCard(card)));
