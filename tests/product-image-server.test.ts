import assert from "node:assert/strict";
import test from "node:test";
import sharp from "sharp";
import { convertTiff } from "../lib/catalogue/product-image-tiff";
import { fetchProductPicture, ProductImageCache, productImageAnswer, signedProductImage, validProductImageSignature } from "../lib/catalogue/product-image";
import type { ExternalImage } from "../lib/security/external-image";

// Produktbilder genom servern (2026-11-02): which address the route accepts, what it answers and how much it keeps. Nothing goes out on
// the network: the cache's fetcher is invented. The rights are in tests/product-image.integration.ts.
const PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==", "base64");
const OK = "https://images.example.invalid/a.png";
const picture = (size = PNG.length): ExternalImage => ({ ok: true, bytes: Buffer.alloc(size, PNG), type: "image/png" });
const unknown = async () => false;
const ask = (query: Record<string, string>) => new Request(`http://localhost/api/product-image?${new URLSearchParams(query)}`);
const signature = (url: string) => signedProductImage({ imageUrl: url }).imageSig ?? "";

test("a signature covers exactly its address", () => {
  const sig = signature(OK);
  assert.ok(sig);
  assert.equal(validProductImageSignature(OK, sig), true);
  assert.equal(validProductImageSignature(`${OK}?x=1`, sig), false);
  assert.equal(validProductImageSignature(OK, `${sig}x`), false);
  assert.equal(validProductImageSignature(OK, ""), false);
  assert.equal(validProductImageSignature("", sig), false);
  assert.equal(signedProductImage({ imageUrl: "" }).imageSig, undefined, "no picture, no signature");
});

test("an address the system did not get is refused without any fetch; a known one or a signed one is fetched", async () => {
  const asked: string[] = [];
  const cache = new ProductImageCache(async (address) => { asked.push(address); return picture(); });
  const organization = "org-a";
  // Unsigned, forged, or another address's signature.
  for (const query of [{ u: OK, w: "160" }, { u: OK, w: "160", s: "fel" }, { u: OK, w: "160", s: signature("https://images.example.invalid/annan.png") }] as Record<string, string>[])
    assert.equal((await productImageAnswer(ask(query), organization, { cache, known: unknown })).status, 403, JSON.stringify(query));
  // Not an address at all, whatever is signed, or a width the page never asks for.
  for (const query of [{ u: "http://images.example.invalid/a.png", w: "160" }, { u: "https://127.0.0.1/a.png", w: "160", s: signature("https://127.0.0.1/a.png") }, { u: "https://u:p@images.example.invalid/a.png", w: "160" }, { u: OK, w: "161", s: signature(OK) }, { u: OK, s: signature(OK) }, { w: "160" }, { u: `https://images.example.invalid/${"a".repeat(500)}`, w: "160" }])
    assert.equal((await productImageAnswer(ask(query as Record<string, string>), organization, { cache, known: unknown })).status, 400, JSON.stringify(query));
  assert.deepEqual(asked, [], "nothing fetched for any of them");

  const signed = await productImageAnswer(ask({ u: OK, w: "160", s: signature(OK) }), organization, { cache, known: unknown });
  assert.equal(signed.status, 200);
  assert.equal(signed.headers.get("content-type"), "image/png");
  assert.equal(signed.headers.get("cache-control"), "private, max-age=86400");
  assert.equal(signed.headers.get("x-content-type-options"), "nosniff");
  assert.match(signed.headers.get("content-security-policy") ?? "", /default-src 'none'; sandbox/);
  assert.equal(signed.headers.get("set-cookie"), null);
  assert.deepEqual(Buffer.from(await signed.arrayBuffer()), PNG);
  let knownFor = "";
  const known = await productImageAnswer(ask({ u: OK, w: "160" }), organization, { cache, known: async (company) => { knownFor = company; return true; } });
  assert.equal(known.status, 200, "a row from before the signatures, whose link the API gave");
  assert.equal(knownFor, organization);
});

test("the larger picture and the thumbnail ask the picture service for their own width; other addresses are the same fetch", async () => {
  const asked: string[] = [];
  const cache = new ProductImageCache(async (address) => { asked.push(address); return picture(); });
  const cloud = "https://res.cloudinary.com/solar-as/image/upload/v1699592473/Item/3615635.tiff";
  for (const w of ["160", "1000", "160"]) assert.equal((await productImageAnswer(ask({ u: cloud, w, s: signature(cloud) }), "o", { cache, known: unknown })).status, 200);
  for (const w of ["160", "1000"]) assert.equal((await productImageAnswer(ask({ u: OK, w, s: signature(OK) }), "o", { cache, known: unknown })).status, 200);
  assert.deepEqual(asked, ["https://res.cloudinary.com/solar-as/image/upload/f_auto,q_auto,w_160,c_limit/v1699592473/Item/3615635.tiff", "https://res.cloudinary.com/solar-as/image/upload/f_auto,q_auto,w_1000,c_limit/v1699592473/Item/3615635.tiff", OK]);
});

test("a failed picture answers without a body, and says nothing of why", async () => {
  for (const [image, status] of [[{ ok: false, reason: "type", lasting: true }, 404], [{ ok: false, reason: "address", lasting: true }, 404], [{ ok: false, reason: "unreachable", lasting: false }, 502]] as [ExternalImage, number][]) {
    const answer = await productImageAnswer(ask({ u: OK, w: "160", s: signature(OK) }), "o", { cache: new ProductImageCache(async () => image), known: unknown });
    assert.equal(answer.status, status);
    assert.equal(await answer.text(), "");
    assert.equal(answer.headers.get("cache-control"), "private, no-store");
  }
});

test("the cache: fetched once, kept a limited time, forgets the oldest, never over its limits", async () => {
  let now = 1000;
  let fetches = 0;
  const cache = new ProductImageCache(async () => { fetches += 1; return picture(100); }, { maxBytes: 250, maxEntryBytes: 150, maxEntries: 100, ttlMs: 1000, refusedTtlMs: 100 }, () => now);
  await Promise.all([cache.get("a"), cache.get("a"), cache.get("a")]);
  assert.equal(fetches, 1, "the same picture asked for at once is one fetch");
  await cache.get("a");
  assert.equal(fetches, 1, "from the cache");
  now += 1001;
  await cache.get("a");
  assert.equal(fetches, 2, "fetched anew when it is old");
  await cache.get("b");
  await cache.get("a"); // a is now the most recently used
  await cache.get("c");
  assert.deepEqual(cache.usage, { bytes: 200, entries: 2 });
  const before = fetches;
  await cache.get("a");
  assert.equal(fetches, before, "a was used most recently and stays");
  await cache.get("b");
  assert.equal(fetches, before + 1, "b was the oldest and went");

  const big = new ProductImageCache(async () => { fetches += 1; return picture(151); }, { maxBytes: 250, maxEntryBytes: 150 }, () => now);
  const count = fetches;
  assert.equal((await big.get("x")).ok, true, "a large picture is shown");
  await big.get("x");
  assert.equal(fetches, count + 2, "but not kept");
  assert.deepEqual(big.usage, { bytes: 0, entries: 0 });

  const few = new ProductImageCache(async () => picture(1), { maxEntries: 2 }, () => now);
  for (const key of ["1", "2", "3", "4"]) await few.get(key);
  assert.equal(few.usage.entries, 2);
});

test("the cache: what is refused is not asked again at once, what may work in a moment is", async () => {
  let now = 0;
  let fetches = 0;
  const refused = new ProductImageCache(async () => { fetches += 1; return { ok: false, reason: "type", lasting: true }; }, { refusedTtlMs: 100 }, () => now);
  await refused.get("a");
  await refused.get("a");
  assert.equal(fetches, 1);
  now = 101;
  await refused.get("a");
  assert.equal(fetches, 2);
  fetches = 0;
  const flaky = new ProductImageCache(async () => { fetches += 1; return { ok: false, reason: "unreachable", lasting: false }; }, {}, () => now);
  await flaky.get("a");
  await flaky.get("a");
  assert.equal(fetches, 2);
});

test("the cache: a limited number of fetches at the same time, the others wait their turn; too many waiting are told so", async () => {
  let running = 0;
  let peak = 0;
  const releases: (() => void)[] = [];
  const cache = new ProductImageCache(async () => {
    running += 1; peak = Math.max(peak, running);
    await new Promise<void>((resolve) => releases.push(resolve));
    running -= 1;
    return picture(1);
  }, { parallel: 2, maxWaiting: 2 });
  const jobs = ["a", "b", "c", "d"].map((key) => cache.get(key));
  const refused = await cache.get("e");
  assert.deepEqual(refused, { ok: false, reason: "unreachable", lasting: false }, "the queue is full");
  while (releases.length || running) { releases.shift()?.(); await new Promise((resolve) => setImmediate(resolve)); }
  assert.ok((await Promise.all(jobs)).every((image) => image.ok), "everybody in the queue got their picture");
  assert.equal(peak, 2);
});

// TIFF (2026-11-03): converted on the server, never passed on. A tiny TIFF is made here; nothing goes out on the network.
const tiffOf = (width: number, height: number, alpha = false) => sharp({ create: { width, height, channels: alpha ? 4 : 3, background: alpha ? { r: 200, g: 30, b: 30, alpha: 0.5 } : { r: 200, g: 30, b: 30 } } }).tiff().toBuffer();
const sizeOf = async (bytes: Uint8Array) => { const meta = await sharp(bytes).metadata(); return { format: meta.format, width: meta.width, height: meta.height }; };

test("a TIFF becomes two JPEGs, at most the page's widths and never enlarged; anything that is not a readable TIFF gives nothing", async () => {
  const converted = await convertTiff(await tiffOf(1200, 600, true));
  assert.ok(converted);
  assert.equal(converted.type, "image/jpeg");
  assert.deepEqual(await sizeOf(converted.large), { format: "jpeg", width: 1000, height: 500 });
  assert.deepEqual(await sizeOf(converted.small), { format: "jpeg", width: 160, height: 80 });
  const tall = await convertTiff(await tiffOf(300, 3000));
  assert.deepEqual(await sizeOf(tall!.large), { format: "jpeg", width: 100, height: 1000 }, "bounded both ways");
  const tiny = await convertTiff(await tiffOf(40, 20));
  assert.deepEqual(await sizeOf(tiny!.large), { format: "jpeg", width: 40, height: 20 });
  assert.deepEqual(await sizeOf(tiny!.small), { format: "jpeg", width: 40, height: 20 });

  assert.equal(await convertTiff(PNG), null, "not a TIFF");
  assert.equal(await convertTiff(await sharp(PNG).jpeg().toBuffer()), null);
  assert.equal(await convertTiff(Buffer.concat([Buffer.from("II*\0\x08\0\0\0", "latin1"), Buffer.alloc(200, 0x41)])), null, "TIFF's first bytes, then rubbish");
  assert.equal(await convertTiff((await tiffOf(1200, 600)).subarray(0, 300)), null, "cut short");
  assert.equal(await convertTiff(await tiffOf(200, 200), { maxInputPixels: 200 * 200 - 1 }), null, "more pixels than the decoder may read");
});

test("the route answers a TIFF with the converted JPEG for each width, from one fetch; the TIFF's bytes never go out", async () => {
  const tiff = await tiffOf(1200, 600);
  const fetched: string[] = [];
  const cache = new ProductImageCache((address) => fetchProductPicture(address, { fetch: async (url) => { fetched.push(url); return { ok: true, bytes: tiff, type: "image/tiff" }; } }));
  const answers = new Map<string, Buffer>();
  for (const w of ["160", "1000", "160"]) {
    const answer = await productImageAnswer(ask({ u: OK, w, s: signature(OK) }), "o", { cache, known: unknown });
    assert.equal(answer.status, 200);
    assert.equal(answer.headers.get("content-type"), "image/jpeg");
    assert.match(answer.headers.get("content-security-policy") ?? "", /default-src 'none'; sandbox/);
    const bytes = Buffer.from(await answer.arrayBuffer());
    assert.equal(answer.headers.get("content-length"), String(bytes.length));
    assert.deepEqual([...bytes.subarray(0, 3)], [0xff, 0xd8, 0xff]);
    assert.notDeepEqual(bytes.subarray(0, 4), tiff.subarray(0, 4));
    answers.set(w, bytes);
  }
  assert.deepEqual(fetched, [OK], "one fetch for both widths");
  assert.equal((await sizeOf(answers.get("160")!)).width, 160);
  assert.equal((await sizeOf(answers.get("1000")!)).width, 1000);
  assert.ok(cache.usage.bytes < tiff.length, "the cache holds the JPEGs, never the TIFF");

  // A TIFF that cannot be converted, an ordinary picture, and a failure all pass through as before.
  const broken = await fetchProductPicture(OK, { fetch: async () => ({ ok: true, bytes: Buffer.from("II*\0\x08\0\0\0rubbish!", "latin1"), type: "image/tiff" }) });
  assert.deepEqual(broken, { ok: false, reason: "type", lasting: true });
  const refusedAnswer = await productImageAnswer(ask({ u: OK, w: "160", s: signature(OK) }), "o", { cache: new ProductImageCache(async () => broken), known: unknown });
  assert.equal(refusedAnswer.status, 404);
  assert.equal(await refusedAnswer.text(), "");
  let converted = 0;
  const convert = async () => { converted += 1; return null; };
  assert.deepEqual(await fetchProductPicture(OK, { fetch: async () => picture(), convert }), picture());
  assert.deepEqual(await fetchProductPicture(OK, { fetch: async () => ({ ok: false, reason: "size", lasting: true }), convert }), { ok: false, reason: "size", lasting: true });
  assert.equal(converted, 0, "only a TIFF is converted");
});
