/**
 * The key ids the companies' connections seal their secrets under (lib/integrations/company-keys.ts binds a value to the
 * company and this id). One place, so the connections and the company's key file (lib/secrets/company-key-source.ts) open the
 * same values. Changing an id makes every value sealed under it unreadable – never change one.
 */
export const WEBSITE_PASSWORD_KEY_ID = "website-application-password";
export const META_KEY_IDS = { secret: "meta-app-secret", user: "meta-user-token", page: "meta-page-token" } as const;
export const LINKEDIN_KEY_IDS = { secret: "linkedin-client-secret", access: "linkedin-access-token", refresh: "linkedin-refresh-token" } as const;
export const YOUTUBE_KEY_IDS = { secret: "youtube-client-secret", access: "youtube-access-token", refresh: "youtube-refresh-token", verifier: "youtube-pkce-verifier" } as const;
