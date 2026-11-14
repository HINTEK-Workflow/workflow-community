import { prisma } from "@/lib/db";
import { companyProfileSchema } from "@/lib/kfid/company";
import { solarCredentials } from "@/lib/integrations/server-secrets";
import { fetchSolarStock, SOLAR_ATP_BATCH, type SolarStock } from "@/lib/integrations/solar";

/**
 * Lagersaldo hos Solar (2026-10-15): the stock Solar promises near the company's own postal code (Företaget's
 * address), for the E-numbers an article search shows. Asked with Workflow's one key; kept in memory for ten minutes per
 * postal code and E-number, so typing in the search never asks Solar for the same article twice. Never a price.
 */
const KEEP_MS = 10 * 60 * 1000;
const kept = new Map<string, { item: SolarStock | null; at: number }>();
const MAX_KEPT = 5_000;

export type StockAnswer = { available: false; reason: "no-key" | "no-postal-code" } | { available: true; stock: Record<string, SolarStock | null>; message?: string };

/** The company's postal code, the place Solar's stock is promised for ("" when Företaget has none). */
async function companyPostalCode(organizationId: string) {
  const settings = await prisma.workspaceSettings.findUnique({ where: { organizationId }, select: { profile: true } });
  const parsed = companyProfileSchema.safeParse(settings?.profile ?? {});
  return parsed.success ? parsed.data.postalCode.replace(/\s+/g, "") : "";
}

export async function solarStockFor(organizationId: string, eNumbers: readonly string[], ask = fetchSolarStock, now = Date.now()): Promise<StockAnswer> {
  const credentials = await solarCredentials();
  if (!credentials.ok) return { available: false, reason: "no-key" };
  const postalCode = await companyPostalCode(organizationId);
  if (!/^\d{5}$/.test(postalCode)) return { available: false, reason: "no-postal-code" };
  const wanted = [...new Set(eNumbers.filter((value) => /^\d{7}$/.test(value)))].slice(0, SOLAR_ATP_BATCH);
  const stock: Record<string, SolarStock | null> = {};
  const missing: string[] = [];
  for (const eNumber of wanted) {
    const hit = kept.get(`${postalCode}|${eNumber}`);
    if (hit && now - hit.at < KEEP_MS) stock[eNumber] = hit.item;
    else missing.push(eNumber);
  }
  if (!missing.length) return { available: true, stock };
  const answer = await ask(credentials, missing, postalCode);
  if (answer.status === "error") return { available: true, stock, message: answer.message };
  const byNumber = new Map(answer.items.map((item) => [item.productId || item.eNumber, item]));
  if (kept.size > MAX_KEPT) kept.clear();
  for (const eNumber of missing) {
    const item = byNumber.get(eNumber) ?? null;
    kept.set(`${postalCode}|${eNumber}`, { item, at: now });
    stock[eNumber] = item;
  }
  return { available: true, stock };
}
