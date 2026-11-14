import assert from "node:assert/strict";
import test from "node:test";
import {
  authorizationUrl, createPost, exchangeCode, fetchTransport, LINKEDIN_VERSION, LinkedInError, linkedInErrorOf, linkedInUrl, littleText, organizationName, PERSONAL_SCOPES,
  postingOrganizations, refreshAccessToken, scopesFor, statusFromToken, uploadImage, userInfo, type LinkedInRequest, type LinkedInTransport,
} from "../lib/linkedin/api";
import { linkedInAlertAction, linkedInAlertState, linkedInAlertText } from "../lib/linkedin/alerts";
import { captionLimit, LINKEDIN_COMMENTARY_MAX, linkedInCommentary, postProblem } from "../lib/meta/text";

// LinkedIn (2026-11-11): the calls to LinkedIn and their shapes (as LinkedIn's documentation gives them, lib/linkedin/api.ts),
// the error mapping, the little text format, the status and the nightly alerts – against a recording stand-in, never LinkedIn.

/** A transport that records every request and answers from a list. */
function recorder(...answers: { status?: number; headers?: Record<string, string>; body?: unknown }[]) {
  const requests: LinkedInRequest[] = [];
  const transport: LinkedInTransport = async (request) => {
    requests.push(request);
    const next = answers.shift() ?? {};
    return { status: next.status ?? 200, headers: next.headers ?? {}, body: next.body ?? {} };
  };
  return { transport, requests };
}
const app = { clientId: "86abcdefgh1234", clientSecret: "WPL_AP1.secret.value==" };

test("the authorization address: LinkedIn's own page, code flow, state and space-separated scopes", () => {
  const url = new URL(authorizationUrl({ clientId: app.clientId, redirectUri: "https://app.example.se/api/linkedin/callback", state: "s".repeat(43), scopes: scopesFor("personal") }));
  assert.equal(url.origin + url.pathname, "https://www.linkedin.com/oauth/v2/authorization");
  assert.equal(url.searchParams.get("response_type"), "code");
  assert.equal(url.searchParams.get("client_id"), app.clientId);
  assert.equal(url.searchParams.get("redirect_uri"), "https://app.example.se/api/linkedin/callback");
  assert.equal(url.searchParams.get("state"), "s".repeat(43));
  assert.equal(url.searchParams.get("scope"), "openid profile w_member_social");
  assert.match(authorizationUrl({ clientId: "x", redirectUri: "https://a.se/cb", state: "y", scopes: ["a", "b"] }), /scope=a%20b/, "%20, not +");
  assert.deepEqual(scopesFor("organization"), [...PERSONAL_SCOPES, "w_organization_social", "r_organization_admin"]);
  assert.ok(!authorizationUrl({ clientId: "x", redirectUri: "https://a.se/cb", state: "y", scopes: ["a"] }).includes(app.clientSecret), "the secret never goes in an address");
});

test("the code and the refresh token are exchanged form-encoded at the token endpoint", async () => {
  const now = Date.now();
  const { transport, requests } = recorder(
    { body: { access_token: "AQV-access", expires_in: 5184000, refresh_token: "AQX-refresh", refresh_token_expires_in: 31536000, scope: "openid,profile,w_member_social" } },
    { body: { access_token: "AQV-new", expires_in: 5184000 } },
  );
  const tokens = await exchangeCode(transport, app, { code: "the-code", redirectUri: "https://a.se/api/linkedin/callback" });
  assert.deepEqual(requests[0], { method: "POST", url: "https://www.linkedin.com/oauth/v2/accessToken", form: {
    grant_type: "authorization_code", code: "the-code", client_id: app.clientId, client_secret: app.clientSecret, redirect_uri: "https://a.se/api/linkedin/callback",
  } });
  assert.equal(tokens.accessToken, "AQV-access");
  assert.equal(tokens.refreshToken, "AQX-refresh");
  assert.deepEqual(tokens.scopes, ["openid", "profile", "w_member_social"]);
  assert.ok(Math.abs(tokens.expiresAt!.getTime() - (now + 60 * 86_400_000)) < 5000, "about 60 days");
  const renewed = await refreshAccessToken(transport, app, "AQX-refresh");
  assert.deepEqual(requests[1].form, { grant_type: "refresh_token", refresh_token: "AQX-refresh", client_id: app.clientId, client_secret: app.clientSecret });
  assert.equal(renewed.refreshToken, null);
  const refused = recorder({ status: 400, body: { error: "invalid_grant", error_description: "expired" } });
  await assert.rejects(exchangeCode(refused.transport, app, { code: "x", redirectUri: "https://a.se/cb" }), (error: unknown) => error instanceof LinkedInError && error.status === 400);
});

test("who and where: userinfo, the approved page roles and the page names", async () => {
  const { transport, requests } = recorder(
    { body: { sub: "782bbtaQ", name: "Anna Andersson" } },
    { body: { elements: [
      { role: "ADMINISTRATOR", state: "APPROVED", organization: "urn:li:organization:2414183", roleAssignee: "urn:li:person:782bbtaQ" },
      { role: "CONTENT_ADMINISTRATOR", state: "APPROVED", organizationTarget: "urn:li:organization:555", roleAssignee: "urn:li:person:782bbtaQ" },
      { role: "ANALYST", state: "APPROVED", organization: "urn:li:organization:777" },
      { role: "ADMINISTRATOR", state: "REQUESTED", organization: "urn:li:organization:888" },
      { role: "ADMINISTRATOR", state: "APPROVED", organization: "urn:li:organization:2414183" },
    ] } },
    { body: { localizedName: "Elfirma AB" } },
    { status: 403, body: { status: 403 } },
  );
  assert.deepEqual(await userInfo(transport, "tok"), { id: "782bbtaQ", name: "Anna Andersson" });
  assert.deepEqual(requests[0], { method: "GET", url: "https://api.linkedin.com/v2/userinfo", token: "tok" });
  assert.deepEqual(await postingOrganizations(transport, "tok"), ["2414183", "555"], "only approved posting roles, each page once");
  const acl = new URL(requests[1].url);
  assert.equal(acl.origin + acl.pathname, "https://api.linkedin.com/rest/organizationAcls");
  assert.equal(acl.searchParams.get("q"), "roleAssignee");
  assert.equal(acl.searchParams.get("state"), "APPROVED");
  assert.equal(requests[1].rest, true, "the versioned headers");
  assert.equal(await organizationName(transport, "tok", "2414183"), "Elfirma AB");
  assert.equal(requests[2].url, "https://api.linkedin.com/rest/organizations/2414183");
  assert.equal(await organizationName(transport, "tok", "555"), "555", "the id when the name cannot be read");
  assert.equal(await organizationName(transport, "tok", "../x"), "../x");
  assert.equal(requests.length, 4, "a strange id is never asked for");
});

test("an image post: initializeUpload for the owner, PUT to LinkedIn's own upload address, then the post", async () => {
  const bytes = new Uint8Array([0xff, 0xd8, 0xff, 0xe0]);
  const { transport, requests } = recorder(
    { body: { value: { uploadUrlExpiresAt: 1650567510704, uploadUrl: "https://www.linkedin.com/dms-uploads/C4E10AQ/uploaded-image/0?ca=vector_ads", image: "urn:li:image:C4E10AQFoyyAjHPMQuQ" } } },
    { status: 201 },
    { status: 201, headers: { "x-restli-id": "urn:li:share:6844785523593134080" } },
  );
  const image = await uploadImage(transport, "tok", "urn:li:person:782bbtaQ", bytes);
  assert.equal(image, "urn:li:image:C4E10AQFoyyAjHPMQuQ");
  assert.deepEqual(requests[0], { method: "POST", url: "https://api.linkedin.com/rest/images?action=initializeUpload", token: "tok", rest: true, json: { initializeUploadRequest: { owner: "urn:li:person:782bbtaQ" } } });
  assert.equal(requests[1].method, "PUT");
  assert.equal(requests[1].url, "https://www.linkedin.com/dms-uploads/C4E10AQ/uploaded-image/0?ca=vector_ads");
  assert.deepEqual(requests[1].bytes, { data: bytes, type: "image/jpeg" });
  const id = await createPost(transport, "tok", { author: "urn:li:organization:2414183", commentary: "Nytt jobb (solceller) #elfirma", image: { id: image, altText: "Rubrik" } });
  assert.equal(id, "urn:li:share:6844785523593134080");
  assert.deepEqual(requests[2], { method: "POST", url: "https://api.linkedin.com/rest/posts", token: "tok", rest: true, json: {
    author: "urn:li:organization:2414183", commentary: "Nytt jobb \\(solceller\\) {hashtag|\\#|elfirma}", visibility: "PUBLIC",
    distribution: { feedDistribution: "MAIN_FEED", targetEntities: [], thirdPartyDistributionChannels: [] },
    lifecycleState: "PUBLISHED", isReshareDisabledByAuthor: false, content: { media: { id: "urn:li:image:C4E10AQFoyyAjHPMQuQ", altText: "Rubrik" } },
  } });
});

test("an upload address that is not LinkedIn's own gets neither the picture nor the token", async () => {
  for (const uploadUrl of ["https://evil.example/upload", "http://www.linkedin.com/x", "https://www.linkedin.com.evil.example/x", "https://user@www.linkedin.com/x"]) {
    const { transport, requests } = recorder({ body: { value: { uploadUrl, image: "urn:li:image:1" } } });
    await assert.rejects(uploadImage(transport, "tok", "urn:li:person:1", new Uint8Array([1])), LinkedInError, uploadUrl);
    assert.equal(requests.length, 1, uploadUrl);
  }
  const missing = recorder({ status: 201, headers: {} });
  await assert.rejects(createPost(missing.transport, "tok", { author: "urn:li:person:1", commentary: "x" }), LinkedInError, "a post without an id is an error");
});

test("the hosts: only LinkedIn's own over https", () => {
  assert.ok(linkedInUrl("https://www.linkedin.com/oauth/v2/accessToken", "oauth"));
  assert.ok(linkedInUrl("https://api.linkedin.com/rest/posts", "api"));
  assert.equal(linkedInUrl("https://api.linkedin.com/rest/posts", "oauth"), null);
  assert.ok(linkedInUrl("https://media-exp1.linkedin.com/x", "upload"));
  for (const bad of ["http://api.linkedin.com/x", "https://api.linkedin.com:8443/x", "https://linkedin.com.example/x", "https://a:b@api.linkedin.com/", "nonsense"]) assert.equal(linkedInUrl(bad, "upload"), null, bad);
});

test("the real transport: the versioned headers, the bearer token, no redirects, and nothing outside LinkedIn", async () => {
  const seen: { url: string; init: RequestInit }[] = [];
  const original = globalThis.fetch;
  globalThis.fetch = (async (url: URL | string, init: RequestInit) => {
    seen.push({ url: String(url), init });
    return new Response(JSON.stringify({ ok: true }), { status: 201, headers: { "x-restli-id": "urn:li:share:1", "content-type": "application/json" } });
  }) as typeof fetch;
  try {
    const answer = await fetchTransport({ method: "POST", url: "https://api.linkedin.com/rest/posts", token: "secret-token", rest: true, json: { a: 1 } });
    assert.equal(answer.status, 201);
    assert.equal(answer.headers["x-restli-id"], "urn:li:share:1");
    const headers = seen[0].init.headers as Record<string, string>;
    assert.equal(headers["linkedin-version"], LINKEDIN_VERSION);
    assert.match(LINKEDIN_VERSION, /^20\d{4}$/, "YYYYMM");
    assert.equal(headers["x-restli-protocol-version"], "2.0.0");
    assert.equal(headers.authorization, "Bearer secret-token");
    assert.equal(headers["content-type"], "application/json");
    assert.equal(seen[0].init.redirect, "manual");
    assert.ok(!seen[0].url.includes("secret-token"), "the token never goes in the address");
    await fetchTransport({ method: "POST", url: "https://www.linkedin.com/oauth/v2/accessToken", form: { grant_type: "authorization_code" } });
    assert.equal((seen[1].init.headers as Record<string, string>)["content-type"], "application/x-www-form-urlencoded");
    assert.equal((seen[1].init.headers as Record<string, string>)["linkedin-version"], undefined, "OAuth has no API version");
    await assert.rejects(fetchTransport({ method: "GET", url: "https://evil.example/x", token: "secret-token" }), LinkedInError);
    assert.equal(seen.length, 2, "never sent");
  } finally { globalThis.fetch = original; }
});

test("LinkedIn's errors as short Swedish texts with a kind", () => {
  assert.equal(linkedInErrorOf(401, { serviceErrorCode: 65600, code: "INVALID_ACCESS_TOKEN" }).kind, "token");
  assert.equal(linkedInErrorOf(401, null).status, 409, "never 401, which would sign the person out");
  assert.equal(linkedInErrorOf(403, { status: 403 }).kind, "permission");
  assert.equal(linkedInErrorOf(429, null).kind, "rate");
  assert.match(linkedInErrorOf(400, { error: "invalid_client" }).message, /Client ID/);
  assert.equal(linkedInErrorOf(503, null).status, 502);
});

test("little text: every reserved character escaped, hashtags as LinkedIn's template", () => {
  assert.equal(littleText("Hej (alla) – 50% *nytt* [x] {y} <z> a|b ~ _u_ \\ @namn"), "Hej \\(alla\\) – 50% \\*nytt\\* \\[x\\] \\{y\\} \\<z\\> a\\|b \\~ \\_u\\_ \\\\ \\@namn");
  assert.equal(littleText("#el och #sol_celler, inte a#b"), "{hashtag|\\#|el} och {hashtag|\\#|sol\\_celler}, inte a\\#b");
  assert.equal(littleText("Rad ett\n#ny rad"), "Rad ett\n{hashtag|\\#|ny} rad");
  assert.equal(littleText("Ren text."), "Ren text.");
});

test("the status: expired, may not post, page scopes missing, soon out unless renewed", () => {
  const now = Date.parse("2026-11-11T12:00:00Z");
  const day = 86_400_000;
  const base = { expiresAt: new Date(now + 40 * day), refreshable: false, refreshExpiresAt: null, scopeSet: "personal" as const, scopes: ["openid", "profile", "w_member_social"] };
  assert.equal(statusFromToken(base, now).status, "ok");
  assert.equal(statusFromToken({ ...base, expiresAt: new Date(now - 1) }, now).status, "invalid");
  assert.equal(statusFromToken({ ...base, scopes: ["openid", "profile"] }, now).status, "action");
  assert.match(statusFromToken({ ...base, scopeSet: "organization" }, now).message!, /Community Management API/);
  assert.equal(statusFromToken({ ...base, scopeSet: "organization", scopes: [...base.scopes, "w_organization_social", "r_organization_admin"] }, now).status, "ok");
  assert.equal(statusFromToken({ ...base, expiresAt: new Date(now + 3 * day) }, now).status, "action");
  assert.equal(statusFromToken({ ...base, expiresAt: new Date(now + 3 * day), refreshable: true, refreshExpiresAt: new Date(now + 300 * day) }, now).status, "ok", "renewed by itself");
});

test("the nightly alerts: a week before, when it stops working, and a renewing token only when renewing ends", () => {
  const now = new Date("2026-11-11T06:45:00Z");
  const at = (days: number) => new Date(now.getTime() + days * 86_400_000);
  assert.equal(linkedInAlertState({ status: "ok", accessTokenExpiresAt: at(40) }, now), null);
  assert.equal(linkedInAlertState({ status: "ok", accessTokenExpiresAt: at(6) }, now), "expiring");
  assert.equal(linkedInAlertState({ status: "ok", accessTokenExpiresAt: at(-1) }, now), "invalid");
  assert.equal(linkedInAlertState({ status: "invalid", accessTokenExpiresAt: at(40) }, now), "invalid");
  assert.equal(linkedInAlertState({ status: "ok", accessTokenExpiresAt: at(2), refreshTokenCipher: "c", refreshTokenExpiresAt: at(200) }, now), null);
  assert.equal(linkedInAlertState({ status: "ok", accessTokenExpiresAt: at(30), refreshTokenCipher: "c", refreshTokenExpiresAt: at(5) }, now), "expiring");
  assert.equal(linkedInAlertAction("org1", "expiring", "v3.key.iv.tag.abcdefghijklmnopqrstuvwxyz"), "linkedin_alert:org1:expiring:klmnopqrstuvwxyz");
  const soon = linkedInAlertText("expiring", { status: "ok", accessTokenExpiresAt: at(5), authorName: "Elfirma AB" });
  assert.equal(soon.subject, "LinkedIn: kopplingen går ut snart");
  assert.equal(soon.line, "Kopplingen till LinkedIn (Elfirma AB) går ut 2026-11-16.");
  assert.match(linkedInAlertText("invalid", { status: "invalid", accessTokenExpiresAt: null, authorName: null }).line, /fungerar inte längre/);
});

test("the post's text on LinkedIn: the text and the link, 3000 characters, Instagram's limits only with Instagram", () => {
  const ok = { heading: "Rubrik", body: "Text", caption: "Inlägg", link: "https://example.se/a", toFacebook: false, toInstagram: false, toLinkedIn: true };
  assert.equal(postProblem(ok), null);
  assert.equal(linkedInCommentary(ok), "Inlägg\n\nhttps://example.se/a");
  assert.equal(captionLimit(ok), LINKEDIN_COMMENTARY_MAX);
  assert.equal(captionLimit({ ...ok, toInstagram: true }), 2200);
  assert.equal(postProblem({ ...ok, caption: "x".repeat(2500) }), null, "longer than Instagram's limit is fine without Instagram");
  assert.match(postProblem({ ...ok, caption: "x".repeat(2500), toInstagram: true })!, /2200/);
  assert.match(postProblem({ ...ok, caption: "x".repeat(2990) })!, /3000/, "the link counts on LinkedIn");
  assert.equal(postProblem({ ...ok, caption: Array.from({ length: 31 }, (_, index) => `#tag${index}`).join(" ") }), null, "the hashtag limit is Instagram's");
  assert.match(postProblem({ ...ok, toLinkedIn: false })!, /Välj/);
});

test("the card warns when Även företagssidor is chosen: it needs LinkedIn's approval of the app first (2026-11-14)", async () => {
  const { readFileSync } = await import("node:fs");
  const card = readFileSync("features/linkedin/linkedin-card.tsx", "utf8");
  assert.match(card, /scopeSet === "organization" \? <div className="notice[^"]*" data-testid="linkedin-scope-warning">/, "shown only for the company-page choice, in the shared notice");
  assert.match(card, /Företagssidor fungerar först när LinkedIn har godkänt appen för Community Management API\. Välj Min profil tills dess, annars visar LinkedIn ett fel\./);
});
