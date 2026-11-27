import { NextResponse } from "next/server";
import { z } from "zod";
import { context, failure, requireCloudStorage } from "@/lib/kfid/server";
import { parseSearchQuery, SEARCH_MAX_LENGTH, searchTooShort } from "@/lib/search/query";
import { searchCloud } from "@/lib/search/server";
import { SEARCH_TYPES } from "@/lib/search/types";

export const dynamic = "force-dynamic";

const querySchema = z.object({
  q: z.string().max(SEARCH_MAX_LENGTH).default(""),
  /** "Visa alla" in one group: more hits of that kind only. */
  type: z.enum(SEARCH_TYPES).nullable().default(null),
});

/**
 * Sök (Ctrl K) in Cloud (2026-10-05): ranked hits grouped by kind, inside the person's company and rights.
 * Pages and forms are ranked in the browser; a Local company searches its open file and never calls this.
 */
export async function GET(request: Request) {
  try {
    const started = performance.now();
    const ctx = await context();
    requireCloudStorage(ctx);
    const url = new URL(request.url);
    const input = querySchema.parse({ q: url.searchParams.get("q") ?? "", type: url.searchParams.get("type") || null });
    const parsed = parseSearchQuery(input.q);
    const result = !parsed.active || searchTooShort(parsed) ? { groups: [], fuzzy: false } : await searchCloud(ctx, parsed, { expand: input.type });
    return NextResponse.json(result, { headers: { "Cache-Control": "private, no-store", "Server-Timing": `search;dur=${Math.round(performance.now() - started)}` } });
  } catch (error) {
    return failure(error);
  }
}
