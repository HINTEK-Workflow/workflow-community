import "server-only";
import { prisma } from "@/lib/db";
import type { Context } from "@/lib/kfid/server";
import { typoAllowance } from "./normalize";
import { trigramSchema } from "./trgm";
import type { ParsedSearch } from "./query";
import { rankCandidates, type GroupTotals } from "./score";
import { buildSearchSql, placePathsSql, SEARCH_FETCH, SEARCH_FETCH_ONE_TYPE, searchSpecs, TYPO_PASS_BELOW, TYPO_SIMILARITY, type PlacePaths, type SearchRow, type SearchSpec } from "./sql";
import type { SearchResponse, SearchType } from "./types";

/**
 * The schema pg_trgm is in, or false when it is not installed (the migration tries; a database without it still
 * searches, only typos differ). The operator is qualified with that schema (lib/search/trgm-sql.ts, 2026-10-12).
 */
async function hasTrigram(): Promise<string | false> {
  return (await trigramSchema()) ?? false;
}

// The company's place ways (quality check 2026-10-05, F10): computed once per search instead of once per kind, and kept
// for a short while as long as no place or customer has changed (count and latest change are checked every time).
const PLACE_PATH_TTL_MS = 60_000;
const PLACE_PATH_CACHE_MAX = 200;
const placePathCache = new Map<string, { key: string; at: number; value: PlacePaths }>();
async function placePaths(organizationId: string): Promise<PlacePaths> {
  const [state] = await prisma.$queryRaw<{ places: number; placeAt: Date | null; customerAt: Date | null }[]>`
    SELECT (SELECT count(*) FROM "CustomerFacility" WHERE "organizationId" = ${organizationId})::int AS places,
      (SELECT max("updatedAt") FROM "CustomerFacility" WHERE "organizationId" = ${organizationId}) AS "placeAt",
      (SELECT max("updatedAt") FROM "Customer" WHERE "organizationId" = ${organizationId}) AS "customerAt"`;
  const key = `${state?.places ?? 0}|${state?.placeAt?.toISOString() ?? ""}|${state?.customerAt?.toISOString() ?? ""}`;
  const cached = placePathCache.get(organizationId);
  if (cached && cached.key === key && Date.now() - cached.at < PLACE_PATH_TTL_MS) return cached.value;
  const rows = state?.places ? await prisma.$queryRaw<{ id: string; path: string | null }[]>(placePathsSql(organizationId)) : [];
  const value = { ids: rows.map((row) => row.id), paths: rows.map((row) => row.path ?? "") };
  if (placePathCache.size >= PLACE_PATH_CACHE_MAX) placePathCache.delete(placePathCache.keys().next().value!);
  placePathCache.set(organizationId, { key, at: Date.now(), value });
  return value;
}

async function run(spec: SearchSpec, parsed: ParsedSearch, organizationId: string, limit: number, mode: "match" | "typo", trigram: string | false, places: PlacePaths | undefined) {
  return prisma.$queryRaw<SearchRow[]>(buildSearchSql(spec, parsed, organizationId, limit, mode, trigram, places));
}

/** The typing-error pass for every kind at once; with pg_trgm the similarity threshold is set once, for this transaction. */
async function runTypos(specs: SearchSpec[], parsed: ParsedSearch, organizationId: string, limit: number, trigram: string | false, places: PlacePaths | undefined) {
  if (!trigram) return Promise.all(specs.map((spec) => run(spec, parsed, organizationId, limit, "typo", false, places)));
  return prisma.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT set_config('pg_trgm.word_similarity_threshold', ${String(TYPO_SIMILARITY)}, true)`;
    const results: SearchRow[][] = [];
    for (const spec of specs) results.push(await tx.$queryRaw<SearchRow[]>(buildSearchSql(spec, parsed, organizationId, limit, "typo", trigram, places)));
    return results;
  });
}

/**
 * Sök for one company and person (2026-10-05); `expand` asks for more of one kind ("Visa alla"). The queries
 * (lib/search/sql.ts) only read what the person may see; the ranking is the same as in Local and the demo.
 */
export async function searchCloud(ctx: Context, parsed: ParsedSearch, options: { expand?: SearchType | null; now?: number } = {}): Promise<SearchResponse> {
  if (!parsed.active) return { groups: [], fuzzy: false };
  const scoped: ParsedSearch = options.expand ? { ...parsed, filters: { ...parsed.filters, types: [options.expand] } } : parsed;
  const limit = options.expand ? SEARCH_FETCH_ONE_TYPE : SEARCH_FETCH;
  const typos = scoped.terms.some((term) => typoAllowance(term.text.length) > 0 && !/\d/.test(term.text));
  const trigram = typos ? await hasTrigram() : false;
  const access = { organizationId: ctx.organizationId, userId: ctx.user.id, admin: ctx.admin, workflowPermissions: ctx.workflowPermissions, disabledModules: ctx.organization.disabledModules };
  const specs = searchSpecs(access, scoped);
  const places = specs.some((spec) => spec.paths) ? await placePaths(ctx.organizationId) : undefined;
  const totals: GroupTotals = {};
  const matched = await Promise.all(specs.map(async (spec) => {
    const rows = await run(spec, scoped, ctx.organizationId, limit, "match", trigram, places);
    totals[spec.type] = { total: Number(rows[0]?.searchTotal ?? 0), fetched: rows.length };
    return rows.map(spec.map);
  }));
  // Few exact hits in the whole search: look for titles with a typing error as well – one pass, not one per kind.
  if (typos && matched.reduce((sum, rows) => sum + rows.length, 0) < TYPO_PASS_BELOW) {
    const typoRows = await runTypos(specs, scoped, ctx.organizationId, limit, trigram, places);
    specs.forEach((spec, index) => {
      const seen = new Set(matched[index].map((candidate) => candidate.id));
      for (const row of typoRows[index]) {
        const candidate = spec.map(row);
        if (!seen.has(candidate.id)) matched[index].push({ ...candidate, guaranteed: false });
      }
    });
  }
  const ids = new Set(scoped.ids);
  const candidates = matched.flat().map((candidate) => (ids.has(candidate.id) ? { ...candidate, exactId: true } : candidate));
  return rankCandidates(scoped, candidates, { totals, now: options.now, perGroup: options.expand ? 30 : 6 });
}
