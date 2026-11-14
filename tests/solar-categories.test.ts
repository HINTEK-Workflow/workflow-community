import assert from "node:assert/strict";
import test from "node:test";
import {
  SOLAR_API_BASE,
  SOLAR_TOKEN_URL,
  checkSolarKeys,
  fetchSolarCategories,
  forgetSolarToken,
  lookupSolarProduct,
  probeSolarCountryCode,
  solarCategory,
  type SolarCategory,
} from "../lib/integrations/solar";
import { serverSettingProblem } from "../lib/integrations/server-secret-values";
import { syncSolarCategories } from "../lib/catalogue/solar-categories";

// Solars kategorier och landskod (2026-10-15): Get Categories with only limit, countrycode and nextpage – never a
// catalogId –, every page until isLastPage, the country code tried as SE, se, sv. Invented answers; no call leaves the test.

const credentials = { clientId: "00000000-1111-2222-3333-444444444444", clientSecret: "påhittad-hemlighet" };
const page = (categories: unknown[], last: boolean, nextPage = "") =>
  ({ categories: { category: categories }, requestInfo: { isLastPage: last, itemCount: categories.length, limit: 1000, total: categories.length }, resultMessage: { message: "", returnCode: 0 }, routing: { currentPage: "", nextPage } });
const category = (id: number, parent = "0") => ({ id, name: `Påhittad kategori ${id}`, displayName: `Kategori ${id}`, imageURL: "https://example.invalid/k.png", etimClass: "EC000000", etimName: "Påhittad", parent });

/** A fake Solar: a token for the token address, otherwise the next scripted answer for the categories. */
function fakeSolar(answers: ({ status: number; body?: unknown } | ((url: string) => { status: number; body?: unknown }))[]) {
  const calls: string[] = [];
  let tokens = 0;
  const fetcher = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    if (url === SOLAR_TOKEN_URL) {
      tokens += 1;
      assert.equal(init?.method, "POST");
      return new Response(JSON.stringify({ access_token: `token-${tokens}`, expires_in: 3600 }), { status: 200 });
    }
    calls.push(url);
    const next = answers.shift();
    if (!next) throw new Error(`unexpected call ${url}`);
    const answer = typeof next === "function" ? next(url) : next;
    return new Response(answer.body === undefined ? "" : JSON.stringify(answer.body), { status: answer.status });
  }) as typeof fetch;
  return { fetcher, calls, tokens: () => tokens };
}

test("every page is fetched with limit and countrycode, then nextpage from routing.nextPage, until isLastPage", async () => {
  forgetSolarToken();
  const solar = fakeSolar([
    { status: 200, body: page([category(1), category(2, "1")], false, "p-2") },
    { status: 200, body: page([category(3, "1"), { id: "x", name: "utan id" }], false, "p-3") },
    { status: 200, body: page([category(4, "3"), category(2, "1")], true) },
  ]);
  const result = await fetchSolarCategories(credentials, "SE", solar.fetcher);
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.deepEqual(solar.calls, [
    `${SOLAR_API_BASE}/catalogs/categories?limit=1000&countrycode=SE`,
    `${SOLAR_API_BASE}/catalogs/categories?limit=1000&countrycode=SE&nextpage=p-2`,
    `${SOLAR_API_BASE}/catalogs/categories?limit=1000&countrycode=SE&nextpage=p-3`,
  ]);
  assert.equal(result.pages, 3);
  assert.equal(result.skipped, 1);
  assert.deepEqual(result.categories.map((item) => item.id).sort(), [1, 2, 3, 4], "a category on two pages is kept once");
  assert.deepEqual(result.categories.find((item) => item.id === 4), { id: 4, name: "Påhittad kategori 4", displayName: "Kategori 4", imageUrl: "https://example.invalid/k.png", etimClass: "EC000000", etimName: "Påhittad", parent: "3" });
  assert.ok(solar.calls.every((url) => !/catalogId|catalogs\/\d/i.test(url)), "categories are never asked for with a catalogue id");
  assert.ok(solar.calls.every((url) => !url.includes(credentials.clientSecret)));
  assert.equal(solar.tokens(), 1, "the token is reused across the pages");
});

test("a repeated nextPage, a missing next page and too many pages stop the fetch", async () => {
  forgetSolarToken();
  const loop = fakeSolar([{ status: 200, body: page([category(1)], false, "p-2") }, { status: 200, body: page([category(2)], false, "p-2") }]);
  const repeated = await fetchSolarCategories(credentials, "SE", loop.fetcher);
  assert.deepEqual(repeated, { ok: false, message: "Solar gav samma sida två gånger – hämtningen avbröts." });
  assert.equal(loop.calls.length, 2);

  // No next page at all (no Link header, no routing.nextPage) is the last page, not an error.
  const dangling = fakeSolar([{ status: 200, body: page([category(1)], false, "") }]);
  assert.equal((await fetchSolarCategories(credentials, "SE", dangling.fetcher)).ok, true);

  const endless = fakeSolar(Array.from({ length: 5 }, (_, index) => ({ status: 200, body: page([category(index + 1)], false, `p-${index + 2}`) })));
  const capped = await fetchSolarCategories(credentials, "SE", endless.fetcher, { maxPages: 3 });
  assert.deepEqual(capped, { ok: false, message: "Solar gav fler än 3 sidor – hämtningen avbröts." });
  assert.equal(endless.calls.length, 3);
});

test("an expired nextpage (400) starts over from the first page once; an expired token is renewed once", async () => {
  forgetSolarToken();
  const solar = fakeSolar([
    { status: 200, body: page([category(1)], false, "p-2") },
    { status: 400 },
    { status: 401 },
    { status: 200, body: page([category(1)], false, "p-2b") },
    { status: 200, body: page([category(2)], true) },
  ]);
  const result = await fetchSolarCategories(credentials, "se", solar.fetcher);
  assert.equal(result.ok, true);
  assert.deepEqual(solar.calls, [
    `${SOLAR_API_BASE}/catalogs/categories?limit=1000&countrycode=se`,
    `${SOLAR_API_BASE}/catalogs/categories?limit=1000&countrycode=se&nextpage=p-2`,
    `${SOLAR_API_BASE}/catalogs/categories?limit=1000&countrycode=se`,
    `${SOLAR_API_BASE}/catalogs/categories?limit=1000&countrycode=se`,
    `${SOLAR_API_BASE}/catalogs/categories?limit=1000&countrycode=se&nextpage=p-2b`,
  ]);
  assert.equal(solar.tokens(), 2);

  forgetSolarToken();
  const twice = fakeSolar([{ status: 200, body: page([category(1)], false, "p-2") }, { status: 400 }, { status: 200, body: page([category(1)], false, "p-2") }, { status: 400 }]);
  assert.deepEqual(await fetchSolarCategories(credentials, "SE", twice.fetcher), { ok: false, message: "Solars katalog svarade med fel (400) på sida 2." });
});

test("an error half-way stores nothing: the stored categories stay as they were", async () => {
  forgetSolarToken();
  let stored = 0;
  const solar = fakeSolar([{ status: 200, body: page([category(1)], false, "p-2") }, { status: 500 }]);
  const result = await syncSolarCategories("Superadmin", {
    enabled: async () => true,
    credentials: async () => ({ ok: true, ...credentials, countryCode: "SE", countryVerified: true }),
    fetchAll: (keys, countryCode) => fetchSolarCategories(keys, countryCode, solar.fetcher),
    store: async () => { stored += 1; return { stored: 0, removed: 0 }; },
  });
  assert.equal(result.ok, false);
  assert.equal(result.message, "Solars katalog svarade med fel (500) på sida 2. De sparade kategorierna är orörda.");
  assert.equal(stored, 0);
});

test("a complete fetch is stored once, with the country code the check found or found now", async () => {
  forgetSolarToken();
  const saved: string[] = [];
  const writes: { categories: SolarCategory[]; countryCode: string }[] = [];
  const solar = fakeSolar([{ status: 200, body: page([category(1), category(2, "1")], true) }]);
  const result = await syncSolarCategories("Superadmin", {
    enabled: async () => true,
    credentials: async () => ({ ok: true, ...credentials, countryCode: "SE", countryVerified: false }),
    probe: async () => ({ countryCode: "sv" }),
    saveCountryCode: async (code) => { saved.push(code); },
    fetchAll: (keys, countryCode) => fetchSolarCategories(keys, countryCode, solar.fetcher),
    store: async (categories, countryCode) => { writes.push({ categories, countryCode }); return { stored: categories.length, removed: 3 }; },
  });
  assert.deepEqual(saved, ["sv"]);
  assert.equal(solar.calls[0], `${SOLAR_API_BASE}/catalogs/categories?limit=1000&countrycode=sv`);
  assert.equal(writes.length, 1);
  assert.equal(writes[0].countryCode, "sv");
  assert.deepEqual(writes[0].categories.map((item) => item.id), [1, 2]);
  assert.deepEqual(result, { ok: true, message: "2 kategorier hämtade från Solar (1 sida, landskod ”sv”), 3 som Solar inte längre har togs bort." });

  const noKey = await syncSolarCategories("Superadmin", { enabled: async () => true, credentials: async () => ({ ok: false, reason: "no-key" }) });
  assert.equal(noKey.ok, false);
});

test("the country code is tried as SE, se, sv with limit=1, and the first answering with categories is kept", async () => {
  const solar = fakeSolar([{ status: 400 }, { status: 200, body: page([], true) }, { status: 200, body: page([category(7)], true) }]);
  const probe = await probeSolarCountryCode("token-1", solar.fetcher);
  assert.deepEqual(solar.calls, [
    `${SOLAR_API_BASE}/catalogs/categories?limit=1&countrycode=SE`,
    `${SOLAR_API_BASE}/catalogs/categories?limit=1&countrycode=se`,
    `${SOLAR_API_BASE}/catalogs/categories?limit=1&countrycode=sv`,
  ]);
  assert.equal(probe.status, "accepted");
  if (probe.status === "accepted") assert.equal(probe.countryCode, "sv");

  const denied = fakeSolar([{ status: 403 }]);
  assert.deepEqual(await probeSolarCountryCode("token-1", denied.fetcher), { status: "denied" });
  assert.equal(denied.calls.length, 1, "no access is not a matter of the country code");
});

test("Kontrollera says in plain words which country code Solar accepted, or that none was", async () => {
  const accounts = (url: string) => url.endsWith("/accounts") ? { status: 200, body: [] } : { status: 400 };
  const accepted = fakeSolar([accounts, { status: 400 }, { status: 200, body: page([category(1)], false, "p-2") }]);
  const result = await checkSolarKeys(credentials, accepted.fetcher);
  assert.equal(result.ok, true);
  assert.equal(result.countryCode, "se");
  assert.match(result.message, /med landskoden ”se” \(”SE” \(fel 400\) godtogs inte\)/);
  assert.doesNotMatch(result.message, /token-|hemlighet/);

  const none = fakeSolar([accounts, { status: 400 }, { status: 400 }, { status: 200, body: page([], true) }]);
  const refused = await checkSolarKeys(credentials, none.fetcher);
  assert.equal(refused.ok, false);
  assert.equal(refused.countryCode, undefined);
  assert.match(refused.message, /katalogen godtog ingen av landskoderna: ”SE” \(fel 400\), ”se” \(fel 400\), ”sv” \(inga kategorier\)\./);
});

test("the product lookup uses the country code found, and keeps catalogId and productIdentifier as documented", async () => {
  forgetSolarToken();
  const solar = fakeSolar([{ status: 404 }]);
  await lookupSolarProduct({ ...credentials, catalogId: "12", countryCode: "sv" }, { kind: "eanNumber", value: "7300000000004" }, solar.fetcher);
  assert.deepEqual(solar.calls, [`${SOLAR_API_BASE}/catalogs/12/products/7300000000004?countrycode=sv&productIdentifier=eanNumber`]);
});

test("a category needs an int32 id and a name; only https images are kept; the country code setting is one of the candidates", () => {
  assert.equal(solarCategory({ name: "utan id" }), null);
  assert.equal(solarCategory({ id: 1 }), null);
  assert.equal(solarCategory({ id: 3_000_000_000, name: "för stort" }), null);
  assert.deepEqual(solarCategory({ id: "42", displayName: "Bara visningsnamn", imageURL: "http://example.invalid/x.png", parent: 7 }),
    { id: 42, name: "Bara visningsnamn", displayName: "Bara visningsnamn", imageUrl: "", etimClass: "", etimName: "", parent: "7" });
  assert.equal(serverSettingProblem("solarCountryCode", "se"), null);
  assert.ok(serverSettingProblem("solarCountryCode", "SWE"));
});

// Solar to 2026-10-16: "Det borde fungera med Get Product och Get Products" with the Swedish catalogue number. The
// live check showed empty categories for SE/se and 400 for sv; the products decide when the number is set.
test("with the catalogue number Kontrollera asks for one product, and the products decide even when the categories are empty", async () => {
  const empty = { status: 200, body: page([], true) };
  const answers = (url: string) => url.endsWith("/accounts") ? { status: 200, body: [] }
    : url.includes("/categories") ? (url.endsWith("countrycode=sv") ? { status: 400 } : empty)
    : url.includes("countrycode=SE") ? { status: 200, body: { products: [] } } : { status: 200, body: { products: [{ name: "Påhittad dosa", electricalNo: "1234567", listPrice: 99 }] } };
  const solar = fakeSolar(Array.from({ length: 12 }, () => answers));
  const result = await checkSolarKeys(credentials, solar.fetcher, "3016431");
  assert.equal(result.ok, true);
  assert.equal(result.countryCode, "se", "the country code the products answered with");
  assert.equal(result.message, "Solar fungerar: produktkatalogen 3016431 är öppen (landskod se). Inga kategorier för Sverige.", "short (2026-10-16)");
  assert.doesNotMatch(result.message, /99/, "never a price");
  assert.ok(solar.calls.includes(`${SOLAR_API_BASE}/catalogs/3016431/products?countrycode=SE&limit=1`), "Get Products as documented: catalogId in the path, countrycode and limit");

  const closed = fakeSolar(Array.from({ length: 12 }, () => (url: string) => url.endsWith("/accounts") ? { status: 200, body: [] } : url.includes("/categories") ? empty : { status: 403 }));
  const refused = await checkSolarKeys(credentials, closed.fetcher, "3016431");
  assert.equal(refused.ok, false);
  assert.match(refused.message, /Produktkatalogen 3016431 är inte öppen för klienten \(fel 403\)/);
});

test("a product without a readable name says its field names, never a value", async () => {
  const solar = fakeSolar(Array.from({ length: 12 }, () => (url: string) => url.endsWith("/accounts") ? { status: 200, body: [] } : url.includes("/categories") ? { status: 200, body: page([], true) }
    : { status: 200, body: { products: [{ productIdentifiers: { eNumber: "1234567" }, texts: { short: "Hemlig text" }, listPrice: 4711 }] } }));
  const result = await checkSolarKeys(credentials, solar.fetcher, "3016431");
  assert.equal(result.ok, true);
  assert.equal(result.message, "Solar fungerar: produktkatalogen 3016431 är öppen (landskod SE). Inga kategorier för Sverige. Produktens fält: productIdentifiers.eNumber, texts.short, listPrice.");
  assert.doesNotMatch(result.message, /1234567|Hemlig|4711/, "no value is said");
});

test("paging is read from the Link header like the catalogue import; isLastPage may be the string true", async () => {
  forgetSolarToken();
  const withLink = (id: string) => `<${SOLAR_API_BASE}/catalogs/categories?limit=1000&countrycode=SE&nextpage=${id}>; rel="next"`;
  let step = 0;
  const calls: string[] = [];
  const fetcher = (async (input: RequestInfo | URL) => {
    const url = String(input);
    if (url === SOLAR_TOKEN_URL) return new Response(JSON.stringify({ access_token: "t", expires_in: 3600 }), { status: 200 });
    calls.push(url);
    step += 1;
    if (step === 1) return new Response(JSON.stringify(page([category(1)], false)), { status: 200, headers: { Link: withLink("L-2") } });
    if (step === 2) return new Response(JSON.stringify(page([category(2)], false)), { status: 200, headers: { Link: withLink("L-3") } });
    return new Response(JSON.stringify(page([category(3)], false)), { status: 200, headers: { Link: `<${SOLAR_API_BASE}/x>; rel="prev"` } });
  }) as typeof fetch;
  const result = await fetchSolarCategories(credentials, "SE", fetcher);
  assert.equal(result.ok, true);
  assert.equal(calls.length, 3);
  assert.ok(calls[1].endsWith("nextpage=L-2") && calls[2].endsWith("nextpage=L-3"));
  if (result.ok) assert.equal(result.categories.length, 3);

  forgetSolarToken();
  const stringLast = fakeSolar([{ status: 200, body: { ...page([category(5)], false), requestInfo: { isLastPage: "true" } } }]);
  const done = await fetchSolarCategories(credentials, "SE", stringLast.fetcher);
  assert.equal(done.ok && done.pages, 1);
});

test("Hämta kategorier asks to switch the API connection on first when it is off", async () => {
  const off = await syncSolarCategories("Superadmin", { enabled: async () => false, credentials: async () => { throw new Error("must not be asked"); } });
  assert.deepEqual(off, { ok: false, message: "Slå på API-anslutningen först." });
});
