import { WHOLESALERS, type WholesalerId } from "@/lib/wholesale/model";

/**
 * Priser direkt mot grossistens katalogartikel (2026-10-17, alternativ C i docs/proposals/priser-mot-katalogartikel-2026-10-17.md).
 * The pure rules shared by the write path (import), the read path (search, price in force, "bekräftad", "saknas") and the
 * lists, so they never disagree about the types, the bit list or the key. No database here.
 *
 * - `WholesaleArticle.seq` is a running number that is never reused; a company's price row points at the article with it.
 * - `WholesaleImportSeen.seen` is a bit list over `seq`: **byte `seq >> 3`, bit `seq & 7` counted from the least significant
 *   bit** – exactly Postgres' `get_bit(seen, seq)` / `set_bit` on a bytea, so SQL may read the list directly
 *   (`get_bit(s."seen", w."seq") = 1`). Bit 0 is never used (the first number is 1). A seq beyond the list is "not seen".
 * - A bit list is written once, when the import has finished, and never changed.
 */

/** What a price row holds that the file says about the article besides the price (all "" when the file has none). */
export type WholesalePriceExtras = {
  discountGroup: string;
  packageSize: string;
  orderMultiple: string;
  minOrderQuantity: string;
  stocked: string;
  status: string;
};
export const EMPTY_PRICE_EXTRAS: WholesalePriceExtras = { discountGroup: "", packageSize: "", orderMultiple: "", minOrderQuantity: "", stocked: "", status: "" };

/** A company's price on a wholesale article, as the rows hold it (the supplier is the import's). */
export type WholesalePriceRow = WholesalePriceExtras & {
  id: string;
  importId: string;
  seq: number;
  amount: string;
  perQuantity: number;
  unitPrice: string;
  currency: string;
  priceKind: "NET" | "BASE";
  priceDate: string;
  sourceFileName: string;
  createdAt: string;
};

/** The wholesaler's article as the register holds it – the part a price row and a hit need; never a price. */
export type WholesaleArticleRef = { seq: number; wholesaler: WholesalerId; articleNo: string };

/** The bit list of the articles a file had, from their running numbers (any order, duplicates allowed). */
export function seenFromSeqs(seqs: Iterable<number>): Uint8Array<ArrayBuffer> {
  let top = 0;
  const list = Array.isArray(seqs) ? seqs : [...seqs];
  for (const seq of list) {
    if (!Number.isInteger(seq) || seq < 1) throw new Error(`A running number is a whole number from 1: ${seq}`);
    if (seq > top) top = seq;
  }
  const bits = new Uint8Array(top ? (top >> 3) + 1 : 0);
  for (const seq of list) bits[seq >> 3] |= 1 << (seq & 7);
  return bits;
}

/** Whether the file had the article with this running number; false for a number beyond the list or an invalid one. */
export function seenHas(seen: Uint8Array | null | undefined, seq: number): boolean {
  if (!seen || !Number.isInteger(seq) || seq < 1) return false;
  const byte = seq >> 3;
  return byte < seen.length && ((seen[byte] >> (seq & 7)) & 1) === 1;
}

const POPCOUNT = Array.from({ length: 256 }, (_, value) => { let n = 0; for (let v = value; v; v >>= 1) n += v & 1; return n; });

/** How many articles the bit list holds. */
export function seenCount(seen: Uint8Array | null | undefined): number {
  let total = 0;
  for (const byte of seen ?? []) total += POPCOUNT[byte];
  return total;
}

/** The running numbers in the bit list, in ascending order. */
export function seenSeqs(seen: Uint8Array | null | undefined): number[] {
  const found: number[] = [];
  if (!seen) return found;
  for (let byte = 0; byte < seen.length; byte += 1) {
    if (!seen[byte]) continue;
    for (let bit = 0; bit < 8; bit += 1) if ((seen[byte] >> bit) & 1) found.push(byte * 8 + bit);
  }
  return found;
}

/**
 * The key of a wholesaler's article without a common number, for favourites and article lists: `W:<wholesaler>:<article number>`.
 * Null when the article number would not fit (the database's CHECK allows at most 120 characters after the colon).
 */
export function wholesaleRefKey(wholesaler: WholesalerId, articleNo: string): string | null {
  const number = articleNo.trim();
  return number && `${wholesaler}:${number}`.length <= 120 ? `W:${wholesaler}:${number}` : null;
}

/** "W:solar:0123456789" → { wholesaler: "solar", articleNo: "0123456789" }; null for any other form or an unknown wholesaler. */
export function parseWholesaleRefKey(key: string | null | undefined): { wholesaler: WholesalerId; articleNo: string } | null {
  const match = /^W:([a-z]+):(.{1,100})$/.exec(key ?? "");
  if (!match || !(WHOLESALERS as readonly string[]).includes(match[1])) return null;
  return { wholesaler: match[1] as WholesalerId, articleNo: match[2] };
}
