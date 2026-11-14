import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { ApiError } from "@/lib/kfid/errors";
import { requireCatalogue, type CatalogueCaller } from "@/lib/catalogue/access";
import { hitsForRows } from "@/lib/catalogue/search";
import { hitsForRegisterArticles, hitsForRegisterKeys } from "@/lib/catalogue/register-rows";
import { canSeePrices } from "@/lib/workflow/material-prices";
import { pickOffer, type CatalogueHit } from "@/lib/catalogue/snapshot";
import {
  ARTICLE_LIST_LIMITS, articleListInputSchema, articleListLineInputSchema, articleListLinesSaveSchema, articleListTotal, articleRefKey, canEditArticleList, externalRefKey, parseRefKey,
  productRefKey, quantityText, readRefSnapshot, refSnapshotSchema, registerArticleRefKey, rowOfListLine, rowOfResolved, snapshotOfHit, wholesaleIdentity,
  type ArticleListLineView, type ArticleListSummary, type ArticleListView, type ArticleRefInput, type ArticleRowAdd, type CatalogueFavoriteView, type RefSnapshot, type ResolvedArticle,
} from "@/lib/catalogue/lists";
import { z } from "zod";

/**
 * Favoriter och artikellistor on the server (2026-10-16, docs/artikellistor.md). Every query is bound to the
 * caller's company (a favourite also to the person); a list line points at its list through [listId, organizationId].
 * Who may: everyone who may pick articles (catalogue "pick" – the same as the article search) sees and uses the company's
 * lists and keeps favourites of their own; a list is changed or removed by the one who made it and by an admin. Someone
 * who may not see prices gets every hit without a price (the server prices a picked article when the document is saved).
 * Cloud only. These functions are the interface other modules use (project templates, rounds, AI tools): they take a
 * caller, never trust a key from the browser, and answer the shapes in lib/catalogue/lists.ts.
 *
 * Priser mot grossistens katalogartikel (2026-10-17): a wholesaler's article without a common number is a "W:" key, one with an
 * E-nummer or EAN keeps "E:" / "GTIN:"; both are read from the shared register with the company's price rows on it
 * (lib/catalogue/register-rows.ts), next to the company's own suppliers' articles – never another company's price. The rows of the company's own files
 * for a wholesaler without a catalogue (2026-11-01) answer to the same keys, so a favourite survives when the catalogue comes.
 */
export type ArticleListCaller = CatalogueCaller;

export function requireArticleLists(caller: Pick<ArticleListCaller, "admin" | "permissions" | "storageMode">) {
  requireCatalogue(caller, "pick");
}

type Db = Prisma.TransactionClient | typeof prisma;

const withoutPrices = (hit: CatalogueHit): CatalogueHit => ({ ...hit, price: null, priceHidden: true, ...(hit.offers ? { offers: hit.offers.map((offer) => ({ ...offer, price: null })) } : {}) });

type Resolution = { hit: CatalogueHit | null; productId: string | null; articleId: string | null };

/** The register's hits for product keys, a hundred keys at a time (the register's lookup returns at most 500 rows). */
async function registerHitsOfKeys(organizationId: string, keys: readonly string[]): Promise<Map<string, CatalogueHit>> {
  const hits = new Map<string, CatalogueHit>();
  for (let from = 0; from < keys.length; from += 100) for (const [key, hit] of await hitsForRegisterKeys(organizationId, keys.slice(from, from + 100))) hits.set(key, hit);
  return hits;
}

/** "solar:2000000001" (a W key without its "W:") → the wholesaler and its own article number. */
const wholesaleRefOf = (value: string) => ({ wholesaler: value.slice(0, value.indexOf(":")), articleNo: value.slice(value.indexOf(":") + 1) });

/**
 * A wholesaler's article found by its own number (a "W:" key) takes the first supplier's offer; a favourite or a list line shows what the
 * article search shows by name instead – the lowest comparable net price of the company's suppliers of that wholesaler.
 */
function lowestOffer(hit: CatalogueHit | null): CatalogueHit | null {
  if (!hit?.offers || hit.offers.length < 2) return hit;
  const primary = pickOffer(hit.offers, { matched: hit.id, exact: false });
  return primary.id === hit.id ? hit : { ...hit, ...primary, ...(primary.catalogOnly ? {} : { catalogOnly: undefined }), offers: hit.offers };
}

/**
 * A product's hit with the wholesalers' catalogue articles of the same product beside it (2026-10-17): the company's own offers
 * (its own suppliers' price files) and the register's rows with the company's price rows on them – or, with no price of the company, the
 * wholesaler's unpriced row. A register row an own offer already stands for is not shown twice; the offer the hit takes is chosen again
 * among all, as the search chooses it. Without a hit of its own the register's hit is the answer.
 */
function mergeRegisterHit(own: CatalogueHit | null, register: CatalogueHit | undefined): CatalogueHit | null {
  if (!register) return own;
  if (!own) return register;
  const known = own.offers ?? [own];
  const standsFor = (offer: CatalogueHit) => known.some((item) => item.id === offer.id || (offer.catalogOnly && item.catalog && offer.catalog && item.catalog.wholesaler === offer.catalog.wholesaler && item.catalog.articleNo === offer.catalog.articleNo));
  const added = (register.offers ?? [register]).filter((offer) => !standsFor(offer));
  if (!added.length) return own;
  const offers = [...known, ...added];
  const primary = pickOffer(offers, { matched: own.id, exact: false });
  const product = own.product ?? register.product;
  const common = own.common ?? register.common;
  return { ...primary, ...(product ? { product } : {}), ...(own.productId ? { productId: own.productId } : {}), ...(common ? { common } : {}), ...(own.supplierOnly !== undefined ? { supplierOnly: own.supplierOnly } : {}), offers };
}

/**
 * The register's hit today for each key, within the company: a product key by the product with that key (a GTIN key also
 * by a product known by that GTIN), an "A:" key by the supplier's article (its product's offers beside it). A "W:" key is a wholesaler's
 * catalogue article without a common number: the register's article with the company's price rows on it, or without a price when the
 * company has none (lib/catalogue/register-rows.ts). A product key ("E:", "GTIN:", "MPN:") is also looked up in the wholesalers' register,
 * so a favourite of a product only a wholesaler's price list has still shows the company's price. A key that the register no longer has
 * resolves to no hit.
 */
export async function resolveArticleKeys(organizationId: string, keys: readonly string[], options: { prices: boolean }): Promise<Map<string, Resolution>> {
  const refs = [...new Set(keys)].map((key) => ({ key, ref: parseRefKey(key) })).filter((item): item is { key: string; ref: NonNullable<ReturnType<typeof parseRefKey>> } => Boolean(item.ref));
  const productRefs = refs.filter((item) => item.ref.kind !== "A" && item.ref.kind !== "W");
  const articleIds = refs.filter((item) => item.ref.kind === "A").map((item) => item.ref.value);
  const wholesaleRefs = refs.filter((item) => item.ref.kind === "W");
  const products = productRefs.length ? await prisma.catalogueProduct.findMany({ where: { organizationId, OR: productRefs.map((item) => ({ numberKind: item.ref.kind, number: item.ref.value })) }, select: { id: true, numberKind: true, number: true } }) : [];
  const productOfKey = new Map(products.map((product) => [`${product.numberKind}:${product.number}`, product.id]));
  // A GTIN that is not a product's own key may still be the GTIN a product is known by (a file with E-nummer and EAN).
  const gtins = productRefs.filter((item) => item.ref.kind === "GTIN" && !productOfKey.has(item.key)).map((item) => item.ref.value);
  if (gtins.length) for (const product of await prisma.catalogueProduct.findMany({ where: { organizationId, gtin: { in: gtins } }, orderBy: { createdAt: "asc" }, select: { id: true, gtin: true } }))
    if (!productOfKey.has(`GTIN:${product.gtin}`)) productOfKey.set(`GTIN:${product.gtin}`, product.id);
  const productIds = [...new Set(productOfKey.values())];
  const [representatives, articles, registerHits, wholesaleHits] = await Promise.all([
    productIds.length ? prisma.catalogueArticle.findMany({ where: { organizationId, productId: { in: productIds } }, distinct: ["productId"], orderBy: [{ productId: "asc" }, { id: "asc" }], select: { id: true, productId: true } }) : [],
    articleIds.length ? prisma.catalogueArticle.findMany({ where: { organizationId, id: { in: articleIds } }, select: { id: true, productId: true } }) : [],
    registerHitsOfKeys(organizationId, productRefs.map((item) => item.key)),
    wholesaleRefs.length ? hitsForRegisterArticles(organizationId, wholesaleRefs.map((item) => wholesaleRefOf(item.ref.value))) : [],
  ]);
  const rows = [
    ...representatives.map((row) => ({ id: row.id, productId: row.productId, anyOffer: true })),
    ...articles.map((row) => ({ id: row.id, productId: row.productId, exact: true })),
  ];
  const hits = rows.length ? await hitsForRows(organizationId, rows) : [];
  // Prices are hidden last: a product's own offers and the wholesalers' are compared first.
  const shown = (hit: CatalogueHit | null) => (hit && !options.prices && !hit.catalogOnly ? withoutPrices(hit) : hit);
  const byProduct = new Map(representatives.map((row, index) => [row.productId!, hits[index] ?? null]));
  const byArticle = new Map(articles.map((row, index) => [row.id, { hit: hits[representatives.length + index] ?? null, productId: row.productId }]));
  const answer = new Map<string, Resolution>();
  for (const { key, ref } of refs) {
    if (ref.kind === "A") {
      const found = byArticle.get(ref.value);
      answer.set(key, { hit: shown(found?.hit ?? null), productId: found?.hit ? found.productId : null, articleId: found?.hit ? ref.value : null });
    } else if (ref.kind === "W") {
      const hit = shown(lowestOffer(wholesaleHits[wholesaleRefs.findIndex((item) => item.key === key)] ?? null));
      answer.set(key, { hit, productId: null, articleId: hit?.id ?? null });
    } else {
      const productId = productOfKey.get(key) ?? null;
      const own = productId ? byProduct.get(productId) ?? null : null;
      const hit = shown(mergeRegisterHit(own, registerHits.get(key)));
      // A product only a wholesaler's register has is pointed at by the hit's own id (a star, "Lägg i lista").
      answer.set(key, { hit, productId: own ? productId : null, articleId: hit && !own ? hit.id : null });
    }
  }
  return answer;
}

/**
 * The key and snapshot of what the client marks: the register's product (or the product of a marked article), a supplier's
 * own article, a wholesaler's catalogue article (by its numbers, or by the id of the hit the search gave it) or Solar's catalogue
 * product by its numbers – the company's own product with the same key when a price file has brought it. The browser's snapshot is
 * used only for a product the register does not have, and never holds a price.
 */
export async function articleRefOf(organizationId: string, input: ArticleRefInput, snapshot: unknown): Promise<{ key: string; snapshot: RefSnapshot }> {
  const fromRegister = async (key: string) => (await resolveArticleKeys(organizationId, [key], { prices: false })).get(key)?.hit ?? null;
  // A wholesaler's catalogue article (2026-10-17): its common number's key when it has one, otherwise "W:<wholesaler>:<number>".
  const wholesaleRef = async (ref: { wholesaler: string; articleNo: string }) => {
    const [hit] = await hitsForRegisterArticles(organizationId, [ref]);
    // A row of the company's own file with no article in the register (2026-11-01) has the same key: the wholesaler and its number.
    const key = hit ? registerArticleRefKey({ wholesaler: hit.catalog?.wholesaler ?? ref.wholesaler, articleNo: hit.catalog?.articleNo ?? ref.articleNo, eNumber: hit.eNumber, gtin: hit.gtin }) : null;
    return hit && key ? { key, snapshot: snapshotOfHit(hit, hit.catalogOnly ? "solar" : "register") } : null;
  };
  if ("wholesaler" in input) {
    const found = await wholesaleRef(input);
    if (!found) throw new ApiError(404, "Artikeln finns inte i katalogen.");
    return found;
  }
  if ("productId" in input || "articleId" in input) {
    const article = "articleId" in input ? await prisma.catalogueArticle.findFirst({ where: { id: input.articleId, organizationId }, select: { id: true, productId: true } }) : null;
    if ("articleId" in input && !article) {
      // Not a supplier's own article: perhaps a wholesaler's catalogue article, by the id the search gave it.
      const identity = wholesaleIdentity(input.articleId);
      const found = identity ? await wholesaleRef(wholesaleRefOf(identity)) : null;
      if (!found) throw new ApiError(404, "Artikeln finns inte i ert register.");
      return found;
    }
    const productId = "productId" in input ? input.productId : article?.productId ?? null;
    let key: string | null = null;
    if (productId) {
      const product = await prisma.catalogueProduct.findFirst({ where: { id: productId, organizationId }, select: { numberKind: true, number: true } });
      if (!product) throw new ApiError(404, "Produkten finns inte i ert register.");
      key = productRefKey(product);
    } else if (article) key = articleRefKey(article.id);
    if (!key) throw new ApiError(400, "Artikeln kan inte sparas.");
    const hit = await fromRegister(key);
    if (!hit) throw new ApiError(404, "Artikeln finns inte i ert register.");
    return { key, snapshot: snapshotOfHit(hit) };
  }
  const key = externalRefKey(input);
  if (!key) throw new ApiError(400, "Varan saknar E-nummer och EAN.");
  const hit = await fromRegister(key);
  if (hit) return { key, snapshot: snapshotOfHit(hit, hit.catalogOnly ? "solar" : "register") };
  const parsed = refSnapshotSchema.safeParse(snapshot);
  if (!parsed.success) throw new ApiError(400, "Varans uppgifter saknas.");
  return { key, snapshot: { ...parsed.data, source: "solar", supplierName: "", eNumber: parsed.data.eNumber || (key.startsWith("E:") ? key.slice(2) : ""), gtin: parsed.data.gtin || (key.startsWith("GTIN:") ? key.slice(5) : "") } };
}

const resolvedOf = (key: string, snapshotValue: unknown, resolution: Resolution | undefined, fallbackName = ""): ResolvedArticle => {
  const snapshot = readRefSnapshot(snapshotValue) ?? refSnapshotSchema.parse({ name: fallbackName || "Artikel" });
  return { key, hit: resolution?.hit ?? null, snapshot, productId: resolution?.productId ?? null, articleId: resolution?.articleId ?? null };
};

// ---------- Favoriter: one person's own, within the company ----------

/** The person's favourites, newest first, each with today's hit (bounded). */
export async function listFavorites(caller: ArticleListCaller): Promise<CatalogueFavoriteView[]> {
  requireArticleLists(caller);
  const rows = await prisma.catalogueFavorite.findMany({ where: { organizationId: caller.organizationId, userId: caller.userId }, orderBy: [{ createdAt: "desc" }, { id: "desc" }], take: ARTICLE_LIST_LIMITS.favorites,
    select: { id: true, refKey: true, snapshot: true, createdAt: true } });
  const resolved = await resolveArticleKeys(caller.organizationId, rows.map((row) => row.refKey), { prices: canSeePrices(caller) });
  return rows.map((row) => ({ id: row.id, createdAt: row.createdAt.toISOString(), ...resolvedOf(row.refKey, row.snapshot, resolved.get(row.refKey)) }));
}

/** Marks an article as the person's favourite (once; marking it again changes nothing). */
export async function addFavorite(caller: ArticleListCaller, input: { ref: ArticleRefInput; snapshot?: unknown }): Promise<CatalogueFavoriteView> {
  requireArticleLists(caller);
  const { key, snapshot } = await articleRefOf(caller.organizationId, input.ref, input.snapshot);
  const where = { organizationId: caller.organizationId, userId: caller.userId };
  const existing = await prisma.catalogueFavorite.findFirst({ where: { ...where, refKey: key }, select: { id: true } });
  if (!existing && (await prisma.catalogueFavorite.count({ where })) >= ARTICLE_LIST_LIMITS.favorites)
    throw new ApiError(409, `Du har redan ${ARTICLE_LIST_LIMITS.favorites} favoriter. Ta bort någon först.`);
  try {
    if (!existing) await prisma.catalogueFavorite.create({ data: { ...where, refKey: key, snapshot: snapshot as Prisma.InputJsonValue } });
  } catch (error) {
    // Two taps at once: the other one made it.
    if (!(error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002")) throw error;
  }
  const row = await prisma.catalogueFavorite.findFirstOrThrow({ where: { ...where, refKey: key }, select: { id: true, refKey: true, snapshot: true, createdAt: true } });
  const resolved = await resolveArticleKeys(caller.organizationId, [key], { prices: canSeePrices(caller) });
  return { id: row.id, createdAt: row.createdAt.toISOString(), ...resolvedOf(row.refKey, row.snapshot, resolved.get(key)) };
}

/** Takes the mark away; another person's or another company's favourite is never touched. */
export async function removeFavorite(caller: ArticleListCaller, id: string): Promise<void> {
  requireArticleLists(caller);
  await prisma.catalogueFavorite.deleteMany({ where: { id, organizationId: caller.organizationId, userId: caller.userId } });
}

// ---------- Artikellistor: the company's, used by everyone who may pick articles ----------

async function names(ids: (string | null)[]) {
  const wanted = [...new Set(ids.filter((value): value is string => Boolean(value)))];
  if (!wanted.length) return new Map<string, string>();
  const users = await prisma.user.findMany({ where: { id: { in: wanted } }, select: { id: true, name: true, email: true } });
  return new Map(users.map((user) => [user.id, user.name || user.email || ""]));
}

/** The company's lists by name, with how many lines each has and whether the caller may change it (bounded). */
export async function listArticleLists(caller: ArticleListCaller): Promise<ArticleListSummary[]> {
  requireArticleLists(caller);
  const rows = await prisma.catalogueList.findMany({ where: { organizationId: caller.organizationId }, orderBy: [{ name: "asc" }, { id: "asc" }], take: ARTICLE_LIST_LIMITS.lists,
    select: { id: true, name: true, description: true, createdById: true, updatedAt: true, _count: { select: { lines: true } } } });
  const who = await names(rows.map((row) => row.createdById));
  return rows.map((row) => ({ id: row.id, name: row.name, description: row.description, lineCount: row._count.lines, createdByName: row.createdById ? who.get(row.createdById) ?? "" : "", updatedAt: row.updatedAt.toISOString(), canEdit: canEditArticleList(caller, row) }));
}

const listSelect = { id: true, name: true, description: true, createdById: true, revision: true, updatedAt: true,
  lines: { orderBy: [{ position: "asc" }, { id: "asc" }], select: { id: true, position: true, refKey: true, name: true, unit: true, quantity: true, snapshot: true } } } satisfies Prisma.CatalogueListSelect;

async function findList(db: Db, caller: ArticleListCaller, id: string) {
  const list = await db.catalogueList.findFirst({ where: { id, organizationId: caller.organizationId }, select: listSelect });
  if (!list) throw new ApiError(404, "Listan finns inte.");
  return list;
}

async function editableList(db: Db, caller: ArticleListCaller, id: string) {
  const list = await findList(db, caller, id);
  if (!canEditArticleList(caller, list)) throw new ApiError(403, "Bara den som skapade listan och en administratör kan ändra den.");
  return list;
}

/** One list with its lines, each article as the register has it today. */
export async function getArticleList(caller: ArticleListCaller, id: string): Promise<ArticleListView> {
  requireArticleLists(caller);
  const list = await findList(prisma, caller, id);
  const prices = canSeePrices(caller);
  const resolved = await resolveArticleKeys(caller.organizationId, list.lines.flatMap((line) => (line.refKey ? [line.refKey] : [])), { prices });
  const lines: ArticleListLineView[] = list.lines.map((line, index) => ({
    id: line.id, position: index, name: line.name, unit: line.unit, quantity: quantityText(Number(line.quantity.toString())),
    article: line.refKey ? resolvedOf(line.refKey, line.snapshot, resolved.get(line.refKey), line.name) : null,
  }));
  const who = await names([list.createdById]);
  return { id: list.id, name: list.name, description: list.description, lineCount: lines.length, createdByName: list.createdById ? who.get(list.createdById) ?? "" : "", updatedAt: list.updatedAt.toISOString(),
    canEdit: canEditArticleList(caller, list), revision: list.revision, lines, pricesHidden: !prices, total: articleListTotal(lines) };
}

/** The rows a document gets from the whole list (the interface for other modules: project templates, rounds, AI tools). */
export async function articleListRows(caller: ArticleListCaller, id: string, newId: () => string = () => crypto.randomUUID()): Promise<ArticleRowAdd[]> {
  const list = await getArticleList(caller, id);
  return list.lines.map((line) => rowOfListLine(line, newId()));
}

/** The person's favourite as a row (the same shape as a list line). */
export const rowOfFavorite = (favorite: CatalogueFavoriteView, quantity: string, rowId: string) => rowOfResolved(favorite, quantity, rowId);

type NewLine = { refKey: string | null; name: string; unit: string; quantity: number; snapshot: RefSnapshot | null };

async function newLinesOf(caller: ArticleListCaller, inputs: unknown[]): Promise<NewLine[]> {
  const parsed = z.array(articleListLineInputSchema).max(ARTICLE_LIST_LIMITS.lines).parse(inputs);
  const lines: NewLine[] = [];
  for (const input of parsed) {
    if ("ref" in input) {
      const { key, snapshot } = await articleRefOf(caller.organizationId, input.ref, input.snapshot);
      lines.push({ refKey: key, name: snapshot.name, unit: snapshot.unit, quantity: input.quantity, snapshot });
    } else lines.push({ refKey: null, name: input.name, unit: input.unit, quantity: input.quantity, snapshot: null });
  }
  return lines;
}

/** A new list of the company, made by the caller, with any first lines. */
export async function createArticleList(caller: ArticleListCaller, input: unknown, lineInputs: unknown[] = []): Promise<ArticleListView> {
  requireArticleLists(caller);
  const data = articleListInputSchema.parse(input);
  const lines = await newLinesOf(caller, lineInputs);
  if ((await prisma.catalogueList.count({ where: { organizationId: caller.organizationId } })) >= ARTICLE_LIST_LIMITS.lists)
    throw new ApiError(409, `Företaget har redan ${ARTICLE_LIST_LIMITS.lists} listor. Ta bort någon först.`);
  const created = await prisma.catalogueList.create({ data: { organizationId: caller.organizationId, name: data.name, description: data.description, createdById: caller.userId, updatedById: caller.userId,
    // The line takes the company from the list (the composite key [listId, organizationId]).
    lines: { create: lines.map((line, index) => ({ position: index, refKey: line.refKey, name: line.name, unit: line.unit, quantity: line.quantity, ...(line.snapshot ? { snapshot: line.snapshot as Prisma.InputJsonValue } : {}) })) } }, select: { id: true } });
  return getArticleList(caller, created.id);
}

/**
 * Adds lines at the end of a list (Lägg i lista from a search hit). An article already in the list gets the quantity added
 * to its line instead of a second line.
 */
export async function addArticleListLines(caller: ArticleListCaller, id: string, lineInputs: unknown[]): Promise<ArticleListView> {
  requireArticleLists(caller);
  const lines = await newLinesOf(caller, lineInputs);
  await prisma.$transaction(async (tx) => {
    const list = await editableList(tx, caller, id);
    let position = list.lines.length;
    let count = list.lines.length;
    for (const line of lines) {
      const same = line.refKey ? list.lines.find((item) => item.refKey === line.refKey) : undefined;
      if (same) { await tx.catalogueListLine.updateMany({ where: { id: same.id, organizationId: caller.organizationId }, data: { quantity: { increment: line.quantity } } }); continue; }
      if (count >= ARTICLE_LIST_LIMITS.lines) throw new ApiError(409, `En lista har högst ${ARTICLE_LIST_LIMITS.lines} rader.`);
      await tx.catalogueListLine.create({ data: { organizationId: caller.organizationId, listId: list.id, position: position++, refKey: line.refKey, name: line.name, unit: line.unit, quantity: line.quantity, ...(line.snapshot ? { snapshot: line.snapshot as Prisma.InputJsonValue } : {}) } });
      count += 1;
    }
    await tx.catalogueList.updateMany({ where: { id: list.id, organizationId: caller.organizationId }, data: { revision: { increment: 1 }, updatedById: caller.userId } });
  });
  return getArticleList(caller, id);
}

/**
 * Saves a list: its name and description, and – when given – its lines as they now stand (order, quantities, free text;
 * a line left out is removed). `revision` is the one read: someone else's change in between is never overwritten.
 */
export async function updateArticleList(caller: ArticleListCaller, id: string, revision: number, input: { name?: unknown; description?: unknown; lines?: unknown }): Promise<ArticleListView> {
  requireArticleLists(caller);
  const lines = input.lines === undefined ? null : articleListLinesSaveSchema.parse(input.lines);
  await prisma.$transaction(async (tx) => {
    const list = await editableList(tx, caller, id);
    const data = articleListInputSchema.parse({ name: input.name ?? list.name, description: input.description ?? list.description });
    const bumped = await tx.catalogueList.updateMany({ where: { id: list.id, organizationId: caller.organizationId, revision }, data: { name: data.name, description: data.description, revision: { increment: 1 }, updatedById: caller.userId } });
    if (!bumped.count) throw new ApiError(409, "Listan har ändrats av någon annan. Läs in den igen.");
    if (!lines) return;
    const known = new Map(list.lines.map((line) => [line.id, line]));
    for (const line of lines) if (line.id && !known.has(line.id)) throw new ApiError(404, "En rad finns inte i listan.");
    const kept = new Set(lines.flatMap((line) => (line.id ? [line.id] : [])));
    await tx.catalogueListLine.deleteMany({ where: { organizationId: caller.organizationId, listId: list.id, id: { notIn: [...kept] } } });
    for (const [position, line] of lines.entries()) {
      const before = line.id ? known.get(line.id) : undefined;
      if (before) {
        // A free-text line may get new words; an article's line keeps the article's own.
        const text = before.refKey ? {} : { ...(line.name ? { name: line.name } : {}), ...(line.unit !== undefined ? { unit: line.unit } : {}) };
        await tx.catalogueListLine.updateMany({ where: { id: before.id, organizationId: caller.organizationId }, data: { position, quantity: line.quantity, ...text } });
      } else {
        if (!line.name) throw new ApiError(400, "Skriv radens text.");
        await tx.catalogueListLine.create({ data: { organizationId: caller.organizationId, listId: list.id, position, refKey: null, name: line.name, unit: line.unit ?? "", quantity: line.quantity } });
      }
    }
  });
  return getArticleList(caller, id);
}

/** Removes a list with its lines (the one who made it, or an admin). */
export async function deleteArticleList(caller: ArticleListCaller, id: string): Promise<void> {
  requireArticleLists(caller);
  await prisma.$transaction(async (tx) => {
    const list = await editableList(tx, caller, id);
    await tx.catalogueList.deleteMany({ where: { id: list.id, organizationId: caller.organizationId } });
  });
}
