import assert from "node:assert/strict";
import test from "node:test";
import { clientIp } from "../lib/security/client-ip";
import { readFileSync } from "node:fs";
import { BodyTooLarge, NOT_A_FORM, readLimited, readLimitedFormData, readLimitedText, readLimitedUpload } from "../lib/security/limited-body";
import { ApiError } from "../lib/kfid/errors";
import { DUMMY_PASSWORD_HASH, verifyPassword } from "../lib/auth/password";

// Security review 2026-10-04.
// Behind nginx (one trusted proxy, the production default); the full set of cases is in tests/client-ip.test.ts.
test("the caller's IP address is the one the proxy appended, not one the caller made up", () => {
  const nginx = { hops: 1, proxies: null };
  assert.equal(clientIp(new Headers({ "x-forwarded-for": "6.6.6.6, 203.0.113.9" }), nginx), "203.0.113.9");
  assert.equal(clientIp(new Headers({ "x-forwarded-for": "203.0.113.9" }), nginx), "203.0.113.9");
  assert.equal(clientIp(new Headers({ "x-real-ip": "198.51.100.4" }), nginx), "198.51.100.4");
  assert.equal(clientIp({ "x-forwarded-for": "6.6.6.6, 198.51.100.7" }, nginx), "198.51.100.7");
  assert.equal(clientIp(new Headers(), nginx), "local");
});

function streamed(bytes: number, chunk = 64 * 1024) {
  let sent = 0;
  // A body without Content-Length, as a chunked upload sends it.
  const body = new ReadableStream<Uint8Array>({ pull(controller) { if (sent >= bytes) { controller.close(); return; } const size = Math.min(chunk, bytes - sent); sent += size; controller.enqueue(new Uint8Array(size)); } });
  return { request: new Request("http://local/x", { method: "POST", body, duplex: "half" } as RequestInit), sent: () => sent };
}

test("a body is read with a ceiling and stops early when it passes it, also without Content-Length", async () => {
  const small = streamed(10_000);
  assert.equal((await readLimited(small.request, 20_000)).byteLength, 10_000);
  const huge = streamed(50_000_000);
  await assert.rejects(readLimited(huge.request, 1_000_000), (error: unknown) => error instanceof BodyTooLarge && error.status === 413);
  assert.ok(huge.sent() < 2_000_000, `stopped reading early, read ${huge.sent()} bytes`);
  await assert.rejects(readLimited(new Request("http://local/x", { method: "POST", body: "x".repeat(100), headers: { "content-length": "999999999" } }), 1000), BodyTooLarge);
  assert.equal(await readLimitedText(new Request("http://local/x", { method: "POST", body: "hej då" }), 100), "hej då");
});

test("a form is read within its ceiling and parsed as usual", async () => {
  const form = new FormData();
  form.set("name", "Pump P1");
  form.set("file", new Blob([new Uint8Array(5000)]), "bild.png");
  // The bytes of a multipart upload, as they arrive from the network.
  const encoded = new Response(form);
  const type = encoded.headers.get("content-type")!;
  const bytes = new Uint8Array(await encoded.arrayBuffer());
  const upload = () => new Request("http://local/x", { method: "POST", body: bytes, headers: { "content-type": type } });
  const parsed = await readLimitedFormData(upload(), 100_000);
  assert.equal(parsed.get("name"), "Pump P1");
  assert.equal((parsed.get("file") as File).size, 5000);
  await assert.rejects(readLimitedFormData(upload(), 1000), BodyTooLarge);
});

test("a route that takes a form answers 400 in Swedish to JSON, no content type or a broken form (S5)", async () => {
  const notAForm = (error: unknown) => error instanceof ApiError && error.status === 400 && error.message === NOT_A_FORM;
  const post = (body: string, type?: string) => new Request("http://local/x", { method: "POST", body, headers: type ? { "content-type": type } : {} });
  await assert.rejects(readLimitedFormData(post('{"a":1}', "application/json"), 1000), notAForm);
  await assert.rejects(readLimitedFormData(post("x"), 1000), notAForm);
  await assert.rejects(readLimitedFormData(post("not a multipart body", "multipart/form-data; boundary=abc"), 1000), notAForm);
  assert.equal((await readLimitedFormData(post("a=1&b=tv%C3%A5", "application/x-www-form-urlencoded"), 1000)).get("b"), "två");
});

// Säkerhetsgranskning 2026-11-20, L2: the pictures of Inlägg and Min webbsida are read with a ceiling too, in their own words.
test("an upload over its ceiling, also without Content-Length, answers 413 with the route's Swedish text", async () => {
  const words = { tooLarge: "Bilden är för stor (högst 10 MB).", notAForm: "Ingen bild skickades." };
  const huge = streamed(50_000_000);
  const chunked = new Request("http://local/x", { method: "POST", body: huge.request.body, duplex: "half", headers: { "content-type": "multipart/form-data; boundary=abc" } } as RequestInit);
  await assert.rejects(readLimitedUpload(chunked, 1_000_000, words), (error: unknown) => error instanceof ApiError && error.status === 413 && error.message === words.tooLarge);
  assert.ok(huge.sent() < 2_000_000, `stopped reading early, read ${huge.sent()} bytes`);
  const json = new Request("http://local/x", { method: "POST", body: "{}", headers: { "content-type": "application/json" } });
  await assert.rejects(readLimitedUpload(json, 1000, words), (error: unknown) => error instanceof ApiError && error.status === 400 && error.message === words.notAForm);
  const form = new FormData();
  form.set("file", new Blob([new Uint8Array(500)]), "bild.png");
  const encoded = new Response(form);
  const ok = new Request("http://local/x", { method: "POST", body: new Uint8Array(await encoded.arrayBuffer()), headers: { "content-type": encoded.headers.get("content-type")! } });
  assert.equal(((await readLimitedUpload(ok, 10_000, words)).get("file") as File).size, 500);
});

test("the picture uploads of Inlägg and Min webbsida never read the whole body without a ceiling", () => {
  for (const file of ["lib/api-handlers/meta-posts.ts", "lib/api-handlers/website-media.ts"]) {
    const source = readFileSync(file, "utf8");
    assert.ok(!/request\.formData\(\)/.test(source), `${file} reads the form with a ceiling`);
    assert.ok(/readLimitedUpload\(request, MAX_MEDIA_BYTES/.test(source), `${file} uses the shared limited reader`);
  }
});

test("a sign-in for a missing account does the same bcrypt work", async () => {
  assert.equal(await verifyPassword("gissning", DUMMY_PASSWORD_HASH), false);
});
