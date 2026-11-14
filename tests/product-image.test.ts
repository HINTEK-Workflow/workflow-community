import assert from "node:assert/strict";
import test from "node:test";
import { productImageHref, productInfoOfApi, productInfoOfOffer, readProductInfo } from "../lib/catalogue/product-info";
import { declaredTypeAllowed, EXTERNAL_IMAGE_MAX_REDIRECTS, EXTERNAL_TIFF_MAX_BYTES, fetchExternalImage, fetchExternalImageOrTiff, httpsHop, isPublicAddress, isTiff, parseExternalImageAddress, pinnedLookup, sniffRasterType, type Hop, type HopFetcher } from "../lib/security/external-image";

// Produktbilder genom servern (2026-11-02): the address rules, hostile answers included. Nothing here goes out on the network: the
// fetcher is invented, and where the real one is used the invented DNS answer stops it before any connection.
const PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==", "base64");
const SVG = Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" onload="alert(1)"><script>alert(1)</script></svg>`);
const HTML = Buffer.from("<!doctype html><html><script>alert(1)</script></html>");
/** Only the first bytes of a TIFF: here only how the bytes are recognised matters (the conversion is in tests/product-image-server.test.ts). */
const TIFF = Buffer.from("II*\0\x08\0\0\0aaaaaaaa", "latin1");
const body = (contentType: string, bytes: Uint8Array): Hop => ({ kind: "body", contentType, bytes });
/** A fetcher that answers by address and remembers what was asked. */
const script = (answers: Record<string, Hop>) => {
  const asked: string[] = [];
  const hop: HopFetcher = async (url) => { asked.push(url.href); const answer = answers[url.href]; assert.ok(answer, `unexpected call to ${url.href}`); return answer; };
  return { hop, asked };
};
const OK = "https://images.example.invalid/a.png";

test("only an https address without credentials, and not an address that is not public", () => {
  for (const good of [OK, "https://res.cloudinary.com/solar-as/image/upload/v1/Item/1.tiff", "https://8.8.8.8/a.png", "https://images.example.invalid:8443/a.png", "https://[2606:4700:4700::1111]/a.png"])
    assert.ok(parseExternalImageAddress(good), good);
  for (const bad of [
    "", "inte en adress", "/api/files/logo", "http://images.example.invalid/a.png", "ftp://images.example.invalid/a.png", "file:///etc/passwd", "data:image/png;base64,AA", "javascript:alert(1)",
    "https://user:pass@images.example.invalid/a.png", "https://user@images.example.invalid/a.png",
    "https://localhost/a.png", "https://LOCALHOST./a.png", "https://db/a.png", "https://app.localhost/a.png", "https://intern.local/a.png", "https://db.internal/a.png",
    "https://127.0.0.1/a.png", "https://127.1/a.png", "https://2130706433/a.png", "https://0x7f.0.0.1/a.png", "https://0177.0.0.1/a.png", "https://10.0.0.10/a.png", "https://192.168.1.1/a.png", "https://172.16.0.1/a.png",
    "https://169.254.169.254/latest/meta-data", "https://100.64.0.1/a.png", "https://0.0.0.0/a.png",
    "https://[::1]/a.png", "https://[::ffff:127.0.0.1]/a.png", "https://[::ffff:7f00:1]/a.png", "https://[fe80::1]/a.png", "https://[fc00::1]/a.png", "https://[fd00::1]/a.png", "https://[2002:7f00:1::]/a.png", "https://[64:ff9b::7f00:1]/a.png",
  ]) assert.equal(parseExternalImageAddress(bad), null, bad);
});

test("what counts as a public IP address", () => {
  for (const good of ["8.8.8.8", "1.1.1.1", "93.184.216.34", "2606:4700:4700::1111", "2a00:1450:4001::1"]) assert.equal(isPublicAddress(good), true, good);
  for (const bad of ["10.0.0.1", "10.20.30.40", "127.0.0.1", "169.254.1.1", "172.31.255.255", "192.168.0.1", "100.100.0.1", "198.18.0.1", "192.0.2.1", "203.0.113.5", "224.0.0.1", "255.255.255.255", "0.1.2.3",
    "::", "::1", "fe80::1", "fc00::1", "fd12:3456::1", "ff02::1", "::ffff:8.8.8.8", "::ffff:10.0.0.1", "2001:db8::1", "2002:0a00:0001::", "2001:0:0a00:1::", "inte-en-ip", ""])
    assert.equal(isPublicAddress(bad), false, bad);
});

test("the name's answers: one private answer stops it, otherwise the connection gets exactly what was checked", async () => {
  const ask = (answers: { address: string; family: number }[], options: { all?: boolean; family?: number }) => new Promise<{ error: Error | null; address: unknown; family?: number }>((resolve) => {
    (pinnedLookup(async () => answers) as unknown as (host: string, options: object, callback: (error: Error | null, address: unknown, family?: number) => void) => void)("x.example.invalid", options, (error, address, family) => resolve({ error, address, family }));
  });
  const v4 = { address: "8.8.8.8", family: 4 };
  const v6 = { address: "2606:4700:4700::1111", family: 6 };
  assert.deepEqual(await ask([v4, v6], { all: true }), { error: null, address: [v4, v6], family: undefined });
  assert.deepEqual(await ask([v4], {}), { error: null, address: "8.8.8.8", family: 4 });
  assert.deepEqual(await ask([v4, v6], { family: 6 }), { error: null, address: v6.address, family: 6 });
  for (const answers of [[], [{ address: "127.0.0.1", family: 4 }], [v4, { address: "10.0.0.1", family: 4 }], [{ address: "::1", family: 6 }], [{ address: "169.254.169.254", family: 4 }], [{ address: "::ffff:127.0.0.1", family: 6 }]]) {
    const { error } = await ask(answers, { all: true });
    assert.ok(error, `refused: ${JSON.stringify(answers)}`);
  }
});

test("the real fetch stops at a name that points inward, with no connection made, first call or after a redirect", async () => {
  const inward = await fetchExternalImage("https://rebind.example.invalid/a.png", { hop: httpsHop, resolve: async () => [{ address: "127.0.0.1", family: 4 }] });
  assert.deepEqual(inward, { ok: false, reason: "address", lasting: true });
  const afterRedirect = await fetchExternalImage(OK, { hop: (url, options) => (url.href === OK ? Promise.resolve({ kind: "redirect", location: "https://rebind.example.invalid/b.png" }) : httpsHop(url, options)), resolve: async () => [{ address: "10.20.30.40", family: 4 }] });
  assert.deepEqual(afterRedirect, { ok: false, reason: "address", lasting: true });
});

test("a picture comes back with the type its bytes say, also when the answer says only binary or claims another picture type", async () => {
  for (const contentType of ["image/png", "image/PNG; charset=binary", "image/jpeg", "application/octet-stream", "binary/octet-stream", ""]) {
    const answer = await fetchExternalImage(OK, { hop: script({ [OK]: body(contentType, PNG) }).hop });
    assert.ok(answer.ok, contentType);
    assert.equal(answer.type, "image/png");
    assert.deepEqual(Buffer.from(answer.bytes), PNG);
  }
});

test("only real raster pictures: SVG and HTML are refused however they are labelled", async () => {
  for (const [contentType, bytes] of [["image/svg+xml", SVG], ["image/svg+xml", PNG], ["text/html", HTML], ["text/html; charset=utf-8", PNG], ["application/json", Buffer.from("{}")], ["image/png", SVG], ["image/png", HTML], ["application/octet-stream", SVG], ["application/octet-stream", HTML], ["image/jpeg", Buffer.alloc(0)], ["image/tiff", Buffer.from("II*\0aaaaaaaa")]] as const)
    assert.deepEqual(await fetchExternalImage(OK, { hop: script({ [OK]: body(contentType, bytes) }).hop }), { ok: false, reason: "type", lasting: true }, `${contentType} ${bytes.length}`);
  assert.equal(declaredTypeAllowed("IMAGE/WEBP"), true);
  assert.equal(declaredTypeAllowed("image/svg+xml"), false);
  assert.equal(declaredTypeAllowed("image/svg+xml; image/png"), false);
  const header = (...values: number[]) => Uint8Array.from([...values, ...new Array(32).fill(0)]);
  assert.equal(sniffRasterType(header(0xff, 0xd8, 0xff)), "image/jpeg");
  assert.equal(sniffRasterType(Buffer.from("GIF89a-aaaaaaaaaaaa")), "image/gif");
  assert.equal(sniffRasterType(Buffer.from("RIFF----WEBPVP8 aaaa")), "image/webp");
  assert.equal(sniffRasterType(Buffer.from("\0\0\0\x20ftypavif\0\0\0\0avifmif1")), "image/avif");
  assert.equal(sniffRasterType(Buffer.from("BM-aaaaaaaaaaaaaaaa")), "image/bmp");
  assert.equal(sniffRasterType(Buffer.from("RIFF----WAVEfmt aaaa")), null);
  assert.equal(sniffRasterType(Buffer.from("GIF is a nice format")), null);
  assert.equal(sniffRasterType(Buffer.from(" <svg></svg>        ")), null);
});

test("TIFF: refused by the ordinary fetch however it is labelled, recognised by its bytes only", async () => {
  for (const contentType of ["image/tiff", "application/octet-stream", "", "image/png"])
    assert.deepEqual(await fetchExternalImage(OK, { hop: script({ [OK]: body(contentType, TIFF) }).hop }), { ok: false, reason: "type", lasting: true }, contentType);
  assert.equal(declaredTypeAllowed("image/tiff"), false);
  assert.equal(sniffRasterType(TIFF), null, "a browser is never given a TIFF");
  assert.equal(isTiff(TIFF), true);
  assert.equal(isTiff(Buffer.from("MM\0*\0\0\0\x08aaaa", "latin1")), true, "big-endian");
  for (const other of [PNG, SVG, HTML, Buffer.from("II*\0"), Buffer.from("II+\0\x08\0\0\0aaaa", "latin1"), Buffer.from("MM*\0\0\0\0\x08", "latin1"), Buffer.alloc(0)]) assert.equal(isTiff(other), false);
});

test("TIFF on the converting path: only real TIFF bytes from an answer that says TIFF, binary or nothing, within its own limit", async () => {
  for (const contentType of ["image/tiff", "image/TIFF; charset=binary", "application/octet-stream", ""]) {
    const answer = await fetchExternalImageOrTiff(OK, { hop: script({ [OK]: body(contentType, TIFF) }).hop });
    assert.ok(answer.ok, contentType);
    assert.equal(answer.type, "image/tiff");
  }
  // Claimed TIFF with other bytes, or TIFF bytes behind another type's label.
  for (const [contentType, bytes] of [["image/tiff", PNG], ["image/tiff", HTML], ["image/tiff", SVG], ["image/tiff", Buffer.from("II*\0")], ["image/png", TIFF], ["text/html", TIFF], ["image/svg+xml", TIFF]] as const)
    assert.deepEqual(await fetchExternalImageOrTiff(OK, { hop: script({ [OK]: body(contentType, bytes) }).hop }), { ok: false, reason: "type", lasting: true }, `${contentType} ${bytes.length}`);
  // Everything else is as in the ordinary fetch.
  const png = await fetchExternalImageOrTiff(OK, { hop: script({ [OK]: body("image/png", PNG) }).hop });
  assert.ok(png.ok && png.type === "image/png");
  // The larger limit is only for a TIFF.
  assert.equal((await fetchExternalImageOrTiff(OK, { maxBytes: 10, tiffMaxBytes: 1000, hop: script({ [OK]: body("image/tiff", TIFF) }).hop })).ok, true);
  assert.deepEqual(await fetchExternalImageOrTiff(OK, { maxBytes: 10, tiffMaxBytes: 1000, hop: script({ [OK]: body("image/png", PNG) }).hop }), { ok: false, reason: "size", lasting: true });
  assert.deepEqual(await fetchExternalImageOrTiff(OK, { tiffMaxBytes: 10, hop: script({ [OK]: body("image/tiff", TIFF) }).hop }), { ok: false, reason: "size", lasting: true });
  assert.equal(EXTERNAL_TIFF_MAX_BYTES, 25 * 1024 * 1024);
  // The hop is told the larger limit only on this path, and the address rules are the same.
  const limits: (number | undefined)[] = [];
  const spy: HopFetcher = async (_url, options) => { limits.push(options.tiffMaxBytes); return body("image/png", PNG); };
  await fetchExternalImage(OK, { hop: spy });
  await fetchExternalImageOrTiff(OK, { hop: spy });
  assert.deepEqual(limits, [undefined, EXTERNAL_TIFF_MAX_BYTES]);
  for (const bad of ["http://images.example.invalid/a.tiff", "https://127.0.0.1/a.tiff", "https://localhost/a.tiff"])
    assert.deepEqual(await fetchExternalImageOrTiff(bad, { hop: spy }), { ok: false, reason: "address", lasting: true }, bad);
  assert.deepEqual(await fetchExternalImageOrTiff("https://rebind.example.invalid/a.tiff", { hop: httpsHop, resolve: async () => [{ address: "10.0.0.1", family: 4 }] }), { ok: false, reason: "address", lasting: true });
});

test("too large, missing or failing answers", async () => {
  assert.deepEqual(await fetchExternalImage(OK, { maxBytes: 10, hop: script({ [OK]: body("image/png", PNG) }).hop }), { ok: false, reason: "size", lasting: true });
  assert.deepEqual(await fetchExternalImage(OK, { hop: script({ [OK]: { kind: "refused", reason: "size" } }).hop }), { ok: false, reason: "size", lasting: true });
  assert.deepEqual(await fetchExternalImage(OK, { hop: script({ [OK]: { kind: "status", status: 404 } }).hop }), { ok: false, reason: "status", lasting: true });
  assert.deepEqual(await fetchExternalImage(OK, { hop: script({ [OK]: { kind: "status", status: 503 } }).hop }), { ok: false, reason: "status", lasting: false });
  assert.deepEqual(await fetchExternalImage(OK, { hop: async () => { throw new Error("timeout"); } }), { ok: false, reason: "unreachable", lasting: false });
  // The time limit reaches the call: an answer that never comes ends.
  const slow: HopFetcher = (_url, { signal }) => new Promise((_resolve, reject) => { signal.addEventListener("abort", () => reject(new Error("aborted"))); });
  assert.deepEqual(await fetchExternalImage(OK, { hop: slow, timeoutMs: 20 }), { ok: false, reason: "unreachable", lasting: false });
});

test("every redirect is checked anew, and few are followed", async () => {
  const next = "https://cdn.example.invalid/a.png";
  const followed = script({ [OK]: { kind: "redirect", location: "//cdn.example.invalid/a.png" }, [next]: body("image/png", PNG) });
  assert.equal((await fetchExternalImage(OK, { hop: followed.hop })).ok, true, "a relative redirect to another public name");
  assert.deepEqual(followed.asked, [OK, next]);
  for (const location of ["https://127.0.0.1/a.png", "https://[::1]/a.png", "https://localhost/a.png", "https://169.254.169.254/latest/meta-data", "https://10.0.0.10/a.png", "http://images.example.invalid/a.png", "https://u:p@images.example.invalid/a.png", "file:///etc/passwd", "http://[bad"]) {
    const { hop, asked } = script({ [OK]: { kind: "redirect", location } });
    assert.deepEqual(await fetchExternalImage(OK, { hop }), { ok: false, reason: "address", lasting: true }, location);
    assert.deepEqual(asked, [OK], `${location} was never called`);
  }
  const hops = Object.fromEntries(Array.from({ length: 10 }, (_, index) => [`https://r${index}.example.invalid/a.png`, { kind: "redirect", location: `https://r${index + 1}.example.invalid/a.png` } as Hop]));
  const endless = script(hops);
  assert.deepEqual(await fetchExternalImage("https://r0.example.invalid/a.png", { hop: endless.hop }), { ok: false, reason: "redirects", lasting: true });
  assert.equal(endless.asked.length, EXTERNAL_IMAGE_MAX_REDIRECTS + 1);
});

test("the address the page loads is always our own, with the signature when there is one", () => {
  const href = productImageHref({ imageUrl: "https://res.cloudinary.com/solar-as/image/upload/v1/Item/1.tiff?a=1&b=2", imageSig: "abc-_" }, 160);
  assert.ok(href.startsWith("/api/product-image?"), href);
  const search = new URL(href, "http://localhost").searchParams;
  assert.equal(search.get("u"), "https://res.cloudinary.com/solar-as/image/upload/v1/Item/1.tiff?a=1&b=2");
  assert.equal(search.get("s"), "abc-_");
  assert.equal(search.get("w"), "160");
  assert.equal(new URL(productImageHref({ imageUrl: OK }, 1000), "http://localhost").searchParams.get("s"), null, "a row from before the signatures");
});

test("the signature follows the product's copy from the API to the row and back", () => {
  const info = productInfoOfApi("solar", { eNumber: "1000001", imageUrl: OK, imageSig: "abc" });
  assert.equal(info.imageSig, "abc");
  assert.equal(readProductInfo(JSON.parse(JSON.stringify(info)))?.imageSig, "abc", "saved and read back");
  assert.equal(productInfoOfOffer({ eNumber: "1000001" }, info).imageSig, "abc", "a hit of the company's own register");
  assert.equal("imageSig" in productInfoOfApi("solar", { imageUrl: OK }), false, "nothing to sign, no field");
});
