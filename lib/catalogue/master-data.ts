import { randomUUID } from "node:crypto";
import { prisma } from "@/lib/db";
import { solarCatalogue } from "@/lib/integrations/server-secrets";
import { lookupSolarProduct, type SolarIdentifier, type SolarMasterData } from "@/lib/integrations/solar";
import { eNumberFromArticleNo, gtinOf, manufacturerKey } from "@/lib/catalogue/normalize";

/**
 * Grossistens katalog i artikelsökningen (2026-10-14): when someone searches for a number that is not in the
 * company's price files, the product is looked up in Solar's catalogue with Workflow's one key – name, unit, GTIN,
 * manufacturer and the manufacturer's number, never a price – and joined to the same product in the company's own
 * price files by the register's rules (E-nummer, then GTIN, then manufacturer with the manufacturer's number). The
 * price always comes from the company's own file.
 *
 * The answers are kept for a while per identifier (ExternalProductCache; the wholesaler's product data, not a company's)
 * and the company's matching products learn the master data (CatalogueProduct.master, GTIN, manufacturer key), so a
 * later price file with only a GTIN or a manufacturer's number meets the same product. No copy of the whole catalogue
 * is kept: only what was looked up.
 */
export type MasterLookup =
  | { status: "found"; data: SolarMasterData }
  | { status: "not-found" }
  | { status: "unavailable"; reason: "no-key" | "no-catalog" | "error"; message?: string };

const FOUND_MS = 24 * 60 * 60 * 1000;
const MISSING_MS = 60 * 60 * 1000;
/** Answers kept before Solar's answer was read tolerantly (solarProductOf and its capitalised field names, 2026-10-16) are asked again. */
const READER_SINCE = Date.parse("2026-10-17T06:00:00+02:00");

/** The identifier a search query is, when it is one Solar can look up: an E-nummer (seven digits, E in front or not) or a GTIN/EAN. */
export function identifierOfQuery(query: string): { kind: SolarIdentifier; value: string } | null {
  const plain = query.trim().replace(/\s+/g, "");
  const e = eNumberFromArticleNo(plain.replace(/^E-?/i, "E"));
  if (e) return { kind: "electricalNumber", value: e };
  const gtin = gtinOf(plain);
  if (gtin) return { kind: "eanNumber", value: gtin.replace(/^0+(?=\d{13}$)/, "") };
  // Solar's SAP material number (2026-10-15): ten digits, as in Solar's own examples; nothing else in the trade is ten digits.
  if (/^\d{10}$/.test(plain)) return { kind: "sapMaterialNumber", value: plain };
  return null;
}

/** Solar's master data for an identifier, from the cache while it is fresh, otherwise asked anew. */
export async function lookupMasterData(identifier: { kind: SolarIdentifier; value: string }, ask = lookupSolarProduct): Promise<MasterLookup> {
  const cached = await prisma.$queryRaw<{ found: boolean; data: SolarMasterData | null; fetchedAt: Date }[]>`
    SELECT "found", "data", "fetchedAt" FROM "ExternalProductCache" WHERE "source" = 'solar' AND "identifierKind" = ${identifier.kind} AND "identifier" = ${identifier.value} LIMIT 1`;
  const hit = cached[0];
  if (hit && hit.fetchedAt.getTime() >= READER_SINCE && Date.now() - hit.fetchedAt.getTime() < (hit.found ? FOUND_MS : MISSING_MS)) return hit.found && hit.data ? { status: "found", data: hit.data } : { status: "not-found" };
  const config = await solarCatalogue();
  if (!config.ok) return { status: "unavailable", reason: config.reason };
  const answer = await ask(config, identifier);
  if (answer.status === "error") return { status: "unavailable", reason: "error", message: answer.message };
  const found = answer.status === "found";
  const data = found ? JSON.stringify(answer.data) : null;
  await prisma.$executeRaw`
    INSERT INTO "ExternalProductCache" ("id", "source", "identifierKind", "identifier", "found", "data", "fetchedAt")
    VALUES (${randomUUID()}, 'solar', ${identifier.kind}, ${identifier.value}, ${found}, ${data}::jsonb, now())
    ON CONFLICT ("source", "identifierKind", "identifier") DO UPDATE SET "found" = EXCLUDED."found", "data" = EXCLUDED."data", "fetchedAt" = EXCLUDED."fetchedAt"`;
  return found ? { status: "found", data: answer.data } : { status: "not-found" };
}

/**
 * The company's products that are the catalogue's product (E-nummer, GTIN, manufacturer with number) learn its master
 * data, and – when they have none yet – its GTIN and manufacturer key. Returns the query that finds them in the
 * company's register (the E-nummer, otherwise the GTIN), or null when the company has none of them.
 */
export async function joinMasterData(organizationId: string, data: SolarMasterData): Promise<string | null> {
  const gtin = gtinOf(data.gtin);
  const maker = manufacturerKey(data.manufacturer, data.manufacturerArticleNo);
  const e = /^\d{7}$/.test(data.eNumber) ? data.eNumber : "";
  if (!e && !gtin && !maker) return null;
  const products = await prisma.$queryRaw<{ id: string }[]>`
    SELECT p."id" FROM "CatalogueProduct" p
    WHERE p."organizationId" = ${organizationId} AND (
      (${e} <> '' AND p."numberKind" = 'E' AND p."number" = ${e})
      OR (${gtin} <> '' AND (p."gtin" = ${gtin} OR (p."numberKind" = 'GTIN' AND p."number" = ${gtin})))
      OR (${maker} <> '' AND (p."mpnKey" = ${maker} OR (p."numberKind" = 'MPN' AND p."number" = ${maker}))))
    LIMIT 20`;
  if (products.length) await prisma.$executeRaw`
    UPDATE "CatalogueProduct" SET "master" = ${JSON.stringify(data)}::jsonb,
      "gtin" = CASE WHEN "gtin" = '' THEN ${gtin} ELSE "gtin" END, "mpnKey" = CASE WHEN "mpnKey" = '' THEN ${maker} ELSE "mpnKey" END
    WHERE "organizationId" = ${organizationId} AND "id" = ANY(${products.map((item) => item.id)}::text[])`;
  if (e) return e;
  if (gtin) return gtin;
  return products.length ? data.manufacturerArticleNo : null;
}
