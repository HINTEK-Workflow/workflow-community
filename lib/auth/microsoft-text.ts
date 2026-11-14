/**
 * Inloggning med Microsoft (2026-10-11), the words the browser shows: the tenant choices and the refusals. Kept apart
 * from lib/auth/microsoft-core.ts, which holds Microsoft's addresses, so no page code carries them.
 */

/** Which accounts may sign in, as Microsoft's endpoints name them; or one directory's id. */
export const MICROSOFT_TENANT_MODES = ["common", "organizations", "consumers"] as const;
export type MicrosoftTenantMode = (typeof MICROSOFT_TENANT_MODES)[number];
export const MICROSOFT_TENANT_LABELS: Record<MicrosoftTenantMode | "single", string> = {
  common: "Arbets- och skolkonton från alla kataloger samt personliga Microsoft-konton",
  organizations: "Bara arbets- och skolkonton (alla kataloger)",
  consumers: "Bara personliga Microsoft-konton",
  single: "Bara en katalog (ange katalogens id)",
};

/** The sign-in errors the login page and Mina inställningar explain in words. */
export const MICROSOFT_ERRORS = {
  microsoft_disabled: "Inloggning med Microsoft är inte påslagen. Logga in på annat sätt.",
  microsoft_identity: "Microsoft gav inte ett fullständigt konto-id. Försök igen eller logga in på annat sätt.",
  microsoft_not_linked: "Det här Microsoft-kontot är inte kopplat till något konto i Workflow. Logga in på annat sätt och koppla det under Mina inställningar → Ditt konto.",
  microsoft_tenant: "Microsoft-konton från den här katalogen får inte logga in här.",
  microsoft_tenant_locked: "Ditt företag tillåter bara Microsoft-konton från företagets egen katalog.",
  microsoft_linked_elsewhere: "Det Microsoft-kontot är redan kopplat till ett annat konto i Workflow.",
  microsoft_account_disabled: "Kontot är inaktiverat. Kontakta en administratör för åtkomst.",
} as const;
export type MicrosoftError = keyof typeof MICROSOFT_ERRORS;
