import assert from "node:assert/strict";
import test from "node:test";
import {
  accountingAreaStatus, activeExternalProviders, webAreaStatus, apiAreaStatus, CONNECTION_AREA_KEYS, CONNECTION_AREAS, connectionArea, connectionAreaHref, machinesAreaStatus, otherKeys, payrollAreaStatus, RETIRED_SECTION_TARGET,
} from "../lib/integrations/connection-areas";
import { accountingSettingsSchema } from "../lib/quotes/accounting";
import { wholesalerBoxText } from "../lib/catalogue/gate-text";
import { connectionProviders, EXTERNAL_PROVIDERS, isOtherKeyProvider, OFFERED_EXTERNAL_PROVIDERS } from "../lib/integrations/key-catalog";
import { keyRefusalMessage } from "../lib/integrations/authenticate";
import { sourceKeyMissingText, sourceKeyRefusalText } from "../lib/machine/keys";
import { EXTERNAL_SERVICES } from "../lib/integrations/external-services";

// Kopplingar (2026-10-31, användartest S1/S2; four areas with every key beside its connection since 2026-11-03): a list of the
// company's connections with their status in one line, the open area beside it.
const now = new Date("2026-11-01T12:00:00Z");
const day = 86_400_000;
const key = (kind: "API" | "MCP" | "EXTERNAL", expiresInDays: number | null, extra: { revokedAt?: string | null; name?: string; provider?: string } = {}) =>
  ({ kind, expiresAt: expiresInDays === null ? null : new Date(now.getTime() + expiresInDays * day).toISOString(), revokedAt: extra.revokedAt ?? null, name: extra.name ?? "Nyckel", provider: extra.provider ?? null });

test("areas: Bokföring first, then Lön och export, Maskiner, API och MCP; one area per ?section=; the removed rows send on", () => {
  assert.deepEqual(CONNECTION_AREAS.map((area) => area.key), [...CONNECTION_AREA_KEYS]);
  // 2026-11-03: the admin looks for Fortnox and lön, so a computer opens Bokföring; Grossister, Import och export and the
  // keys' row are gone, and their older addresses land where the thing is.
  assert.deepEqual(CONNECTION_AREAS.map((area) => area.title), ["Bokföring", "Lön och export", "Maskiner", "API och MCP", "Webb och sociala medier"]);
  assert.deepEqual(RETIRED_SECTION_TARGET, { keys: "/?view=advanced&section=payroll", wholesale: "/?view=import", files: "/?view=import" });
  for (const section of ["keys", "wholesale", "files"]) assert.equal(connectionArea(section), null, section);
  assert.equal(connectionArea("payroll")?.title, "Lön och export");
  assert.equal(connectionAreaHref("payroll"), "/?view=advanced&section=payroll", "opens beside the list (2026-11-02); Tid has the same content");
  for (const area of CONNECTION_AREAS) assert.equal(connectionAreaHref(area.key), `/?view=advanced&section=${area.key}`, "every area stays on Kopplingar");
  assert.equal(connectionArea(null), null);
  assert.equal(connectionArea("integrations"), null, "an older address is the overview");
  assert.equal(connectionAreaHref("accounting"), "/?view=advanced&section=accounting");
  for (const area of CONNECTION_AREAS) assert.ok(area.title.length <= 26 && area.description.length <= 70 && !area.description.includes("\n"), area.key);
});

test("API och MCP: on with keys or apps, off without, needs action when a key has run out or soon will", () => {
  assert.deepEqual(apiAreaStatus([], 0, now), { state: "off", detail: "Inga nycklar eller anslutna appar" });
  assert.deepEqual(apiAreaStatus([key("API", 90), key("API", null), key("MCP", 200), key("EXTERNAL", null)], 1, now), { state: "on", detail: "2 API-nycklar · 1 MCP-nyckel · 1 ansluten app" });
  assert.deepEqual(apiAreaStatus([key("API", 5)], 0, now), { state: "action", detail: "1 nyckel går ut snart" });
  assert.deepEqual(apiAreaStatus([key("MCP", -1), key("API", -3)], 0, now), { state: "action", detail: "2 nycklar har gått ut" });
  assert.equal(apiAreaStatus([key("API", -3, { revokedAt: now.toISOString() })], 0, now).state, "off", "a revoked key is history");
});

test("every key beside its connection (2026-11-03): Fortnox on Bokföring, the payroll system's on Lön; older rows are Övriga nycklar until removed", () => {
  assert.deepEqual(connectionProviders("accounting"), ["fortnox"]);
  assert.deepEqual(connectionProviders("payroll"), ["payroll-sftp", "payroll-api"]);
  // Företagets egen AI-nyckel (2026-11-27): the OpenAI and Azure OpenAI keys are on their own card under Workflow AI.
  assert.deepEqual(connectionProviders("ai"), ["openai", "azure-openai"]);
  for (const provider of ["anthropic", "microsoft-365", "other", null, "unknown"]) assert.equal(isOtherKeyProvider(provider), true, String(provider));
  for (const provider of ["fortnox", "payroll-sftp", "payroll-api"]) assert.equal(isOtherKeyProvider(provider), false, provider);
  const keys = [key("EXTERNAL", null, { name: "Gammal", provider: "anthropic" }), key("EXTERNAL", null, { name: "Fortnox", provider: "fortnox" }), key("EXTERNAL", null, { name: "Lön", provider: "payroll-sftp" }),
    key("EXTERNAL", null, { name: "Borttagen", provider: "other", revokedAt: now.toISOString() }), key("EXTERNAL", null, { name: "Annan" }), key("API", null)];
  assert.deepEqual(otherKeys(keys).map((item) => item.name), ["Gammal", "Annan"], "a removed row is history, a connection's key is not Övriga");
  assert.deepEqual(activeExternalProviders(keys), ["anthropic", "fortnox", "payroll-sftp", "other"], "Bokföring shows the Fortnox card while a row exists");
  assert.equal(apiAreaStatus(keys, 0, now).detail, "1 API-nyckel", "Övriga nycklar never count in API och MCP's status");
});

test("Maskiner", () => {
  assert.deepEqual(machinesAreaStatus([], 0), { state: "off", detail: "Inga aktiva källor" });
  assert.deepEqual(machinesAreaStatus([{ name: "Press", status: "active" }, { name: "Pump", status: "revoked" }], 0), { state: "on", detail: "1 aktiv källa" });
  assert.deepEqual(machinesAreaStatus([{ name: "Press", status: "active" }], 2), { state: "action", detail: "2 larmförslag väntar på beslut" });
  assert.deepEqual(machinesAreaStatus([{ name: "Press", status: "expired" }], 0), { state: "action", detail: "Nyckeln har gått ut: Press" });
});

test("Bokföring: on with the accounts, off without anything, needs action with half the accounts; a Fortnox key says nothing while the connection is closed", () => {
  const empty = accountingSettingsSchema.parse({});
  const full = { ...empty, materialAccount: "3010", labourAccount: "3020", otherAccount: "3030", vatAccount: "2611", receivableAccount: "1510", series: "A" };
  assert.deepEqual(accountingAreaStatus(empty, null), { state: "off", detail: "Inga konton inlagda" });
  assert.deepEqual(accountingAreaStatus(full, null), { state: "on", detail: "Konton inlagda · SIE-fil" });
  assert.deepEqual(accountingAreaStatus(full, "Fortnox"), { state: "on", detail: "Konton inlagda · SIE-fil" }, "the ROT account is asked for only when a quote has ROT");
  assert.equal(accountingAreaStatus(empty, "Fortnox").state, "off");
  const half = accountingAreaStatus({ ...full, vatAccount: "", series: "" }, null);
  assert.equal(half.state, "action");
  assert.match(half.detail, /^Saknas: .*moms.* och verifikationsserie$/i);
});

test("Lön och export", () => {
  const payroll = (patch: { system?: string; ok?: boolean; text?: string; lastError?: string; withNumber?: number }) => ({
    settings: { system: patch.system ?? "flex_hrm", mode: "manual", lastError: patch.lastError ?? "" }, systemLabel: "Flex HRM",
    modeState: { ok: patch.ok ?? true, text: patch.text ?? "" }, staff: { withNumber: patch.withNumber ?? 3, total: 3 } });
  assert.deepEqual(payrollAreaStatus(payroll({}), "Filer för hand"), { state: "on", detail: "Flex HRM · Filer för hand" });
  assert.deepEqual(payrollAreaStatus(payroll({ system: "none" }), "Filer för hand"), { state: "off", detail: "Inget lönesystem valt" });
  assert.deepEqual(payrollAreaStatus(payroll({ withNumber: 1 }), "Filer för hand"), { state: "action", detail: "2 medarbetare saknar anställningsnummer" });
  assert.deepEqual(payrollAreaStatus(payroll({ ok: false, text: "SFTP finns inte än." }), "SFTP"), { state: "action", detail: "SFTP finns inte än." });
  assert.deepEqual(payrollAreaStatus(payroll({ lastError: "Filen kunde inte läsas." }), "SFTP"), { state: "action", detail: "Filen kunde inte läsas." });
});

test("Rättade texter: the wholesaler box, the external keys, the refused keys and the places say what is true", () => {
  // S3: never "API-koppling saknas" for a wholesaler whose catalogue is there; prices never through an API.
  assert.equal(wholesalerBoxText("solar", null), "Solars artikelkatalog finns – ladda upp prislista eller rabattbrev");
  assert.equal(wholesalerBoxText("solar", "inactive"), "Solars artikelkatalog uppdateras inte just nu – prisfilen läses in som era egna rader");
  assert.equal(wholesalerBoxText("solar", "not_fetched"), "Solars artikelkatalog är inte hämtad än – prisfilen läses in som era egna rader");
  assert.equal(wholesalerBoxText("ahlsell", "no_api"), "Ingen artikelkatalog från Ahlsell än – prisfilen läses in som era egna rader");
  for (const reason of [null, "inactive", "not_fetched", "no_api"] as const) assert.ok(!/API-koppling/.test(wholesalerBoxText("solar", reason)));
  // F6 and S4: every provider says what Workflow does with its key; no AI key is offered per company.
  for (const provider of EXTERNAL_PROVIDERS) assert.ok(provider.use.length > 10 && !/inte ännu/.test(provider.use), provider.key);
  // Beslut 16 (2026-11-01): Fortnox is not offered until a real connection exists, and its old key's row says so.
  // Hidden entirely (2026-11-20): the row never says that a connection is "not open yet".
  assert.equal(EXTERNAL_PROVIDERS.find((item) => item.key === "fortnox")?.use, "Används inte. Ta bort den när den inte behövs.");
  for (const provider of EXTERNAL_PROVIDERS) assert.doesNotMatch(provider.use, /inte öppen|inte påslagen|förbered/, provider.key);
  // 2026-11-03: "Annan tjänst" is not offered any more (Workflow is no password safe); an older row says what to do with it.
  // 2026-11-20: nor the payroll system's keys, until SFTP and API are built – no new external key at all, older rows can be removed.
  assert.deepEqual([...OFFERED_EXTERNAL_PROVIDERS], []);
  for (const provider of ["payroll-sftp", "payroll-api"]) assert.match(EXTERNAL_PROVIDERS.find((item) => item.key === provider)!.use, /^Används inte\./, provider);
  assert.equal(EXTERNAL_PROVIDERS.find((item) => item.key === "other")?.use, "Används inte – ta bort när den inte behövs.");
  // F3: a company's refused key points to its own page, never to the product owner's.
  for (const refusal of ["revoked", "expired"] as const) {
    const text = keyRefusalMessage(refusal, "API");
    assert.ok(text.includes("Inställningar → Kopplingar → API och MCP") && !text.includes("Tjänster och nycklar"), text);
  }
  // The intake without a key says that the key is missing; with a wrong one, that it is wrong.
  assert.match(sourceKeyMissingText(), /^Nyckel saknas\./);
  assert.match(sourceKeyMissingText(true), /X-Hintek-Key/);
  assert.equal(sourceKeyRefusalText("invalid"), "Nyckeln är ogiltig.");
  // The company's services are administered on their area's page, the key with its connection (never Arbetssätt, never a keys' row).
  for (const id of ["fortnox", "payroll-sftp", "api-v1", "mcp", "machines"]) {
    const service = EXTERNAL_SERVICES.find((item) => item.id === id)!;
    assert.match(service.admin[0].at, /^\/\?view=advanced&section=(accounting|payroll|api|machines)$/, id);
    for (const place of service.admin) assert.ok(!/company_features|section=keys/.test(place.at), `${id}: ${place.at}`);
  }
});

test("Webb och sociala medier: WordPress and Facebook och Instagram on one card each; a broken key or a page to choose needs someone", () => {
  const wp = (configured: boolean, unreadable = false) => ({ configured, passwordUnreadable: unreadable, passwordStored: configured || unreadable });
  const meta = (status: "missing" | "unchecked" | "choose" | "ok" | "action" | "invalid", page: string | null = "Sidan", instagram: string | null = "konto") => ({ status, page, instagram });
  assert.deepEqual(webAreaStatus(wp(false), meta("missing", null, null)), { state: "off", detail: "Inget kopplat" });
  assert.deepEqual(webAreaStatus(wp(true), meta("missing", null, null)), { state: "on", detail: "WordPress" });
  assert.deepEqual(webAreaStatus(wp(true), meta("ok")), { state: "on", detail: "WordPress · Facebook och Instagram" });
  assert.deepEqual(webAreaStatus(wp(false), meta("ok", "Sidan", null)), { state: "on", detail: "Facebook" });
  assert.equal(webAreaStatus(wp(false, true), meta("ok")).state, "action");
  assert.deepEqual(webAreaStatus(wp(true), meta("choose", null, null)), { state: "action", detail: "Facebook: välj sida" });
  assert.equal(webAreaStatus(wp(true), meta("invalid")).detail, "Facebook och Instagram: ny token behövs");
  assert.equal(webAreaStatus(null, null).state, "unknown");
});
