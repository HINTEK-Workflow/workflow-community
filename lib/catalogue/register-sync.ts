import { randomUUID } from "node:crypto";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import type { SolarProductPage, SolarRegisterArticle } from "@/lib/integrations/solar";
import { wholesaleApi, type ApiPreflight, type RegisterPageOptions } from "@/lib/integrations/wholesale-api";
import { normalizeArticleNo, productKeyOf } from "@/lib/catalogue/normalize";
import { registerSearchText } from "@/lib/catalogue/register-text";
import { forgetRegisterPresence } from "@/lib/catalogue/register-search";
import type { WholesalerId } from "@/lib/wholesale/model";
import { cancelEffect, knownRegisterTotal } from "@/lib/catalogue/register-progress";

/**
 * Det gemensamma registrets synk (2026-10-17, docs/proposals/gemensamt-artikelregister-forslag-2026-10-17.md §5):
 *
 * 1. **Första importen / full genomgång:** Get Products with ignoreObsoleteProducts=true, 1000 per page, the cursor from the
 *    Link header followed in one sweep (a cursor is valid only minutes). Each page is written at once, 1000 rows in one
 *    statement; the price is never read. Rows the run adds stay hidden (`pendingRun`) until every page has arrived, so
 *    nothing half-done is ever searched – the register as it was applies until the run has finished. When it has, the
 *    rows the run never saw (obsolete or removed at Solar) are removed – unless the run saw less than half of what the
 *    register holds, which is taken as a broken answer and removes nothing.
 * 2. **Ändringar:** Get Products with lastChanged = the latest successful run's start minus an hour, without
 *    ignoreObsoleteProducts, so articles that became obsolete arrive and are hidden (status 40).
 * 3. **Månadskontroll:** a full run once a month (an article deleted outright at Solar is likely not in the changes).
 * 4. **Gränser:** one call at a time, a pause between pages, stops at the first error. Only from the server, with Workflow's
 *    key, as its own job (npm run register:sync), never in an app request. A failed run changes nothing that applies.
 * 5. **API-anslutningen måste vara aktiv (2026-10-17):** no run – the first import, a manual one or the scheduled sync –
 *    starts unless the wholesaler's adapter passes its preflight: switched on under Tjänster och nycklar, keys and catalogue
 *    number in place, the sign-in works and the catalogue answers (lib/integrations/wholesale-api.ts). A wholesaler whose
 *    API is only prepared (Ahlsell, Rexel, Sonepar) can never start one. The reason is said in plain words and kept in the
 *    history; the companies' own price files never need any API.
 *
 * The first import runs only when the product owner asks for it under Installation → Tjänster och nycklar: no full
 * import happens by itself. Each wholesaler writes only its own rows (`wholesaler` + the wholesaler's own article number).
 * The register never holds a price or a company's data.
 */
export const REGISTER_WHOLESALER: WholesalerId = "solar";
export type RegisterRunKind = "full" | "changes";
export type RegisterRun = {
  kind: RegisterRunKind; ok: boolean; message: string; startedAt: string; finishedAt: string;
  pages: number; written: number; removed: number; skipped: number;
  /** Articles with a company's price that Solar no longer has: kept and marked obsolete (status 40), never deleted (2026-10-17). */
  retired?: number;
  /** A bounded trial (maxPages): nothing is removed and the run does not count as a sync. */
  trial?: boolean;
  /** Stopped by the product owner (Avbryt): what the run added is removed, earlier articles are untouched. */
  cancelled?: boolean;
};
const HISTORY_KEEP = 20;

/** A run whose heartbeat is older than this is taken as dead (the process stopped), and another may start. */
const STALE_MS = 30 * 60_000;
const CHANGES_EVERY_MS = 20 * 3600_000;
const FULL_EVERY_MS = 30 * 24 * 3600_000;

export type RegisterSyncState = { cancelRequestedAt?: Date | null; lastFullAt: Date | null; syncedFrom: Date | null; requestedKind: string | null; runId: string | null; runHeartbeatAt: Date | null;
  /** Whether the wholesaler's API connection is switched on (and connected at all): off = no scheduled run ever starts. */
  apiEnabled: boolean };

/** Stockholm's hour of the day (0–23), so the nightly runs keep to the night in summer and in winter. */
export const stockholmHour = (now: Date) => Number(new Intl.DateTimeFormat("sv-SE", { hour: "2-digit", hour12: false, timeZone: "Europe/Stockholm" }).format(now));

/**
 * What the scheduled job (every ten minutes) does now: nothing while the API connection is off or a run is alive; a full
 * import the product owner asked for at once; otherwise – only once a full import has been made – the monthly full check
 * or the night's changes between 01 and 05 Swedish time.
 */
export function nextRegisterRun(state: RegisterSyncState | null, now: Date): RegisterRunKind | null {
  if (!state?.apiEnabled) return null;
  if (state.runId && state.runHeartbeatAt && now.getTime() - state.runHeartbeatAt.getTime() < STALE_MS) return null;
  if (state.requestedKind === "full") return "full";
  if (!state.lastFullAt) return null;
  const hour = stockholmHour(now);
  if (hour < 1 || hour >= 5) return null;
  if (now.getTime() - state.lastFullAt.getTime() >= FULL_EVERY_MS) return "full";
  if (!state.syncedFrom || now.getTime() - state.syncedFrom.getTime() >= CHANGES_EVERY_MS) return "changes";
  return null;
}

/** A Solar article as the register's row: the fields, its product key, the manufacturer's number folded, the search text. */
export function registerRowOf(article: SolarRegisterArticle) {
  return {
    ...article,
    mpnNorm: normalizeArticleNo(article.manufacturerArticleNo).slice(0, 60),
    productKey: productKeyOf(article) ?? "",
    searchText: registerSearchText(article),
  };
}

/** An article no company has a price on (alias w): the only kind the sync may delete – a priced one is marked obsolete instead (2026-10-17). */
const NO_PRICE = Prisma.sql`NOT EXISTS (SELECT 1 FROM "WholesalePrice" p WHERE p."seq" = w."seq")`;

const ensureState = (wholesaler: WholesalerId) => prisma.$executeRaw`INSERT INTO "WholesaleRegisterSync" ("wholesaler", "updatedAt") VALUES (${wholesaler}, now()) ON CONFLICT ("wholesaler") DO NOTHING`;

export async function registerSyncState(wholesaler: WholesalerId = REGISTER_WHOLESALER): Promise<RegisterSyncState & { cancelRequestedAt: Date | null; runPages: number | null; runWritten: number | null; requestedAt: Date | null; runKind: string | null; runStartedAt: Date | null; lastRun: RegisterRun | null; history: RegisterRun[] }> {
  const [row, apiEnabled] = await Promise.all([prisma.wholesaleRegisterSync.findUnique({ where: { wholesaler } }), wholesaleApi(wholesaler).enabled()]);
  return {
    cancelRequestedAt: row?.cancelRequestedAt ?? null, runPages: row?.runPages ?? null, runWritten: row?.runWritten ?? null,
    lastFullAt: row?.lastFullAt ?? null, syncedFrom: row?.syncedFrom ?? null, requestedKind: row?.requestedKind ?? null, requestedAt: row?.requestedAt ?? null,
    runId: row?.runId ?? null, runKind: row?.runKind ?? null, runStartedAt: row?.runStartedAt ?? null, runHeartbeatAt: row?.runHeartbeatAt ?? null,
    lastRun: (row?.lastRun as RegisterRun | null) ?? null, history: Array.isArray(row?.history) ? (row.history as RegisterRun[]) : [], apiEnabled,
  };
}

/**
 * The product owner asks for a full import (the first one, or a check now); the scheduled job takes it within ten minutes.
 * Refused – with the reason – when the wholesaler's API connection would not pass its preflight, so a request is never left
 * waiting for a connection that is off, has no keys or does not answer.
 */
export async function requestRegisterImport(actor: string, now = new Date(), wholesaler: WholesalerId = REGISTER_WHOLESALER): Promise<ApiPreflight> {
  const check = await wholesaleApi(wholesaler).preflight();
  if (!check.ok) return check;
  await ensureState(wholesaler);
  await prisma.wholesaleRegisterSync.update({ where: { wholesaler }, data: { requestedKind: "full", requestedAt: now, requestedBy: actor.slice(0, 200) } });
  return { ok: true, message: `${check.message} Hämtningen är begärd och startar inom tio minuter.` };
}

/**
 * Avbryt (2026-10-18): a request that has not started is withdrawn at once; a live run is asked to stop – it checks
 * between pages, stops, removes what it added (as a failed run does) and is kept in the history as "Avbruten".
 */
export async function cancelRegisterImport(wholesaler: WholesalerId = REGISTER_WHOLESALER): Promise<{ effect: "withdraw" | "stop" | "none"; message: string }> {
  const state = await registerSyncState(wholesaler);
  const running = Boolean(state.runId && state.runHeartbeatAt && Date.now() - state.runHeartbeatAt.getTime() < STALE_MS);
  const effect = cancelEffect({ requested: state.requestedKind === "full", running, cancelling: running && state.cancelRequestedAt !== null });
  if (effect === "none") return { effect, message: running ? "Hämtningen avbryts redan." : "Ingen hämtning att avbryta." };
  // One statement, so a run that starts at this moment is either withdrawn or asked to stop – never missed.
  await prisma.$executeRaw`UPDATE "WholesaleRegisterSync" SET "requestedKind" = NULL, "requestedAt" = NULL, "updatedAt" = now(),
    "cancelRequestedAt" = CASE WHEN "runId" IS NOT NULL THEN now() ELSE "cancelRequestedAt" END WHERE "wholesaler" = ${wholesaler}`;
  return { effect, message: effect === "withdraw" ? "Begäran är tillbakadragen." : "Hämtningen avbryts efter aktuell sida." };
}

/** The line under Solar in Tjänster och nycklar: how many articles the register has and how the sync goes. */
export async function registerStatus(wholesaler: WholesalerId = REGISTER_WHOLESALER) {
  const [state, counts] = await Promise.all([
    registerSyncState(wholesaler),
    prisma.$queryRaw<{ visible: number; obsolete: number }[]>`
      SELECT count(*) FILTER (WHERE "pendingRun" IS NULL AND "status" <> '40')::int AS "visible", count(*) FILTER (WHERE "status" = '40')::int AS "obsolete"
      FROM "WholesaleArticle" WHERE "wholesaler" = ${wholesaler}`,
  ]);
  const running = Boolean(state.runId && state.runHeartbeatAt && Date.now() - state.runHeartbeatAt.getTime() < STALE_MS);
  return {
    articles: counts[0]?.visible ?? 0, obsolete: counts[0]?.obsolete ?? 0, apiEnabled: state.apiEnabled,
    lastFullAt: state.lastFullAt?.toISOString() ?? null, syncedFrom: state.syncedFrom?.toISOString() ?? null,
    requested: state.requestedKind === "full" ? state.requestedAt?.toISOString() ?? new Date(0).toISOString() : null,
    running: running ? { kind: state.runKind, startedAt: state.runStartedAt?.toISOString() ?? null, pages: state.runPages ?? 0, written: state.runWritten ?? 0, cancelling: state.cancelRequestedAt !== null } : null,
    knownTotal: knownRegisterTotal(state.history),
    lastRun: state.lastRun, history: state.history.slice(0, 10),
  };
}

/** Writes one page: 1000 rows in one statement, new rows of a full run hidden until the run has finished. Only this wholesaler's rows. */
async function writePage(wholesaler: WholesalerId, articles: SolarRegisterArticle[], runId: string, hideNew: boolean): Promise<number> {
  if (!articles.length) return 0;
  // The same article twice on one page would make the statement fail ("cannot affect row a second time"): the last one wins.
  const rows = [...new Map(articles.map((article) => [article.articleNo, registerRowOf(article)])).values()];
  const column = <K extends keyof (typeof rows)[number]>(key: K) => rows.map((row) => row[key]);
  const pending = hideNew ? runId : null;
  // Existing rows are updated and only a new article is inserted, so the running number (`seq`, which the companies' price rows and
  // the import bit lists point at) is taken only for a new article: an upsert would use up a number for every article on every full run.
  await prisma.$executeRaw`
    WITH item AS (
      SELECT * FROM unnest(${column("articleNo")}::text[], ${column("eNumber")}::text[], ${column("gtin")}::text[], ${column("manufacturer")}::text[],
        ${column("manufacturerArticleNo")}::text[], ${column("mpnNorm")}::text[], ${column("name")}::text[], ${column("description")}::text[],
        ${column("productType")}::text[], ${column("etimClass")}::text[], ${column("series")}::text[], ${column("unit")}::text[], ${column("status")}::text[],
        ${column("productKey")}::text[], ${column("searchText")}::text[], ${column("lastChanged")}::timestamp(3)[])
        AS item("articleNo", "eNumber", "gtin", "manufacturer", "manufacturerArticleNo", "mpnNorm", "name", "description", "productType", "etimClass", "series", "unit", "status", "productKey", "searchText", "lastChanged")
    ), updated AS (
      UPDATE "WholesaleArticle" AS w SET
        "eNumber" = item."eNumber", "gtin" = item."gtin", "manufacturer" = item."manufacturer", "manufacturerArticleNo" = item."manufacturerArticleNo",
        "mpnNorm" = item."mpnNorm", "name" = item."name", "description" = item."description", "productType" = item."productType",
        "etimClass" = item."etimClass", "series" = item."series", "unit" = item."unit", "status" = item."status",
        "productKey" = item."productKey", "searchText" = item."searchText", "lastChanged" = item."lastChanged", "seenRun" = ${runId},
        -- A row already in the register stays visible; a row an earlier, unfinished run left hidden follows this run.
        "pendingRun" = CASE WHEN w."pendingRun" IS NULL THEN NULL ELSE ${pending}::text END,
        "updatedAt" = now()
      FROM item WHERE w."wholesaler" = ${wholesaler} AND w."articleNo" = item."articleNo"
      RETURNING w."articleNo"
    )
    INSERT INTO "WholesaleArticle" ("id", "wholesaler", "articleNo", "eNumber", "gtin", "manufacturer", "manufacturerArticleNo", "mpnNorm", "name", "description",
      "productType", "etimClass", "series", "unit", "status", "productKey", "searchText", "lastChanged", "seenRun", "pendingRun", "updatedAt")
    SELECT 'wa' || md5(${wholesaler} || ':' || item."articleNo"), ${wholesaler}, item."articleNo", item."eNumber", item."gtin", item."manufacturer", item."manufacturerArticleNo",
      item."mpnNorm", item."name", item."description", item."productType", item."etimClass", item."series", item."unit", item."status", item."productKey",
      item."searchText", item."lastChanged", ${runId}, ${pending}::text, now()
    FROM item WHERE NOT EXISTS (SELECT 1 FROM updated WHERE updated."articleNo" = item."articleNo")
    ON CONFLICT ("wholesaler", "articleNo") DO NOTHING`;
  return rows.length;
}

export type RegisterSyncDeps = {
  /** The wholesaler's connection check and pages (lib/integrations/wholesale-api.ts); the tests replace them with pages in memory. */
  preflight: () => Promise<ApiPreflight>;
  page: (options: RegisterPageOptions) => Promise<SolarProductPage>;
  pause: (ms: number) => Promise<void>;
  now: () => Date;
};

const depsFor = (wholesaler: WholesalerId): RegisterSyncDeps => {
  const api = wholesaleApi(wholesaler);
  return { preflight: () => api.preflight(), page: (options) => api.page(options), pause: (ms) => new Promise((resolve) => setTimeout(resolve, ms)), now: () => new Date() };
};

const count = (value: number) => value.toLocaleString("sv-SE");

/**
 * One run of the register's sync. `maxPages` makes it a bounded trial (a few pages to measure and look at): its rows are
 * made visible, nothing is removed and it does not count as a sync. Returns what happened in plain words; never a price,
 * a key or a token. A run that is refused (no active connection) or fails is kept in the history like any other.
 */
export async function runRegisterSync(kind: RegisterRunKind, options: { maxPages?: number; pauseMs?: number; wholesaler?: WholesalerId; deps?: Partial<RegisterSyncDeps> } = {}): Promise<RegisterRun> {
  const wholesaler = options.wholesaler ?? REGISTER_WHOLESALER;
  const use = { ...depsFor(wholesaler), ...options.deps };
  const startedAt = use.now();
  const runId = randomUUID();
  const trial = Boolean(options.maxPages && options.maxPages > 0);
  await ensureState(wholesaler);
  const result = (ok: boolean, message: string, numbers: Partial<Pick<RegisterRun, "pages" | "written" | "removed" | "skipped" | "retired" | "cancelled">> = {}): RegisterRun => ({
    kind, ok, message, startedAt: startedAt.toISOString(), finishedAt: use.now().toISOString(), pages: 0, written: 0, removed: 0, skipped: 0, ...numbers, ...(trial ? { trial } : {}),
  });
  const record = async (run: RegisterRun, data: Prisma.WholesaleRegisterSyncUpdateInput = {}) => {
    const current = await prisma.wholesaleRegisterSync.findUnique({ where: { wholesaler }, select: { history: true } });
    const history = [run, ...(Array.isArray(current?.history) ? (current.history as RegisterRun[]) : [])].slice(0, HISTORY_KEEP);
    await prisma.wholesaleRegisterSync.update({ where: { wholesaler }, data: { ...data, lastRun: run as unknown as Prisma.InputJsonValue, history: history as unknown as Prisma.InputJsonValue } });
    return run;
  };
  // The connection first (2026-10-17): switched on, keys, sign-in, the catalogue answering – or nothing starts.
  const check = await use.preflight();
  if (!check.ok) return record(result(false, `${check.message} Ingen hämtning startades.`), { requestedKind: null });
  // Claim the run: only when no other run is alive.
  const claimed = await prisma.$executeRaw`
    UPDATE "WholesaleRegisterSync" SET "runId" = ${runId}, "runKind" = ${kind}, "runStartedAt" = ${startedAt}, "runHeartbeatAt" = ${startedAt}, "runPages" = 0, "runWritten" = 0, "cancelRequestedAt" = NULL, "updatedAt" = now(),
      "requestedKind" = CASE WHEN ${kind === "full" && !trial} THEN NULL ELSE "requestedKind" END
    WHERE "wholesaler" = ${wholesaler} AND ("runId" IS NULL OR "runHeartbeatAt" IS NULL OR "runHeartbeatAt" < ${new Date(startedAt.getTime() - STALE_MS)})`;
  if (!claimed) return result(false, "En annan hämtning pågår redan.");
  const state = await registerSyncState(wholesaler);
  let pages = 0;
  let written = 0;
  let skipped = 0;
  const finish = async (run: RegisterRun, data: Prisma.WholesaleRegisterSyncUpdateInput = {}) => {
    if (!run.ok) await prisma.$executeRaw`DELETE FROM "WholesaleArticle" AS w WHERE w."pendingRun" = ${runId} AND ${NO_PRICE}`;
    await record(run, { ...data, runId: null, runKind: null, runHeartbeatAt: null, runPages: null, runWritten: null, cancelRequestedAt: null });
    forgetRegisterPresence();
    return run;
  };
  try {
    // An unfinished full run of before (the process stopped) leaves hidden rows; they go before a new full run starts.
    if (kind === "full") await prisma.$executeRaw`DELETE FROM "WholesaleArticle" AS w WHERE w."wholesaler" = ${wholesaler} AND w."pendingRun" IS NOT NULL AND w."pendingRun" <> ${runId} AND ${NO_PRICE}`;
    if (kind === "changes" && !state.syncedFrom) return await finish(result(false, "Ingen tidigare hämtning att fortsätta från – hämta hela katalogen först."));
    const lastChanged = kind === "changes" && state.syncedFrom ? new Date(state.syncedFrom.getTime() - 3600_000) : null;
    let nextPage = "";
    const seen = new Set<string>();
    for (;;) {
      const page = await use.page({ limit: 1000, nextPage: nextPage || null, lastChanged, ignoreObsolete: kind === "full" });
      if (!page.ok) return await finish(result(false, `${page.message} Hämtningen stoppades på sida ${count(pages + 1)}. Inget av det som gäller ändrades.`, { pages, written, skipped }));
      pages += 1;
      written += await writePage(wholesaler, page.articles, runId, kind === "full" && !trial);
      skipped += page.skipped;
      // The heartbeat carries the counters for the card's progress line, and answers whether Avbryt was pressed.
      const beat = await prisma.wholesaleRegisterSync.update({ where: { wholesaler }, data: { runHeartbeatAt: use.now(), runPages: pages, runWritten: written }, select: { cancelRequestedAt: true } });
      if (beat.cancelRequestedAt) return await finish(result(false, "Avbruten av produktägaren. Det som den här körningen lade till är borttaget. Tidigare artiklar är orörda.", { pages, written, skipped, cancelled: true }));
      if (!page.nextPage || (trial && pages >= options.maxPages!)) break;
      if (seen.has(page.nextPage)) return await finish(result(false, "Solar gav samma sida två gånger – hämtningen avbröts.", { pages, written, skipped }));
      seen.add(page.nextPage);
      nextPage = page.nextPage;
      await use.pause(options.pauseMs ?? 250);
    }
    if (trial) return await finish(result(true, `Provhämtning: ${count(written)} artiklar från ${count(pages)} ${pages === 1 ? "sida" : "sidor"}. Inget togs bort och provet räknas inte som en hämtning.`, { pages, written, skipped }));
    if (kind === "changes") return await finish(result(true, `${count(written)} ändrade artiklar hämtade (${count(pages)} ${pages === 1 ? "sida" : "sidor"}).`, { pages, written, skipped }), { syncedFrom: startedAt });
    // A full run that has finished: its new rows become visible, and what it never saw is removed – in one transaction. An article
    // a company has a price on is never removed (the price history must stay): it is marked obsolete, status 40, and stays.
    const { removed, retired } = await prisma.$transaction(async (tx) => {
      await tx.$executeRaw`UPDATE "WholesaleArticle" SET "pendingRun" = NULL WHERE "pendingRun" = ${runId}`;
      const [{ live }] = await tx.$queryRaw<{ live: number }[]>`SELECT count(*)::int AS "live" FROM "WholesaleArticle" WHERE "wholesaler" = ${wholesaler} AND "seenRun" <> ${runId}`;
      if (live > written) return { removed: -live, retired: 0 };
      const retired = await tx.$executeRaw`UPDATE "WholesaleArticle" AS w SET "status" = '40', "updatedAt" = now()
        WHERE w."wholesaler" = ${wholesaler} AND w."seenRun" <> ${runId} AND w."status" <> '40' AND NOT (${NO_PRICE})`;
      const removed = await tx.$executeRaw`DELETE FROM "WholesaleArticle" AS w WHERE w."wholesaler" = ${wholesaler} AND w."seenRun" <> ${runId} AND ${NO_PRICE}`;
      return { removed, retired };
    }, { timeout: 300_000 });
    if (removed < 0) return await finish(result(true, `${count(written)} artiklar hämtade (${count(pages)} sidor). ${count(-removed)} äldre artiklar som Solar inte skickade fick ligga kvar, eftersom svaret var mindre än hälften av registret – kontrollera innan nästa genomgång.`, { pages, written, skipped }), { lastFullAt: startedAt, syncedFrom: startedAt });
    const kept = retired ? ` ${count(retired)} artiklar som företag har pris på står kvar som utgångna.` : "";
    return await finish(result(true, `${count(written)} artiklar hämtade (${count(pages)} sidor)${removed ? `, ${count(removed)} som Solar inte längre har togs bort` : ""}.${kept}`, { pages, written, removed, skipped, ...(retired ? { retired } : {}) }), { lastFullAt: startedAt, syncedFrom: startedAt });
  } catch (error) {
    const message = error instanceof Error ? error.message.slice(0, 200) : "okänt fel";
    return finish(result(false, `Hämtningen stoppades av ett fel (${message}). Inget av det som gäller ändrades.`, { pages, written, skipped }));
  }
}
