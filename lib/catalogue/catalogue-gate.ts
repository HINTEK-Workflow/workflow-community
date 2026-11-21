import { prisma } from "@/lib/db";
import type { Prisma } from "@prisma/client";
import { wholesaleApi } from "@/lib/integrations/wholesale-api";
import { supplierIsWholesaler } from "@/lib/wholesale/prepare";
import { WHOLESALERS, type WholesalerId } from "@/lib/wholesale/model";
import { tradeUnit } from "@/lib/catalogue/units";
import { digitsOf } from "@/lib/catalogue/normalize";
import type { ImportGateReason } from "@/lib/catalogue/gate-text";

/**
 * Vilken väg en prisfil går (produktägaren 2026-11-01, ersätter "prisfiler kräver grossistens API-katalog" 2026-10-17): a price file is never
 * refused because of a wholesaler's API. Three ways, and the gate says which:
 * - **The wholesaler has a working catalogue** in the shared register (today Solar with the connection on and a full import made): the file is
 *   synchronised against it – its rows are matched to the wholesaler's own articles and never create articles of their own (`catalogue`).
 * - **The wholesaler has none** (the API is off, not fetched, or does not exist – Ahlsell, Rexel, Sonepar today): only the file's rows are stored, per
 *   company and within a limit, as rows that need no article (`fileRows`, lib/catalogue/file-prices.ts). They are never copied into the company's
 *   own CatalogueArticle, and when the catalogue comes they are read as its articles' prices without being rewritten.
 * - **A supplier the company named itself** (no wholesaler) works as before – its own articles, within the same limit (`catalogue: null`).
 *
 * Priser direkt mot katalogartikeln (2026-10-17, alternativ C): a matched row's price goes to WholesalePrice on the
 * article's running number (lib/catalogue/wholesale-prices.ts) – nothing is copied into the company's own CatalogueArticle,
 * CatalogueProduct or CataloguePrice.
 *
 * "Working catalogue" = the API connection is switched on under Tjänster och nycklar and a full import has been made. The
 * check does not call the wholesaler at each upload, so an upload never depends on the wholesaler being reachable right now.
 */
export type WholesalerOfSupplier = WholesalerId | null;

/** The wholesaler a supplier is: as the company set it, otherwise as its name says (a word, never a similar name). */
export function wholesalerOfSupplier(supplier: { wholesaler?: string | null; name: string }): WholesalerOfSupplier {
  if (supplier.wholesaler && (WHOLESALERS as readonly string[]).includes(supplier.wholesaler)) return supplier.wholesaler as WholesalerId;
  return WHOLESALERS.find((id) => supplierIsWholesaler(supplier.name, id)) ?? null;
}

/**
 * `catalogue`: the wholesaler whose catalogue the file is synchronised against. `fileRows`: the wholesaler whose file is stored as the company's own
 * rows. Both empty: the company's own supplier. `reason` (2026-10-31): why the wholesaler has no catalogue, as a code the Import page words in its box
 * (lib/catalogue/gate-text.ts).
 */
export type ImportGate = { ok: true; catalogue: WholesalerId | null; fileRows?: WholesalerId | null; reason?: ImportGateReason };

/** Only for tests that exercise the price and discount rules themselves (isolated schemas, never the app): replaces the check. */
let testGate: ((wholesaler: WholesalerOfSupplier) => Promise<ImportGate>) | null = null;
export function overrideImportGateForTests(gate: typeof testGate) { testGate = gate; }

/** Which way a file for this wholesaler is written. */
export async function importGate(wholesaler: WholesalerOfSupplier): Promise<ImportGate> {
  if (testGate) return testGate(wholesaler);
  if (!wholesaler) return { ok: true, catalogue: null };
  const api = wholesaleApi(wholesaler);
  if (!api.available) return { ok: true, catalogue: null, fileRows: wholesaler, reason: "no_api" };
  if (!(await api.enabled())) return { ok: true, catalogue: null, fileRows: wholesaler, reason: "inactive" };
  const [articles, sync] = await Promise.all([
    prisma.wholesaleArticle.count({ where: { wholesaler, pendingRun: null, status: { not: "40" } } }),
    prisma.wholesaleRegisterSync.findUnique({ where: { wholesaler }, select: { lastFullAt: true } }),
  ]);
  if (!articles || !sync?.lastFullAt) return { ok: true, catalogue: null, fileRows: wholesaler, reason: "not_fetched" };
  return { ok: true, catalogue: wholesaler };
}

/** A price-file row as the matching reads it. */
export type MatchRow = { articleNo: string; eNumber: string; rskNumber?: string; unit: string };
export type CatalogueMatch = {
  /** Indexes into `rows` of the rows that are the wholesaler's articles. */
  matched: number[];
  /** The running number (WholesaleArticle.seq) of the article each matched row prices – the same order as `matched`. */
  seqs: number[];
  notInCatalogue: number;
  unitDiffers: number;
};

const unitKey = (unit: string) => tradeUnit(unit || "st").toLowerCase();

/**
 * Which rows of a batch are the wholesaler's articles in the shared register (indexes into `rows`, with the running number of
 * the article each one prices): a row matches on the wholesaler's own article number exactly, or on the E-nummer (the file's
 * E-nummer column, or a seven-digit article number as Solar's files write it) when the unit is the same. The same E-nummer with
 * another unit is told apart ("unitDiffers") and never guessed; a row with no article at all is "notInCatalogue". Only this
 * wholesaler's rows are read, so another wholesaler's article never gets a row. Should the register hold several rows with the
 * same E-nummer and unit, the lowest running number is the article – the same file always lands on the same one.
 */
export async function matchAgainstCatalogue(tx: Pick<Prisma.TransactionClient, "$queryRaw">, wholesaler: WholesalerId, rows: readonly MatchRow[]): Promise<CatalogueMatch> {
  const eOf = (row: MatchRow) => {
    const e = digitsOf(row.eNumber);
    if (/^\d{7}$/.test(e)) return e;
    const no = digitsOf(row.articleNo);
    return /^\d{7}$/.test(no) && no === row.articleNo.trim() ? no : "";
  };
  const numbers = [...new Set(rows.map((row) => row.articleNo.trim()).filter(Boolean))];
  const eNumbers = [...new Set(rows.map(eOf).filter(Boolean))];
  const found = await tx.$queryRaw<{ seq: number; articleNo: string; eNumber: string; unit: string }[]>`
    SELECT "seq", "articleNo", "eNumber", "unit" FROM "WholesaleArticle"
    WHERE "wholesaler" = ${wholesaler} AND "pendingRun" IS NULL AND "status" <> '40'
      AND ("articleNo" = ANY(${numbers}::text[]) OR "eNumber" = ANY(${eNumbers}::text[]))`;
  const seqByNumber = new Map(found.map((item) => [item.articleNo, Number(item.seq)]));
  // Per E-nummer and unit the article's running number (the lowest when the register has several).
  const seqByE = new Map<string, Map<string, number>>();
  for (const item of found) {
    if (!item.eNumber) continue;
    const units = seqByE.get(item.eNumber) ?? new Map<string, number>();
    const unit = unitKey(item.unit);
    const seq = Number(item.seq);
    if (!units.has(unit) || seq < units.get(unit)!) units.set(unit, seq);
    seqByE.set(item.eNumber, units);
  }
  const matched: number[] = [];
  const seqs: number[] = [];
  let notInCatalogue = 0;
  let unitDiffers = 0;
  rows.forEach((row, index) => {
    const exact = seqByNumber.get(row.articleNo.trim());
    if (exact !== undefined) { matched.push(index); seqs.push(exact); return; }
    const e = eOf(row);
    const units = e ? seqByE.get(e) : undefined;
    if (!units) { notInCatalogue += 1; return; }
    const seq = units.get(unitKey(row.unit));
    if (seq === undefined) { unitDiffers += 1; return; }
    matched.push(index);
    seqs.push(seq);
  });
  return { matched, seqs, notInCatalogue, unitDiffers };
}
