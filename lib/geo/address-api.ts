import { createHash } from "node:crypto";
import { parseAddressChoice, parseAddressCollection, type AddressFeatureCollection, type AddressProposal } from "./address-parse";
import { ADDRESS_SEARCH_HITS, addressSearchText, isAddressId, parseAddressReferences, type AddressChoice, type AddressSuggestion } from "./address-search";
import { sweref99Query, toSweref99Tm } from "./sweref99";

/**
 * Belägenhetsadress Direkt v4.2 – the calls themselves (2026-10-08, search 2026-10-15), kept apart from the
 * database so the unit tests drive them with a fake fetch. Checked against Lantmäteriet's published interface
 * (OpenAPI belagenhetsadress-4.2.2 and the product's Teknisk beskrivning on Geotorget):
 * - Base addresses: api.lantmateriet.se (production) and api-ver.lantmateriet.se (verification), path
 *   /distribution/produkter/belagenhetsadress/v4.2. JSON is asked for with Accept: application/json.
 * - Sign-in: HTTP Basic with the Geotorget account's user name and password (offered since 2025-02-03), or OAuth 2 client
 *   credentials from the API portal of the same environment, with the scope belagenhetsadress_direkt_v42_read.
 * - GET /punkt?punktSrid&koordinater=<northing>,<easting>&includeData&srid: the address nearest a point (SWEREF 99 only).
 * - GET /referens/fritext?adress&maxHits&splitAdress: references (objektidentitet, the address as a label, its parts)
 *   for a search string of 3–300 characters.
 * - GET /{id}?includeData&srid: one address by its objektidentitet, with the address point.
 * - Errors come as an HTTP status with a Fault body (code, reason, errors); the text is never passed on, since it may
 *   repeat what was typed.
 * Nothing from a question or an answer is logged here.
 */
export const ADDRESS_HOSTS = {
  verification: { api: "https://api-ver.lantmateriet.se/distribution/produkter/belagenhetsadress/v4.2", token: "https://apimanager-ver.lantmateriet.se/oauth2/token" },
  production: { api: "https://api.lantmateriet.se/distribution/produkter/belagenhetsadress/v4.2", token: "https://apimanager.lantmateriet.se/oauth2/token" },
} as const;
export type AddressEnvironment = keyof typeof ADDRESS_HOSTS;
/** The OAuth scope the product's interface names for reading. */
export const ADDRESS_SCOPE = "belagenhetsadress_direkt_v42_read";
/** SWEREF 99 TM, the reference system Workflow asks in and wants answers in. */
const SRID = "3006";

/** The ways to sign in: the map's Geotorget account (Basic), a user name and password of its own (Basic), OAuth keys. */
export type AddressMethod = "map" | "basic" | "oauth";
/**
 * The chosen way to sign in. Before anything is chosen: OAuth keys already saved (all that existed before 2026-10-15) keep
 * working as OAuth; otherwise the map's account when the map has one, else a user name and password of its own.
 */
export function chooseAddressMethod(stored: { method?: AddressMethod; keyCipher?: string; secretCipher?: string }, mapHasSignIn: boolean): AddressMethod {
  return stored.method ?? (stored.keyCipher && stored.secretCipher ? "oauth" : mapHasSignIn ? "map" : "basic");
}

export type AddressAuth ={ kind: "basic"; user: string; password: string } | { kind: "oauth"; key: string; secret: string };
export type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

export class LookupError extends Error {}

/** Query values encoded for a URL; commas stay as they are, as in Lantmäteriet's own examples (koordinater=N,E). */
const query = (params: [string, string][]) => params.map(([key, value]) => `${key}=${encodeURIComponent(value).replace(/%2C/gi, ",")}`).join("&");
const basic = (user: string, password: string) => `Basic ${Buffer.from(`${user}:${password}`).toString("base64")}`;

/** Where each operation is asked, exactly (used by the client and checked by the tests). */
export const addressUrls = {
  nearest: (environment: AddressEnvironment, latitude: number, longitude: number) =>
    `${ADDRESS_HOSTS[environment].api}/punkt?${query([["punktSrid", SRID], ["koordinater", sweref99Query(toSweref99Tm(latitude, longitude))], ["includeData", "basinformation"], ["srid", SRID]])}`,
  search: (environment: AddressEnvironment, text: string, maxHits = ADDRESS_SEARCH_HITS) =>
    `${ADDRESS_HOSTS[environment].api}/referens/fritext?${query([["adress", text], ["maxHits", String(maxHits)], ["splitAdress", "true"]])}`,
  byId: (environment: AddressEnvironment, id: string) =>
    `${ADDRESS_HOSTS[environment].api}/${encodeURIComponent(id)}?${query([["includeData", "basinformation"], ["srid", SRID]])}`,
};

/** Tokens per environment and key, in memory only until they expire; never stored or logged. */
const sharedTokens = new Map<string, { value: string; expiresAt: number }>();
export const clearAddressTokens = () => sharedTokens.clear();

export function createAddressClient(environment: AddressEnvironment, auth: AddressAuth, options: { fetch?: FetchLike; tokens?: Map<string, { value: string; expiresAt: number }>; now?: () => number } = {}) {
  const doFetch: FetchLike = options.fetch ?? ((input, init) => fetch(input, init));
  const tokens = options.tokens ?? sharedTokens;
  const now = options.now ?? Date.now;
  const tokenId = auth.kind === "oauth" ? createHash("sha256").update(`${environment}:${auth.key}`).digest("hex") : "";

  async function token() {
    if (auth.kind !== "oauth") throw new LookupError("Ingen API-nyckel.");
    const cached = tokens.get(tokenId);
    if (cached && cached.expiresAt > now()) return cached.value;
    const response = await doFetch(ADDRESS_HOSTS[environment].token, {
      method: "POST",
      headers: { authorization: basic(auth.key, auth.secret), "content-type": "application/x-www-form-urlencoded", accept: "application/json" },
      body: query([["grant_type", "client_credentials"], ["scope", ADDRESS_SCOPE]]),
      signal: AbortSignal.timeout(10_000),
    });
    if (response.status === 400 || response.status === 401 || response.status === 403) throw new LookupError("Lantmäteriet godtar inte API-nyckeln och hemligheten.");
    if (!response.ok) throw new LookupError(`Lantmäteriets inloggning svarade ${response.status}.`);
    const data = await response.json().catch(() => ({})) as { access_token?: string; expires_in?: number };
    if (!data.access_token) throw new LookupError("Lantmäteriets inloggning gav ingen åtkomstnyckel.");
    tokens.set(tokenId, { value: data.access_token, expiresAt: now() + Math.max(30, (data.expires_in ?? 3600) - 60) * 1000 });
    return data.access_token;
  }

  /** One GET with the sign-in; null for 404 (no such address). An expired token is fetched again once. */
  async function get(url: string, retried = false): Promise<unknown> {
    const authorization = auth.kind === "basic" ? basic(auth.user, auth.password) : `Bearer ${await token()}`;
    const response = await doFetch(url, { headers: { authorization, accept: "application/json" }, signal: AbortSignal.timeout(10_000) });
    if (response.status === 401 && auth.kind === "oauth" && !retried) { tokens.delete(tokenId); return get(url, true); }
    if (response.status === 401) { if (auth.kind === "oauth") tokens.delete(tokenId); throw new LookupError(auth.kind === "basic" ? "Lantmäteriet godtar inte användarnamnet och lösenordet." : "Lantmäteriet godtar inte API-nyckeln."); }
    if (response.status === 403) throw new LookupError("Kontot har inte behörighet till Belägenhetsadress Direkt i den här miljön.");
    if (response.status === 404) return null;
    if (response.status === 429) throw new LookupError("Lantmäteriet tar emot för många frågor just nu. Försök om en stund.");
    if (response.status === 400) throw new LookupError("Lantmäteriet tog inte emot frågan.");
    if (!response.ok) throw new LookupError(`Lantmäteriet svarade ${response.status}.`);
    return response.json().catch(() => { throw new LookupError("Lantmäteriets svar gick inte att läsa."); });
  }

  return {
    /** The address nearest a WGS 84 point, measured from it; null when there is none. */
    async nearest(latitude: number, longitude: number): Promise<AddressProposal | null> {
      const answer = await get(addressUrls.nearest(environment, latitude, longitude));
      return answer ? parseAddressCollection(answer as AddressFeatureCollection, toSweref99Tm(latitude, longitude)) : null;
    },
    /** Suggestions for what is typed; none (and no question) for less than three characters. */
    async search(text: string, maxHits = ADDRESS_SEARCH_HITS): Promise<AddressSuggestion[]> {
      const cleaned = addressSearchText(text);
      if (!cleaned) return [];
      return parseAddressReferences(await get(addressUrls.search(environment, cleaned, maxHits)), maxHits);
    },
    /** One address by Lantmäteriet's id, with its point in WGS 84; null when it does not exist. */
    async byId(id: string): Promise<AddressChoice | null> {
      if (!isAddressId(id)) return null;
      const answer = await get(addressUrls.byId(environment, id));
      return answer ? parseAddressChoice(answer as AddressFeatureCollection) : null;
    },
  };
}
