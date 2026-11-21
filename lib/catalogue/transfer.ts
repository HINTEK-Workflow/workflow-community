import { randomUUID } from "node:crypto";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { ApiError } from "@/lib/kfid/errors";
import { linkAllProducts } from "@/lib/catalogue/products";
import { seenFromSeqs } from "@/lib/catalogue/wholesale-model";
import { filePriceColumns } from "@/lib/catalogue/file-price-model";
import { assertCompanyRowLimit } from "@/lib/catalogue/file-prices";
import { buildCatalogueTransfer, CATALOGUE_TRANSFER_LIMITS, decimalText, isoDay as day, MAX_CATALOGUE_TRANSFER_BYTES, type CatalogueExportRows, type CatalogueTransfer, type Decimalish } from "@/lib/catalogue/transfer-format";

/**
 * Artiklar och priser in the Cloud company export, the database side (2026-10-08): reading the company's catalogue
 * for the file and adding a file's catalogue back. The format itself, its bounds and checks are in transfer-format.ts.
 *
 * The company's prices on a wholesaler's catalogue articles (WholesalePrice, 2026-10-17) leave the database with the
 * article's natural key – the wholesaler and its own article number – because the register's running numbers belong to one
 * database; coming back, each is looked up in the target's register, and one the register does not have is counted as
 * "inte i katalogen" and left out. Every query below is limited to the company.
 */
export { parseCatalogueTransfer, catalogueTransferCounts, catalogueTransferRows, type CatalogueTransfer } from "@/lib/catalogue/transfer-format";

const tooLarge = () => new ApiError(413, "Artiklar och priser är för stora för en Cloud-kopia. Ta bort äldre prisimporter under Import → Artiklar och priser och exportera igen. Ingen ofullständig export skapades.");

/** The article numbers of a bit list, grouped by wholesaler: the register's articles whose running number is in the list. */
async function seenArticleNumbers(seen: Uint8Array): Promise<Map<string, string[]>> {
  const bytes = Buffer.from(seen);
  const found = bytes.length
    ? await prisma.$queryRaw<{ wholesaler: string; articleNo: string }[]>`
        SELECT a."wholesaler", a."articleNo" FROM "WholesaleArticle" a
        WHERE CASE WHEN a."seq" < ${bytes.length * 8} THEN get_bit(${bytes}::bytea, a."seq") ELSE 0 END = 1 ORDER BY a."seq"`
    : [];
  const byWholesaler = new Map<string, string[]>();
  for (const row of found) byWholesaler.set(row.wholesaler, [...(byWholesaler.get(row.wholesaler) ?? []), row.articleNo]);
  return byWholesaler;
}

/** The company's catalogue for the Cloud copy, or undefined when it has none. Counted first, so a huge catalogue is refused before it is read. */
export async function catalogueForExport(organizationId: string): Promise<CatalogueTransfer | undefined> {
  const where = { organizationId };
  // An import still running has no content hash yet (and the file's format needs one): it is not part of the copy until it has finished.
  // A discount letter (kind REBATE) is not part of the copy: its rules are not in the file, and without them it would come back as an
  // empty price list – the newest one, which would hide "inte i senaste prisfilen" on every article (2026-10-17).
  const finished = { organizationId, contentHash: { not: "" }, kind: "PRICES" };
  const [suppliers, imports, articles, prices, confirmations, profiles, wholesalePrices, seenArticles, fileRowCount] = await Promise.all([
    prisma.catalogueSupplier.count({ where }), prisma.catalogueImport.count({ where: finished }), prisma.catalogueArticle.count({ where }),
    prisma.cataloguePrice.count({ where }), prisma.cataloguePriceConfirmation.count({ where }), prisma.catalogueImportProfile.count({ where }),
    prisma.wholesalePrice.count({ where }),
    prisma.wholesaleImportSeen.aggregate({ where, _sum: { count: true } }).then((sum) => sum._sum.count ?? 0),
    prisma.catalogueFilePrice.count({ where }),
  ]);
  if (!suppliers) return undefined;
  const limits = CATALOGUE_TRANSFER_LIMITS;
  if (suppliers > limits.suppliers || imports > limits.imports || articles > limits.articles || prices > limits.prices || confirmations > limits.confirmations || profiles > limits.mappings
    || wholesalePrices > limits.wholesalePrices || seenArticles > limits.seenArticles || fileRowCount > limits.fileRows) throw tooLarge();
  const order = [{ createdAt: "asc" as const }, { id: "asc" as const }];
  const rows: CatalogueExportRows = {
    suppliers: await prisma.catalogueSupplier.findMany({ where, orderBy: order, take: limits.suppliers, select: { id: true, name: true, customerNumber: true, wholesaler: true, createdAt: true } }),
    imports: await prisma.catalogueImport.findMany({ where: finished, orderBy: order, take: limits.imports, select: { id: true, supplierId: true, fileName: true, contentHash: true, rowCount: true, newArticles: true, changedPrices: true, unchangedPrices: true, failedRows: true, priceKind: true, createdAt: true } }),
    articles: await prisma.catalogueArticle.findMany({ where, orderBy: order, take: limits.articles, select: { id: true, supplierId: true, supplierArticleNo: true, eNumber: true, manufacturerArticleNo: true, articleKey: true, name: true, unit: true, discountGroup: true, createdAt: true } }),
    prices: await prisma.cataloguePrice.findMany({ where, orderBy: order, take: limits.prices, select: { id: true, articleId: true, importId: true, amount: true, perQuantity: true, unitPrice: true, currency: true, priceKind: true, priceDate: true, sourceFileName: true, createdAt: true } }),
    confirmations: await prisma.cataloguePriceConfirmation.findMany({ where, orderBy: order, take: limits.confirmations, select: { priceId: true, importId: true, confirmedDate: true, createdAt: true } }),
    profiles: await prisma.catalogueImportProfile.findMany({ where, orderBy: order, take: limits.mappings, select: { supplierId: true, fingerprint: true, mapping: true, updatedAt: true } }),
  };
  if (wholesalePrices) {
    const found = await prisma.wholesalePrice.findMany({ where, orderBy: order, take: limits.wholesalePrices,
      select: { importId: true, amount: true, perQuantity: true, unitPrice: true, priceKind: true, priceDate: true, createdAt: true, discountGroup: true, packageSize: true, orderMultiple: true, minOrderQuantity: true, stocked: true, status: true,
        article: { select: { wholesaler: true, articleNo: true } } } });
    rows.wholesalePrices = found.map(({ article, ...price }) => ({ ...price, wholesaler: article.wholesaler, articleNo: article.articleNo }));
  }
  if (seenArticles) {
    const lists = await prisma.wholesaleImportSeen.findMany({ where, orderBy: { createdAt: "asc" }, select: { importId: true, seen: true, confirmedDate: true } });
    rows.wholesaleSeen = [];
    for (const list of lists)
      for (const [wholesaler, articleNos] of await seenArticleNumbers(list.seen)) rows.wholesaleSeen.push({ importId: list.importId, wholesaler, confirmedDate: list.confirmedDate, articleNos });
  }
  if (fileRowCount) {
    rows.fileRows = await prisma.catalogueFilePrice.findMany({ where, orderBy: { id: "asc" }, take: limits.fileRows,
      select: { importId: true, wholesaler: true, articleNo: true, articleKey: true, eNumber: true, rskNumber: true, gtin: true, manufacturer: true, manufacturerArticleNo: true, name: true, unit: true,
        amount: true, perQuantity: true, unitPrice: true, priceKind: true, priceDate: true, createdAt: true, discountGroup: true, packageSize: true, orderMultiple: true, minOrderQuantity: true, stocked: true, status: true } });
  }
  const transfer = buildCatalogueTransfer(rows);
  if (Buffer.byteLength(JSON.stringify(transfer)) > MAX_CATALOGUE_TRANSFER_BYTES) throw tooLarge();
  return transfer;
}

export type CatalogueImportSummary = { suppliers: number; imports: number; articles: number; prices: number; confirmations: number; mappings: number;
  /** The company's prices on wholesalers' articles that were added, and those the target's register does not have ("inte i katalogen"). */
  wholesalePrices: number; notInCatalogue: number;
  /** The rows of files for wholesalers without a catalogue that were added. */
  fileRows: number };
type Tx = Pick<Prisma.TransactionClient, "catalogueSupplier" | "catalogueImport" | "catalogueArticle" | "cataloguePrice" | "cataloguePriceConfirmation" | "catalogueImportProfile" | "wholesalePrice" | "wholesaleImportSeen" | "catalogueFilePrice" | "$executeRaw" | "$queryRaw">;

const BATCH = 2_000;
/** Rows per insert of price rows on wholesalers' articles (17 columns each): well below Postgres' 65 535 parameters per statement. */
const WHOLESALE_BATCH = 1_500;
function* chunks<T>(items: T[], size = BATCH): Generator<T[]> {
  for (let start = 0; start < items.length; start += size) yield items.slice(start, start + size);
}
const nameKey = (name: string) => name.trim().replace(/\s+/g, " ").toLowerCase();
const priceKey = (articleId: string, importId: string, priceDate: string, amount: Decimalish, perQuantity: number) => `${articleId}|${importId}|${priceDate}|${decimalText(amount)}|${perQuantity}`;
const wholesalePriceKey = (seq: number, priceKind: string, priceDate: string, amount: Decimalish, perQuantity: number) => `${seq}|${priceKind}|${priceDate}|${decimalText(amount)}|${perQuantity}`;

/** The running numbers of a wholesaler's articles in this database's register, by article number (the ones it has). */
async function seqsOfArticles(tx: Pick<Tx, "$queryRaw">, wholesaler: string, articleNos: readonly string[]): Promise<Map<string, number>> {
  const seqs = new Map<string, number>();
  for (const batch of chunks([...new Set(articleNos)], 5_000)) {
    const found = await tx.$queryRaw<{ articleNo: string; seq: number }[]>`SELECT "articleNo", "seq" FROM "WholesaleArticle" WHERE "wholesaler" = ${wholesaler} AND "articleNo" = ANY(${batch}::text[])`;
    for (const row of found) seqs.set(row.articleNo, Number(row.seq));
  }
  return seqs;
}

/**
 * Adds the file's catalogue to the company, inside the Cloud import's transaction. Only what Cloud lacks is created;
 * an existing supplier, article, import, price, confirmation or saved mapping is kept as it is. Every row is created in
 * the importing company only, so the composite keys hold.
 */
export async function importCatalogueTransfer(tx: Tx, input: { organizationId: string; transfer: CatalogueTransfer | null }): Promise<CatalogueImportSummary | null> {
  const file = input.transfer;
  if (!file || !file.suppliers.length) return null;
  const organizationId = input.organizationId;
  const created: CatalogueImportSummary = { suppliers: 0, imports: 0, articles: 0, prices: 0, confirmations: 0, mappings: 0, wholesalePrices: 0, notInCatalogue: 0, fileRows: 0 };

  // Suppliers by name. A supplier made here is the wholesaler the file says (version 2); one Cloud has keeps what it is.
  const existingSuppliers = await tx.catalogueSupplier.findMany({ where: { organizationId, nameKey: { in: file.suppliers.map((row) => nameKey(row.name)) } }, select: { id: true, nameKey: true } });
  const supplierByKey = new Map(existingSuppliers.map((row) => [row.nameKey, row.id]));
  const supplierId = new Map<string, string>();
  const newSuppliers: Prisma.CatalogueSupplierCreateManyInput[] = [];
  for (const row of file.suppliers) {
    const key = nameKey(row.name);
    let id = supplierByKey.get(key);
    if (!id) { id = randomUUID(); supplierByKey.set(key, id); newSuppliers.push({ id, organizationId, name: row.name.trim().replace(/\s+/g, " "), nameKey: key, customerNumber: row.customerNumber, ...(row.wholesaler ? { wholesaler: row.wholesaler } : {}), createdAt: new Date(row.createdAt) }); }
    supplierId.set(row.ref, id);
  }
  if (newSuppliers.length) await tx.catalogueSupplier.createMany({ data: newSuppliers });
  created.suppliers = newSuppliers.length;

  // Imports by supplier, content and time.
  const existingImports = await tx.catalogueImport.findMany({ where: { organizationId, contentHash: { in: [...new Set(file.imports.map((row) => row.contentHash))] } }, select: { id: true, supplierId: true, contentHash: true, createdAt: true } });
  const importByKey = new Map(existingImports.map((row) => [`${row.supplierId}|${row.contentHash}|${row.createdAt.toISOString()}`, row.id]));
  const importId = new Map<string, string>();
  const newImports: Prisma.CatalogueImportCreateManyInput[] = [];
  /** The imports made here: only they get a bit list from the file (an import Cloud has is kept as it is). */
  const madeHere = new Set<string>();
  for (const row of file.imports) {
    const supplier = supplierId.get(row.supplier)!;
    const key = `${supplier}|${row.contentHash}|${new Date(row.createdAt).toISOString()}`;
    let id = importByKey.get(key);
    if (!id) {
      id = randomUUID(); importByKey.set(key, id); madeHere.add(id);
      newImports.push({ id, organizationId, supplierId: supplier, fileName: row.fileName, contentHash: row.contentHash, createdById: null, rowCount: row.rowCount, newArticles: row.newArticles,
        changedPrices: row.changedPrices, unchangedPrices: row.unchangedPrices, failedRows: row.failedRows, priceKind: row.priceKind ?? "NET", createdAt: new Date(row.createdAt) });
    }
    importId.set(row.ref, id);
  }
  for (const batch of chunks(newImports)) await tx.catalogueImport.createMany({ data: batch });
  created.imports = newImports.length;

  // Articles by supplier and article key; Cloud's own name and unit stay.
  const articleId = new Map<string, string>();
  const knownArticles = new Set<string>();
  const newArticles: Prisma.CatalogueArticleCreateManyInput[] = [];
  const bySupplier = new Map<string, typeof file.articles>();
  for (const row of file.articles) { const list = bySupplier.get(row.supplier) ?? []; list.push(row); bySupplier.set(row.supplier, list); }
  for (const [supplierRef, rows] of bySupplier) {
    const supplier = supplierId.get(supplierRef)!;
    const found = new Map<string, string>();
    for (const batch of chunks(rows, 5_000))
      for (const row of await tx.catalogueArticle.findMany({ where: { organizationId, supplierId: supplier, articleKey: { in: batch.map((item) => item.articleKey) } }, select: { id: true, articleKey: true } })) found.set(row.articleKey, row.id);
    for (const row of rows) {
      let id = found.get(row.articleKey);
      if (id) knownArticles.add(id);
      else {
        id = randomUUID(); found.set(row.articleKey, id);
        newArticles.push({ id, organizationId, supplierId: supplier, supplierArticleNo: row.articleNo, eNumber: row.eNumber, manufacturerArticleNo: row.manufacturerArticleNo ?? "", articleKey: row.articleKey, name: row.name, unit: row.unit, discountGroup: row.discountGroup, createdAt: new Date(row.createdAt) });
      }
      articleId.set(row.ref, id);
    }
  }
  for (const batch of chunks(newArticles)) await tx.catalogueArticle.createMany({ data: batch });
  created.articles = newArticles.length;

  // Prices by their values (append-only: an existing row is never touched).
  const priceByKey = new Map<string, string>();
  for (const batch of chunks([...knownArticles], 5_000))
    for (const row of await tx.cataloguePrice.findMany({ where: { organizationId, articleId: { in: batch } }, select: { id: true, articleId: true, importId: true, priceDate: true, amount: true, perQuantity: true } }))
      priceByKey.set(priceKey(row.articleId, row.importId, day(row.priceDate), row.amount, row.perQuantity), row.id);
  const priceId = new Map<string, string>();
  const knownPrices = new Set<string>();
  const newPrices: Prisma.CataloguePriceCreateManyInput[] = [];
  for (const row of file.prices) {
    const article = articleId.get(row.article)!;
    const fromImport = importId.get(row.import)!;
    const key = priceKey(article, fromImport, row.priceDate, row.amount, row.perQuantity);
    let id = priceByKey.get(key);
    if (id) knownPrices.add(id);
    else {
      id = randomUUID(); priceByKey.set(key, id);
      newPrices.push({ id, organizationId, articleId: article, importId: fromImport, amount: new Prisma.Decimal(row.amount), perQuantity: row.perQuantity, unitPrice: new Prisma.Decimal(row.unitPrice),
        currency: row.currency, priceKind: row.priceKind ?? "NET", priceDate: new Date(`${row.priceDate}T00:00:00Z`), sourceFileName: row.sourceFileName, createdAt: new Date(row.createdAt) });
    }
    priceId.set(row.ref, id);
  }
  for (const batch of chunks(newPrices)) await tx.cataloguePrice.createMany({ data: batch });
  created.prices = newPrices.length;

  // Confirmations by price, import and date.
  const confirmationKeys = new Set<string>();
  for (const batch of chunks([...knownPrices], 5_000))
    for (const row of await tx.cataloguePriceConfirmation.findMany({ where: { organizationId, priceId: { in: batch } }, select: { priceId: true, importId: true, confirmedDate: true } }))
      confirmationKeys.add(`${row.priceId}|${row.importId}|${day(row.confirmedDate)}`);
  const newConfirmations: Prisma.CataloguePriceConfirmationCreateManyInput[] = [];
  for (const row of file.confirmations) {
    const price = priceId.get(row.price)!;
    const fromImport = importId.get(row.import)!;
    const key = `${price}|${fromImport}|${row.confirmedDate}`;
    if (confirmationKeys.has(key)) continue;
    confirmationKeys.add(key);
    newConfirmations.push({ organizationId, priceId: price, importId: fromImport, confirmedDate: new Date(`${row.confirmedDate}T00:00:00Z`), createdAt: new Date(row.createdAt) });
  }
  for (const batch of chunks(newConfirmations)) await tx.cataloguePriceConfirmation.createMany({ data: batch });
  created.confirmations = newConfirmations.length;

  // The company's prices on wholesalers' catalogue articles (version 2): each article is found in this database's register by the
  // wholesaler and its own number; one it does not have is "inte i katalogen" and left out. Append-only like the rest: a price row
  // this company already has (same import, article, kind, date and amount) is never added twice, an import Cloud has keeps its
  // bit list, and an import made here gets the file's list – built from the articles the register has.
  for (const group of file.wholesale) {
    const intoImport = importId.get(group.import)!;
    const listed = new Set<string>([...group.prices.map((row) => row[0]), ...(group.seen?.articles ?? [])]);
    const seqs = await seqsOfArticles(tx, group.wholesaler, [...listed]);
    const have = new Set<string>();
    if (!madeHere.has(intoImport))
      for (const row of await tx.wholesalePrice.findMany({ where: { organizationId, importId: intoImport }, select: { seq: true, priceKind: true, priceDate: true, amount: true, perQuantity: true } }))
        have.add(wholesalePriceKey(row.seq, row.priceKind, day(row.priceDate), row.amount, row.perQuantity));
    const rows: Prisma.WholesalePriceCreateManyInput[] = [];
    for (const [articleNo, amount, perQuantity, unitPrice, kind, priceDate, writtenAt, discountGroup, packageSize, orderMultiple, minOrderQuantity, stocked, status] of group.prices) {
      const seq = seqs.get(articleNo);
      if (seq === undefined) { created.notInCatalogue += 1; continue; }
      const priceKind = kind === "B" ? "BASE" : "NET";
      const key = wholesalePriceKey(seq, priceKind, priceDate, amount, perQuantity);
      if (have.has(key)) continue;
      have.add(key);
      rows.push({ organizationId, importId: intoImport, seq, amount: new Prisma.Decimal(amount), perQuantity, unitPrice: new Prisma.Decimal(unitPrice), currency: "SEK", priceKind,
        priceDate: new Date(`${priceDate}T00:00:00Z`), discountGroup, packageSize, orderMultiple, minOrderQuantity, stocked, status, createdAt: new Date(writtenAt) });
    }
    for (const batch of chunks(rows, WHOLESALE_BATCH)) await tx.wholesalePrice.createMany({ data: batch });
    created.wholesalePrices += rows.length;
    if (group.seen && madeHere.has(intoImport) && !(await tx.wholesaleImportSeen.findUnique({ where: { importId: intoImport }, select: { importId: true } }))) {
      const found = group.seen.articles.flatMap((articleNo) => seqs.get(articleNo) ?? []);
      await tx.wholesaleImportSeen.create({ data: { importId: intoImport, organizationId, seen: seenFromSeqs(found), count: new Set(found).size, confirmedDate: new Date(`${group.seen.confirmedDate}T00:00:00Z`) } });
    }
  }

  // The rows of files (version 3): only under an import made here, since an import Cloud has keeps what it has. The file's newest rows of a supplier are in force as
  // usual; the company's limit holds here too, and a copy that does not fit is refused as a whole.
  for (const group of file.fileRows) {
    const intoImport = importId.get(group.import)!;
    if (!madeHere.has(intoImport)) continue;
    const intoSupplier = supplierId.get(file.imports.find((row) => row.ref === group.import)!.supplier)!;
    const rows = group.rows.map(([articleNo, articleKey, eNumber, rskNumber, gtin, manufacturer, manufacturerArticleNo, name, unit, amount, perQuantity, unitPrice, kind, priceDate, writtenAt, discountGroup, packageSize, orderMultiple, minOrderQuantity, stocked, status]): Prisma.CatalogueFilePriceCreateManyInput => ({
      organizationId, supplierId: intoSupplier, importId: intoImport, wholesaler: group.wholesaler, articleNo, articleKey, eNumber, rskNumber, gtin, manufacturer, manufacturerArticleNo, name, unit,
      ...filePriceColumns({ articleNo, eNumber, rskNumber, gtin, manufacturer, manufacturerArticleNo, name }),
      amount: new Prisma.Decimal(amount), perQuantity, unitPrice: new Prisma.Decimal(unitPrice), priceKind: kind === "B" ? "BASE" : "NET", priceDate: new Date(`${priceDate}T00:00:00Z`), createdAt: new Date(writtenAt), discountGroup, packageSize, orderMultiple, minOrderQuantity, stocked, status }));
    for (const batch of chunks(rows, WHOLESALE_BATCH)) created.fileRows += (await tx.catalogueFilePrice.createMany({ data: batch, skipDuplicates: true })).count;
  }
  if (created.fileRows) await assertCompanyRowLimit(tx, organizationId);

  // Saved mappings: Cloud's own mapping for the same headings wins.
  const mappings = await tx.catalogueImportProfile.createMany({ skipDuplicates: true, data: file.mappings.map((row) => ({ organizationId, supplierId: supplierId.get(row.supplier)!, fingerprint: row.fingerprint, mapping: row.mapping, updatedAt: new Date(row.updatedAt) })) });
  created.mappings = mappings.count;
  // Ett artikelregister (2026-10-12): the added articles join the company's products by their E-nummer or RSK-nummer.
  await linkAllProducts(tx, organizationId);
  return created;
}
