import { lookup as dnsLookup } from "node:dns/promises";
import { request as httpsRequest } from "node:https";
import { BlockList, isIP, type LookupFunction } from "node:net";

/**
 * Fetching a picture on the server for the browser (2026-11-02, lib/catalogue/product-image.ts uses it): the address
 * comes from outside, so nothing here trusts it. HTTPS only, no credentials in the address, never an address that is not on
 * the public internet – checked on the name's answers from DNS and pinned for the connection, so a name cannot change its
 * answer between the check and the call – every redirect checked the same way, only real raster pictures by the answer's
 * type and by their bytes (never SVG or HTML, and never TIFF), a size limit and a time limit. Nothing from the person's request goes along:
 * no cookies, no IP address, no browser headers. No imports from the app, so the unit tests read the same rules.
 *
 * TIFF (2026-11-03): fetchExternalImage refuses it, as before. Only fetchExternalImageOrTiff, for a caller that converts the picture on the
 * server and never passes those bytes to a browser (lib/catalogue/product-image.ts), gets a TIFF back – the same address rules, recognised
 * by its bytes, with a larger size limit of its own.
 */
export const EXTERNAL_IMAGE_MAX_BYTES = 10 * 1024 * 1024;
/**
 * A supplier's TIFF is often an uncompressed print original: the ones seen at Solar were about 8.2 MB for an ordinary product picture, so
 * the picture limit above would refuse them all. 25 MB is three times that, room for a larger original, and still a bounded amount to hold
 * in memory per fetch (at most six fetches run at once, lib/catalogue/product-image.ts); the decoder has its own pixel limit.
 */
export const EXTERNAL_TIFF_MAX_BYTES = 25 * 1024 * 1024;
export const EXTERNAL_IMAGE_MAX_REDIRECTS = 3;
export const EXTERNAL_IMAGE_TIMEOUT_MS = 15_000;

// Everything that is not the public internet. IPv6 is the other way round: only global unicast (2000::/3) can be public, and of that
// the ranges below are documentation or carry an IPv4 address inside (6to4, Teredo) that this check would not see.
const NOT_PUBLIC = new BlockList();
for (const [network, prefix] of [
  ["0.0.0.0", 8], ["10.0.0.0", 8], ["100.64.0.0", 10], ["127.0.0.0", 8], ["169.254.0.0", 16], ["172.16.0.0", 12], ["192.0.0.0", 24], ["192.0.2.0", 24],
  ["192.88.99.0", 24], ["192.168.0.0", 16], ["198.18.0.0", 15], ["198.51.100.0", 24], ["203.0.113.0", 24], ["224.0.0.0", 4], ["240.0.0.0", 4],
] as const) NOT_PUBLIC.addSubnet(network, prefix, "ipv4");
for (const [network, prefix] of [["2001::", 32], ["2001:db8::", 32], ["2002::", 16], ["3fff::", 20]] as const) NOT_PUBLIC.addSubnet(network, prefix, "ipv6");
const GLOBAL_V6 = new BlockList();
GLOBAL_V6.addSubnet("2000::", 3, "ipv6");

/** Whether an IP address is on the public internet. Anything that is not an IP address, an IPv4 address inside IPv6, or a private, loopback or link-local address is not. */
export function isPublicAddress(address: string): boolean {
  const version = isIP(address);
  if (version === 4) return !NOT_PUBLIC.check(address, "ipv4");
  if (version === 6) return GLOBAL_V6.check(address, "ipv6") && !NOT_PUBLIC.check(address, "ipv6");
  return false;
}

/** The address when it may be asked at all (before DNS): https, no credentials, a name with a dot or a public IP address; otherwise null. */
export function parseExternalImageAddress(raw: string): URL | null {
  let url: URL;
  try { url = new URL(raw); } catch { return null; }
  if (url.protocol !== "https:" || url.username || url.password) return null;
  const host = url.hostname.toLowerCase().replace(/\.$/, "");
  if (!host) return null;
  const literal = host.startsWith("[") ? host.slice(1, -1) : host;
  if (isIP(literal)) return isPublicAddress(literal) ? url : null;
  if (!host.includes(".") || /\.(localhost|local|internal|intranet|lan|home|corp)$/.test(host)) return null;
  return url;
}

export type ResolvedAddress = { address: string; family: number };
export type Resolve = (hostname: string) => Promise<ResolvedAddress[]>;
const systemResolve: Resolve = (hostname) => dnsLookup(hostname, { all: true, verbatim: true });

export class BlockedAddressError extends Error { constructor() { super("Blocked address"); this.name = "BlockedAddressError"; } }

/**
 * The name's answers, for the connection itself: every answer must be public (one private answer stops it), and the socket
 * connects to one of the answers checked here, so a second DNS answer cannot move it (DNS rebinding).
 */
export function pinnedLookup(resolve: Resolve = systemResolve): LookupFunction {
  return (hostname, options, callback) => {
    resolve(hostname).then((answers) => {
      if (!answers.length || answers.some((answer) => !isPublicAddress(answer.address))) throw new BlockedAddressError();
      const wanted = options.family === 4 || options.family === 6 ? answers.filter((answer) => answer.family === options.family) : answers;
      if (!wanted.length) throw new BlockedAddressError();
      if (options.all) (callback as unknown as (error: null, list: ResolvedAddress[]) => void)(null, wanted);
      else callback(null, wanted[0].address, wanted[0].family);
    }).catch((error: NodeJS.ErrnoException) => callback(error, "", 0));
  };
}

export const RASTER_TYPES = ["image/jpeg", "image/png", "image/gif", "image/webp", "image/avif", "image/bmp"] as const;
export type RasterType = (typeof RASTER_TYPES)[number];

/** The picture's kind from its first bytes, never from what the answer claims; null for everything else (SVG, HTML, TIFF, text) – a browser is given only these. */
export function sniffRasterType(bytes: Uint8Array): RasterType | null {
  const ascii = (from: number, to: number) => String.fromCharCode(...bytes.subarray(from, to));
  if (bytes.length >= 8 && bytes[0] === 0x89 && ascii(1, 4) === "PNG" && bytes[4] === 0x0d && bytes[5] === 0x0a && bytes[6] === 0x1a && bytes[7] === 0x0a) return "image/png";
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return "image/jpeg";
  if (bytes.length >= 6 && (ascii(0, 6) === "GIF87a" || ascii(0, 6) === "GIF89a")) return "image/gif";
  if (bytes.length >= 12 && ascii(0, 4) === "RIFF" && ascii(8, 12) === "WEBP") return "image/webp";
  if (bytes.length >= 12 && ascii(4, 8) === "ftyp" && /avif|avis/.test(ascii(8, Math.min(bytes.length, 48)))) return "image/avif";
  if (bytes.length >= 14 && ascii(0, 2) === "BM") return "image/bmp";
  return null;
}

/** Whether the bytes begin as a TIFF does: "II*\0" (little-endian) or "MM\0*" (big-endian). Anything else (BigTIFF included) is not. */
export function isTiff(bytes: Uint8Array): boolean {
  return bytes.length >= 8 && ((bytes[0] === 0x49 && bytes[1] === 0x49 && bytes[2] === 0x2a && bytes[3] === 0x00) || (bytes[0] === 0x4d && bytes[1] === 0x4d && bytes[2] === 0x00 && bytes[3] === 0x2a));
}

// What an answer may say it is. Some file stores answer every file as "binary" or say nothing; the browser showed those pictures, so
// they stay, and the bytes decide. Anything else – text/html, image/svg+xml, application/json, image/tiff – is refused without reading it.
// Only the converting path (fetchExternalImageOrTiff) also takes an answer that says image/tiff, and then only TIFF bytes.
const DECLARED = /^(image\/(jpeg|jpg|pjpeg|png|x-png|gif|webp|avif|bmp|x-ms-bmp)|application\/octet-stream|binary\/octet-stream|)$/;
const DECLARED_TIFF = /^(image\/(tiff|tif|x-tiff)|application\/octet-stream|binary\/octet-stream|)$/;
const declaredAs = (contentType: string) => contentType.split(";")[0].trim().toLowerCase();
export const declaredTypeAllowed = (contentType: string) => DECLARED.test(declaredAs(contentType));
/** What a TIFF's answer may say it is: TIFF, or the file stores' "binary" or nothing. */
export const declaredTiffAllowed = (contentType: string) => DECLARED_TIFF.test(declaredAs(contentType));

// Fixed and neutral: f_auto at the supplier's picture service reads Accept (every browser Workflow supports shows WebP), and no
// header of the person's request is ever passed on. Compressed answers are not asked for: the bytes must be readable as they arrive.
const REQUEST_HEADERS = { Accept: "image/webp,image/png,image/jpeg,image/gif;q=0.8,*/*;q=0.1", "Accept-Encoding": "identity", "User-Agent": "Mozilla/5.0 (compatible; WorkflowProductImages/1.0)" };

export type Hop =
  | { kind: "redirect"; location: string }
  | { kind: "status"; status: number }
  | { kind: "refused"; reason: "type" | "size" }
  | { kind: "body"; contentType: string; bytes: Uint8Array };
/** `tiffMaxBytes`: only for the converting path – an answer that says TIFF is read too, and bytes that begin as a TIFF may reach this larger limit. */
export type HopOptions = { signal: AbortSignal; maxBytes: number; resolve?: Resolve; tiffMaxBytes?: number };
export type HopFetcher = (url: URL, options: HopOptions) => Promise<Hop>;

/** One real call: only the fixed headers, the pinned name, redirects not followed, and reading stops at the size limit. */
export const httpsHop: HopFetcher = (url, { signal, maxBytes, resolve, tiffMaxBytes }) => new Promise<Hop>((done, fail) => {
  const call = httpsRequest(url, { method: "GET", headers: REQUEST_HEADERS, lookup: pinnedLookup(resolve), agent: false, signal }, (answer) => {
    const status = answer.statusCode ?? 0;
    const stop = (hop: Hop) => { done(hop); answer.destroy(); };
    if (status >= 300 && status < 400) return stop(answer.headers.location ? { kind: "redirect", location: answer.headers.location } : { kind: "status", status });
    if (status !== 200) return stop({ kind: "status", status });
    const contentType = answer.headers["content-type"] ?? "";
    if (!declaredTypeAllowed(contentType) && !(tiffMaxBytes && declaredTiffAllowed(contentType))) return stop({ kind: "refused", reason: "type" });
    if (Number(answer.headers["content-length"] ?? 0) > Math.max(maxBytes, tiffMaxBytes ?? 0)) return stop({ kind: "refused", reason: "size" });
    const chunks: Buffer[] = [];
    let size = 0;
    // The larger limit only for bytes that begin as a TIFF; everything else stops at the picture limit.
    let limit = maxBytes;
    answer.on("data", (chunk: Buffer) => {
      if (!size && tiffMaxBytes && isTiff(chunk)) limit = tiffMaxBytes;
      size += chunk.length;
      if (size > limit) return stop({ kind: "refused", reason: "size" });
      chunks.push(chunk);
    });
    answer.on("end", () => done({ kind: "body", contentType, bytes: Buffer.concat(chunks) }));
    answer.on("error", fail);
  });
  call.on("error", fail);
  call.end();
});

export type ExternalImage =
  | { ok: true; bytes: Uint8Array; type: RasterType }
  /** `lasting`: the answer says what it is (refused, missing, not a picture); otherwise it may work in a moment (time-out, the server's error). */
  | { ok: false; reason: "address" | "redirects" | "status" | "type" | "size" | "unreachable"; lasting: boolean };

/** A TIFF's bytes, only ever from fetchExternalImageOrTiff, for a caller that converts them on the server: never sent to a browser. */
export type ExternalTiff = { ok: true; bytes: Uint8Array; type: "image/tiff" };
export type ExternalImageOptions = { hop?: HopFetcher; resolve?: Resolve; maxBytes?: number; timeoutMs?: number };

/**
 * The picture at an address, or why not. Every step of a redirect goes through the same address check and the pinned name; the time limit
 * covers the whole fetch, redirects included. A TIFF is refused ("type").
 */
export function fetchExternalImage(raw: string, options: ExternalImageOptions = {}): Promise<ExternalImage> {
  return fetchPicture(raw, options, 0) as Promise<ExternalImage>;
}

/**
 * The same fetch for a caller that converts a TIFF on the server (2026-11-03): the same address rules, a picture comes back as from
 * fetchExternalImage, and a TIFF – known by its first bytes, from an answer that says TIFF, binary or nothing – comes back as `image/tiff`
 * up to `tiffMaxBytes`. Bytes that only claim to be a TIFF are refused.
 */
export function fetchExternalImageOrTiff(raw: string, options: ExternalImageOptions & { tiffMaxBytes?: number } = {}): Promise<ExternalImage | ExternalTiff> {
  return fetchPicture(raw, options, options.tiffMaxBytes ?? EXTERNAL_TIFF_MAX_BYTES);
}

async function fetchPicture(raw: string, options: ExternalImageOptions, tiffMaxBytes: number): Promise<ExternalImage | ExternalTiff> {
  const hop = options.hop ?? httpsHop;
  const maxBytes = options.maxBytes ?? EXTERNAL_IMAGE_MAX_BYTES;
  const signal = AbortSignal.timeout(options.timeoutMs ?? EXTERNAL_IMAGE_TIMEOUT_MS);
  let url = parseExternalImageAddress(raw);
  for (let step = 0; step <= EXTERNAL_IMAGE_MAX_REDIRECTS; step += 1) {
    if (!url) return { ok: false, reason: "address", lasting: true };
    let answer: Hop;
    try {
      answer = await hop(url, { signal, maxBytes, resolve: options.resolve, ...(tiffMaxBytes ? { tiffMaxBytes } : {}) });
    } catch (error) {
      return error instanceof BlockedAddressError ? { ok: false, reason: "address", lasting: true } : { ok: false, reason: "unreachable", lasting: false };
    }
    if (answer.kind === "redirect") {
      try { url = parseExternalImageAddress(new URL(answer.location, url).href); } catch { url = null; }
      continue;
    }
    if (answer.kind === "status") return { ok: false, reason: "status", lasting: answer.status < 500 && answer.status !== 429 };
    if (answer.kind === "refused") return { ok: false, reason: answer.reason, lasting: true };
    if (tiffMaxBytes && isTiff(answer.bytes)) {
      if (!declaredTiffAllowed(answer.contentType)) return { ok: false, reason: "type", lasting: true };
      if (answer.bytes.byteLength > tiffMaxBytes) return { ok: false, reason: "size", lasting: true };
      return { ok: true, bytes: answer.bytes, type: "image/tiff" };
    }
    if (!declaredTypeAllowed(answer.contentType)) return { ok: false, reason: "type", lasting: true };
    if (answer.bytes.byteLength > maxBytes) return { ok: false, reason: "size", lasting: true };
    const type = sniffRasterType(answer.bytes);
    if (!type) return { ok: false, reason: "type", lasting: true };
    return { ok: true, bytes: answer.bytes, type };
  }
  return { ok: false, reason: "redirects", lasting: true };
}
