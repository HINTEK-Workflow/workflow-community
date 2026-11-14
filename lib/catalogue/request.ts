import "server-only";
import { z } from "zod";
import { ApiError } from "@/lib/kfid/errors";
import { PRICE_SCALES } from "@/lib/catalogue/fields";
import { openPriceFile, PriceFileError, type PriceFile, type PriceFileFormat } from "@/lib/catalogue/file/open";
import { MAX_FIXED_COLUMNS } from "@/lib/catalogue/file/fixed-width";
import type { CatalogueParseOptions } from "@/lib/catalogue/model";
import { detectEncoding } from "@/lib/catalogue/file/text";
import { readRebateText, type RebateRead } from "@/lib/catalogue/rebate";

/**
 * How a price file is read and parsed, as the Import page sends it with the file (prisfiler etapp 1, 2026-10-12):
 * headings or not, fixed-width positions, the sheet, the price scale and whether the article number is the E-nummer.
 * Validated here for both the preview (/api/import) and the import (/api/catalogue).
 */
export const MAX_PRICE_FILE_BYTES = 60_000_000;

export const priceFormatSchema = z.object({
  header: z.enum(["auto", "yes", "no"]).optional(),
  fixedStarts: z.array(z.number().int().min(1).max(10_000)).max(MAX_FIXED_COLUMNS).optional(),
  sheet: z.string().max(200).optional(),
}).default({});
export const priceParseSchema = z.object({
  priceScale: z.union([z.literal(PRICE_SCALES[0]), z.literal(PRICE_SCALES[1]), z.literal(PRICE_SCALES[2])]).optional(),
  articleNoIsENumber: z.boolean().optional(),
  // Grundpris eller nettopris (2026-10-13 natt).
  priceKind: z.enum(["NET", "BASE"]).optional(),
  // The E-nummer by an area column (2026-10-14: Solar's Produktområde).
  eNumberRule: z.object({ column: z.string().max(200), values: z.array(z.string().max(10)).max(10) }).optional(),
}).default({});

/** A form field with JSON (the format or the parse options), validated; absent means the defaults. */
export function formJson<T extends z.ZodTypeAny>(form: FormData, name: string, schema: T): z.infer<T> {
  const raw = form.get(name);
  if (raw === null || raw === "") return schema.parse(undefined);
  let value: unknown;
  try { value = JSON.parse(String(raw)); } catch { throw new ApiError(400, "Ogiltiga val för prisfilen."); }
  return schema.parse(value);
}

/** An uploaded price file opened for reading, or a 400/413 with what is wrong. */
export async function openUploadedPriceFile(file: File, format: PriceFileFormat = {}): Promise<PriceFile> {
  if (!file.size) throw new ApiError(400, `${file.name} är tom.`);
  if (file.size > MAX_PRICE_FILE_BYTES) throw new ApiError(413, `${file.name} är för stor (högst ${MAX_PRICE_FILE_BYTES / 1_000_000} MB för en prisfil). Packa inte filen; dela upp den i flera filer.`);
  try { return await openPriceFile(new Uint8Array(await file.arrayBuffer()), file.name.slice(0, 200), format); }
  catch (error) { if (error instanceof PriceFileError) throw new ApiError(400, error.message); throw error; }
}

export type PriceUploadOptions = { format: PriceFileFormat; parse: CatalogueParseOptions };

/** A discount letter is a small text file; anything larger is never one. */
export const MAX_REBATE_FILE_BYTES = 5_000_000;

/** The text of an uploaded file with its encoding decided (BOM, UTF-8, otherwise Windows-1252). */
export async function uploadedText(file: File): Promise<string> {
  const bytes = new Uint8Array(await file.arrayBuffer());
  const { encoding, bom } = detectEncoding(bytes);
  return new TextDecoder(encoding).decode(bytes.subarray(bom));
}

/**
 * Rabattbrev (2026-10-14): the uploaded file read as a discount letter of a known format, or null when it is not
 * one (a price list, an unknown layout). Only text files up to 5 MB are tried.
 */
export async function readRebateFile(file: File, today: string): Promise<RebateRead | null> {
  if (!/\.(txt|csv|prn|dat|asc)$/i.test(file.name) || !file.size || file.size > MAX_REBATE_FILE_BYTES) return null;
  return readRebateText(await uploadedText(file), today);
}
