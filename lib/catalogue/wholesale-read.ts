import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import type { WholesalerId } from "@/lib/wholesale/model";

/**
 * Läsvägen för priser direkt mot grossistens katalogartikel (2026-10-17, alternativ C): what a company's price rows
 * (WholesalePrice) and its imports' bit lists (WholesaleImportSeen) say about a wholesaler's article. One place, so the search,
 * the article lists, the tools, the export and the purchase/quote lines read the price in force, "bekräftad" and "saknas i senaste
 * filen" the same way. Every query is limited to one company (`organizationId`); the register itself (WholesaleArticle) is global
 * and carries no price.
 *
 * - **Price in force (per company, supplier and article):** the latest NET row, otherwise the latest BASE row. A discount letter
 *   (CatalogueRebate) is applied by the caller on a BASE price exactly as for the company's own articles.
 * - **Bekräftad:** the later of the row's own price date and the `confirmedDate` of every later finished price-list import of the
 *   same supplier and price kind whose bit list has the article – the file still had the article at that price (an import that
 *   changed the price wrote a newer row, which then is the price in force).
 * - **Saknas i senaste filen:** the supplier's latest price-list import of the row's price kind has a bit list and not the article.
 * - Two suppliers of the same wholesaler give two offers on one article (one per supplier).
 */
export type WholesaleOffer = {
  /** WholesaleArticle.seq and the register's own identity of the article. */
  seq: number;
  wholesaler: WholesalerId;
  articleNo: string;
  supplierId: string;
  supplierName: string;
  priceRowId: string;
  importId: string;
  priceKind: "NET" | "BASE";
  /** Decimal strings, SEK excluding VAT, as the row holds them. */
  amount: string;
  perQuantity: number;
  unitPrice: string;
  currency: string;
  /** YYYY-MM-DD: when the price was set, and when it was last confirmed (never earlier than priceDate). */
  priceDate: string;
  confirmedDate: string;
  createdAt: string;
  discountGroup: string;
  packageSize: string;
  orderMultiple: string;
  minOrderQuantity: string;
  stocked: string;
  /** The file's own status (UTGAR / PRIS_PA_BEGARAN / ""), not the wholesaler's catalogue status. */
  status: string;
  sourceFileName: string;
  /** The supplier's latest price list of this price kind had a bit list and not this article ("inte i senaste prisfilen"). */
  missingFromLatestFile: boolean;
};

const day = (value: Date | string) => (typeof value === "string" ? value : value.toISOString()).slice(0, 10);

type OfferRow = Omit<WholesaleOffer, "priceDate" | "confirmedDate" | "createdAt"> & { priceDate: Date; confirmedDate: Date; createdAt: Date };

/**
 * The prices in force for a company on these wholesale articles (running numbers): one offer per supplier and article, only for
 * articles the company has a price on. An article without a price is simply missing from the map.
 */
export async function wholesaleOffers(organizationId: string, seqs: readonly number[]): Promise<Map<number, WholesaleOffer[]>> {
  const offers = new Map<number, WholesaleOffer[]>();
  const wanted = [...new Set(seqs.filter((seq) => Number.isInteger(seq) && seq >= 1))];
  if (!wanted.length) return offers;
  const rows = await prisma.$queryRaw<OfferRow[]>(Prisma.sql`
    WITH ranked AS (
      SELECT p.*, i."supplierId", i."createdAt" AS "importCreatedAt", i."fileName" AS "sourceFileName",
        row_number() OVER (PARTITION BY p."seq", i."supplierId" ORDER BY (p."priceKind" = 'NET') DESC, p."createdAt" DESC, p."id" DESC) AS rn
      FROM "WholesalePrice" p
      JOIN "CatalogueImport" i ON i."id" = p."importId" AND i."organizationId" = p."organizationId"
      WHERE p."organizationId" = ${organizationId} AND p."seq" = ANY(${wanted}::int[])
    )
    SELECT r."seq", a."wholesaler", a."articleNo", r."supplierId", s."name" AS "supplierName", r."id"::text AS "priceRowId", r."importId", r."priceKind",
      r."amount"::text AS "amount", r."perQuantity", r."unitPrice"::text AS "unitPrice", r."currency", r."priceDate", r."createdAt",
      r."discountGroup", r."packageSize", r."orderMultiple", r."minOrderQuantity", r."stocked", r."status", r."sourceFileName",
      GREATEST(r."priceDate", COALESCE(later."confirmedDate", r."priceDate")) AS "confirmedDate",
      COALESCE(latest."hasList" AND NOT latest."has", false) AS "missingFromLatestFile"
    FROM ranked r
    JOIN "WholesaleArticle" a ON a."seq" = r."seq"
    JOIN "CatalogueSupplier" s ON s."id" = r."supplierId" AND s."organizationId" = ${organizationId}
    LEFT JOIN LATERAL (
      SELECT max(w."confirmedDate") AS "confirmedDate"
      FROM "WholesaleImportSeen" w
      JOIN "CatalogueImport" i2 ON i2."id" = w."importId" AND i2."organizationId" = w."organizationId"
      WHERE w."organizationId" = ${organizationId} AND i2."supplierId" = r."supplierId" AND i2."kind" = 'PRICES' AND i2."priceKind" = r."priceKind"
        AND i2."createdAt" >= r."importCreatedAt" AND (CASE WHEN r."seq" < octet_length(w."seen") * 8 THEN get_bit(w."seen", r."seq") ELSE 0 END) = 1
    ) later ON true
    LEFT JOIN LATERAL (
      SELECT (w."importId" IS NOT NULL) AS "hasList", (w."importId" IS NOT NULL AND (CASE WHEN r."seq" < octet_length(w."seen") * 8 THEN get_bit(w."seen", r."seq") ELSE 0 END) = 1) AS "has"
      FROM "CatalogueImport" i3
      LEFT JOIN "WholesaleImportSeen" w ON w."importId" = i3."id" AND w."organizationId" = i3."organizationId"
      WHERE i3."organizationId" = ${organizationId} AND i3."supplierId" = r."supplierId" AND i3."kind" = 'PRICES' AND i3."priceKind" = r."priceKind"
      ORDER BY i3."createdAt" DESC, i3."id" DESC LIMIT 1
    ) latest ON true
    WHERE r.rn = 1
    ORDER BY s."name", r."seq"`);
  for (const row of rows) {
    const offer: WholesaleOffer = { ...row, priceDate: day(row.priceDate), confirmedDate: day(row.confirmedDate), createdAt: row.createdAt.toISOString() };
    offers.set(row.seq, [...(offers.get(row.seq) ?? []), offer]);
  }
  return offers;
}

/** The price rows of one article for a company, newest first (at most 50), optionally for one supplier. The history of the prices. */
export async function wholesalePriceHistory(organizationId: string, seq: number, supplierId?: string) {
  const rows = await prisma.$queryRaw<{ id: string; importId: string; supplierId: string; priceKind: string; amount: string; perQuantity: number; unitPrice: string; currency: string; priceDate: Date; discountGroup: string; sourceFileName: string; createdAt: Date }[]>(Prisma.sql`
    SELECT p."id"::text AS "id", p."importId", i."supplierId", p."priceKind", p."amount"::text AS "amount", p."perQuantity", p."unitPrice"::text AS "unitPrice", p."currency",
      p."priceDate", p."discountGroup", i."fileName" AS "sourceFileName", p."createdAt"
    FROM "WholesalePrice" p
    JOIN "CatalogueImport" i ON i."id" = p."importId" AND i."organizationId" = p."organizationId"
    WHERE p."organizationId" = ${organizationId} AND p."seq" = ${seq} AND (${supplierId ?? null}::text IS NULL OR i."supplierId" = ${supplierId ?? null})
    ORDER BY p."createdAt" DESC, p."id" DESC LIMIT 50`);
  return rows.map((row) => ({ ...row, priceDate: day(row.priceDate), createdAt: row.createdAt.toISOString() }));
}
