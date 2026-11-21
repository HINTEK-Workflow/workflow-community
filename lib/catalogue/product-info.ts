import { z } from "zod";
import { tradeUnit } from "@/lib/catalogue/units";

/**
 * Produktens uppgifter, samma överallt (2026-10-16: "informationen skall vara samma på alla ställen … lås dig inte
 * vid en leverantör"): what is known about the product a row or a hit stands for – its words, the trade's numbers, the
 * manufacturer, a picture and a status – from wherever it came: the company's own price files today, Solar's catalogue
 * today, other wholesalers' APIs later (docs/proposals/artikelsok-forslag-2026-10-16.md, etapp B). Never a price: prices
 * are the price files' and the row's own. The picture is a link to the supplier's image, never stored here; the browser gets it through
 * our own server (productImageHref, 2026-11-02).
 *
 * Pure, so the server, every page and the tests read it the same way; kept on a row as a copy (like the price copy), so a
 * saved quote, purchase or work order shows what was known when the article was picked.
 */
export const PRODUCT_SOURCES = ["pricefile", "solar", "ahlsell", "rexel", "sonepar"] as const;
export type ProductSource = (typeof PRODUCT_SOURCES)[number];
export const PRODUCT_SOURCE_LABELS: Record<ProductSource, string> = { pricefile: "Era prisfiler", solar: "Solars katalog", ahlsell: "Ahlsells katalog", rexel: "Rexels katalog", sonepar: "Sonepars katalog" };

const text = (max: number) => z.string().trim().max(max).default("");
export const productInfoSchema = z.object({
  source: z.enum(PRODUCT_SOURCES).default("pricefile"),
  eNumber: text(20), rskNumber: text(20), gtin: text(20),
  manufacturer: text(120), manufacturerArticleNo: text(60),
  /** An https link to the supplier's picture of the product; "" when none. Shown as a thumbnail through our own server, never stored as a file. */
  imageUrl: z.string().trim().max(500).refine((value) => !value || /^https:\/\//i.test(value), "Bilden måste vara en https-länk.").default(""),
  /** The server's signature on imageUrl: it came from the supplier's API (lib/catalogue/product-image.ts). Follows the copy; a browser cannot make one. */
  imageSig: z.string().trim().max(100).optional(),
  /** The supplier's status in plain words ("Utgången hos Solar"), "" when the product is current. */
  statusText: text(80),
});
export type ProductInfo = z.output<typeof productInfoSchema>;

/** A product copy as read back; anything unreadable is left out (null). */
export function readProductInfo(value: unknown): ProductInfo | null {
  if (!value || typeof value !== "object") return null;
  const parsed = productInfoSchema.safeParse(value);
  return parsed.success && hasProductFacts(parsed.data) ? parsed.data : null;
}

/** Whether a copy says anything beyond its source. */
export const hasProductFacts = (info: Partial<ProductInfo> | null | undefined) =>
  Boolean(info && (info.eNumber || info.rskNumber || info.gtin || info.manufacturer || info.manufacturerArticleNo || info.imageUrl || info.statusText));

/** The facts line, in one order everywhere: E-nummer · RSK · EAN · tillverkare · tillverkarens nummer. */
export function productFacts(info: Partial<ProductInfo> | null | undefined): string[] {
  if (!info) return [];
  return [
    info.eNumber ? `E ${info.eNumber}` : "", info.rskNumber ? `RSK ${info.rskNumber}` : "", info.gtin ? `EAN ${info.gtin}` : "",
    info.manufacturer ?? "", info.manufacturerArticleNo ? `tillv. ${info.manufacturerArticleNo}` : "",
  ].filter(Boolean);
}

/** A product as an API answered (Solar today): its facts and the trade unit for the row. */
export function productInfoOfApi(source: ProductSource, data: { eNumber?: string; gtin?: string; manufacturer?: string; manufacturerArticleNo?: string; imageUrl?: string; imageSig?: string; statusText?: string; rskNumber?: string }): ProductInfo {
  return productInfoSchema.parse({
    source, eNumber: data.eNumber ?? "", rskNumber: data.rskNumber ?? "", gtin: data.gtin ?? "", manufacturer: data.manufacturer ?? "",
    manufacturerArticleNo: data.manufacturerArticleNo ?? "", imageUrl: /^https:\/\//i.test(data.imageUrl ?? "") ? data.imageUrl : "", ...(data.imageSig ? { imageSig: data.imageSig } : {}), statusText: data.statusText ?? "",
  });
}

/**
 * A hit of the company's own register: its numbers and manufacturer from the price file, and – when an API has told more
 * about the same product (`apiInfo`, the product's master data) – the picture, the status and what the file lacked.
 */
export function productInfoOfOffer(offer: { eNumber?: string; rskNumber?: string; gtin?: string; manufacturer?: string; manufacturerArticleNo?: string }, apiInfo?: ProductInfo | null): ProductInfo {
  const own = productInfoSchema.parse({ source: "pricefile", eNumber: offer.eNumber ?? "", rskNumber: offer.rskNumber ?? "", gtin: offer.gtin ?? "", manufacturer: offer.manufacturer ?? "", manufacturerArticleNo: offer.manufacturerArticleNo ?? "" });
  if (!apiInfo) return own;
  return { ...own, source: apiInfo.source, eNumber: own.eNumber || apiInfo.eNumber, rskNumber: own.rskNumber || apiInfo.rskNumber, gtin: own.gtin || apiInfo.gtin,
    manufacturer: own.manufacturer || apiInfo.manufacturer, manufacturerArticleNo: own.manufacturerArticleNo || apiInfo.manufacturerArticleNo, imageUrl: apiInfo.imageUrl, ...(apiInfo.imageSig ? { imageSig: apiInfo.imageSig } : {}), statusText: apiInfo.statusText };
}

/**
 * The master data an API gave a product (stored on the company's product as `master`, lib/catalogue/master-data.ts) as
 * product facts; null when unreadable. `statusText` is the API's status in words (solarStatusText for Solar).
 */
export function productInfoOfMaster(value: unknown, statusText: (status: string) => string = () => ""): ProductInfo | null {
  if (!value || typeof value !== "object") return null;
  const data = value as Record<string, unknown>;
  const read = (key: string) => (typeof data[key] === "string" ? (data[key] as string) : "");
  const source = (PRODUCT_SOURCES as readonly string[]).includes(read("source")) ? read("source") as ProductSource : "solar";
  const info = productInfoOfApi(source, { eNumber: read("eNumber"), gtin: read("gtin"), manufacturer: read("manufacturer"), manufacturerArticleNo: read("manufacturerArticleNo"), imageUrl: read("imageUrl"), statusText: statusText(read("status")) });
  return hasProductFacts(info) ? info : null;
}

export { tradeUnit };

/** The widths a picture is shown in: the thumbnail and the larger one. Fixed, so the address cannot ask the supplier for anything else. */
export const PRODUCT_IMAGE_WIDTHS = [160, 1000] as const;
export type ProductImageWidth = (typeof PRODUCT_IMAGE_WIDTHS)[number];

/** The address the browser loads the picture from (2026-11-02): always our own server, which fetches it; the browser never contacts the supplier. */
export function productImageHref(info: Pick<ProductInfo, "imageUrl" | "imageSig">, width: ProductImageWidth): string {
  return `/api/product-image?u=${encodeURIComponent(info.imageUrl)}&w=${width}${info.imageSig ? `&s=${encodeURIComponent(info.imageSig)}` : ""}`;
}

/**
 * The picture as the server asks for it (2026-10-19: some miniatures never appeared): a supplier's picture can be a TIFF, which no browser
 * shows, and over a megabyte. Solar's picture service (Cloudinary) converts and shrinks on the way out, so the address gets a
 * transformation (a format the browser takes, at most `width` px wide). The version part (v123/) is optional in Cloudinary's addresses
 * (2026-11-03, checked against the service: Item/<n>.tiff without it is converted the same way); an address whose first part already looks
 * like a transformation is left alone. Any other address is returned as it is, and a TIFF that still comes back is converted by the server
 * (lib/catalogue/product-image.ts); the stored link is never changed.
 */
export function displayImageUrl(url: string, width: number): string {
  const match = /^(https:\/\/res\.cloudinary\.com\/[A-Za-z0-9_-]+\/image\/upload\/)((?:v\d+\/)?[^/]+\/.+)$/.exec(url);
  if (!match || (!/^v\d+\//.test(match[2]) && /^[a-z]{1,3}_/.test(match[2]))) return url;
  return `${match[1]}f_auto,q_auto,w_${Math.round(width)},c_limit/${match[2]}`;
}
