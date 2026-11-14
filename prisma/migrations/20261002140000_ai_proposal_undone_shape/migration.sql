-- An applied proposal that was undone (plan 2026-10-01, fas 2) keeps who decided and when it was applied, like an
-- applied one. The check is widened with that state; the other states are unchanged. (In its own migration: a new
-- enum value cannot be used in the transaction that adds it.)
ALTER TABLE "AiProposal" DROP CONSTRAINT "AiProposal_review_shape";
ALTER TABLE "AiProposal"
  ADD CONSTRAINT "AiProposal_review_shape" CHECK (
    ("status" = 'PENDING' AND "reviewedById" IS NULL AND "reviewedAt" IS NULL AND "appliedAt" IS NULL) OR
    ("status" IN ('ACCEPTED', 'REJECTED') AND "reviewedById" IS NOT NULL AND "reviewedAt" IS NOT NULL AND "appliedAt" IS NULL) OR
    ("status" IN ('APPLIED', 'UNDONE') AND "reviewedById" IS NOT NULL AND "reviewedAt" IS NOT NULL AND "appliedAt" IS NOT NULL) OR
    ("status" = 'EXPIRED' AND "appliedAt" IS NULL)
  );
