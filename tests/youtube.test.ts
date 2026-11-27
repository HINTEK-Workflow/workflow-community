import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import {
  authorizationUrl, codeChallenge, fetchTransport, tokenProblem, googleUrl, keptPrivate, localBase, receivedFromRange, uploadSessionUrl, videoResource, YOUTUBE_SCOPE, YouTubeError, youTubeErrorOf,
  type YouTubeTransport,
} from "../lib/youtube/api";
import {
  filterVideos, imageKindOf, parseTags, publishProblem, sizeText, tagsLength, textsProblem, videoKindOf, VIDEO_CHUNK_BYTES, YOUTUBE_CHUNK_BYTES,
} from "../lib/youtube/model";
import { MAX_UPLOAD_ATTEMPTS, nextPiece, nextUploadAttempt, PIECE_RETRIES, pieceRetryable, pieceRetryDelay, runUpload, uploadPercent, type UploadDeps } from "../lib/youtube/upload";
import { SCHEDULE_KINDS, scheduleSubject } from "../lib/schedule/labels";
import { settle } from "../lib/schedule/model";
import { webAreaStatus } from "../lib/integrations/connection-areas";
import { startFakeYouTube } from "./fake-youtube";

// Filmer och YouTube (2026-11-20): the pure rules, the resumable upload against the stand-in, the storage and the guards in the code.
const root = path.join(__dirname, "..");
const read = (file: string) => readFileSync(path.join(root, file), "utf8");
const bytesOf = (...values: number[]) => new Uint8Array(values);
const ascii = (text: string) => Array.from(text, (char) => char.charCodeAt(0));

test("a film file is known by its first bytes: MP4, MOV, WebM; anything else is refused", () => {
  const head = (box: string, brand: string) => bytesOf(0, 0, 0, 0x18, ...ascii(box), ...ascii(brand), 0, 0, 0, 0);
  assert.equal(videoKindOf(head("ftyp", "isom")), "mp4");
  assert.equal(videoKindOf(head("ftyp", "mp42")), "mp4");
  assert.equal(videoKindOf(head("ftyp", "qt  ")), "mov");
  assert.equal(videoKindOf(head("moov", "xxxx")), "mov");
  assert.equal(videoKindOf(bytesOf(0x1a, 0x45, 0xdf, 0xa3, 0x9f, 0x42, 0x86, 0x81, 0x01, 0x42, 0x82, 0x84, ...ascii("webm"))), "webm");
  assert.equal(videoKindOf(bytesOf(0x1a, 0x45, 0xdf, 0xa3, 0x9f, 0x42, 0x86, 0x81, 0x01, 0x42, 0x82, 0x88, ...ascii("matroska"))), null, "a Matroska file that is no WebM");
  assert.equal(videoKindOf(bytesOf(...ascii("%PDF-1.7 hello"))), null);
  assert.equal(videoKindOf(bytesOf(1, 2, 3)), null, "too short");
  assert.equal(imageKindOf(bytesOf(0xff, 0xd8, 0xff, 0xe0)), "image/jpeg");
  assert.equal(imageKindOf(bytesOf(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a)), "image/png");
  assert.equal(imageKindOf(bytesOf(...ascii("GIF89a"))), null);
});

test("the texts follow YouTube's limits; tags are counted as YouTube counts them", () => {
  assert.deepEqual(parseTags("laddbox, #elbil,  el bil ,Laddbox,\n solceller"), ["laddbox", "elbil", "el bil", "solceller"]);
  assert.equal(tagsLength(["ab", "c d"]), 2 + 3 + 2 + 1, "a tag with a space counts its quotes, and a comma between");
  assert.equal(textsProblem({ title: "", description: "", tags: [] }), "Skriv en titel.");
  assert.match(textsProblem({ title: "x".repeat(101), description: "", tags: [] }) ?? "", /högst 100/);
  assert.match(textsProblem({ title: "a <b>", description: "", tags: [] }) ?? "", /< eller >/);
  assert.match(textsProblem({ title: "ok", description: "å".repeat(2600), tags: [] }) ?? "", /för lång/, "5000 bytes, and å is two");
  assert.equal(textsProblem({ title: "ok", description: "å".repeat(2400), tags: [] }), null);
  assert.match(textsProblem({ title: "ok", description: "", tags: Array.from({ length: 50 }, (_, index) => `tagg nummer ${index}`) }) ?? "", /500 tecken/);
  const ready = { title: "Film", description: "", tags: [], fileReady: true, madeForKids: false as boolean | null, privacy: "unlisted", categoryId: null };
  assert.equal(publishProblem(ready), null);
  assert.equal(publishProblem({ ...ready, fileReady: false }), "Ladda upp filmfilen först.");
  assert.match(publishProblem({ ...ready, madeForKids: null }) ?? "", /YouTube kräver svaret/);
  assert.match(publishProblem({ ...ready, privacy: "everyone" }) ?? "", /vem som får se/);
  assert.equal(sizeText(2 * 1024 ** 3), "2,0 GB");
  assert.equal(sizeText(350 * 1024 ** 2), "350 MB");
});

test("the list's filter and search: the status, and every word in the title, the description or the tags", () => {
  const videos = [
    { id: "a", listStatus: "draft" as const, title: "Laddbox hemma", description: "", tags: ["elbil"] },
    { id: "b", listStatus: "published" as const, title: "Servicebilen", description: "Vår nya bil", tags: [] },
    { id: "c", listStatus: "scheduled" as const, title: "Solceller", description: "", tags: ["tak"] },
  ];
  assert.deepEqual(filterVideos(videos, "all", "").map((video) => video.id), ["a", "b", "c"]);
  assert.deepEqual(filterVideos(videos, "published", "").map((video) => video.id), ["b"]);
  assert.deepEqual(filterVideos(videos, "all", "ELBIL laddbox").map((video) => video.id), ["a"]);
  assert.deepEqual(filterVideos(videos, "all", "bil").map((video) => video.id), ["a", "b"]);
  assert.deepEqual(filterVideos(videos, "scheduled", "bil").map((video) => video.id), []);
});

test("the addresses: Google's own hosts over https, or a loopback stand-in; nothing else gets a token", () => {
  assert.equal(localBase({ YOUTUBE_API_BASE_URL: "http://127.0.0.1:3197/x" }), "http://127.0.0.1:3197");
  assert.equal(localBase({ YOUTUBE_API_BASE_URL: "http://localhost:3099" }), "http://localhost:3099");
  for (const other of ["https://evil.example", "http://10.0.0.5:3197", "http://user:pw@127.0.0.1:1", "ftp://127.0.0.1", ""]) assert.equal(localBase({ YOUTUBE_API_BASE_URL: other }), null, other);
  const google = {};
  assert.ok(googleUrl("https://www.googleapis.com/youtube/v3/videos", google));
  assert.ok(googleUrl("https://oauth2.googleapis.com/token", google));
  assert.equal(googleUrl("http://www.googleapis.com/youtube/v3/videos", google), null, "never plain http");
  assert.equal(googleUrl("https://www.googleapis.com.evil.example/x", google), null);
  assert.equal(googleUrl("https://www.googleapis.com:8443/x", google), null);
  assert.ok(uploadSessionUrl("https://www.googleapis.com/upload/youtube/v3/videos?uploadType=resumable&upload_id=abc", google));
  assert.equal(uploadSessionUrl("https://www.googleapis.com/youtube/v3/videos", google), null, "a session address is an upload address");
  assert.equal(uploadSessionUrl("https://oauth2.googleapis.com/upload/youtube/v3/videos", google), null);
  assert.equal(uploadSessionUrl("https://evil.example/upload/youtube/v3/videos", google), null);
  assert.ok(uploadSessionUrl("http://127.0.0.1:3197/upload/youtube/v3/videos?upload_id=x", { YOUTUBE_API_BASE_URL: "http://127.0.0.1:3197" }));
});

test("the sign-in address: one scope, offline access, consent, PKCE S256 and the state", () => {
  const url = new URL(authorizationUrl({ clientId: "1-a.apps.googleusercontent.com", redirectUri: "https://app.example/api/youtube/callback", state: "s", codeChallenge: "c" }, {}));
  assert.equal(url.origin + url.pathname, "https://accounts.google.com/o/oauth2/v2/auth");
  assert.equal(url.searchParams.get("scope"), YOUTUBE_SCOPE);
  assert.equal(YOUTUBE_SCOPE, "https://www.googleapis.com/auth/youtube");
  assert.equal(url.searchParams.get("access_type"), "offline");
  assert.match(url.searchParams.get("prompt") ?? "", /consent/);
  assert.equal(url.searchParams.get("code_challenge_method"), "S256");
  assert.equal(url.searchParams.get("code_challenge"), "c");
  assert.equal(url.searchParams.get("state"), "s");
  assert.equal(url.searchParams.get("response_type"), "code");
  // RFC 7636, appendix B.
  assert.equal(codeChallenge("dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk"), "E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM");
  assert.equal(tokenProblem({ scopes: [YOUTUBE_SCOPE], refreshable: true }), null);
  assert.match(tokenProblem({ scopes: ["https://www.googleapis.com/auth/youtube.readonly"], refreshable: true }) ?? "", /rätten att hantera/);
  assert.match(tokenProblem({ scopes: [YOUTUBE_SCOPE], refreshable: false }) ?? "", /förnyelse/);
});

test("Google's errors become short Swedish texts with a kind; only some may pass by themselves", () => {
  const api = (status: number, reason: string) => youTubeErrorOf(status, { error: { code: status, errors: [{ reason }] } });
  assert.equal(youTubeErrorOf(400, { error: "invalid_grant" }, "oauth").kind, "token");
  assert.equal(youTubeErrorOf(401, { error: "invalid_client" }, "oauth").kind, "invalid");
  assert.equal(api(401, "authError").kind, "token");
  assert.equal(api(403, "quotaExceeded").kind, "quota");
  assert.match(api(403, "quotaExceeded").message, /kvot/);
  assert.equal(api(403, "rateLimitExceeded").kind, "rate");
  assert.equal(api(403, "forbidden").kind, "permission");
  assert.equal(youTubeErrorOf(404, {}, "upload").kind, "session", "an upload session YouTube forgot");
  assert.equal(api(404, "videoNotFound").kind, "notFound");
  assert.equal(api(400, "invalidTitle").kind, "invalid");
  assert.equal(youTubeErrorOf(503, {}).status, 502);
  assert.equal(receivedFromRange("bytes=0-524287"), 524288);
  assert.equal(receivedFromRange(undefined), 0);
  assert.equal(receivedFromRange("bytes=5-9"), 0, "only a range from the start counts");
  assert.equal(keptPrivate("public", "private"), true, "Google's audit not passed");
  assert.equal(keptPrivate("private", "private"), false);
  assert.equal(keptPrivate("unlisted", "unlisted"), false);
  assert.equal(videoResource({ title: " Film ", description: "", tags: [], categoryId: null, privacy: "unlisted", madeForKids: false }).snippet.categoryId, "22");
});

test("the pieces and the attempts: 2 MiB, a multiple of 256 KiB; 1, 5, 15, 45 and 120 minutes; the quota waits an hour", () => {
  assert.equal(YOUTUBE_CHUNK_BYTES % (256 * 1024), 0);
  assert.equal(YOUTUBE_CHUNK_BYTES, 2 * 1024 * 1024);
  assert.equal(VIDEO_CHUNK_BYTES, 2 * 1024 * 1024);
  assert.deepEqual([1, 2, 3, 4, 5].map(pieceRetryDelay), [1000, 2000, 4000, 8000, 15_000]);
  assert.equal(pieceRetryable(new YouTubeError("n", "network", 504)), true, "no answer");
  assert.equal(pieceRetryable(new YouTubeError("s", "other", 502)), true, "Google's server error");
  assert.equal(pieceRetryable(new YouTubeError("r", "rate", 429)), false, "a rate waits for the job");
  assert.equal(pieceRetryable(new YouTubeError("q", "quota", 429)), false);
  assert.equal(pieceRetryable(new YouTubeError("i", "invalid", 400)), false);
  assert.equal(pieceRetryable(new Error("x")), false);
  assert.deepEqual(nextPiece(0, 10), { start: 0, length: 10 });
  assert.deepEqual(nextPiece(YOUTUBE_CHUNK_BYTES, YOUTUBE_CHUNK_BYTES + 5), { start: YOUTUBE_CHUNK_BYTES, length: 5 });
  assert.equal(nextPiece(10, 10), null);
  const now = new Date("2026-11-20T12:00:00Z");
  const network = new YouTubeError("x", "network", 504);
  const minutes = (attempts: number, error: unknown) => { const at = nextUploadAttempt(attempts, error, now); return at ? (at.getTime() - now.getTime()) / 60_000 : null; };
  assert.deepEqual([1, 2, 3, 4, 5].map((attempts) => minutes(attempts, network)), [1, 5, 15, 45, 120]);
  assert.equal(minutes(MAX_UPLOAD_ATTEMPTS, network), null, "the last attempt");
  assert.equal(minutes(1, new YouTubeError("q", "quota", 429)), 60);
  assert.equal(minutes(1, new YouTubeError("t", "invalid", 400)), null, "a refusal is not tried again");
  assert.equal(minutes(1, new YouTubeError("t", "token", 409)), null);
  assert.equal(minutes(1, new YouTubeError("s", "other", 502)), 1, "Google's server error");
  assert.equal(uploadPercent(5, 10), 50);
  assert.equal(uploadPercent(0, 0), 0);
});

/** An access token from the stand-in, as Koppla YouTube would get one. */
async function signedIn(fake: Awaited<ReturnType<typeof startFakeYouTube>>) {
  const { createHash } = await import("node:crypto");
  const verifier = "v".repeat(50);
  const auth = new URL(`${fake.url}/o/oauth2/v2/auth`);
  auth.search = new URLSearchParams({ client_id: fake.clientId, redirect_uri: "http://127.0.0.1:1/cb", state: "s", code_challenge: createHash("sha256").update(verifier).digest("base64url"), code_challenge_method: "S256" }).toString();
  const back = new URL((await fetch(auth, { redirect: "manual" })).headers.get("location")!);
  const answer = await fetch(`${fake.url}/token`, { method: "POST", body: new URLSearchParams({ grant_type: "authorization_code", code: back.searchParams.get("code")!, client_id: fake.clientId, client_secret: fake.clientSecret, redirect_uri: "http://127.0.0.1:1/cb", code_verifier: verifier }) });
  return (await answer.json() as { access_token: string }).access_token;
}

test("the resumable upload against the stand-in: pieces, a server error, a resumed run, a forgotten session and a pause", async (t) => {
  const fake = await startFakeYouTube();
  const previous = process.env.YOUTUBE_API_BASE_URL;
  process.env.YOUTUBE_API_BASE_URL = fake.url;
  t.after(async () => { if (previous === undefined) delete process.env.YOUTUBE_API_BASE_URL; else process.env.YOUTUBE_API_BASE_URL = previous; await fake.stop(); });
  const token = await signedIn(fake);
  const total = YOUTUBE_CHUNK_BYTES * 2 + 1234;
  const file = new Uint8Array(total).map((_, index) => index % 251);
  let saved: { session: string | null; offset: number } = { session: null, offset: 0 };
  let stopAfter = Infinity;
  let pieces = 0;
  const transport: YouTubeTransport = (request) => fetchTransport(request);
  let waits: number[] = [];
  const deps = (): UploadDeps => ({
    transport, token: async () => token,
    read: async (start, length) => { pieces += 1; return file.subarray(start, start + length); },
    save: async (progress) => { saved = progress; },
    stop: () => pieces >= stopAfter,
    wait: async (ms) => { waits.push(ms); },
  });
  const meta = { title: "Laddbox", description: "", tags: ["el"], categoryId: "27", privacy: "unlisted", madeForKids: false };
  /** A transport that makes the next `count` pieces after the first answer 503. */
  const failingAfterFirst = (count: number): YouTubeTransport => {
    let armed = true;
    return async (request) => {
      if (request.method === "PUT" && request.bytes && saved.offset > 0 && armed) { armed = false; fake.failPieces(count); }
      return fetchTransport(request);
    };
  };

  // A server error on the second piece (2026-11-25): the run waits a second, asks YouTube how far it came and goes on in the same run.
  fake.failPieces(0);
  const survived = await runUpload({ ...deps(), transport: failingAfterFirst(1) }, { session: null, offset: 0, total, type: "video/mp4", meta });
  assert.equal(survived.kind, "done");
  assert.deepEqual(waits, [1000], "one short wait");
  assert.equal(fake.videos.length, 1);
  assert.equal(fake.videos[0].bytes, total);
  assert.equal(fake.videos[0].privacy, "unlisted");
  assert.ok(fake.ranges.includes(`bytes */${total}`), "the status question before the piece is sent again");
  assert.equal(fake.ranges.filter((range) => range === `bytes ${YOUTUBE_CHUNK_BYTES}-${2 * YOUTUBE_CHUNK_BYTES - 1}/${total}`).length, 2, "the failed piece is sent once more");
  assert.ok(fake.ranges.includes(`bytes ${2 * YOUTUBE_CHUNK_BYTES}-${total - 1}/${total}`), "the last piece may be any size");

  // More server errors in a row than the run waits out: it throws a retryable error and keeps the session and the offset.
  saved = { session: null, offset: 0 }; waits = [];
  await assert.rejects(runUpload({ ...deps(), transport: failingAfterFirst(PIECE_RETRIES + 1) }, { session: null, offset: 0, total, type: "video/mp4", meta }), (error) => error instanceof YouTubeError && error.status === 502);
  assert.deepEqual(waits, [1000, 2000, 4000, 8000, 15_000], "five waits, then the job takes over");
  assert.ok(saved.session, "the session is kept");
  assert.equal(saved.offset, YOUTUBE_CHUNK_BYTES, "YouTube had the first piece");

  // The next run asks YouTube how far it came and goes on from there.
  fake.ranges.length = 0;
  const done = await runUpload(deps(), { session: saved.session, offset: 0, total, type: "video/mp4", meta });
  assert.equal(done.kind, "done");
  assert.equal(fake.videos.length, 2);
  assert.equal(fake.videos[1].bytes, total);
  assert.equal(fake.ranges[0], `bytes */${total}`, "the status question first");
  assert.equal(fake.ranges.some((range) => range.startsWith("bytes 0-")), false, "the first piece is not sent again");

  // A session YouTube forgot starts again from the beginning.
  saved = { session: null, offset: 0 };
  pieces = 0; stopAfter = 1;
  const paused = await runUpload(deps(), { session: null, offset: 0, total, type: "video/mp4", meta });
  assert.deepEqual(paused, { kind: "paused", offset: YOUTUBE_CHUNK_BYTES }, "the run stops when told and says where it is");
  fake.forgetSessions();
  stopAfter = Infinity;
  const again = await runUpload(deps(), { session: saved.session, offset: saved.offset, total, type: "video/mp4", meta });
  assert.equal(again.kind, "done");
  assert.equal(fake.videos.length, 3);
  assert.equal(fake.videos[2].bytes, total);

  // A lost connection after YouTube got the piece, and then a status question that fails once: the run asks again and goes on
  // from the byte YouTube confirms, without sending that piece twice.
  saved = { session: null, offset: 0 }; waits = []; fake.ranges.length = 0;
  let cut = 0;
  const flaky: YouTubeTransport = async (request) => {
    const range = request.headers?.["content-range"] ?? "";
    if (cut === 0 && request.bytes && range.startsWith(`bytes ${YOUTUBE_CHUNK_BYTES}-`)) { cut += 1; await fetchTransport(request); throw new YouTubeError("Ingen kontakt med YouTube.", "network", 504); }
    if (cut === 1 && range === `bytes */${total}`) { cut += 1; throw new YouTubeError("Ingen kontakt med YouTube.", "network", 504); }
    return fetchTransport(request);
  };
  const resumed = await runUpload({ ...deps(), transport: flaky }, { session: null, offset: 0, total, type: "video/mp4", meta });
  assert.equal(resumed.kind, "done");
  assert.equal(fake.videos.at(-1)!.bytes, total);
  assert.deepEqual(waits, [1000, 2000], "a wait for the piece and one for the status question");
  assert.equal(fake.ranges.filter((range) => range.startsWith(`bytes ${YOUTUBE_CHUNK_BYTES}-`)).length, 1, "the piece YouTube had is not sent again");

  // Google's audit: the stand-in keeps it private, which the upload's answer says.
  fake.lockPrivate(true);
  saved = { session: null, offset: 0 };
  const locked = await runUpload(deps(), { session: null, offset: 0, total: 1000, type: "video/mp4", meta: { ...meta, privacy: "public" } });
  assert.equal(locked.kind === "done" && keptPrivate("public", locked.video.privacy), true);
  assert.equal(fake.requests.some((request) => /googleapis|google\.com/.test(request.path)), false);
});

test("Schemalägg knows films; the Kopplingar line knows YouTube", () => {
  assert.ok((SCHEDULE_KINDS as readonly string[]).includes("video"));
  assert.deepEqual(["post", "video", "website"].map(scheduleSubject), ["Inlägget", "Filmen", "Sidan"]);
  assert.equal(settle({ kind: "published", message: "Uppladdningen till YouTube har börjat." }, 1).status, "published");
  const wp = { configured: false, passwordUnreadable: false, passwordStored: false };
  assert.deepEqual(webAreaStatus(wp, null, null, { status: "ok", channel: "Kanalen" }), { state: "on", detail: "YouTube" });
  assert.deepEqual(webAreaStatus(wp, null, null, { status: "choose", channel: null }), { state: "action", detail: "YouTube: välj kanal" });
  assert.equal(webAreaStatus(wp, null, null, { status: "invalid", channel: "Kanalen" }).detail, "YouTube: koppla igen");
});

test("the guards in the code: session, role, Cloud, Origin, write access, module, rate, fresh sign-in; no token to the page", () => {
  const connection = read("lib/api-handlers/youtube.ts");
  for (const part of ["requireAdmin(ctx)", "requireCloudStorage(ctx)", "checkOrigin(request)", "await requireCloudWriteAccess(ctx)", 'requireModule(ctx, "web_posts")', "await youTubeRate(ctx", "await requireFreshAuth(ctx.user.id, ctx.auth)"])
    assert.ok(connection.includes(part), `the connection: ${part}`);
  const videos = read("lib/api-handlers/youtube-videos.ts");
  for (const part of ["checkOrigin(request)", "youTubeAdmin()", "await requireCloudWriteAccess(ctx)", 'requireModule(ctx, "web_posts")', 'youTubeRate(ctx, "upload")', "readLimited(request, VIDEO_CHUNK_BYTES)", "readLimitedUpload(request, THUMBNAIL_MAX_BYTES + 200_000", "confirm: z.literal(true)"])
    assert.ok(videos.includes(part), `the films: ${part}`);
  const callback = read("lib/api-handlers/youtube-callback.ts");
  assert.match(callback, /Referrer-Policy", "no-referrer"/);
  // The view the page gets has no sealed value and no session address.
  const server = read("lib/youtube/server.ts");
  const view = server.slice(server.indexOf("export type YouTubeView"), server.indexOf("const choicesOf"));
  assert.equal(/Cipher|\baccessToken:|\brefreshToken:|\bclientSecret:|session/i.test(view), false, view);
  const model = read("lib/youtube/model.ts");
  const videoView = model.slice(model.indexOf("export type VideoView"), model.indexOf("/** The filters"));
  assert.equal(/session|Cipher|token/i.test(videoView), false);
  // The upload runs on the server only: the page sends to our own route and never to Google.
  const page = read("features/youtube/videos-page.tsx");
  assert.equal(/googleapis|accounts\.google|<iframe|youtube\.com\/embed/.test(page), false);
  assert.match(page, /target="_blank" rel="noopener noreferrer"/);
  // The job respects the module and the lock.
  const job = read("lib/youtube/videos-server.ts");
  assert.match(job, /organization: moduleOnWhere\("web_posts"\)/);
  assert.match(job, /uploadLockedUntil: \{ lt: now \}/);
  assert.match(read("scripts/schedule/run-scheduled.ts"), /runYouTubeUploads\(/);
  // The migration only adds (the Community export checks that its comments name no person).
  const sql = read("prisma/migrations/20261122090000_youtube/migration.sql");
  assert.equal(/\b(DROP|DELETE|TRUNCATE|RENAME)\b/i.test(sql.replace(/^--.*$/gm, "").replace(/ON DELETE CASCADE/g, "")), false);
});
