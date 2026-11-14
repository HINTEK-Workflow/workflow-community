import type { Prisma } from "@prisma/client";

/**
 * Ett artikelregister per företag (2026-10-12): each supplier's article links to the company's product with the
 * same common number – the E-nummer, otherwise the RSK-nummer, seven digits (the same rule as commonNumberOf in
 * lib/catalogue/normalize.ts). Only the articles given are linked or unlinked, so an import touches only its own
 * supplier's links; a product is created the first time a number comes in and removed when no article links to it.
 * Everything is bound to the one company: the product key is (organizationId, numberKind, number) and the link is a
 * composite [productId, organizationId] key.
 */
type Tx = Pick<Prisma.TransactionClient, "$executeRaw" | "$queryRaw">;

/** Links (or unlinks) the given articles of the company to its products by their common number. */
export async function linkProducts(tx: Tx, organizationId: string, articleIds: string[]): Promise<void> {
  if (!articleIds.length) return;
  await tx.$executeRaw`
    WITH c AS (
      SELECT a."id", a."name", a."unit", a."createdAt",
        CASE WHEN a."eNumber" ~ '^[0-9]{7}$' THEN 'E' WHEN a."rskNumber" ~ '^[0-9]{7}$' THEN 'RSK' END AS "kind",
        CASE WHEN a."eNumber" ~ '^[0-9]{7}$' THEN a."eNumber" WHEN a."rskNumber" ~ '^[0-9]{7}$' THEN a."rskNumber" END AS "number"
      FROM "CatalogueArticle" a WHERE a."organizationId" = ${organizationId} AND a."id" = ANY(${articleIds}::text[]))
    INSERT INTO "CatalogueProduct" ("id", "organizationId", "numberKind", "number", "name", "unit")
    SELECT DISTINCT ON (c."kind", c."number") gen_random_uuid()::text, ${organizationId}, c."kind", c."number", c."name", c."unit"
    FROM c WHERE c."kind" IS NOT NULL
    ORDER BY c."kind", c."number", c."createdAt", c."id"
    ON CONFLICT ("organizationId", "numberKind", "number") DO NOTHING`;
  await tx.$executeRaw`
    UPDATE "CatalogueArticle" a SET "productId" = x."productId"
    FROM (
      SELECT c."id", p."id" AS "productId" FROM (
        SELECT a2."id",
          CASE WHEN a2."eNumber" ~ '^[0-9]{7}$' THEN 'E' WHEN a2."rskNumber" ~ '^[0-9]{7}$' THEN 'RSK' END AS "kind",
          CASE WHEN a2."eNumber" ~ '^[0-9]{7}$' THEN a2."eNumber" WHEN a2."rskNumber" ~ '^[0-9]{7}$' THEN a2."rskNumber" END AS "number"
        FROM "CatalogueArticle" a2 WHERE a2."organizationId" = ${organizationId} AND a2."id" = ANY(${articleIds}::text[])) c
      LEFT JOIN "CatalogueProduct" p ON p."organizationId" = ${organizationId} AND p."numberKind" = c."kind" AND p."number" = c."number") x
    WHERE a."id" = x."id" AND a."organizationId" = ${organizationId} AND a."productId" IS DISTINCT FROM x."productId"`;
}

/**
 * Removes the company's products that no article links to any more (after an import, a removed import or supplier).
 * An import passes the products its articles left, so only those are checked (2026-10-13).
 */
export async function removeUnlinkedProducts(tx: Tx, organizationId: string, only?: string[]): Promise<number> {
  if (only) return only.length ? tx.$executeRaw`
    DELETE FROM "CatalogueProduct" p WHERE p."organizationId" = ${organizationId} AND p."id" = ANY(${only}::text[])
      AND NOT EXISTS (SELECT 1 FROM "CatalogueArticle" a WHERE a."organizationId" = ${organizationId} AND a."productId" = p."id")` : 0;
  return tx.$executeRaw`
    DELETE FROM "CatalogueProduct" p WHERE p."organizationId" = ${organizationId}
      AND NOT EXISTS (SELECT 1 FROM "CatalogueArticle" a WHERE a."organizationId" = ${organizationId} AND a."productId" = p."id")`;
}

/** Links every article of the company that has a common number but no product yet (after a Cloud import of a file). */
export async function linkAllProducts(tx: Tx, organizationId: string): Promise<void> {
  const ids = await tx.$queryRaw<{ id: string }[]>`
    SELECT "id" FROM "CatalogueArticle" WHERE "organizationId" = ${organizationId} AND "productId" IS NULL
      AND ("eNumber" ~ '^[0-9]{7}$' OR "rskNumber" ~ '^[0-9]{7}$')`;
  for (let start = 0; start < ids.length; start += 5000) await linkProducts(tx, organizationId, ids.slice(start, start + 5000).map((row) => row.id));
}
