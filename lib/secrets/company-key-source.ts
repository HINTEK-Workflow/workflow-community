import { prisma } from "@/lib/db";
import { openCompanyKey } from "@/lib/integrations/company-keys";
import { LINKEDIN_KEY_IDS, META_KEY_IDS, WEBSITE_PASSWORD_KEY_ID, YOUTUBE_KEY_IDS } from "@/lib/integrations/company-key-ids";
import { COMPANY_KEY_ID_PREFIX, LABELS, externalLabel, type CompanyKeyEntry } from "./company-key-file";

/**
 * The company's own keys as they apply now (2026-11-26), opened with the company's own data key. Every query is bound to
 * the one company the caller has checked (`organizationId`): another company's row is never read, and a value copied from
 * another company would not open anyway (the data key and the additional data are the company's). A value that cannot be
 * opened is counted, never guessed and never in the file.
 */
export type CompanyKeySource = { entries: CompanyKeyEntry[]; unreadable: number; company: { id: string; name: string; organizationNumber: string } };

/** The database (a stand-in only in the unit tests, which check that every query names the one company). */
type Db = typeof prisma;

/** The company's name and organisation number (the company's own profile), for the file's binding. */
export async function companyIdentity(organizationId: string, db: Db = prisma) {
  const [organization, settings] = await Promise.all([
    db.organization.findUniqueOrThrow({ where: { id: organizationId }, select: { id: true, name: true } }),
    db.workspaceSettings.findUnique({ where: { organizationId }, select: { companyName: true, profile: true } }),
  ]);
  const profile = settings?.profile && typeof settings.profile === "object" && !Array.isArray(settings.profile) ? settings.profile as Record<string, unknown> : {};
  return { id: organization.id, name: settings?.companyName || organization.name, organizationNumber: typeof profile.organizationNumber === "string" ? profile.organizationNumber.trim() : "" };
}

export async function companyKeySource(organizationId: string, db: Db = prisma): Promise<CompanyKeySource> {
  let unreadable = 0;
  const opened = async (keyId: string, stored: string | null | undefined) => {
    if (!stored) return "";
    try { return await openCompanyKey(organizationId, keyId, stored, db); } catch { unreadable += 1; return ""; }
  };
  const [company, external, website, meta, linkedin, youtube] = await Promise.all([
    companyIdentity(organizationId, db),
    db.integrationKey.findMany({
      where: { organizationId, kind: "EXTERNAL", revokedAt: null, encryptedValue: { not: null } },
      orderBy: { createdAt: "asc" }, select: { id: true, name: true, provider: true, encryptedValue: true, expiresAt: true },
    }),
    db.websiteConnection.findUnique({ where: { organizationId }, select: { id: true, siteUrl: true, baseUrl: true, username: true, passwordCipher: true } }),
    db.metaConnection.findUnique({ where: { organizationId }, select: { appId: true, appSecretCipher: true } }),
    db.linkedInConnection.findUnique({ where: { organizationId }, select: { clientId: true, clientSecretCipher: true, scopeSet: true } }),
    db.youTubeConnection.findUnique({ where: { organizationId }, select: { clientId: true, clientSecretCipher: true } }),
  ]);
  const entries: CompanyKeyEntry[] = [];
  for (const key of external) {
    const value = await opened(key.id, key.encryptedValue);
    if (!value) continue;
    const provider = key.provider ?? "other";
    entries.push({ kind: "external", id: `${COMPANY_KEY_ID_PREFIX}external:${key.id}`, label: externalLabel(provider, key.name), provider, name: key.name, value, expiresOn: key.expiresAt?.toISOString().slice(0, 10) ?? null });
  }
  // The website's password: only a company-bound value (v3). The first site's older sealing is resealed on its first read
  // (lib/website/server.ts) and comes with the next export.
  if (website?.passwordCipher?.startsWith("v3.")) {
    const password = await opened(WEBSITE_PASSWORD_KEY_ID, website.passwordCipher);
    if (password) entries.push({ kind: "website", id: `${COMPANY_KEY_ID_PREFIX}website`, label: LABELS.website, siteUrl: website.siteUrl ?? "", baseUrl: website.baseUrl, username: website.username ?? "", password });
  }
  if (meta?.appId) {
    const appSecret = await opened(META_KEY_IDS.secret, meta.appSecretCipher);
    if (appSecret) entries.push({ kind: "meta", id: `${COMPANY_KEY_ID_PREFIX}meta`, label: LABELS.meta, appId: meta.appId, appSecret });
  }
  if (linkedin?.clientId) {
    const clientSecret = await opened(LINKEDIN_KEY_IDS.secret, linkedin.clientSecretCipher);
    if (clientSecret) entries.push({ kind: "linkedin", id: `${COMPANY_KEY_ID_PREFIX}linkedin`, label: LABELS.linkedin, clientId: linkedin.clientId, clientSecret, scopeSet: linkedin.scopeSet === "organization" ? "organization" : "personal" });
  }
  if (youtube?.clientId) {
    const clientSecret = await opened(YOUTUBE_KEY_IDS.secret, youtube.clientSecretCipher);
    if (clientSecret) entries.push({ kind: "youtube", id: `${COMPANY_KEY_ID_PREFIX}youtube`, label: LABELS.youtube, clientId: youtube.clientId, clientSecret });
  }
  return { entries, unreadable, company };
}
