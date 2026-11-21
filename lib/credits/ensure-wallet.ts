import type { Prisma, PrismaClient } from "@prisma/client";
import { prisma } from "@/lib/db";

type WalletClient = Pick<PrismaClient, "creditWallet"> | Prisma.TransactionClient;

/**
 * Läs utan sidoeffekt (security hardening 2026-10-08): reading a company's context never creates a credit wallet any
 * more. Only an explicit credit action – a purchase, a compensation grant, an AI reservation, a test top-up or the
 * superadmin's credit policy – calls this, preferably inside its own transaction, so a wallet is created exactly where
 * credits are written. The new wallet has the schema's defaults (balance 0, test mode until a verified purchase flow
 * says otherwise), the same row the old read path used to create.
 */
export async function ensureCreditWallet(organizationId: string, client: WalletClient = prisma) {
  if (!organizationId) throw new Error("Organisation saknas för kreditplånboken.");
  return client.creditWallet.upsert({ where: { organizationId }, create: { organizationId }, update: {} });
}

/** What a read shows when the company has no wallet yet: the same zero balance a fresh wallet has. */
export const EMPTY_WALLET_VIEW = { balance: 0, testMode: true } as const;
