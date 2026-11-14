import { NextResponse } from "next/server";
import { WHOLESALERS } from "@/lib/wholesale/model";
import { z } from "zod";
import { body, checkOrigin, context, failure, requireCloudWriteAccess, requireModule, type Context } from "@/lib/kfid/server";
import { articlePriceHistory, CATALOGUE_FILTERS, catalogueIsEmpty, catalogueOverview, deleteCatalogueImport, deleteSupplier, searchArticlesForTool, searchCatalogue, TOOL_ARTICLE_LIMIT, TOOL_HISTORY_LIMIT, updateSupplier, type CatalogueFilter } from "@/lib/catalogue/server";
import { catalogueAccess, requireCatalogue, type CatalogueCaller } from "@/lib/catalogue/access";
import { todayInSweden } from "@/lib/catalogue/snapshot";
import { importCatalogueFile } from "@/lib/catalogue/import-file";
import { formJson, MAX_PRICE_FILE_BYTES, openUploadedPriceFile, priceFormatSchema, priceParseSchema, readRebateFile, uploadedText } from "@/lib/catalogue/request";
import { importRebateFile } from "@/lib/catalogue/rebate-server";
import { readLimitedFormData } from "@/lib/security/limited-body";
import { ApiError } from "@/lib/kfid/errors";
import { canSeePrices } from "@/lib/workflow/material-prices";
import { identifierOfQuery, joinMasterData, lookupMasterData } from "@/lib/catalogue/master-data";
import { solarStockFor } from "@/lib/catalogue/solar-stock";
import { productInfoOfMaster, type ProductInfo } from "@/lib/catalogue/product-info";
import { signedProductImage } from "@/lib/catalogue/product-image";
import { solarStatusText } from "@/lib/integrations/solar";
import { solarCatalogue } from "@/lib/integrations/server-secrets";
import { hitRateLimit, RATE_RULES } from "@/lib/security/rate-limit";
import { gtinOf } from "@/lib/catalogue/normalize";
import { searchWithRegister } from "@/lib/catalogue/register-search";
import type { CatalogueHit } from "@/lib/catalogue/snapshot";

export const dynamic = "force-dynamic";

/**
 * Artiklar och priser, steg 1 (2026-10-08). GET ?search= searches the catalogue for a work order's material row
 * (catalogue:read or work-order:edit); GET ?articles= (&supplier= &limit=) and ?history=<articleId> (&limit=) are the
 * read tools search_articles and get_article_price_history (2026-10-08, catalogue:read, bounded); GET otherwise is the
 * catalogue page (?q= &supplierId= &page=) (catalogue:read); ?history= takes a supplier's own article, or a wholesaler's catalogue article
 * (2026-10-17: its "W:<wholesaler>:<number>" key, the register's id, or the id of the company's offer on it, lib/catalogue/server.ts). POST imports a price file
 * read on the Import page, removes an import or changes a supplier (catalogue:edit, Cloud write access, Origin). The
 * import is a multipart upload of the file itself (prisfiler etapp 1, 2026-10-12: up to 500 000 rows and 60 MB, read
 * as a stream with how the file is read – headings, fixed-width positions, price scale – sent beside it), read and
 * parsed here; nothing the browser computed is trusted. Cloud only – a Local company is told so. GET ?search= takes
 * &supplierId= to search one supplier's articles (the product still shows every supplier's offer).
 */
/** The catalogue's product for a search that is a whole E-nummer or GTIN no price file has, with the company's hits for it. */
async function catalogueLookup(organizationId: string, query: string, hits: CatalogueHit[]) {
  const identifier = identifierOfQuery(query);
  if (!identifier) return { solar: "not-number" as const };
  const known = hits.some((hit) => [hit, ...(hit.offers ?? [])].some((offer) => (identifier.kind === "electricalNumber" ? offer.eNumber === identifier.value : gtinOf(offer.gtin ?? "") === gtinOf(identifier.value))));
  if (known) return { solar: "known" as const };
  // The company's share of the installation's Solar key: over it the search still answers from its own articles.
  if (!(await hitRateLimit(RATE_RULES.solarOrganization, organizationId)).allowed) return { solar: "unavailable" as const };
  const found = await lookupMasterData(identifier);
  if (found.status !== "found") return { solar: found.status === "not-found" ? "not-found" as const : "unavailable" as const };
  const again = await joinMasterData(organizationId, found.data);
  const more = again && again !== query.trim() ? await searchCatalogue(organizationId, again, 20) : [];
  const { fetchedAt, ...data } = found.data;
  void fetchedAt;
  return { solar: "found" as const, data: signedProductImage({ ...data, inPriceFiles: hits.length + more.length > 0 }), more };
}

const signedInfo = (info: ProductInfo | null) => (info ? signedProductImage(info) : null);
const caller = (ctx: Context): CatalogueCaller =>({ organizationId: ctx.organizationId, userId: ctx.user.id, admin: ctx.admin, permissions: ctx.workflowPermissions, storageMode: ctx.organization.storageMode });
const noStore = { "Cache-Control": "private, no-store" };
const SOLAR_COMPANY_LIMIT_TEXT = "Företaget har gjort många frågor till Solar den senaste timmen. Försök igen om en stund.";

export async function GET(request: Request) {
  try {
    const ctx = await context();
    const who = caller(ctx);
    const url = new URL(request.url);
    // Lagersaldo hos Solar (2026-10-15): ?stock=<E-nummer,…> for the hits an article search shows – read only,
    // the same right as the search, near the company's postal code; never a price.
    const stockList = url.searchParams.get("stock");
    if (stockList !== null) {
      requireCatalogue(who, "pick");
      const eNumbers = stockList.split(",").map((value) => value.trim()).filter((value) => /^\d{7}$/.test(value)).slice(0, 20);
      if (!eNumbers.length) return NextResponse.json({ available: true, stock: {} }, { headers: noStore });
      if (!(await hitRateLimit(RATE_RULES.solarStockUser, ctx.user.id)).allowed) return NextResponse.json({ available: true, stock: {}, message: "För många lagerfrågor just nu." }, { headers: noStore });
      if (!(await hitRateLimit(RATE_RULES.solarOrganization, ctx.organizationId)).allowed) return NextResponse.json({ available: true, stock: {}, message: SOLAR_COMPANY_LIMIT_TEXT }, { headers: noStore });
      return NextResponse.json(await solarStockFor(ctx.organizationId, eNumbers), { headers: noStore });
    }
    const search = url.searchParams.get("search");
    if (search !== null) {
      requireCatalogue(who, "pick");
      // Priser på materialraden (2026-10-09): someone who may not see prices picks the article without its price; the
      // server copies the price into the row when the work order is saved (lib/workflow/material-prices-server.ts).
      const prices = canSeePrices({ admin: ctx.admin, permissions: ctx.workflowPermissions });
      const supplierId = z.string().max(100).optional().parse(url.searchParams.get("supplierId") || undefined);
      // Det gemensamma artikelregistret (2026-10-17): the company's price files and Solar's catalogue searched together,
      // merged per product; a product the company has no price for is a hit without a price. Without register articles (or with
      // a supplier chosen) it is the company's own search as before.
      const query = search.trim().slice(0, 120);
      const found = query.length >= 2 ? await searchWithRegister(ctx.organizationId, query, { supplierId, limit: 20 }) : { hits: [] as CatalogueHit[], register: false };
      let articles = found.hits;
      // Grossistens katalog (2026-10-14): a whole E-nummer or GTIN that no price file has is looked up in Solar's catalogue
      // (master data only, never a price) and joined to the same product in the company's price files – only while the
      // register is empty: with it the number is found in the register itself, with no call to Solar per search.
      const external = found.register ? { solar: "known" as const } : await catalogueLookup(ctx.organizationId, query, articles);
      if (external.solar === "found" && external.more.length) articles = [...articles, ...external.more.filter((hit) => !articles.some((item) => item.id === hit.id))].slice(0, 20);
      // Utan prisfil (2026-10-16: "det ska inte behövas"): whether Solar's catalogue can be asked at all, so the search
      // says "write a whole E-nummer or EAN" instead of asking for a price file.
      const solarReady = (await solarCatalogue()).ok;
      // An empty answer says whether the catalogue itself is empty (2026-10-11), so the search can point to Import instead of
      // only saying "no hit"; `canImport` is whether this person may import a price file.
      const empty = articles.length === 0 ? await catalogueIsEmpty(ctx.organizationId) : false;
      // A register article without a price file has no price to hide: it is never marked as hidden (the server would price it on save).
      return NextResponse.json({ articles: prices ? articles : articles.map((hit) => (hit.catalogOnly ? hit : { ...hit, price: null, priceHidden: true, offers: hit.offers?.map((offer) => ({ ...offer, price: null })) })), today: todayInSweden(),
        ...(external.solar === "found" ? { external: external.data } : {}), solar: solarReady ? external.solar : "off", ...(empty ? { catalogueEmpty: true, canImport: catalogueAccess(who).edit } : {}) }, { headers: noStore });
    }
    // Grunddata för en vald artikel (2026-10-14): the product picked learns the catalogue's master data; nothing else changes.
    const master = url.searchParams.get("master");
    if (master !== null) {
      requireCatalogue(who, "pick");
      // A register article (2026-10-17) is asked for by Solar's own article number (&kind=sap), whatever its length.
      const sap = url.searchParams.get("kind") === "sap" && /^\d{1,20}$/.test(master.trim()) ? master.trim() : "";
      const identifier = sap ? { kind: "sapMaterialNumber" as const, value: sap } : identifierOfQuery(master.slice(0, 40));
      // A hit's thumbnail asks per article that comes into view (2026-10-18): a flood is answered as "not found", quietly.
      if (identifier && !(await hitRateLimit(RATE_RULES.solarMasterUser, ctx.user.id)).allowed) return NextResponse.json({ found: false }, { headers: noStore });
      if (identifier && !(await hitRateLimit(RATE_RULES.solarOrganization, ctx.organizationId)).allowed) return NextResponse.json({ found: false, message: SOLAR_COMPANY_LIMIT_TEXT }, { headers: noStore });
      const found = identifier ? await lookupMasterData(identifier) : { status: "not-found" as const };
      if (found.status === "found") await joinMasterData(ctx.organizationId, found.data);
      // The facts the article list shows (2026-10-17: Solar is asked once the article is chosen), beside the raw data.
      return NextResponse.json({ found: found.status === "found", ...(found.status === "found" ? { data: found.data, product: signedInfo(productInfoOfMaster(found.data, solarStatusText)) } : {}) }, { headers: noStore });
    }
    const limit = (max: number, fallback: number) => Math.max(1, Math.min(max, Math.trunc(Number(url.searchParams.get("limit"))) || fallback));
    const articles = url.searchParams.get("articles");
    if (articles !== null) {
      requireCatalogue(who, "read");
      const found = await searchArticlesForTool(ctx.organizationId, { query: articles, supplier: url.searchParams.get("supplier") ?? "", limit: limit(TOOL_ARTICLE_LIMIT, 10) });
      return NextResponse.json({ ...found, pricesExcludeVat: true, today: todayInSweden() }, { headers: noStore });
    }
    const history = url.searchParams.get("history");
    if (history !== null) {
      requireCatalogue(who, "read");
      const articleId = z.string().min(1).max(100).parse(history);
      return NextResponse.json({ ...(await articlePriceHistory(ctx.organizationId, articleId, limit(TOOL_HISTORY_LIMIT, 20))), pricesExcludeVat: true, today: todayInSweden() }, { headers: noStore });
    }
    const q = (url.searchParams.get("q") ?? "").slice(0, 120);
    requireCatalogue(who, "read");
    const supplierId = z.string().max(100).optional().parse(url.searchParams.get("supplierId") || undefined);
    const page = Number(url.searchParams.get("page")) || 1;
    // Omatchade / saknas i senaste prisfilen (2026-10-15): an unknown value is no filter.
    const filterParam = url.searchParams.get("filter") ?? "";
    const filter: CatalogueFilter = (CATALOGUE_FILTERS as readonly string[]).includes(filterParam) ? filterParam as CatalogueFilter : "";
    return NextResponse.json({ ...(await catalogueOverview(ctx.organizationId, { supplierId, q, page, filter })), access: catalogueAccess(who), today: todayInSweden() }, { headers: noStore });
  } catch (error) {
    return failure(error);
  }
}

const mappingSchema = z.record(z.string().max(40), z.string().max(200).nullable());
/** The choices sent with the file, as the form field "options" (JSON). */
const importSchema = z.object({
  supplier: z.union([z.object({ id: z.string().min(1).max(100) }), z.object({ name: z.string().trim().min(1, "Skriv leverantörens namn.").max(120), customerNumber: z.string().max(60).default(""), wholesaler: z.enum(WHOLESALERS).nullable().optional() })]),
  mapping: mappingSchema.default({}),
  // Rabattbrev (2026-10-14): the file is a discount letter, read as rules for the supplier instead of as a price list.
  kind: z.enum(["prices", "rebate"]).default("prices"),
  updateNames: z.boolean().default(false),
  saveProfile: z.boolean().default(true),
});
const requestSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("delete_import"), id: z.string().min(1).max(100) }),
  z.object({ action: z.literal("update_supplier"), id: z.string().min(1).max(100), name: z.string().max(120), customerNumber: z.string().max(60).default(""), wholesaler: z.enum(WHOLESALERS).nullable().optional() }),
  z.object({ action: z.literal("delete_supplier"), id: z.string().min(1).max(100) }),
]);

export async function POST(request: Request) {
  try {
    checkOrigin(request);
    const ctx = await context();
    const who = caller(ctx);
    requireCatalogue(who, "edit");
    await requireCloudWriteAccess(ctx);
    requireModule(ctx, "purchasing");
    if ((request.headers.get("content-type") ?? "").includes("multipart/form-data")) {
      const form = await readLimitedFormData(request, MAX_PRICE_FILE_BYTES + 1_000_000);
      const file = form.get("file");
      if (!(file instanceof File)) throw new ApiError(400, "Välj en prisfil.");
      let raw: unknown;
      try { raw = JSON.parse(String(form.get("options") ?? "")); } catch { throw new ApiError(400, "Ogiltiga val för importen."); }
      const options = importSchema.parse(raw);
      if (options.kind === "rebate") {
        const read = await readRebateFile(file, todayInSweden());
        if (!read) throw new ApiError(400, "Fel fil – det här är inget rabattbrev eller avtalsfil som kan läsas.");
        return NextResponse.json(await importRebateFile(who, { supplier: options.supplier, fileName: file.name, text: await uploadedText(file), read }));
      }
      const format = formJson(form, "format", priceFormatSchema);
      const price = await openUploadedPriceFile(file, format);
      if (!price.info.headers.length) throw new ApiError(400, "Prisfilen har inga kolumner.");
      const result = await importCatalogueFile(who, { supplier: options.supplier, file: price, mapping: options.mapping, parse: formJson(form, "parse", priceParseSchema), format, updateNames: options.updateNames, saveProfile: options.saveProfile }, todayInSweden());
      return NextResponse.json(result);
    }
    const input = requestSchema.parse(await body(request));
    if (input.action === "delete_import") return NextResponse.json(await deleteCatalogueImport(who, input.id));
    if (input.action === "update_supplier") { await updateSupplier(who, input.id, input); return NextResponse.json({ ok: true }); }
    await deleteSupplier(who, input.id);
    return NextResponse.json({ ok: true });
  } catch (error) {
    return failure(error);
  }
}
