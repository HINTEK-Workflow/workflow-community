import assert from "node:assert/strict";
import { test } from "node:test";
import { fetchSolarStock, forgetSolarToken, SOLAR_TOKEN_URL, solarAtpUrl, solarObsolete, solarStatusText, solarStockOf } from "../lib/integrations/solar";
import { solarStockText } from "../features/workflow/catalogue-picker";

// Lagersaldo hos Solar (2026-10-15): Get ATP for the E-numbers an article search shows, near the company's postal
// code – no account, no catalogue number, never a price.

const config = { clientId: "qa-client", clientSecret: "qa-secret", countryCode: "SE" };

function fakeSolar(answer: (url: string, init: RequestInit) => Response) {
  const calls: { url: string; init: RequestInit }[] = [];
  const fetcher = (async (input: string | URL | Request, init: RequestInit = {}) => {
    const url = String(input);
    calls.push({ url, init });
    if (url === SOLAR_TOKEN_URL) return new Response(JSON.stringify({ access_token: "token-1", expires_in: 3600 }), { status: 200 });
    return answer(url, init);
  }) as typeof fetch;
  return { calls, fetcher };
}

test("the stock call is Solar's documented Get ATP: POST, country code, postal code and E-numbers", async () => {
  forgetSolarToken();
  const solar = fakeSolar(() => new Response(JSON.stringify([{ productId: "1234567", unitCode: "ST", atpStock: 12, stockType: "Lager", message: "" }]), { status: 200 }));
  const answer = await fetchSolarStock(config, ["1234567", "1234567", "12", "7654321"], "123 45", solar.fetcher);
  assert.equal(answer.status, "ok");
  if (answer.status === "ok") {
    assert.deepEqual(answer.items.map((item) => ({ ...item, fetchedAt: undefined })), [{ eNumber: "1234567", productId: "1234567", stock: 12, unit: "ST", stockType: "Lager", message: "", fetchedAt: undefined }]);
    assert.match(answer.items[0].fetchedAt, /^\d{4}-\d{2}-\d{2}T/, "the saldo is stamped with when Solar was asked");
  }
  const call = solar.calls.find((item) => item.url !== SOLAR_TOKEN_URL)!;
  assert.equal(call.url, solarAtpUrl("SE"));
  assert.equal(call.url, "https://api.solar.eu/procurement/V1/products/atp?countrycode=SE");
  assert.equal(call.init.method, "POST");
  assert.deepEqual(JSON.parse(String(call.init.body)), { postalCode: "12345", productIdentifier: "ElectricalNumber", products: [{ productId: "1234567" }, { productId: "7654321" }] });
  assert.equal(new Headers(call.init.headers).get("authorization"), "Bearer token-1");
  assert.equal(String(call.init.body).includes("qa-secret"), false, "the secret never goes with the stock call");
});

test("no E-number asks nothing; errors are plain words", async () => {
  forgetSolarToken();
  const quiet = fakeSolar(() => { throw new Error("must not be called"); });
  assert.deepEqual(await fetchSolarStock(config, ["12", ""], "12345", quiet.fetcher), { status: "ok", items: [] });
  assert.equal(quiet.calls.length, 0);
  forgetSolarToken();
  const refused = fakeSolar(() => new Response("", { status: 403 }));
  assert.deepEqual(await fetchSolarStock(config, ["1234567"], "12345", refused.fetcher), { status: "error", message: "Solar har inte gett tillgång till lagersaldo." });
});

test("the answer is read tolerantly and said in plain words", () => {
  const at = new Date("2026-10-15T12:00:00Z");
  assert.deepEqual(solarStockOf([{ productId: "E1234567", atpStock: 0, unitCode: "M" }, { productId: "" }, "junk", { productId: "7654321", atpStock: "many" }], at), [
    { eNumber: "1234567", productId: "1234567", stock: 0, unit: "M", stockType: "", message: "", fetchedAt: "2026-10-15T12:00:00.000Z" },
    { eNumber: "7654321", productId: "7654321", stock: null, unit: "", stockType: "", message: "", fetchedAt: "2026-10-15T12:00:00.000Z" },
  ]);
  assert.equal(solarStockText({ eNumber: "1", productId: "1", fetchedAt: "", stock: 12, unit: "ST", stockType: "", message: "" }), "Solar: 12 st i lager");
  assert.equal(solarStockText({ eNumber: "1", productId: "1", fetchedAt: "", stock: 1500, unit: "M", stockType: "", message: "" }), "Solar: 1 500 m i lager");
  assert.equal(solarStockText({ eNumber: "1", productId: "1", fetchedAt: "", stock: 0, unit: "", stockType: "", message: "" }), "Solar: inte i lager");
  assert.equal(solarStockText({ eNumber: "1", productId: "1", fetchedAt: "", stock: null, unit: "", stockType: "", message: "" }), "");
  assert.equal(solarStockText(undefined), "");
});

test("the saldo says when Solar was asked, and Solar's other identifiers and statuses are read as documented", async () => {
  assert.equal(solarStockText({ eNumber: "1", productId: "1", fetchedAt: "2026-10-15T12:32:00Z", stock: 12, unit: "ST", stockType: "", message: "" }), "Solar: 12 st i lager · kl. 14:32");
  forgetSolarToken();
  const solar = fakeSolar(() => new Response(JSON.stringify([{ productId: "7318510001234", atpStock: 3, unitCode: "ST" }]), { status: 200 }));
  const byEan = await fetchSolarStock(config, ["7318510001234", "1234567"], "12345", solar.fetcher, "EANNumber");
  assert.equal(byEan.status, "ok");
  const call = solar.calls.find((item) => item.url !== SOLAR_TOKEN_URL)!;
  assert.deepEqual(JSON.parse(String(call.init.body)), { postalCode: "12345", productIdentifier: "EANNumber", products: [{ productId: "7318510001234" }] }, "only ids of the asked kind go with the call");
  assert.deepEqual([solarStatusText("10"), solarStatusText("11"), solarStatusText("33"), solarStatusText("40"), solarStatusText(""), solarStatusText(undefined)],
    ["", "Aktiv – annat centrallager hos Solar", "På väg att utgå hos Solar", "Utgången hos Solar", "", ""]);
  assert.deepEqual([solarObsolete("40"), solarObsolete("10"), solarObsolete(undefined)], [true, false, false]);
});
