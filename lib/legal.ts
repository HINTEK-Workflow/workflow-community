import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { ApiError } from "@/lib/kfid/errors";
import { isLegalDocumentRequired } from "@/lib/kfid/legal-policy";

type LegalContext = {
  user: { id: string; emailVerifiedAt: Date | null };
  organizationId: string;
  organization: { storageMode: "LOCAL" | "HINTEK_CLOUD"; slug: string };
};

const activeDocumentWhere = (now: Date) => ({
  status: "PUBLISHED" as const,
  publishedAt: { lte: now },
  revokedAt: null,
  OR: [{ validFrom: null }, { validFrom: { lte: now } }],
});

const environmentDocumentWhere = (ctx: LegalContext) => ctx.organization.slug === "qa-role-demo"
  ? { version: { startsWith: "qa-only-" } }
  : { version: { not: { startsWith: "qa-only-" } } };

function scopeKey(scope: "INDIVIDUAL" | "ORGANIZATION", ctx: LegalContext) {
  return scope === "INDIVIDUAL"
    ? `USER:${ctx.user.id}`
    : `ORGANIZATION:${ctx.organizationId}`;
}

export async function legalStatus(ctx: LegalContext) {
  const now = new Date();
  const [published, membership] = await Promise.all([
    prisma.legalDocument.findMany({
      where: { ...activeDocumentWhere(now), ...environmentDocumentWhere(ctx) },
      orderBy: [{ publishedAt: "desc" }, { createdAt: "desc" }],
    }),
    prisma.organizationMember.findUnique({
      where: {
        organizationId_userId: {
          organizationId: ctx.organizationId,
          userId: ctx.user.id,
        },
      },
      select: { role: true, isActive: true },
    }),
  ]);

  // Only the newest effective version of each document type/scope is actionable.
  const current = published.filter(
    (document, index, all) =>
      all.findIndex(
        (candidate) =>
          candidate.type === document.type &&
          candidate.scope === document.scope,
      ) === index,
  );
  const keys = current.map((document) => scopeKey(document.scope, ctx));
  const acceptances = current.length
    ? await prisma.legalAcceptance.findMany({
        where: {
          documentId: { in: current.map((document) => document.id) },
          scopeKey: { in: keys },
        },
      })
    : [];

  return current.map((document) => {
    const key = scopeKey(document.scope, ctx);
    const acceptance = acceptances.find(
      (item) => item.documentId === document.id && item.scopeKey === key,
    );
    const canAccept =
      document.scope === "INDIVIDUAL" ||
      (membership?.isActive === true &&
        (membership.role === "OWNER" || membership.role === "ADMIN"));
    return {
      id: document.id,
      type: document.type,
      scope: document.scope,
      version: document.version,
      title: document.title,
      content: document.content,
      contentHash: document.contentHash,
      validFrom: document.validFrom,
      acceptedAt: acceptance?.acceptedAt ?? null,
      canAccept,
      acceptHelp:
        document.scope === "ORGANIZATION" && !canAccept
          ? "Endast en aktiv företagsadministratör kan godkänna för företaget."
          : null,
      required: isLegalDocumentRequired(
        document.type,
        ctx.organization.storageMode,
      ),
    };
  });
}

export async function assertRequiredLegalAccess(ctx: LegalContext) {
  const now = new Date();
  const requiredTypes = [
    "TERMS",
    "PRIVACY",
    ...(ctx.organization.storageMode === "HINTEK_CLOUD" ? ["DPA"] : []),
  ] as Array<"TERMS" | "PRIVACY" | "DPA">;
  const published = await prisma.legalDocument.findMany({
    where: { ...activeDocumentWhere(now), ...environmentDocumentWhere(ctx), type: { in: requiredTypes } },
    orderBy: [{ publishedAt: "desc" }, { createdAt: "desc" }],
    select: { id: true, type: true, scope: true },
  });
  const current = published.filter(
    (document, index, all) =>
      all.findIndex(
        (candidate) =>
          candidate.type === document.type &&
          candidate.scope === document.scope,
      ) === index,
  );
  if (!current.length) return;
  const accepted = await prisma.legalAcceptance.findMany({
    where: {
      OR: current.map((document) => ({
        documentId: document.id,
        scopeKey: scopeKey(document.scope, ctx),
      })),
    },
    select: { documentId: true, scopeKey: true },
  });
  if (
    current.some(
      (document) =>
        !accepted.some(
          (item) =>
            item.documentId === document.id &&
            item.scopeKey === scopeKey(document.scope, ctx),
        ),
    )
  )
    throw new ApiError(
      428,
      "Godkänn villkoren och bekräfta juridisk information för att fortsätta.",
    );
}

export async function acceptLegalDocument(
  ctx: LegalContext,
  documentId: string,
  expectedContentHash: string,
) {
  if (!ctx.user.emailVerifiedAt)
    throw new ApiError(
      403,
      "Verifierad e-post krävs för att godkänna dokument.",
    );

  return prisma.$transaction(async (tx) => {
    const locked = await tx.$queryRaw<Array<{ id: string }>>`
      SELECT id FROM "LegalDocument" WHERE id=${documentId} FOR UPDATE
    `;
    if (!locked[0]) throw new ApiError(404, "Dokumentet hittades inte.");

    const now = new Date();
    const document = await tx.legalDocument.findFirst({
      where: { id: documentId, ...activeDocumentWhere(now), ...environmentDocumentWhere(ctx) },
    });
    if (!document)
      throw new ApiError(409, "Dokumentversionen är inte längre aktuell.");
    if (document.contentHash !== expectedContentHash)
      throw new ApiError(
        409,
        "Dokumentet har ändrats. Läs den aktuella versionen innan du godkänner.",
      );

    const newer = await tx.legalDocument.findFirst({
      where: {
        AND: [
          activeDocumentWhere(now),
          environmentDocumentWhere(ctx),
          { type: document.type, scope: document.scope },
          {
            OR: [
              { publishedAt: { gt: document.publishedAt! } },
              {
                publishedAt: document.publishedAt,
                createdAt: { gt: document.createdAt },
              },
            ],
          },
        ],
      },
      select: { id: true },
    });
    if (newer)
      throw new ApiError(409, "En nyare dokumentversion måste godkännas.");

    const membership = await tx.organizationMember.findUnique({
      where: {
        organizationId_userId: {
          organizationId: ctx.organizationId,
          userId: ctx.user.id,
        },
      },
      select: { role: true, isActive: true },
    });
    if (!membership?.isActive)
      throw new ApiError(403, "Aktivt medlemskap krävs.");
    if (
      document.scope === "ORGANIZATION" &&
      membership.role !== "OWNER" &&
      membership.role !== "ADMIN"
    )
      throw new ApiError(
        403,
        "Endast en aktiv företagsadministratör kan godkänna för företaget.",
      );

    const key = scopeKey(document.scope, ctx);
    const existing = await tx.legalAcceptance.findUnique({
      where: { documentId_scopeKey: { documentId, scopeKey: key } },
    });
    if (existing) return existing;

    return tx.legalAcceptance.create({
      data: {
        documentId,
        scopeKey: key,
        userId: ctx.user.id,
        organizationId:
          document.scope === "ORGANIZATION" ? ctx.organizationId : null,
        organizationRole: membership.role,
        documentVersion: document.version,
        documentContentHash: document.contentHash,
      },
    });
  });
}

/**
 * The documents a new account accepts when it registers (2026-10-03: one plain "jag har läst" checkbox): the
 * current terms and privacy policy, and the DPA for a Cloud company – the same set the legal gate asks for.
 */
export async function registrationDocuments(storageMode: "LOCAL" | "HINTEK_CLOUD") {
  const now = new Date();
  const types = ["TERMS", "PRIVACY", ...(storageMode === "HINTEK_CLOUD" ? ["DPA"] : [])] as Array<"TERMS" | "PRIVACY" | "DPA">;
  const published = await prisma.legalDocument.findMany({
    where: { ...activeDocumentWhere(now), version: { not: { startsWith: "qa-only-" } }, type: { in: types } },
    orderBy: [{ publishedAt: "desc" }, { createdAt: "desc" }],
    select: { id: true, type: true, scope: true, title: true, version: true, contentHash: true },
  });
  return published.filter((document, index, all) => all.findIndex((candidate) => candidate.type === document.type && candidate.scope === document.scope) === index);
}

/** Records the acceptances given at registration, bound to the exact versions, as the new company's owner. */
export async function recordRegistrationAcceptances(
  tx: Prisma.TransactionClient,
  input: { userId: string; organizationId: string; documents: Awaited<ReturnType<typeof registrationDocuments>> },
) {
  for (const document of input.documents)
    await tx.legalAcceptance.create({ data: {
      documentId: document.id,
      scopeKey: document.scope === "INDIVIDUAL" ? `USER:${input.userId}` : `ORGANIZATION:${input.organizationId}`,
      userId: input.userId,
      organizationId: document.scope === "ORGANIZATION" ? input.organizationId : null,
      organizationRole: "OWNER",
      documentVersion: document.version,
      documentContentHash: document.contentHash,
    } });
}
