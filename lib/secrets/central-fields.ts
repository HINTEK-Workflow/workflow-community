/**
 * Workflows centrala nycklar (2026-10-25): the installation's own keys to outside services,
 * administered under Installation → Tjänster och nycklar. One list for the local sealed copy
 * (SystemSettings.centralSecrets), the primary store (the installation's key vault, where it has one), the status page and the
 * migration. The companies' own keys (IntegrationKey) and the keys Workflow issues (hashes) are never here.
 *
 * `legacy` is where the field was sealed before 2026-10-25 (column and JSON path): read until the value has been moved
 * (scripts/secrets/reseal.ts, or the next save), never written again.
 *
 * `vaultKey` is the secret's name in the primary store. It is the field's id: plain, stable, and never a value.
 *
 * Pure: no database, no environment.
 */
export const CENTRAL_FIELDS = {
  "stripe.secretKey": { label: "Stripe – hemlig nyckel", card: "stripe", legacy: { column: "serverKeys", path: ["stripeSecretKey", "cipher"] } },
  "stripe.webhookSecret": { label: "Stripe – webhookhemlighet", card: "stripe", legacy: { column: "serverKeys", path: ["stripeWebhookSecret", "cipher"] } },
  "google.clientId": { label: "Google – klient-id", card: "google", legacy: { column: "serverKeys", path: ["googleClientId", "cipher"] } },
  "google.clientSecret": { label: "Google – klienthemlighet", card: "google", legacy: { column: "serverKeys", path: ["googleClientSecret", "cipher"] } },
  "solar.clientId": { label: "Solar – klient-id", card: "solar", legacy: { column: "serverKeys", path: ["solarClientId", "cipher"] } },
  "solar.clientSecret": { label: "Solar – klienthemlighet", card: "solar", legacy: { column: "serverKeys", path: ["solarClientSecret", "cipher"] } },
  "openai.apiKey": { label: "OpenAI – API-nyckel", card: "openai", legacy: { column: "aiProvider", path: ["apiKeyCipher"] } },
  "azure.apiKey": { label: "Microsoft Azure – nyckel", card: "azure", legacy: { column: "aiProvider", path: ["azure", "apiKeyCipher"] } },
  "smtp.password": { label: "E-post – SMTP-lösenord", card: "mail", legacy: { column: "mail", path: ["passwordCipher"] } },
  "push.privateKey": { label: "Webbpush – privat nyckel", card: "push", legacy: { column: "push", path: ["privateKeyCipher"] } },
  "microsoft.clientSecret": { label: "Microsoft – klienthemlighet", card: "microsoft", legacy: { column: "microsoftSignIn", path: ["secretCipher"] } },
  "scb.apiKey": { label: "SCB – API-nyckel", card: "scb", legacy: { column: "companyLookup", path: ["keyCipher"] } },
  "lantmateriet.mapUser": { label: "Lantmäteriet karta – användare", card: "map", legacy: { column: "map", path: ["userCipher"] } },
  "lantmateriet.mapPassword": { label: "Lantmäteriet karta – lösenord", card: "map", legacy: { column: "map", path: ["passwordCipher"] } },
  "lantmateriet.addressUser": { label: "Lantmäteriet adress – användare", card: "address", legacy: { column: "map", path: ["addressLookup", "userCipher"] } },
  "lantmateriet.addressPassword": { label: "Lantmäteriet adress – lösenord", card: "address", legacy: { column: "map", path: ["addressLookup", "passwordCipher"] } },
  "lantmateriet.addressKey": { label: "Lantmäteriet adress – API-nyckel", card: "address", legacy: { column: "map", path: ["addressLookup", "keyCipher"] } },
  "lantmateriet.addressSecret": { label: "Lantmäteriet adress – API-hemlighet", card: "address", legacy: { column: "map", path: ["addressLookup", "secretCipher"] } },
  // Rapportera fel eller förslag (2026-11-13): the key the server creates issues with, in the commercial part only
  // (`cloudOnly`). Never sealed anywhere before, so its old place is only a name that is never written.
  "github.issuesToken": { label: "GitHub – nyckel för ärenden", card: "github", cloudOnly: true, legacy: { column: "serverKeys", path: ["githubIssuesToken", "cipher"] } },
} as const satisfies Record<string, { label: string; card: string; cloudOnly?: true; legacy: { column: LegacyColumn; path: readonly string[] } }>;

export type LegacyColumn = "serverKeys" | "aiProvider" | "mail" | "push" | "microsoftSignIn" | "companyLookup" | "map";
export type CentralField = keyof typeof CENTRAL_FIELDS;
export type CentralCard = (typeof CENTRAL_FIELDS)[CentralField]["card"];
export const CENTRAL_FIELD_IDS = Object.keys(CENTRAL_FIELDS) as CentralField[];
export const LEGACY_COLUMNS = [...new Set(CENTRAL_FIELD_IDS.map((field) => CENTRAL_FIELDS[field].legacy.column))] as LegacyColumn[];

export const isCentralField = (value: string): value is CentralField => Object.hasOwn(CENTRAL_FIELDS, value);
/** A key only the commercial part uses (ee/): an installation without it has no card for it. */
export const isCloudOnlyField = (field: CentralField) => "cloudOnly" in CENTRAL_FIELDS[field];
/** The fields an installation shows: without billing (features.billing, only with ee/) it has no payment keys and no key of the commercial part to keep. */
export const visibleCentralFields = (billing: boolean) => CENTRAL_FIELD_IDS.filter((field) => billing || (CENTRAL_FIELDS[field].card !== "stripe" && !isCloudOnlyField(field)));
export const centralFieldsOf = (card: CentralCard) => CENTRAL_FIELD_IDS.filter((field) => CENTRAL_FIELDS[field].card === card);

/** The value at a JSON path, when it is a string. */
export function legacyCipherIn(columns: Partial<Record<LegacyColumn, unknown>>, field: CentralField): string | undefined {
  const { column, path } = CENTRAL_FIELDS[field].legacy;
  let node: unknown = columns[column];
  for (const key of path) {
    if (!node || typeof node !== "object") return undefined;
    node = (node as Record<string, unknown>)[key];
  }
  return typeof node === "string" && node ? node : undefined;
}

/** A copy of the column's JSON with the field's old sealed value taken out (after it has been moved). */
export function withoutLegacyCipher(value: unknown, field: CentralField): unknown {
  const { path } = CENTRAL_FIELDS[field].legacy;
  const copy = structuredClone(value && typeof value === "object" ? value : {}) as Record<string, unknown>;
  let node: Record<string, unknown> = copy;
  for (const key of path.slice(0, -1)) {
    const next = node[key];
    if (!next || typeof next !== "object") return copy;
    node = next as Record<string, unknown>;
  }
  delete node[path[path.length - 1]];
  return copy;
}
