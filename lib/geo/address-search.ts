import { ADDRESS_SOURCE_NAME } from "@/lib/map/attribution";
import { formatPostalCode, QA_ADDRESS, QA_ADDRESS_POINT } from "./address-parse";

/**
 * Adressökning medan man skriver (2026-10-15): pure helpers shared by the browser field, the server route and the
 * unit tests – nothing here talks to Lantmäteriet, so the browser may import it. Belägenhetsadress Direkt v4.2 finds
 * addresses by free text (GET /referens/fritext: a search string of 3–300 characters, answered with references –
 * objektidentitet, the address as a label and, with splitAdress, its parts); a chosen reference is then fetched by its id
 * (GET /{id}) for the exact fields and the address point.
 */

/** Lantmäteriet takes a search string of at least three characters; the field asks no sooner. */
export const ADDRESS_SEARCH_MIN = 3;
/** Lantmäteriet's upper bound is 300; an address line is far shorter, so the field never sends more than this. */
export const ADDRESS_SEARCH_MAX = 120;
/** How many suggestions are asked for and shown under the field. */
export const ADDRESS_SEARCH_HITS = 8;
/** The field waits this long after the last key before it asks, so typing a word is one question, not one per letter. */
export const ADDRESS_SEARCH_DEBOUNCE_MS = 350;

/** The text to search for, or null when it is too short to ask about: trimmed, inner spaces collapsed, capped. */
export function addressSearchText(text: string): string | null {
  const cleaned = text.replace(/\s+/g, " ").trim().slice(0, ADDRESS_SEARCH_MAX).trim();
  return cleaned.length >= ADDRESS_SEARCH_MIN ? cleaned : null;
}

/** One suggestion under the field. `id` is Lantmäteriet's objektidentitet, used to fetch the chosen address. */
export type AddressSuggestion = {
  id: string;
  /** The address as Lantmäteriet labels it, shown as the suggestion's text. */
  label: string;
  /** Street (or area) with the number, composed from the parts when Lantmäteriet gave them; otherwise empty. */
  address: string;
  postalCode: string;
  city: string;
};

/** The chosen address with what the place form fills: street and number, postnummer, postort and the point (WGS 84). */
export type AddressChoice = {
  address: string; postalCode: string; city: string;
  point: { latitude: number; longitude: number } | null;
  source: string;
};

export type AddressComponents = {
  kommun?: string; kommundel?: string; adressomrade?: string; gardsadressomrade?: string;
  adressplatsnummer?: string; bokstavstillagg?: string; lagestillagg?: string; lagestillaggsnummer?: number;
  avvikandeAdressplatsbeteckning?: string; postnummer?: number | string; postort?: string;
};
export type AddressReference = { objektidentitet?: string; adress?: string; adressComponents?: AddressComponents };

const clean = (value: unknown) => (typeof value === "string" ? value.trim() : "");
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const isAddressId = (value: unknown): value is string => typeof value === "string" && UUID.test(value);

/** The street line from a reference's parts, as composeAddressLine does for a whole address: area, farm, number. */
export function composeFromComponents(parts: AddressComponents | undefined) {
  if (!parts) return "";
  const area = clean(parts.adressomrade);
  const farm = clean(parts.gardsadressomrade);
  if (!area && !farm) return "";
  let number = clean(parts.avvikandeAdressplatsbeteckning);
  if (!number) {
    number = `${clean(parts.adressplatsnummer)}${clean(parts.bokstavstillagg)}`;
    const position = clean(parts.lagestillagg);
    if (position) number = `${number} ${position}${parts.lagestillaggsnummer ?? ""}`.trim();
  }
  return [area, farm, number].filter(Boolean).join(" ");
}

/** Lantmäteriet's references as suggestions: only those with an id and a label, at most `limit`, no duplicates. */
export function parseAddressReferences(answer: unknown, limit = ADDRESS_SEARCH_HITS): AddressSuggestion[] {
  if (!Array.isArray(answer)) return [];
  const seen = new Set<string>();
  const out: AddressSuggestion[] = [];
  for (const item of answer as AddressReference[]) {
    if (!item || typeof item !== "object" || !isAddressId(item.objektidentitet) || !clean(item.adress) || seen.has(item.objektidentitet)) continue;
    seen.add(item.objektidentitet);
    out.push({
      id: item.objektidentitet, label: clean(item.adress),
      address: composeFromComponents(item.adressComponents),
      postalCode: formatPostalCode(item.adressComponents?.postnummer),
      city: clean(item.adressComponents?.postort),
    });
    if (out.length >= limit) break;
  }
  return out;
}

/**
 * Loopback QA only, like qaAddressLookup: the synthetic Provgatan answers any search starting with "prov", and its id
 * gives the fixed QA point – so the field, the pick and the pin are tested without any call to Lantmäteriet.
 */
export const QA_ADDRESS_ID = "00000000-0000-4000-8000-000000000001";
export function qaAddressSearch(text: string): AddressSuggestion[] {
  const query = addressSearchText(text);
  if (!query || !query.toLowerCase().startsWith("prov")) return [];
  return [{ id: QA_ADDRESS_ID, label: `${QA_ADDRESS.address}, ${QA_ADDRESS.postalCode} ${QA_ADDRESS.city}`, ...QA_ADDRESS }];
}
export function qaAddressById(id: string): AddressChoice | null {
  return id === QA_ADDRESS_ID ? { ...QA_ADDRESS, point: QA_ADDRESS_POINT, source: `${ADDRESS_SOURCE_NAME} (QA-exempel)` } : null;
}

/**
 * Adress och kartnål i takt (2026-10-24): an address the person types (without choosing a suggestion) moves the
 * pin too. A moment after the last key the typed street with postnummer and/or postort is searched, and the pin follows
 * only a suggestion that is the same address – same street and number, and the same postnummer and postort where both
 * are given – so a half-typed or different address never moves it.
 */
export const ADDRESS_GEOCODE_DELAY_MS = 1200;
type TypedAddress = { address: string; postalCode: string; city: string };
const streetKey = (value: string) => value.toLocaleLowerCase("sv-SE").replace(/[\s.,]+/g, "");
const digits = (value: string) => value.replace(/\D/g, "");
/** The text to search for a typed address, or null when it is not yet an address: a street and a postnummer or postort. */
export function geocodeText(fields: TypedAddress): string | null {
  const street = fields.address.replace(/\s+/g, " ").trim();
  const postal = fields.postalCode.trim();
  const city = fields.city.trim();
  if (street.length < ADDRESS_SEARCH_MIN || !/\p{L}/u.test(street) || (digits(postal).length !== 5 && city.length < 2)) return null;
  return addressSearchText([street, [postal, city].filter(Boolean).join(" ")].filter(Boolean).join(", "));
}
/** The suggestion that is the typed address itself, or null. */
export function geocodeMatch(fields: TypedAddress, suggestions: AddressSuggestion[]): AddressSuggestion | null {
  const street = streetKey(fields.address);
  const postal = digits(fields.postalCode);
  const city = fields.city.trim().toLocaleLowerCase("sv-SE");
  if (!street) return null;
  return suggestions.find((suggestion) => streetKey(suggestion.address) === street
    && (!postal || !digits(suggestion.postalCode) || digits(suggestion.postalCode) === postal)
    && (!city || !suggestion.city || suggestion.city.trim().toLocaleLowerCase("sv-SE") === city)) ?? null;
}
