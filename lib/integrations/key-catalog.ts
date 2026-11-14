// The lists behind API och MCP (2026-09-29), without any crypto so the page in the browser can use them too.
import { FORTNOX_CONNECTION_READY } from "@/lib/quotes/accounting";

export const ISSUED_KINDS = ["API", "MCP"] as const;
export type IssuedKind = (typeof ISSUED_KINDS)[number];

/**
 * What an issued key may do (API/MCP server, 2026-09-30). The key never gets more than the member it acts for:
 * every call also passes the member's own permissions in Workflow. Reading, creating/changing and removing are separate;
 * permanent deletion is not offered through keys at all.
 */
export const KEY_SCOPES = {
  API: [
    { key: "projects:read", label: "Läsa projekt" },
    { key: "projects:write", label: "Skapa och ändra projekt" },
    { key: "tasks:read", label: "Läsa uppgifter och protokoll" },
    { key: "tasks:write", label: "Skapa och ändra uppgifter" },
    { key: "customers:read", label: "Läsa kunder och anläggningar" },
    { key: "customers:write", label: "Skapa och ändra kunder" },
    { key: "planning:read", label: "Läsa planering" },
    { key: "planning:write", label: "Skapa och ändra planering" },
    { key: "time:read", label: "Läsa rapporterad tid" },
    { key: "time:write", label: "Rapportera tid" },
    // Artiklar och priser (2026-10-08): its own scope, so an existing key never starts reading prices by itself.
    { key: "catalogue:read", label: "Läsa artiklar och priser" },
    // Offerter (2026-10-09): its own scope, so an existing key never starts reading quotes by itself.
    { key: "quotes:read", label: "Läsa offerter och fakturaunderlag" },
    // Fakturaunderlag (plan 1J, 2026-10-11): creating a draft is its own scope, off until chosen; reading is in quotes:read.
    { key: "invoices:write", label: "Skapa utkast till fakturaunderlag" },
    { key: "delete", label: "Ta bort och arkivera (går att återställa)" },
  ],
  MCP: [
    { key: "mcp:read", label: "Söka och läsa" },
    { key: "mcp:write", label: "Skapa och ändra" },
    { key: "mcp:invoices", label: "Skapa utkast till fakturaunderlag" },
    { key: "mcp:delete", label: "Ta bort och arkivera (går att återställa)" },
  ],
} as const satisfies Record<IssuedKind, readonly { key: string; label: string }[]>;
export type KeyScope = (typeof KEY_SCOPES)[IssuedKind][number]["key"];

/**
 * Providers of external keys that are fetched from the provider and pasted in. `use`: what Workflow does with the key, said on
 * its row (användartest 2026-10-31, F6: the list said "Workflow använder dem inte ännu", untrue for Fortnox). `offered`: a new
 * key can be added for it – not for AI services (S4: Workflow AI is central, a company's own AI key is never used) and, since
 * 2026-11-03, not for "Annan tjänst" either (Workflow is no password safe). Older rows keep their name and can still be removed.
 * `connection`: the area of Kopplingar the key belongs to (2026-11-03, "varje nyckel vid sin koppling"); a key without one
 * is shown under Övriga nycklar until it is removed.
 */
export const EXTERNAL_PROVIDERS = [
  { key: "openai", label: "OpenAI", offered: false, connection: null, use: "Används inte: Workflow AI använder inga egna AI-nycklar. Ta bort den när den inte behövs." },
  { key: "anthropic", label: "Anthropic", offered: false, connection: null, use: "Används inte: Workflow AI använder inga egna AI-nycklar. Ta bort den när den inte behövs." },
  { key: "azure-openai", label: "Azure OpenAI", offered: false, connection: null, use: "Används inte: Workflow AI använder inga egna AI-nycklar. Ta bort den när den inte behövs." },
  { key: "microsoft-365", label: "Microsoft 365 / Graph", offered: false, connection: null, use: "Används inte: Workflow har ingen koppling till Microsoft 365. Ta bort den när den inte behövs." },
  // Beslut 16 (2026-11-01): no new Fortnox key until a real connection exists; one saved earlier keeps its row and can be removed.
  { key: "fortnox", label: "Fortnox", offered: FORTNOX_CONNECTION_READY, connection: "accounting", use: FORTNOX_CONNECTION_READY ? "Används när en offert eller ett fakturaunderlag skickas till Fortnox." : "Används inte just nu. Fortnox-kopplingen är inte öppen än." },
  // Lön och frånvaro (2026-10-29): the company's SFTP password or private key, and an API key for its time or payroll system.
  { key: "payroll-sftp", label: "Lönesystem – SFTP", offered: true, connection: "payroll", use: "För lönesystemet via SFTP. Den kopplingen är förberedd men inte påslagen än." },
  { key: "payroll-api", label: "Lönesystem – API", offered: true, connection: "payroll", use: "För lönesystemet via API. Den kopplingen är förberedd men inte påslagen än." },
  { key: "other", label: "Annan tjänst", offered: false, connection: null, use: "Används inte – ta bort när den inte behövs." },
] as const satisfies readonly { key: string; label: string; offered: boolean; connection: KeyConnection | null; use: string }[];
/** The areas of Kopplingar that hold a pasted key. */
export type KeyConnection = "accounting" | "payroll";
/** The providers a new external key may be added for (the API refuses the others). */
export const OFFERED_EXTERNAL_PROVIDERS = EXTERNAL_PROVIDERS.filter((item) => item.offered).map((item) => item.key);
export type ExternalProvider = (typeof EXTERNAL_PROVIDERS)[number]["key"];
/** The keys an area holds: Bokföring the Fortnox key, Lön och export the payroll system's. */
export const connectionProviders = (connection: KeyConnection): ExternalProvider[] => EXTERNAL_PROVIDERS.filter((item) => item.connection === connection).map((item) => item.key);
/** A key of no connection (an older AI, Microsoft 365 or "Annan tjänst" row, or an unknown provider): Övriga nycklar. */
export const isOtherKeyProvider = (provider: string | null | undefined) => !EXTERNAL_PROVIDERS.some((item) => item.key === provider && item.connection);

export const EXPIRING_SOON_DAYS = 14;
/** The status a company key is shown with: removed/revoked, expired, expiring within two weeks, or active. */
export function keyState(key: { kind: "API" | "MCP" | "EXTERNAL"; expiresAt: string | Date | null; revokedAt: string | Date | null }, now = new Date()) {
  if (key.revokedAt) return key.kind === "EXTERNAL" ? "removed" : "revoked";
  if (!key.expiresAt) return "active";
  const left = new Date(key.expiresAt).getTime() - now.getTime();
  if (left <= 0) return "expired";
  return left <= EXPIRING_SOON_DAYS * 86_400_000 ? "expiring" : "active";
}
export type KeyState = ReturnType<typeof keyState>;

export const MAX_ACTIVE_KEYS_PER_KIND = 25;
export const EXPIRY_CHOICES = [30, 90, 365, 0] as const; // days; 0 = never
