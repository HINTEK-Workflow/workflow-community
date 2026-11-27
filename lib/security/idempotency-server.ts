import { randomUUID } from "node:crypto";
import { Prisma } from "@prisma/client";
import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { ApiError } from "@/lib/kfid/server";
import { IDEMPOTENCY_REPLAYED_HEADER, IDEMPOTENCY_TEXT, idempotencyCutoff, readIdempotencyKey, replayDecision, requestHash, type StoredKey } from "./idempotency";

/**
 * Idempotensnyckel, the database part (granskningen 2026-11-24, G-22; rules in lib/security/idempotency.ts).
 *
 * The row is claimed first in the same transaction as the new record (INSERT … ON CONFLICT DO NOTHING): a second request
 * with the key waits on the unique index until the first one has committed or rolled back. Committed, the second claim
 * takes nothing and the second request answers with the first one's answer; rolled back, the second request goes ahead as
 * if it were the first. Raw SQL, so the route does not depend on a regenerated client for this table.
 */
export type IdempotencyClaim = { organizationId: string; userId: string; scope: string; key: string; requestHash: string };

/** Thrown inside the transaction when another request already holds the key; the route answers with its answer. */
export class IdempotencyTaken extends Error {}

/** The claim for this request, or null without the header; a malformed key is refused with 400. */
export function idempotencyClaim(request: Request, who: { organizationId: string; userId: string }, scope: string, sent: unknown): IdempotencyClaim | null {
  const read = readIdempotencyKey(request.headers);
  if (!read.ok) throw new ApiError(400, read.message);
  if (!read.key) return null;
  return { ...who, scope, key: read.key, requestHash: requestHash(sent) };
}

async function stored(claim: IdempotencyClaim): Promise<StoredKey | null> {
  const rows = await prisma.$queryRaw<StoredKey[]>`SELECT "userId", "requestHash", "response" FROM "IdempotencyKey"
    WHERE "organizationId" = ${claim.organizationId} AND "scope" = ${claim.scope} AND "key" = ${claim.key} AND "createdAt" >= ${idempotencyCutoff()} LIMIT 1`;
  return rows[0] ?? null;
}

/** The first request's answer when this one repeats it; a refusal when the key was used otherwise; null to go ahead. */
export async function replayedAnswer(claim: IdempotencyClaim | null): Promise<NextResponse | null> {
  if (!claim) return null;
  const decision = replayDecision(await stored(claim), claim);
  if (decision.kind === "none") return null;
  if (decision.kind === "refuse") throw new ApiError(422, decision.message);
  if (decision.kind === "busy") throw new ApiError(409, IDEMPOTENCY_TEXT.busy);
  return NextResponse.json(decision.response, { headers: { [IDEMPOTENCY_REPLAYED_HEADER]: "true", "Cache-Control": "no-store" } });
}

/** Takes the key inside the create transaction; throws IdempotencyTaken when another request holds it. */
export async function claimIdempotencyKey(tx: Prisma.TransactionClient, claim: IdempotencyClaim | null) {
  if (!claim) return;
  // A key older than its 24 hours is forgotten, so it may be used again.
  await tx.$executeRaw`DELETE FROM "IdempotencyKey" WHERE "organizationId" = ${claim.organizationId} AND "scope" = ${claim.scope} AND "key" = ${claim.key} AND "createdAt" < ${idempotencyCutoff()}`;
  const taken = await tx.$executeRaw`INSERT INTO "IdempotencyKey" ("id", "organizationId", "scope", "key", "userId", "requestHash")
    VALUES (${randomUUID()}, ${claim.organizationId}, ${claim.scope}, ${claim.key}, ${claim.userId}, ${claim.requestHash})
    ON CONFLICT ("organizationId", "scope", "key") DO NOTHING`;
  if (!taken) throw new IdempotencyTaken();
}

/** Stores the answer (ids and version only) before the create transaction ends. */
export async function storeIdempotentAnswer(tx: Prisma.TransactionClient, claim: IdempotencyClaim | null, answer: Record<string, unknown>) {
  if (!claim) return;
  await tx.$executeRaw`UPDATE "IdempotencyKey" SET "response" = ${JSON.stringify(answer)}::jsonb
    WHERE "organizationId" = ${claim.organizationId} AND "scope" = ${claim.scope} AND "key" = ${claim.key}`;
}

/** After IdempotencyTaken: the first request's answer, or a refusal. */
export async function answerAfterTaken(claim: IdempotencyClaim): Promise<NextResponse> {
  const answer = await replayedAnswer(claim);
  if (!answer) throw new ApiError(409, IDEMPOTENCY_TEXT.busy);
  return answer;
}
