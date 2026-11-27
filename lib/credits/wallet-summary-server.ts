import { prisma } from "@/lib/db";
import { creditSummary, type CreditSummary } from "./wallet-summary";

/** Lots with credits left are few (one per purchase or grant); the bound only guards a broken wallet. */
const LOT_LIMIT = 500;

/** The company's usable AI credits now (lib/credits/wallet-summary.ts); read only, never creates a wallet. */
export async function readCreditSummary(organizationId: string, now = new Date()): Promise<CreditSummary> {
  const wallet = await prisma.creditWallet.findUnique({
    where: { organizationId },
    select: {
      balance: true, purchasedBalance: true, testMode: true, expiryEnabled: true,
      lots: { where: { remaining: { gt: 0 } }, orderBy: [{ expiresAt: "asc" }, { createdAt: "asc" }], take: LOT_LIMIT, select: { origin: true, remaining: true, expiresAt: true } },
    },
  });
  return creditSummary(wallet, wallet?.lots ?? [], now);
}
