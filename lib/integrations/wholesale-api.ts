import { publicInstance } from "@/lib/instance";
import { solarCatalogue, storedServerKeys } from "@/lib/integrations/server-secrets";
import { serverSetting } from "@/lib/integrations/server-secret-values";
import { fetchSolarProductPage, forgetSolarToken, solarToken, type SolarProductPage } from "@/lib/integrations/solar";
import { WHOLESALER_LABELS, WHOLESALERS, type WholesalerId } from "@/lib/wholesale/model";

/**
 * Grossisternas API-anslutningar (2026-10-17): one interface for the shared register's catalogue imports, a separate
 * adapter per wholesaler. Solar is connected (Procurement Services V1, lib/integrations/solar.ts). Ahlsell, Rexel and
 * Sonepar are prepared but inactive: no documented product API has been made available to Workflow (2026-10-13 and earlier
 * research), so nothing is assumed about their addresses, sign-in or paging – their adapters say so and can never start
 * an import. A price file never waits for an API: without a catalogue its rows are stored as the company's own (lib/catalogue/catalogue-gate.ts).
 *
 * Before any catalogue import – the first full one, a manual one, the scheduled sync – the adapter's `preflight` must pass:
 * the connection is switched on under Installation → Tjänster och nycklar, the keys and the catalogue number
 * are in place, the sign-in works, and the product catalogue answers. Anything missing blocks the import with the reason
 * in plain words. Never a key, a token or a price in any message.
 */
export type ApiPreflight = { ok: true; message: string } | { ok: false; reason: "inactive" | "unavailable" | "no-key" | "no-catalog" | "auth" | "denied" | "unreachable"; message: string };

export type RegisterPageOptions = { limit?: number; nextPage?: string | null; lastChanged?: Date | null; ignoreObsolete?: boolean };

export type WholesaleApiAdapter = {
  wholesaler: WholesalerId;
  label: string;
  /** Whether Workflow has a documented, connected API for this wholesaler at all. */
  available: boolean;
  /** For the row under Tjänster och nycklar: what the integration is and what it waits for. */
  note: string;
  /** Whether the product owner has switched the connection on (always false while unavailable). */
  enabled: () => Promise<boolean>;
  preflight: () => Promise<ApiPreflight>;
  /** One page of the wholesaler's catalogue for the register; the token is the adapter's own business. */
  page: (options: RegisterPageOptions) => Promise<SolarProductPage>;
};

/** The setting that switches a wholesaler's API connection on: "on" or anything else (off) under solarApiEnabled etc. */
export const API_ENABLED_SETTING = { solar: "solarApiEnabled" } as const;

export async function solarApiEnabled(): Promise<boolean> {
  return serverSetting(await storedServerKeys(), "solarApiEnabled") === "on";
}

const solarAdapter: WholesaleApiAdapter = {
  wholesaler: "solar", label: WHOLESALER_LABELS.solar, available: true,
  get note() { return `Ansluten: Procurement Services V1 med klient-id och hemlighet för ${publicInstance().name}. Katalogen (grunddata, utan pris), kategorier och lagersaldo.`; },
  enabled: solarApiEnabled,
  async preflight() {
    if (!(await solarApiEnabled())) return { ok: false, reason: "inactive", message: "Solars API-anslutning är inte aktiverad. Slå på den under Tjänster och nycklar → Solar innan katalogen hämtas." };
    const config = await solarCatalogue();
    if (!config.ok) return config.reason === "no-key"
      ? { ok: false, reason: "no-key", message: "Solars klient-id och hemlighet är inte inlagda." }
      : { ok: false, reason: "no-catalog", message: "Solars katalognummer (catalogId) är inte inlagt." };
    let token: string | null;
    try { token = await solarToken(config); } catch { token = null; }
    if (!token) return { ok: false, reason: "auth", message: `Solar godkände inte klient-id och hemlighet för ${publicInstance().name}.` };
    const probe = await fetchSolarProductPage(token, config, { limit: 1, ignoreObsolete: true });
    if (!probe.ok) {
      if (probe.status === 401) forgetSolarToken();
      return probe.status === 401 || probe.status === 403
        ? { ok: false, reason: "denied", message: `Inloggningen fungerar men behörigheten omfattar inte produktkatalogen ${config.catalogId} (fel ${probe.status}) – kontakta Solar.` }
        : { ok: false, reason: "unreachable", message: `Solars produktkatalog svarar inte just nu (${probe.message})` };
    }
    if (!probe.articles.length) return { ok: false, reason: "unreachable", message: `Solars produktkatalog ${config.catalogId} gav inga artiklar (landskod ${config.countryCode}).` };
    return { ok: true, message: `Solars produktkatalog ${config.catalogId} svarar (landskod ${config.countryCode}).` };
  },
  async page(options) {
    const config = await solarCatalogue();
    if (!config.ok) return { ok: false, status: 0, message: config.reason === "no-key" ? "Solars nyckel är inte inlagd." : "Solars katalognummer är inte inlagt." };
    const token = await solarToken(config);
    if (!token) return { ok: false, status: 401, message: `Solar godkände inte nyckeln för ${publicInstance().name}.` };
    return fetchSolarProductPage(token, config, options);
  },
};

/** A wholesaler without a documented product API: prepared, inactive, never importing. */
const prepared = (wholesaler: Exclude<WholesalerId, "solar">): WholesaleApiAdapter => ({
  wholesaler, label: WHOLESALER_LABELS[wholesaler], available: false,
  note: "Ej ansluten. Prisfiler fungerar ändå: raderna läses in som företagets egna.",
  enabled: async () => false,
  preflight: async () => ({ ok: false, reason: "unavailable", message: `${WHOLESALER_LABELS[wholesaler]} har ingen ansluten API-tjänst – katalogen kan inte hämtas.` }),
  page: async () => ({ ok: false, status: 0, message: `${WHOLESALER_LABELS[wholesaler]} har ingen ansluten API-tjänst.` }),
});

const ADAPTERS: Record<WholesalerId, WholesaleApiAdapter> = { solar: solarAdapter, ahlsell: prepared("ahlsell"), sonepar: prepared("sonepar"), rexel: prepared("rexel") };

export const wholesaleApi = (wholesaler: WholesalerId): WholesaleApiAdapter => ADAPTERS[wholesaler];
export const wholesaleApis = (): WholesaleApiAdapter[] => WHOLESALERS.map((wholesaler) => ADAPTERS[wholesaler]);
