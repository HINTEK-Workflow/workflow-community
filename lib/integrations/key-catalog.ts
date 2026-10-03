// The lists behind API och MCP (2026-09-29), without any crypto so the page in the browser can use them too.

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
    { key: "delete", label: "Ta bort och arkivera (går att återställa)" },
  ],
  MCP: [
    { key: "mcp:read", label: "Söka och läsa" },
    { key: "mcp:write", label: "Skapa och ändra" },
    { key: "mcp:delete", label: "Ta bort och arkivera (går att återställa)" },
  ],
} as const satisfies Record<IssuedKind, readonly { key: string; label: string }[]>;
export type KeyScope = (typeof KEY_SCOPES)[IssuedKind][number]["key"];

/** Providers of external keys that are fetched from the provider and pasted in. */
export const EXTERNAL_PROVIDERS = [
  { key: "openai", label: "OpenAI" },
  { key: "anthropic", label: "Anthropic" },
  { key: "azure-openai", label: "Azure OpenAI" },
  { key: "microsoft-365", label: "Microsoft 365 / Graph" },
  { key: "fortnox", label: "Fortnox" },
  { key: "other", label: "Annan tjänst" },
] as const;
export type ExternalProvider = (typeof EXTERNAL_PROVIDERS)[number]["key"];

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
