import { prisma } from "@/lib/db";
import { publicInstance } from "@/lib/instance";
import { saveServerSetting, solarCredentials } from "@/lib/integrations/server-secrets";
import { solarApiEnabled } from "@/lib/integrations/wholesale-api";
import { fetchSolarCategories, probeSolarCountryCode, solarToken, type SolarCategory, type SolarCategoryFetch } from "@/lib/integrations/solar";

/**
 * Solars kategorier (2026-10-15): the product owner fetches Solar's whole category tree under Servernycklar and
 * it is kept once, in the global SolarCategory table – Workflow product data, the same for every company, never copied
 * per organization. The fetch is all or nothing: the stored categories change only after every page arrived, then
 * every category is written and those Solar no longer returned are removed, in one transaction.
 */

const CHUNK = 1000;

/** Writes a complete fetch: upserts every category stamped `now`, then removes the rows the fetch did not touch. */
export async function storeSolarCategories(categories: SolarCategory[], countryCode: string, now = new Date()): Promise<{ stored: number; removed: number }> {
  return prisma.$transaction(async (tx) => {
    for (let start = 0; start < categories.length; start += CHUNK) {
      const part = categories.slice(start, start + CHUNK);
      await tx.$executeRaw`
        INSERT INTO "SolarCategory" ("id", "name", "displayName", "imageUrl", "etimClass", "etimName", "parent", "countryCode", "fetchedAt")
        SELECT item.*, ${countryCode}::text, ${now}::timestamp(3)
        FROM unnest(${part.map((c) => c.id)}::int[], ${part.map((c) => c.name)}::text[], ${part.map((c) => c.displayName)}::text[],
                    ${part.map((c) => c.imageUrl)}::text[], ${part.map((c) => c.etimClass)}::text[], ${part.map((c) => c.etimName)}::text[],
                    ${part.map((c) => c.parent)}::text[]) AS item
        ON CONFLICT ("id") DO UPDATE SET "name" = EXCLUDED."name", "displayName" = EXCLUDED."displayName", "imageUrl" = EXCLUDED."imageUrl",
          "etimClass" = EXCLUDED."etimClass", "etimName" = EXCLUDED."etimName", "parent" = EXCLUDED."parent",
          "countryCode" = EXCLUDED."countryCode", "fetchedAt" = EXCLUDED."fetchedAt"`;
    }
    const removed = await tx.solarCategory.deleteMany({ where: { fetchedAt: { lt: now } } });
    return { stored: categories.length, removed: removed.count };
  }, { timeout: 120_000 });
}

/** How many categories are stored and when they were fetched, for the line under Servernycklar. */
export async function solarCategoryStatus(): Promise<{ count: number; fetchedAt: string | null }> {
  const result = await prisma.solarCategory.aggregate({ _count: { _all: true }, _max: { fetchedAt: true } });
  return { count: result._count._all, fetchedAt: result._max.fetchedAt?.toISOString() ?? null };
}

type Deps = {
  /** The switch "API-anslutning" under Tjänster och nycklar; off = nothing is fetched (the same switch as the register import). */
  enabled: () => Promise<boolean>;
  credentials: typeof solarCredentials;
  /** Finds the country code when no check has yet: the same probe as Kontrollera. */
  probe: () => Promise<{ countryCode: string } | { message: string }>;
  fetchAll: (credentials: { clientId: string; clientSecret: string }, countryCode: string) => Promise<SolarCategoryFetch>;
  store: typeof storeSolarCategories;
  saveCountryCode: (countryCode: string) => Promise<void>;
};

let running = false;

/**
 * "Hämta kategorier": the country code the check found (or found now, and kept), every page of Get Categories, and – only
 * when all of it succeeded – the global table replaced. One fetch at a time per server process.
 */
export async function syncSolarCategories(actor: string, deps: Partial<Deps> = {}): Promise<{ ok: boolean; message: string }> {
  const use: Deps = {
    enabled: solarApiEnabled,
    credentials: solarCredentials,
    probe: async () => {
      const solar = await solarCredentials();
      if (!solar.ok) return { message: "Solarnyckeln är inte inlagd." };
      const token = await solarToken(solar);
      if (!token) return { message: `Solar godkände inte nyckeln för ${publicInstance().name}.` };
      const probe = await probeSolarCountryCode(token);
      return probe.status === "accepted" ? { countryCode: probe.countryCode } : { message: probe.status === "denied" ? "Solar gav inte tillgång till katalogen." : "Katalogen godtog ingen landskod – kör Kontrollera." };
    },
    fetchAll: (credentials, countryCode) => fetchSolarCategories(credentials, countryCode),
    store: storeSolarCategories,
    saveCountryCode: (countryCode) => saveServerSetting("solarCountryCode", countryCode, actor),
    ...deps,
  };
  if (!(await use.enabled())) return { ok: false, message: "Slå på API-anslutningen först." };
  if (running) return { ok: false, message: "Kategorierna hämtas redan – vänta tills det är klart." };
  running = true;
  try {
    const solar = await use.credentials();
    if (!solar.ok) return { ok: false, message: "Lägg in Solars klient-id och hemlighet först." };
    let countryCode = solar.countryCode;
    if (!solar.countryVerified) {
      const found = await use.probe();
      if ("message" in found) return { ok: false, message: `${found.message} Inget ändrades.` };
      countryCode = found.countryCode;
      await use.saveCountryCode(countryCode);
    }
    const fetched = await use.fetchAll(solar, countryCode);
    if (!fetched.ok) return { ok: false, message: `${fetched.message} De sparade kategorierna är orörda.` };
    const { stored, removed } = await use.store(fetched.categories, countryCode);
    const count = (value: number) => value.toLocaleString("sv-SE");
    return {
      ok: true,
      message: `${count(stored)} kategorier hämtade från Solar (${fetched.pages} ${fetched.pages === 1 ? "sida" : "sidor"}, landskod ”${countryCode}”)${removed ? `, ${count(removed)} som Solar inte längre har togs bort` : ""}${fetched.skipped ? `, ${count(fetched.skipped)} utan id eller namn hoppades över` : ""}.`,
    };
  } finally {
    running = false;
  }
}
