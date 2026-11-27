import assert from "node:assert/strict";
import test from "node:test";
import { checkSolarKeys, SOLAR_API_BASE, SOLAR_SCOPE, SOLAR_TOKEN_URL } from "../lib/integrations/solar";
import { resolveServerSecrets, serverSecretProblem } from "../lib/integrations/server-secret-values";
import { serverKeyStatuses } from "../lib/integrations/server-keys";

// Solar (2026-10-13 natt): Workflow's client id and secret under Servernycklar, a read-only check. Invented values.
const ID = "00000000-1111-2222-3333-444444444444";

test("the check asks for a token with the secret in the body, then only the accounts and one page of categories", async () => {
  const calls: { url: string; init?: RequestInit }[] = [];
  const fake = (async (url: string | URL | Request, init?: RequestInit) => {
    calls.push({ url: String(url), init });
    if (String(url) === SOLAR_TOKEN_URL) return new Response(JSON.stringify({ access_token: "token-x", expires_in: 3600 }), { status: 200 });
    if (String(url).includes("/catalogs/categories")) return new Response(JSON.stringify({ categories: { category: [{ id: 1 }] }, requestInfo: { total: 1234 } }), { status: 200 });
    return new Response(JSON.stringify([{ accountId: "1" }, { accountId: "2" }]), { status: 200 });
  }) as typeof fetch;
  const result = await checkSolarKeys({ clientId: ID, clientSecret: "hemlighet-pahittad" }, fake);
  assert.equal(result.ok, true);
  assert.match(result.message, /2 konton/);
  assert.match(result.message, /katalogen är öppen \(1[\s ]234 kategorier\)/);
  assert.match(result.message, /med landskoden ”SE”/);
  assert.equal(result.countryCode, "SE");
  assert.equal(calls.length, 3);
  assert.equal(calls[2].url, `${SOLAR_API_BASE}/catalogs/categories?limit=1&countrycode=SE`);
  const body = String(calls[0].init?.body);
  assert.match(body, /grant_type=client_credentials/);
  assert.ok(body.includes(encodeURIComponent(SOLAR_SCOPE)));
  assert.ok(!calls.some((call) => call.url.includes("hemlighet")), "the secret is never in an address");
  assert.equal(calls[1].url, `${SOLAR_API_BASE}/accounts`);
  assert.doesNotMatch(result.message, /token-x|hemlighet/);
});

test("refused credentials and a closed account list are said in plain words", async () => {
  const refused = (async () => new Response("{}", { status: 401 })) as typeof fetch;
  assert.deepEqual(await checkSolarKeys({ clientId: ID, clientSecret: "x".repeat(12) }, refused), { ok: false, message: "Solar godkände inte klient-id och hemlighet." });
  const closed = (async (url: string | URL | Request) => String(url) === SOLAR_TOKEN_URL ? new Response(JSON.stringify({ access_token: "t" }), { status: 200 }) : new Response("", { status: 403 })) as typeof fetch;
  assert.equal((await checkSolarKeys({ clientId: ID, clientSecret: "x".repeat(12) }, closed)).ok, false);
});

test("no accounts is not an error: they are only for Solar's prices and orders", async () => {
  const noAccounts = (async (url: string | URL | Request) => String(url) === SOLAR_TOKEN_URL ? new Response(JSON.stringify({ access_token: "t" }), { status: 200 })
    : String(url).includes("/catalogs/") ? new Response(JSON.stringify({ requestInfo: { total: 3 } }), { status: 200 }) : new Response("[]", { status: 200 })) as typeof fetch;
  const result = await checkSolarKeys({ clientId: ID, clientSecret: "x".repeat(12) }, noAccounts);
  assert.equal(result.ok, true);
  assert.match(result.message, /0 konton \(behövs bara för Solars priser och beställningar/);
  const closedCatalogue = (async (url: string | URL | Request) => String(url) === SOLAR_TOKEN_URL ? new Response(JSON.stringify({ access_token: "t" }), { status: 200 })
    : String(url).includes("/catalogs/") ? new Response("", { status: 403 }) : new Response("[]", { status: 200 })) as typeof fetch;
  const closed = await checkSolarKeys({ clientId: ID, clientSecret: "x".repeat(12) }, closedCatalogue);
  assert.equal(closed.ok, false);
  assert.match(closed.message, /inte tillgång till katalogen/);
});

test("the pair is entered in the app like Google's, and its shape is checked", () => {
  assert.equal(serverSecretProblem("solarClientId", ID), null);
  assert.ok(serverSecretProblem("solarClientId", "inte-ett-id"));
  const resolved = resolveServerSecrets({ solarClientId: { cipher: "c1" } }, { SOLAR_CLIENT_ID: "env-id", SOLAR_CLIENT_SECRET: "env-secret" }, () => ID);
  assert.equal(resolved.solarClientId.source, "app");
  // Once either is in the app, both come from the app: the environment's secret is never paired with the app's id.
  assert.equal(resolved.solarClientSecret.source, null);
  const row = serverKeyStatuses({ SOLAR_CLIENT_ID: ID, SOLAR_CLIENT_SECRET: "x".repeat(12) }).find((status) => status.id === "solar")!;
  assert.equal(row.configured, true);
  assert.equal(row.formatOk, true);
  assert.equal(row.check, "service");
});
