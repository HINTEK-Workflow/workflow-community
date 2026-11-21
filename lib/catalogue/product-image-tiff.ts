import sharp from "sharp";
import { isTiff, sniffRasterType } from "@/lib/security/external-image";

/**
 * A supplier's TIFF as a picture the browser shows (2026-11-03, measured on production: about a third of Solar's sampled articles had a TIFF
 * link, which no browser shows and lib/security/external-image.ts refuses to pass on). Only lib/catalogue/product-image.ts calls this, with
 * bytes fetchExternalImageOrTiff has already recognised as a TIFF; the TIFF's bytes themselves never reach a browser.
 *
 * The bytes are untrusted, so: TIFF by its first bytes only, the first page only, a limit on the pixels decoded (a small file can claim a
 * huge picture), a time limit per step, at most two conversions at once (decoding a large original takes memory), and out comes only a
 * JPEG on white, at most the page's two widths, no metadata. Any failure gives null, and the page's picture hides quietly as before.
 */
export const TIFF_MAX_INPUT_PIXELS = 40_000_000;
export const TIFF_CONVERT_TIMEOUT_SECONDS = 10;
const PARALLEL_CONVERSIONS = 2;

export type ConvertedTiff = { type: "image/jpeg"; large: Uint8Array; small: Uint8Array };

let running = 0;
const waiting: (() => void)[] = [];
async function inTurn<T>(work: () => Promise<T>): Promise<T> {
  if (running >= PARALLEL_CONVERSIONS) await new Promise<void>((resolve) => waiting.push(resolve));
  running += 1;
  try { return await work(); } finally { running -= 1; waiting.shift()?.(); }
}

/** The TIFF as two JPEGs: `large` at most `largeWidth` px and `small` at most `smallWidth` px on each side, never enlarged; null if it cannot be read. */
export async function convertTiff(bytes: Uint8Array, options: { largeWidth?: number; smallWidth?: number; maxInputPixels?: number; timeoutSeconds?: number } = {}): Promise<ConvertedTiff | null> {
  if (!isTiff(bytes)) return null;
  const largeWidth = options.largeWidth ?? 1000;
  const smallWidth = options.smallWidth ?? 160;
  const limitInputPixels = options.maxInputPixels ?? TIFF_MAX_INPUT_PIXELS;
  const timeout = { seconds: options.timeoutSeconds ?? TIFF_CONVERT_TIMEOUT_SECONDS };
  try {
    return await inTurn(async () => {
      const large = await sharp(bytes, { limitInputPixels, failOn: "error", pages: 1, page: 0 })
        .rotate()
        .resize({ width: largeWidth, height: largeWidth, fit: "inside", withoutEnlargement: true })
        .flatten({ background: "#ffffff" })
        .jpeg({ quality: 82 })
        .timeout(timeout)
        .toBuffer();
      // The thumbnail from the converted picture, not the original: one decode of the large TIFF.
      const small = await sharp(large, { limitInputPixels })
        .resize({ width: smallWidth, height: smallWidth, fit: "inside", withoutEnlargement: true })
        .jpeg({ quality: 80 })
        .timeout(timeout)
        .toBuffer();
      if (sniffRasterType(large) !== "image/jpeg" || sniffRasterType(small) !== "image/jpeg") return null;
      return { type: "image/jpeg" as const, large, small };
    });
  } catch {
    return null;
  }
}
