import { z } from "zod";
import { EXTERNAL_PROVIDERS } from "@/lib/integrations/key-catalog";

/**
 * Företagets nycklar som fil (2026-11-26: "kunden kan bara så klart exportera sina nycklar"; and back again, so a company
 * is quickly up after a break-in without typing every key anew): what the company's own keys look like in the file, and how a
 * file becomes a list of keys to read in. The content is the password managers' common unencrypted JSON export (one folder,
 * one login item per key), plus a block `workflow` that says which company the file belongs to; the file that leaves the
 * server is always this content encrypted (lib/secrets/password-file-crypto.ts).
 *
 * What a company's file holds – the secrets the admin has typed in under Inställningar → Kopplingar:
 * - every pasted key (IntegrationKey EXTERNAL: Fortnox, the payroll system and older rows), with its service and name;
 * - Webbplatsen: the WordPress address, REST address, user and application password;
 * - Facebook och Instagram: the app's id and secret; LinkedIn and YouTube: the app's client id and secret.
 * Not in it: the keys Workflow issues (API, MCP, the machines' keys, the apps connected over OAuth – Workflow keeps only a
 * hash), and the sign-in tokens a connection gets when the admin presses Koppla (they are renewed by connecting again, which
 * is what should happen after a break-in anyway).
 *
 * The ids are fixed (`workflow-company:<kind>`, a pasted key by its row), so a password manager that matches on id shows a
 * changed key as changed. Pure: no database, no environment. Server code only (the values pass through here).
 */
export const COMPANY_KEY_ID_PREFIX = "workflow-company:";
export const COMPANY_KEY_FORMAT = "workflow-keys";
export const COMPANY_KEY_FORMAT_VERSION = 1;
export const COMPANY_KEY_NOTE = "Nyckel från Workflow. Ändras under Inställningar → Kopplingar.";
/** The limits of a file Workflow reads: far above any company's keys, far below anything that could tie up the server. */
const MAX_ITEMS = 300;
const MAX_VALUE = 4000;

export type CompanyKeyEntry =
  | { kind: "external"; id: string; label: string; provider: string; name: string; value: string; expiresOn: string | null }
  | { kind: "website"; id: string; label: string; siteUrl: string; baseUrl: string; username: string; password: string }
  | { kind: "meta"; id: string; label: string; appId: string; appSecret: string }
  | { kind: "linkedin"; id: string; label: string; clientId: string; clientSecret: string; scopeSet: "personal" | "organization" }
  | { kind: "youtube"; id: string; label: string; clientId: string; clientSecret: string };
export type CompanyKeyKind = CompanyKeyEntry["kind"];

/** Which company a file belongs to: its id in this installation, its organisation number and its name. */
export type CompanyBinding = { format: typeof COMPANY_KEY_FORMAT; version: typeof COMPANY_KEY_FORMAT_VERSION; organizationId: string; organizationNumber: string; company: string };

export type FileField = { name: string; value: string; type: 0 | 1; linkedId: null };
export type FileItem = {
  id: string; organizationId: null; folderId: string; type: 1; reprompt: 0; name: string; notes: string; favorite: false;
  login: { uris: { match: null; uri: string }[]; username: string | null; password: string | null; totp: null };
  fields: FileField[]; collectionIds: null;
};
export type CompanyKeyFile = { encrypted: false; folders: { id: string; name: string }[]; items: FileItem[]; workflow?: CompanyBinding };

export const LABELS: Record<Exclude<CompanyKeyKind, "external">, string> = {
  website: "Webbplatsen (WordPress)",
  meta: "Facebook och Instagram – appen",
  linkedin: "LinkedIn – appen",
  youtube: "YouTube – Google-projektet",
};
const SERVICE: Record<Exclude<CompanyKeyKind, "external" | "website">, string> = { meta: "Meta", linkedin: "LinkedIn", youtube: "Google Cloud" };
const providerLabel = (provider: string) => EXTERNAL_PROVIDERS.find((item) => item.key === provider)?.label ?? provider;
export const externalLabel = (provider: string, name: string) => (name.trim() && name.trim() !== providerLabel(provider) ? `${providerLabel(provider)} – ${name.trim()}` : providerLabel(provider));

// The field names Workflow reads back (the password manager shows them as they are).
const F = { service: "Workflow-tjänst", name: "Workflow-namn", expires: "Går ut", rest: "REST-adress", scope: "Behörighet", kind: "Nyckelvalv-typ" } as const;
const DAY = /^\d{4}-\d{2}-\d{2}$/;
const text = (name: string, value: string): FileField => ({ name, value, type: 0, linkedId: null });

/** The secrets an entry carries (what the counts count). */
export const secretsOf = (entry: CompanyKeyEntry): string[] =>
  entry.kind === "external" ? [entry.value] : entry.kind === "website" ? [entry.password] : entry.kind === "meta" ? [entry.appSecret] : [entry.clientSecret];

/** One item per entry, in the given folder. An entry without its secret is never written. */
export function companyKeyItems(entries: readonly CompanyKeyEntry[], folderId: string): FileItem[] {
  const items: FileItem[] = [];
  for (const entry of entries) {
    if (!secretsOf(entry).every((secret) => secret.trim())) continue;
    const item = (uri: string, username: string | null, password: string, fields: FileField[]): FileItem => ({
      id: entry.id, organizationId: null, folderId, type: 1, reprompt: 0, name: entry.label, notes: COMPANY_KEY_NOTE, favorite: false,
      login: { uris: uri ? [{ match: null, uri }] : [], username: username || null, password, totp: null }, fields, collectionIds: null,
    });
    if (entry.kind === "external") {
      items.push(item(providerLabel(entry.provider), null, entry.value, [
        text(F.service, entry.provider), text(F.name, entry.name), text(F.kind, "api"), ...(entry.expiresOn && DAY.test(entry.expiresOn) ? [text(F.expires, entry.expiresOn)] : []),
      ]));
    } else if (entry.kind === "website") {
      items.push(item(entry.siteUrl || entry.baseUrl, entry.username, entry.password, [text(F.rest, entry.baseUrl)]));
    } else if (entry.kind === "meta") {
      items.push(item(SERVICE.meta, entry.appId, entry.appSecret, [text(F.kind, "api")]));
    } else if (entry.kind === "linkedin") {
      items.push(item(SERVICE.linkedin, entry.clientId, entry.clientSecret, [text(F.scope, entry.scopeSet), text(F.kind, "api")]));
    } else {
      items.push(item(SERVICE.youtube, entry.clientId, entry.clientSecret, [text(F.kind, "api")]));
    }
  }
  return items;
}

/** The company's file (before encryption), with its binding and counts. */
export function companyKeyFile(entries: readonly CompanyKeyEntry[], binding: Omit<CompanyBinding, "format" | "version">, folder = { id: "workflow-company", name: "Workflow – företagets kopplingar" }) {
  const items = companyKeyItems(entries, folder.id);
  const file: CompanyKeyFile = {
    encrypted: false, folders: items.length ? [folder] : [], items,
    workflow: { format: COMPANY_KEY_FORMAT, version: COMPANY_KEY_FORMAT_VERSION, ...binding },
  };
  return { file, entries: items.length, keys: entries.filter((entry) => items.some((item) => item.id === entry.id)).reduce((sum, entry) => sum + secretsOf(entry).length, 0) };
}

// ---------- reading a file back ----------

const value = z.string().max(MAX_VALUE);
const fieldSchema = z.object({ name: z.string().max(200).nullable().optional(), value: value.nullable().optional(), type: z.number().int().optional() }).passthrough();
const itemSchema = z.object({
  id: z.string().max(200).nullable().optional(),
  name: z.string().max(300).nullable().optional(),
  folderId: z.string().max(200).nullable().optional(),
  login: z.object({
    username: value.nullable().optional(), password: value.nullable().optional(),
    uris: z.array(z.object({ uri: z.string().max(2000).nullable().optional() }).passthrough()).max(10).nullable().optional(),
  }).passthrough().nullable().optional(),
  fields: z.array(fieldSchema).max(40).nullable().optional(),
}).passthrough();
const bindingSchema = z.object({
  format: z.literal(COMPANY_KEY_FORMAT), version: z.literal(COMPANY_KEY_FORMAT_VERSION),
  organizationId: z.string().max(100), organizationNumber: z.string().max(40), company: z.string().max(300),
}).strict();
export const keyFileSchema = z.object({
  encrypted: z.literal(false),
  folders: z.array(z.object({ id: z.string().max(200), name: z.string().max(300) }).passthrough()).max(50).nullable().optional(),
  items: z.array(itemSchema).max(MAX_ITEMS),
  workflow: bindingSchema.optional(),
}).passthrough();
export type ParsedKeyFile = z.infer<typeof keyFileSchema>;
export type ParsedItem = ParsedKeyFile["items"][number];

/** The decrypted text as a key file, or null when it is not one (strict schema, size limits). */
export function parseKeyFile(textContent: string): ParsedKeyFile | null {
  let raw: unknown;
  try { raw = JSON.parse(textContent); } catch { return null; }
  const parsed = keyFileSchema.safeParse(raw);
  return parsed.success ? parsed.data : null;
}

const fieldOf = (item: ParsedItem, name: string) => (item.fields ?? []).find((field) => field.name === name)?.value?.trim() ?? "";
const clean = (input: string | null | undefined) => (input ?? "").trim();

export type SkippedItem = { id: string; label: string; reason: string };

/**
 * The company's keys in a file: the items Workflow wrote (`workflow-company:…`), each checked; anything else is listed as
 * skipped with the reason, never read in. The same kind twice (one website, one Meta app …) keeps the first.
 */
export function companyEntriesFromItems(items: readonly ParsedItem[]): { entries: CompanyKeyEntry[]; skipped: SkippedItem[] } {
  const entries: CompanyKeyEntry[] = [];
  const skipped: SkippedItem[] = [];
  const seen = new Set<string>();
  for (const item of items) {
    const id = clean(item.id);
    if (!id.startsWith(COMPANY_KEY_ID_PREFIX)) continue;
    const label = clean(item.name) || id;
    const skip = (reason: string) => skipped.push({ id, label, reason });
    const kind = id.slice(COMPANY_KEY_ID_PREFIX.length).split(":")[0];
    const username = clean(item.login?.username);
    const password = clean(item.login?.password);
    const uri = clean(item.login?.uris?.[0]?.uri);
    if (!password) { skip("Värdet saknas i filen."); continue; }
    let entry: CompanyKeyEntry | null = null;
    if (kind === "external") {
      const provider = fieldOf(item, F.service);
      const name = fieldOf(item, F.name) || label;
      if (!EXTERNAL_PROVIDERS.some((known) => known.key === provider)) { skip("Okänd tjänst."); continue; }
      const expires = fieldOf(item, F.expires);
      entry = { kind, id, label: externalLabel(provider, name), provider, name: name.slice(0, 80), value: password, expiresOn: DAY.test(expires) ? expires : null };
    } else if (kind === "website") {
      const baseUrl = fieldOf(item, F.rest) || uri;
      if (!baseUrl) { skip("Webbplatsens adress saknas i filen."); continue; }
      entry = { kind, id, label: LABELS.website, siteUrl: uri, baseUrl, username, password };
    } else if (kind === "meta") {
      if (!username) { skip("Appens id saknas i filen."); continue; }
      entry = { kind, id, label: LABELS.meta, appId: username, appSecret: password };
    } else if (kind === "linkedin") {
      if (!username) { skip("Client ID saknas i filen."); continue; }
      entry = { kind, id, label: LABELS.linkedin, clientId: username, clientSecret: password, scopeSet: fieldOf(item, F.scope) === "organization" ? "organization" : "personal" };
    } else if (kind === "youtube") {
      if (!username) { skip("Klient-id saknas i filen."); continue; }
      entry = { kind, id, label: LABELS.youtube, clientId: username, clientSecret: password };
    } else { skip("Okänd sorts nyckel."); continue; }
    const slot = slotOf(entry);
    if (seen.has(slot)) { skip("Finns två gånger i filen."); continue; }
    seen.add(slot);
    entries.push(entry);
  }
  return { entries, skipped };
}

/** Where an entry lands in a company: one website, one app per service, a pasted key by its service and name. */
export const slotOf = (entry: CompanyKeyEntry) => (entry.kind === "external" ? `external:${entry.provider}:${entry.name.trim().toLowerCase()}` : entry.kind);

/** Whether the file's entry already applies in the company exactly (then it is unchecked in the preview). */
export function sameEntry(a: CompanyKeyEntry, b: CompanyKeyEntry) {
  const strip = (entry: CompanyKeyEntry) => JSON.stringify(Object.entries(entry).filter(([name]) => name !== "id" && name !== "label"));
  return strip(a) === strip(b);
}

export type PreviewState = "new" | "changed" | "same";
/** The file's entries against the company's own now: new, changed or the same (names and states only, never a value). */
export function previewStates(file: readonly CompanyKeyEntry[], current: readonly CompanyKeyEntry[]) {
  const bySlot = new Map(current.map((entry) => [slotOf(entry), entry]));
  return file.map((entry) => {
    const now = bySlot.get(slotOf(entry));
    return { id: entry.id, label: entry.label, kind: entry.kind, state: (!now ? "new" : sameEntry(entry, now) ? "same" : "changed") as PreviewState };
  });
}

/** How the file's company stands to the company it is read into. */
export function companyMatch(binding: CompanyBinding | undefined, company: { id: string; organizationNumber: string }): "same" | "other" | "unknown" {
  if (!binding) return "unknown";
  const digits = (value: string) => value.replace(/\D/g, "");
  if (digits(binding.organizationNumber) && digits(company.organizationNumber)) return digits(binding.organizationNumber) === digits(company.organizationNumber) ? "same" : "other";
  return binding.organizationId === company.id ? "same" : "other";
}

/** The file's name: the day and nothing else (no company name in a file name that may be mailed or synced). */
export const companyKeyFileName = (day: string) => `workflow-foretagets-nycklar-${DAY.test(day) ? day : "export"}.json`;

/** After a read-in: what to do with each key, since keys that may have leaked must be changed at the service. */
export const ROTATE_ADVICE = "Byt nyckeln hos tjänsten om den kan ha läckt, och lägg sedan in den nya här.";
