import type { AiRun, CreditLot, Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { getWorkflowAgent } from "@/lib/ai/agent-registry";
import { SETTING_FX_SOURCE } from "@/lib/ai/credit-settings";
import {
  calculateAiUsageCost,
  quoteAiRun,
  type AiTokenUsage,
} from "@/lib/ai/cost-policy";
import { routeAiModel, type AiTaskKind } from "@/lib/ai/model-catalog";
import { expireDueLots, lockedWallet } from "@/lib/kfid/purchased-credits";

type AiTransaction = Prisma.TransactionClient;

const REQUEST_KEY = /^[a-zA-Z0-9:_-]{8,150}$/;
const FAILURE_CODE = /^[A-Z0-9:_-]{3,80}$/;
const FX_SOURCE = /^[A-Z0-9_-]{3,80}$/;
const SURFACE = /^[a-z][a-z0-9-]{1,39}$/;
const MAX_INPUT_TOKENS = 200_000;
const MAX_FX_AGE_MS = 35 * 24 * 60 * 60 * 1_000;

export type AiRunSubject =
  | { type: "KFID_CONTROL"; id: string }
  | { type: "WORKFLOW_ASSISTANT"; id: string }
  | { type: "DOCUMENT"; id: string }
  // What a proposal or a text was written from (fas 2), and a company's day for the nightly digest (fas 4).
  | { type: "WORKFLOW_TASK"; id: string }
  | { type: "PROJECT"; id: string }
  | { type: "ORGANIZATION_DAY"; id: string };

function resolveSubject(input: ReserveAiRunInput): AiRunSubject {
  const subject = input.subject ?? (input.controlId
    ? { type: "KFID_CONTROL" as const, id: input.controlId }
    : null);
  if (!subject || !subject.id.trim() || subject.id.length > 100)
    throw new Error("AI-körningens resurs är ogiltig.");
  if (input.controlId && (subject.type !== "KFID_CONTROL" || subject.id !== input.controlId))
    throw new Error("AI-körningens kontroll och resurs stämmer inte överens.");
  return subject;
}

function assertDate(value: Date, label: string) {
  if (Number.isNaN(value.getTime())) throw new Error(`${label} är ogiltigt.`);
}

function assertFxSnapshot(input: {
  usdSekRateMicros: number;
  fxEffectiveDate: Date;
  fxSource: string;
  now: Date;
}) {
  assertDate(input.fxEffectiveDate, "Valutadatumet");
  assertDate(input.now, "Körningstiden");
  if (!Number.isSafeInteger(input.usdSekRateMicros) ||
      input.usdSekRateMicros < 1_000_000 || input.usdSekRateMicros > 100_000_000)
    throw new Error("USD/SEK-kursen är ogiltig.");
  if (input.fxEffectiveDate.getTime() > input.now.getTime())
    throw new Error("Valutakursen kan inte komma från framtiden.");
  // A rate the product owner set in the app stays until it is changed (2026-10-02); a dated snapshot from
  // anywhere else must be recent.
  if (input.fxSource !== SETTING_FX_SOURCE && input.now.getTime() - input.fxEffectiveDate.getTime() > MAX_FX_AGE_MS)
    throw new Error("Valutakursen är äldre än 35 dagar.");
}

function sortLotsForSpend(lots: CreditLot[]) {
  return lots.sort((left, right) => {
    if (left.expiresAt && right.expiresAt)
      return left.expiresAt.getTime() - right.expiresAt.getTime() ||
        left.createdAt.getTime() - right.createdAt.getTime() || left.id.localeCompare(right.id);
    if (left.expiresAt) return -1;
    if (right.expiresAt) return 1;
    return left.createdAt.getTime() - right.createdAt.getTime() || left.id.localeCompare(right.id);
  });
}

function sameReservation(run: AiRun, input: ReserveAiRunInput, reservedCredits: number) {
  const selected = routeAiModel(input.taskKind ?? "KFID_CONTROL_REVIEW");
  const subject = resolveSubject(input);
  return run.subjectType === subject.type && run.subjectId === subject.id &&
    run.controlId === (subject.type === "KFID_CONTROL" ? subject.id : null) &&
    run.actorId === input.actorId &&
    run.agentId === input.agentId && run.model === selected.model &&
    run.reasoningEffort === selected.reasoningEffort &&
    run.pricingVersion === selected.pricingVersion &&
    run.fxSource === input.fxSource &&
    run.fxEffectiveDate.getTime() === input.fxEffectiveDate.getTime() &&
    run.usdSekRateMicros === input.usdSekRateMicros &&
    run.estimatedInputTokens === input.estimatedInputTokens &&
    run.inputTokenLimit === input.inputTokenLimit &&
    run.maxOutputTokens === input.maxOutputTokens &&
    run.reservedCredits === reservedCredits;
}

async function lockedRun(tx: AiTransaction, organizationId: string, runId: string) {
  const rows = await tx.$queryRaw<Array<{ id: string }>>`
    SELECT id FROM "AiRun"
    WHERE id=${runId} AND "organizationId"=${organizationId}
    FOR UPDATE`;
  if (!rows.length) throw new Error("AI-körningen finns inte i den aktiva organisationen.");
  return tx.aiRun.findUniqueOrThrow({ where: { id: runId } });
}

async function releaseReservation(
  tx: AiTransaction,
  run: AiRun,
  credits: number,
  now: Date,
) {
  if (!credits) return null;
  if (!Number.isSafeInteger(credits) || credits < 0 || credits > run.reservedCredits)
    throw new Error("Ogiltig återföring av AI-krediter.");
  const allocations = await tx.creditAllocation.findMany({
    where: { entryId: run.reservationEntryId },
    include: { lot: true },
  });
  if (allocations.reduce((sum, allocation) => sum + allocation.amount, 0) !== run.reservedCredits)
    throw new Error("AI-reservationens kreditfördelning är inkonsekvent.");
  allocations.sort((left, right) => {
    if (left.lot.expiresAt && right.lot.expiresAt)
      return right.lot.expiresAt.getTime() - left.lot.expiresAt.getTime() ||
        right.lot.createdAt.getTime() - left.lot.createdAt.getTime() ||
        right.lot.id.localeCompare(left.lot.id);
    if (!left.lot.expiresAt && right.lot.expiresAt) return -1;
    if (left.lot.expiresAt && !right.lot.expiresAt) return 1;
    return right.lot.createdAt.getTime() - left.lot.createdAt.getTime() ||
      right.lot.id.localeCompare(left.lot.id);
  });

  const reservation = await tx.creditEntry.findUniqueOrThrow({
    where: { id: run.reservationEntryId },
  });
  const entry = await tx.creditEntry.create({
    data: {
      walletId: reservation.walletId,
      amount: credits,
      kind: "AI_RELEASE",
      requestKey: `ai-release:${run.id}`,
      description: "Återförd AI-reservation",
    },
  });
  let left = credits;
  let purchasedReleased = 0;
  for (const allocation of allocations) {
    if (!left) break;
    const amount = Math.min(left, allocation.amount);
    await tx.creditLot.update({
      where: { id: allocation.lotId },
      data: { remaining: { increment: amount } },
    });
    await tx.aiRunCreditRelease.create({
      data: { runId: run.id, lotId: allocation.lotId, amount },
    });
    if (allocation.lot.origin === "PURCHASE") purchasedReleased += amount;
    left -= amount;
  }
  if (left) throw new Error("AI-reservationen kunde inte återföras fullständigt.");
  await tx.creditWallet.update({
    where: { id: reservation.walletId },
    data: {
      balance: { increment: credits },
      purchasedBalance: { increment: purchasedReleased },
    },
  });
  await expireDueLots(tx, reservation.walletId, now);
  return entry.id;
}

export type ReserveAiRunInput = {
  organizationId: string;
  controlId?: string;
  subject?: AiRunSubject;
  actorId: string;
  agentId: string;
  taskKind?: AiTaskKind;
  /** The product owner's minimum for this kind of run (lib/ai/credit-settings.ts); stored on the run. */
  minimumCredits?: number;
  /** Without credits (the community edition): nothing is reserved and nothing is charged; the run is still recorded. */
  free?: boolean;
  requestKey: string;
  /** Where in Workflow the run was asked for ("chat", "tip", "summary", "import"), for cost per place. */
  surface?: string;
  estimatedInputTokens: number;
  inputTokenLimit: number;
  maxOutputTokens: number;
  usdSekRateMicros: number;
  fxSource: string;
  fxEffectiveDate: Date;
};

export async function reserveAiRun(input: ReserveAiRunInput, now = new Date()) {
  if (!REQUEST_KEY.test(input.requestKey)) throw new Error("AI-körningens idempotensnyckel är ogiltig.");
  if (!FX_SOURCE.test(input.fxSource)) throw new Error("AI-körningens valutakälla är ogiltig.");
  if (input.surface !== undefined && !SURFACE.test(input.surface)) throw new Error("AI-körningens ställe är ogiltigt.");
  if (!Number.isSafeInteger(input.estimatedInputTokens) || input.estimatedInputTokens <= 0 ||
      !Number.isSafeInteger(input.inputTokenLimit) || input.inputTokenLimit <= 0 ||
      input.estimatedInputTokens > input.inputTokenLimit || input.inputTokenLimit > MAX_INPUT_TOKENS)
    throw new Error("AI-körningens inputgräns är ogiltig.");
  const agent = getWorkflowAgent(input.agentId);
  if (!agent) throw new Error("AI-agenten finns inte.");
  const subject = resolveSubject(input);
  if (agent.id === "kfid-control-review" && subject.type !== "KFID_CONTROL" && subject.type !== "WORKFLOW_TASK")
    throw new Error("Granskaren kräver en verifierad kontroll eller ett protokoll.");
  if (agent.id === "workflow-assistant" && subject.type !== "WORKFLOW_ASSISTANT")
    throw new Error("Workflow-assistenten kräver en verifierad konversation.");
  if (!Number.isSafeInteger(input.maxOutputTokens) || input.maxOutputTokens <= 0 ||
      input.maxOutputTokens > agent.limits.maxOutputTokens)
    throw new Error("AI-körningens outputgräns är ogiltig.");
  assertFxSnapshot({ ...input, now });
  const quote = quoteAiRun({
    inputTokenLimit: input.inputTokenLimit,
    maxOutputTokens: input.maxOutputTokens,
    usdSekRateMicros: input.usdSekRateMicros,
    taskKind: input.taskKind ?? "KFID_CONTROL_REVIEW",
    minimumCredits: input.minimumCredits,
    free: input.free,
  });

  return prisma.$transaction(async (tx) => {
    const wallet = await lockedWallet(input.organizationId, tx);
    const existing = await tx.aiRun.findUnique({
      where: { organizationId_requestKey: {
        organizationId: input.organizationId,
        requestKey: input.requestKey,
      } },
    });
    if (existing) {
      if (!sameReservation(existing, input, quote.reservedCredits))
        throw new Error("Idempotensnyckeln används redan för en annan AI-körning.");
      return { run: existing, created: false };
    }

    const [control, actor] = await Promise.all([
      subject.type === "KFID_CONTROL"
        ? tx.control.findFirst({
            where: { id: subject.id, organizationId: input.organizationId, deletedAt: null },
            select: { id: true },
          })
        : Promise.resolve({ id: subject.id }),
      tx.organizationMember.findFirst({
        where: {
          organizationId: input.organizationId,
          userId: input.actorId,
          isActive: true,
          organization: { isActive: true },
          user: { isActive: true },
        },
        select: { id: true },
      }),
    ]);
    if (!control) throw new Error("Kontrollen finns inte i den aktiva organisationen.");
    if (!actor) throw new Error("Aktivt medlemskap krävs för AI-körningen.");
    if (wallet.expiryEnabled) await expireDueLots(tx, wallet.id, now);
    const current = await tx.creditWallet.findUniqueOrThrow({ where: { id: wallet.id } });
    if (current.balance < quote.reservedCredits)
      throw new Error("Otillräckligt kreditsaldo för AI-körningens maxkostnad.");
    const lots = sortLotsForSpend(await tx.creditLot.findMany({
      where: { walletId: wallet.id, remaining: { gt: 0 } },
    }));
    if (lots.reduce((sum, lot) => sum + lot.remaining, 0) < quote.reservedCredits)
      throw new Error("Kreditsaldot stämmer inte med kreditlotterna.");

    const reservation = await tx.creditEntry.create({
      data: {
        walletId: wallet.id,
        amount: -quote.reservedCredits,
        kind: "AI_RESERVATION",
        requestKey: `ai-reserve:${input.organizationId}:${input.requestKey}`,
        description: "Workflow AI: reserverad maxkostnad, överskottet återförs när svaret är klart",
      },
    });
    let left = quote.reservedCredits;
    let purchasedReserved = 0;
    for (const lot of lots) {
      if (!left) break;
      const amount = Math.min(left, lot.remaining);
      await tx.creditLot.update({
        where: { id: lot.id },
        data: { remaining: { decrement: amount } },
      });
      await tx.creditAllocation.create({
        data: { lotId: lot.id, entryId: reservation.id, amount },
      });
      if (lot.origin === "PURCHASE") purchasedReserved += amount;
      left -= amount;
    }
    if (left) throw new Error("AI-krediterna kunde inte reserveras fullständigt.");
    await tx.creditWallet.update({
      where: { id: wallet.id },
      data: {
        balance: { decrement: quote.reservedCredits },
        purchasedBalance: { decrement: purchasedReserved },
      },
    });
    const run = await tx.aiRun.create({
      data: {
        organizationId: input.organizationId,
        controlId: subject.type === "KFID_CONTROL" ? subject.id : null,
        subjectType: subject.type,
        subjectId: subject.id,
        actorId: input.actorId,
        agentId: agent.id,
        requestKey: input.requestKey,
        surface: input.surface ?? null,
        provider: quote.policy.provider,
        model: quote.policy.model,
        reasoningEffort: quote.policy.reasoningEffort,
        pricingVersion: quote.policy.pricingVersion,
        fxSource: input.fxSource,
        fxEffectiveDate: input.fxEffectiveDate,
        usdSekRateMicros: input.usdSekRateMicros,
        inputPriceUsdMicrosPerMillion: quote.policy.inputPriceUsdMicrosPerMillion,
        cachedInputPriceUsdMicrosPerMillion: quote.policy.cachedInputPriceUsdMicrosPerMillion,
        outputPriceUsdMicrosPerMillion: quote.policy.outputPriceUsdMicrosPerMillion,
        targetGrossMarginBps: quote.policy.targetGrossMarginBps,
        creditFloorValueOre: quote.policy.creditFloorValueOre,
        minimumCredits: quote.policy.minimumCredits,
        estimatedInputTokens: input.estimatedInputTokens,
        inputTokenLimit: input.inputTokenLimit,
        maxOutputTokens: input.maxOutputTokens,
        reservedCredits: quote.reservedCredits,
        reservationEntryId: reservation.id,
      },
    });
    await tx.aiRunEvent.create({
      data: {
        runId: run.id,
        organizationId: run.organizationId,
        actorId: input.actorId,
        action: "credits_reserved",
        data: {
          reservedCredits: run.reservedCredits,
          model: run.model,
          pricingVersion: run.pricingVersion,
          inputTokenLimit: run.inputTokenLimit,
          maxOutputTokens: run.maxOutputTokens,
        },
      },
    });
    return { run, created: true };
  });
}

export async function markAiRunStarted(
  organizationId: string,
  runId: string,
  actorId: string,
  now = new Date(),
) {
  assertDate(now, "Starttiden");
  return prisma.$transaction(async (tx) => {
    const run = await lockedRun(tx, organizationId, runId);
    if (run.actorId !== actorId) throw new Error("Endast körningens användare får starta den.");
    if (run.status === "RUNNING") return { run, started: false };
    if (run.status !== "RESERVED") throw new Error("AI-körningen kan inte startas i sitt nuvarande läge.");
    const updated = await tx.aiRun.update({
      where: { id: run.id },
      data: { status: "RUNNING", startedAt: now },
    });
    await tx.aiRunEvent.create({
      data: { runId: run.id, organizationId, actorId, action: "provider_started" },
    });
    return { run: updated, started: true };
  });
}

export async function settleAiRun(input: {
  organizationId: string;
  runId: string;
  actorId: string;
  providerResponseId: string;
  usage: AiTokenUsage;
  assistantMessage?: {
    conversationId: string;
    content: string;
    citations: Prisma.InputJsonValue;
    model: string;
  };
}, now = new Date()) {
  assertDate(now, "Slutregleringstiden");
  if (!input.providerResponseId.trim() || input.providerResponseId.length > 200)
    throw new Error("Leverantörens svars-ID är ogiltigt.");
  return prisma.$transaction(async (tx) => {
    await lockedWallet(input.organizationId, tx);
    const run = await lockedRun(tx, input.organizationId, input.runId);
    if (run.actorId !== input.actorId) throw new Error("Endast körningens användare får slutreglera den.");
    if (run.status === "COMPLETED") {
      if (run.providerResponseId !== input.providerResponseId ||
          run.inputTokens !== input.usage.inputTokens ||
          run.cachedInputTokens !== input.usage.cachedInputTokens ||
          run.outputTokens !== input.usage.outputTokens)
        throw new Error("AI-körningen är redan slutreglerad med andra uppgifter.");
      return { run, settled: false };
    }
    if (run.status !== "RESERVED" && run.status !== "RUNNING")
      throw new Error("AI-körningen kan inte slutregleras i sitt nuvarande läge.");
    if (input.usage.inputTokens > run.inputTokenLimit ||
        input.usage.outputTokens > run.maxOutputTokens)
      throw new Error("Leverantörens tokenförbrukning överskrider körningens reserverade gräns.");
    const calculated = calculateAiUsageCost(input.usage, {
      inputPriceUsdMicrosPerMillion: run.inputPriceUsdMicrosPerMillion,
      cachedInputPriceUsdMicrosPerMillion: run.cachedInputPriceUsdMicrosPerMillion,
      outputPriceUsdMicrosPerMillion: run.outputPriceUsdMicrosPerMillion,
      targetGrossMarginBps: run.targetGrossMarginBps,
      creditFloorValueOre: run.creditFloorValueOre,
      minimumCredits: run.minimumCredits,
      usdSekRateMicros: run.usdSekRateMicros,
    });
    // A run reserved with no credits (an installation without the credit system) is never charged.
    const cost = run.reservedCredits === 0 ? { ...calculated, chargedCredits: 0 } : calculated;
    if (cost.chargedCredits > run.reservedCredits)
      throw new Error("AI-körningens verkliga kostnad överskrider kreditreservationen.");
    if (input.assistantMessage) {
      const message = input.assistantMessage;
      if (!message.content.trim() || message.content.length > 12_000 ||
          !message.model.trim() || message.model.length > 100)
        throw new Error("AI-svaret är ogiltigt.");
      const conversation = await tx.aiConversation.findFirst({
        where: {
          id: message.conversationId,
          organizationId: input.organizationId,
          createdById: input.actorId,
          status: "ACTIVE",
        },
        select: { id: true },
      });
      if (!conversation || run.subjectType !== "WORKFLOW_ASSISTANT" ||
          run.subjectId !== conversation.id)
        throw new Error("AI-svaret tillhör inte körningens verifierade konversation.");
      await tx.aiMessage.create({
        data: {
          conversationId: conversation.id,
          organizationId: input.organizationId,
          authorId: null,
          role: "ASSISTANT",
          content: message.content.trim(),
          citations: message.citations,
          model: message.model.trim(),
          runId: run.id,
        },
      });
      await tx.aiConversation.update({
        where: { id: conversation.id },
        data: { lastMessageAt: now },
      });
    }
    const releasedCredits = run.reservedCredits - cost.chargedCredits;
    const releaseEntryId = await releaseReservation(tx, run, releasedCredits, now);
    const updated = await tx.aiRun.update({
      where: { id: run.id },
      data: {
        status: "COMPLETED",
        startedAt: run.startedAt ?? now,
        completedAt: now,
        providerResponseId: input.providerResponseId.trim(),
        inputTokens: input.usage.inputTokens,
        cachedInputTokens: input.usage.cachedInputTokens,
        outputTokens: input.usage.outputTokens,
        providerCostUsdMicros: cost.providerCostUsdMicros,
        providerCostOre: cost.providerCostOre,
        chargedCredits: cost.chargedCredits,
        releasedCredits,
        releaseEntryId,
      },
    });
    await tx.aiRunEvent.create({
      data: {
        runId: run.id,
        organizationId: run.organizationId,
        actorId: input.actorId,
        action: "credits_settled",
        data: {
          inputTokens: input.usage.inputTokens,
          cachedInputTokens: input.usage.cachedInputTokens,
          outputTokens: input.usage.outputTokens,
          providerCostUsdMicros: cost.providerCostUsdMicros,
          providerCostOre: cost.providerCostOre,
          chargedCredits: cost.chargedCredits,
          releasedCredits,
        },
      },
    });
    return { run: updated, settled: true };
  });
}

export async function compensateFailedAiRun(input: {
  organizationId: string;
  runId: string;
  actorId: string;
  failureCode: string;
}, now = new Date()) {
  assertDate(now, "Feltiden");
  if (!FAILURE_CODE.test(input.failureCode)) throw new Error("AI-körningens felkod är ogiltig.");
  return prisma.$transaction(async (tx) => {
    await lockedWallet(input.organizationId, tx);
    const run = await lockedRun(tx, input.organizationId, input.runId);
    if (run.actorId !== input.actorId) throw new Error("Endast körningens användare får avsluta den.");
    if (run.status === "FAILED") {
      if (run.failureCode !== input.failureCode)
        throw new Error("AI-körningen är redan avslutad med en annan felkod.");
      return { run, compensated: false };
    }
    if (run.status !== "RESERVED" && run.status !== "RUNNING")
      throw new Error("AI-körningen kan inte kompenseras i sitt nuvarande läge.");
    const releaseEntryId = await releaseReservation(tx, run, run.reservedCredits, now);
    const updated = await tx.aiRun.update({
      where: { id: run.id },
      data: {
        status: "FAILED",
        failedAt: now,
        failureCode: input.failureCode,
        chargedCredits: 0,
        releasedCredits: run.reservedCredits,
        releaseEntryId,
      },
    });
    await tx.aiRunEvent.create({
      data: {
        runId: run.id,
        organizationId: run.organizationId,
        actorId: input.actorId,
        action: "credits_compensated",
        data: { failureCode: input.failureCode, releasedCredits: run.reservedCredits },
      },
    });
    return { run: updated, compensated: true };
  });
}
