import { createHash, randomBytes } from "node:crypto";
import { promises as dns } from "node:dns";
import { domainToASCII } from "node:url";
import { prisma } from "@/lib/db";
import { env } from "@/lib/env";
import { publicInstance } from "@/lib/instance";
import { renderBaseTemplate } from "@/lib/mail/templates";
import { checkFormStamp, issueFormStamp } from "@/lib/security/form-stamp";

/**
 * Följ nyhetsbrevet (2026-11-12: "säker och inte skapar en massa skräpadresser"): an address typed on the landing page.
 *
 * - Double opt-in: the form only makes a pending row and sends one confirmation mail with a single-use link (32 random bytes;
 *   only the sha256 is stored, valid 48 hours). The row is active only after the link's page is confirmed with a press – a mail
 *   filter that opens links in advance confirms nothing. Unconfirmed rows are deleted when the link expires (mailings job).
 * - No junk: strict address rules, the domain must take mail (MX, or an address record), a hidden field and a signed time stamp
 *   (at least two seconds from the form being shown), a rate per hashed IP address and a ceiling for the whole installation on
 *   confirmation mails, and at most one confirmation mail per address a day.
 * - No enumeration: new, pending, active and a user's address all get the same answer (NEUTRAL_MESSAGE).
 * - Nothing is stored before the checks pass; the IP address only ever reaches the rate limiter as a hash.
 */
export const NEUTRAL_MESSAGE = "Om adressen stämmer får du ett e-postmeddelande för att bekräfta.";
export const TOKEN_HOURS = 48;
export const RESEND_HOURS = 24;
export { MIN_FILL_MS, MAX_STAMP_AGE_MS } from "@/lib/security/form-stamp";
export const EMAIL_MAX = 254;

// ---------- the address ----------

const LOCAL = /^[A-Za-z0-9!#$%&'*+/=?^_`{|}~-]+(?:\.[A-Za-z0-9!#$%&'*+/=?^_`{|}~-]+)*$/;
const LABEL = /^(?!-)[a-z0-9-]{1,63}(?<!-)$/;
/** Names that never take mail on the internet (RFC 2606, 6761 and local names). */
const RESERVED = /(^|\.)(localhost|local|localdomain|test|example|invalid|internal|lan|home|corp|onion)$/;

export type EmailCheck = { ok: true; email: string; domain: string } | { ok: false; message: string };

/** Trimmed, lower-cased and checked; an international domain is turned into its ASCII form. */
export function normalizeEmail(raw: unknown): EmailCheck {
  const bad = { ok: false as const, message: "Ange en giltig e-postadress." };
  if (typeof raw !== "string") return bad;
  const value = raw.trim();
  if (!value || value.length > EMAIL_MAX || /\s/.test(value)) return bad;
  const at = value.lastIndexOf("@");
  if (at < 1 || at !== value.indexOf("@")) return bad;
  const local = value.slice(0, at);
  const rawDomain = value.slice(at + 1);
  if (local.length > 64 || !LOCAL.test(local)) return bad;
  // No address literal ([1.2.3.4], [IPv6:…]) and no bare IP address.
  if (rawDomain.startsWith("[") || /^[\d.]+$/.test(rawDomain)) return bad;
  const domain = domainToASCII(rawDomain.toLowerCase().replace(/\.$/, ""));
  if (!domain || domain.length > 253) return bad;
  const labels = domain.split(".");
  if (labels.length < 2 || !labels.every((label) => LABEL.test(label))) return bad;
  const tld = labels[labels.length - 1]!;
  if (!/^(?:[a-z]{2,63}|xn--[a-z0-9-]{1,59})$/.test(tld) || RESERVED.test(domain)) return bad;
  const email = `${local.toLowerCase()}@${domain}`;
  if (email.length > EMAIL_MAX) return bad;
  return { ok: true, email, domain };
}

export type MailResolver = { resolveMx(domain: string): Promise<{ exchange: string; priority: number }[]>; resolve4(domain: string): Promise<string[]>; resolve6(domain: string): Promise<string[]> };
const systemResolver: MailResolver = { resolveMx: (domain) => dns.resolveMx(domain), resolve4: (domain) => dns.resolve4(domain), resolve6: (domain) => dns.resolve6(domain) };
const NOT_FOUND = new Set(["ENOTFOUND", "ENODATA", "ENONAME", "NXDOMAIN"]);
const codeOf = (error: unknown) => (error && typeof error === "object" && "code" in error ? String((error as { code: unknown }).code) : "");
const within = <T,>(promise: Promise<T>, ms: number) => Promise.race([promise, new Promise<never>((_, reject) => setTimeout(() => reject(Object.assign(new Error("timeout"), { code: "ETIMEOUT" })), ms))]);

/**
 * Whether the domain takes mail, asked by the server (never the browser): an MX record, or – as mail itself does – an address
 * record when there is no MX. A "null MX" (RFC 7505) says no. "unknown" when the name server does not answer.
 */
export async function domainTakesMail(domain: string, resolver: MailResolver = systemResolver, timeoutMs = 4_000): Promise<"yes" | "no" | "unknown"> {
  try {
    const records = await within(resolver.resolveMx(domain), timeoutMs);
    const real = records.filter((record) => record.exchange && record.exchange !== ".");
    if (real.length) return "yes";
    if (records.length) return "no";
  } catch (error) {
    if (!NOT_FOUND.has(codeOf(error))) return "unknown";
  }
  for (const lookup of [resolver.resolve4, resolver.resolve6]) {
    try { if ((await within(lookup.call(resolver, domain), timeoutMs)).length) return "yes"; }
    catch (error) { if (!NOT_FOUND.has(codeOf(error))) return "unknown"; }
  }
  return "no";
}

// ---------- the form's time stamp ----------

// The shared stamp (lib/security/form-stamp.ts) with this form's purpose; the same purpose as before, so a form shown before
// the change still passes.
const STAMP_PURPOSE = "newsletter-stamp";
/** Issued when the form is shown (GET /api/newsletter/subscribe). */
export const issueStamp = (now = Date.now()) => issueFormStamp(STAMP_PURPOSE, now);
/** ok: signed, at least MIN_FILL_MS old and not older than MAX_STAMP_AGE_MS; fast: filled in quicker than a person does. */
export const checkStamp = (stamp: unknown, now = Date.now()) => checkFormStamp(STAMP_PURPOSE, stamp, now);

// ---------- the token ----------

export const tokenHash = (token: string) => createHash("sha256").update(token).digest("hex");
export const newToken = () => randomBytes(32).toString("base64url");
export const TOKEN_PATTERN = /^[A-Za-z0-9_-]{43}$/;
export const confirmUrl = (token: string) => new URL(`/newsletter/confirm?t=${encodeURIComponent(token)}`, env.APP_URL).toString();

export function buildConfirmationEmail(url: string) {
  const name = publicInstance().name;
  const mail = renderBaseTemplate({
    heading: "Bekräfta nyhetsbrevet",
    intro: `Någon, förhoppningsvis du, vill få nyhetsbrevet från ${name} till den här adressen.`,
    outro: "Tryck på knappen för att bekräfta. Har du inte bett om det kan du strunta i meddelandet – då händer ingenting och adressen tas bort.",
    actionLabel: "Bekräfta",
    actionUrl: url,
    expiresText: `Länken gäller i ${TOKEN_HOURS} timmar och kan bara användas en gång.`,
  });
  return { subject: `Bekräfta nyhetsbrevet från ${name}`, ...mail };
}

// ---------- asking, confirming, saying no ----------

export type SubscribeDeps = {
  now?: Date;
  /** Sends the confirmation mail; null when this installation never sends (a loopback QA instance). */
  send: ((input: { to: string; subject: string; html: string; text: string }) => Promise<unknown>) | null;
  /** The installation-wide ceiling on confirmation mails, counted only when one is about to be sent. */
  allowMail: () => Promise<boolean>;
};
export type SubscribeResult = { status: "sent" | "skipped" | "capped" | "blocked" | "failed" };

/**
 * After every check of the request has passed: makes or renews the pending row and sends the mail. Whatever the address's state,
 * the caller answers the same (NEUTRAL_MESSAGE); `status` is only for tests and the server's own log.
 */
export async function requestSubscription(email: string, deps: SubscribeDeps): Promise<SubscribeResult> {
  const now = deps.now ?? new Date();
  const existing = await prisma.newsletterSubscriber.findUnique({ where: { email }, select: { id: true, status: true, confirmationSentAt: true } });
  if (existing?.status === "active") return { status: "skipped" };
  if (existing?.confirmationSentAt && now.getTime() - existing.confirmationSentAt.getTime() < RESEND_HOURS * 3600_000) return { status: "skipped" };
  if (!(await deps.allowMail())) return { status: "capped" };
  const token = newToken();
  const data = { status: "pending", tokenHash: tokenHash(token), tokenExpiresAt: new Date(now.getTime() + TOKEN_HOURS * 3600_000), confirmationSentAt: now };
  if (existing) {
    // Renewed only if nobody confirmed or renewed it in between.
    const renewed = await prisma.newsletterSubscriber.updateMany({ where: { id: existing.id, status: "pending", confirmationSentAt: existing.confirmationSentAt }, data });
    if (!renewed.count) return { status: "skipped" };
  } else {
    try { await prisma.newsletterSubscriber.create({ data: { email, ...data } }); }
    catch (error) { if (codeOf(error) === "P2002") return { status: "skipped" }; throw error; }
  }
  if (!deps.send) return { status: "blocked" };
  try { await deps.send({ to: email, ...buildConfirmationEmail(confirmUrl(token)) }); return { status: "sent" }; }
  catch { return { status: "failed" }; }
}

/** The link's page, before the press: whether the token belongs to a pending row that has not expired. Changes nothing. */
export async function confirmationValid(token: string, now = new Date()) {
  if (!TOKEN_PATTERN.test(token)) return false;
  return (await prisma.newsletterSubscriber.count({ where: { tokenHash: tokenHash(token), status: "pending", tokenExpiresAt: { gt: now } } })) > 0;
}

/** Bekräfta: single use – the token is cleared in the same update that makes the row active. */
export async function confirmSubscription(token: string, now = new Date()) {
  if (!TOKEN_PATTERN.test(token)) return false;
  const done = await prisma.newsletterSubscriber.updateMany({
    where: { tokenHash: tokenHash(token), status: "pending", tokenExpiresAt: { gt: now } },
    data: { status: "active", confirmedAt: now, tokenHash: null, tokenExpiresAt: null },
  });
  return done.count > 0;
}

/** Avböj: the row is deleted, nothing of the address is kept. */
export async function removeSubscriber(id: string) {
  const { count } = await prisma.newsletterSubscriber.deleteMany({ where: { id } });
  return count > 0;
}

/** Unconfirmed addresses whose link has expired (from the mailings job); counts only. */
export async function purgeExpiredSubscriptions(now = new Date(), options: { dryRun?: boolean } = {}) {
  const where = { status: "pending", OR: [{ tokenExpiresAt: { lt: now } }, { tokenExpiresAt: null, createdAt: { lt: new Date(now.getTime() - TOKEN_HOURS * 3600_000) } }] };
  if (options.dryRun) return prisma.newsletterSubscriber.count({ where });
  return (await prisma.newsletterSubscriber.deleteMany({ where })).count;
}

export const activeSubscriberCount = () => prisma.newsletterSubscriber.count({ where: { status: "active" } });
