import { articleHitById } from "@/lib/catalogue/server";
import { applyArticle } from "@/lib/catalogue/snapshot";
import { readPriceSettings } from "@/lib/quotes/server";
import type { MaterialRow } from "./expenses";
import { canSeePrices, keepStoredMaterialPrices, withCompanyMarkup } from "./material-prices";
import type { WorkflowPermissionProfile } from "./permissions";
import { keepStoreRows } from "./store-rows";

/**
 * Priser på materialraden (2026-10-09, steg A) when a work order is saved. Someone without the price right never
 * sets or clears a price: the stored rows' prices are kept by row id. An article they picked (`pickedArticleId`) is
 * priced here from the company's own catalogue – the latest price, with the company's markup – exactly as if someone
 * with the right had picked it. The marker is never stored. The rows the store wrote (storeRef) are kept as stored.
 */
export type PriceCaller = { organizationId: string; admin: boolean; permissions: WorkflowPermissionProfile; storageMode: string };

export async function applyMaterialPriceRules<T extends { kind: string; details: unknown }>(caller: PriceCaller, data: T, stored: unknown): Promise<T> {
  if (data.kind !== "WORK_ORDER") return data;
  const details = data.details as { materials: MaterialRow[] };
  const storedRows = (stored && typeof stored === "object" && (stored as { kind?: unknown }).kind === "WORK_ORDER"
    ? ((stored as { details?: { materials?: unknown } }).details?.materials as MaterialRow[] | undefined) : undefined) ?? [];
  // Uttag ur förrådet (2026-10-30): the store's rows are written by the store only; a save keeps them as stored.
  const own = keepStoreRows(details.materials, storedRows);
  let rows = canSeePrices(caller) ? own : keepStoredMaterialPrices(own, storedRows);
  if (rows.some((row) => row.pickedArticleId)) {
    const cloud = caller.storageMode === "HINTEK_CLOUD";
    const markup = cloud ? (await readPriceSettings(caller.organizationId)).markupPercent : "";
    rows = await Promise.all(rows.map(async (row) => {
      if (!row.pickedArticleId) return row;
      const { pickedArticleId, ...rest } = row;
      const hit = cloud ? await articleHitById(caller.organizationId, pickedArticleId) : null;
      return hit ? withCompanyMarkup(applyArticle(rest, { ...hit, priceHidden: false }), markup) : rest;
    }));
  }
  return { ...data, details: { ...details, materials: rows } };
}
