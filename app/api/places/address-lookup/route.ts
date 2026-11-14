import { NextResponse } from "next/server";
import { z } from "zod";
import { addressById, addressLookupAvailable, lookupAddress, LookupError, searchAddresses } from "@/lib/geo/address-lookup";
import { ADDRESS_SEARCH_MAX, addressSearchText, isAddressId } from "@/lib/geo/address-search";
import { ApiError, body, checkOrigin, context, failure } from "@/lib/kfid/server";
import { hitRateLimit, RATE_RULES } from "@/lib/security/rate-limit";

export const dynamic = "force-dynamic";

const headers = { "Cache-Control": "private, no-store" };

/** Adresser are only offered in Cloud (the application to Lantmäteriet describes the hosted version). */
async function offered() {
  const ctx = await context();
  return { ctx, available: ctx.organization.storageMode === "HINTEK_CLOUD" && (await addressLookupAvailable()) };
}
const unreachable = (cause: unknown) => cause instanceof LookupError ? new ApiError(502, cause.message) : new ApiError(502, "Lantmäteriet svarade inte. Skriv adressen själv eller försök igen.");

/**
 * Whether address proposals and search are offered at all (a signed-in member of a Cloud company, and the installation
 * has a working sign-in to Lantmäteriet). The pin's lookup itself is a POST since 2026-10-15 (the coordinates
 * never stand in an address, and so in no access log), like the search.
 */
export async function GET(request: Request) {
  try {
    const { available } = await offered();
    const params = new URL(request.url).searchParams;
    if (params.has("lat") || params.has("lon")) throw new ApiError(400, "Skicka punkten med POST.");
    return NextResponse.json({ available }, { headers });
  } catch (error) {
    return failure(error);
  }
}

const searchInput = z.discriminatedUnion("action", [
  z.object({ action: z.literal("point"), lat: z.number().finite().min(-90).max(90), lon: z.number().finite().min(-180).max(180) }).strict(),
  z.object({ action: z.literal("search"), text: z.string().max(ADDRESS_SEARCH_MAX * 3) }).strict(),
  z.object({ action: z.literal("pick"), id: z.string().refine(isAddressId, "Okänd adress.") }).strict(),
]);

/**
 * Adressökning medan man skriver (2026-10-15): "search" gives suggestions for what is typed in Gatuadress och
 * husnummer, "pick" fetches the chosen one with its address point for the pin. A POST with the text in the body, so
 * the typed address never stands in a URL (and so in no access log); same session, Cloud and Origin checks as every
 * mutation, and a per-person limit of its own so typing never uses up the pin's lookups. The typed text is not logged
 * and nothing is stored.
 */
export async function POST(request: Request) {
  try {
    checkOrigin(request);
    const { ctx, available } = await offered();
    if (!available) return NextResponse.json({ available: false }, { headers });
    const input = searchInput.parse(await body(request));
    // Adressförslag från kartnålen (2026-10-08): the address nearest the pin; rate-limited per person like
    // Företagsuppslag; nothing personal is logged and nothing from the answer is stored – only what the person then saves.
    if (input.action === "point") {
      if (!(await hitRateLimit(RATE_RULES.addressLookupUser, ctx.user.id)).allowed) throw new ApiError(429, "För många adressuppslag just nu. Skriv adressen själv eller försök om en stund.");
      try {
        return NextResponse.json({ available: true, ...(await lookupAddress(input.lat, input.lon)) }, { headers });
      } catch (cause) {
        throw unreachable(cause);
      }
    }
    if (input.action === "search") {
      const text = addressSearchText(input.text);
      // Too short to ask about: no suggestions, no question to Lantmäteriet and nothing counted.
      if (!text) return NextResponse.json({ available: true, suggestions: [] }, { headers });
      if (!(await hitRateLimit(RATE_RULES.addressSearchUser, ctx.user.id)).allowed) throw new ApiError(429, "För många adressökningar just nu. Skriv adressen själv eller försök om en stund.");
      try {
        return NextResponse.json({ available: true, suggestions: await searchAddresses(text) }, { headers });
      } catch (cause) {
        throw unreachable(cause);
      }
    }
    if (!(await hitRateLimit(RATE_RULES.addressLookupUser, ctx.user.id)).allowed) throw new ApiError(429, "För många adressuppslag just nu. Skriv adressen själv eller försök om en stund.");
    try {
      const choice = await addressById(input.id);
      return NextResponse.json({ available: true, ...(choice ? { found: true, choice } : { found: false, reason: "Lantmäteriet hittar inte adressen längre." }) }, { headers });
    } catch (cause) {
      throw unreachable(cause);
    }
  } catch (error) {
    return failure(error);
  }
}
