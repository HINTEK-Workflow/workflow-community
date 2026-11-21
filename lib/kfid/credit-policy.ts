export const MAX_UNSPENT_PURCHASED_CREDITS = 1_000;

export function assertPurchasedCreditCapacity(currentUnspent: number, credits: number) {
  if (!Number.isSafeInteger(currentUnspent) || currentUnspent < 0 ||
      !Number.isSafeInteger(credits) || credits <= 0 ||
      currentUnspent + credits > MAX_UNSPENT_PURCHASED_CREDITS) {
    throw new Error("Högst 1 000 outnyttjade köpta krediter får finnas per företag.");
  }
}

export function oneYearFrom(purchasedAt: Date): Date {
  if (Number.isNaN(purchasedAt.getTime())) throw new Error("Ogiltigt köpdatum.");
  const year = purchasedAt.getUTCFullYear() + 1;
  const month = purchasedAt.getUTCMonth();
  const day = Math.min(
    purchasedAt.getUTCDate(),
    new Date(Date.UTC(year, month + 1, 0)).getUTCDate(),
  );
  return new Date(Date.UTC(
    year, month, day,
    purchasedAt.getUTCHours(), purchasedAt.getUTCMinutes(),
    purchasedAt.getUTCSeconds(), purchasedAt.getUTCMilliseconds(),
  ));
}
