import { localRoleQaEnabled } from "@/lib/auth/access";
import { prisma } from "@/lib/db";
import { centralSecrets, saveCentralSecret, type CentralActor } from "@/lib/secrets/central-store";
import { mapSignIn } from "@/lib/map/topowebb";
import { chooseAddressMethod, clearAddressTokens, createAddressClient, LookupError, type AddressAuth, type AddressEnvironment, type AddressMethod } from "./address-api";
import { judgeProposal, qaAddressLookup, type AddressLookupResult } from "./address-parse";
import { qaAddressById, qaAddressSearch, type AddressChoice, type AddressSuggestion } from "./address-search";

export type { AddressLookupResult, AddressProposal } from "./address-parse";
export { LookupError } from "./address-api";

/**
 * Adresser från Lantmäteriet (2026-10-08, sign-in and search 2026-10-15): Belägenhetsadress Direkt v4.2 – the
 * nearest address to a pin, and address search while typing. The calls live in address-api.ts; this module keeps the
 * installation's sign-in, sealed in SystemSettings.map.addressLookup (the map's own settings in the same JSON are left as
 * they are), and never lets a value reach the browser.
 *
 * Three ways to sign in, as the product allows: the map's Geotorget account ("Samma inloggning som kartan", HTTP Basic),
 * a user name and password of its own (Basic), or the API portal's consumer key and secret (OAuth 2). Credentials saved
 * before 2026-10-15 were always OAuth keys and keep working as such.
 *
 * A lookup happens only on a signed-in person's action (setting a pin, typing an address, choosing a suggestion); nothing
 * from an answer is kept beyond what the person saves on the place, and neither the typed text nor coordinates are logged.
 */
export const ADDRESS_ENVIRONMENTS = ["verification", "production"] as const;
export type { AddressEnvironment } from "./address-api";
export const ADDRESS_ENVIRONMENT_LABELS: Record<AddressEnvironment, string> = { verification: "Verifiering", production: "Produktion" };
export const ADDRESS_METHODS = ["map", "basic", "oauth"] as const satisfies readonly AddressMethod[];
export type { AddressMethod } from "./address-api";
const METHOD_TEXT: Record<AddressMethod, string> = { map: "kartans inloggning (Geotorget)", basic: "användarnamn och lösenord", oauth: "API-nyckel (OAuth2)" };


type Stored = {
  method?: AddressMethod;
  userCipher?: string; passwordCipher?: string; userHint?: string;
  keyCipher?: string; secretCipher?: string; keyHint?: string;
  environment?: AddressEnvironment;
  lastCheck?: { ok: boolean; message: string; at: string };
  updatedAt?: string; updatedBy?: string;
};
type MapJson = { addressLookup?: Stored } & Record<string, unknown>;

async function mapJson(): Promise<MapJson> {
  const row = await prisma.systemSettings.findUnique({ where: { id: "global" }, select: { map: true } });
  return (row?.map ?? {}) as MapJson;
}

/**
 * The four sign-in values are central keys (lib/secrets/central-store.ts, 2026-10-25). Within this module the *Cipher
 * fields are only markers that a value is in place; the opened values are kept beside the object they were read with,
 * and the raw JSON's old sealed values are left as they are until moved (or changed).
 */
const MARK = "central";
const FIELDS = { userCipher: "lantmateriet.addressUser", passwordCipher: "lantmateriet.addressPassword", keyCipher: "lantmateriet.addressKey", secretCipher: "lantmateriet.addressSecret" } as const;
type CipherField = keyof typeof FIELDS;
const opened = new WeakMap<Stored, Record<CipherField, string>>();
async function stored(): Promise<Stored> {
  const [json, values] = await Promise.all([mapJson(), centralSecrets(Object.values(FIELDS))]);
  const raw = json.addressLookup ?? {};
  const plain = Object.fromEntries((Object.keys(FIELDS) as CipherField[]).map((field) => [field, values[FIELDS[field]]])) as Record<CipherField, string>;
  const value: Stored = { ...raw };
  for (const field of Object.keys(FIELDS) as CipherField[]) value[field] = plain[field] ? MARK : undefined;
  opened.set(value, plain);
  return value;
}
async function save(next: Stored, changed: Partial<Record<CipherField, boolean>> = {}) {
  // The map's own settings in the same JSON are left exactly as they are, and so are the old sealed values.
  const json = await mapJson();
  const raw = json.addressLookup ?? {};
  const kept: Stored = { ...next };
  for (const field of Object.keys(FIELDS) as CipherField[]) kept[field] = changed[field] ? undefined : raw[field];
  const map = { ...json, addressLookup: kept };
  await prisma.systemSettings.upsert({ where: { id: "global" }, update: { map }, create: { id: "global", map } });
  clearAddressTokens();
}

const own = (value: Stored) => {
  const plain = opened.get(value);
  return plain?.userCipher && plain.passwordCipher ? { user: plain.userCipher, password: plain.passwordCipher } : null;
};
const keys = (value: Stored) => {
  const plain = opened.get(value);
  return plain?.keyCipher && plain.secretCipher ? { key: plain.keyCipher, secret: plain.secretCipher } : null;
};
const methodOf = chooseAddressMethod;
const environmentOf = (value: Stored): AddressEnvironment => value.environment ?? "production";

async function signIn(value: Stored): Promise<{ method: AddressMethod; auth: AddressAuth | null }> {
  const map = await mapSignIn();
  const method = methodOf(value, Boolean(map));
  if (method === "map") return { method, auth: map ? { kind: "basic", user: map.user, password: map.password } : null };
  if (method === "basic") { const pair = own(value); return { method, auth: pair ? { kind: "basic", ...pair } : null }; }
  const pair = keys(value);
  return { method, auth: pair ? { kind: "oauth", ...pair } : null };
}

/** What the product owner sees: which way is chosen, whether each has its values, the environment and the last check. Never a value. */
export async function addressLookupView() {
  const value = await stored();
  const mapHasSignIn = Boolean(await mapSignIn());
  const method = methodOf(value, mapHasSignIn);
  const basicConfigured = Boolean(value.userCipher && value.passwordCipher);
  const oauthConfigured = Boolean(value.keyCipher && value.secretCipher);
  return {
    method, environment: environmentOf(value),
    configured: method === "map" ? mapHasSignIn : method === "basic" ? basicConfigured : oauthConfigured,
    mapSignIn: mapHasSignIn,
    basic: { configured: basicConfigured, userHint: value.userHint ?? null },
    oauth: { configured: oauthConfigured, keyHint: value.keyHint ?? null },
    lastCheck: value.lastCheck ?? null,
    updatedAt: value.updatedAt ?? null, updatedBy: value.updatedBy ?? null,
    qa: localRoleQaEnabled(),
  };
}

export type AddressSettingsInput = {
  method?: AddressMethod;
  user?: string | null; password?: string | null;
  key?: string | null; secret?: string | null;
  environment?: AddressEnvironment;
};
export async function saveAddressLookupSettings(input: AddressSettingsInput, actor: CentralActor) {
  const current = await stored();
  const next: Stored = { ...current, updatedAt: new Date().toISOString(), updatedBy: actor.label };
  if (input.method) next.method = input.method;
  // The values first (in the key vault too, where the installation has one): when one fails nothing more of the save is kept.
  if (input.user !== undefined) { await saveCentralSecret(FIELDS.userCipher, input.user?.trim() || null, actor); next.userHint = input.user ? `${input.user.trim().slice(0, 2)}…` : undefined; }
  if (input.password !== undefined) await saveCentralSecret(FIELDS.passwordCipher, input.password || null, actor);
  // Only the key's last four characters are shown again (utredningen 2026-10-25, L5), as everywhere else.
  if (input.key !== undefined) { await saveCentralSecret(FIELDS.keyCipher, input.key?.trim() || null, actor); next.keyHint = input.key ? `…${input.key.trim().slice(-4)}` : undefined; }
  if (input.secret !== undefined) await saveCentralSecret(FIELDS.secretCipher, input.secret?.trim() || null, actor);
  if (input.environment) next.environment = input.environment;
  // Another way to sign in, new or removed values, or another environment: the old check says nothing about them.
  const changed = (input.method && input.method !== current.method) || input.user !== undefined || input.password !== undefined || input.key !== undefined || input.secret !== undefined
    || (input.environment && input.environment !== environmentOf(current));
  if (changed) next.lastCheck = undefined;
  await save(next, { userCipher: input.user !== undefined, passwordCipher: input.password !== undefined, keyCipher: input.key !== undefined, secretCipher: input.secret !== undefined });
}

/** Whether a signed-in person is offered proposals and search: a sign-in that passed its check, or the loopback QA stand-in. */
export async function addressLookupAvailable() {
  if (localRoleQaEnabled()) return true;
  const value = await stored();
  if (!value.lastCheck?.ok) return false;
  return Boolean((await signIn(value)).auth);
}

async function client() {
  const value = await stored();
  const { auth } = await signIn(value);
  if (!auth) throw new LookupError("Ingen inloggning för adresser är inlagd.");
  return createAddressClient(environmentOf(value), auth);
}

/** The nearest address to a WGS 84 point, or why there is none. Throws LookupError when Lantmäteriet cannot be asked. */
export async function lookupAddress(latitude: number, longitude: number): Promise<AddressLookupResult> {
  if (localRoleQaEnabled()) return qaAddressLookup(latitude, longitude);
  return judgeProposal(await (await client()).nearest(latitude, longitude));
}

/** Suggestions for a typed address (at least three characters). Throws LookupError when Lantmäteriet cannot be asked. */
export async function searchAddresses(text: string): Promise<AddressSuggestion[]> {
  if (localRoleQaEnabled()) return qaAddressSearch(text);
  return (await client()).search(text);
}

/** The chosen suggestion's address with its point, or null when Lantmäteriet has no such address. */
export async function addressById(id: string): Promise<AddressChoice | null> {
  if (localRoleQaEnabled()) return qaAddressById(id);
  return (await client()).byId(id);
}

/** A fixed, public point for Kontrollera: Lantmäteriet's own office in Gävle. */
export const CHECK_POINT = { latitude: 60.6749, longitude: 17.1413 };
/** Lantmäteriet's own example of a free-text search in the product's technical description. */
export const CHECK_SEARCH = "lantmäterig 2 gävle";

/**
 * Kontrollera: signs in the chosen way and makes both kinds of call – the address nearest a fixed public point and a
 * free-text search with Lantmäteriet's own example – and says in plain words what worked. The result is stored and shown
 * under Installation → Tjänster; only with a passed check are proposals and search offered.
 */
export async function checkAddressLookup(): Promise<{ ok: boolean; message: string; at: string }> {
  const value = await stored();
  const { method, auth } = await signIn(value);
  const at = new Date().toISOString();
  const environment = environmentOf(value);
  const where = environment === "production" ? "produktionsmiljön" : "verifieringsmiljön";
  const how = `Inloggning med ${METHOD_TEXT[method]}`;
  let result: { ok: boolean; message: string; at: string };
  if (!auth) result = { ok: false, message: method === "map" ? "Kartan har ingen inloggning att låna. Lägg in kartans inloggning eller välj ett annat sätt." : `${how}: inget är inlagt.`, at };
  else {
    const api = createAddressClient(environment, auth);
    try {
      const nearest = await api.nearest(CHECK_POINT.latitude, CHECK_POINT.longitude);
      const line = nearest ? [nearest.address, [nearest.postalCode, nearest.city].filter(Boolean).join(" ")].filter(Boolean).join(", ") : "";
      const nearestText = nearest ? `Närmaste adress till provpunkten: ${line || "utan namn"} (${nearest.distanceM} m bort).` : "Provpunkten gav ingen adress.";
      try {
        const hits = await api.search(CHECK_SEARCH, 3);
        result = { ok: true, message: `${how} fungerar i ${where}. ${nearestText} Adressökningen svarar (${hits.length} ${hits.length === 1 ? "träff" : "träffar"} för provsökningen).`, at };
      } catch (cause) {
        result = { ok: false, message: `${how} fungerar i ${where} och ${nearestText.charAt(0).toLowerCase()}${nearestText.slice(1)} Men adressökningen fungerar inte: ${cause instanceof Error && cause.message ? cause.message : "inget svar."}`, at };
      }
    } catch (cause) {
      result = { ok: false, message: `${how} i ${where} fungerar inte: ${cause instanceof Error && cause.message ? cause.message : "Lantmäteriet svarade inte."}`, at };
    }
  }
  await save({ ...value, lastCheck: result });
  return result;
}
