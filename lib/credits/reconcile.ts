// Kreditlotter (2026-10-27): finds credit wallets whose balance, lots and ledger disagree, and evens one out only on an
// explicit, audited order (npm run credits:reconcile -- --apply --org <id> --reason "…"). Nothing here runs by itself:
// the daily credits:check only reads and raises the operations alarm.
import { randomUUID } from "node:crypto";
import type { PrismaClient } from "@prisma/client";
import { readCreditWalletInvariant } from "@/lib/credits/wallet-invariant";
import { lockedWallet } from "@/lib/kfid/purchased-credits";
import {
  creditWalletHealthy,
  describeCreditReconciliation,
  planCreditReconciliation,
  type CreditReconciliationPlan,
  type CreditWalletNumbers,
} from "@/lib/credits/reconcile-plan";

export type CreditWalletDrift = CreditWalletNumbers & {
  walletId: string;
  organizationId: string;
  testMode: boolean;
  plan: CreditReconciliationPlan;
};

/** Every wallet that disagrees with its lots or its ledger, in one read (ids and numbers only). */
export async function findCreditWalletDrift(db: Pick<PrismaClient, "$queryRaw">): Promise<{ checked: number; drifted: CreditWalletDrift[] }> {
  const rows = await db.$queryRaw<Array<CreditWalletNumbers & { walletId: string; organizationId: string; testMode: boolean }>>`
    SELECT w.id AS "walletId", w."organizationId", w."testMode", w.balance, w."purchasedBalance",
      COALESCE(l.total, 0)::int AS "lotBalance",
      COALESCE(l.purchased, 0)::int AS "purchasedLotBalance",
      COALESCE(e.total, 0)::int AS "ledgerBalance"
    FROM "CreditWallet" w
    LEFT JOIN (
      SELECT "walletId", sum(remaining) AS total, sum(remaining) FILTER (WHERE origin = 'PURCHASE') AS purchased
      FROM "CreditLot" GROUP BY "walletId"
    ) l ON l."walletId" = w.id
    LEFT JOIN (SELECT "walletId", sum(amount) AS total FROM "CreditEntry" GROUP BY "walletId") e ON e."walletId" = w.id
    ORDER BY w.id`;
  const drifted = rows
    .filter((row) => !creditWalletHealthy(row))
    .map((row) => ({ ...row, plan: planCreditReconciliation(row) }));
  return { checked: rows.length, drifted };
}

export class CreditReconcileError extends Error {}

/**
 * Evens out one wallet under its row lock, in one transaction: works out the plan again from the locked numbers, refuses
 * when it differs from what the operator expected (`expectDifference` = balance − lots shown by --check), writes the
 * adjustment, checks that the wallet is healthy afterwards (otherwise everything is rolled back) and leaves an audit
 * trail in BillingAuditEvent and AdministrationEvent with the numbers before and after, the reason and who ordered it.
 */
export async function applyCreditReconciliation(db: PrismaClient, input: {
  organizationId: string;
  reason: string;
  actor: string;
  prefer?: "lot" | "remove";
  expectDifference?: number;
}) {
  const reason = input.reason.trim();
  const actor = input.actor.trim();
  if (reason.length < 10 || reason.length > 500) throw new CreditReconcileError("Ange en anledning (10–500 tecken).");
  if (!actor || actor.length > 100) throw new CreditReconcileError("Ange vem som beställer avstämningen.");
  return db.$transaction(async (tx) => {
    if (!(await tx.creditWallet.findUnique({ where: { organizationId: input.organizationId }, select: { id: true } })))
      throw new CreditReconcileError("Företaget har ingen kreditplånbok.");
    const wallet = await lockedWallet(input.organizationId, tx);
    const before = await readCreditWalletInvariant(tx, input.organizationId);
    const plan = planCreditReconciliation(before, input.prefer ?? "lot");
    if (input.expectDifference !== undefined && before.balance - before.lotBalance !== input.expectDifference)
      throw new CreditReconcileError(`Skillnaden är nu ${before.balance - before.lotBalance}, inte ${input.expectDifference}. Kör --check igen.`);
    if (plan.action === "none") return { plan, before, after: before, changed: false };
    if (plan.action === "manual") throw new CreditReconcileError(describeCreditReconciliation(plan));
    const key = `reconcile:${wallet.id}:${randomUUID()}`;
    const description = `Avstämning av kreditplånboken: ${reason}`.slice(0, 200);

    if (plan.action === "add-lot") {
      await tx.creditLot.create({
        data: { walletId: wallet.id, origin: "LEGACY", sourceKey: key, credits: plan.credits, remaining: plan.credits,
          grantedBy: actor, reason: description, noExpiryReason: "Avstämning: krediter som saldot och bokföringen visar men som saknade lott" },
      });
    } else if (plan.action === "remove-credits") {
      await tx.creditEntry.create({ data: { walletId: wallet.id, amount: -plan.credits, kind: "ADJUSTMENT", requestKey: key, description } });
      await tx.creditWallet.update({ where: { id: wallet.id }, data: { balance: { decrement: plan.credits } } });
    } else if (plan.action === "set-balance") {
      await tx.creditWallet.update({ where: { id: wallet.id }, data: { balance: plan.balance, purchasedBalance: plan.purchasedBalance } });
    } else if (plan.action === "add-entry") {
      await tx.creditEntry.create({ data: { walletId: wallet.id, amount: plan.amount, kind: "ADJUSTMENT", requestKey: key, description } });
    } else if (plan.action === "set-purchased") {
      await tx.creditWallet.update({ where: { id: wallet.id }, data: { purchasedBalance: plan.purchasedBalance } });
    }

    const after = await readCreditWalletInvariant(tx, input.organizationId);
    if (!after.healthy) throw new CreditReconcileError("Plånboken stämmer inte efter justeringen; inget har ändrats.");
    const numbers = (value: typeof before) => ({ balance: value.balance, lotBalance: value.lotBalance, ledgerBalance: value.ledgerBalance,
      purchasedBalance: value.purchasedBalance, purchasedLotBalance: value.purchasedLotBalance });
    await tx.billingAuditEvent.create({
      data: { organizationId: input.organizationId, actorId: null, action: "credit_wallet_reconciled", entityType: "CreditWallet",
        entityId: wallet.id, data: { plan, before: numbers(before), after: numbers(after), reason, orderedBy: actor, key } },
    });
    await tx.administrationEvent.create({
      data: { actorId: "system:credits-reconcile", organizationId: input.organizationId, action: "credit_wallet_reconciled",
        detail: `${describeCreditReconciliation(plan)} Före: saldo ${before.balance}, lotter ${before.lotBalance}, bokföring ${before.ledgerBalance}. Beställd av ${actor}: ${reason}`.slice(0, 1000) },
    });
    return { plan, before, after, changed: true };
  });
}
