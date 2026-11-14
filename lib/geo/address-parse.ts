import { ADDRESS_SOURCE_NAME } from "@/lib/map/attribution";
import { fromSweref99Tm, sweref99Distance, toSweref99Tm, type Sweref99Tm } from "./sweref99";

/**
 * Reading Lantmäteriet's answer (Belägenhetsadress Direkt v4.2, 2026-10-08): pure functions shared by the server
 * and the unit tests, with nothing from the database or the environment. The address is composed into one line exactly
 * from what Lantmäteriet gives; the postort is the postort and never the kommun.
 */

/** Up to this many metres the pin is taken to be on the address itself; beyond it the answer is a nearby suggestion. */
export const EXACT_WITHIN_M = 30;
/** Beyond this there is no address worth suggesting (a pin in the forest or at sea). */
export const MAX_SUGGESTION_M = 5_000;

export type AddressProposal = {
  /** "Lantmäterigatan 2C" – the street or area with the number, as Lantmäteriet gives it. */
  address: string;
  /** "801 82" – five digits with a space, or empty when Lantmäteriet gave none. */
  postalCode: string;
  /** The postort as given; never the kommun. */
  city: string;
  /** Metres from the pin to the address point. */
  distanceM: number;
  /** The pin lies on the address itself (within EXACT_WITHIN_M). */
  exact: boolean;
  /** Where the address point lies, for showing it next to the pin. */
  point: { latitude: number; longitude: number } | null;
  source: string;
};
export type AddressLookupResult = { found: true; proposal: AddressProposal } | { found: false; reason: string };

export type AddressFeature = {
  geometry?: { type?: string; coordinates?: number[] } | null;
  properties?: {
    adressplatsattribut?: {
      adressplatsbeteckning?: { adressplatsnummer?: string; bokstavstillagg?: string; lagestillagg?: string; lagestillaggsnummer?: number; avvikandeAdressplatsbeteckning?: string; avvikerFranStandarden?: boolean };
      adressplatstyp?: string; postnummer?: number | string; postort?: string; statusForBelagenhetsadress?: string;
    };
    adressplatsnamn?: { popularnamn?: string };
    adressomrade?: { faststalltNamn?: string; kommundel?: { faststalltNamn?: string; kommun?: { kommunnamn?: string } } };
    gardsadressomrade?: { faststalltNamn?: string; adressomrade?: { faststalltNamn?: string } };
  };
};
export type AddressFeatureCollection = { type?: string; features?: AddressFeature[] };

const clean = (value: unknown) => (typeof value === "string" ? value.trim() : "");

/** "801 82" from Lantmäteriet's integer 80182; anything that is not five digits is given back as its digits. */
export function formatPostalCode(value: number | string | undefined | null) {
  const digits = String(value ?? "").replace(/\D/g, "");
  if (!digits) return "";
  return digits.length === 5 ? `${digits.slice(0, 3)} ${digits.slice(3)}` : digits;
}

/**
 * The address line from one feature: the address area (and for a farm address the farm's name) followed by the number
 * with its letter and position suffix, or the deviating designation when the address does not follow the standard.
 * Only what Lantmäteriet actually gives is used – a feature without an area name yields no line.
 */
export function composeAddressLine(feature: AddressFeature) {
  const properties = feature.properties ?? {};
  const designation = properties.adressplatsattribut?.adressplatsbeteckning ?? {};
  const area = clean(properties.adressomrade?.faststalltNamn) || clean(properties.gardsadressomrade?.adressomrade?.faststalltNamn);
  const farm = clean(properties.gardsadressomrade?.faststalltNamn);
  if (!area && !farm) return "";
  let number: string;
  if (designation.avvikerFranStandarden && clean(designation.avvikandeAdressplatsbeteckning)) number = clean(designation.avvikandeAdressplatsbeteckning);
  else {
    number = `${clean(designation.adressplatsnummer)}${clean(designation.bokstavstillagg)}`;
    const position = clean(designation.lagestillagg);
    if (position) number = `${number} ${position}${designation.lagestillaggsnummer ?? ""}`.trim();
  }
  return [area, farm, number].filter(Boolean).join(" ");
}

/** The address point of a feature in SWEREF 99 TM, when it has one. GeoJSON order is x, y – easting, northing. */
export function featurePoint(feature: AddressFeature): Sweref99Tm | null {
  const coordinates = feature.geometry?.type === "Point" && Array.isArray(feature.geometry.coordinates) && feature.geometry.coordinates.length >= 2 ? feature.geometry.coordinates : null;
  return coordinates && Number.isFinite(Number(coordinates[0])) && Number.isFinite(Number(coordinates[1])) ? { easting: Number(coordinates[0]), northing: Number(coordinates[1]) } : null;
}
/** A SWEREF 99 TM point as WGS 84 with six decimals (about a decimetre), the precision a place's position is kept in. */
export function wgs84Of(point: Sweref99Tm) {
  const back = fromSweref99Tm(point);
  return { latitude: Math.round(back.latitude * 1e6) / 1e6, longitude: Math.round(back.longitude * 1e6) / 1e6 };
}

/** The fields one feature gives: the address line, postnummer and postort. Null when it gives none of them. */
function featureFields(feature: AddressFeature) {
  const address = composeAddressLine(feature);
  const attributes = feature.properties?.adressplatsattribut ?? {};
  const postalCode = formatPostalCode(attributes.postnummer);
  const city = clean(attributes.postort);
  return address || postalCode || city ? { address, postalCode, city } : null;
}

/** The first address in Lantmäteriet's answer as a proposal, measured from the pin (SWEREF 99 TM). Null when none. */
export function parseAddressCollection(collection: AddressFeatureCollection, pin: Sweref99Tm): AddressProposal | null {
  const feature = collection.features?.[0];
  if (!feature) return null;
  const fields = featureFields(feature);
  if (!fields) return null;
  const point = featurePoint(feature);
  const distanceM = point ? Math.round(sweref99Distance(pin, point)) : null;
  return {
    ...fields,
    distanceM: distanceM ?? 0,
    exact: distanceM !== null && distanceM <= EXACT_WITHIN_M,
    point: point ? wgs84Of(point) : null,
    source: ADDRESS_SOURCE_NAME,
  };
}

/**
 * One address fetched by its id (GET /{id}, the address chosen among the search suggestions): the fields and the address
 * point converted back to WGS 84 for the pin. Null when the answer holds no address.
 */
export function parseAddressChoice(collection: AddressFeatureCollection): { address: string; postalCode: string; city: string; point: { latitude: number; longitude: number } | null; source: string } | null {
  const feature = collection.features?.[0];
  const fields = feature ? featureFields(feature) : null;
  if (!feature || !fields) return null;
  const point = featurePoint(feature);
  return { ...fields, point: point ? wgs84Of(point) : null, source: ADDRESS_SOURCE_NAME };
}

/** What the person is told when there is a proposal far away or none at all. */
export function judgeProposal(proposal: AddressProposal | null): AddressLookupResult {
  if (!proposal) return { found: false, reason: "Lantmäteriet har ingen adress för den här punkten." };
  if (proposal.distanceM > MAX_SUGGESTION_M) return { found: false, reason: `Närmaste adresspunkt ligger ${(proposal.distanceM / 1000).toLocaleString("sv-SE", { maximumFractionDigits: 1 })} km bort, så inget förslag ges.` };
  return { found: true, proposal };
}

/**
 * Loopback QA only (kfid_v3_test, KFID_LOCAL_ROLE_QA), like the map's sample GeoPackage: a fixed synthetic address at
 * one point in Göteborg stands in for Lantmäteriet, so the whole flow – fetch, proposal, nearby mark, fill, attribution –
 * is tested without any call to Lantmäteriet. The server uses it only when the QA flag is on.
 */
export const QA_ADDRESS_POINT = { latitude: 57.7089, longitude: 11.9746 };
export const QA_ADDRESS = { address: "Provgatan 1", postalCode: "123 45", city: "Provstad" };
export function qaAddressLookup(latitude: number, longitude: number): AddressLookupResult {
  const pin = toSweref99Tm(latitude, longitude);
  const point = toSweref99Tm(QA_ADDRESS_POINT.latitude, QA_ADDRESS_POINT.longitude);
  const distanceM = Math.round(sweref99Distance(pin, point));
  return judgeProposal({ ...QA_ADDRESS, distanceM, exact: distanceM <= EXACT_WITHIN_M, point: QA_ADDRESS_POINT, source: `${ADDRESS_SOURCE_NAME} (QA-exempel)` });
}
