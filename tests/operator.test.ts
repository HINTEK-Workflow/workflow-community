import assert from "node:assert/strict";
import { createHash, generateKeyPairSync, sign } from "node:crypto";
import { afterEach, test } from "node:test";
import {
  callsOnCall, causesOf, DEFAULT_CAUSES, faultOrderText, faultReportInputSchema, normalizeUsername, OPERATOR_LOCK_TRIES, operatorMachineStatus, operatorPasswordProblem,
  operatorSessionValid, reportStatusLabel, withinWorkday, aiTroubleshootingOn, onCallState, inactivityText,
} from "../lib/operator/rules";
import { OPERATOR_ONLY_REFUSAL, operatorRequestRefused } from "../lib/operator/guard";
import { asOwnTree, knownNodeIds, nodePath, visibleNodes, type MachineNode } from "../lib/operator/machines";
import { authorizeUrl, flowCookieValue, groupSignInDecision, idTokenClaimsProblem, memberOfGroup, microsoftOperatorName, parseFlowCookie, type GroupSettings } from "../lib/operator/microsoft-group";
import { checkGroup, identityFromCode, isGroupMember, setMicrosoftConfigForTests, verifiedClaims } from "../lib/operator/microsoft-group-server";
import { troubleshootSuggestions } from "../lib/operator/troubleshoot";
import { operatorNotifications } from "../lib/operator/admin-notice";
import { assertMayTry } from "../lib/auth/sign-in-limit";
import { LOGIN_RATE_LIMITED, LOGIN_UNAVAILABLE } from "../lib/auth/password";
import { clearRateLimit, hitRateLimit, RATE_RULES, setRateLimitStoreForTests, type RateLimitStore } from "../lib/security/rate-limit";
import { swedishDate } from "../lib/swedish-time";
import { microsoftIdentity } from "../lib/auth/microsoft-core";
import { DEMO_OPERATOR_PASSWORD, demoOperatorApi, resetDemoOperator } from "../features/demo/demo-operator";

afterEach(() => { setRateLimitStoreForTests(null); setMicrosoftConfigForTests(null); });

// ---------- passwords and usernames ----------

test("operator passwords: at least 8 characters, never common, a sequence, one character or the name", () => {
  assert.match(operatorPasswordProblem("kort1"), /Minst 8 tecken/);
  for (const common of ["password", "Password1!", "Sommar2026", "lösenord", "qwerty123", "operator1", "12345678"]) assert.notEqual(operatorPasswordProblem(common), "", common);
  assert.match(operatorPasswordProblem("abcdefgh"), /följder|vanligt/);
  assert.match(operatorPasswordProblem("aaaaaaaaaa"), /För enkelt/);
  assert.match(operatorPasswordProblem("Press4-hemligt", { username: "Press 4" }), /användarnamnet/);
  assert.match(operatorPasswordProblem("exempel-fabrik-9x", { company: "Exempel Fabrik AB" }), /användarnamnet|företagets/);
  assert.equal(operatorPasswordProblem("Gul-Traktor-41"), "", "eight characters that are not common pass (milder than the 12 of ordinary accounts)");
  assert.equal(operatorPasswordProblem("a".repeat(201)).startsWith("Högst"), true);
});

test("usernames: an e-mail address or a name, tidied; a colon (Microsoft keys) is never allowed", () => {
  const name = normalizeUsername("  Press   4 ");
  assert.ok(name.ok && name.username === "Press 4" && name.key === "press 4" && !name.email);
  const email = normalizeUsername("Lisa.Berg@Exempel.se");
  assert.ok(email.ok && email.email && email.key === "lisa.berg@exempel.se");
  assert.equal(normalizeUsername("microsoft:abc").ok, false);
  assert.equal(normalizeUsername("x").ok, false);
  assert.equal(normalizeUsername("bad@mail").ok, false);
});

// ---------- lockout (RateLimitBucket, refusing while the store is down) ----------

function memoryStore(): RateLimitStore {
  const rows = new Map<string, { count: number; windowStart: Date }>();
  return {
    async hit(key) { const row = rows.get(key) ?? { count: 0, windowStart: new Date() }; row.count += 1; rows.set(key, row); return { ...row }; },
    async read(key) { return rows.get(key) ?? null; },
    async clear(key) { rows.delete(key); },
  };
}

test("five wrong passwords lock the operator account; a right one clears it; a store that is down refuses", async () => {
  setRateLimitStoreForTests(memoryStore());
  const subject = "org-1:press 4";
  await assertMayTry(RATE_RULES.operatorAccount, subject);
  assert.equal(RATE_RULES.operatorAccount.limit, OPERATOR_LOCK_TRIES);
  for (let index = 0; index < OPERATOR_LOCK_TRIES; index++) await hitRateLimit(RATE_RULES.operatorAccount, subject);
  await assert.rejects(assertMayTry(RATE_RULES.operatorAccount, subject), new RegExp(LOGIN_RATE_LIMITED));
  await assertMayTry(RATE_RULES.operatorAccount, "org-2:press 4");
  await clearRateLimit(RATE_RULES.operatorAccount, subject);
  await assertMayTry(RATE_RULES.operatorAccount, subject);
  setRateLimitStoreForTests({ hit: async () => { throw new Error("down"); }, read: async () => { throw new Error("down"); }, clear: async () => undefined });
  await assert.rejects(assertMayTry(RATE_RULES.operatorAccount, subject), new RegExp(LOGIN_UNAVAILABLE));
});

// ---------- sessions ----------

test("an operator session holds only on its device, within the inactivity time and the max age, while the account is active", () => {
  const now = Date.parse("2026-10-30T12:00:00Z");
  const row = { revokedAt: null, createdAt: new Date(now - 3_600_000), lastSeenAt: new Date(now - 10 * 60_000), deviceHash: "dev-a" };
  const account = { active: true, sessionsRevokedAt: null };
  const base = { row, deviceHash: "dev-a", inactivityMinutes: 15, account, now };
  assert.equal(operatorSessionValid(base), true);
  assert.equal(operatorSessionValid({ ...base, deviceHash: "dev-b" }), false, "another device");
  assert.equal(operatorSessionValid({ ...base, deviceHash: null }), false, "no device cookie");
  assert.equal(operatorSessionValid({ ...base, inactivityMinutes: 5 }), false, "inactive too long");
  assert.equal(operatorSessionValid({ ...base, row: { ...row, revokedAt: new Date(now) } }), false, "Logga ut");
  assert.equal(operatorSessionValid({ ...base, account: { active: false, sessionsRevokedAt: null } }), false, "Spärrad");
  assert.equal(operatorSessionValid({ ...base, account: { active: true, sessionsRevokedAt: new Date(now - 60_000) } }), false, "a new password ends older sessions");
  assert.equal(operatorSessionValid({ ...base, row: { ...row, createdAt: new Date(now - 25 * 3_600_000), lastSeenAt: new Date(now) } }), false, "max age");
  assert.equal(operatorSessionValid({ ...base, row: null }), false);
});

// ---------- the operator role ----------

test("the role guard: an operator session alone never reaches an /api route; a person's session is never touched", () => {
  assert.equal(operatorRequestRefused("/api/workflow-tasks", ["wf_operator", "wf_operator_device"]), true);
  assert.equal(operatorRequestRefused("/api/administration", ["__Secure-wf_operator"]), true);
  assert.equal(operatorRequestRefused("/api/operator-accounts", ["wf_operator"]), true, "not even the admin's operator page");
  assert.equal(operatorRequestRefused("/operator/api/me", ["wf_operator"]), false, "the operator endpoints");
  assert.equal(operatorRequestRefused("/operator/abc", ["wf_operator"]), false, "the page");
  assert.equal(operatorRequestRefused("/api/workflow-tasks", ["wf_operator", "__Secure-next-auth.session-token"]), false, "a person signed in on the same device");
  assert.equal(operatorRequestRefused("/api/workflow-tasks", ["wf_operator", "next-auth.qa-owner.session-token"]), false);
  assert.equal(operatorRequestRefused("/api/workflow-tasks", ["next-auth.session-token"]), false);
  assert.equal(operatorRequestRefused("/api/workflow-tasks", []), false, "signed out: the route answers itself");
  assert.equal(OPERATOR_ONLY_REFUSAL, "Operatörskonton når bara felanmälan.");
});

// ---------- causes, reports, on call ----------

test("causes: the company's own list, the defaults until saved; a report's cause and severity are checked", () => {
  assert.deepEqual(causesOf(null), [...DEFAULT_CAUSES]);
  assert.deepEqual(causesOf(["Läckage", "Brand"]), ["Läckage", "Brand"]);
  assert.deepEqual(causesOf(["Läckage", "läckage"]), [...DEFAULT_CAUSES], "a broken list falls back");
  assert.equal(faultReportInputSchema.safeParse({ machineId: "m", cause: "Läckage", severity: "ACUTE" }).success, true);
  assert.equal(faultReportInputSchema.safeParse({ machineId: "m", cause: "Läckage", severity: "VERY" }).success, false);
  assert.equal(faultReportInputSchema.safeParse({ machineId: "", cause: "Läckage", severity: "LOW" }).success, false);
  const text = faultOrderText({ machineLabel: "Linje 2 › Press 4", cause: "Läckage", text: "Droppar olja", severity: "ACUTE", reporter: "Ali", accountName: "Press 4" });
  assert.equal(text.priority, "URGENT");
  assert.match(text.title, /Felanmälan: Läckage – Linje 2 › Press 4/);
  assert.match(text.description, /Ali \(Press 4\)/);
});

test("on call: Akut always, Hög only outside the company's workday (weekends too), never Låg or Normal", () => {
  const workday = { startMinutes: 7 * 60, endMinutes: 16 * 60 };
  const thursdayNoon = swedishDate(2026, 10, 29, 12, 0);
  const thursdayNight = swedishDate(2026, 10, 29, 22, 30);
  const saturday = swedishDate(2026, 10, 31, 10, 0);
  assert.equal(withinWorkday(thursdayNoon, workday), true);
  assert.equal(withinWorkday(swedishDate(2026, 10, 29, 16, 0), workday), false, "the end is outside");
  assert.equal(callsOnCall("ACUTE", thursdayNoon, workday), true);
  assert.equal(callsOnCall("HIGH", thursdayNoon, workday), false);
  assert.equal(callsOnCall("HIGH", thursdayNight, workday), true);
  assert.equal(callsOnCall("HIGH", saturday, workday), true);
  assert.equal(callsOnCall("NORMAL", thursdayNight, workday), false);
  assert.equal(callsOnCall("LOW", saturday, workday), false);
  assert.deepEqual(onCallState({ onCall: true, acknowledgedAt: null }), { state: "waiting" });
  assert.equal(onCallState({ onCall: true, acknowledgedAt: new Date("2026-10-30T01:14:00Z") }).state, "acknowledged");
  assert.deepEqual(onCallState({ onCall: false, acknowledgedAt: null }), { state: "none" });
});

test("what the operator sees: report status in words and the machine's status", () => {
  assert.equal(reportStatusLabel("pending", null), "Väntar på godkännande");
  assert.equal(reportStatusLabel("rejected", null), "Avvisad");
  assert.equal(reportStatusLabel("received", "PLANNED"), "Mottagen");
  assert.equal(reportStatusLabel("received", "IN_PROGRESS"), "Pågår");
  assert.equal(reportStatusLabel("received", "COMPLETED"), "Åtgärdad");
  assert.equal(operatorMachineStatus({ openReports: 1, operatingState: "IN_SERVICE", runState: null }).label, "Felanmäld");
  assert.equal(operatorMachineStatus({ openReports: 0, operatingState: "OUT_OF_SERVICE", runState: "running" }).label, "Ur drift");
  assert.equal(operatorMachineStatus({ openReports: 0, operatingState: "", runState: "stopped" }).label, "Stoppad");
  assert.equal(operatorMachineStatus({ openReports: 0, operatingState: "", runState: null }).label, "Ingen anmälan");
});

// ---------- the machine tree an account sees ----------

const n = (id: string, parentId: string | null, name = id): MachineNode => ({ id, parentId, name, objectType: "", reportable: true, alarmFacilityId: id, operatingState: "" });
const tree = [n("fab", null, "Fabriken"), n("l2", "fab", "Linje 2"), n("p4", "l2", "Press 4"), n("pump", "p4", "Hydraulpump"), n("band", "l2", "Band"), n("st", null, "Station")];

test("an account sees each chosen node and everything under it – none chosen, none seen – and never above", () => {
  assert.deepEqual(visibleNodes(tree, []), []);
  assert.deepEqual(visibleNodes(tree, ["p4"]).map((item) => item.id), ["p4", "pump"]);
  assert.deepEqual(visibleNodes(tree, ["l2", "st"]).map((item) => item.id).sort(), ["band", "l2", "p4", "pump", "st"]);
  assert.deepEqual(visibleNodes(tree, ["gone"]), []);
  const own = asOwnTree(visibleNodes(tree, ["p4"]));
  assert.equal(own.find((item) => item.id === "p4")?.parentId, null, "the chosen node is a top node: nothing above it can be opened");
  assert.equal(nodePath(tree, "pump"), "Fabriken › Linje 2 › Press 4 › Hydraulpump");
  assert.deepEqual(knownNodeIds(tree, ["p4", "x", "p4"]), ["p4"]);
});

// ---------- Microsoft group (mocked Microsoft) ----------

const TID = "11111111-2222-3333-4444-555555555555";
const OID = "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee";
const GROUP = "99999999-8888-7777-6666-555555555555";
const CLIENT = "0a1b2c3d-0000-4000-8000-000000000001";
const settings: GroupSettings = { enabled: true, tenantId: TID, groupId: GROUP, consentAt: new Date() };
const identity = microsoftIdentity({ tid: TID, oid: OID, name: "Elin Ström", email: "elin@exempel.se" });

test("group sign-in: only the company's directory, only members of the group, never on a guess, off by default", () => {
  assert.deepEqual(groupSignInDecision({ settings, identity, member: true }), { ok: true });
  assert.deepEqual(groupSignInDecision({ settings, identity, member: false }), { ok: false, error: "not_member" });
  assert.deepEqual(groupSignInDecision({ settings, identity, member: null }), { ok: false, error: "graph" }, "Graph could not be asked");
  assert.deepEqual(groupSignInDecision({ settings: { ...settings, enabled: false }, identity, member: true }), { ok: false, error: "off" });
  assert.deepEqual(groupSignInDecision({ settings: { ...settings, consentAt: null }, identity, member: true }), { ok: false, error: "off" });
  const other = microsoftIdentity({ tid: "22222222-2222-3333-4444-555555555555", oid: OID });
  assert.deepEqual(groupSignInDecision({ settings, identity: other, member: true }), { ok: false, error: "tenant" });
  assert.deepEqual(groupSignInDecision({ settings, identity: null, member: true }), { ok: false, error: "identity" });
  assert.equal(memberOfGroup({ value: [GROUP.toUpperCase()] }, GROUP), true);
  assert.equal(memberOfGroup({ value: [] }, GROUP), false);
  assert.equal(memberOfGroup(null, GROUP), false);
  assert.equal(microsoftOperatorName({ name: "", label: "" }), "Microsoft-konto");
  assert.match(authorizeUrl({ tenant: TID, clientId: CLIENT, redirectUri: "https://app/x", state: "s", nonce: "n", codeChallenge: "c" }), new RegExp(`login\\.microsoftonline\\.com/${TID}/oauth2/v2\\.0/authorize\\?.*code_challenge_method=S256`));
});

test("the ID token's claims: issuer of its own directory, our audience, times, nonce and the expected directory", () => {
  const now = Date.parse("2026-10-30T12:00:00Z");
  const claims = { iss: `https://login.microsoftonline.com/${TID}/v2.0`, aud: CLIENT, exp: now / 1000 + 600, nbf: now / 1000 - 10, nonce: "n1", tid: TID, oid: OID };
  const expected = { clientId: CLIENT, nonce: "n1", tenant: TID, now };
  assert.equal(idTokenClaimsProblem(claims, expected), null);
  assert.equal(idTokenClaimsProblem({ ...claims, aud: "someone-else" }, expected), "aud");
  assert.equal(idTokenClaimsProblem({ ...claims, nonce: "other" }, expected), "nonce");
  assert.equal(idTokenClaimsProblem({ ...claims, exp: now / 1000 - 3600 }, expected), "exp");
  assert.equal(idTokenClaimsProblem({ ...claims, iss: "https://evil.example/v2.0" }, expected), "iss");
  assert.equal(idTokenClaimsProblem(claims, { ...expected, tenant: "22222222-2222-3333-4444-555555555555" }), "tenant");
  assert.equal(idTokenClaimsProblem(claims, { ...expected, tenant: null }), null, "connect: any work directory");
});

test("the flow cookie: whole, of a known purpose and at most ten minutes old", () => {
  const flow = { purpose: "operator" as const, state: "s", nonce: "n", verifier: "v", pageKey: "abc", organizationId: "o", at: Date.now() };
  assert.deepEqual(parseFlowCookie(flowCookieValue(flow)), flow);
  assert.equal(parseFlowCookie(flowCookieValue({ ...flow, at: Date.now() - 11 * 60_000 })), null);
  assert.equal(parseFlowCookie("not-base64-json"), null);
  assert.equal(parseFlowCookie(undefined), null);
});

const { privateKey, publicKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
const jwk = { ...publicKey.export({ format: "jwk" }), kid: "k1", use: "sig" };
function idToken(claims: Record<string, unknown>, kid = "k1") {
  const head = Buffer.from(JSON.stringify({ alg: "RS256", kid, typ: "JWT" })).toString("base64url");
  const body = Buffer.from(JSON.stringify(claims)).toString("base64url");
  return `${head}.${body}.${sign("RSA-SHA256", Buffer.from(`${head}.${body}`), privateKey).toString("base64url")}`;
}
type Call = { url: string; init?: RequestInit };
function mockMicrosoft(answers: (call: Call) => Response) {
  const calls: Call[] = [];
  const fetcher = (async (url: string | URL | Request, init?: RequestInit) => { const call = { url: String(url), init }; calls.push(call); return answers(call); }) as typeof fetch;
  return { fetcher, calls };
}
const json = (value: unknown, status = 200) => new Response(JSON.stringify(value), { status, headers: { "content-type": "application/json" } });

test("the ID token's signature is verified against Microsoft's keys; a wrong key or a changed body is refused", async () => {
  const now = Math.floor(Date.now() / 1000);
  const claims = { iss: `https://login.microsoftonline.com/${TID}/v2.0`, aud: CLIENT, exp: now + 600, nonce: "n1", tid: TID, oid: OID, name: "Elin Ström" };
  const keys = mockMicrosoft((call) => call.url.includes("/discovery/v2.0/keys") ? json({ keys: [jwk] }) : json({}, 404));
  assert.equal((await verifiedClaims(idToken(claims), { clientId: CLIENT, nonce: "n1", tenant: TID }, keys.fetcher))?.oid, OID);
  assert.equal(await verifiedClaims(idToken(claims, "unknown"), { clientId: CLIENT, nonce: "n1", tenant: TID }, keys.fetcher), null, "unknown key");
  const [head, , signature] = idToken(claims).split(".");
  const forged = `${head}.${Buffer.from(JSON.stringify({ ...claims, oid: "bbbbbbbb-bbbb-cccc-dddd-eeeeeeeeeeee" })).toString("base64url")}.${signature}`;
  assert.equal(await verifiedClaims(forged, { clientId: CLIENT, nonce: "n1", tenant: TID }, keys.fetcher), null, "a changed body");
  assert.equal(await verifiedClaims(idToken({ ...claims, nonce: "replayed" }), { clientId: CLIENT, nonce: "n1", tenant: TID }, keys.fetcher), null, "another sign-in's token");
});

test("the code is exchanged with PKCE and the identity is tid + oid from the verified token (never the e-mail)", async () => {
  setMicrosoftConfigForTests({ clientId: CLIENT, clientSecret: "test-secret", tenant: "organizations" });
  const now = Math.floor(Date.now() / 1000);
  const token = idToken({ iss: `https://login.microsoftonline.com/${TID}/v2.0`, aud: CLIENT, exp: now + 600, nonce: "n1", tid: TID, oid: OID, email: "someone@else.se", name: "Elin" });
  const microsoft = mockMicrosoft((call) => call.url.endsWith("/oauth2/v2.0/token") ? json({ id_token: token }) : call.url.includes("/keys") ? json({ keys: [jwk] }) : json({}, 404));
  const flow = { purpose: "operator" as const, state: "s", nonce: "n1", verifier: "the-verifier", pageKey: "abc", organizationId: "o", at: Date.now() };
  const found = await identityFromCode({ code: "the-code", flow, tenant: TID }, microsoft.fetcher);
  assert.equal(found?.providerAccountId, `${TID}:${OID}`);
  const body = new URLSearchParams(String(microsoft.calls[0].init?.body));
  assert.equal(body.get("code_verifier"), "the-verifier");
  assert.equal(body.get("grant_type"), "authorization_code");
  assert.equal(createHash("sha256").update("x").digest("hex").length, 64);
});

test("group membership is asked of Graph (checkMemberGroups); no answer is never a yes", async () => {
  setMicrosoftConfigForTests({ clientId: CLIENT, clientSecret: "test-secret", tenant: "organizations" });
  const member = mockMicrosoft((call) => call.url.endsWith("/token") ? json({ access_token: "app-token" }) : call.url.includes("/checkMemberGroups") ? json({ value: [GROUP] }) : json({}, 404));
  assert.equal(await isGroupMember({ tenant: TID, oid: OID, groupId: GROUP }, member.fetcher), true);
  const graphCall = member.calls.find((call) => call.url.includes("checkMemberGroups"))!;
  assert.match(graphCall.url, new RegExp(`/users/${OID}/checkMemberGroups$`));
  assert.deepEqual(JSON.parse(String(graphCall.init?.body)), { groupIds: [GROUP] });
  assert.equal((graphCall.init?.headers as Record<string, string>).authorization, "Bearer app-token");
  const left = mockMicrosoft((call) => call.url.endsWith("/token") ? json({ access_token: "t" }) : json({ value: [] }));
  assert.equal(await isGroupMember({ tenant: TID, oid: OID, groupId: GROUP }, left.fetcher), false, "removed from the group");
  const noConsent = mockMicrosoft(() => json({ error: "unauthorized_client" }, 400));
  assert.equal(await isGroupMember({ tenant: TID, oid: OID, groupId: GROUP }, noConsent.fetcher), null);
  const broken = mockMicrosoft((call) => call.url.endsWith("/token") ? json({ access_token: "t" }) : json({}, 503));
  assert.equal(await isGroupMember({ tenant: TID, oid: OID, groupId: GROUP }, broken.fetcher), null);
  const check = mockMicrosoft((call) => call.url.endsWith("/token") ? json({ access_token: "t" }) : json({ id: GROUP, displayName: "Operatörer Fabriken" }));
  assert.deepEqual({ ...(await checkGroup({ tenant: TID, groupId: GROUP }, check.fetcher)), at: "" }, { ok: true, message: "Appen kan läsa gruppen Operatörer Fabriken.", at: "", name: "Operatörer Fabriken" });
  const forbidden = mockMicrosoft((call) => call.url.endsWith("/token") ? json({ access_token: "t" }) : json({}, 403));
  assert.match((await checkGroup({ tenant: TID, groupId: GROUP }, forbidden.fetcher)).message, /GroupMember\.Read\.All/);
});

// ---------- AI troubleshooting: off means nothing ----------

test("AI troubleshooting is off unless both switches are on; its suggestions carry their basis", () => {
  assert.equal(aiTroubleshootingOn({ product: false, company: false }), false);
  assert.equal(aiTroubleshootingOn({ product: true, company: false }), false);
  assert.equal(aiTroubleshootingOn({ product: false, company: true }), false);
  assert.equal(aiTroubleshootingOn({ product: true, company: true }), true);
  const suggestions = troubleshootSuggestions({ cause: "Läckage", history: {
    work: [{ label: "AO-1031", at: "2026-10-01T10:00:00Z", cause: "Läckage: droppar", done: "Bytte tätning." }, { label: "AO-1019", at: "2026-09-01T10:00:00Z", cause: "Ovanligt ljud", done: "Smorde lager." }],
    alarms: [{ at: "2026-10-30T02:10:00Z", code: "T-HIGH", text: "Oljetemperatur hög" }],
  } });
  assert.equal(suggestions.length, 3);
  assert.match(suggestions[0].text, /Bytte tätning/);
  assert.match(suggestions[0].basis, /AO-1031/);
  assert.match(suggestions[1].text, /Oljetemperatur hög/);
  assert.deepEqual(troubleshootSuggestions({ cause: "Läckage", history: { work: [], alarms: [] } }), []);
});

test("the demo operator page: a wrong password counts, five lock, a blocked account is refused, troubleshooting is off", async () => {
  resetDemoOperator();
  await assert.rejects(demoOperatorApi.signIn({ page: "demo", username: "Avdelning Montering", password: DEMO_OPERATOR_PASSWORD }), /spärrat/);
  for (let index = 0; index < 4; index++) await assert.rejects(demoOperatorApi.signIn({ page: "demo", username: "Press 4", password: "fel" }), /Fel användarnamn/);
  await assert.rejects(demoOperatorApi.signIn({ page: "demo", username: "Press 4", password: "fel" }), /För många försök/);
  await assert.rejects(demoOperatorApi.signIn({ page: "demo", username: "Press 4", password: DEMO_OPERATOR_PASSWORD }), /För många försök/, "locked even with the right one");
  await demoOperatorApi.signIn({ page: "demo", username: "Linje 2", password: DEMO_OPERATOR_PASSWORD });
  const page = await demoOperatorApi.load();
  assert.ok(page.machines.every((item) => item.path.includes("Linje 2")), "Linje 2 sees only Linje 2");
  await assert.rejects(demoOperatorApi.send({ machineId: "m-p1", cause: "Läckage", text: "", severity: "LOW", reporterName: "", photos: [] }), /finns inte bland dina/);
  const sent = await demoOperatorApi.send({ machineId: "m-pump", cause: "Läckage", text: "", severity: "ACUTE", reporterName: "Kim", photos: [] });
  assert.ok(sent.onCall && /^AO-\d+$/.test(sent.workOrder));
  await assert.rejects(demoOperatorApi.troubleshoot({ machineId: "m-pump", cause: "Läckage" }), /Finns inte/);
  resetDemoOperator();
});

test("the admins' notice for a new Microsoft operator: needs action, opens Operatörskonton", () => {
  const [item] = operatorNotifications([{ id: "a1", name: "Elin Ström", createdAt: new Date("2026-10-30T08:00:00Z") }]);
  assert.equal(item.kind, "OPERATOR");
  assert.equal(item.needsAction, true);
  assert.equal(item.href, "/?view=operator_accounts&account=a1");
  assert.match(item.title, /Nytt operatörskonto: Elin Ström/);
});

test("the inactivity time reads in hours when it is whole hours (kundresa 2026-11-07, M10)", () => {
  assert.equal(inactivityText(15), "15 minuter");
  assert.equal(inactivityText(60), "1 timme");
  assert.equal(inactivityText(480), "8 timmar");
  assert.equal(inactivityText(90), "1 timme och 30 minuter");
});
