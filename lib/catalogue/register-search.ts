import { searchMerged } from "@/lib/catalogue/search";
import type { CatalogueHit } from "@/lib/catalogue/snapshot";

/**
 * Artikelsöket med det gemensamma registret (2026-10-17): the company's own articles and the shared, price-free
 * register searched together, merged per product (lib/catalogue/search.ts `searchMerged`, scope "all"). A register article the
 * company has a price on (its price file from a wholesaler with a catalogue is stored as price rows on the register's article,
 * priser mot katalogartikeln) is a normal priced hit with one offer per supplier of the company; one it has no price on is the
 * wholesaler's own row without a price. A register article that is the same product as an article of the company's own suppliers
 * (the same E-nummer, GTIN or manufacturer's number – or, at the company's supplier that is that wholesaler, the wholesaler's own
 * article number) joins that hit. The list is ranked by the same score on both sides; at a tie a hit with a price comes first. No
 * API call per hit: the list comes from the database only, and the wholesaler is asked for picture, features and stock when an
 * article is chosen. The register's rows themselves are read in lib/catalogue/register-rows.ts.
 */
export { companyArticlesForRegister, forgetRegisterPresence, registerHasArticles, searchRegisterRows } from "@/lib/catalogue/register-rows";

/**
 * The article search with the register: the company's own hits and the register's, merged per product, at most `limit`.
 * With a supplier chosen the search is that supplier's price files only – its own articles and the register articles it has a
 * price on – as before. Without any register article it is the company's own search exactly as before.
 */
export async function searchWithRegister(organizationId: string, query: string, options: { supplierId?: string | null; limit?: number } = {}): Promise<{ hits: CatalogueHit[]; total: number; fuzzy: boolean; register: boolean }> {
  return searchMerged(organizationId, query, { ...options, scope: "all" });
}
