import { createHmac, timingSafeEqual } from "node:crypto";
import { prisma } from "@/lib/db";
import { env } from "@/lib/env";
import { displayImageUrl, PRODUCT_IMAGE_WIDTHS, type ProductImageWidth } from "@/lib/catalogue/product-info";
import { convertTiff } from "@/lib/catalogue/product-image-tiff";
import { fetchExternalImageOrTiff, parseExternalImageAddress, type ExternalImage } from "@/lib/security/external-image";

/**
 * Produktbilder genom den egna servern (2026-11-02, replaces "link only, no proxy" of 2026-10-18): the browser asks
 * /api/product-image and never the supplier, so a person's IP address does not reach a third party. docs/drift/CSP.md and
 * docs/beslut/artiklar-priser-och-inkop.md say why.
 *
 * Not an open fetcher. The server signs a picture link when the link comes from the supplier's API (ProductInfo.imageSig),
 * and the signature follows the product copy onto a quote, purchase or work order row, so the picture still shows when the
 * supplier's data has moved on. A link the browser made up has no signature and is refused. A row saved before signatures
 * existed has none either: such a link is accepted only if it stands in what the API has told (ExternalProductCache, the
 * company's own CatalogueProduct.master). The signature covers only the address, so it is the same for every company: a
 * supplier's picture is no company's data.
 *
 * Nothing is stored: a bounded cache in this process's memory, gone at restart. Pictures are fetched when a browser asks.
 *
 * A TIFF (2026-11-03) that no picture service converts on the way out is converted here (lib/catalogue/product-image-tiff.ts) to a JPEG
 * for each of the page's two widths, once per fetch; the cache keeps the JPEGs, never the TIFF, and the TIFF's bytes never reach a browser.
 */
const signatureOf = (url: string) => createHmac("sha256", env.AUTH_SECRET).update(`product-image:${url}`).digest("base64url");

export function validProductImageSignature(url: string, signature: string): boolean {
  if (!url || !signature) return false;
  const given = Buffer.from(signature);
  const expected = Buffer.from(signatureOf(url));
  return given.length === expected.length && timingSafeEqual(given, expected);
}

/** A product's facts with its picture link signed: for what the server read from the supplier's API, never for what a browser sent. */
export function signedProductImage<T extends { imageUrl?: string }>(info: T): T & { imageSig?: string } {
  return info.imageUrl ? { ...info, imageSig: signatureOf(info.imageUrl) } : info;
}

/** A link without a signature (a row saved before 2026-11-02): whether the supplier's API, for everybody or for this company's product, gave it. */
export async function knownSupplierImage(organizationId: string, url: string): Promise<boolean> {
  const rows = await prisma.$queryRaw<{ known: boolean }[]>`
    SELECT EXISTS (SELECT 1 FROM "ExternalProductCache" WHERE "found" AND "data"->>'imageUrl' = ${url})
        OR EXISTS (SELECT 1 FROM "CatalogueProduct" WHERE "organizationId" = ${organizationId} AND "master"->>'imageUrl' = ${url}) AS "known"`;
  return Boolean(rows[0]?.known);
}

/** What the cache holds: a picture as fetched (the same bytes for both widths), a converted TIFF (its own thumbnail), or why not. */
export type ProductPicture = ExternalImage | { ok: true; bytes: Uint8Array; type: "image/jpeg"; thumbnail: Uint8Array };

/** The picture at an address for the page: as fetched, or a TIFF converted on this server. A TIFF that cannot be converted is refused like any other non-picture. */
export async function fetchProductPicture(address: string, deps: { fetch?: typeof fetchExternalImageOrTiff; convert?: typeof convertTiff } = {}): Promise<ProductPicture> {
  const image = await (deps.fetch ?? fetchExternalImageOrTiff)(address);
  if (!image.ok || image.type !== "image/tiff") return image;
  const converted = await (deps.convert ?? convertTiff)(image.bytes, { largeWidth: Math.max(...PRODUCT_IMAGE_WIDTHS), smallWidth: Math.min(...PRODUCT_IMAGE_WIDTHS) });
  return converted ? { ok: true, bytes: converted.large, type: converted.type, thumbnail: converted.small } : { ok: false, reason: "type", lasting: true };
}

export type ProductImageCacheLimits = { maxBytes: number; maxEntryBytes: number; maxEntries: number; ttlMs: number; refusedTtlMs: number; parallel: number; maxWaiting: number };
const CACHE_LIMITS: ProductImageCacheLimits = { maxBytes: 48 * 1024 * 1024, maxEntryBytes: 4 * 1024 * 1024, maxEntries: 4000, ttlMs: 24 * 60 * 60 * 1000, refusedTtlMs: 5 * 60 * 1000, parallel: 6, maxWaiting: 200 };

/** The bounded cache and the limit on simultaneous fetches. A class so the tests get their own, with an invented fetcher. */
export class ProductImageCache {
  private entries = new Map<string, { until: number; image: ProductPicture; size: number }>();
  private running = new Map<string, Promise<ProductPicture>>();
  private bytes = 0;
  private active = 0;
  private waiting: (() => void)[] = [];
  private limits: ProductImageCacheLimits;
  constructor(private fetcher: (address: string) => Promise<ProductPicture> = fetchProductPicture, limits: Partial<ProductImageCacheLimits> = {}, private now: () => number = Date.now) {
    this.limits = { ...CACHE_LIMITS, ...limits };
  }

  /** The picture from the cache, or fetched once however many ask at the same time. */
  async get(address: string): Promise<ProductPicture> {
    const known = this.entries.get(address);
    if (known && known.until > this.now()) {
      // Most recently used last: the oldest goes first when the cache is full.
      this.entries.delete(address);
      this.entries.set(address, known);
      return known.image;
    }
    if (known) this.forget(address);
    const started = this.running.get(address);
    if (started) return started;
    const job = this.fetchInTurn(address).then((image) => { this.keep(address, image); return image; }).finally(() => this.running.delete(address));
    this.running.set(address, job);
    return job;
  }

  /** How much the cache holds now. */
  get usage() { return { bytes: this.bytes, entries: this.entries.size }; }

  private async fetchInTurn(address: string): Promise<ProductPicture> {
    if (this.active >= this.limits.parallel) {
      if (this.waiting.length >= this.limits.maxWaiting) return { ok: false, reason: "unreachable", lasting: false };
      await new Promise<void>((resolve) => this.waiting.push(resolve));
    }
    this.active += 1;
    try { return await this.fetcher(address); } finally { this.active -= 1; this.waiting.shift()?.(); }
  }

  private keep(address: string, image: ProductPicture) {
    if (!image.ok && !image.lasting) return;
    const size = image.ok ? image.bytes.byteLength + ("thumbnail" in image ? image.thumbnail.byteLength : 0) : 0;
    if (size > this.limits.maxEntryBytes) return;
    this.entries.set(address, { until: this.now() + (image.ok ? this.limits.ttlMs : this.limits.refusedTtlMs), image, size });
    this.bytes += size;
    for (const oldest of this.entries.keys()) {
      if (this.bytes <= this.limits.maxBytes && this.entries.size <= this.limits.maxEntries) break;
      this.forget(oldest);
    }
  }

  private forget(address: string) {
    const known = this.entries.get(address);
    if (!known) return;
    this.bytes -= known.size;
    this.entries.delete(address);
  }
}

const shared = new ProductImageCache((address) => fetchProductPicture(address));
const quiet = (status: number) => new Response(null, { status, headers: { "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff" } });

/**
 * The answer for a signed-in person of a company (the route has checked that; `known` and `cache` are replaceable for tests). A refusal
 * has no body and tells nothing: the page's picture hides quietly, as it does when any picture does not load.
 */
export async function productImageAnswer(request: Request, organizationId: string, deps: { cache?: ProductImageCache; known?: typeof knownSupplierImage } = {}): Promise<Response> {
  const search = new URL(request.url).searchParams;
  const url = search.get("u") ?? "";
  const width = Number(search.get("w"));
  if (!url || url.length > 500 || !parseExternalImageAddress(url) || !(PRODUCT_IMAGE_WIDTHS as readonly number[]).includes(width)) return quiet(400);
  if (!validProductImageSignature(url, search.get("s") ?? "") && !(await (deps.known ?? knownSupplierImage)(organizationId, url))) return quiet(403);
  const image = await (deps.cache ?? shared).get(displayImageUrl(url, width as ProductImageWidth));
  if (!image.ok) return quiet(image.lasting ? 404 : 502);
  const bytes = "thumbnail" in image && width === Math.min(...PRODUCT_IMAGE_WIDTHS) ? image.thumbnail : image.bytes;
  return new Response(Buffer.from(bytes), { headers: {
    "Content-Type": image.type, "Content-Length": String(bytes.byteLength),
    // The browser keeps it for a day, so a list scrolled again costs nobody any traffic; never in a shared cache in between.
    "Cache-Control": "private, max-age=86400", "X-Content-Type-Options": "nosniff", "Content-Security-Policy": "default-src 'none'; sandbox", "Content-Disposition": "inline",
  } });
}
