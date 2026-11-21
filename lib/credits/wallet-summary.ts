import { swedishDayKey } from "@/lib/swedish-time";

/**
 * AI-krediter som de verkligen är (2026-10-28: "rätta AI-krediter så att de visar verkligt saldo och
 * giltighetstid"). The wallet's balance counts every lot until the nightly sweep (ee/billing/credit-expiry.ts →
 * expireDueLots) has removed the expired ones, so between the expiry and the sweep the raw balance shows credits that can
 * no longer be used. This summary leaves out every lot past its expiresAt at once, with the same rule as the billing page
 * (ee/api/billing.ts: a lot is active while it has credits left and has not expired, or the wallet has no expiry), and
 * says when the credits stop being valid. Pure, so the workspace, Ekonomi and the tests read one rule.
 */
export type CreditLotOrigin = "PURCHASE" | "COMPENSATION" | "LEGACY";
export type CreditLotLike = { origin: CreditLotOrigin | string; remaining: number; expiresAt: Date | string | null };
export type CreditWalletLike = { balance: number; purchasedBalance: number; testMode: boolean; expiryEnabled: boolean };

export type CreditSummary = {
  /** Usable credits now: the wallet's balance minus what has expired but is not swept yet. */
  balance: number;
  /** Of which bought (a purchase lot). */
  purchased: number;
  /** Of which other credits (compensation, test or older credits). */
  other: number;
  /** The earliest day an active lot stops being valid (ISO), null when nothing expires. */
  expiresAt: string | null;
  /** Credits past their day that the sweep has not removed yet (left out of `balance`). */
  expiredPending: number;
  testMode: boolean;
};

export const EMPTY_CREDIT_SUMMARY: CreditSummary = { balance: 0, purchased: 0, other: 0, expiresAt: null, expiredPending: 0, testMode: true };

const time = (value: Date | string | null) => value === null ? null : (value instanceof Date ? value : new Date(value)).getTime();

/** A lot that can still be used at `now` (the billing page's rule). */
export function creditLotActive(lot: CreditLotLike, expiryEnabled: boolean, now: Date): boolean {
  if (lot.remaining <= 0) return false;
  const expires = time(lot.expiresAt);
  return !expiryEnabled || expires === null || !Number.isFinite(expires) || expires > now.getTime();
}

export function creditSummary(wallet: CreditWalletLike | null, lots: readonly CreditLotLike[], now: Date): CreditSummary {
  if (!wallet) return EMPTY_CREDIT_SUMMARY;
  let expired = 0, expiredPurchased = 0, earliest: number | null = null;
  for (const lot of lots) {
    if (lot.remaining <= 0) continue;
    if (!creditLotActive(lot, wallet.expiryEnabled, now)) {
      expired += lot.remaining;
      if (lot.origin === "PURCHASE") expiredPurchased += lot.remaining;
      continue;
    }
    const expires = wallet.expiryEnabled ? time(lot.expiresAt) : null;
    if (expires !== null && Number.isFinite(expires) && (earliest === null || expires < earliest)) earliest = expires;
  }
  const balance = Math.max(0, wallet.balance - expired);
  const purchased = Math.min(balance, Math.max(0, wallet.purchasedBalance - expiredPurchased));
  return { balance, purchased, other: Math.max(0, balance - purchased), expiresAt: earliest === null ? null : new Date(earliest).toISOString(), expiredPending: expired, testMode: wallet.testMode };
}

/**
 * The short lines under the balance: what the credits are ("Köpta 120 · Övriga 30", only the parts there are) and how long
 * they are valid ("Gäller till 2027-10-12"; "" when nothing expires or nothing is left).
 */
export function creditSummaryLines(summary: CreditSummary): { split: string; validity: string } {
  const split = [summary.purchased ? `Köpta ${summary.purchased}` : "", summary.other ? `Övriga ${summary.other}` : ""].filter(Boolean).join(" · ");
  return { split, validity: summary.balance > 0 && summary.expiresAt ? `Gäller till ${swedishDayKey(summary.expiresAt)}` : "" };
}
