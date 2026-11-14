import assert from "node:assert/strict";
import { test } from "node:test";
import { ADDRESS_HOSTS, ADDRESS_SCOPE, addressUrls, chooseAddressMethod, createAddressClient, LookupError, type FetchLike } from "../lib/geo/address-api";
import { ADDRESS_SEARCH_DEBOUNCE_MS, ADDRESS_SEARCH_HITS, ADDRESS_SEARCH_MAX, ADDRESS_SEARCH_MIN, addressSearchText, composeFromComponents, geocodeMatch, geocodeText, isAddressId, parseAddressReferences, QA_ADDRESS_ID, qaAddressById, qaAddressSearch } from "../lib/geo/address-search";
import { parseAddressChoice, QA_ADDRESS, QA_ADDRESS_POINT } from "../lib/geo/address-parse";
import { fromSweref99Tm, toSweref99Tm } from "../lib/geo/sweref99";

// Belägenhetsadress Direkt v4.2 with a fake fetch: the exact calls (as the published interface names them), the sign-in
// both ways, the parsing of both kinds of answer, and the errors. Made-up values only; nothing reaches Lantmäteriet.

type Call = { url: string; init?: RequestInit };
const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
function fake(...answers: (Response | ((call: Call) => Response))[]) {
  const calls: Call[] = [];
  const fetch: FetchLike = async (url, init) => {
    const call = { url, init };
    calls.push(call);
    const next = answers.shift();
    if (!next) throw new Error(`unexpected call ${url}`);
    return typeof next === "function" ? next(call) : next;
  };
  return { fetch, calls };
}
const header = (call: Call, name: string) => new Headers(call.init?.headers).get(name);
const basicOf = (user: string, password: string) => `Basic ${Buffer.from(`${user}:${password}`).toString("base64")}`;

const ID = "4c9326bb-9805-408f-a088-2c12eae724ce";
const GAVLE = { latitude: 60.6749, longitude: 17.1413 };
const featureAt = (easting: number, northing: number) => ({
  type: "FeatureCollection",
  features: [{
    type: "Feature", id: ID, geometry: { type: "Point", coordinates: [easting, northing] },
    properties: {
      objektidentitet: ID,
      adressplatsattribut: { adressplatsbeteckning: { adressplatsnummer: "2", bokstavstillagg: "C", avvikerFranStandarden: false }, adressplatstyp: "Gatuadressplats", postnummer: 80182, postort: "Provstad" },
      adressomrade: { faststalltNamn: "Provgatan", adressomradestyp: "Gatuadressområde", kommundel: { faststalltNamn: "Provdelen", kommun: { kommunkod: "2180", kommunnamn: "Provkommun" } } },
    },
  }],
});

test("the way to sign in: saved OAuth keys keep working, otherwise the map's account first", () => {
  assert.equal(chooseAddressMethod({ keyCipher: "x", secretCipher: "y" }, true), "oauth", "keys saved before 2026-10-15 stay OAuth");
  assert.equal(chooseAddressMethod({}, true), "map");
  assert.equal(chooseAddressMethod({}, false), "basic");
  assert.equal(chooseAddressMethod({ method: "basic", keyCipher: "x", secretCipher: "y" }, true), "basic", "a saved choice wins");
});

test("the hosts and token addresses are the ones the interface publishes, per environment", () => {
  assert.equal(ADDRESS_HOSTS.production.api, "https://api.lantmateriet.se/distribution/produkter/belagenhetsadress/v4.2");
  assert.equal(ADDRESS_HOSTS.verification.api, "https://api-ver.lantmateriet.se/distribution/produkter/belagenhetsadress/v4.2");
  assert.equal(ADDRESS_HOSTS.production.token, "https://apimanager.lantmateriet.se/oauth2/token");
  assert.equal(ADDRESS_HOSTS.verification.token, "https://apimanager-ver.lantmateriet.se/oauth2/token");
  assert.equal(ADDRESS_SCOPE, "belagenhetsadress_direkt_v42_read");
});

test("each operation's URL: path, parameter names, SWEREF 99 TM and nothing undocumented", () => {
  const pin = toSweref99Tm(GAVLE.latitude, GAVLE.longitude);
  assert.equal(addressUrls.nearest("production", GAVLE.latitude, GAVLE.longitude),
    `https://api.lantmateriet.se/distribution/produkter/belagenhetsadress/v4.2/punkt?punktSrid=3006&koordinater=${pin.northing.toFixed(2)},${pin.easting.toFixed(2)}&includeData=basinformation&srid=3006`);
  // Lantmäteriet's own example, spaces and å/ä/ö encoded; maxHits and splitAdress as documented.
  assert.equal(addressUrls.search("verification", "lantmäterig 2 gävle", 8),
    "https://api-ver.lantmateriet.se/distribution/produkter/belagenhetsadress/v4.2/referens/fritext?adress=lantm%C3%A4terig%202%20g%C3%A4vle&maxHits=8&splitAdress=true");
  assert.equal(addressUrls.byId("production", ID), `https://api.lantmateriet.se/distribution/produkter/belagenhetsadress/v4.2/${ID}?includeData=basinformation&srid=3006`);
  // A typed ampersand or question mark stays inside the search value.
  assert.match(addressUrls.search("production", "a&b?c=1"), /adress=a%26b%3Fc%3D1&maxHits=/);
});

test("Basic sign-in: the Geotorget user name and password on every call, no token", async () => {
  const { fetch, calls } = fake(json(200, featureAt(616_930, 6_728_790)));
  const api = createAddressClient("production", { kind: "basic", user: "abcd1234", password: "hemligt" }, { fetch, tokens: new Map() });
  const proposal = await api.nearest(GAVLE.latitude, GAVLE.longitude);
  assert.equal(calls.length, 1);
  assert.match(calls[0].url, /\/punkt\?/);
  assert.equal(header(calls[0], "authorization"), basicOf("abcd1234", "hemligt"));
  assert.equal(header(calls[0], "accept"), "application/json");
  assert.equal(proposal?.address, "Provgatan 2C");
  assert.equal(proposal?.postalCode, "801 82");
  assert.equal(proposal?.city, "Provstad");
});

test("OAuth: client credentials with the scope, the token reused, fetched again once after a 401", async () => {
  const tokens = new Map<string, { value: string; expiresAt: number }>();
  const { fetch, calls } = fake(
    json(200, { access_token: "t1", expires_in: 3600 }),
    json(200, []),
    json(200, []),
    json(401, { code: 401, reason: "Unauthorized" }),
    json(200, { access_token: "t2", expires_in: 3600 }),
    json(200, []),
  );
  const api = createAddressClient("verification", { kind: "oauth", key: "key", secret: "secret" }, { fetch, tokens });
  assert.deepEqual(await api.search("Provgatan"), []);
  assert.equal(calls[0].url, "https://apimanager-ver.lantmateriet.se/oauth2/token");
  assert.equal(calls[0].init?.method, "POST");
  assert.equal(calls[0].init?.body, "grant_type=client_credentials&scope=belagenhetsadress_direkt_v42_read");
  assert.equal(header(calls[0], "authorization"), basicOf("key", "secret"));
  assert.equal(header(calls[0], "content-type"), "application/x-www-form-urlencoded");
  assert.equal(header(calls[1], "authorization"), "Bearer t1");
  // The second search reuses the token.
  await api.search("Provgatan");
  assert.equal(header(calls[2], "authorization"), "Bearer t1");
  // An expired token: one new token and the call repeated.
  await api.search("Provgatan");
  assert.equal(calls[4].url, "https://apimanager-ver.lantmateriet.se/oauth2/token");
  assert.equal(header(calls[5], "authorization"), "Bearer t2");
  assert.equal(calls.length, 6);
});

test("errors become plain Swedish and never repeat Lantmäteriet's text", async () => {
  const basic = { kind: "basic", user: "u", password: "p" } as const;
  const reject = async (status: number, pattern: RegExp, auth: Parameters<typeof createAddressClient>[1] = basic) => {
    const { fetch } = fake(json(status, { code: status, reason: "x", errors: ["Provgatan 2 is bad"] }), json(status, {}));
    await assert.rejects(createAddressClient("production", auth, { fetch, tokens: new Map() }).search("Provgatan 2"), (error: Error) => error instanceof LookupError && pattern.test(error.message) && !error.message.includes("Provgatan"));
  };
  await reject(401, /godtar inte användarnamnet och lösenordet/);
  await reject(403, /inte behörighet till Belägenhetsadress Direkt/);
  await reject(429, /för många frågor/);
  await reject(400, /tog inte emot frågan/);
  await reject(500, /svarade 500/);
  // A refused key at the token endpoint.
  await reject(401, /godtar inte API-nyckeln och hemligheten/, { kind: "oauth", key: "k", secret: "s" });
});

test("free-text search: references become suggestions with their parts; empty and odd answers give none", async () => {
  const answer = [
    { objektidentitet: ID, adress: "Provgatan 2C, 801 82 Provstad", adressComponents: { kommun: "Provkommun", kommundel: "Provdelen", adressomrade: "Provgatan", adressplatsnummer: "2", bokstavstillagg: "C", postnummer: 80182, postort: "Provstad" } },
    { objektidentitet: ID, adress: "a duplicate" },
    { objektidentitet: "not-an-id", adress: "no id" },
    { objektidentitet: "10000008-cafe-cafe-cafe-100000000002", adress: "Provbyn Provgården 4", adressComponents: { kommun: "P", kommundel: "P", adressomrade: "Provbyn", gardsadressomrade: "Provgården", adressplatsnummer: "4" } },
  ];
  const { fetch, calls } = fake(json(200, answer), json(200, []));
  const api = createAddressClient("production", { kind: "basic", user: "u", password: "p" }, { fetch, tokens: new Map() });
  const hits = await api.search("  Provgatan   2 ");
  assert.match(calls[0].url, /adress=Provgatan%202&maxHits=8&splitAdress=true$/, "the text is trimmed and its spaces collapsed");
  assert.deepEqual(hits, [
    { id: ID, label: "Provgatan 2C, 801 82 Provstad", address: "Provgatan 2C", postalCode: "801 82", city: "Provstad" },
    { id: "10000008-cafe-cafe-cafe-100000000002", label: "Provbyn Provgården 4", address: "Provbyn Provgården 4", postalCode: "", city: "" },
  ]);
  assert.deepEqual(await api.search("Provgatan"), []);
  // Too short: no question at all.
  assert.deepEqual(await api.search("Pr"), []);
  assert.equal(calls.length, 2);
  assert.deepEqual(parseAddressReferences({ not: "an array" }), []);
  assert.deepEqual(parseAddressReferences(null), []);
});

test("choosing a suggestion fetches the address by id with its point, converted back to WGS 84", async () => {
  // A point 10 m from where the pin would be: the conversion closes the loop to well under a metre.
  const point = toSweref99Tm(57.7089, 11.9746);
  const { fetch, calls } = fake(json(200, featureAt(point.easting, point.northing)), json(404, { code: 404, reason: "Not Found" }), json(200, { type: "FeatureCollection", features: [] }));
  const api = createAddressClient("production", { kind: "basic", user: "u", password: "p" }, { fetch, tokens: new Map() });
  const choice = await api.byId(ID);
  assert.equal(calls[0].url, addressUrls.byId("production", ID));
  assert.equal(choice?.address, "Provgatan 2C");
  assert.equal(choice?.postalCode, "801 82");
  assert.ok(choice?.point && Math.abs(choice.point.latitude - 57.7089) < 1e-6 && Math.abs(choice.point.longitude - 11.9746) < 1e-6);
  assert.equal(await api.byId(ID), null, "404: no such address");
  assert.equal(await api.byId(ID), null, "an empty collection");
  // Not an id: never asked.
  assert.equal(await api.byId("../punkt"), null);
  assert.equal(calls.length, 3);
  // Without geometry the fields still come, without a point.
  const unpinned = parseAddressChoice({ features: [{ ...featureAt(0, 0).features[0], geometry: null }] });
  assert.equal(unpinned?.point, null);
  assert.equal(unpinned?.address, "Provgatan 2C");
});

test("SWEREF 99 TM and WGS 84 round-trip for addresses across the country", () => {
  for (const [latitude, longitude] of [[55.6050, 13.0038], [57.7089, 11.9746], [59.3293, 18.0686], [63.8258, 20.263], [67.8558, 20.2253]]) {
    const back = fromSweref99Tm(toSweref99Tm(latitude, longitude));
    assert.ok(Math.abs(back.latitude - latitude) < 1e-9 && Math.abs(back.longitude - longitude) < 1e-9, `${latitude},${longitude}`);
  }
});

test("the search text: at least three characters, collapsed spaces, capped length; debounce and limits stay sensible", () => {
  assert.equal(ADDRESS_SEARCH_MIN, 3, "Lantmäteriet's own minimum");
  assert.equal(addressSearchText("ab"), null);
  assert.equal(addressSearchText("  a  b "), "a b");
  assert.equal(addressSearchText("   "), null);
  assert.equal(addressSearchText("Storgatan\t 1"), "Storgatan 1");
  assert.equal(addressSearchText("x".repeat(500))?.length, ADDRESS_SEARCH_MAX);
  assert.ok(ADDRESS_SEARCH_MAX <= 300, "within Lantmäteriet's 300");
  assert.ok(ADDRESS_SEARCH_HITS > 0 && ADDRESS_SEARCH_HITS <= 500);
  assert.ok(ADDRESS_SEARCH_DEBOUNCE_MS >= 250 && ADDRESS_SEARCH_DEBOUNCE_MS <= 600);
  assert.equal(isAddressId(ID), true);
  assert.equal(isAddressId("4c9326bb"), false);
  assert.equal(composeFromComponents({ adressomrade: "Provgatan", adressplatsnummer: "12", lagestillagg: "UH", lagestillaggsnummer: 3 }), "Provgatan 12 UH3");
  assert.equal(composeFromComponents({ adressomrade: "Provgatan", adressplatsnummer: "1", avvikandeAdressplatsbeteckning: "Lgh 1101" }), "Provgatan Lgh 1101");
  assert.equal(composeFromComponents({ kommun: "Provkommun" }), "", "the kommun is never a stand-in for a street");
});

test("the QA stand-in answers searches for Provgatan and gives its fixed point when chosen", () => {
  assert.deepEqual(qaAddressSearch("pr"), []);
  assert.deepEqual(qaAddressSearch("Storgatan"), []);
  const [hit] = qaAddressSearch("Provg");
  assert.equal(hit.id, QA_ADDRESS_ID);
  assert.equal(hit.address, QA_ADDRESS.address);
  const choice = qaAddressById(QA_ADDRESS_ID);
  assert.deepEqual(choice?.point, QA_ADDRESS_POINT);
  assert.equal(choice?.postalCode, QA_ADDRESS.postalCode);
  assert.match(choice?.source ?? "", /QA/);
  assert.equal(qaAddressById(ID), null);
});

test("a typed address moves the pin only when it is an address and a suggestion is that same address (2026-10-24)", () => {
  const typed = { address: "Provgatan 1", postalCode: "123 45", city: "Provstad" };
  assert.equal(geocodeText(typed), "Provgatan 1, 123 45 Provstad");
  assert.equal(geocodeText({ ...typed, postalCode: "", city: "" }), null, "a street alone is not yet an address");
  assert.equal(geocodeText({ ...typed, postalCode: "12", city: "" }), null, "a half postnummer is not enough");
  assert.equal(geocodeText({ ...typed, city: "" }), "Provgatan 1, 123 45");
  assert.equal(geocodeText({ ...typed, address: "12" }), null);
  const hits = qaAddressSearch(geocodeText(typed)!);
  assert.equal(geocodeMatch(typed, hits)?.id, QA_ADDRESS_ID);
  assert.equal(geocodeMatch({ ...typed, address: "provgatan  1" }, hits)?.id, QA_ADDRESS_ID, "case and spaces do not matter");
  assert.equal(geocodeMatch({ ...typed, address: "Provgatan 1B" }, hits), null, "another number is another address");
  assert.equal(geocodeMatch({ ...typed, address: "Provgatan 3" }, hits), null);
  assert.equal(geocodeMatch({ ...typed, postalCode: "543 21" }, hits), null, "another postnummer");
  assert.equal(geocodeMatch({ ...typed, city: "Annanstad" }, hits), null, "another postort");
  assert.equal(geocodeMatch({ ...typed, city: "" }, hits)?.id, QA_ADDRESS_ID);
});
