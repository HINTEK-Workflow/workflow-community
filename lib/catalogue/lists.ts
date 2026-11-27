import { z } from "zod";
import { gtinOf } from "@/lib/catalogue/normalize";
import { productInfoSchema, type ProductInfo } from "@/lib/catalogue/product-info";
import { applyArticle, type CatalogueHit } from "@/lib/catalogue/snapshot";
import { parseWholesaleRefKey, wholesaleRefKey } from "@/lib/catalogue/wholesale-model";
import { WHOLESALERS, WHOLESALER_LABELS } from "@/lib/wholesale/model";
import { formatPrice, parseAmount, type MaterialRow } from "@/lib/workflow/expenses";

/**
 * Favoriter och artikellistor (2026-10-16: "Förbättra sidan artikelsök så det går skapa listor och favoriter, för
 * senare koppling mot andra moduler", docs/artikellistor.md). The pure rules, so the server, the article search, and later
 * project templates, rounds or an AI tool read a favourite and a list the same way.
 *
 * An article is pointed at by its **key**, never by a foreign key into the register:
 * - a product of the company's register by the product's own key – "E:1234567", "RSK:1234567", "GTIN:<14 digits>" or
 *   "MPN:<maker:number>" (the key the import resolves products on, lib/catalogue/normalize.ts productKeyOf);
 * - a supplier's own article without a common number by "A:<articleId>" (the article keeps its id through every new price
 *   file of the supplier: the import matches on supplier + article number);
 * - a wholesaler's catalogue article without a common number by "W:<wholesaler>:<article number>" (2026-10-17, priser
 *   direkt mot grossistens katalogartikel): the company's price on it is read from its price rows on the register's article.
 *   A wholesaler's article WITH an E-nummer or EAN keeps "E:" / "GTIN:", so the key is the same whether the company has a
 *   price on it or not;
 * - a product of Solar's catalogue (no price file has it) by "E:<E-nummer>" or "GTIN:<EAN>" – the same key the product
 *   gets once a price file brings it, so the favourite then shows the company's price.
 * The key is resolved on every read, so a favourite or a list line always shows today's price in force; a snapshot of the
 * name, unit and numbers (never a price) is kept for when the article is no longer in the register.
 */
export const ARTICLE_REF_KINDS = ["E", "RSK", "GTIN", "MPN", "A", "W"] as const;
export type ArticleRefKind = (typeof ARTICLE_REF_KINDS)[number];
/** For a "W" key the value is "<wholesaler>:<article number>" (the key without its "W:"). */
export type ArticleRef = { kind: ArticleRefKind; value: string };

/** Bounds (one company, one person): what a list or the favourites may hold, and how many lists a company may have. */
export const ARTICLE_LIST_LIMITS = { lists: 200, lines: 200, favorites: 300, name: 120, description: 1000 } as const;

const REF_KEY = /^(E|RSK|GTIN|MPN|A|W):(.{1,120})$/;

/** "E:1234567" → { kind: "E", value: "1234567" }; null when the key has another form (the database's CHECK says the same). */
export function parseRefKey(key: string | null | undefined): ArticleRef | null {
  const match = REF_KEY.exec(key ?? "");
  if (!match) return null;
  const kind = match[1] as ArticleRefKind;
  const value = match[2];
  if ((kind === "E" || kind === "RSK") && !/^\d{7}$/.test(value)) return null;
  if (kind === "GTIN" && !/^\d{14}$/.test(value)) return null;
  // A wholesaler's article: a known wholesaler and a number (the same check as the register's key, wholesale-model.ts).
  if (kind === "W" && !parseWholesaleRefKey(key)) return null;
  return { kind, value };
}

export const refKeyText = (ref: ArticleRef) => `${ref.kind}:${ref.value}`;

/** The key of a product of the register, from its own numberKind and number. */
export function productRefKey(product: { numberKind: string; number: string }): string | null {
  const key = `${product.numberKind}:${product.number}`;
  return parseRefKey(key) ? key : null;
}

/** The key of a supplier's own article. */
export const articleRefKey = (articleId: string) => `A:${articleId}`;

/** The key of a product of Solar's catalogue: its E-nummer (seven digits), otherwise its EAN; null when it has neither. */
export function externalRefKey(product: { eNumber?: string; gtin?: string }): string | null {
  const e = (product.eNumber ?? "").replace(/\D/g, "");
  if (/^\d{7}$/.test(e)) return `E:${e}`;
  const gtin = gtinOf(product.gtin ?? "");
  return gtin ? `GTIN:${gtin}` : null;
}

/**
 * The key of a wholesaler's catalogue article (2026-10-17): "E:" / "GTIN:" when it has a common number, as a product of
 * Solar's catalogue always had, otherwise "W:<wholesaler>:<article number>". Null only when the article number is too long.
 */
export function registerArticleRefKey(article: { wholesaler: string; articleNo: string; eNumber?: string; gtin?: string }): string | null {
  const common = externalRefKey(article);
  if (common) return common;
  return (WHOLESALERS as readonly string[]).includes(article.wholesaler) ? wholesaleRefKey(article.wholesaler as (typeof WHOLESALERS)[number], article.articleNo) : null;
}

/**
 * "solar:2000000001" for anything that names a wholesaler's article: the favourite key ("W:solar:2000000001"), the register's
 * own row ("solar:2000000001") and the company's offer on it, which has its supplier after the number
 * ("solar:2000000001:<supplier id>", lib/catalogue/register-hit.ts `wholesaleOfferId`). Null for any other id (a supplier's own
 * article, a product). Lets a star find its hit whichever of these forms the hit's id has.
 */
export function wholesaleIdentity(id: string | null | undefined): string | null {
  const match = /^(?:W:)?([a-z]+):(.{1,100}?)(?::[A-Za-z0-9_-]{8,64})?$/.exec(id ?? "");
  return match && (WHOLESALERS as readonly string[]).includes(match[1]) ? `${match[1]}:${match[2]}` : null;
}

/**
 * What the client says it marks or puts in a list: the register's product or article (the server finds its key, so a key
 * is never trusted from the browser), Solar's catalogue product by its numbers, or a wholesaler's catalogue article by the
 * wholesaler and its own article number (an article without E-nummer or EAN).
 */
const id = z.string().trim().min(1).max(100);
export const articleRefInputSchema = z.union([
  z.object({ productId: id }),
  z.object({ articleId: id }),
  z.object({ eNumber: z.string().trim().regex(/^\d{7}$/, "E-numret har sju siffror.").optional(), gtin: z.string().trim().max(20).optional() })
    .refine((value) => Boolean(value.eNumber || gtinOf(value.gtin ?? "")), "Varan saknar E-nummer och EAN."),
  z.object({ wholesaler: z.enum(WHOLESALERS), articleNo: z.string().trim().min(1).max(100) }),
]);
export type ArticleRefInput = z.output<typeof articleRefInputSchema>;

/** The name, unit and numbers of the article when it was marked: shown when it is no longer in the register. Never a price. */
const text = (max: number) => z.string().trim().max(max).default("");
export const refSnapshotSchema = z.object({
  name: z.string().trim().min(1).max(300),
  unit: text(40),
  supplierName: text(200),
  supplierArticleNo: text(60),
  eNumber: text(20),
  rskNumber: text(20),
  gtin: text(20),
  manufacturer: text(120),
  manufacturerArticleNo: text(60),
  /** Where it was found: the company's price files, or Solar's catalogue (no price file had it). */
  source: z.enum(["register", "solar"]).default("register"),
  product: productInfoSchema.nullable().default(null),
});
export type RefSnapshot = z.output<typeof refSnapshotSchema>;

/** The snapshot of a hit as it is marked (the offer the hit shows, its product facts). */
export function snapshotOfHit(hit: CatalogueHit, source: RefSnapshot["source"] = "register"): RefSnapshot {
  return refSnapshotSchema.parse({
    name: hit.name.slice(0, 300) || "Artikel", unit: hit.unit.slice(0, 40), supplierName: source === "solar" ? "" : hit.supplierName.slice(0, 200), supplierArticleNo: hit.supplierArticleNo.slice(0, 60),
    eNumber: hit.eNumber.slice(0, 20), rskNumber: (hit.rskNumber ?? "").slice(0, 20), gtin: (hit.gtin ?? "").slice(0, 20), manufacturer: (hit.manufacturer ?? "").slice(0, 120),
    manufacturerArticleNo: (hit.manufacturerArticleNo ?? "").slice(0, 60), source, product: hit.product ? productInfoSchema.parse(hit.product) : null,
  });
}

/** A stored snapshot read back; null when unreadable. */
export function readRefSnapshot(value: unknown): RefSnapshot | null {
  const parsed = refSnapshotSchema.safeParse(value);
  return parsed.success ? parsed.data : null;
}

/**
 * The snapshot as a hit a row can take, without a price: a product of Solar's catalogue, or an article that is no longer
 * in the register (the row then gets its name, unit and numbers, and the person writes the price).
 */
export function hitOfSnapshot(snapshot: RefSnapshot, key: string): CatalogueHit {
  return {
    id: `ref:${key}`.slice(0, 100), name: snapshot.name, unit: snapshot.unit, supplierArticleNo: snapshot.supplierArticleNo, eNumber: snapshot.eNumber,
    supplierName: snapshot.supplierName || (snapshot.source === "solar" ? "Solars katalog" : ""), manufacturerArticleNo: snapshot.manufacturerArticleNo,
    ...(snapshot.rskNumber ? { rskNumber: snapshot.rskNumber } : {}), ...(snapshot.gtin ? { gtin: snapshot.gtin } : {}), ...(snapshot.manufacturer ? { manufacturer: snapshot.manufacturer } : {}),
    ...(snapshot.product ? { product: snapshot.product as ProductInfo } : {}), price: null,
  };
}

/** A quantity as typed ("2", "2,5"): above zero and at most a million, otherwise null. */
export function listQuantity(value: string | number | undefined | null): number | null {
  const parsed = typeof value === "number" ? value : parseAmount(String(value ?? "").trim());
  return parsed !== null && Number.isFinite(parsed) && parsed > 0 && parsed <= 1_000_000 ? Math.round(parsed * 10000) / 10000 : null;
}
export const quantityText = (value: number) => formatPrice(value);

const quantitySchema = z.union([z.string(), z.number()]).transform((value, ctx) => {
  const parsed = listQuantity(value);
  if (parsed === null) { ctx.addIssue({ code: "custom", message: "Antalet måste vara större än 0." }); return z.NEVER; }
  return parsed;
});

export const articleListInputSchema = z.object({
  name: z.string().trim().min(1, "Skriv listans namn.").max(ARTICLE_LIST_LIMITS.name),
  description: z.string().trim().max(ARTICLE_LIST_LIMITS.description).default(""),
});
export type ArticleListInput = z.output<typeof articleListInputSchema>;

/** A new line: an article (as a favourite is pointed at, with its snapshot), or free text without an article. */
export const articleListLineInputSchema = z.union([
  z.object({ ref: articleRefInputSchema, quantity: quantitySchema.default(1), snapshot: z.unknown().optional() }),
  z.object({ name: z.string().trim().min(1, "Skriv radens text.").max(300), unit: z.string().trim().max(40).default(""), quantity: quantitySchema.default(1) }),
]);
export type ArticleListLineInput = z.output<typeof articleListLineInputSchema>;

/**
 * The lines as the list is saved (order, quantities, removed lines): every kept line by its id with its quantity (and, for
 * a free-text line, its text and unit); a line left out is removed; a line without an id is a new free-text line.
 */
export const articleListLinesSaveSchema = z.array(z.object({
  id: id.optional(), quantity: quantitySchema, name: z.string().trim().max(300).optional(), unit: z.string().trim().max(40).optional(),
})).max(ARTICLE_LIST_LIMITS.lines);
export type ArticleListLinesSave = z.output<typeof articleListLinesSaveSchema>;

/** Who may change or remove a list: the one who made it, and an admin. Everyone who may pick articles uses it. */
export const canEditArticleList = (caller: { userId: string; admin: boolean }, list: { createdById: string | null }) => caller.admin || (Boolean(list.createdById) && list.createdById === caller.userId);

// ---------- What the API answers (the interface other modules use) ----------

/** One favourite or one list line's article: its key, the register's hit for it today (null when no longer there), the snapshot. */
export type ResolvedArticle = {
  key: string;
  /** The register's product or article today, with every supplier's offer and the price in force (null price when hidden). */
  hit: CatalogueHit | null;
  snapshot: RefSnapshot;
  /** Where the key points now, so the search can show its star: the product's id, or the article's. */
  productId: string | null;
  articleId: string | null;
};
export type CatalogueFavoriteView = ResolvedArticle & { id: string; createdAt: string };

export type ArticleListLineView = {
  id: string; position: number; name: string; unit: string;
  /** "2,5" as shown and typed. */
  quantity: string;
  /** null for a free-text line. */
  article: ResolvedArticle | null;
};
export type ArticleListSummary = { id: string; name: string; description: string; lineCount: number; createdByName: string; updatedAt: string; canEdit: boolean };
export type ArticleListView = ArticleListSummary & { revision: number; lines: ArticleListLineView[]; pricesHidden: boolean;
  /** The sum of the lines' prices in force × quantity, and how many lines have no price (hidden, free text or not in the register). */
  total: { amount: number; unpriced: number } };

/** A row a document gets from a favourite or a list line (the same shape as "Lägg till" in the article search). */
export type ArticleRowAdd = { row: MaterialRow; supplierName: string; fromCatalogue: boolean };

/**
 * The row for a resolved article: the register's hit as today (applyArticle, the one way every row is made), or the
 * snapshot without a price when it is no longer in the register or comes from Solar's catalogue.
 */
export function rowOfResolved(article: ResolvedArticle, quantity: string, rowId: string): ArticleRowAdd {
  const hit = article.hit ?? hitOfSnapshot(article.snapshot, article.key);
  const row = applyArticle({ id: rowId, name: hit.name, quantity: quantity.trim() || "1", unit: hit.unit }, hit);
  // A wholesaler's article no price file of the company has (the register's, 2026-10-17) is added from the catalogue, as the
  // article search adds it: without a price, from the wholesaler's name.
  const fromRegister = Boolean(article.hit?.catalogOnly && article.hit.catalog);
  const supplierName = fromRegister ? WHOLESALER_LABELS[article.hit!.catalog!.wholesaler] : article.hit ? hit.supplierName : article.snapshot.source === "solar" ? "Solar" : article.snapshot.supplierName;
  return { row, supplierName, fromCatalogue: !article.hit || fromRegister };
}

/** The row for a list line: its article as above, or the free text with its quantity and unit. */
export function rowOfListLine(line: Pick<ArticleListLineView, "name" | "unit" | "quantity" | "article">, rowId: string): ArticleRowAdd {
  if (line.article) return rowOfResolved(line.article, line.quantity, rowId);
  return { row: { id: rowId, name: line.name, quantity: line.quantity || "1", unit: line.unit }, supplierName: "", fromCatalogue: false };
}

/** The list's total: price in force × quantity for every line with a price; the others counted. */
export function articleListTotal(lines: readonly Pick<ArticleListLineView, "quantity" | "article">[]): { amount: number; unpriced: number } {
  let amount = 0;
  let unpriced = 0;
  for (const line of lines) {
    const price = line.article?.hit?.price?.unitPrice;
    const quantity = listQuantity(line.quantity);
    if (price === undefined || price === null || quantity === null) { unpriced += 1; continue; }
    amount += price * quantity;
  }
  return { amount: Math.round(amount * 100) / 100, unpriced };
}

/** Lines moved: the line at `from` to `to` (both within the list), positions renumbered from 0. */
export function moveLine<T extends { position: number }>(lines: readonly T[], from: number, to: number): T[] {
  if (from < 0 || from >= lines.length || to < 0 || to >= lines.length || from === to) return lines.map((line, index) => ({ ...line, position: index }));
  const next = [...lines];
  const [moved] = next.splice(from, 1);
  next.splice(to, 0, moved);
  return next.map((line, index) => ({ ...line, position: index }));
}

/**
 * Whether a search hit (a product with its offers, or a supplier's article) is one of the favourites. A favourite of a
 * wholesaler's article (2026-10-17) is found by the wholesaler and article number whichever form the hit's id has
 * (`wholesaleIdentity`), and a favourite by a common number ("E:…", "GTIN:…") by the hit's own common number – a wholesaler's
 * article has no product of the company's to point at.
 */
export function hitIsFavorite(hit: Pick<CatalogueHit, "id" | "productId" | "offers"> & Partial<Pick<CatalogueHit, "common" | "catalog">>,
  favorites: readonly (Pick<ResolvedArticle, "productId" | "articleId"> & Partial<Pick<ResolvedArticle, "key">>)[]): boolean {
  const identities = new Set([hit.id, ...(hit.offers ?? []).map((offer) => offer.id)].flatMap((value) => wholesaleIdentity(value) ?? []));
  for (const info of [hit.catalog, ...(hit.offers ?? []).map((offer) => offer.catalog)]) if (info) identities.add(`${info.wholesaler}:${info.articleNo}`);
  return favorites.some((favorite) => {
    if (favorite.productId && favorite.productId === hit.productId) return true;
    if (favorite.articleId && (favorite.articleId === hit.id || (hit.offers ?? []).some((offer) => offer.id === favorite.articleId))) return true;
    if (!favorite.key) return false;
    const wholesale = favorite.key.startsWith("W:") ? wholesaleIdentity(favorite.key) : null;
    return Boolean(wholesale && identities.has(wholesale)) || Boolean(hit.common && !hit.productId && favorite.key === `${hit.common.kind}:${hit.common.number}`);
  });
}

/**
 * What the star sends for a search hit: the product when the hit is one, otherwise the supplier's article – or, for a
 * wholesaler's article (its id names the wholesaler and the article number), that: the server turns it into the article's key.
 */
export const refInputOfHit = (hit: Pick<CatalogueHit, "id" | "productId">): ArticleRefInput => (hit.productId ? { productId: hit.productId } : { articleId: hit.id });

/**
 * The key and the input of a register article no price file of the company has (a hit with `catalogOnly`): its E-nummer or EAN
 * as for any product of Solar's catalogue, otherwise the wholesaler and its own article number ("W:" key). Null when it has none.
 */
export function catalogRefOfHit(hit: Pick<CatalogueHit, "eNumber" | "gtin" | "catalog">): { key: string; ref: ArticleRefInput } | null {
  const key = externalRefKey(hit);
  if (key) return { key, ref: { eNumber: /^\d{7}$/.test(hit.eNumber) ? hit.eNumber : undefined, gtin: hit.gtin || undefined } as ArticleRefInput };
  const wholesaleKey = hit.catalog ? wholesaleRefKey(hit.catalog.wholesaler, hit.catalog.articleNo) : null;
  return wholesaleKey && hit.catalog ? { key: wholesaleKey, ref: { wholesaler: hit.catalog.wholesaler, articleNo: hit.catalog.articleNo } } : null;
}
