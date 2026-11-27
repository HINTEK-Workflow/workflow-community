import { createHash } from "node:crypto";
import { prisma } from "@/lib/db";

/**
 * Hastighetsbegränsning (security review 2026-10-04): a fixed window per key, counted in PostgreSQL so that it holds
 * across every app process and through a restart (the earlier counters lived in one process's memory). Keys are hashed,
 * so no e-mail address or IP address is stored in clear text; old rows are cleared by the nightly system cleanup.
 *
 * Reserv vid databasfel (2026-10-08): when PostgreSQL cannot be read or written, a small in-process window per
 * hashed key takes over with the rule's own limit, and a warning is logged (rule name and error type only). Ordinary
 * users are never limited harder than the normal rule; an attacker no longer gets unlimited tries while the counter
 * store is down. The reserve is per process and forgets on restart – it is a floor, not the real limiter.
 *
 * Inloggningen spärrar (2026-10-11, plan 1G): the sign-in rules (`whenStoreDown: "refuse"`) do not use the
 * reserve. While the shared counter cannot be read or written they refuse, and the caller tells the person to try again
 * in a while – a guessed password is never checked without the shared count behind it.
 */
export type RateRule = {
  name: string;
  limit: number;
  windowSeconds: number;
  /** What happens while the shared store fails: the in-process reserve (default) or a refusal. */
  whenStoreDown?: "reserve" | "refuse";
};
/** `unavailable` is set when a refusing rule could not reach the shared store (not "too many tries"). */
export type RateLimitHit = { allowed: boolean; count: number; retryAfterSeconds: number; unavailable?: true };
/** open: within the limit; limited: over it; unavailable: a refusing rule could not reach the shared store. */
export type RateLimitState = "open" | "limited" | "unavailable";

/** How long a sign-in refused because the counter store is down is asked to wait. */
export const STORE_DOWN_RETRY_SECONDS = 60;

export const RATE_RULES = {
  // Sign-in: ten wrong passwords per address in 15 minutes, and a wider net per IP address for spraying many accounts.
  // Both refuse while the counter store is down (2026-10-11), see the note at the top.
  loginAccount: { name: "login-account", limit: 10, windowSeconds: 15 * 60, whenStoreDown: "refuse" },
  loginIp: { name: "login-ip", limit: 50, windowSeconds: 15 * 60, whenStoreDown: "refuse" },
  // Tvåstegsverifiering (2026-10-10): five wrong codes per person in 15 minutes – at sign-in, when confirming it is you
  // and when turning two-factor on or off. A right code clears the window.
  twoFactor: { name: "two-factor", limit: 5, windowSeconds: 15 * 60, whenStoreDown: "refuse" },
  // Passkeys (2026-10-11): each started ceremony stores a short-lived challenge, so starting them is capped per IP
  // address; the sign-in itself counts in loginAccount and loginIp like a password.
  passkeyStart: { name: "passkey-start", limit: 120, windowSeconds: 15 * 60 },
  // Mail that anyone can ask for: a few per address and per IP an hour, never an inbox flood.
  mailAccount: { name: "mail-account", limit: 3, windowSeconds: 60 * 60 },
  mailIp: { name: "mail-ip", limit: 20, windowSeconds: 60 * 60 },
  register: { name: "register-ip", limit: 10, windowSeconds: 60 * 60 },
  // Följ nyhetsbrevet (2026-11-12): five tries an hour per (hashed) address on the landing page, and a ceiling for the whole
  // installation on confirmation mails an hour and a day, so a flood of invented addresses never becomes a flood of mail.
  newsletterIp: { name: "newsletter-ip", limit: 5, windowSeconds: 60 * 60 },
  newsletterMailHour: { name: "newsletter-mail-hour", limit: 60, windowSeconds: 60 * 60 },
  newsletterMailDay: { name: "newsletter-mail-day", limit: 300, windowSeconds: 24 * 60 * 60 },
  // Rapportera fel eller förslag (2026-11-13): five reports an hour per (hashed) IP address, ten a day per signed-in
  // person, and fifty a day for the whole installation, so the issue list is never flooded.
  reportIp: { name: "report-ip", limit: 5, windowSeconds: 60 * 60 },
  reportUser: { name: "report-user", limit: 10, windowSeconds: 24 * 60 * 60 },
  reportDay: { name: "report-day", limit: 50, windowSeconds: 24 * 60 * 60 },
  companyLookup: { name: "lookup-ip", limit: 30, windowSeconds: 60 * 60 },
  // Signed-in administrators (2026-10-07): more than a sign-up needs, never enough to walk the register.
  companyLookupUser: { name: "lookup-user", limit: 60, windowSeconds: 60 * 60 },
  // Adressförslag från kartnålen (2026-10-08): one lookup per pin move; a few hundred an hour per person at most.
  addressLookupUser: { name: "address-user", limit: 300, windowSeconds: 60 * 60 },
  // Adressökning medan man skriver (2026-10-15): one question per pause in typing (at least three characters); a
  // separate count so typing never uses up the pin's lookups, still far from enough to walk the register.
  addressSearchUser: { name: "address-search-user", limit: 600, windowSeconds: 60 * 60 },
  // Lagersaldo hos Solar (2026-10-15): one question per article search with hits; answers are kept ten minutes.
  solarStockUser: { name: "solar-stock-user", limit: 600, windowSeconds: 60 * 60 },
  // Miniatyrer i sökträffar (2026-10-18): one master-data question per Solar hit that comes into view; answers are kept 24 hours.
  solarMasterUser: { name: "solar-master-user", limit: 1200, windowSeconds: 60 * 60 },
  // Produktbilder genom servern (2026-11-02): one question per picture a page shows, and the browser keeps each for a day. Far more than a
  // person scrolls; the supplier is only asked when the server's cache does not have it.
  productImageUser: { name: "product-image-user", limit: 3000, windowSeconds: 60 * 60 },
  // Kvot per företag (2026-11-02): an installation has one Solar key; one company never uses up everybody's calls. Counted like
  // quoteSendOrganization, over stock questions, thumbnails and whole-number lookups together.
  solarOrganization: { name: "solar-org", limit: 6000, windowSeconds: 60 * 60 },
  // Where AI has no credits (Community) one company must not use up the installation's key either; lib/ai/company-limit.ts.
  aiOrganization: { name: "ai-org", limit: 300, windowSeconds: 60 * 60 },
  invitation: { name: "invitation-ip", limit: 20, windowSeconds: 60 * 60 },
  // Trattmätningens signaler (2026-10-07): a few per visit; never unlimited from one address.
  funnel: { name: "funnel-ip", limit: 300, windowSeconds: 60 * 60 },
  // The public demo reports each page it shows (2026-11-04): more than a funnel step, still never unlimited from one address.
  demoEvents: { name: "demo-events-ip", limit: 1200, windowSeconds: 60 * 60 },
  // Landningssidan (2026-11-16): a page load and a few button presses per visit; never unlimited from one address.
  landingEvents: { name: "landing-events-ip", limit: 600, windowSeconds: 60 * 60 },
  // API- och MCP-anrop (2026-10-08): 120 tool calls per key or connected app a minute, counted in RateLimitBucket like
  // the sign-in rules (lib/tools/dispatch.ts), so the limit holds across every app process and through a restart.
  integrationCall: { name: "integration-call", limit: 120, windowSeconds: 60 },
  // Maskinintag (S2): 120 calls a minute per source (each call holds up to 20 events); a wrong key is counted per address.
  ingestCall: { name: "ingest-call", limit: 120, windowSeconds: 60 },
  ingestRefused: { name: "ingest-refused-ip", limit: 30, windowSeconds: 10 * 60 },
  // Offert per e-post (steg E, 2026-10-09): the customer page and its answer are public. A link is 32 random bytes, so
  // these only keep one address from hammering them; sending is bounded per company and per quote.
  quoteLinkRead: { name: "quote-link-ip", limit: 300, windowSeconds: 60 * 60 },
  // Fakturor (2026-11-04): the customer's page for an invoice with a personal number.
  invoiceLinkRead: { name: "invoice-link-ip", limit: 120, windowSeconds: 60 * 60 },
  quoteAnswerIp: { name: "quote-answer-ip", limit: 30, windowSeconds: 60 * 60 },
  quoteAnswerLink: { name: "quote-answer-link", limit: 10, windowSeconds: 60 * 60 },
  quoteSendOrganization: { name: "quote-send-org", limit: 100, windowSeconds: 60 * 60 },
  quoteSendQuote: { name: "quote-send-quote", limit: 5, windowSeconds: 60 * 60 },
  // Operatörskonton (2026-10-30, lib/operator): five wrong passwords per account lock it for 15 minutes; a wider net per
  // IP address. Both refuse while the counter store is down, like the ordinary sign-in.
  operatorAccount: { name: "operator-account", limit: 5, windowSeconds: 15 * 60, whenStoreDown: "refuse" },
  operatorIp: { name: "operator-ip", limit: 40, windowSeconds: 15 * 60, whenStoreDown: "refuse" },
  // Kalenderlänken (PL14, 2026-11-01): a link is 32 random bytes and is read by calendar programs. Many people's calendars can come from
  // one service's address, so the address gets room; one link gets more reads an hour than any calendar asks for; a wrong link is counted per address.
  calendarFeedIp: { name: "calendar-feed-ip", limit: 1200, windowSeconds: 60 * 60 },
  calendarFeedLink: { name: "calendar-feed-link", limit: 60, windowSeconds: 60 * 60 },
  calendarRefusedIp: { name: "calendar-refused-ip", limit: 30, windowSeconds: 10 * 60 },
  // Felanmälan: at most 30 reports an hour per operator account (a shared terminal included), so a stuck button never floods the list.
  operatorReport: { name: "operator-report", limit: 30, windowSeconds: 60 * 60 },
  // PDF-mallar (2026-11-03): the product owner's saves and the editor's live previews (one per pause in typing), per person.
  pdfTemplateSave: { name: "pdf-template-save", limit: 300, windowSeconds: 60 * 60 },
  pdfTemplatePreview: { name: "pdf-template-preview", limit: 1200, windowSeconds: 60 * 60 },
  // Min webbsida (2026-11-10): per company, since every call reaches the company's own WordPress – changes (save, publish,
  // the connection, uploads) and reads (pages, previews, pictures) each have their own ceiling an hour.
  websiteChange: { name: "website-change", limit: 300, windowSeconds: 60 * 60 },
  websiteRead: { name: "website-read", limit: 3000, windowSeconds: 60 * 60 },
  // Facebook och Instagram (2026-11-10): per company – changes of the connection and the posts, reads (the card's check, the
  // pictures in the preview) and posts to Meta (Publicera and Testpublicering), each an hour.
  metaChange: { name: "meta-change", limit: 300, windowSeconds: 60 * 60 },
  metaRead: { name: "meta-read", limit: 2000, windowSeconds: 60 * 60 },
  metaPublish: { name: "meta-publish", limit: 30, windowSeconds: 60 * 60 },
  // LinkedIn (2026-11-11): the same per company and hour as Meta's.
  linkedinChange: { name: "linkedin-change", limit: 300, windowSeconds: 60 * 60 },
  linkedinRead: { name: "linkedin-read", limit: 2000, windowSeconds: 60 * 60 },
  // YouTube (2026-11-20): the connection and the films like LinkedIn's; the pieces of a film (2 MB each since 2026-11-25, so 2 GB is
  // 1024 pieces, plus the questions how far an upload came after a hiccup) and Publicera each have their own ceiling an hour.
  youtubeChange: { name: "youtube-change", limit: 300, windowSeconds: 60 * 60 },
  youtubeRead: { name: "youtube-read", limit: 2000, windowSeconds: 60 * 60 },
  youtubeUpload: { name: "youtube-upload", limit: 4800, windowSeconds: 60 * 60 },
  youtubePublish: { name: "youtube-publish", limit: 30, windowSeconds: 60 * 60 },
  // Skärmar och länkar (Tavlor etapp 2, 2026-11-18): a few pairing requests per address an hour; five wrong pairing codes per person
  // in 15 minutes (refused while the counter is down, as a sign-in); and a ceiling per address on opening shared links.
  screenPairIp: { name: "screen-pair-ip", limit: 30, windowSeconds: 60 * 60 },
  screenCodeUser: { name: "screen-code-user", limit: 5, windowSeconds: 15 * 60, whenStoreDown: "refuse" },
  boardLinkIp: { name: "board-link-ip", limit: 60, windowSeconds: 15 * 60 },
} satisfies Record<string, RateRule>;

export const rateLimitBucketKey = (rule: RateRule, subject: string) => `${rule.name}:${createHash("sha256").update(subject.trim().toLowerCase()).digest("base64url").slice(0, 32)}`;

/** Where the shared counters live; replaceable only in unit tests (the default is PostgreSQL). */
export type RateLimitStore = {
  hit(key: string, windowSeconds: number): Promise<{ count: number; windowStart: Date }>;
  read(key: string): Promise<{ count: number; windowStart: Date } | null>;
  clear(key: string): Promise<void>;
};

const postgresStore: RateLimitStore = {
  async hit(key, windowSeconds) {
    const rows = await prisma.$queryRaw<{ count: number; windowStart: Date }[]>`
      INSERT INTO "RateLimitBucket" ("key", "count", "windowStart", "updatedAt")
      VALUES (${key}, 1, NOW(), NOW())
      ON CONFLICT ("key") DO UPDATE SET
        "count" = CASE WHEN "RateLimitBucket"."windowStart" < NOW() - make_interval(secs => ${windowSeconds}) THEN 1 ELSE "RateLimitBucket"."count" + 1 END,
        "windowStart" = CASE WHEN "RateLimitBucket"."windowStart" < NOW() - make_interval(secs => ${windowSeconds}) THEN NOW() ELSE "RateLimitBucket"."windowStart" END,
        "updatedAt" = NOW()
      RETURNING "count", "windowStart"`;
    if (!rows[0]) throw new Error("Rate limit row missing");
    return rows[0];
  },
  async read(key) {
    return prisma.rateLimitBucket.findUnique({ where: { key }, select: { count: true, windowStart: true } });
  },
  async clear(key) {
    await prisma.rateLimitBucket.deleteMany({ where: { key } });
  },
};

let store: RateLimitStore = postgresStore;

/** Unit tests only: swap the shared store (pass null for PostgreSQL) and empty the in-process reserve. */
export function setRateLimitStoreForTests(next: RateLimitStore | null) {
  store = next ?? postgresStore;
  fallbackWindows.clear();
  lastWarning.clear();
}

// --- In-process reserve, used only while the shared store throws -------------------------------------------------

const FALLBACK_MAX_KEYS = 20_000;
const fallbackWindows = new Map<string, { count: number; windowStart: number; windowSeconds: number }>();
const lastWarning = new Map<string, number>();

function pruneFallback(now: number) {
  if (fallbackWindows.size < FALLBACK_MAX_KEYS) return;
  for (const [key, window] of fallbackWindows) if (window.windowStart + window.windowSeconds * 1000 <= now) fallbackWindows.delete(key);
  // Still full: forget the oldest windows first (Map keeps insertion order), so memory stays bounded.
  for (const key of fallbackWindows.keys()) {
    if (fallbackWindows.size < FALLBACK_MAX_KEYS) break;
    fallbackWindows.delete(key);
  }
}

/** Counts one attempt in this process's reserve window (the key is already hashed). */
export function fallbackHit(rule: RateRule, key: string, now = Date.now()): RateLimitHit {
  let window = fallbackWindows.get(key);
  if (!window || window.windowStart + rule.windowSeconds * 1000 <= now) {
    pruneFallback(now);
    window = { count: 0, windowStart: now, windowSeconds: rule.windowSeconds };
    fallbackWindows.set(key, window);
  }
  window.count += 1;
  const retryAfterSeconds = Math.max(1, Math.ceil((window.windowStart + rule.windowSeconds * 1000 - now) / 1000));
  return { allowed: window.count <= rule.limit, count: window.count, retryAfterSeconds };
}

/** Whether the reserve window is already full, without counting. */
export function fallbackLimited(rule: RateRule, key: string, now = Date.now()) {
  const window = fallbackWindows.get(key);
  return Boolean(window && window.count >= rule.limit && window.windowStart + rule.windowSeconds * 1000 > now);
}

/** One warning per rule and minute: the rule name and the error type, never the subject, key or message. */
function warnStoreDown(rule: RateRule, error: unknown, now = Date.now()) {
  const last = lastWarning.get(rule.name) ?? 0;
  if (now - last < 60_000) return;
  lastWarning.set(rule.name, now);
  const action = refusesWhenDown(rule) ? "refusing" : "using the in-process reserve for";
  console.warn(`Rate limit store unavailable; ${action} ${rule.name} (${error instanceof Error ? error.name : "Unknown"}).`);
}

const refusesWhenDown = (rule: RateRule) => rule.whenStoreDown === "refuse";

// --- Public API ----------------------------------------------------------------------------------------------------

/** Counts one attempt and says whether it is within the limit. A database error falls back to the in-process reserve. */
export async function hitRateLimit(rule: RateRule, subject: string): Promise<RateLimitHit> {
  const key = rateLimitBucketKey(rule, subject);
  try {
    const row = await store.hit(key, rule.windowSeconds);
    const count = Number(row.count);
    const retryAfterSeconds = Math.max(1, Math.ceil((new Date(row.windowStart).getTime() + rule.windowSeconds * 1000 - Date.now()) / 1000));
    return { allowed: count <= rule.limit, count, retryAfterSeconds };
  } catch (error) {
    warnStoreDown(rule, error);
    if (refusesWhenDown(rule)) return { allowed: false, count: 0, retryAfterSeconds: STORE_DOWN_RETRY_SECONDS, unavailable: true };
    return fallbackHit(rule, key);
  }
}

/** open, over the limit, or – for a refusing rule – unknown because the store is down. Counts nothing. */
export async function rateLimitState(rule: RateRule, subject: string): Promise<RateLimitState> {
  const key = rateLimitBucketKey(rule, subject);
  try {
    const row = await store.read(key);
    return row && row.count >= rule.limit && new Date(row.windowStart).getTime() + rule.windowSeconds * 1000 > Date.now() ? "limited" : "open";
  } catch (error) {
    warnStoreDown(rule, error);
    if (refusesWhenDown(rule)) return "unavailable";
    return fallbackLimited(rule, key) ? "limited" : "open";
  }
}

/** Whether the key may not try now (over its limit, or a refusing rule whose store is down), without counting. */
export async function rateLimited(rule: RateRule, subject: string) {
  return (await rateLimitState(rule, subject)) !== "open";
}

/** Forgets a key, for example an address after a successful sign-in (also in the reserve). */
export async function clearRateLimit(rule: RateRule, subject: string) {
  const key = rateLimitBucketKey(rule, subject);
  fallbackWindows.delete(key);
  await store.clear(key).catch(() => undefined);
}

/** Rows untouched for a day are past every window. */
export async function cleanRateLimits(now = new Date(), options: { dryRun?: boolean } = {}) {
  const where = { updatedAt: { lt: new Date(now.getTime() - 24 * 3600_000) } };
  // Torrkörning (T5, 2026-10-24): counted, not deleted.
  if (options.dryRun) return prisma.rateLimitBucket.count({ where });
  const { count } = await prisma.rateLimitBucket.deleteMany({ where });
  return count;
}
