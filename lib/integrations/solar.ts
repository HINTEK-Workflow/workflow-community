/**
 * Solars API, bara läsning (2026-10-13 natt: "Jag lägger in nycklarna, prova sen"): Workflow's client id and secret
 * from Solar are entered under Installation → Servernycklar; Kontrollera fetches a token and the accounts the
 * client carries and one page of the catalogue's categories – nothing else. Never a price (Workflow gets no price API from
 * Solar, decision 2026-10-13), never an order. The secret never leaves the server and is never in an address or a log
 * (the portal's GET token-with-secret-in-the-address is not used).
 *
 * The addresses are Solar's own, from apiportal.solar.eu (Getting Started): Azure AD B2C client credentials, the
 * secret in the request body, scope api.procurement/.default, the token valid 60 minutes; the API Procurement Services V1.
 *
 * Every call checked against the portal's definition (xapi-procurementservices, api-version 2022-04-01-preview, read
 * 2026-10-15). Only these are used, with exactly the parameters the portal documents – nothing added:
 * - Get Accounts     GET /accounts                                  (no parameters)
 * - Get Categories   GET /catalogs/categories?limit=&countrycode=   (+ the optional nextpage; limit at most 1000)
 * - Get Product      GET /catalogs/{catalogId}/products/{productId}?countrycode=&productIdentifier=
 * The query name is lower-case `countrycode` in all three (only delivery addresses and project accounts, which need an
 * account and are never used here, spell it `countryCode`).
 *
 * Three different ids, never mixed up:
 * - category id: Solar's integer `id` of a category (and `parent`, the parent category's id as a string). Categories
 *   belong to no catalogue: Get Categories takes no catalogId.
 * - product id: the `{productId}` path value, read as the field `productIdentifier` names (electricalNumber = E-nummer,
 *   eanNumber = GTIN/EAN, hwsNumber, sapMaterialNumber). The portal types it int32, which a 13-digit GTIN does not fit.
 * - catalog id: `{catalogId}`, "the id of the catalog", needed only by Get Product/Get Products. No call returns it (the
 *   accounts carry accountId only), so it is a product-owner setting given by Solar and never guessed.
 */
import { publicInstance } from "@/lib/instance";
import { tradeUnit } from "@/lib/catalogue/units";
import { gtinOf } from "@/lib/catalogue/normalize";

export const SOLAR_TOKEN_URL = "https://sgidp.b2clogin.com/sgidp.onmicrosoft.com/b2c_1a_client_credentials/oauth2/v2.0/token";
export const SOLAR_SCOPE = "https://sgidp.onmicrosoft.com/api.procurement/.default";
export const SOLAR_API_BASE = "https://api.solar.eu/procurement/V1";

type Fetch = typeof fetch;
type Credentials = { clientId: string; clientSecret: string };

/**
 * Sweden in Solar's `countrycode`. The portal only says "the language of the category" and gives no value for Sweden
 * (its best-practice example is a lower-case `dk`), so Kontrollera tries these in order and the first one Solar answers
 * with categories is kept as a product-owner setting (2026-10-15). "SE" applies until a check has found one.
 */
export const SOLAR_COUNTRY = "SE";
export const SOLAR_COUNTRY_CANDIDATES = ["SE", "se", "sv"] as const;
export type SolarCountryCode = (typeof SOLAR_COUNTRY_CANDIDATES)[number];
export const isSolarCountryCode = (value: string): value is SolarCountryCode => (SOLAR_COUNTRY_CANDIDATES as readonly string[]).includes(value);

/** Get Categories' address: limit and countrycode always, nextpage only after the first page. */
export const solarCategoriesUrl = (countryCode: string, limit: number, nextPage?: string | null) =>
  `${SOLAR_API_BASE}/catalogs/categories?limit=${limit}&countrycode=${encodeURIComponent(countryCode)}${nextPage ? `&nextpage=${encodeURIComponent(nextPage)}` : ""}`;

const text = (value: unknown, max = 300) => (typeof value === "string" ? value.replace(/\s+/g, " ").trim().slice(0, max) : typeof value === "number" ? String(value) : "");
const bearer = (token: string) => ({ Authorization: `Bearer ${token}`, Accept: "application/json" });

/** The `categories.category` list of a Get Categories answer, [] when there is none. */
const categoryList = (raw: unknown): unknown[] => {
  const body = camelKeys(raw);
  const list = (body as { categories?: { category?: unknown } } | null)?.categories?.category;
  return Array.isArray(list) ? list : [];
};

/** Which candidate Solar accepted, or why none: a page of categories asked for with each in turn (limit=1). */
export type SolarCountryProbe =
  | { status: "accepted"; countryCode: SolarCountryCode; total: number | null; tried: { countryCode: string; answer: string }[] }
  | { status: "denied" }
  | { status: "none"; tried: { countryCode: string; answer: string }[] };

export async function probeSolarCountryCode(token: string, fetcher: Fetch = fetch): Promise<SolarCountryProbe> {
  const tried: { countryCode: string; answer: string }[] = [];
  for (const countryCode of SOLAR_COUNTRY_CANDIDATES) {
    let answer: string;
    try {
      const response = await fetcher(solarCategoriesUrl(countryCode, 1), { headers: bearer(token), signal: AbortSignal.timeout(10_000) });
      // No access to the catalogue is not a matter of the country code; asking again with another would not help.
      if (response.status === 401 || response.status === 403) return { status: "denied" };
      if (response.ok) {
        const body = camelKeys(await response.json().catch(() => null)) as { requestInfo?: { total?: unknown } } | null;
        const total = typeof body?.requestInfo?.total === "number" ? body.requestInfo.total : null;
        if (categoryList(body).length > 0 || (total ?? 0) > 0) return { status: "accepted", countryCode, total, tried };
        answer = "inga kategorier";
      } else answer = `fel ${response.status}`;
    } catch {
      answer = "inget svar";
    }
    tried.push({ countryCode, answer });
  }
  return { status: "none", tried };
}

/** Get Products' address (definition 2022-04-01-preview): catalogId in the path, countrycode and limit always, nextpage after the first page. */
export const solarProductsUrl = (catalogId: string, countryCode: string, limit: number, nextPage?: string | null) =>
  `${SOLAR_API_BASE}/catalogs/${encodeURIComponent(catalogId)}/products?countrycode=${encodeURIComponent(countryCode)}&limit=${limit}${nextPage ? `&nextpage=${encodeURIComponent(nextPage)}` : ""}`;

/**
 * Solar's live answers (2026-10-16) name their fields with a capital first letter – Name, ElectricalNo, Gtin, BrandName,
 * ImageLinks[].Url – where the portal's definition shows name, electricalNo, gtin. Every answer is read with the first
 * letter of each key made small, at every level, so both spellings read the same.
 */
export function camelKeys(value: unknown, depth = 0): unknown {
  if (depth > 6) return value;
  if (Array.isArray(value)) return value.map((item) => camelKeys(item, depth + 1));
  if (!value || typeof value !== "object") return value;
  const result: Record<string, unknown> = {};
  for (const [key, inner] of Object.entries(value as Record<string, unknown>)) {
    const name = key ? key[0].toLowerCase() + key.slice(1) : key;
    if (!(name in result)) result[name] = camelKeys(inner, depth + 1);
  }
  return result;
}

/** The products of a Get Products answer, read tolerantly ({ products: [...] }, { products: { product: [...] } } or a bare list); [] when none. */
const productList = (raw: unknown): unknown[] => {
  const body = camelKeys(raw);
  const products = (body as { products?: unknown } | null)?.products;
  if (Array.isArray(products)) return products;
  const nested = (products as { product?: unknown } | null | undefined)?.product;
  return Array.isArray(nested) ? nested : Array.isArray(body) ? body : [];
};

/**
 * Produktkatalogen (Solar till 2026-10-16: "Det borde fungera med Get Product och Get Products", Catalog ID för
 * Sverige): one product asked for with each country-code candidate (limit=1) until Solar answers with one. The name of
 * that product is said back as proof; nothing is stored. The categories may be empty for Sweden while the products are not.
 */
/** The names of a product's fields, one level deep ("a, b, c.d"), at most 40 – never a value. */
export function productFieldNames(item: Record<string, unknown>): string {
  const names: string[] = [];
  for (const [key, value] of Object.entries(item)) {
    if (value && typeof value === "object" && !Array.isArray(value)) for (const inner of Object.keys(value as object)) names.push(`${key}.${inner}`);
    else names.push(Array.isArray(value) ? `${key}[]` : key);
  }
  return names.slice(0, 40).map((name) => name.replace(/[^\w.[\]-]/g, "").slice(0, 40)).join(", ");
}

export type SolarProductProbe =
  | { status: "accepted"; countryCode: SolarCountryCode; sample: string; fields: string; tried: { countryCode: string; answer: string }[] }
  | { status: "denied"; code: number }
  | { status: "none"; tried: { countryCode: string; answer: string }[] };

export async function probeSolarProducts(token: string, catalogId: string, fetcher: Fetch = fetch): Promise<SolarProductProbe> {
  const tried: { countryCode: string; answer: string }[] = [];
  for (const countryCode of SOLAR_COUNTRY_CANDIDATES) {
    let answer: string;
    try {
      const response = await fetcher(solarProductsUrl(catalogId, countryCode, 1), { headers: bearer(token), signal: AbortSignal.timeout(15_000) });
      if (response.status === 401 || response.status === 403) return { status: "denied", code: response.status };
      if (response.ok) {
        const first = productList(await response.json().catch(() => null))[0] as Record<string, unknown> | undefined;
        // The same reader as the article search (solarMasterData); without a readable name the field NAMES are said – never a value.
        if (first) return { status: "accepted", countryCode, sample: solarMasterData(first)?.name ?? "", fields: productFieldNames(solarProductOf(first) ?? (first as Record<string, unknown>)), tried };
        answer = "inga produkter";
      } else answer = `fel ${response.status}`;
    } catch {
      answer = "inget svar";
    }
    tried.push({ countryCode, answer });
  }
  return { status: "none", tried };
}

const triedText = (tried: { countryCode: string; answer: string }[]) => tried.map((item) => `”${item.countryCode}” (${item.answer})`).join(", ");

/**
 * The check under Servernycklar: a token, the accounts, then one page of the catalogue's categories per country-code
 * candidate until Solar answers with categories. Plain words back, never a value; `countryCode` is the one Solar
 * accepted, for the caller to keep. The accounts are only needed for Solar's prices, orders and delivery addresses,
 * which Workflow never uses; the catalogue and the stock need no account, so "0 konton" is not an error.
 */
export async function checkSolarKeys(credentials: Credentials, fetcher: Fetch = fetch, catalogId = ""): Promise<{ ok: boolean; message: string; countryCode?: SolarCountryCode }> {
  const timeout = () => AbortSignal.timeout(10_000);
  let token: string;
  try {
    const response = await fetcher(SOLAR_TOKEN_URL, {
      method: "POST", signal: timeout(),
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ grant_type: "client_credentials", client_id: credentials.clientId, client_secret: credentials.clientSecret, scope: SOLAR_SCOPE }),
    });
    if (!response.ok) return { ok: false, message: response.status === 400 || response.status === 401 ? "Solar godkände inte klient-id och hemlighet." : `Solars inloggning svarade med fel (${response.status}).` };
    const body = (await response.json().catch(() => null)) as { access_token?: unknown } | null;
    if (typeof body?.access_token !== "string" || !body.access_token) return { ok: false, message: "Solars inloggning gav ingen token." };
    token = body.access_token;
  } catch {
    return { ok: false, message: "Solars inloggning svarade inte." };
  }
  let accounts: number;
  try {
    const response = await fetcher(`${SOLAR_API_BASE}/accounts`, { headers: bearer(token), signal: timeout() });
    if (response.status === 401 || response.status === 403) return { ok: false, message: "Inloggningen lyckades, men Solar gav inte tillgång till kontona (kontakta Solar om behörigheten)." };
    if (!response.ok) return { ok: false, message: `Inloggningen lyckades, men kontolistan svarade med fel (${response.status}).` };
    const body = (await response.json().catch(() => null)) as unknown;
    accounts = (Array.isArray(body) ? body : Array.isArray((body as { accounts?: unknown })?.accounts) ? (body as { accounts: unknown[] }).accounts : []).length;
  } catch {
    return { ok: false, message: "Inloggningen lyckades, men Solars API svarade inte." };
  }
  const accountText = `klienten bär ${accounts} ${accounts === 1 ? "konto" : "konton"}${accounts ? "" : " (behövs bara för Solars priser och beställningar, som Workflow inte använder)"}`;
  const probe = await probeSolarCountryCode(token, fetcher);
  // With the catalogue number (2026-10-16) the products decide: they are what the article search reads.
  const products = /^\d{1,9}$/.test(catalogId) ? await probeSolarProducts(token, catalogId, fetcher) : null;
  if (products?.status === "accepted") {
    // Short (2026-10-16): that it works, the country code, and the categories in a few words. Without a readable
    // product name the field names follow – never a value – so the article search can be made to read them.
    const categories = probe.status === "accepted" ? "" : " Inga kategorier för Sverige.";
    const name = products.sample ? "" : ` Produktens fält: ${products.fields}.`;
    return { ok: true, countryCode: products.countryCode, message: `Solar fungerar: produktkatalogen ${catalogId} är öppen (landskod ${products.countryCode}).${categories}${name}` };
  }
  const productText = !products ? "" : products.status === "denied" ? ` Produktkatalogen ${catalogId} är inte öppen för klienten (fel ${products.code}) – kontakta Solar.` : ` Produktkatalogen ${catalogId} gav inga produkter: ${triedText(products.tried)}.`;
  if (probe.status === "denied") return { ok: false, message: `Inloggningen fungerar och ${accountText}, men Solar gav inte tillgång till katalogen (kontakta Solar om behörigheten).${productText}` };
  if (probe.status === "none") return { ok: false, message: `Inloggningen fungerar och ${accountText}, men katalogen godtog ingen av landskoderna: ${triedText(probe.tried)}.${productText}` };
  const refused = probe.tried.length ? ` (${triedText(probe.tried)} godtogs inte)` : "";
  return {
    ok: !products, countryCode: probe.countryCode,
    message: `Solar svarar: inloggningen fungerar, katalogen är öppen${probe.total ? ` (${probe.total.toLocaleString("sv-SE")} kategorier)` : ""} med landskoden ”${probe.countryCode}”${refused} och ${accountText}. Inga priser eller beställningar hämtades.${productText}`,
  };
}

/**
 * Grunddata från Solars katalog (2026-10-14: "använd API:t i sökfältet"): one product looked up by its E-nummer,
 * GTIN/EAN or Solar's own numbers – name, unit, GTIN, manufacturer, the manufacturer's number and an image link. Never a
 * price: the answer's listPrice is never read (prices come from the company's own price files). The token is kept in
 * memory per client until shortly before it expires; the secret only ever goes in the token request's body.
 */
export type SolarIdentifier = "electricalNumber" | "eanNumber" | "hwsNumber" | "sapMaterialNumber";
export type SolarMasterData = {
  source: "solar";
  name: string; unit: string; eNumber: string; gtin: string; manufacturer: string; manufacturerArticleNo: string;
  /** Solar's own numbers (2026-10-15): the SAP material number (the only one Solar's price and order calls take) and the HWS number; "" when absent. */
  sapMaterialNumber?: string; hwsNumber?: string;
  /** Solar's productStatus as written: 10 active, 11 active at another central stock, 33 going out, 40 obsolete (Solar's documented codes). */
  imageUrl: string; status: string; fetchedAt: string;
};

/** Solar's product status codes in plain words; an active article (10) and anything unknown say nothing. */
export const SOLAR_STATUS_TEXT: Record<string, string> = { "11": "Aktiv – annat centrallager hos Solar", "33": "På väg att utgå hos Solar", "40": "Utgången hos Solar" };
export const solarStatusText = (status: string | undefined) => SOLAR_STATUS_TEXT[(status ?? "").trim()] ?? "";
/** Obsolete at Solar (40): never the article the search suggests first, and said as such. */
export const solarObsolete = (status: string | undefined) => (status ?? "").trim() === "40";
export type SolarLookup = { status: "found"; data: SolarMasterData } | { status: "not-found" } | { status: "error"; message: string };

let tokenCache: { clientId: string; token: string; until: number } | null = null;

/** Workflow's token for Solar's API, from memory while it is valid (60 minutes, renewed five minutes before). */
export async function solarToken(credentials: Credentials, fetcher: Fetch = fetch): Promise<string | null> {
  if (tokenCache && tokenCache.clientId === credentials.clientId && tokenCache.until > Date.now()) return tokenCache.token;
  const response = await fetcher(SOLAR_TOKEN_URL, {
    method: "POST", signal: AbortSignal.timeout(10_000),
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ grant_type: "client_credentials", client_id: credentials.clientId, client_secret: credentials.clientSecret, scope: SOLAR_SCOPE }),
  });
  if (!response.ok) return null;
  const body = (await response.json().catch(() => null)) as { access_token?: unknown; expires_in?: unknown } | null;
  if (typeof body?.access_token !== "string" || !body.access_token) return null;
  const seconds = typeof body.expires_in === "number" && body.expires_in > 0 ? body.expires_in : 3600;
  tokenCache = { clientId: credentials.clientId, token: body.access_token, until: Date.now() + Math.max(60, seconds - 300) * 1000 };
  return body.access_token;
}

/** Forgets the token (a new key was entered, or the API said the token is no longer valid). */
export const forgetSolarToken = () => { tokenCache = null; };

/** A product answer of Solar's catalogue as master data – the fields Workflow uses, never the price. */
/**
 * The product inside an answer (2026-10-16: the live answer did not have the documented fields at the top): the object
 * itself, or the one in `product`, `products[0]`, `products.product[0]` or a list's first item.
 */
export function solarProductOf(raw: unknown): Record<string, unknown> | null {
  const body = camelKeys(raw);
  if (Array.isArray(body)) return solarProductOf(body[0]);
  if (!body || typeof body !== "object") return null;
  const item = body as Record<string, unknown>;
  if (item.product && typeof item.product === "object") return solarProductOf(item.product);
  if (item.products !== undefined) { const list = productList(item); return list.length ? solarProductOf(list[0]) : null; }
  return item;
}

/** The first readable text among the fields, also one level down (a localized text in an object or a list of them). */
function firstText(item: Record<string, unknown>, keys: readonly string[], max = 300): string {
  for (const key of keys) {
    const value = item[key];
    const direct = text(value, max);
    if (direct) return direct;
    const nested = Array.isArray(value) ? value[0] : value;
    if (nested && typeof nested === "object") for (const inner of ["text", "value", "description", "name", "sv", "se"]) { const found = text((nested as Record<string, unknown>)[inner], max); if (found) return found; }
  }
  return "";
}

// Solar live 2026-10-16: "Name" held the E-nummer; the words are in the descriptions. The description fields come first, and
// a candidate that is only a number (or the product's own E-nummer/EAN) is never the name.
const NAME_FIELDS = ["localMaterialDescription", "materialDescription", "materialName", "productName", "name", "description", "shortDescription", "productDescription", "title", "displayName", "texts", "descriptions", "longProductDescription", "longDescription"] as const;
const isOnlyNumber = (value: string) => /^[\dEe\s.-]+$/.test(value) && /\d{5,}/.test(value);

/** A product answer of Solar's catalogue as master data – the fields Workflow uses, never the price. */
export function solarMasterData(body: unknown, now = new Date()): SolarMasterData | null {
  const item = solarProductOf(body);
  if (!item) return null;
  const name = NAME_FIELDS.map((key) => firstText(item, [key])).find((value) => value && !isOnlyNumber(value)) ?? "";
  if (!name) return null;
  const images = Array.isArray(item.imageLinks) ? item.imageLinks as { url?: unknown; linkNumber?: unknown }[] : [];
  // Several links (2026-11-03): a picture every browser shows (jpg, png, webp, gif) comes before a TIFF, which only a picture service or
  // the server's own conversion can show (lib/catalogue/product-image.ts); otherwise the first https link, as before.
  const links = images.map((link) => text(link?.url, 500)).filter((url) => /^https:\/\//i.test(url));
  const image = links.find((url) => /\.(jpe?g|png|webp|gif)(?:[?#]|$)/i.test(url)) ?? links[0] ?? "";
  return {
    source: "solar", name, unit: tradeUnit(firstText(item, ["salesUnitofMeasure", "salesUnitOfMeasure", "baseUnitofMeasure", "unit", "unitCode"], 20)),
    eNumber: firstText(item, ["electricalNo", "electricalNumber", "eNumber"], 20).replace(/\D/g, ""),
    gtin: firstText(item, ["gtin", "ean", "eanNumber"], 20).replace(/\D/g, ""), manufacturer: firstText(item, ["brandName", "brand", "manufacturer", "manufacturerName"], 120),
    manufacturerArticleNo: firstText(item, ["manufacturerPartNumber", "manufacturerArticleNumber"], 60),
    sapMaterialNumber: text(item.sapMaterialNumber, 20).replace(/\D/g, ""), hwsNumber: text(item.hwsNumber, 40),
    imageUrl: image, status: text(item.productStatus, 40), fetchedAt: now.toISOString(),
  };
}

/**
 * One product of Solar's catalogue by an identifier: found, not found, or an error in plain words. `catalogId` is the
 * Swedish catalogue's number as the product owner entered it – it is never guessed here; `countryCode` the one the
 * check found (SE until then).
 */
export async function lookupSolarProduct(config: Credentials & { catalogId: string; countryCode?: string }, identifier: { kind: SolarIdentifier; value: string }, fetcher: Fetch = fetch): Promise<SolarLookup> {
  if (!/^\d{1,9}$/.test(config.catalogId)) return { status: "error", message: "Solars katalognummer är inte inställt." };
  if (!/^[0-9A-Za-z-]{1,40}$/.test(identifier.value)) return { status: "not-found" };
  try {
    const token = await solarToken(config, fetcher);
    if (!token) return { status: "error", message: `Solar godkände inte nyckeln för ${publicInstance().name}.` };
    const countryCode = encodeURIComponent(config.countryCode || SOLAR_COUNTRY);
    const address = `${SOLAR_API_BASE}/catalogs/${encodeURIComponent(config.catalogId)}/products/${encodeURIComponent(identifier.value)}?countrycode=${countryCode}&productIdentifier=${identifier.kind}`;
    const response = await fetcher(address, { headers: bearer(token), signal: AbortSignal.timeout(8_000) });
    if (response.status === 401) { forgetSolarToken(); return { status: "error", message: "Solars inloggning gick ut – försök igen." }; }
    if (response.status === 404 || response.status === 400) return { status: "not-found" };
    if (!response.ok) return { status: "error", message: `Solars katalog svarade med fel (${response.status}).` };
    const data = solarMasterData(await response.json().catch(() => null));
    return data ? { status: "found", data } : { status: "not-found" };
  } catch {
    return { status: "error", message: "Solars katalog svarade inte." };
  }
}

/**
 * Solars kategorier (2026-10-15): one category of Get Categories as Workflow keeps it. `id` is Solar's category
 * id (int32 – the table's key), `parent` the parent's id as Solar gives it (a string; "" or "0" at the top).
 */
export type SolarCategory = { id: number; name: string; displayName: string; imageUrl: string; etimClass: string; etimName: string; parent: string };

const INT32_MAX = 2_147_483_647;

/** A category of the answer, or null when it has no usable id or name. Only https image links are kept. */
export function solarCategory(raw: unknown): SolarCategory | null {
  if (!raw || typeof raw !== "object") return null;
  const item = camelKeys(raw) as Record<string, unknown>;
  const id = typeof item.id === "number" ? item.id : typeof item.id === "string" && /^\d{1,10}$/.test(item.id.trim()) ? Number(item.id.trim()) : Number.NaN;
  if (!Number.isSafeInteger(id) || id < 0 || id > INT32_MAX) return null;
  const name = text(item.name);
  const displayName = text(item.displayName);
  if (!name && !displayName) return null;
  const image = text(item.imageURL, 500);
  return { id, name: name || displayName, displayName, imageUrl: /^https:\/\//i.test(image) ? image : "", etimClass: text(item.etimClass, 40), etimName: text(item.etimName), parent: text(item.parent, 40) };
}

export type SolarCategoryFetch = { ok: true; categories: SolarCategory[]; pages: number; skipped: number } | { ok: false; message: string };

/**
 * Every category of Solar's catalogue: Get Categories with `limit` (at most 1000) and `countrycode`, then the answer's
 * `routing.nextPage` as `nextpage` until `requestInfo.isLastPage` is true. Nothing is stored here; the caller stores the
 * whole list only when this succeeds, so a failure half-way leaves the stored categories as they were.
 * Guards: at most `maxPages` pages and `deadlineMs` in all; the same nextPage twice, stops it (no next page = the last page); an expired token (401) is renewed once; a nextpage id is valid five minutes, so a 400 on a later page
 * starts over from the first page once.
 */
export async function fetchSolarCategories(
  credentials: Credentials,
  countryCode: string,
  fetcher: Fetch = fetch,
  options: { limit?: number; maxPages?: number; deadlineMs?: number } = {},
): Promise<SolarCategoryFetch> {
  const limit = Math.min(1000, Math.max(1, Math.trunc(options.limit ?? 1000)));
  const maxPages = options.maxPages ?? 500;
  const deadline = Date.now() + (options.deadlineMs ?? 240_000);
  const fail = (message: string): SolarCategoryFetch => ({ ok: false, message });
  const byId = new Map<number, SolarCategory>();
  let seen = new Set<string>();
  let nextPage: string | null = null;
  let pages = 0;
  let skipped = 0;
  let restarted = false;
  let renewed = false;
  for (;;) {
    if (pages >= maxPages) return fail(`Solar gav fler än ${maxPages} sidor – hämtningen avbröts.`);
    if (Date.now() > deadline) return fail("Hämtningen tog för lång tid och avbröts.");
    let response: Response;
    try {
      const token = await solarToken(credentials, fetcher);
      if (!token) return fail(`Solar godkände inte nyckeln för ${publicInstance().name}.`);
      response = await fetcher(solarCategoriesUrl(countryCode, limit, nextPage), { headers: bearer(token), signal: AbortSignal.timeout(30_000) });
    } catch {
      return fail("Solars katalog svarade inte.");
    }
    if (response.status === 401 && !renewed) { forgetSolarToken(); renewed = true; continue; }
    if (response.status === 400 && nextPage && !restarted) {
      restarted = true; nextPage = null; seen = new Set(); byId.clear(); skipped = 0; pages = 0;
      continue;
    }
    if (response.status === 401 || response.status === 403) return fail("Solar gav inte tillgång till katalogen.");
    if (!response.ok) return fail(`Solars katalog svarade med fel (${response.status}) på sida ${pages + 1}.`);
    const body = camelKeys(await response.json().catch(() => null)) as { requestInfo?: { isLastPage?: unknown }; routing?: { nextPage?: unknown } } | null;
    if (!body || typeof body !== "object") return fail(`Solars katalog gav ett oväntat svar på sida ${pages + 1}.`);
    pages += 1;
    for (const raw of categoryList(body)) {
      const category = solarCategory(raw);
      if (category) byId.set(category.id, category);
      else skipped += 1;
    }
    const last = body.requestInfo?.isLastPage;
    if (last === true || (typeof last === "string" && last.trim().toLowerCase() === "true")) break;
    // Paging as the catalogue import reads it: the Link header's rel="next", else the body's routing.nextPage. Neither = the last page.
    const next = body.routing?.nextPage;
    const fromBody = typeof next === "string" ? next.trim() : typeof next === "number" ? String(next) : "";
    const value = solarNextPage(response.headers.get("link")) || (fromBody === "0" ? "" : fromBody);
    if (!value) break;
    if (seen.has(value) || value === nextPage) return fail("Solar gav samma sida två gånger – hämtningen avbröts.");
    seen.add(value);
    nextPage = value;
  }
  if (!byId.size) return fail("Solar gav inga kategorier.");
  return { ok: true, categories: [...byId.values()], pages, skipped };
}

/**
 * Lagersaldo (2026-10-15; Solar: "Vi kan ge API-åtkomst till lagersaldo men inte för avtalspriser"): Get ATP, the
 * stock Solar can promise near a postal code, for E-numbers. POST /products/atp?countrycode= with
 * { postalCode, productIdentifier: "ElectricalNumber", products: [{ productId }] } – no account, no catalogue number.
 * Read only; never a price, never an order.
 */
export const SOLAR_ATP_BATCH = 50;
export const solarAtpUrl = (countryCode: string) => `${SOLAR_API_BASE}/products/atp?countrycode=${encodeURIComponent(countryCode)}`;
/** The identifier kinds Get ATP takes (Solar's documented values; the price call takes the same). */
export type SolarAtpIdentifier = "ElectricalNumber" | "EANNumber" | "SAPMaterialNumber";
const ATP_ID: Record<SolarAtpIdentifier, RegExp> = { ElectricalNumber: /^\d{7}$/, EANNumber: /^\d{8}$|^\d{12,14}$/, SAPMaterialNumber: /^\d{1,20}$/ };
/** One answer of Get ATP: the id as asked (`productId`; `eNumber` is the same digits, kept for the first callers), the stock and when it was asked (`fetchedAt`, never older than the memory keeps it). */
export type SolarStock = { eNumber: string; productId: string; stock: number | null; unit: string; stockType: string; message: string; fetchedAt: string };
export type SolarStockAnswer = { status: "ok"; items: SolarStock[] } | { status: "error"; message: string };

/** Solar's ATP answer as stock rows; anything unreadable is left out. */
export function solarStockOf(raw: unknown, now = new Date()): SolarStock[] {
  const body = camelKeys(raw);
  const rows = Array.isArray(body) ? body : Array.isArray((body as { products?: unknown })?.products) ? (body as { products: unknown[] }).products : [];
  return rows.flatMap((row): SolarStock[] => {
    if (!row || typeof row !== "object") return [];
    const item = row as Record<string, unknown>;
    const productId = text(item.productId, 20).replace(/\D/g, "");
    if (!productId) return [];
    const stock = typeof item.atpStock === "number" && Number.isFinite(item.atpStock) ? item.atpStock : null;
    return [{ eNumber: productId, productId, stock, unit: text(item.unitCode, 20), stockType: text(item.stockType, 40), message: text(item.message, 200), fetchedAt: now.toISOString() }];
  });
}

/** The stock for up to SOLAR_ATP_BATCH E-numbers near a postal code. */
export async function fetchSolarStock(config: Credentials & { countryCode: string }, ids: readonly string[], postalCode: string, fetcher: Fetch = fetch, identifier: SolarAtpIdentifier = "ElectricalNumber"): Promise<SolarStockAnswer> {
  const products = [...new Set(ids.filter((value) => ATP_ID[identifier].test(value)))].slice(0, SOLAR_ATP_BATCH).map((productId) => ({ productId }));
  if (!products.length) return { status: "ok", items: [] };
  try {
    const token = await solarToken(config, fetcher);
    if (!token) return { status: "error", message: `Solar godkände inte nyckeln för ${publicInstance().name}.` };
    const response = await fetcher(solarAtpUrl(config.countryCode || SOLAR_COUNTRY), {
      method: "POST", signal: AbortSignal.timeout(8_000),
      headers: { Authorization: `Bearer ${token}`, Accept: "application/json", "Content-Type": "application/json" },
      body: JSON.stringify({ postalCode: postalCode.replace(/\s+/g, ""), productIdentifier: identifier, products }),
    });
    if (response.status === 401) { forgetSolarToken(); return { status: "error", message: "Solars inloggning gick ut – försök igen." }; }
    if (response.status === 403) return { status: "error", message: "Solar har inte gett tillgång till lagersaldo." };
    if (!response.ok) return { status: "error", message: `Solars lagersaldo svarade med fel (${response.status}).` };
    return { status: "ok", items: solarStockOf(await response.json().catch(() => null)) };
  } catch {
    return { status: "error", message: "Solars lagersaldo svarade inte." };
  }
}

/**
 * Gemensamt artikelregister (2026-10-17, docs/proposals/gemensamt-artikelregister-forslag-2026-10-17.md): one article
 * of Get Products as the shared search register keeps it – Solar's article number (SAP), the trade's numbers, the short
 * name, the description, the product type (the ETIM class's Swedish name, carried by the product itself as
 * EtimFeatures.Name), series, unit, status and when Solar last changed it. Nothing else: the ETIM features, pictures,
 * documents and stock are asked for when the article is chosen, and the price (ListPrice and its fields) is never read.
 */
export type SolarRegisterArticle = {
  articleNo: string; eNumber: string; gtin: string; manufacturer: string; manufacturerArticleNo: string;
  name: string; description: string; productType: string; etimClass: string; series: string; unit: string; status: string;
  lastChanged: Date | null;
};

/** A field of Solar's answer by its name as Solar writes it (capital first) or as the portal's definition does (small first). */
const fieldOf = (item: Record<string, unknown>, name: string): unknown => item[name] ?? item[name[0].toLowerCase() + name.slice(1)];

export function solarRegisterArticle(raw: unknown): SolarRegisterArticle | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const item = raw as Record<string, unknown>;
  const articleNo = text(fieldOf(item, "SapMaterialNumber"), 20).replace(/\D/g, "");
  if (!articleNo) return null;
  const e = text(fieldOf(item, "ElectricalNo"), 20).replace(/\D/g, "");
  const gtinDigits = text(fieldOf(item, "Gtin"), 20).replace(/\D/g, "");
  const features = fieldOf(item, "EtimFeatures");
  const productType = features && typeof features === "object" && !Array.isArray(features) ? text(fieldOf(features as Record<string, unknown>, "Name"), 120) : "";
  const changed = Number(fieldOf(item, "LastChanged"));
  return {
    articleNo, eNumber: /^\d{7}$/.test(e) ? e : "", gtin: gtinOf(gtinDigits),
    manufacturer: text(fieldOf(item, "BrandName"), 120), manufacturerArticleNo: text(fieldOf(item, "ManufacturerPartNumber"), 60),
    name: text(fieldOf(item, "MaterialName"), 120), description: text(fieldOf(item, "MaterialDescription"), 300), productType,
    etimClass: text(fieldOf(item, "EtimClass"), 20), series: text(fieldOf(item, "Series"), 80),
    unit: tradeUnit(text(fieldOf(item, "BaseUnitofMeasure"), 20) || text(fieldOf(item, "Unit"), 20) || text(fieldOf(item, "SalesUnitofMeasure"), 20)),
    status: text(fieldOf(item, "ProductStatus"), 10),
    // Unix seconds (Solar, 2026-10-17); milliseconds are read as such.
    lastChanged: Number.isFinite(changed) && changed > 0 ? new Date(changed < 1e12 ? changed * 1000 : changed) : null,
  };
}

/** The `nextpage` of a Get Products answer's Link header (`<…&nextpage=…>; rel="next"`), "" when there is none. */
export function solarNextPage(link: string | null | undefined): string {
  for (const part of (link ?? "").split(/,(?=\s*<)/)) {
    const target = /<([^>]+)>/.exec(part)?.[1];
    if (!target || !/rel="?next"?/i.test(part)) continue;
    try { return new URL(target, SOLAR_API_BASE).searchParams.get("nextpage")?.trim() ?? ""; } catch { return ""; }
  }
  return "";
}

/** Get Products' address for the register: the documented parameters on every page, the cursor after the first. */
export function solarProductsPageUrl(catalogId: string, countryCode: string, options: { limit: number; nextPage?: string | null; lastChanged?: Date | null; ignoreObsolete?: boolean }): string {
  const changed = options.lastChanged ? `&lastChanged=${Math.floor(options.lastChanged.getTime() / 1000)}` : "";
  return `${solarProductsUrl(catalogId, countryCode, options.limit, options.nextPage)}${changed}${options.ignoreObsolete ? "&ignoreObsoleteProducts=true" : ""}`;
}

export type SolarProductPage =
  | { ok: true; articles: SolarRegisterArticle[]; skipped: number; nextPage: string; bytes: number }
  | { ok: false; status: number; message: string };

/**
 * One page of Get Products for the register. Read only; the answer (4–14 MB per 1000 articles) is read as text and parsed
 * once, every article reduced to the register's fields at once, so the page's ETIM features and prices are never kept.
 */
export async function fetchSolarProductPage(
  token: string,
  config: { catalogId: string; countryCode: string },
  options: { limit?: number; nextPage?: string | null; lastChanged?: Date | null; ignoreObsolete?: boolean },
  fetcher: Fetch = fetch,
): Promise<SolarProductPage> {
  const limit = Math.min(1000, Math.max(1, Math.trunc(options.limit ?? 1000)));
  let response: Response;
  try {
    response = await fetcher(solarProductsPageUrl(config.catalogId, config.countryCode || SOLAR_COUNTRY, { ...options, limit }), { headers: bearer(token), signal: AbortSignal.timeout(120_000) });
  } catch {
    return { ok: false, status: 0, message: "Solars katalog svarade inte." };
  }
  if (!response.ok) return { ok: false, status: response.status, message: response.status === 401 || response.status === 403 ? "Solar gav inte tillgång till katalogen." : `Solars katalog svarade med fel (${response.status}).` };
  const body = await response.text().catch(() => "");
  let parsed: unknown;
  try { parsed = JSON.parse(body); } catch { return { ok: false, status: 502, message: "Solars katalog gav ett svar som inte gick att läsa." }; }
  const list = Array.isArray(parsed) ? parsed : productList(parsed);
  const articles: SolarRegisterArticle[] = [];
  let skipped = 0;
  for (const raw of list) {
    const article = solarRegisterArticle(raw);
    if (article) articles.push(article);
    else skipped += 1;
  }
  return { ok: true, articles, skipped, nextPage: solarNextPage(response.headers.get("link")), bytes: body.length };
}
