import {
  compareNews, NEWS_DRAFTS_MAX, NEWS_MISSING, NEWS_PAGE, NEWS_WRITE_REFUSAL, newsEvents, newsSaveSchema, newsView, parseNewsFilter, type NewsPostView, type NewsRow,
} from "@/lib/news/model";
import type { DemoDatabase } from "./demo-data";

/**
 * Nyheter i demon (2026-11-21): /api/news answered from memory with the same rules as the server (lib/news/server.ts). Kopplingsbyrån
 * AB has a few invented posts; the demo's admin writes, pins and removes in this browser only, and a member reads.
 */
export class DemoNewsError extends Error {
  constructor(readonly status: number, message: string) { super(message); }
}
type Context = { db: DemoDatabase; user: { id: string; name: string }; admin: boolean; now: Date };
type Request = { method: string; url: URL; body: unknown };
type Store = { rows: NewsRow[]; sequence: number };

const stores = new WeakMap<DemoDatabase, Store>();

function storeOf(ctx: Context): Store {
  let store = stores.get(ctx.db);
  if (!store) {
    const at = (hours: number) => new Date(ctx.now.getTime() - hours * 3_600_000);
    const admin = ctx.db.users.find((user) => user.role === "ADMIN")?.id ?? ctx.db.users[0]!.id;
    const row = (id: string, title: string, body: string, hours: number, extra: Partial<NewsRow> = {}): NewsRow => ({
      id, title, body, status: "published", pinned: false, source: "manual", agentName: null, authorUserId: admin, publishedAt: at(hours), createdAt: at(hours), updatedAt: at(hours), ...extra,
    });
    store = { sequence: 0, rows: [
      row("demo-news-1", "Ny rutin för nycklar till kundernas fastigheter", "Från och med måndag kvitteras alla nycklar i appen när du hämtar och lämnar dem. Fråga arbetsledaren om du är osäker.", 30, { pinned: true }),
      row("demo-news-2", "Veckans planering", "12 bokningar den här veckan. Två arbetsordrar saknar bokning och tas upp på måndagsmötet. Tänk på att ställverket på Fasvägen bokas med driftavdelningen.", 6, { source: "agent", agentName: "Veckans planering" }),
      row("demo-news-3", "Utbildning i elsäkerhet torsdag", "Vi går igenom rutinerna för arbete nära spänning. Torsdag kl. 7.30 på kontoret, frukost från kl. 7.", 54),
      row("demo-news-4", "Julbord den 12 december", "Anmäl dig till arbetsledaren senast fredag. Säg till om du har önskemål om maten.", 0, { status: "draft", publishedAt: null }),
    ] };
    stores.set(ctx.db, store);
  }
  return store;
}

const names = (ctx: Context) => new Map<string, string>(ctx.db.users.map((user) => [user.id, user.name]));
const viewOf = (ctx: Context, row: NewsRow): NewsPostView => newsView(row, names(ctx).get(row.authorUserId));
const requireWrite = (ctx: Context) => { if (!ctx.admin) throw new DemoNewsError(403, NEWS_WRITE_REFUSAL); };
const find = (store: Store, id: unknown) => {
  const row = store.rows.find((item) => item.id === id);
  if (!row) throw new DemoNewsError(404, NEWS_MISSING);
  return row;
};

/** The board's measure "Senaste nyheterna" in the demo (features/demo/demo-boards.ts). */
export function demoNewsEvents(ctx: Context) {
  return newsEvents(storeOf(ctx).rows.filter((row) => row.status === "published").sort((a, b) => (b.publishedAt?.getTime() ?? 0) - (a.publishedAt?.getTime() ?? 0)));
}

export function demoNews(ctx: Context, request: Request) {
  const store = storeOf(ctx);
  if (request.method === "GET") {
    const id = request.url.searchParams.get("id");
    if (id) {
      const row = find(store, id);
      if (row.status !== "published" && !ctx.admin) throw new DemoNewsError(404, NEWS_MISSING);
      return { post: viewOf(ctx, row), canWrite: ctx.admin };
    }
    const filter = parseNewsFilter(request.url.searchParams.get("filter"));
    if (filter === "draft" && !ctx.admin) throw new DemoNewsError(403, NEWS_WRITE_REFUSAL);
    const query = (request.url.searchParams.get("q") ?? "").trim().toLocaleLowerCase("sv");
    const items = store.rows.filter((row) => row.status === filter && (!query || `${row.title} ${row.body}`.toLocaleLowerCase("sv").includes(query))).map((row) => viewOf(ctx, row)).sort(compareNews);
    return { items: items.slice(0, filter === "draft" ? NEWS_DRAFTS_MAX : NEWS_PAGE), next: null, drafts: ctx.admin ? store.rows.filter((row) => row.status === "draft").length : 0, canWrite: ctx.admin, moduleOn: true };
  }
  requireWrite(ctx);
  const input = (request.body ?? {}) as { action?: string; id?: string; post?: unknown; pinned?: boolean };
  const now = new Date();
  switch (input.action) {
    case "create": {
      const save = newsSaveSchema.parse(input.post);
      const row: NewsRow = { id: `demo-news-new-${++store.sequence}`, title: save.title, body: save.body, status: save.status, pinned: save.pinned, source: "manual", agentName: null, authorUserId: ctx.user.id, publishedAt: save.status === "published" ? now : null, createdAt: now, updatedAt: now };
      store.rows.push(row);
      return { post: viewOf(ctx, row) };
    }
    case "save": {
      const row = find(store, input.id);
      const save = newsSaveSchema.parse(input.post);
      const publishing = save.status === "published" && row.status !== "published";
      Object.assign(row, { title: save.title, body: save.body, pinned: save.pinned, status: save.status, updatedAt: now, ...(publishing ? { publishedAt: now } : save.status === "draft" ? { publishedAt: null } : {}) });
      return { post: viewOf(ctx, row) };
    }
    case "pin": {
      const row = find(store, input.id);
      Object.assign(row, { pinned: Boolean(input.pinned), updatedAt: now });
      return { post: viewOf(ctx, row) };
    }
    case "delete": {
      const row = find(store, input.id);
      store.rows.splice(store.rows.indexOf(row), 1);
      return { removed: row.id };
    }
  }
  throw new DemoNewsError(400, "Okänd begäran.");
}
