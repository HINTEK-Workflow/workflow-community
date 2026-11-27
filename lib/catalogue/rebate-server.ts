import { createHash, randomUUID } from "node:crypto";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { ApiError } from "@/lib/kfid/errors";
import type { CatalogueCaller } from "@/lib/catalogue/access";
import { articleKey, groupKey, netPriceOf, pickRebate, rebateCounts, type RebateKind, type RebateMatch, type RebateRead } from "@/lib/catalogue/rebate";
import { articleNoCore, digitsOf } from "@/lib/catalogue/normalize";
import { isWholesaleOfferId } from "@/lib/catalogue/register-hit";
import type { CatalogueOffer } from "@/lib/catalogue/snapshot";
import type { WholesalerId } from "@/lib/wholesale/model";

/**
 * Rabattbrev på servern (2026-10-14): a discount letter is imported as rules of one supplier (CatalogueRebate),
 * and the company's net price is computed from the base price when an article is searched, listed or priced. Only the
 * latest finished letter of a supplier applies; removing it (Ta bort under Importer) brings back the one before. Every
 * query is bound to the caller's company; a rule is linked to its import and supplier by composite keys.
 *
 * Priser mot katalogartikeln (2026-10-17, alternativ C): a company's price on a wholesaler's register article is a
 * price row on that article (WholesalePrice), not a copy of it. A rule is read against such an offer from what the offer
 * itself carries – the register article's number and E-nummer and the price row's discount group – instead of a row of the
 * company's catalogue (`RebateSubject`). The net price is still computed on read from the base price; nothing is stored, and a
 * discount letter is imported exactly as before (an import row of the kind REBATE with its rules, no prices). A row of the company's own file
 * for a wholesaler without a catalogue (lib/catalogue/file-prices.ts) has the same form of offer id and is read the same way.
 */
const BATCH = 5000;
const decimal = (value: Prisma.Decimal | number | null) => (value === null ? null : Number(value.toString()));
const isoDate = (value: Date) => value.toISOString().slice(0, 10);

/** What the search and the material row say about a net price computed from a discount letter. */
export type RebateInfo = { basePrice: number; percent: number; rule: RebateKind; fileName: string; date: string };

type RuleRow = { articleId: string; kind: RebateKind; key: string; percent: Prisma.Decimal; percent2: Prisma.Decimal; netPrice: Prisma.Decimal | null; fileName: string; createdAt: Date };

/**
 * An article a discount letter is read against that is not a row of the company's own catalogue (priser mot katalogartikeln,
 * 2026-10-17): the company's priced offer on a wholesaler's register article. `id` is the offer's id (the key of the
 * answer); the article number and E-nummer are the register article's (WholesaleArticle) and the discount group is the price
 * row's. The core, the E-nummer without leading zeros and the group without spaces are made here exactly as the database
 * makes them for a CatalogueArticle (lib/catalogue/normalize.ts, the trigger of the article search).
 */
export type RebateSubject = { id: string; supplierId: string; articleNo: string; eNumber: string; discountGroup: string };

/**
 * The rule that applies to each of the given articles (company-bound): the supplier's latest finished letter, the
 * article's net price, then its discount, then the longest group code its group starts with – the same order as
 * pickRebate in lib/catalogue/rebate.ts. The articles are rows of the company's catalogue (`articleIds`) and/or the company's
 * offers on a wholesaler's register articles (`subjects`).
 */
export async function rebateRulesFor(organizationId: string, articleIds: string[], subjects: readonly RebateSubject[] = []): Promise<Map<string, { match: RebateMatch; fileName: string; date: string }>> {
  const result = new Map<string, { match: RebateMatch; fileName: string; date: string }>();
  if (!articleIds.length && !subjects.length) return result;
  const rows = await prisma.$queryRaw<RuleRow[]>`
    WITH a AS (
      SELECT a."id", a."supplierId", a."articleNoCore" AS "core", ltrim(a."eNumber", '0') AS "e", upper(regexp_replace(a."discountGroup", '\\s', '', 'g')) AS "grp"
      FROM "CatalogueArticle" a WHERE a."organizationId" = ${organizationId} AND a."id" = ANY(${articleIds}::text[])
      UNION ALL
      SELECT u."id", u."supplierId", u."core", u."e", u."grp"
      FROM unnest(${subjects.map((item) => item.id)}::text[], ${subjects.map((item) => item.supplierId)}::text[], ${subjects.map((item) => articleNoCore(item.articleNo))}::text[],
        ${subjects.map((item) => digitsOf(item.eNumber).replace(/^0+/, ""))}::text[], ${subjects.map((item) => item.discountGroup.replace(/\s+/g, "").toUpperCase())}::text[]) AS u("id", "supplierId", "core", "e", "grp")),
    letter AS (
      SELECT DISTINCT ON (i."supplierId") i."supplierId", i."id", i."fileName", i."createdAt"
      FROM "CatalogueImport" i
      WHERE i."organizationId" = ${organizationId} AND i."kind" = 'REBATE' AND i."contentHash" <> '' AND i."supplierId" IN (SELECT "supplierId" FROM a)
      ORDER BY i."supplierId", i."createdAt" DESC, i."id" DESC)
    SELECT a."id" AS "articleId", r."kind", r."key", r."percent", r."percent2", r."netPrice", letter."fileName", letter."createdAt"
    FROM a JOIN letter ON letter."supplierId" = a."supplierId"
    JOIN LATERAL (
      SELECT r."kind", r."key", r."percent", r."percent2", r."netPrice" FROM "CatalogueRebate" r
      WHERE r."organizationId" = ${organizationId} AND r."importId" = letter."id" AND (
        (r."kind" IN ('NET', 'ARTICLE') AND r."key" IN (a."core", a."e") AND r."key" <> '')
        OR (r."kind" = 'GROUP' AND a."grp" <> '' AND r."key" IN (SELECT left(a."grp", n) FROM generate_series(1, length(a."grp")) AS n)))
      ORDER BY CASE r."kind" WHEN 'NET' THEN 0 WHEN 'ARTICLE' THEN 1 ELSE 2 END, length(r."key") DESC
      LIMIT 1) r ON true`;
  for (const row of rows) result.set(row.articleId, {
    match: { kind: row.kind, key: row.key, percent: decimal(row.percent) ?? 0, percent2: decimal(row.percent2) ?? 0, netPrice: decimal(row.netPrice) },
    fileName: row.fileName, date: isoDate(row.createdAt),
  });
  return result;
}

/**
 * The offers with the company's net price where a discount letter applies to a base price: the price becomes the net
 * price (no longer "grundpris"), with what it came from. An offer without a letter, or with a net price already, is
 * returned as it was.
 */
export async function withRebates<T extends CatalogueOffer>(organizationId: string, offers: T[]): Promise<T[]> {
  const based = offers.filter((offer) => offer.price?.priceKind === "BASE");
  if (!based.length) return offers;
  // An offer on a wholesaler's register article (priser mot katalogartikeln, 2026-10-17) carries what a rule needs itself; any other
  // offer is a row of the company's catalogue, read by its id.
  const subjects = new Map<string, RebateSubject>();
  const articleIds = new Set<string>();
  for (const offer of based) {
    if (!isWholesaleOfferId(offer.id)) articleIds.add(offer.id);
    else if (offer.supplierId) subjects.set(offer.id, { id: offer.id, supplierId: offer.supplierId, articleNo: offer.supplierArticleNo, eNumber: offer.eNumber, discountGroup: offer.discountGroup ?? "" });
  }
  const rules = await rebateRulesFor(organizationId, [...articleIds], [...subjects.values()]);
  if (!rules.size) return offers;
  return offers.map((offer) => {
    const rule = offer.price?.priceKind === "BASE" ? rules.get(offer.id) : undefined;
    if (!rule || !offer.price) return offer;
    const net = netPriceOf(offer.price.unitPrice, rule.match);
    if (!net) return offer;
    const { priceKind, amount, perQuantity, ...rest } = offer.price;
    void priceKind; void amount;
    return { ...offer, price: { ...rest, unitPrice: net.unitPrice, ...(perQuantity && perQuantity !== 1 ? { perQuantity, amount: Math.round(net.unitPrice * perQuantity * 100) / 100 } : {}),
      rebate: { basePrice: offer.price.unitPrice, percent: net.percent, rule: net.rule, fileName: rule.fileName, date: rule.date } } };
  });
}

export type RebatePreview = {
  format: { id: string; label: string; wholesaler: WholesalerId };
  counts: { groups: number; articles: number; netPrices: number };
  errorCount: number; errors: { line: number; message: string }[]; skipped: number;
  /** Per supplier id of the company: its articles, and how many of them a rule of this letter reaches. */
  coverage: Record<string, { articles: number; covered: number }>;
  /** A few of the supplier's articles with base price → net price, so the person sees that the scale is right. */
  examples: Record<string, { articleNo: string; name: string; unit: string; basePrice: number; netPrice: number; percent: number }[]>;
};

/** The preview of a discount letter: what it holds and how much of each matching supplier's list it reaches. Writes nothing. */
export async function previewRebate(read: RebateRead, reader: { organizationId: string } | null): Promise<RebatePreview> {
  const preview: RebatePreview = { format: { id: read.format.id, label: read.format.label, wholesaler: read.format.wholesaler }, counts: rebateCounts(read.rows),
    errorCount: read.errorCount, errors: read.errors.slice(0, 50), skipped: read.skipped, coverage: {}, examples: {} };
  if (!reader) return preview;
  const organizationId = reader.organizationId;
  const suppliers = await prisma.catalogueSupplier.findMany({ where: { organizationId, wholesaler: read.format.wholesaler }, select: { id: true }, take: 10 });
  if (!suppliers.length) return preview;
  const groups = [...new Set(read.rows.filter((row) => row.kind === "GROUP").map((row) => row.key))];
  const articles = [...new Set(read.rows.filter((row) => row.kind !== "GROUP").map((row) => row.key))];
  const counted = await prisma.$queryRaw<{ supplierId: string; articles: number; covered: number }[]>`
    WITH g AS MATERIALIZED (SELECT unnest(${groups}::text[]) AS "key"), k AS MATERIALIZED (SELECT unnest(${articles}::text[]) AS "key")
    SELECT a."supplierId", count(*)::int AS "articles",
      count(*) FILTER (WHERE a."articleNoCore" IN (SELECT "key" FROM k) OR (a."discountGroup" <> '' AND EXISTS (
        SELECT 1 FROM generate_series(1, length(a."discountGroup")) AS n WHERE left(upper(regexp_replace(a."discountGroup", '\\s', '', 'g')), n) IN (SELECT "key" FROM g))))::int AS "covered"
    FROM "CatalogueArticle" a
    WHERE a."organizationId" = ${organizationId} AND a."supplierId" = ANY(${suppliers.map((item) => item.id)}::text[])
    GROUP BY a."supplierId"`;
  for (const row of counted) preview.coverage[row.supplierId] = { articles: Number(row.articles), covered: Number(row.covered) };
  // The supplier's price rows on the wholesaler's register articles (priser mot katalogartikeln, 2026-10-17) count as its articles too.
  const groupKeys = new Set(groups);
  const articleKeys = new Set(articles);
  const reached = new Map<string, Awaited<ReturnType<typeof wholesaleReach>>>();
  for (const supplier of suppliers) {
    const reach = await wholesaleReach(organizationId, supplier.id, read, groupKeys, articleKeys);
    if (!reach.articles) continue;
    reached.set(supplier.id, reach);
    const before = preview.coverage[supplier.id] ?? { articles: 0, covered: 0 };
    preview.coverage[supplier.id] = { articles: before.articles + reach.articles, covered: before.covered + reach.covered };
  }
  // Three articles per supplier whose group has a rule, with their latest base price, computed like the search does.
  for (const supplier of suppliers) {
    const sample = await prisma.$queryRaw<{ articleNo: string; eNumber: string; name: string; unit: string; grp: string; unitPrice: Prisma.Decimal }[]>`
      SELECT a."supplierArticleNo" AS "articleNo", a."eNumber", a."name", a."unit", a."discountGroup" AS "grp", lp."unitPrice"
      FROM "CatalogueArticle" a
      JOIN LATERAL (SELECT p."unitPrice", p."priceKind" FROM "CataloguePrice" p WHERE p."organizationId" = ${organizationId} AND p."articleId" = a."id" ORDER BY (p."priceKind" = 'NET') DESC, p."createdAt" DESC, p."id" DESC LIMIT 1) lp ON lp."priceKind" = 'BASE' AND lp."unitPrice" > 0
      WHERE a."organizationId" = ${organizationId} AND a."supplierId" = ${supplier.id} AND upper(a."discountGroup") = ANY(${groups.slice(0, 2000)}::text[])
      ORDER BY a."id" LIMIT 3`;
    const list = sample.map((item) => {
      const match = pickRebate(read.rows, { articleNo: item.articleNo, eNumber: item.eNumber, group: item.grp });
      const net = match ? netPriceOf(Number(item.unitPrice.toString()), match) : null;
      return net ? { articleNo: item.articleNo || (item.eNumber ? `E ${item.eNumber}` : ""), name: item.name, unit: item.unit, basePrice: Number(item.unitPrice.toString()), netPrice: net.unitPrice, percent: net.percent } : null;
    }).filter((item): item is NonNullable<typeof item> => Boolean(item));
    const more = list.length < 3 ? (reached.get(supplier.id)?.examples ?? []).slice(0, 3 - list.length) : [];
    if (list.length || more.length) preview.examples[supplier.id] = [...list, ...more];
  }
  return preview;
}

/**
 * How a discount letter reaches the articles a supplier has a price on at the wholesaler's register (priser mot katalogartikeln,
 * 2026-10-17): the register articles with a price row of the supplier (the price in force of each), how many of them a
 * rule of the letter reaches – by the article number's core or the E-nummer, or by a group code the price row's discount group
 * starts with – and three examples with base price → net price. Company-bound; writes nothing.
 */
async function wholesaleReach(organizationId: string, supplierId: string, read: RebateRead, groupKeys: ReadonlySet<string>, articleKeys: ReadonlySet<string>) {
  type ReachRow = { discountGroup: string; priceKind: string; unitPrice: string; articleNo: string; eNumber: string; name: string; description: string; unit: string };
  const rows = await prisma.$queryRaw<ReachRow[]>`
    SELECT DISTINCT ON (p."seq") p."discountGroup", p."priceKind", p."unitPrice"::text AS "unitPrice", w."articleNo", w."eNumber", w."name", w."description", w."unit"
    FROM "WholesalePrice" p
    JOIN "CatalogueImport" i ON i."id" = p."importId" AND i."organizationId" = p."organizationId"
    JOIN "WholesaleArticle" w ON w."seq" = p."seq"
    WHERE p."organizationId" = ${organizationId} AND i."supplierId" = ${supplierId}
    ORDER BY p."seq", (p."priceKind" = 'NET') DESC, p."createdAt" DESC, p."id" DESC`;
  // The supplier's rows of its own files count as its articles too: the price in force of each.
  rows.push(...await prisma.$queryRaw<ReachRow[]>`
    SELECT DISTINCT ON (f."articleKey") f."discountGroup", f."priceKind", f."unitPrice"::text AS "unitPrice", f."articleNo", f."eNumber", f."name", '' AS "description", f."unit"
    FROM "CatalogueFilePrice" f
    JOIN "CatalogueImport" i ON i."id" = f."importId" AND i."organizationId" = f."organizationId" AND i."contentHash" <> ''
    WHERE f."organizationId" = ${organizationId} AND f."supplierId" = ${supplierId}
    ORDER BY f."articleKey", (f."priceKind" = 'NET') DESC, f."createdAt" DESC, f."id" DESC`);
  let covered = 0;
  const examples: RebatePreview["examples"][string] = [];
  for (const row of rows) {
    const group = groupKey(row.discountGroup);
    const byGroup = Array.from({ length: group.length }, (_, index) => group.slice(0, index + 1)).some((prefix) => groupKeys.has(prefix));
    if (byGroup || articleKeys.has(articleNoCore(row.articleNo)) || (row.eNumber !== "" && articleKeys.has(articleKey(row.eNumber)))) covered += 1;
    const base = Number(row.unitPrice);
    if (examples.length >= 3 || row.priceKind !== "BASE" || !(base > 0) || !groupKeys.has(group)) continue;
    const match = pickRebate(read.rows, { articleNo: row.articleNo, eNumber: row.eNumber, group: row.discountGroup });
    const net = match ? netPriceOf(base, match) : null;
    if (net) examples.push({ articleNo: row.articleNo || (row.eNumber ? `E ${row.eNumber}` : ""), name: row.description || row.name, unit: row.unit, basePrice: base, netPrice: net.unitPrice, percent: net.percent });
  }
  return { articles: rows.length, covered, examples };
}

const nameKey = (name: string) => name.trim().replace(/\s+/g, " ").toLowerCase();

/**
 * Imports a discount letter into one supplier of the caller's company: a new import of the kind REBATE with its rules,
 * all or nothing in one transaction. The prices are not touched – the net price is computed when it is used.
 */
export async function importRebateFile(caller: CatalogueCaller, input: { supplier: { id: string } | { name: string; customerNumber?: string; wholesaler?: WholesalerId | null }; fileName: string; text: string; read: RebateRead }) {
  const organizationId = caller.organizationId;
  const { read } = input;
  if (!read.rows.length) throw new ApiError(400, "Rabattbrevet har inga rader som kan läsas.");
  const fileName = input.fileName.slice(0, 200);
  const hash = createHash("sha256").update(input.text).digest("hex");
  const result = await prisma.$transaction(async (tx) => {
    let supplier: { id: string; name: string } | null;
    if ("id" in input.supplier) {
      supplier = await tx.catalogueSupplier.findFirst({ where: { id: input.supplier.id, organizationId }, select: { id: true, name: true, wholesaler: true } });
      if (!supplier) throw new ApiError(404, "Leverantören hittades inte.");
    } else {
      const name = input.supplier.name.trim().replace(/\s+/g, " ").slice(0, 120);
      if (!name) throw new ApiError(400, "Skriv leverantörens namn.");
      supplier = await tx.catalogueSupplier.findUnique({ where: { organizationId_nameKey: { organizationId, nameKey: nameKey(name) } }, select: { id: true, name: true, wholesaler: true } })
        ?? await tx.catalogueSupplier.create({ data: { organizationId, name, nameKey: nameKey(name), customerNumber: (input.supplier.customerNumber ?? "").trim().slice(0, 60), wholesaler: input.supplier.wholesaler ?? read.format.wholesaler, createdById: caller.userId }, select: { id: true, name: true, wholesaler: true } });
    }
    // A letter is the supplier's rules, whatever kind of row its prices are (produktägaren 2026-11-01, replaces "rabattbrev kräver grossistens katalog"):
    // the net price is computed from the base price when it is read, on a register article's price and on a row of the company's own file alike.
    const imported = await tx.catalogueImport.create({ data: { organizationId, supplierId: supplier.id, fileName, contentHash: hash, createdById: caller.userId, rowCount: read.rows.length + read.errorCount + read.skipped, newArticles: 0, changedPrices: 0, unchangedPrices: 0, failedRows: read.errorCount, priceKind: "NET" }, select: { id: true } });
    await tx.$executeRaw`UPDATE "CatalogueImport" SET "kind" = 'REBATE' WHERE "id" = ${imported.id} AND "organizationId" = ${organizationId}`;
    for (let start = 0; start < read.rows.length; start += BATCH) {
      const rows = read.rows.slice(start, start + BATCH);
      await tx.$executeRaw`
        INSERT INTO "CatalogueRebate" ("id", "organizationId", "supplierId", "importId", "kind", "key", "label", "percent", "percent2", "netPrice")
        SELECT u."id", ${organizationId}, ${supplier.id}, ${imported.id}, u."kind", u."key", u."label", u."p1"::numeric, u."p2"::numeric, u."net"::numeric
        FROM unnest(${rows.map(() => randomUUID())}::text[], ${rows.map((row) => row.kind)}::text[], ${rows.map((row) => row.key)}::text[], ${rows.map((row) => row.label.slice(0, 60))}::text[],
          ${rows.map((row) => String(row.percent))}::text[], ${rows.map((row) => String(row.percent2))}::text[], ${rows.map((row) => (row.netPrice === null ? null : String(row.netPrice)))}::text[])
          AS u("id", "kind", "key", "label", "p1", "p2", "net")`;
    }
    return { importId: imported.id, supplier };
  }, { timeout: 120_000, maxWait: 10_000 });
  const counts = rebateCounts(read.rows);
  await prisma.administrationEvent.create({ data: { actorId: caller.userId, organizationId, action: "catalogue_rebate_import",
    detail: `Artiklar och priser (${result.supplier.name}): rabattbrevet ${fileName} lästes in – ${counts.groups} grupprabatter, ${counts.articles} artikelrabatter, ${counts.netPrices} nettopriser, ${read.errorCount} rader med fel.` } });
  return { ...result, ...counts, failedRows: read.errorCount };
}

/** Per supplier of the company, its latest finished discount letter (for the wholesaler boxes). */
export async function latestRebates(organizationId: string): Promise<Map<string, { fileName: string; date: string; rules: number }>> {
  const rows = await prisma.$queryRaw<{ supplierId: string; fileName: string; createdAt: Date; rules: number }[]>`
    SELECT DISTINCT ON (i."supplierId") i."supplierId", i."fileName", i."createdAt",
      (SELECT count(*)::int FROM "CatalogueRebate" r WHERE r."organizationId" = i."organizationId" AND r."importId" = i."id") AS "rules"
    FROM "CatalogueImport" i WHERE i."organizationId" = ${organizationId} AND i."kind" = 'REBATE' AND i."contentHash" <> ''
    ORDER BY i."supplierId", i."createdAt" DESC, i."id" DESC`;
  return new Map(rows.map((row) => [row.supplierId, { fileName: row.fileName, date: isoDate(row.createdAt), rules: Number(row.rules) }]));
}
