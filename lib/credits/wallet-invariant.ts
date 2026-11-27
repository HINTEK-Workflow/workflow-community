import type { Prisma, PrismaClient } from "@prisma/client";

type CreditInvariantClient = Pick<PrismaClient, "creditWallet" | "creditLot" | "creditEntry"> | Prisma.TransactionClient;

export type CreditWalletInvariant = {
  walletId: string | null;
  balance: number;
  lotBalance: number;
  purchasedBalance: number;
  purchasedLotBalance: number;
  ledgerBalance: number;
  walletBalanceMatchesLots: boolean;
  purchasedBalanceMatchesLots: boolean;
  walletBalanceMatchesLedger: boolean;
  healthy: boolean;
};

/**
 * Read-only reconciliation for a tenant wallet. Mutations must fail closed when
 * a stored wallet balance, its remaining lots, or its immutable entry ledger
 * disagree. This deliberately does not attempt an automatic repair.
 */
export async function readCreditWalletInvariant(
  client: CreditInvariantClient,
  organizationId: string,
): Promise<CreditWalletInvariant> {
  const wallet = await client.creditWallet.findUnique({
    where: { organizationId },
    select: { id: true, balance: true, purchasedBalance: true },
  });
  if (!wallet) {
    return {
      walletId: null,
      balance: 0,
      lotBalance: 0,
      purchasedBalance: 0,
      purchasedLotBalance: 0,
      ledgerBalance: 0,
      walletBalanceMatchesLots: false,
      purchasedBalanceMatchesLots: false,
      walletBalanceMatchesLedger: false,
      healthy: false,
    };
  }

  const [lots, purchasedLots, entries] = await Promise.all([
    client.creditLot.aggregate({ where: { walletId: wallet.id }, _sum: { remaining: true } }),
    client.creditLot.aggregate({ where: { walletId: wallet.id, origin: "PURCHASE" }, _sum: { remaining: true } }),
    client.creditEntry.aggregate({ where: { walletId: wallet.id }, _sum: { amount: true } }),
  ]);
  const lotBalance = lots._sum.remaining ?? 0;
  const purchasedLotBalance = purchasedLots._sum.remaining ?? 0;
  const ledgerBalance = entries._sum.amount ?? 0;
  const walletBalanceMatchesLots = wallet.balance === lotBalance;
  const purchasedBalanceMatchesLots = wallet.purchasedBalance === purchasedLotBalance;
  const walletBalanceMatchesLedger = wallet.balance === ledgerBalance;
  return {
    walletId: wallet.id,
    balance: wallet.balance,
    lotBalance,
    purchasedBalance: wallet.purchasedBalance,
    purchasedLotBalance,
    ledgerBalance,
    walletBalanceMatchesLots,
    purchasedBalanceMatchesLots,
    walletBalanceMatchesLedger,
    healthy: walletBalanceMatchesLots && purchasedBalanceMatchesLots && walletBalanceMatchesLedger,
  };
}
