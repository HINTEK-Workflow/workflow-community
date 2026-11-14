// Kreditlotter (2026-10-27): what an audited reconciliation of one credit wallet would do. Pure, so the decision is
// unit-tested (tests/credit-reconcile-plan.test.ts) and the --check output shows exactly what --apply would write.
//
// The invariant: wallet.balance == sum(lot.remaining) == sum(entry.amount), and purchasedBalance == sum(remaining of
// the PURCHASE lots). Lots past their date count until an expiry has run (expiry takes them from the lots, the balance
// and the ledger in the same transaction), so "all lots" is the right sum – not only the lots that are still valid.
//
// Two of the three numbers agreeing is the evidence for which one is wrong. When all three differ nothing is decided
// automatically: the plan is "manual".

export type CreditWalletNumbers = {
  balance: number;
  lotBalance: number;
  ledgerBalance: number;
  purchasedBalance: number;
  purchasedLotBalance: number;
};

export type CreditReconciliationPlan =
  | { action: "none" }
  /** The balance and the ledger agree, the lots hold too little: a LEGACY lot carries the credits the ledger shows. */
  | { action: "add-lot"; credits: number }
  /** Same case, chosen with --remove: the credits without a lot are taken from the balance with an ADJUSTMENT entry. */
  | { action: "remove-credits"; credits: number }
  /** The lots and the ledger agree: the stored balance (and the purchased part) is set to what they show. */
  | { action: "set-balance"; balance: number; purchasedBalance: number }
  /** The balance and the lots agree, the ledger does not: one ADJUSTMENT entry evens the ledger out. */
  | { action: "add-entry"; amount: number }
  /** Only the purchased part differs from the PURCHASE lots. */
  | { action: "set-purchased"; purchasedBalance: number }
  | { action: "manual"; reason: string };

/** The highest purchased balance the database allows (CreditWallet_purchasedBalance_range). */
const PURCHASED_MAX = 1_000;

export function creditWalletHealthy(numbers: CreditWalletNumbers) {
  return numbers.balance === numbers.lotBalance && numbers.balance === numbers.ledgerBalance &&
    numbers.purchasedBalance === numbers.purchasedLotBalance;
}

export function planCreditReconciliation(
  numbers: CreditWalletNumbers,
  prefer: "lot" | "remove" = "lot",
): CreditReconciliationPlan {
  // Only the amounts: a caller may pass a whole row (ids, test mode, healthy), which is no amount to judge.
  for (const value of [numbers.balance, numbers.lotBalance, numbers.ledgerBalance, numbers.purchasedBalance, numbers.purchasedLotBalance])
    if (!Number.isSafeInteger(value)) return { action: "manual", reason: "Ett av beloppen är inte ett heltal." };
  if (creditWalletHealthy(numbers)) return { action: "none" };
  const { balance, lotBalance, ledgerBalance, purchasedBalance, purchasedLotBalance } = numbers;
  const purchasedMatches = purchasedBalance === purchasedLotBalance;

  if (balance === lotBalance && balance === ledgerBalance) {
    if (purchasedLotBalance < 0 || purchasedLotBalance > PURCHASED_MAX || purchasedLotBalance > balance)
      return { action: "manual", reason: "De köpta lotterna ligger utanför det tillåtna intervallet." };
    return { action: "set-purchased", purchasedBalance: purchasedLotBalance };
  }
  if (balance === ledgerBalance) {
    if (lotBalance > balance)
      return { action: "manual", reason: "Lotterna har fler krediter än saldot och bokföringen." };
    if (!purchasedMatches)
      return { action: "manual", reason: "Även de köpta krediterna skiljer sig; stäm av köpen för hand först." };
    const credits = balance - lotBalance;
    return prefer === "remove" ? { action: "remove-credits", credits } : { action: "add-lot", credits };
  }
  if (lotBalance === ledgerBalance) {
    if (lotBalance < 0 || purchasedLotBalance < 0 || purchasedLotBalance > PURCHASED_MAX || purchasedLotBalance > lotBalance)
      return { action: "manual", reason: "Lotterna ligger utanför det tillåtna intervallet." };
    return { action: "set-balance", balance: lotBalance, purchasedBalance: purchasedLotBalance };
  }
  if (balance === lotBalance) {
    if (!purchasedMatches)
      return { action: "manual", reason: "Även de köpta krediterna skiljer sig; stäm av köpen för hand först." };
    return { action: "add-entry", amount: balance - ledgerBalance };
  }
  return { action: "manual", reason: "Saldot, lotterna och bokföringen skiljer sig alla tre åt." };
}

/** One line for the log and the --check output (numbers only, never a name). */
export function describeCreditReconciliation(plan: CreditReconciliationPlan) {
  switch (plan.action) {
    case "none": return "Stämmer.";
    case "add-lot": return `Lägger till en justeringslott på ${plan.credits} krediter (saldot och bokföringen visar dem, lotterna saknar dem).`;
    case "remove-credits": return `Tar bort ${plan.credits} krediter ur saldot med en justeringspost (de saknar lott).`;
    case "set-balance": return `Sätter saldot till ${plan.balance} och det köpta saldot till ${plan.purchasedBalance} (lotterna och bokföringen är överens).`;
    case "add-entry": return `Lägger till en justeringspost på ${plan.amount} krediter i bokföringen (saldot och lotterna är överens).`;
    case "set-purchased": return `Sätter det köpta saldot till ${plan.purchasedBalance} (köplotterna).`;
    case "manual": return `Ingen automatisk åtgärd: ${plan.reason}`;
  }
}
