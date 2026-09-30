import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { assertPurchasedCreditCapacity, oneYearFrom } from "./credit-policy";

// Internal domain operations only. No checkout, webhook or public route calls these yet.
type CreditTransaction = Prisma.TransactionClient;

export async function lockedWallet(organizationId: string, tx: CreditTransaction) {
  const wallet = await tx.creditWallet.findUnique({ where: { organizationId } });
  if (!wallet) throw new Error("Företagets kreditplånbok saknas.");
  const locked = await tx.$queryRaw<Array<{ id: string }>>`
    SELECT id FROM "CreditWallet" WHERE id=${wallet.id} FOR UPDATE`;
  if (!locked.length) throw new Error("Kreditplånboken kunde inte låsas.");
  return tx.creditWallet.findUniqueOrThrow({ where: { id: wallet.id } });
}

export async function expireDueLots(tx: CreditTransaction, walletId: string, now: Date) {
  const due = await tx.creditLot.findMany({
    where: { walletId, remaining: { gt: 0 }, expiresAt: { lte: now } },
    orderBy: [{ expiresAt: "asc" }, { id: "asc" }],
  });
  const expired = due.reduce((total, lot) => total + lot.remaining, 0);
  const expiredPurchased = due
    .filter((lot) => lot.origin === "PURCHASE")
    .reduce((total, lot) => total + lot.remaining, 0);
  if (!expired) return 0;
  const wallet = await tx.creditWallet.findUniqueOrThrow({ where: { id: walletId } });
  if (wallet.balance < expired || wallet.purchasedBalance < expiredPurchased)
    throw new Error("Kreditsaldot stämmer inte med köplotterna.");
  for (const lot of due) {
    await tx.creditLot.update({ where: { id: lot.id }, data: { remaining: 0 } });
    await tx.creditEntry.create({
      data: { walletId, amount: -lot.remaining, kind: "EXPIRY",
        requestKey: `expiry:${lot.id}`, description: "Utgångna köpta krediter" },
    });
  }
  await tx.creditWallet.update({
    where: { id: walletId },
    data: { balance: { decrement: expired }, purchasedBalance: { decrement: expiredPurchased } },
  });
  await tx.billingAuditEvent.create({
    data: {
      organizationId: wallet.organizationId,
      actorId: null,
      action: "purchased_credits_expired",
      entityType: "CreditWallet",
      entityId: wallet.id,
      data: {
        credits: expired,
        purchasedCredits: expiredPurchased,
        lotCount: due.length,
        expiredAt: now.toISOString(),
      },
    },
  });
  return expired;
}

export async function expirePurchasedCredits(organizationId: string, now = new Date()) {
  if (Number.isNaN(now.getTime())) throw new Error("Ogiltigt datum.");
  return prisma.$transaction(async (tx) => {
    const wallet = await lockedWallet(organizationId, tx);
    if (wallet.testMode || !wallet.expiryEnabled) return 0;
    return expireDueLots(tx, wallet.id, now);
  });
}

export async function fulfillPaidCreditPurchase(
  organizationId: string,
  purchaseId: string,
  now = new Date(),
) {
  if (Number.isNaN(now.getTime())) throw new Error("Ogiltigt datum.");
  return prisma.$transaction(async (tx) => {
    const wallet = await lockedWallet(organizationId, tx);
    if (wallet.testMode) throw new Error("Köpta krediter får inte tilldelas i testläge.");
    const purchase = await tx.creditPurchase.findFirst({
      where: { id: purchaseId, organizationId },
    });
    if (!purchase || purchase.status !== "PAID" || !purchase.paidAt || purchase.credits <= 0)
      throw new Error("Endast verifierade, betalda kreditköp får tilldelas.");
    const existing = await tx.creditLot.findUnique({ where: { purchaseId } });
    if (existing) {
      if (existing.walletId !== wallet.id || !purchase.creditEntryId)
        throw new Error("Kreditköpets bokföring är inkonsekvent.");
      return { credited: false, balance: wallet.balance, purchasedBalance: wallet.purchasedBalance };
    }
    if (purchase.creditEntryId) throw new Error("Kreditköpet saknar sin köplott.");
    const order = purchase.providerCheckoutId
      ? await tx.billingOrder.findFirst({
          where: {
            organizationId,
            providerCheckoutId: purchase.providerCheckoutId,
          },
          select: { creditTermsVersion: true, creditTermsHash: true },
        })
      : null;
    if (
      purchase.providerCheckoutId &&
      (!order?.creditTermsVersion || !order.creditTermsHash)
    )
      throw new Error("Kreditköpet saknar bundna kreditvillkor.");
    if (wallet.expiryEnabled && wallet.expiryOverrideAt && wallet.expiryOverrideAt <= now)
      throw new Error("Det manuella slutdatumet har redan passerat.");
    if (wallet.expiryEnabled) await expireDueLots(tx, wallet.id, now);
    const current = await tx.creditWallet.findUniqueOrThrow({ where: { id: wallet.id } });
    const sum = await tx.creditLot.aggregate({
      where: { walletId: wallet.id, origin: "PURCHASE" }, _sum: { remaining: true },
    });
    if (current.purchasedBalance !== (sum._sum.remaining ?? 0))
      throw new Error("Kreditsaldot stämmer inte med köplotterna.");
    assertPurchasedCreditCapacity(current.purchasedBalance, purchase.credits);

    const expiresAt = wallet.expiryEnabled
      ? (wallet.expiryOverrideAt ?? oneYearFrom(purchase.paidAt)) : null;
    if (expiresAt && expiresAt <= now)
      throw new Error("Kreditköpets giltighetstid har redan passerat.");
    await tx.creditLot.updateMany({
      where: { walletId: wallet.id, origin: "PURCHASE", remaining: { gt: 0 } },
      data: { expiresAt },
    });
    await tx.creditLot.create({
      data: { walletId: wallet.id, purchaseId, origin: "PURCHASE",
        sourceKey: `purchase:${purchase.id}`, credits: purchase.credits,
        remaining: purchase.credits,
        termsVersion: order?.creditTermsVersion,
        termsHash: order?.creditTermsHash,
        expiresAt },
    });
    const entry = await tx.creditEntry.create({
      data: { walletId: wallet.id, amount: purchase.credits, kind: "PURCHASE",
        requestKey: `purchase:${purchase.id}`, description: "Verifierat köp av krediter" },
    });
    await tx.creditPurchase.update({
      where: { id: purchase.id }, data: { creditEntryId: entry.id },
    });
    const updated = await tx.creditWallet.update({
      where: { id: wallet.id },
      data: { balance: { increment: purchase.credits },
        purchasedBalance: { increment: purchase.credits } },
    });
    return { credited: true, balance: updated.balance, purchasedBalance: updated.purchasedBalance };
  });
}

export async function spendPurchasedCredits(
  organizationId: string,
  cost: number,
  requestKey: string,
  description: string,
  now = new Date(),
) {
  if (!Number.isSafeInteger(cost) || cost <= 0 || cost > 1_000)
    throw new Error("Ogiltig kreditkostnad.");
  if (!/^[a-zA-Z0-9:-]{8,150}$/.test(requestKey) || !description.trim())
    throw new Error("Ogiltig kreditbegäran.");
  if (Number.isNaN(now.getTime())) throw new Error("Ogiltigt datum.");
  const key = `paid-spend:${organizationId}:${requestKey}`;
  return prisma.$transaction(async (tx) => {
    const wallet = await lockedWallet(organizationId, tx);
    if (wallet.testMode) throw new Error("Köpta krediter kan inte förbrukas i testläge.");
    const existing = await tx.creditEntry.findUnique({ where: { requestKey: key } });
    if (existing) {
      if (existing.walletId !== wallet.id || existing.amount !== -cost || existing.kind !== "PAID_SPEND")
        throw new Error("Idempotensnyckeln används redan för en annan kreditbegäran.");
      return { spent: false, entryId: existing.id };
    }
    if (wallet.expiryEnabled) await expireDueLots(tx, wallet.id, now);
    const current = await tx.creditWallet.findUniqueOrThrow({ where: { id: wallet.id } });
    if (current.purchasedBalance < cost || current.balance < cost)
      throw new Error("Otillräckligt saldo av köpta krediter.");
    const lots = await tx.creditLot.findMany({
      where: { walletId: wallet.id, origin: "PURCHASE", remaining: { gt: 0 } },
      orderBy: [{ expiresAt: "asc" }, { createdAt: "asc" }, { id: "asc" }],
    });
    if (lots.reduce((sum, lot) => sum + lot.remaining, 0) !== current.purchasedBalance)
      throw new Error("Kreditsaldot stämmer inte med köplotterna.");
    const entry = await tx.creditEntry.create({
      data: { walletId: wallet.id, amount: -cost, kind: "PAID_SPEND",
        requestKey: key, description: description.trim().slice(0, 200) },
    });
    let left = cost;
    for (const lot of lots) {
      if (!left) break;
      const amount = Math.min(left, lot.remaining);
      await tx.creditLot.update({ where: { id: lot.id }, data: { remaining: { decrement: amount } } });
      await tx.creditAllocation.create({ data: { lotId: lot.id, entryId: entry.id, amount } });
      left -= amount;
    }
    if (left) throw new Error("Kreditsaldot stämmer inte med köplotterna.");
    await tx.creditWallet.update({
      where: { id: wallet.id },
      data: { balance: { decrement: cost }, purchasedBalance: { decrement: cost } },
    });
    return { spent: true, entryId: entry.id };
  });
}

export async function grantCompensationCredits(input: {
  organizationId: string;
  actorId: string;
  credits: number;
  requestKey: string;
  reason: string;
  expiresAt: Date | null;
  noExpiryReason?: string;
}, now = new Date()) {
  if (!Number.isSafeInteger(input.credits) || input.credits <= 0 || input.credits > 100_000)
    throw new Error("Ogiltigt antal kompensationskrediter.");
  if (!/^[a-zA-Z0-9:_-]{8,150}$/.test(input.requestKey))
    throw new Error("Ogiltig idempotensnyckel.");
  const reason = input.reason.trim();
  if (!reason || reason.length > 500) throw new Error("Anledning krävs.");
  if (Number.isNaN(now.getTime()) || (input.expiresAt && Number.isNaN(input.expiresAt.getTime())))
    throw new Error("Ogiltigt datum.");
  if (input.expiresAt && input.expiresAt <= now) throw new Error("Utgångsdatumet måste ligga i framtiden.");
  const noExpiryReason = input.noExpiryReason?.trim() ?? "";
  if (!input.expiresAt && !noExpiryReason)
    throw new Error("Särskild motivering krävs när krediter gäller tills vidare.");
  if (noExpiryReason.length > 500) throw new Error("Motiveringen är för lång.");
  const sourceKey = `compensation:${input.organizationId}:${input.requestKey}`;
  return prisma.$transaction(async (tx) => {
    const wallet = await lockedWallet(input.organizationId, tx);
    const existing = await tx.creditLot.findUnique({ where: { sourceKey } });
    if (existing) {
      if (existing.walletId !== wallet.id || existing.origin !== "COMPENSATION" ||
          existing.credits !== input.credits || existing.reason !== reason)
        throw new Error("Idempotensnyckeln används för en annan kompensation.");
      return { lot: existing, created: false };
    }
    const entry = await tx.creditEntry.create({
      data: {
        walletId: wallet.id,
        amount: input.credits,
        kind: "COMPENSATION",
        requestKey: sourceKey,
        description: reason,
      },
    });
    const lot = await tx.creditLot.create({
      data: {
        walletId: wallet.id,
        origin: "COMPENSATION",
        sourceKey,
        credits: input.credits,
        remaining: input.credits,
        grantedBy: input.actorId,
        reason,
        expiresAt: input.expiresAt,
        noExpiryReason: input.expiresAt ? null : noExpiryReason,
      },
    });
    await tx.creditWallet.update({
      where: { id: wallet.id }, data: { balance: { increment: input.credits } },
    });
    return { lot, entryId: entry.id, created: true };
  });
}

export async function spendTrackedCredits(
  organizationId: string,
  cost: number,
  requestKey: string,
  description: string,
  now = new Date(),
) {
  if (!Number.isSafeInteger(cost) || cost <= 0 || cost > 1_000)
    throw new Error("Ogiltig kreditkostnad.");
  if (!/^[a-zA-Z0-9:_-]{8,150}$/.test(requestKey) || !description.trim())
    throw new Error("Ogiltig kreditbegäran.");
  if (Number.isNaN(now.getTime())) throw new Error("Ogiltigt datum.");
  const key = `tracked-spend:${organizationId}:${requestKey}`;
  return prisma.$transaction(async (tx) => {
    const wallet = await lockedWallet(organizationId, tx);
    const existing = await tx.creditEntry.findUnique({ where: { requestKey: key } });
    if (existing) {
      if (existing.walletId !== wallet.id || existing.amount !== -cost || existing.kind !== "TRACKED_SPEND")
        throw new Error("Idempotensnyckeln används redan för en annan kreditbegäran.");
      return { spent: false, entryId: existing.id };
    }
    if (wallet.expiryEnabled) await expireDueLots(tx, wallet.id, now);
    const current = await tx.creditWallet.findUniqueOrThrow({ where: { id: wallet.id } });
    const lots = await tx.creditLot.findMany({
      where: { walletId: wallet.id, remaining: { gt: 0 } },
    });
    lots.sort((left, right) => {
      if (left.expiresAt && right.expiresAt)
        return left.expiresAt.getTime() - right.expiresAt.getTime() ||
          left.createdAt.getTime() - right.createdAt.getTime() || left.id.localeCompare(right.id);
      if (left.expiresAt) return -1;
      if (right.expiresAt) return 1;
      return left.createdAt.getTime() - right.createdAt.getTime() || left.id.localeCompare(right.id);
    });
    if (lots.reduce((sum, lot) => sum + lot.remaining, 0) < cost || current.balance < cost)
      throw new Error("Otillräckligt saldo av spårade krediter.");
    const entry = await tx.creditEntry.create({
      data: { walletId: wallet.id, amount: -cost, kind: "TRACKED_SPEND",
        requestKey: key, description: description.trim().slice(0, 200) },
    });
    let left = cost;
    let purchasedSpent = 0;
    for (const lot of lots) {
      if (!left) break;
      const amount = Math.min(left, lot.remaining);
      await tx.creditLot.update({ where: { id: lot.id }, data: { remaining: { decrement: amount } } });
      await tx.creditAllocation.create({ data: { lotId: lot.id, entryId: entry.id, amount } });
      if (lot.origin === "PURCHASE") purchasedSpent += amount;
      left -= amount;
    }
    await tx.creditWallet.update({
      where: { id: wallet.id },
      data: { balance: { decrement: cost }, purchasedBalance: { decrement: purchasedSpent } },
    });
    return { spent: true, entryId: entry.id, purchasedSpent };
  });
}
